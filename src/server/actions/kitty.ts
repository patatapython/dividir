'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '../db';
import { DomainError } from '@/domain/errors';
import { ok, fail, type ActionResult } from '../action-result';
import { kittyOpenSchema, kittyRenameSchema, contributionSchema, contributionsSchema, spendSchema, kittyCloseSchema } from '../validation';
import { getGroup, EntityGoneError, lockActiveMembers } from '../group-scope';
import { logActivity } from '../activity';
import { currentActorName } from '../actor';
import { kittyBalance, distributeKitty } from '@/domain/kitty';
import { asCents } from '@/domain/money';
import { runAction } from './run';
import { isUniqueViolation } from '../prisma-errors';

/** What a round opened without a name is called. */
const DEFAULT_ROUND_NAME = 'Ronda';

/** The bote's views (Ronda, Cerradas) all render from the same kitty rows. */
function revalidateBote(token: string) {
  revalidatePath(`/g/${token}/bote`, 'layout');
}

/**
 * Lazily create the group's single Kitty — v1.3: a pure lock anchor, no money.
 * Race-safe: two concurrent first-uses both miss the findUnique, one wins the
 * create and the other maps the unique violation back to a re-read
 * (Kitty.groupId is @unique).
 */
export async function ensureKitty(groupId: string): Promise<{ id: string }> {
  const existing = await prisma.kitty.findUnique({ where: { groupId } });
  if (existing) return existing;
  try {
    return await prisma.kitty.create({ data: { groupId } });
  } catch (error) {
    if (isUniqueViolation(error)) return prisma.kitty.findUniqueOrThrow({ where: { groupId } });
    throw error;
  }
}

/**
 * Serializes every writer on a group's kitty by taking a row lock on the Kitty
 * row for the rest of the transaction. This makes the read-then-write guards
 * (balance ≥ 0, single open round) atomic under concurrency — the bote is a
 * shared, multi-user ledger, so two people can mutate the same open round at
 * once (spec §2.1 invariant). Mirrors the v1.1 refund-cap SELECT … FOR UPDATE.
 */
async function lockKitty(tx: Prisma.TransactionClient, groupId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Kitty" WHERE "groupId" = ${groupId} FOR UPDATE`;
}

/** Loads the round scoped to the group and asserts it is open. Throws (aborting
 * the surrounding transaction) on a missing or closed round. */
async function requireOpenRoundTx(tx: Prisma.TransactionClient, groupId: string, roundId: string) {
  const round = await tx.kittyRound.findFirst({ where: { id: roundId, groupId } }); // §2.1 scope
  if (!round) throw new EntityGoneError('kittyRound');
  if (round.closedAt) throw new DomainError('KITTY_ROUND_CLOSED');
  return round;
}

/** Current available balance of a round, read inside the locked transaction. */
async function balanceInTx(tx: Prisma.TransactionClient, roundId: string, carryInCents: number): Promise<number> {
  const [contribs, spends] = await Promise.all([
    tx.kittyContribution.findMany({ where: { kittyRoundId: roundId } }),
    tx.kittySpend.findMany({ where: { kittyRoundId: roundId } }),
  ]);
  return kittyBalance({
    carryInCents: asCents(carryInCents),
    contributions: contribs.map((c) => asCents(c.amountCents)),
    spends: spends.map((s) => asCents(s.amountCents)),
  });
}

export async function openKittyRound(token: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const parsed = kittyOpenSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const kitty = await ensureKitty(group.id);
    const actorName = await currentActorName(group.id);
    const name = parsed.data.name || DEFAULT_ROUND_NAME;

    try {
      const round = await prisma.$transaction(async (tx) => {
        await lockKitty(tx, group.id);
        const alreadyOpen = await tx.kittyRound.findFirst({ where: { groupId: group.id, closedAt: null } });
        if (alreadyOpen) throw new DomainError('KITTY_ROUND_ALREADY_OPEN');
        // v1.3: the carry-in is whatever the user says the group already has
        // on the table ("Sobrante de otra vez") — nothing is read from storage.
        const carryIn = parsed.data.preexisting ?? 0;
        const created = await tx.kittyRound.create({
          data: { kittyId: kitty.id, groupId: group.id, name, carryInCents: carryIn },
        });
        await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.open', payload: { id: created.id, name, carryInCents: carryIn } });
        return created;
      });
      revalidateBote(token);
      return ok({ id: round.id });
    } catch (error) {
      // Partial-unique-index backstop: if two opens ever raced past the lock,
      // the second INSERT violates the "one open round per group" index.
      if (isUniqueViolation(error)) return fail('Ya hay una ronda abierta');
      throw error;
    }
  });
}

/** v1.3: contributions arrive inline for several participants at once — one
 * atomic batch under the kitty lock, one activity entry. A batch of one is
 * the single-contributor case. */
export async function addContributions(token: string, roundId: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = contributionsSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await lockKitty(tx, group.id);
      await lockActiveMembers(tx, group.id, parsed.data.contributions.map((c) => c.participantId));
      const round = await requireOpenRoundTx(tx, group.id, roundId);
      await tx.kittyContribution.createMany({
        data: parsed.data.contributions.map((c) => ({ kittyRoundId: round.id, participantId: c.participantId, amountCents: c.amount })),
      });
      const totalCents = parsed.data.contributions.reduce((acc, c) => acc + c.amount, 0);
      await logActivity(tx, {
        groupId: group.id, actorName, action: 'kitty.contribute',
        payload: {
          op: 'bulk', roundId: round.id, totalCents,
          contributions: parsed.data.contributions.map((c) => ({ participantId: c.participantId, amountCents: c.amount })),
        },
      });
    });
    revalidateBote(token);
    return ok(undefined);
  });
}

export async function addSpend(token: string, roundId: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = spendSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await lockKitty(tx, group.id);
      const round = await requireOpenRoundTx(tx, group.id, roundId);
      const available = await balanceInTx(tx, round.id, round.carryInCents);
      if (parsed.data.amount > available) throw new DomainError('KITTY_SPEND_EXCEEDS_BALANCE');
      await tx.kittySpend.create({
        data: { kittyRoundId: round.id, concept: parsed.data.concept, amountCents: parsed.data.amount },
      });
      await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.spend', payload: { roundId: round.id, concept: parsed.data.concept, amountCents: parsed.data.amount } });
    });
    revalidateBote(token);
    return ok(undefined);
  });
}

export async function closeKittyRound(token: string, roundId: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = kittyCloseSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);

    await prisma.$transaction(async (tx) => {
      await lockKitty(tx, group.id);
      const round = await requireOpenRoundTx(tx, group.id, roundId);
      const contribs = await tx.kittyContribution.findMany({ where: { kittyRoundId: round.id } });
      const spends = await tx.kittySpend.findMany({ where: { kittyRoundId: round.id } });
      const balance = kittyBalance({
        carryInCents: asCents(round.carryInCents),
        contributions: contribs.map((c) => asCents(c.amountCents)),
        spends: spends.map((s) => asCents(s.amountCents)),
      });

      if (parsed.data.action === 'CERRAR') {
        // v1.3: the leftover is purely informational — derived from the
        // round's rows whenever displayed, never stored or carried.
        await tx.kittyRound.update({ where: { id: round.id }, data: { closeAction: 'CERRAR', closedAt: new Date() } });
        await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.close', payload: { roundId: round.id, name: round.name, action: 'CERRAR', leftoverCents: balance } });
        return;
      }
      // REPARTIR — aggregate multiple contributions by the same person into one
      // line, then distribute. distributeKitty throws KITTY_NOTHING_TO_DISTRIBUTE
      // when the round has no contributions or the bote is at 0.
      const byParticipant = new Map<string, number>();
      for (const c of contribs) byParticipant.set(c.participantId, (byParticipant.get(c.participantId) ?? 0) + c.amountCents);
      const aggregated = [...byParticipant.entries()].map(([participantId, amountCents]) => ({ participantId, amountCents: asCents(amountCents) }));
      const payout = distributeKitty(balance, aggregated);
      // Strip the branded Cents type down to plain numbers for JSON columns.
      const payoutSnapshot: { participantId: string; amountCents: number }[] = payout.map((p) => ({ participantId: p.participantId, amountCents: p.amountCents }));
      await tx.kittyRound.update({ where: { id: round.id }, data: { closeAction: 'REPARTIR', closedAt: new Date(), payoutSnapshot } });
      await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.close', payload: { roundId: round.id, name: round.name, action: 'REPARTIR', payout: payoutSnapshot } });
    });
    revalidateBote(token);
    return ok(undefined);
  });
}

/** v1.3 §5: mistakes in a closed round are fixed by reopening it — never by
 * editing closed data in place (that would desync a frozen REPARTIR payout).
 * Only allowed while the group has NO open round, so the single-open-round
 * invariant (and its partial-index backstop) keeps holding. */
export async function reopenKittyRound(token: string, roundId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await lockKitty(tx, group.id);
      const round = await tx.kittyRound.findFirst({ where: { id: roundId, groupId: group.id } }); // §2.1 scope
      if (!round) throw new EntityGoneError('kittyRound');
      const anyOpen = await tx.kittyRound.findFirst({ where: { groupId: group.id, closedAt: null } });
      if (anyOpen) throw new DomainError('KITTY_ROUND_ALREADY_OPEN');
      await tx.kittyRound.update({
        where: { id: round.id },
        data: { closedAt: null, closeAction: null, payoutSnapshot: Prisma.DbNull },
      });
      await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.reopen', payload: { roundId: round.id, name: round.name } });
    });
    revalidateBote(token);
    return ok(undefined);
  });
}

/** T-100: a round's name is the only thing that can change once it is closed —
 * it moves no money, so a closed round is renamed in place, never reopened. */
export async function renameKittyRound(token: string, roundId: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = kittyRenameSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);
    const { name } = parsed.data;
    await prisma.$transaction(async (tx) => {
      await lockKitty(tx, group.id);
      const round = await tx.kittyRound.findFirst({ where: { id: roundId, groupId: group.id } }); // §2.1 scope
      if (!round) throw new EntityGoneError('kittyRound');
      if (round.name === name) return; // saving the same name is not a change
      await tx.kittyRound.update({ where: { id: round.id }, data: { name } });
      await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.rename', payload: { roundId: round.id, previous: { name: round.name }, name } });
    });
    revalidateBote(token);
    return ok(undefined);
  });
}

/** Loads a contribution scoped to the group inside the tx and asserts open. */
async function requireOpenContributionTx(tx: Prisma.TransactionClient, groupId: string, contributionId: string) {
  const contribution = await tx.kittyContribution.findFirst({
    where: { id: contributionId, round: { groupId } }, // §2.1 scope
    include: { round: true },
  });
  if (!contribution) throw new EntityGoneError('kittyContribution');
  if (contribution.round.closedAt) throw new DomainError('KITTY_ROUND_CLOSED');
  return contribution;
}

/** Loads a spend scoped to the group inside the tx and asserts open. */
async function requireOpenSpendTx(tx: Prisma.TransactionClient, groupId: string, spendId: string) {
  const spend = await tx.kittySpend.findFirst({
    where: { id: spendId, round: { groupId } }, // §2.1 scope
    include: { round: true },
  });
  if (!spend) throw new EntityGoneError('kittySpend');
  if (spend.round.closedAt) throw new DomainError('KITTY_ROUND_CLOSED');
  return spend;
}

export async function editContribution(token: string, contributionId: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = contributionSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await lockKitty(tx, group.id);
      const contribution = await requireOpenContributionTx(tx, group.id, contributionId);
      // Archived-participant enforcement only applies when the edit NEWLY
      // references a different participant — the existing author stays
      // valid even if archived since the contribution was made, so that
      // an amount-only edit never breaks on a since-archived contributor
      // (grandfathering, same pattern as updateExpense in expenses.ts).
      if (parsed.data.participantId !== contribution.participantId) {
        await lockActiveMembers(tx, group.id, [parsed.data.participantId]);
      }
      // balanceInTx already includes this contribution's OLD amount.
      const available = await balanceInTx(tx, contribution.round.id, contribution.round.carryInCents);
      if (available - contribution.amountCents + parsed.data.amount < 0) throw new DomainError('KITTY_BALANCE_NEGATIVE');
      await tx.kittyContribution.update({
        where: { id: contribution.id },
        data: { participantId: parsed.data.participantId, amountCents: parsed.data.amount },
      });
      await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.contribute', payload: { op: 'edit', id: contribution.id, participantId: parsed.data.participantId, amountCents: parsed.data.amount } });
    });
    revalidateBote(token);
    return ok(undefined);
  });
}

export async function deleteContribution(token: string, contributionId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await lockKitty(tx, group.id);
      const contribution = await requireOpenContributionTx(tx, group.id, contributionId);
      const available = await balanceInTx(tx, contribution.round.id, contribution.round.carryInCents);
      if (available - contribution.amountCents < 0) throw new DomainError('KITTY_BALANCE_NEGATIVE');
      await tx.kittyContribution.delete({ where: { id: contribution.id } });
      await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.contribute', payload: { op: 'delete', id: contribution.id, participantId: contribution.participantId, amountCents: contribution.amountCents } });
    });
    revalidateBote(token);
    return ok(undefined);
  });
}

export async function editSpend(token: string, spendId: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = spendSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await lockKitty(tx, group.id);
      const spend = await requireOpenSpendTx(tx, group.id, spendId);
      // balanceInTx already has this spend's OLD amount subtracted, so the
      // replacement is bounded by available + old.
      const available = await balanceInTx(tx, spend.round.id, spend.round.carryInCents);
      if (parsed.data.amount > available + spend.amountCents) throw new DomainError('KITTY_SPEND_EXCEEDS_BALANCE');
      await tx.kittySpend.update({
        where: { id: spend.id },
        data: { concept: parsed.data.concept, amountCents: parsed.data.amount },
      });
      await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.spend', payload: { op: 'edit', id: spend.id, concept: parsed.data.concept, amountCents: parsed.data.amount } });
    });
    revalidateBote(token);
    return ok(undefined);
  });
}

export async function deleteSpend(token: string, spendId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await lockKitty(tx, group.id);
      const spend = await requireOpenSpendTx(tx, group.id, spendId);
      await tx.kittySpend.delete({ where: { id: spend.id } });
      await logActivity(tx, { groupId: group.id, actorName, action: 'kitty.spend', payload: { op: 'delete', id: spend.id, concept: spend.concept, amountCents: spend.amountCents } });
    });
    revalidateBote(token);
    return ok(undefined);
  });
}
