'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { nanoid } from 'nanoid';
import { prisma } from '../db';
import { ok, fail, type ActionResult } from '../action-result';
import { createGroupSchema, ownerlessExtraSchema } from '../validation';
import { allowRequest, clientKey, trustsProxy } from '../rate-limit';
import { logActivity } from '../activity';
import { runAction } from './run';
import { getGroup } from '../group-scope';
import { normalizeText } from '@/domain/text';

export async function createGroup(input: unknown): Promise<ActionResult<{ token: string }>> {
  return runAction(async () => {
    const parsed = createGroupSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);

    const headerStore = await headers();
    if (!allowRequest(clientKey(headerStore.get('x-forwarded-for'), trustsProxy()))) return fail('Demasiadas solicitudes. Inténtalo de nuevo en un minuto.');

    const token = nanoid(24); // 144 bits of CSPRNG entropy — the credential (spec §2.1)
    await prisma.$transaction(async (tx) => {
      await tx.group.create({
        data: {
          id: token,
          name: parsed.data.name,
          participants: { create: parsed.data.participantNames.map((name) => ({ name })) },
        },
      });
      await logActivity(tx, {
        groupId: token,
        actorName: null,
        action: 'group.create',
        payload: { name: parsed.data.name, participants: parsed.data.participantNames },
      });
    });
    return ok({ token });
  });
}

/**
 * Declares (or edits) the group's leftover ("Sobrante", the ownerless extra pool). Stores just the
 * total; how much is left is derived in the read model, so it can never drift.
 */
export async function setOwnerlessExtra(token: string, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const parsed = ownerlessExtraSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const group = await getGroup(token);
    await prisma.group.update({ where: { id: group.id }, data: { ownerlessExtraCents: parsed.data.amount } });
    revalidatePath(`/g/${token}`);
    revalidatePath(`/g/${token}/ajustes`);
    return ok(undefined);
  });
}

export async function deleteGroup(token: string, confirmName: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const group = await getGroup(token);
    // Compared as the name is stored (normalizeText): a pasted name can be typed back.
    if (normalizeText(String(confirmName)) !== group.name) {
      return fail('El nombre escrito no coincide con el nombre del grupo');
    }
    await prisma.$transaction(async (tx) => {
      // Explicit FK-safe order (spec §4.5) — never rely on multi-path cascade ordering.
      await tx.expenseShare.deleteMany({ where: { item: { expense: { groupId: group.id } } } });
      await tx.expensePayer.deleteMany({ where: { expense: { groupId: group.id } } });
      await tx.expenseItem.deleteMany({ where: { expense: { groupId: group.id } } });
      await tx.refund.deleteMany({ where: { groupId: group.id } });
      await tx.expense.deleteMany({ where: { groupId: group.id } });
      // GroupChargeShare → Participant is onDelete: Restrict — clear charges
      // before participants (spec §7.2).
      await tx.groupChargeShare.deleteMany({ where: { charge: { groupId: group.id } } });
      await tx.groupCharge.deleteMany({ where: { groupId: group.id } });
      await tx.payment.deleteMany({ where: { groupId: group.id } });
      // KittyContribution → Participant is onDelete: Restrict — clear the
      // kitty ledger before participants.
      await tx.kittyContribution.deleteMany({ where: { round: { groupId: group.id } } });
      await tx.kittySpend.deleteMany({ where: { round: { groupId: group.id } } });
      await tx.kittyRound.deleteMany({ where: { groupId: group.id } });
      await tx.kitty.deleteMany({ where: { groupId: group.id } });
      await tx.activityLog.deleteMany({ where: { groupId: group.id } });
      await tx.participant.deleteMany({ where: { groupId: group.id } });
      await tx.group.delete({ where: { id: group.id } });
    });
    revalidatePath('/');
    return ok(undefined);
  });
}
