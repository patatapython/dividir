import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense } from '../../src/server/actions/expenses';
import { createPayment } from '../../src/server/actions/payments';
import { createRefund } from '../../src/server/actions/refunds';
import { getActivity, getClosedRound, getClosedRounds, getExpenseForEdit, getGroupOverview, getKittyView, getSettingsView } from '../../src/server/queries';
import { openKittyRound, addContributions, addSpend, closeKittyRound } from '../../src/server/actions/kitty';
import { getGroup } from '../../src/server/group-scope';
import { setOwnerlessExtra } from '../../src/server/actions/group';
import { createGroupCharge, deleteGroupCharge } from '../../src/server/actions/group-charge';
import { resetDb } from './reset';

async function seedScenario() {
  const group = await prisma.group.create({
    data: { id: nanoid(24), name: 'Viaje', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] } },
    include: { participants: true },
  });
  const [ana, beto, carla] = group.participants;
  await createExpense(group.id, {
    title: 'Hotel', date: '2026-07-01',
    payers: [{ participantId: ana.id, amount: '30,00' }],
    items: [{
      amount: '30,00', splitMode: 'EQUAL',
      shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })),
    }],
  });
  await createPayment(group.id, { fromId: beto.id, toId: ana.id, amount: '10,00', date: '2026-07-02' });
  return { group, ana, beto, carla };
}

describe('getGroupOverview', () => {
  beforeEach(resetDb);

  it('returns balances that the plan settles to zero', async () => {
    const { group, ana, beto, carla } = await seedScenario();
    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');
    const byId = new Map(overview.balances.map((b) => [b.participantId, b.balanceCents]));
    expect(byId.get(ana.id)).toBe(1000); // paid 3000, owes 1000, received 1000
    expect(byId.get(beto.id)).toBe(0); // owed -1000, paid 1000
    expect(byId.get(carla.id)).toBe(-1000);
    expect(overview.plan).toEqual([
      { fromId: carla.id, fromName: 'Carla', toId: ana.id, toName: 'Ana', amountCents: 1000 },
    ]);
    expect(overview.balances.reduce((acc, b) => acc + b.balanceCents, 0)).toBe(0);
  });

  it('feed merges expenses and payments, newest date first', async () => {
    const { group } = await seedScenario();
    const overview = await getGroupOverview(group.id);
    expect(overview?.feed.map((f) => f.kind)).toEqual(['payment', 'expense']);
    expect(overview?.feed[1]).toMatchObject({ title: 'Hotel', amountCents: 3000, date: '2026-07-01' });
  });

  it('returns null for an unknown token', async () => {
    expect(await getGroupOverview('x'.repeat(24))).toBeNull();
  });

  it('feed order is total: rows tied on date and createdAt fall back to id, so "Ver más" pages never shift', async () => {
    const { group, ana, beto } = await seedScenario();
    const at = new Date('2026-07-05T10:00:00Z');
    const date = new Date('2026-07-05T00:00:00Z');
    await prisma.payment.createMany({
      data: ['p-b', 'p-c', 'p-a'].map((id) => ({ id, groupId: group.id, fromId: beto.id, toId: ana.id, amountCents: 100, date, createdAt: at })),
    });
    const overview = await getGroupOverview(group.id);
    expect(overview?.feed.slice(0, 3).map((f) => f.id)).toEqual(['p-c', 'p-b', 'p-a']);
  });
});

describe('getExpenseForEdit / getActivity', () => {
  beforeEach(resetDb);

  it('re-opens the original form faithfully (shareInput, not amounts)', async () => {
    const { group } = await seedScenario();
    const expense = await prisma.expense.findFirstOrThrow();
    const forEdit = await getExpenseForEdit(group.id, expense.id);
    expect(forEdit).toMatchObject({ title: 'Hotel', date: '2026-07-01' });
    expect(forEdit?.items[0].shares.every((s) => s.shareInput === 1)).toBe(true);
    // §2.1: wrong group token → null
    const other = await prisma.group.create({ data: { id: nanoid(24), name: 'Otro' } });
    expect(await getExpenseForEdit(other.id, expense.id)).toBeNull();
  });

  it('activity is newest-first and says what, how much and who', async () => {
    const { group } = await seedScenario();
    const activity = await getActivity(group.id, 50);
    expect(activity?.entries.map((a) => a.action)).toEqual(['payment.create', 'expense.create']);
    expect(activity?.entries[0]).toMatchObject({ label: 'registró un pago', detail: 'Beto → Ana', amountCents: 1000, target: null });
    expect(activity?.entries[1]).toMatchObject({ label: 'añadió un gasto', subject: 'Hotel', detail: 'pagó Ana', amountCents: 3000 });
  });

  it('an entry links to its entity only while it exists', async () => {
    const { group } = await seedScenario();
    const expense = await prisma.expense.findFirstOrThrow({ where: { groupId: group.id } });
    const linked = await getActivity(group.id, 50);
    expect(linked?.entries.find((e) => e.action === 'expense.create')?.target).toEqual({ kind: 'expense', id: expense.id });

    await prisma.expense.delete({ where: { id: expense.id } });
    const gone = await getActivity(group.id, 50);
    expect(gone?.entries.find((e) => e.action === 'expense.create')?.target).toBeNull();
  });

  it('never links to another group\'s entity, even if a payload names it (§2.1)', async () => {
    const { group } = await seedScenario();
    const other = await seedScenario();
    const foreign = await prisma.expense.findFirstOrThrow({ where: { groupId: other.group.id } });
    await prisma.activityLog.create({
      data: { groupId: group.id, action: 'expense.create', payload: { id: foreign.id, title: 'Ajeno', amountCents: 1 } },
    });
    const activity = await getActivity(group.id, 50);
    expect(activity?.entries.find((e) => e.subject === 'Ajeno')?.target).toBeNull();
  });

  it('a gasto sin pagar entry links to it only while it exists', async () => {
    const { group, ana, beto } = await seedScenario();
    const created = await createGroupCharge(group.id, {
      concept: 'Luz', date: '2026-07-03', amount: '30,00', splitMode: 'EQUAL',
      shares: [ana, beto].map((p) => ({ participantId: p.id, shareInput: 1 })),
    });
    if (!created.ok) throw new Error(created.error);
    const linked = await getActivity(group.id, 50);
    expect(linked?.entries.find((e) => e.action === 'charge.create')?.target).toEqual({ kind: 'charge', id: created.data.id });

    await deleteGroupCharge(group.id, created.data.id);
    const gone = await getActivity(group.id, 50);
    expect(gone?.entries.find((e) => e.action === 'charge.create')?.target).toBeNull();
  });

  it('bote entries lead to the open round or to the closed ones', async () => {
    const { group, ana } = await seedScenario();
    const opened = await openKittyRound(group.id, { name: 'Agosto' });
    if (!opened.ok) throw new Error(opened.error);
    const round = await prisma.kittyRound.findFirstOrThrow({ where: { groupId: group.id } });
    await addContributions(group.id, round.id, { contributions: [{ participantId: ana.id, amount: '10,00' }] });

    const open = await getActivity(group.id, 50);
    expect(open?.entries.find((e) => e.action === 'kitty.contribute')?.target).toEqual({ kind: 'kitty', roundId: round.id, closed: false });

    await closeKittyRound(group.id, round.id, { action: 'CERRAR' });
    const closed = await getActivity(group.id, 50);
    // Session 12: a closed round's entries lead to that round's own page, not to the
    // first page of Cerradas (where an older round is not shown).
    expect(closed?.entries.filter((e) => e.action.startsWith('kitty.')).map((e) => e.target)).toEqual([
      { kind: 'kitty', roundId: round.id, closed: true },
      { kind: 'kitty', roundId: round.id, closed: true },
      { kind: 'kitty', roundId: round.id, closed: true },
    ]);
    // The close entry names its round, as reopening does.
    expect(closed?.entries.find((e) => e.action === 'kitty.close')?.subject).toBe('Agosto');
  });

  it('activity returns the newest `limit` entries and the group total, scoped to the group', async () => {
    const { group } = await seedScenario();
    await seedScenario(); // another group's log must not leak into the count
    const activity = await getActivity(group.id, 1);
    expect(activity?.entries.map((a) => a.action)).toEqual(['payment.create']);
    expect(activity?.total).toBe(2);
  });
});

describe('read-only view extensions (UI redesign §1)', () => {
  beforeEach(resetDb);

  it('exposes refunds on ExpenseForEdit', async () => {
    const { group, ana } = await seedScenario();
    const expense = await prisma.expense.findFirstOrThrow();
    const created = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '5,00' });
    expect(created.ok).toBe(true);

    const forEdit = await getExpenseForEdit(group.id, expense.id);
    expect(forEdit!.refunds).toHaveLength(1);
    expect(forEdit!.refunds[0]).toMatchObject({ receivedById: ana.id, amountCents: 500 });
    expect(forEdit!.refunds[0].receivedByName).toBeTruthy();
  });
});

describe('getSettingsView', () => {
  beforeEach(resetDb);

  it('lists all participants and reports movements, without balance math', async () => {
    const { group } = await seedScenario();
    const view = await getSettingsView(group.id);
    expect(view?.groupName).toBe('Viaje');
    expect(view?.participants.map((p) => p.name).sort()).toEqual(['Ana', 'Beto', 'Carla']);
    expect(view?.hasMovements).toBe(true);
  });

  it('hasMovements is false for a group with no expenses or payments', async () => {
    const group = await prisma.group.create({
      data: { id: nanoid(24), name: 'Nuevo', participants: { create: [{ name: 'Ana' }, { name: 'Bea' }] } },
    });
    const view = await getSettingsView(group.id);
    expect(view?.hasMovements).toBe(false);
  });

  it('carries the declared leftover and what is left of it (Ajustes is where it is declared)', async () => {
    const { group, ana, beto } = await seedScenario();
    await setOwnerlessExtra(group.id, { amount: '50,00' });
    await createExpense(group.id, {
      title: 'Cena', date: '2026-07-03',
      payers: [{ participantId: null, amount: '20,00' }],
      items: [{ amount: '20,00', splitMode: 'EQUAL', shares: [ana, beto].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    const view = await getSettingsView(group.id);
    expect(view?.ownerless).toEqual({ declaredCents: 5000, appliedCents: 2000, remainingCents: 3000 });
  });

  it('returns null for an unknown token', async () => {
    expect(await getSettingsView('x'.repeat(24))).toBeNull();
  });
});

describe('getKittyView', () => {
  beforeEach(resetDb);

  it('returns null for an unknown token, like every other view', async () => {
    expect(await getKittyView(nanoid(24))).toBeNull();
  });

  it('reports the open round balance (preexisting + contribution − spend)', async () => {
    const group = await prisma.group.create({
      data: { id: nanoid(24), name: 'Bote', participants: { create: [{ name: 'Ana' }, { name: 'Bea' }] } },
      include: { participants: true },
    });
    const open = await openKittyRound(group.id, { name: 'Sábado', preexisting: '5,00' });
    if (!open.ok) throw new Error('open failed');
    await addContributions(group.id, open.data.id, { contributions: [{ participantId: group.participants[0].id, amount: '20,00' }] });
    await addSpend(group.id, open.data.id, { concept: 'Cena', amount: '5,00' });

    const view = (await getKittyView(group.id))!;
    expect(view.openRound?.carryInCents).toBe(500);
    expect(view.openRound?.balanceCents).toBe(2000); // 5 + 20 − 5
    expect(view.openRound?.contributions[0]).toMatchObject({ participantName: 'Ana', amountCents: 2000 });
    expect(view.openRound?.spends[0]).toMatchObject({ concept: 'Cena', amountCents: 500 });
  });

  it('closed CERRAR rounds expose an informational leftoverCents; REPARTIR rounds expose 0', async () => {
    const group = await prisma.group.create({
      data: { id: nanoid(24), name: 'Bote', participants: { create: [{ name: 'Ana' }] } },
      include: { participants: true },
    });
    const ana = group.participants[0];
    // Round 1: 20 in, 15 out → CERRAR → leftover 5 (informational).
    const r1 = await openKittyRound(group.id, { name: 'Sábado' });
    if (!r1.ok) throw new Error('open failed');
    await addContributions(group.id, r1.data.id, { contributions: [{ participantId: ana.id, amount: '20,00' }] });
    await addSpend(group.id, r1.data.id, { concept: 'Cena', amount: '15,00' });
    await closeKittyRound(group.id, r1.data.id, { action: 'CERRAR' });
    // Round 2: 10 in → REPARTIR → leftover 0 by definition.
    const r2 = await openKittyRound(group.id, { name: 'Domingo' });
    if (!r2.ok) throw new Error('open failed');
    await addContributions(group.id, r2.data.id, { contributions: [{ participantId: ana.id, amount: '10,00' }] });
    await closeKittyRound(group.id, r2.data.id, { action: 'REPARTIR' });

    const view = (await getClosedRounds(group.id, 20))!;
    const byName = new Map(view.rounds.map((r) => [r.name, r]));
    expect(byName.get('Sábado')).toMatchObject({ closeAction: 'CERRAR', leftoverCents: 500, payout: null });
    expect(byName.get('Domingo')).toMatchObject({ closeAction: 'REPARTIR', leftoverCents: 0 });
  });

  it('closed rounds expose their full sheet: carryIn, named contributions and spends', async () => {
    const group = await prisma.group.create({
      data: { id: nanoid(24), name: 'Bote', participants: { create: [{ name: 'Ana' }, { name: 'Bea' }] } },
      include: { participants: true },
    });
    const [ana, bea] = group.participants;
    const r = await openKittyRound(group.id, { name: 'Sábado', preexisting: '5,00' });
    if (!r.ok) throw new Error('open failed');
    await addContributions(group.id, r.data.id, {
      contributions: [
        { participantId: ana.id, amount: '20,00' },
        { participantId: bea.id, amount: '10,00' },
      ],
    });
    await addSpend(group.id, r.data.id, { concept: 'Cena', amount: '15,00' });
    await closeKittyRound(group.id, r.data.id, { action: 'CERRAR' });

    const round = (await getClosedRounds(group.id, 20))!.rounds[0];
    expect(round.carryInCents).toBe(500);
    expect(round.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantName: 'Ana', amountCents: 2000 }),
        expect.objectContaining({ participantName: 'Bea', amountCents: 1000 }),
      ]),
    );
    expect(round.spends).toEqual([expect.objectContaining({ concept: 'Cena', amountCents: 1500 })]);
    expect(round.leftoverCents).toBe(2000); // 5 + 30 − 15
  });
});

describe('getClosedRounds', () => {
  beforeEach(resetDb);

  it('returns null for an unknown token', async () => {
    expect(await getClosedRounds(nanoid(24), 20)).toBeNull();
  });

  // A bote used every weekend passes 20 rounds in half a year: the older ones were
  // silently out of reach (no view, no reopen) — session 11 simulation, F-04.
  it('pages every closed round, newest first, and says how many there are', async () => {
    const group = await prisma.group.create({
      data: { id: nanoid(24), name: 'Bote', participants: { create: [{ name: 'Ana' }] } },
      include: { participants: true },
    });
    const ana = group.participants[0];
    for (let i = 1; i <= 23; i++) {
      const round = await openKittyRound(group.id, { name: `Quedada ${i}` });
      if (!round.ok) throw new Error(round.error);
      await addContributions(group.id, round.data.id, { contributions: [{ participantId: ana.id, amount: '5,00' }] });
      await closeKittyRound(group.id, round.data.id, { action: i % 2 ? 'CERRAR' : 'REPARTIR' });
    }
    await openKittyRound(group.id, { name: 'Abierta' });

    const first = (await getClosedRounds(group.id, 20))!;
    expect(first.total).toBe(23);
    expect(first.hasOpenRound).toBe(true);
    expect(first.rounds.map((r) => r.name)).toEqual(Array.from({ length: 20 }, (_, i) => `Quedada ${23 - i}`));
    const all = (await getClosedRounds(group.id, 40))!;
    expect(all.rounds.map((r) => r.name).slice(0, 20)).toEqual(first.rounds.map((r) => r.name));
    expect(all.rounds.at(-1)?.name).toBe('Quedada 1');
  });
});

describe('getClosedRound', () => {
  beforeEach(resetDb);

  it('reads one closed round of the group, with its full sheet', async () => {
    const { group, ana } = await seedScenario();
    const opened = await openKittyRound(group.id, { name: 'Agosto' });
    if (!opened.ok) throw new Error(opened.error);
    await addContributions(group.id, opened.data.id, { contributions: [{ participantId: ana.id, amount: '10,00' }] });
    await closeKittyRound(group.id, opened.data.id, { action: 'REPARTIR' });
    await openKittyRound(group.id, { name: 'Septiembre' });

    const page = (await getClosedRound(group.id, opened.data.id))!;
    expect(page.hasOpenRound).toBe(true);
    expect(page.round).toMatchObject({ id: opened.data.id, name: 'Agosto', closeAction: 'REPARTIR' });
    expect(page.round.contributions).toEqual([expect.objectContaining({ participantName: 'Ana', amountCents: 1000 })]);
  });

  it('is null for an open round, another group\'s round or an unknown token (spec §2.1)', async () => {
    const { group, ana } = await seedScenario();
    const other = await seedScenario();
    const mine = await openKittyRound(group.id, { name: 'Abierta' });
    if (!mine.ok) throw new Error(mine.error);
    const theirs = await openKittyRound(other.group.id, { name: 'Ajena' });
    if (!theirs.ok) throw new Error(theirs.error);
    await addContributions(other.group.id, theirs.data.id, { contributions: [{ participantId: other.ana.id, amount: '5,00' }] });
    await closeKittyRound(other.group.id, theirs.data.id, { action: 'CERRAR' });
    void ana;

    expect(await getClosedRound(group.id, mine.data.id)).toBeNull();
    expect(await getClosedRound(group.id, theirs.data.id)).toBeNull();
    expect(await getClosedRound(nanoid(24), theirs.data.id)).toBeNull();
    expect(await getClosedRound(other.group.id, theirs.data.id)).not.toBeNull();
  });
});

describe('participant order', () => {
  beforeEach(resetDb);

  // Participants created with the group share one transaction, so their
  // createdAt ties; an UPDATE rewrites the row and moves it in heap order.
  // The id tie-break must keep every view in the same, stable order.
  it('is identical and stable across views when createdAt ties, even after a rename', async () => {
    const token = nanoid(24);
    const createdAt = new Date('2026-07-01T10:00:00.000Z');
    await prisma.group.create({ data: { id: token, name: 'Piso' } });
    for (const id of ['p-a', 'p-b', 'p-c']) {
      await prisma.participant.create({ data: { id, groupId: token, name: `Nombre ${id}`, createdAt } });
    }
    await prisma.participant.update({ where: { id: 'p-a' }, data: { name: 'Renombrado' } });

    const expected = ['p-a', 'p-b', 'p-c'];
    expect((await getGroup(token)).participants.map((p) => p.id)).toEqual(expected);
    expect((await getGroupOverview(token))!.participants.map((p) => p.id)).toEqual(expected);
    expect((await getSettingsView(token))!.participants.map((p) => p.id)).toEqual(expected);
    expect((await getKittyView(token))!.activeParticipants.map((p) => p.id)).toEqual(expected);
  });
});
