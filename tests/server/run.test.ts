import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { runAction } from '../../src/server/actions/run';
import { ok } from '../../src/server/action-result';
import { resetDb } from './reset';

describe('runAction', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('maps a foreign-key violation (P2003) to a Spanish failure instead of throwing', async () => {
    const group = await prisma.group.create({
      data: { id: nanoid(24), name: 'Piso', participants: { create: [{ name: 'Ana' }] } },
      include: { participants: true },
    });
    const [ana] = group.participants;
    await prisma.groupCharge.create({
      data: {
        groupId: group.id, concept: 'Luz', amountCents: 1000, date: new Date('2026-07-01T00:00:00.000Z'),
        splitMode: 'EQUAL', shares: { create: [{ participantId: ana.id, shareInput: 1, amountCents: 1000 }] },
      },
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runAction(async () => {
      await prisma.participant.delete({ where: { id: ana.id } });
      return ok(undefined);
    });

    expect(result).toEqual({
      ok: false,
      error: 'Otro cambio en el grupo afecta a estos datos. Recarga la página e inténtalo de nuevo.',
    });
    // The mapped failure is not rethrown, so Next never logs it: runAction must
    // leave a trace (a real bug can look like a race), without the error
    // message, which may carry query arguments such as the group token.
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).toContain('P2003');
    expect(logged).toContain('GroupChargeShare_participantId_fkey');
    expect(logged).not.toContain(group.id);
  });

  it('names the row that vanished (P2025), with the same code-and-meta-only log', async () => {
    const group = await prisma.group.create({
      data: { id: nanoid(24), name: 'Piso', participants: { create: [{ name: 'Ana' }] } },
      include: { participants: true },
    });
    const [ana] = group.participants;
    await prisma.participant.delete({ where: { id: ana.id } });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runAction(async () => {
      await prisma.participant.update({ where: { id: ana.id }, data: { name: group.id } });
      return ok(undefined);
    });

    expect(result).toEqual({ ok: false, error: 'El participante ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).toContain('P2025');
    expect(logged).toContain('Participant');
    expect(logged).not.toContain(group.id);
  });

  it('keeps the general message when the vanished row is nothing a person names (a line of an expense)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runAction(async () => {
      await prisma.expenseItem.delete({ where: { id: 'gone' } });
      return ok(undefined);
    });
    expect(result).toEqual({
      ok: false,
      error: 'Otro cambio en el grupo afecta a estos datos. Recarga la página e inténtalo de nuevo.',
    });
  });

  it('still rethrows unexpected errors to the error boundary', async () => {
    await expect(runAction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
