'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../db';
import { ok, fail, type ActionResult } from '../action-result';
import { refundSchema } from '../validation';
import { getGroup, EntityGoneError, lockActiveMembers } from '../group-scope';
import { logActivity } from '../activity';
import { currentActorName } from '../actor';
import { runAction } from './run';
import { computeRefundShares, assertRefundCap } from '@/domain/refund';
import { asCents } from '@/domain/money';

const EXPENSE_INCLUDE = { payers: true, items: { include: { shares: true } } } as const;

type ExpenseWithRelations = {
  id: string;
  amountCents: number;
  // payers are included by the query but unused here (refunds mirror item
  // shares, not payers), so they are intentionally omitted from this type.
  items: { shares: { participantId: string; amountCents: number }[] }[];
};

function aggregateItemShares(expense: ExpenseWithRelations): { participantId: string; amountCents: number }[] {
  const map = new Map<string, number>();
  for (const item of expense.items) {
    for (const s of item.shares) {
      map.set(s.participantId, (map.get(s.participantId) ?? 0) + s.amountCents);
    }
  }
  return [...map.entries()].map(([participantId, amountCents]) => ({ participantId, amountCents }));
}

export async function createRefund(token: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const parsed = refundSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);

    // §2.1: scope-check the parent expense by groupId
    const expense = await prisma.expense.findFirst({
      where: { id: parsed.data.expenseId, groupId: group.id },
      include: EXPENSE_INCLUDE,
    });
    if (!expense) throw new EntityGoneError('expense'); // deleted expense guard — cascade removed it

    // Default receivedById = first payer of the original expense
    const receivedById = parsed.data.receivedById;
    const originalShares = aggregateItemShares(expense);
    // Mirrored shares are computed ONCE here and frozen as a snapshot — later
    // expense edits must never rewrite who a past refund credits.
    const mirroredShares = computeRefundShares(
      originalShares.map((s) => ({ participantId: s.participantId, amountCents: asCents(s.amountCents) })),
      asCents(parsed.data.amount),
    );

    const actorName = await currentActorName(group.id);
    const refund = await prisma.$transaction(async (tx) => {
      // Row-lock the expense so a concurrent createRefund AND a concurrent
      // updateExpense shrink-edit on the same expense serialize — both the
      // refund aggregate and the expense total are re-read INSIDE this lock,
      // in this transaction (updateExpense takes the same lock before
      // writing its own update, so the two can never jointly violate the
      // cap regardless of which one runs first).
      await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${expense.id} FOR UPDATE`;
      await lockActiveMembers(tx, group.id, [receivedById]);
      const lockedExpense = await tx.expense.findUniqueOrThrow({
        where: { id: expense.id },
        select: { amountCents: true },
      });
      const priorRefunds = await tx.refund.aggregate({
        _sum: { amountCents: true },
        where: { expenseId: expense.id },
      });
      const priorTotal = asCents(priorRefunds._sum.amountCents ?? 0);
      assertRefundCap(priorTotal, asCents(parsed.data.amount), asCents(lockedExpense.amountCents));

      const created = await tx.refund.create({
        data: {
          groupId: group.id,
          expenseId: expense.id,
          receivedById,
          amountCents: parsed.data.amount,
          // Plain JSON-safe objects — Prisma's Json input type doesn't
          // accept the branded Cents type directly.
          sharesSnapshot: mirroredShares.map((s) => ({ participantId: s.participantId, amountCents: Number(s.amountCents) })),
        },
      });
      await logActivity(tx, {
        groupId: group.id,
        actorName,
        action: 'refund.create',
        payload: {
          id: created.id,
          expenseId: expense.id,
          receivedById,
          amountCents: created.amountCents,
          originalBeneficiaries: originalShares.map((s) => s.participantId),
        },
      });
      return created;
    });
    revalidatePath(`/g/${token}`);
    return ok({ id: refund.id });
  });
}

export async function deleteRefund(token: string, refundId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const previous = await prisma.refund.findFirst({
      where: { id: refundId, groupId: group.id }, // §2.1 scope filter
    });
    if (!previous) throw new EntityGoneError('refund');
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await tx.refund.delete({ where: { id: previous.id } });
      await logActivity(tx, {
        groupId: group.id,
        actorName,
        action: 'refund.delete',
        payload: {
          previous: {
            id: previous.id,
            expenseId: previous.expenseId,
            receivedById: previous.receivedById,
            amountCents: previous.amountCents,
          },
        },
      });
    });
    revalidatePath(`/g/${token}`);
    return ok(undefined);
  });
}
