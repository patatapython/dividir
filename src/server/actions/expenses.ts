'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../db';
import { computeShares, validatePayerSum, validateItemSum, type SplitMode } from '@/domain/split';
import { DomainError } from '@/domain/errors';
import { assertRefundCap } from '@/domain/refund';
import { ok, fail, type ActionResult } from '../action-result';
import { expenseSchema } from '../validation';
import { getGroup, EntityGoneError, lockActiveMembers } from '../group-scope';
import { logActivity } from '../activity';
import { currentActorName } from '../actor';
import { dateStringToDb, dbDateToString } from '../dates';
import { runAction } from './run';
import { asCents, type Cents } from '@/domain/money';

type ParsedExpense = ReturnType<typeof expenseSchema.parse>;

/** All participant ids referenced by a set of payers + item shares. An
 * ownerless payer (participantId null, "Sobrante" in the UI) is NOT a member to
 * validate, so it is filtered out. */
function referencedIds(
  payers: { participantId: string | null }[],
  items: { shares: { participantId: string }[] }[],
): string[] {
  return [
    ...payers.map((p) => p.participantId).filter((id): id is string => id !== null),
    ...items.flatMap((i) => i.shares.map((s) => s.participantId)),
  ];
}

/** All participant ids referenced by an expense's payers + item shares. */
function referencedParticipantIds(data: ParsedExpense): string[] {
  return referencedIds(data.payers, data.items);
}


type ExpenseSnapshot = {
  id: string;
  title: string;
  amountCents: number;
  date: Date;
  splitMode: string;
  payers: { participantId: string | null; amountCents: number }[];
  items: {
    label: string | null;
    amountCents: number;
    splitMode: string;
    shares: { participantId: string; shareInput: number; amountCents: number }[];
  }[];
};

function expenseSnapshot(expense: ExpenseSnapshot) {
  return {
    id: expense.id,
    title: expense.title,
    amountCents: expense.amountCents,
    date: dbDateToString(expense.date),
    splitMode: expense.splitMode,
    payers: expense.payers.map(({ participantId, amountCents }) => ({ participantId, amountCents })),
    items: expense.items.map((item) => ({
      label: item.label,
      amountCents: item.amountCents,
      splitMode: item.splitMode,
      shares: item.shares.map(({ participantId, shareInput, amountCents }) => ({ participantId, shareInput, amountCents })),
    })),
  };
}

const EXPENSE_INCLUDE = { payers: true, items: { include: { shares: true } } } as const;

async function getScopedExpense(groupId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, groupId }, include: EXPENSE_INCLUDE });
  if (!expense) throw new EntityGoneError('expense');
  return expense;
}

/** Computes shares per item and aggregates into per-participant totals. Throws on domain error. */
function computeExpenseShares(data: ParsedExpense): {
  totalCents: Cents;
  items: { label: string | null; amountCents: Cents; splitMode: SplitMode; shares: { participantId: string; shareInput: number; amountCents: Cents }[] }[];
} {
  const itemTotals = data.items.map((i) => i.amount);
  const totalCents = asCents(itemTotals.reduce((acc, t) => acc + t, 0));

  validatePayerSum(
    data.payers.map((p) => ({ participantId: p.participantId, amountCents: asCents(p.amount) })),
    totalCents,
  );
  validateItemSum(itemTotals, totalCents);

  const computedItems = data.items.map((item) => {
    const shares = computeShares(item.splitMode, item.amount, item.shares);
    return {
      label: item.label ?? null,
      amountCents: asCents(item.amount),
      splitMode: item.splitMode,
      shares,
    };
  });

  // Assert per-item invariant: shares sum to item total (FIX-8: typed
  // DomainError, not a raw Error, so runAction handles it consistently)
  for (const item of computedItems) {
    const itemShareSum = item.shares.reduce((acc, s) => acc + s.amountCents, 0);
    if (itemShareSum !== item.amountCents) {
      throw new DomainError('ITEM_SUM_MISMATCH');
    }
  }

  return { totalCents, items: computedItems };
}

export async function createExpense(token: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const parsed = expenseSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const { totalCents, items: computedItems } = computeExpenseShares(parsed.data);
    const actorName = await currentActorName(group.id);
    const primaryMode = parsed.data.items[0].splitMode;
    const expense = await prisma.$transaction(async (tx) => {
      // §2.1 + v1.1 archive rule (FIX-6): a new expense has no previous state to
      // grandfather, so every payer and beneficiary must be an active member.
      await lockActiveMembers(tx, group.id, referencedParticipantIds(parsed.data));
      const created = await tx.expense.create({
        data: {
          groupId: group.id,
          title: parsed.data.title,
          amountCents: totalCents,
          date: dateStringToDb(parsed.data.date),
          splitMode: primaryMode,
          payers: {
            create: parsed.data.payers.map((p) => ({ participantId: p.participantId, amountCents: p.amount })),
          },
          items: {
            create: computedItems.map((item) => ({
              label: item.label,
              amountCents: item.amountCents,
              splitMode: item.splitMode,
              shares: {
                create: item.shares.map(({ participantId, shareInput, amountCents }) => ({
                  participantId,
                  shareInput,
                  amountCents,
                })),
              },
            })),
          },
        },
        include: EXPENSE_INCLUDE,
      });
      await logActivity(tx, { groupId: group.id, actorName, action: 'expense.create', payload: expenseSnapshot(created) });
      return created;
    });
    revalidatePath(`/g/${token}`);
    return ok({ id: expense.id });
  });
}

export async function updateExpense(token: string, expenseId: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = expenseSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const previous = await getScopedExpense(group.id, expenseId);

    // Archived-participant enforcement only applies to ids that are NEWLY
    // referenced by this edit — ids already present in the previous state
    // (payers + item shares) stay valid even if archived since, so that
    // editing an unrelated field never breaks on a since-archived
    // participant (archiving excludes someone from NEW references only; an
    // edit must preserve the shares that already exist). createExpense
    // checks every referenced id. Checked under lock inside the transaction.
    const previousIds = new Set(referencedIds(previous.payers, previous.items));
    const newlyReferencedIds = referencedParticipantIds(parsed.data).filter((id) => !previousIds.has(id));

    const { totalCents, items: computedItems } = computeExpenseShares(parsed.data);

    const actorName = await currentActorName(group.id);
    const primaryMode = parsed.data.items[0].splitMode;
    await prisma.$transaction(async (tx) => {
      // Row-lock the expense so a concurrent createRefund serializes against
      // this update — the refund-cap re-check and the write happen under the
      // same lock, in the same transaction, closing the shrink-edit vs
      // refund race (createRefund takes the same lock before its own check).
      await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${previous.id} FOR UPDATE`;
      await lockActiveMembers(tx, group.id, newlyReferencedIds);
      const priorRefunds = await tx.refund.aggregate({
        _sum: { amountCents: true },
        where: { expenseId: previous.id },
      });
      assertRefundCap(asCents(priorRefunds._sum.amountCents ?? 0), asCents(0), totalCents);

      await tx.expenseShare.deleteMany({ where: { item: { expenseId: previous.id } } });
      await tx.expensePayer.deleteMany({ where: { expenseId: previous.id } });
      await tx.expenseItem.deleteMany({ where: { expenseId: previous.id } });
      const updated = await tx.expense.update({
        where: { id: previous.id },
        data: {
          title: parsed.data.title,
          amountCents: totalCents,
          date: dateStringToDb(parsed.data.date),
          splitMode: primaryMode,
          payers: {
            create: parsed.data.payers.map((p) => ({ participantId: p.participantId, amountCents: p.amount })),
          },
          items: {
            create: computedItems.map((item) => ({
              label: item.label,
              amountCents: item.amountCents,
              splitMode: item.splitMode,
              shares: {
                create: item.shares.map(({ participantId, shareInput, amountCents }) => ({
                  participantId,
                  shareInput,
                  amountCents,
                })),
              },
            })),
          },
        },
        include: EXPENSE_INCLUDE,
      });
      await logActivity(tx, {
        groupId: group.id,
        actorName,
        action: 'expense.update',
        payload: { previous: expenseSnapshot(previous), next: expenseSnapshot(updated) },
      });
    });
    revalidatePath(`/g/${token}`);
    return ok(undefined);
  });
}

export async function deleteExpense(token: string, expenseId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const previous = await getScopedExpense(group.id, expenseId);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await tx.expense.delete({ where: { id: previous.id } }); // cascades to items → shares, payers, refunds
      await logActivity(tx, {
        groupId: group.id,
        actorName,
        action: 'expense.delete',
        payload: { previous: expenseSnapshot(previous) },
      });
    });
    revalidatePath(`/g/${token}`);
    return ok(undefined);
  });
}
