import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from './db';

/**
 * §2.1 invariant: the URL token IS the credential. An unknown token is the
 * only case that reports a missing group (pages render the app-level 404).
 */
export class GroupNotFoundError extends Error {
  constructor() {
    super('group not found');
    this.name = 'GroupNotFoundError';
  }
}

/** Sub-entities an action reads scoped to the group of the token. */
export type ScopedEntity =
  | 'participant'
  | 'expense'
  | 'refund'
  | 'payment'
  | 'charge'
  | 'kittyRound'
  | 'kittyContribution'
  | 'kittySpend';

/**
 * A sub-entity the token's group does not hold. §2.1: an id from another
 * group and a row deleted from another device are indistinguishable — both
 * report "this item no longer exists", never whether the id lives elsewhere.
 */
export class EntityGoneError extends Error {
  constructor(readonly entity: ScopedEntity) {
    super(`${entity} not found in group`);
    this.name = 'EntityGoneError';
  }
}

/**
 * v1.1 archive rule (FIX-6): archived participants are excluded from new
 * expenses/refunds/round advances server-side, not just client-side.
 */
export class ArchivedParticipantError extends Error {
  constructor() {
    super('archived participant');
    this.name = 'ArchivedParticipantError';
  }
}

/**
 * Shared membership validation (FIX-6): every referenced participant id must
 * belong to the group (§2.1) AND must not be archived. Used by
 * createExpense/updateExpense (payers + beneficiaries), createRefund
 * (receivedById), and openRound (advance participants).
 */
export function assertActiveMembers(
  participants: { id: string; archivedAt: Date | null }[],
  referencedIds: string[],
): void {
  const byId = new Map(participants.map((p) => [p.id, p]));
  for (const id of referencedIds) {
    const participant = byId.get(id);
    if (!participant) throw new EntityGoneError('participant');
    if (participant.archivedAt !== null) throw new ArchivedParticipantError();
  }
}

/**
 * assertActiveMembers against rows read and SHARE-locked inside the caller's
 * transaction. A check against the group read before the transaction lets a
 * person archived (or deleted) from another device in between be newly
 * referenced; with the share lock, that archive or delete waits for this
 * transaction instead. Rows are locked in id order, so two transactions
 * referencing the same people never wait on each other. Callers take their own
 * entity lock first (expense, charge, kitty) and this one after it.
 */
export async function lockActiveMembers(
  tx: Prisma.TransactionClient,
  groupId: string,
  referencedIds: string[],
): Promise<void> {
  const ids = [...new Set(referencedIds)].sort();
  if (ids.length === 0) return;
  const rows = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`
    SELECT id, "archivedAt" FROM "Participant"
    WHERE "groupId" = ${groupId} AND id = ANY(${ids}::text[])
    ORDER BY id FOR SHARE`;
  assertActiveMembers(rows, ids);
}

/**
 * The one participant order, shared by every view. Participants created with
 * the group tie on createdAt (same transaction), so the id breaks the tie;
 * without it Postgres returns heap order, which an UPDATE (rename, archive)
 * reshuffles.
 */
export const PARTICIPANT_ORDER: Prisma.ParticipantOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { id: 'asc' },
];

const groupInclude = { participants: { orderBy: PARTICIPANT_ORDER } };

export async function getGroup(token: string) {
  const group = await prisma.group.findUnique({ where: { id: token }, include: groupInclude });
  if (!group) throw new GroupNotFoundError();
  return group;
}

/**
 * One group read per render: the layout and the pages below it share it.
 * React.cache is scoped to a single server request, so it never serves a row
 * from another request. Actions keep the uncached getGroup: they read once and
 * then write, so memoizing would buy nothing and could hand back a stale row.
 */
const findGroupForRender = cache((token: string) =>
  prisma.group.findUnique({ where: { id: token }, include: groupInclude }),
);

/** Page variant: renders the app-level 404. */
export async function requireGroup(token: string) {
  const group = await findGroupForRender(token);
  if (!group) notFound();
  return group;
}
