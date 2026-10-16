'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../db';
import { computeShares } from '@/domain/split';
import { DomainError } from '@/domain/errors';
import { ok, fail, type ActionResult } from '../action-result';
import { chargePaySchema, groupChargeSchema } from '../validation';
import { getGroup, EntityGoneError, lockActiveMembers } from '../group-scope';
import { logActivity } from '../activity';
import { currentActorName } from '../actor';
import { dateStringToDb, dbDateToString } from '../dates';
import { runAction } from './run';
import { asCents, type Cents } from '@/domain/money';

type ParsedCharge = ReturnType<typeof groupChargeSchema.parse>;

const CHARGE_INCLUDE = { shares: true } as const;

type ChargeSnapshotInput = {
  id: string;
  concept: string;
  amountCents: number;
  date: Date;
  splitMode: string;
  shares: { participantId: string; shareInput: number; amountCents: number }[];
};

function chargeSnapshot(charge: ChargeSnapshotInput) {
  return {
    id: charge.id,
    concept: charge.concept,
    amountCents: charge.amountCents,
    date: dbDateToString(charge.date),
    splitMode: charge.splitMode,
    shares: charge.shares.map(({ participantId, shareInput, amountCents }) => ({ participantId, shareInput, amountCents })),
  };
}

/** Splits the charge amount across participants; asserts shares sum to total. */
function computeChargeShares(data: ParsedCharge): {
  totalCents: Cents;
  shares: { participantId: string; shareInput: number; amountCents: Cents }[];
} {
  const totalCents = asCents(data.amount);
  const shares = computeShares(data.splitMode, totalCents, data.shares);
  const sum = shares.reduce((acc, s) => acc + s.amountCents, 0);
  if (sum !== totalCents) throw new DomainError('ITEM_SUM_MISMATCH');
  return { totalCents, shares };
}

async function getScopedCharge(groupId: string, chargeId: string) {
  const charge = await prisma.groupCharge.findFirst({ where: { id: chargeId, groupId }, include: CHARGE_INCLUDE });
  if (!charge) throw new EntityGoneError('charge');
  return charge;
}

export async function createGroupCharge(token: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const parsed = groupChargeSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const { totalCents, shares } = computeChargeShares(parsed.data);
    const actorName = await currentActorName(group.id);
    const charge = await prisma.$transaction(async (tx) => {
      // Every beneficiary must be an active member (createExpense's strict rule).
      await lockActiveMembers(tx, group.id, parsed.data.shares.map((s) => s.participantId));
      const created = await tx.groupCharge.create({
        data: {
          groupId: group.id,
          concept: parsed.data.concept,
          amountCents: totalCents,
          date: dateStringToDb(parsed.data.date),
          splitMode: parsed.data.splitMode,
          shares: {
            create: shares.map(({ participantId, shareInput, amountCents }) => ({ participantId, shareInput, amountCents })),
          },
        },
        include: CHARGE_INCLUDE,
      });
      await logActivity(tx, { groupId: group.id, actorName, action: 'charge.create', payload: chargeSnapshot(created) });
      return created;
    });
    revalidatePath(`/g/${token}`);
    return ok({ id: charge.id });
  });
}

export async function updateGroupCharge(token: string, chargeId: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = groupChargeSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const previous = await getScopedCharge(group.id, chargeId);
    // Grandfather ids already referenced (edits preserve existing shares); only
    // NEWLY referenced ids must be active — mirrors updateExpense (§5).
    const previousIds = new Set(previous.shares.map((s) => s.participantId));
    const newlyReferenced = parsed.data.shares.map((s) => s.participantId).filter((id) => !previousIds.has(id));
    const { totalCents, shares } = computeChargeShares(parsed.data);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await lockActiveMembers(tx, group.id, newlyReferenced);
      await tx.groupChargeShare.deleteMany({ where: { chargeId: previous.id } });
      const updated = await tx.groupCharge.update({
        where: { id: previous.id },
        data: {
          concept: parsed.data.concept,
          amountCents: totalCents,
          date: dateStringToDb(parsed.data.date),
          splitMode: parsed.data.splitMode,
          shares: {
            create: shares.map(({ participantId, shareInput, amountCents }) => ({ participantId, shareInput, amountCents })),
          },
        },
        include: CHARGE_INCLUDE,
      });
      await logActivity(tx, {
        groupId: group.id,
        actorName,
        action: 'charge.update',
        payload: { previous: chargeSnapshot(previous), next: chargeSnapshot(updated) },
      });
    });
    revalidatePath(`/g/${token}`);
    return ok(undefined);
  });
}

export async function deleteGroupCharge(token: string, chargeId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const previous = await getScopedCharge(group.id, chargeId);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await tx.groupCharge.delete({ where: { id: previous.id } }); // cascades to shares
      await logActivity(tx, { groupId: group.id, actorName, action: 'charge.delete', payload: { previous: chargeSnapshot(previous) } });
    });
    revalidatePath(`/g/${token}`);
    return ok(undefined);
  });
}

/**
 * Somebody paid an unpaid charge in full from their own pocket (owner review,
 * session 10): it stops being a debt outside the group and becomes an ordinary
 * expense paid by that person, so it enters the person-to-person settlement.
 * The split is COPIED — mode, inputs and allocated cents — never recomputed,
 * so everyone owes exactly what they owed before. The payer is newly
 * referenced and must be active; the people who owe it are the charge's own
 * and are grandfathered, as in any edit. One transaction: the charge row is
 * locked so a concurrent edit or delete cannot slip between reading the
 * shares and moving them, and the payer row so it cannot be archived midway.
 */
export async function payGroupCharge(token: string, chargeId: string, input: unknown): Promise<ActionResult<{ expenseId: string }>> {
  return runAction(async () => {
    const parsed = chargePaySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const { payerId } = parsed.data;
    const actorName = await currentActorName(group.id);
    const expense = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "GroupCharge" WHERE id = ${chargeId} AND "groupId" = ${group.id} FOR UPDATE`;
      if (locked.length === 0) throw new EntityGoneError('charge');
      // The payer is newly referenced: checked under a share lock, not against
      // the group read above.
      await lockActiveMembers(tx, group.id, [payerId]);
      const charge = await tx.groupCharge.findUniqueOrThrow({ where: { id: chargeId }, include: CHARGE_INCLUDE });
      const created = await tx.expense.create({
        data: {
          groupId: group.id,
          title: charge.concept,
          amountCents: charge.amountCents,
          date: charge.date,
          splitMode: charge.splitMode,
          payers: { create: [{ participantId: payerId, amountCents: charge.amountCents }] },
          items: {
            create: [{
              amountCents: charge.amountCents,
              splitMode: charge.splitMode,
              shares: {
                create: charge.shares.map(({ participantId, shareInput, amountCents }) => ({ participantId, shareInput, amountCents })),
              },
            }],
          },
        },
      });
      await tx.groupCharge.delete({ where: { id: charge.id } }); // cascades to shares
      await logActivity(tx, {
        groupId: group.id,
        actorName,
        action: 'charge.pay',
        payload: { previous: chargeSnapshot(charge), expenseId: created.id, payerId },
      });
      return created;
    });
    revalidatePath(`/g/${token}`);
    return ok({ expenseId: expense.id });
  });
}
