'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { prisma } from '../db';
import { ok, fail, type ActionResult } from '../action-result';
import { participantNameSchema } from '../validation';
import { getGroup, EntityGoneError } from '../group-scope';
import { logActivity } from '../activity';
import { currentActorName } from '../actor';
import { runAction } from './run';
import { isUniqueViolation } from '../prisma-errors';

const DUPLICATE_NAME = 'Ya existe un participante con ese nombre';
const REFERENCED = 'No se puede eliminar: tiene gastos (pagados o sin pagar), pagos o aportes al bote asociados';

/** §2.1: participant must belong to the group named by the token. */
async function getScopedParticipant(groupId: string, participantId: string) {
  const participant = await prisma.participant.findFirst({ where: { id: participantId, groupId } });
  if (!participant) throw new EntityGoneError('participant');
  return participant;
}

export async function addParticipant(token: string, name: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const parsed = participantNameSchema.safeParse(name);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const actorName = await currentActorName(group.id);
    try {
      const participant = await prisma.$transaction(async (tx) => {
        const created = await tx.participant.create({ data: { groupId: group.id, name: parsed.data } });
        await logActivity(tx, { groupId: group.id, actorName, action: 'participant.create', payload: { name: created.name } });
        return created;
      });
      revalidatePath(`/g/${token}`);
      revalidatePath(`/g/${token}/ajustes`);
      return ok({ id: participant.id });
    } catch (error) {
      if (isUniqueViolation(error)) return fail(DUPLICATE_NAME);
      throw error;
    }
  });
}

export async function updateParticipant(token: string, participantId: string, name: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = participantNameSchema.safeParse(name);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const participant = await getScopedParticipant(group.id, participantId);
    const actorName = await currentActorName(group.id);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.participant.update({ where: { id: participant.id }, data: { name: parsed.data } });
        await logActivity(tx, {
          groupId: group.id, actorName, action: 'participant.update',
          payload: { previous: { name: participant.name }, name: parsed.data },
        });
      });
      revalidatePath(`/g/${token}`);
      revalidatePath(`/g/${token}/ajustes`);
      return ok(undefined);
    } catch (error) {
      if (isUniqueViolation(error)) return fail(DUPLICATE_NAME);
      throw error;
    }
  });
}

export async function deleteParticipant(token: string, participantId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const participant = await getScopedParticipant(group.id, participantId);
    const actorName = await currentActorName(group.id);
    const result = await prisma.$transaction(async (tx) => {
      // Lock the row first: a concurrent insert that references the participant
      // needs a KEY SHARE lock on it, so it waits for us (and then fails its FK)
      // or has already committed and is visible to the counts below.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Participant" WHERE id = ${participant.id} FOR UPDATE`;
      if (locked.length === 0) throw new EntityGoneError('participant');
      const where = { participantId: participant.id };
      const references = [
        await tx.expensePayer.count({ where }),
        await tx.expenseShare.count({ where }),
        await tx.payment.count({ where: { fromId: participant.id } }),
        await tx.payment.count({ where: { toId: participant.id } }),
        await tx.refund.count({ where: { receivedById: participant.id } }), // FIX-8: refunds were missing from this guard
        await tx.kittyContribution.count({ where }), // JD-1: bote contributions were missing from this guard
        await tx.groupChargeShare.count({ where }), // v1.4: GroupChargeShare → Participant is Restrict too
      ].reduce((sum, n) => sum + n, 0);
      if (references > 0) return fail(REFERENCED); // onDelete: Restrict is the DB backstop
      await tx.participant.delete({ where: { id: participant.id } });
      await logActivity(tx, {
        groupId: group.id, actorName, action: 'participant.delete',
        payload: { previous: { id: participant.id, name: participant.name } },
      });
      return ok(undefined);
    });
    if (!result.ok) return result;
    revalidatePath(`/g/${token}`);
    revalidatePath(`/g/${token}/ajustes`);
    return ok(undefined);
  });
}

export async function claimParticipant(token: string, participantId: string): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const participant = await getScopedParticipant(group.id, participantId);
    if (!participant.claimedAt) {
      await prisma.participant.update({ where: { id: participant.id }, data: { claimedAt: new Date() } });
    }
    const cookieStore = await cookies();
    // Convenience identity only — the link is the trust model (spec §4.8).
    cookieStore.set(`participant_${group.id}`, participant.id, {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
    });
    return ok({ name: participant.name });
  });
}

export async function archiveParticipant(token: string, participantId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const participant = await getScopedParticipant(group.id, participantId);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await tx.participant.update({
        where: { id: participant.id },
        data: { archivedAt: new Date() },
      });
      await logActivity(tx, {
        groupId: group.id, actorName, action: 'participant.archive',
        payload: { previous: { id: participant.id, name: participant.name } },
      });
    });
    revalidatePath(`/g/${token}`);
    revalidatePath(`/g/${token}/ajustes`);
    return ok(undefined);
  });
}

export async function unarchiveParticipant(token: string, participantId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const participant = await getScopedParticipant(group.id, participantId);
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await tx.participant.update({
        where: { id: participant.id },
        data: { archivedAt: null },
      });
      await logActivity(tx, {
        groupId: group.id, actorName, action: 'participant.unarchive',
        payload: { previous: { id: participant.id, name: participant.name } },
      });
    });
    revalidatePath(`/g/${token}`);
    revalidatePath(`/g/${token}/ajustes`);
    return ok(undefined);
  });
}
