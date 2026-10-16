'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../db';
import { ok, fail, type ActionResult } from '../action-result';
import { paymentSchema } from '../validation';
import { getGroup, EntityGoneError } from '../group-scope';
import { logActivity } from '../activity';
import { currentActorName } from '../actor';
import { dateStringToDb, dbDateToString } from '../dates';
import { runAction } from './run';

const DUPLICATE_WINDOW_MS = 30_000;

export async function createPayment(token: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    const memberIds = new Set(group.participants.map((p) => p.id));
    // Archived participants are deliberately allowed here — settling up with
    // someone who has since left the group is a normal flow, not an error.
    if (!memberIds.has(parsed.data.fromId) || !memberIds.has(parsed.data.toId)) throw new EntityGoneError('participant');

    // Two-devices-settling-simultaneously race (spec §6): server-side guard,
    // because client-side button disabling cannot see the other device.
    if (!parsed.data.confirmDuplicate) {
      const duplicate = await prisma.payment.findFirst({
        where: {
          groupId: group.id,
          fromId: parsed.data.fromId,
          toId: parsed.data.toId,
          amountCents: parsed.data.amount,
          createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
        },
      });
      if (duplicate) {
        return fail('Se acaba de registrar un pago idéntico. ¿Registrarlo de todos modos?', 'DUPLICATE_PAYMENT');
      }
    }

    const actorName = await currentActorName(group.id);
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          groupId: group.id,
          fromId: parsed.data.fromId,
          toId: parsed.data.toId,
          amountCents: parsed.data.amount,
          date: dateStringToDb(parsed.data.date),
        },
      });
      await logActivity(tx, {
        groupId: group.id, actorName, action: 'payment.create',
        payload: { id: created.id, fromId: created.fromId, toId: created.toId, amountCents: created.amountCents, date: dbDateToString(created.date) },
      });
      return created;
    });
    revalidatePath(`/g/${token}`);
    return ok({ id: payment.id });
  });
}

export async function deletePayment(token: string, paymentId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    const previous = await prisma.payment.findFirst({ where: { id: paymentId, groupId: group.id } });
    if (!previous) throw new EntityGoneError('payment');
    const actorName = await currentActorName(group.id);
    await prisma.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: previous.id } });
      await logActivity(tx, {
        groupId: group.id, actorName, action: 'payment.delete',
        payload: { previous: { id: previous.id, fromId: previous.fromId, toId: previous.toId, amountCents: previous.amountCents, date: dbDateToString(previous.date) } },
      });
    });
    revalidatePath(`/g/${token}`);
    return ok(undefined);
  });
}
