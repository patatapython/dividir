import { describe, it, expect, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '@/server/db';
import { resetDb } from './reset';
import {
  openKittyRound,
  addContributions,
  addSpend,
  closeKittyRound,
  reopenKittyRound,
  renameKittyRound,
  deleteContribution,
  deleteSpend,
  editContribution,
  editSpend,
} from '@/server/actions/kitty';
import { archiveParticipant } from '@/server/actions/participants';

// The group id IS the token (security model). Local helper — mirrors the
// fixture pattern in tests/server/rounds.test.ts; reset.ts only exports resetDb.
async function seedGroup(names: string[]) {
  const group = await prisma.group.create({
    data: { id: nanoid(24), name: 'Bote', participants: { create: names.map((name) => ({ name })) } },
    include: { participants: true },
  });
  return { token: group.id, members: group.participants };
}

/** Single-entry shorthand over the v1.3 bulk action. */
function contribute(token: string, roundId: string, participantId: string, amount: string) {
  return addContributions(token, roundId, { contributions: [{ participantId, amount }] });
}

describe('kitty open/contribute/spend', () => {
  beforeEach(resetDb);

  it('opens a round with carryIn 0 when no preexisting amount is given', async () => {
    const { token } = await seedGroup(['Ana', 'Bea']);
    const res = await openKittyRound(token, { name: 'Sábado' });
    expect(res.ok).toBe(true);
    const round = await prisma.kittyRound.findFirstOrThrow();
    expect(round.carryInCents).toBe(0);
    expect(round.closedAt).toBeNull();
  });

  it('opens a round with a user-entered preexisting bote (even the first round)', async () => {
    const { token } = await seedGroup(['Ana', 'Bea']);
    const res = await openKittyRound(token, { name: 'Sábado', preexisting: '10,00' });
    expect(res.ok).toBe(true);
    const round = await prisma.kittyRound.findFirstOrThrow();
    expect(round.carryInCents).toBe(1000);
  });

  it('rejects a second open round', async () => {
    const { token } = await seedGroup(['Ana']);
    await openKittyRound(token, {});
    const res = await openKittyRound(token, {});
    expect(res.ok).toBe(false);
  });

  it('rejects a spend that exceeds available balance (invariant ≥ 0)', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const open = await openKittyRound(token, {});
    if (!open.ok) throw new Error('open failed'); // narrows to { ok: true; data }
    await contribute(token, open.data.id, members[0].id, '20,00');
    const res = await addSpend(token, open.data.id, { concept: 'Cañas', amount: '25,00' });
    expect(res.ok).toBe(false);
    const ok = await addSpend(token, open.data.id, { concept: 'Cañas', amount: '15,00' });
    expect(ok.ok).toBe(true);
  });

  it('the preexisting bote counts toward the spendable balance', async () => {
    const { token } = await seedGroup(['Ana']);
    const open = await openKittyRound(token, { preexisting: '10,00' });
    if (!open.ok) throw new Error('open failed');
    const res = await addSpend(token, open.data.id, { concept: 'Hielo', amount: '8,00' });
    expect(res.ok).toBe(true);
    const over = await addSpend(token, open.data.id, { concept: 'Más hielo', amount: '3,00' });
    expect(over.ok).toBe(false); // 10 − 8 = 2 < 3
  });

  it("scopes by group: cannot contribute to another group's round", async () => {
    const a = await seedGroup(['Ana']);
    const b = await seedGroup(['Bob']);
    const open = await openKittyRound(a.token, {});
    if (!open.ok) throw new Error('open failed');
    const cross = await contribute(b.token, open.data.id, b.members[0].id, '5,00');
    expect(cross).toEqual({ ok: false, error: 'La ronda del bote ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
  });
});

describe('kitty bulk contributions (v1.3)', () => {
  beforeEach(resetDb);

  it('creates one row per entry atomically and logs a single activity entry', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea', 'Caz']);
    const open = await openKittyRound(token, {});
    if (!open.ok) throw new Error('open failed');
    const res = await addContributions(token, open.data.id, {
      contributions: members.map((m) => ({ participantId: m.id, amount: '10,00' })),
    });
    expect(res.ok).toBe(true);
    expect(await prisma.kittyContribution.count()).toBe(3);
    const logs = await prisma.activityLog.findMany({ where: { action: 'kitty.contribute' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].payload).toMatchObject({ op: 'bulk', totalCents: 3000 });
  });

  it('is atomic: one archived participant in the batch creates zero rows', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const open = await openKittyRound(token, {});
    if (!open.ok) throw new Error('open failed');
    await archiveParticipant(token, members[1].id);
    const res = await addContributions(token, open.data.id, {
      contributions: [
        { participantId: members[0].id, amount: '10,00' },
        { participantId: members[1].id, amount: '10,00' },
      ],
    });
    expect(res).toMatchObject({ ok: false, error: 'No se puede usar un participante archivado' });
    expect(await prisma.kittyContribution.count()).toBe(0);
  });

  it('rejects an empty batch', async () => {
    const { token } = await seedGroup(['Ana']);
    const open = await openKittyRound(token, {});
    if (!open.ok) throw new Error('open failed');
    const res = await addContributions(token, open.data.id, { contributions: [] });
    expect(res.ok).toBe(false);
  });
});

describe('kitty close', () => {
  beforeEach(resetDb);

  async function open(token: string, preexisting?: string) {
    const r = await openKittyRound(token, preexisting ? { preexisting } : {});
    if (!r.ok) throw new Error('open failed');
    return r.data.id;
  }

  it('CERRAR closes the round; the leftover is informational, nothing is stored or carried', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const id = await open(token);
    await contribute(token, id, members[0].id, '20,00');
    await contribute(token, id, members[1].id, '20,00');
    await addSpend(token, id, { concept: 'Cena', amount: '30,00' });
    const res = await closeKittyRound(token, id, { action: 'CERRAR' });
    expect(res.ok).toBe(true);
    const round = await prisma.kittyRound.findUniqueOrThrow({ where: { id } });
    expect(round.closeAction).toBe('CERRAR');
    expect(round.closedAt).not.toBeNull();
    expect(round.payoutSnapshot).toBeNull();
    // Nothing carries: the next round starts at whatever the user says (default 0).
    const next = await openKittyRound(token, {});
    if (!next.ok) throw new Error('open failed');
    const nextRound = await prisma.kittyRound.findUniqueOrThrow({ where: { id: next.data.id } });
    expect(nextRound.carryInCents).toBe(0);
  });

  it('REPARTIR distributes the whole balance, freezes the snapshot and empties the round', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const id = await open(token);
    await contribute(token, id, members[0].id, '20,00');
    await contribute(token, id, members[1].id, '20,00');
    await addSpend(token, id, { concept: 'Cena', amount: '30,00' });
    const res = await closeKittyRound(token, id, { action: 'REPARTIR' });
    expect(res.ok).toBe(true);
    const round = await prisma.kittyRound.findUnique({ where: { id } });
    expect(round?.closeAction).toBe('REPARTIR');
    const snap = round?.payoutSnapshot as { participantId: string; amountCents: number }[];
    expect(snap.reduce((a, p) => a + p.amountCents, 0)).toBe(1000); // 5,00 each
  });

  it('REPARTIR with no contributions fails', async () => {
    const { token } = await seedGroup(['Ana']);
    const id = await open(token);
    const res = await closeKittyRound(token, id, { action: 'REPARTIR' });
    expect(res.ok).toBe(false);
  });

  it('REPARTIR with the bote at 0 fails and leaves the round open (session 12)', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const id = await open(token);
    await contribute(token, id, members[0].id, '10,00');
    await addSpend(token, id, { concept: 'Hielo', amount: '10,00' });
    const res = await closeKittyRound(token, id, { action: 'REPARTIR' });
    expect(res).toEqual({ ok: false, error: 'No hay nada que repartir' });
    const round = await prisma.kittyRound.findUniqueOrThrow({ where: { id } });
    expect(round.closedAt).toBeNull();
    expect(await prisma.activityLog.count({ where: { action: 'kitty.close' } })).toBe(0);
    // Closing without distributing stays available.
    expect((await closeKittyRound(token, id, { action: 'CERRAR' })).ok).toBe(true);
  });

  it('REABRIR: a closed round reopens, is editable again, and a REPARTIR snapshot is wiped', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const id = await open(token);
    await contribute(token, id, members[0].id, '20,00');
    await contribute(token, id, members[1].id, '20,00');
    await closeKittyRound(token, id, { action: 'REPARTIR' });

    const reopened = await reopenKittyRound(token, id);
    expect(reopened.ok).toBe(true);
    const round = await prisma.kittyRound.findUniqueOrThrow({ where: { id } });
    expect(round.closedAt).toBeNull();
    expect(round.closeAction).toBeNull();
    expect(round.payoutSnapshot).toBeNull();

    // Ordinary open-round machinery works again: fix a mistake and re-close.
    const contribution = await prisma.kittyContribution.findFirstOrThrow({ where: { participantId: members[1].id } });
    const edited = await editContribution(token, contribution.id, { participantId: members[1].id, amount: '10,00' });
    expect(edited.ok).toBe(true);
    const closed = await closeKittyRound(token, id, { action: 'CERRAR' });
    expect(closed.ok).toBe(true);
  });

  it('REABRIR is rejected while the group has an open round (single-open-round invariant)', async () => {
    const { token, members } = await seedGroup(['Ana']);
    const first = await open(token);
    await contribute(token, first, members[0].id, '10,00');
    await closeKittyRound(token, first, { action: 'CERRAR' });
    await open(token); // a second, still-open round

    const res = await reopenKittyRound(token, first);
    expect(res).toMatchObject({ ok: false, error: 'Ya hay una ronda abierta' });
    expect((await prisma.kittyRound.findUniqueOrThrow({ where: { id: first } })).closedAt).not.toBeNull();
  });

  it('REABRIR scopes by group: a round id from group A cannot be reopened via group B token', async () => {
    const a = await seedGroup(['Ana']);
    const b = await seedGroup(['Bob']);
    const id = await open(a.token);
    await contribute(a.token, id, a.members[0].id, '10,00');
    await closeKittyRound(a.token, id, { action: 'CERRAR' });
    const cross = await reopenKittyRound(b.token, id);
    expect(cross).toEqual({ ok: false, error: 'La ronda del bote ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
    expect((await prisma.kittyRound.findUniqueOrThrow({ where: { id } })).closedAt).not.toBeNull();
  });

  it('REPARTIR includes the user-entered preexisting bote in the payout', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea', 'Caz', 'Dan', 'Eva']);
    // Preexisting 15 + contributions 60 − spends 50 = 25 → 5,00 each among 5 equal contributors.
    const id = await open(token, '15,00');
    for (const m of members) await contribute(token, id, m.id, '12,00'); // 5×12 = 60
    await addSpend(token, id, { concept: 'Bar', amount: '50,00' });
    const res = await closeKittyRound(token, id, { action: 'REPARTIR' });
    expect(res.ok).toBe(true);
    const round = await prisma.kittyRound.findUnique({ where: { id } });
    const snap = round?.payoutSnapshot as { amountCents: number }[];
    expect(snap.every((p) => p.amountCents === 500)).toBe(true);
  });
});

describe('kitty edit/delete contribution & spend', () => {
  beforeEach(resetDb);

  async function openWith(token: string) {
    const r = await openKittyRound(token, {});
    if (!r.ok) throw new Error('open failed');
    return r.data.id;
  }

  it('deleting a spend frees balance: a previously-rejected spend now succeeds', async () => {
    const { token, members } = await seedGroup(['Ana']);
    const id = await openWith(token);
    await contribute(token, id, members[0].id, '20,00');
    await addSpend(token, id, { concept: 'Cena', amount: '20,00' }); // balance now 0
    const spend = await prisma.kittySpend.findFirstOrThrow();
    const rejected = await addSpend(token, id, { concept: 'Copa', amount: '5,00' });
    expect(rejected.ok).toBe(false);
    const del = await deleteSpend(token, spend.id);
    expect(del.ok).toBe(true);
    const now = await addSpend(token, id, { concept: 'Copa', amount: '5,00' });
    expect(now.ok).toBe(true);
  });

  it('editing a spend re-checks the balance invariant (available + old)', async () => {
    const { token, members } = await seedGroup(['Ana']);
    const id = await openWith(token);
    await contribute(token, id, members[0].id, '20,00');
    await addSpend(token, id, { concept: 'Cena', amount: '10,00' }); // balance 10
    const spend = await prisma.kittySpend.findFirstOrThrow();
    const within = await editSpend(token, spend.id, { concept: 'Cena', amount: '20,00' }); // 20 <= 10 + 10
    expect(within.ok).toBe(true);
    const over = await editSpend(token, spend.id, { concept: 'Cena', amount: '25,00' }); // 25 > 0 + 20
    expect(over.ok).toBe(false);
  });

  it('deleting a contribution that a spend already consumed is rejected (invariant ≥ 0)', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const id = await openWith(token);
    await contribute(token, id, members[0].id, '20,00');
    await addSpend(token, id, { concept: 'Cena', amount: '15,00' }); // balance 5
    const contribution = await prisma.kittyContribution.findFirstOrThrow();
    const res = await deleteContribution(token, contribution.id); // would drop to -15
    expect(res.ok).toBe(false);
  });

  it('deleting a contribution that keeps balance ≥ 0 succeeds', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const id = await openWith(token);
    await contribute(token, id, members[0].id, '20,00');
    const extra = members[1].id;
    await contribute(token, id, extra, '10,00');
    await addSpend(token, id, { concept: 'Cena', amount: '5,00' }); // balance 25
    const contribution = await prisma.kittyContribution.findFirstOrThrow({ where: { participantId: extra } });
    const res = await deleteContribution(token, contribution.id); // 25 - 10 = 15 ≥ 0
    expect(res.ok).toBe(true);
  });

  it('editing a contribution below what is already spent is rejected', async () => {
    const { token, members } = await seedGroup(['Ana']);
    const id = await openWith(token);
    await contribute(token, id, members[0].id, '20,00');
    await addSpend(token, id, { concept: 'Cena', amount: '15,00' }); // balance 5
    const contribution = await prisma.kittyContribution.findFirstOrThrow();
    const res = await editContribution(token, contribution.id, { participantId: members[0].id, amount: '10,00' }); // 5 - 20 + 10 = -5
    expect(res.ok).toBe(false);
    const ok = await editContribution(token, contribution.id, { participantId: members[0].id, amount: '18,00' }); // 5 - 20 + 18 = 3
    expect(ok.ok).toBe(true);
  });

  it('edit/delete on a closed round fails', async () => {
    const { token, members } = await seedGroup(['Ana']);
    const id = await openWith(token);
    await contribute(token, id, members[0].id, '20,00');
    await addSpend(token, id, { concept: 'Cena', amount: '5,00' });
    const contribution = await prisma.kittyContribution.findFirstOrThrow();
    const spend = await prisma.kittySpend.findFirstOrThrow();
    await closeKittyRound(token, id, { action: 'CERRAR' });
    expect((await deleteContribution(token, contribution.id)).ok).toBe(false);
    expect((await deleteSpend(token, spend.id)).ok).toBe(false);
    expect((await editSpend(token, spend.id, { concept: 'X', amount: '1,00' })).ok).toBe(false);
  });

  it('JD-2: grandfathers an amount-only edit when the contribution author was archived afterward', async () => {
    const { token, members } = await seedGroup(['Ana']);
    const id = await openWith(token);
    const contributed = await contribute(token, id, members[0].id, '10,00');
    expect(contributed.ok).toBe(true);
    const archived = await archiveParticipant(token, members[0].id);
    expect(archived.ok).toBe(true);
    const contribution = await prisma.kittyContribution.findFirstOrThrow();

    const res = await editContribution(token, contribution.id, { participantId: members[0].id, amount: '15,00' });
    expect(res.ok).toBe(true);
    const updated = await prisma.kittyContribution.findUniqueOrThrow({ where: { id: contribution.id } });
    expect(updated.amountCents).toBe(1500);
  });

  it('JD-2: rejects switching a contribution to a DIFFERENT archived participant', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const id = await openWith(token);
    const contributed = await contribute(token, id, members[0].id, '10,00');
    expect(contributed.ok).toBe(true);
    const archived = await archiveParticipant(token, members[1].id);
    expect(archived.ok).toBe(true);
    const contribution = await prisma.kittyContribution.findFirstOrThrow();

    const res = await editContribution(token, contribution.id, { participantId: members[1].id, amount: '10,00' });
    expect(res).toMatchObject({ ok: false, error: 'No se puede usar un participante archivado' });
  });

  it('is group-scoped: a spend id from group A cannot be deleted via group B token', async () => {
    const a = await seedGroup(['Ana']);
    const b = await seedGroup(['Bob']);
    const id = await openWith(a.token);
    await contribute(a.token, id, a.members[0].id, '20,00');
    await addSpend(a.token, id, { concept: 'Cena', amount: '5,00' });
    const spend = await prisma.kittySpend.findFirstOrThrow();
    const cross = await deleteSpend(b.token, spend.id);
    expect(cross).toEqual({ ok: false, error: 'El gasto del bote ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
  });

  it('T-72: a contribution deleted from another device is reported as gone, not as a missing group', async () => {
    const a = await seedGroup(['Ana']);
    const id = await openWith(a.token);
    await contribute(a.token, id, a.members[0].id, '20,00');
    const contribution = await prisma.kittyContribution.findFirstOrThrow();
    expect((await deleteContribution(a.token, contribution.id)).ok).toBe(true);
    expect(await deleteContribution(a.token, contribution.id)).toEqual({ ok: false, error: 'El aporte ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
  });
});

describe('kitty concurrency (atomic guards)', () => {
  beforeEach(resetDb);

  it('two concurrent opens create exactly one round', async () => {
    const { token } = await seedGroup(['Ana', 'Bea']);
    const [r1, r2] = await Promise.all([
      openKittyRound(token, {}),
      openKittyRound(token, {}),
    ]);
    expect([r1, r2].filter((r) => r.ok).length).toBe(1);
    expect(await prisma.kittyRound.count()).toBe(1);
  });

  it('two concurrent spends cannot overspend the balance (invariant ≥ 0)', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const open = await openKittyRound(token, {});
    if (!open.ok) throw new Error('open failed');
    await contribute(token, open.data.id, members[0].id, '10,00');
    const [r1, r2] = await Promise.all([
      addSpend(token, open.data.id, { concept: 'A', amount: '8,00' }),
      addSpend(token, open.data.id, { concept: 'B', amount: '8,00' }),
    ]);
    // Only one 8,00 spend fits in a 10,00 balance; the lock serializes them.
    expect([r1, r2].filter((r) => r.ok).length).toBe(1);
    const spent = (await prisma.kittySpend.findMany()).reduce((a, s) => a + s.amountCents, 0);
    expect(spent).toBeLessThanOrEqual(1000); // balance never went negative
  });
});

describe('kitty round rename (T-100)', () => {
  beforeEach(resetDb);

  async function open(token: string, name?: string) {
    const r = await openKittyRound(token, name === undefined ? {} : { name });
    if (!r.ok) throw new Error('open failed');
    return r.data.id;
  }

  it('renames an open round, cleaned like every free text, and logs the previous name', async () => {
    const { token } = await seedGroup(['Ana', 'Bea']);
    const id = await open(token, 'Gastos inciales');
    const res = await renameKittyRound(token, id, { name: '  Gastos\u2060  iniciales ' });
    expect(res).toEqual({ ok: true, data: undefined });
    expect((await prisma.kittyRound.findUniqueOrThrow({ where: { id } })).name).toBe('Gastos iniciales');
    const entry = await prisma.activityLog.findFirstOrThrow({ where: { action: 'kitty.rename' } });
    expect(entry.payload).toEqual({ roundId: id, previous: { name: 'Gastos inciales' }, name: 'Gastos iniciales' });
  });

  it('renames a closed round without reopening it: its money stays frozen', async () => {
    const { token, members } = await seedGroup(['Ana', 'Bea']);
    const id = await open(token, 'Agsto');
    await contribute(token, id, members[0].id, '10,00');
    await contribute(token, id, members[1].id, '30,00');
    await closeKittyRound(token, id, { action: 'REPARTIR' });
    const before = await prisma.kittyRound.findUniqueOrThrow({ where: { id } });

    expect((await renameKittyRound(token, id, { name: 'Agosto' })).ok).toBe(true);
    const after = await prisma.kittyRound.findUniqueOrThrow({ where: { id } });
    expect(after.name).toBe('Agosto');
    expect({ ...after, name: before.name }).toEqual(before);
  });

  it('refuses an empty name and changes nothing', async () => {
    const { token } = await seedGroup(['Ana']);
    const id = await open(token, 'Sábado');
    expect(await renameKittyRound(token, id, { name: ' \u2060 ' })).toEqual({ ok: false, error: 'El nombre de la ronda no puede estar vacío' });
    expect((await prisma.kittyRound.findUniqueOrThrow({ where: { id } })).name).toBe('Sábado');
    expect(await prisma.activityLog.count({ where: { action: 'kitty.rename' } })).toBe(0);
  });

  it('the same name again is not a change: nothing is logged', async () => {
    const { token } = await seedGroup(['Ana']);
    const id = await open(token, 'Sábado');
    expect((await renameKittyRound(token, id, { name: 'Sábado ' })).ok).toBe(true);
    expect(await prisma.activityLog.count({ where: { action: 'kitty.rename' } })).toBe(0);
  });

  it("scopes by group: another group's round cannot be renamed", async () => {
    const a = await seedGroup(['Ana']);
    const b = await seedGroup(['Bob']);
    const id = await open(a.token, 'Sábado');
    expect(await renameKittyRound(b.token, id, { name: 'Robado' })).toEqual({ ok: false, error: 'La ronda del bote ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
    expect((await prisma.kittyRound.findUniqueOrThrow({ where: { id } })).name).toBe('Sábado');
  });

  it('a round opened with a blank name is called "Ronda", as one opened with none', async () => {
    const { token } = await seedGroup(['Ana']);
    const id = await open(token, ' \u2060 ');
    expect((await prisma.kittyRound.findUniqueOrThrow({ where: { id } })).name).toBe('Ronda');
  });
});
