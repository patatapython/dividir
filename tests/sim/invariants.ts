import { expect } from 'vitest';
import { asCents, type Cents } from '../../src/domain/money';
import { settleExact, settleGreedy, EXACT_LIMIT } from '../../src/domain/settle';
import { prisma } from '../../src/server/db';
import { getActivity, getClosedRounds, getGroupOverview, getLedgerExport, type GroupOverview } from '../../src/server/queries';
import { ledgerCsv } from '../../src/app/g/[token]/exportar/ledger-csv';
import { csvCents, parseCsv, rawLedger } from './oracle';
import type { Driver } from './driver';

/**
 * The things that can never fail (plan §4, I1–I7), checked against a group as it
 * stands. Each check states the rule it proves in its assertion message.
 */
export async function checkLedger(driver: Driver, token: string): Promise<GroupOverview> {
  const overview = await getGroupOverview(token);
  if (!overview) throw new Error('group vanished');
  const shown = new Map(overview.balances.map((b) => [b.participantId, b.balanceCents]));

  // I1 — the balances Saldos shows add up to zero.
  expect([...shown.values()].reduce((a, b) => a + b, 0), 'I1 balances sum to 0').toBe(0);

  // I7 — an independent recomputation from the raw rows agrees: the only
  // difference is the Sobrante bucket, folded onto active people almost evenly.
  const raw = await rawLedger(token);
  expect([...raw.balances.values()].reduce((a, b) => a + b, 0) + raw.ownerless, 'I7 raw ledger is zero-sum').toBe(0);
  const archived = new Set(overview.participants.filter((p) => p.archivedAt !== null).map((p) => p.id));
  const fold = overview.participants.map((p) => ({ id: p.id, diff: (shown.get(p.id) ?? 0) - (raw.balances.get(p.id) ?? 0) }));
  expect(fold.reduce((a, f) => a + f.diff, 0), 'I7 the fold redistributes exactly the Sobrante bucket').toBe(raw.ownerless);
  const activeDiffs = fold.filter((f) => !archived.has(f.id)).map((f) => f.diff);
  if (activeDiffs.length > 0) {
    expect(Math.max(...activeDiffs) - Math.min(...activeDiffs), 'I7 the fold is even to the cent').toBeLessThanOrEqual(1);
    for (const f of fold.filter((f) => archived.has(f.id))) expect(f.diff, 'I7 archived people take no Sobrante').toBe(0);
  }

  // I2 — paying the plan leaves everybody at zero, in at most m−1 transfers;
  // exact never uses more transfers than greedy where both apply.
  const after = new Map(shown);
  for (const t of overview.plan) {
    expect(t.amountCents, 'I2 transfers are positive').toBeGreaterThan(0);
    after.set(t.fromId, after.get(t.fromId)! + t.amountCents);
    after.set(t.toId, after.get(t.toId)! - t.amountCents);
  }
  expect([...after.values()].every((v) => v === 0), 'I2 the plan zeroes every balance').toBe(true);
  const nonZero = [...shown.values()].filter((v) => v !== 0).length;
  expect(overview.plan.length, 'I2 at most m−1 transfers').toBeLessThanOrEqual(Math.max(0, nonZero - 1));
  const asMap = new Map<string, Cents>([...shown].map(([id, v]) => [id, asCents(v)]));
  if (nonZero <= EXACT_LIMIT) {
    expect(settleExact(asMap).length, 'I2 exact ≤ greedy').toBeLessThanOrEqual(settleGreedy(asMap).length);
  }

  // I3 — the CSV's "Saldo" row is Saldos, every movement row sums to 0 and each
  // person's column adds up to their saldo.
  const exported = await getLedgerExport(token);
  if (!exported) throw new Error('export vanished');
  const rows = parseCsv(ledgerCsv(exported));
  const header = rows[0];
  const people = overview.participants;
  const columnOf = (name: string) => header.indexOf(name, 5);
  const saldo = rows.find((r) => r[1] === 'Saldo');
  expect(saldo, 'I3 the CSV has a Saldo row').toBeDefined();
  for (const p of people) {
    expect(csvCents(saldo![columnOf(p.name)]), `I3 CSV saldo of ${p.name}`).toBe(shown.get(p.id));
  }
  const saldoIndex = rows.indexOf(saldo!);
  for (const row of rows.slice(1, saldoIndex)) {
    const cells = row.slice(5).filter((c) => c !== '').map(csvCents);
    expect(cells.reduce((a, b) => a + b, 0), `I3 CSV row "${row[1]} ${row[2]}" sums to 0`).toBe(0);
  }
  for (const p of people) {
    const column = columnOf(p.name);
    const sum = rows.slice(1, saldoIndex).reduce((a, r) => a + (r[column] ? csvCents(r[column]) : 0), 0);
    expect(sum, `I3 CSV column of ${p.name} adds up to the saldo`).toBe(shown.get(p.id));
  }
  // C6: the oracle sums expenses, payments and refunds only — agreeing with Saldos
  // proves unpaid charges never reach the settlement.
  driver.cover('I1', 'I2', 'I3', 'I7', 'C6');
  return overview;
}

/** I5 + I6 — Actividad lists every mutation, and "Ver más" pages through it cleanly. */
export async function checkActivity(driver: Driver, token: string): Promise<number> {
  const expected = driver.expectedActivity(token);
  const first = await getActivity(token, 50);
  expect(first?.total, 'I5 one activity entry per mutation').toBe(expected);
  let previous: string[] = [];
  for (let shown = 50; shown <= Math.min(500, expected + 50); shown += 50) {
    const page = await getActivity(token, shown);
    const ids = page!.entries.map((e) => e.id);
    expect(new Set(ids).size, 'I6 no repeated entries').toBe(ids.length);
    expect(ids.slice(0, previous.length), 'I6 each page extends the previous one').toEqual(previous);
    expect(ids.length, 'I6 each page shows what it promises').toBe(Math.min(shown, expected));
    for (const e of page!.entries) expect(e.label, 'I6 every entry is described').not.toBe('');
    previous = ids;
  }
  driver.cover('I5', 'I6');
  return expected;
}

/** I4 — no round of the bote is ever below zero; a REPARTIR pays out exactly its balance, pro rata. */
export async function checkKitty(driver: Driver, groupId: string): Promise<void> {
  const rounds = await prisma.kittyRound.findMany({
    where: { groupId },
    include: { contributions: true, spends: true },
  });
  for (const round of rounds) {
    const contributed = round.contributions.reduce((a, c) => a + c.amountCents, 0);
    const spent = round.spends.reduce((a, s) => a + s.amountCents, 0);
    const balance = round.carryInCents + contributed - spent;
    expect(balance, `I4 round ${round.name ?? round.id} never below zero`).toBeGreaterThanOrEqual(0);
    if (round.closeAction === 'REPARTIR') {
      const payout = round.payoutSnapshot as { participantId: string; amountCents: number }[];
      expect(payout.reduce((a, p) => a + p.amountCents, 0), 'I4 REPARTIR pays out the whole balance').toBe(balance);
      const byPerson = new Map<string, number>();
      for (const c of round.contributions) byPerson.set(c.participantId, (byPerson.get(c.participantId) ?? 0) + c.amountCents);
      for (const p of payout) {
        const exact = (balance * (byPerson.get(p.participantId) ?? 0)) / contributed;
        expect(Math.abs(p.amountCents - exact), 'I4 payout is pro rata to the cent').toBeLessThan(1);
      }
      expect(new Set(payout.map((p) => p.participantId)), 'I4 every contributor is paid').toEqual(new Set(byPerson.keys()));
    } else if (round.closeAction === null) {
      expect(round.payoutSnapshot, 'I4 an open round has no payout').toBeNull();
    }
  }
  // Cerradas lists every closed round: none may drop out of reach.
  const closed = rounds.filter((r) => r.closedAt !== null).length;
  const page = await getClosedRounds(groupId, 500);
  expect(page?.total, 'I4 Cerradas counts every closed round').toBe(closed);
  expect(page?.rounds.length, 'I4 Cerradas reaches every closed round').toBe(Math.min(closed, 500));
  driver.cover('I4');
}

/** The open round's balance right now (for the scenario to spend within it). */
export async function openRoundBalance(groupId: string): Promise<{ id: string; balance: number } | null> {
  const round = await prisma.kittyRound.findFirst({ where: { groupId, closedAt: null }, include: { contributions: true, spends: true } });
  if (!round) return null;
  const balance = round.carryInCents + round.contributions.reduce((a, c) => a + c.amountCents, 0) - round.spends.reduce((a, s) => a + s.amountCents, 0);
  expect(balance, 'I4 the open round is never below zero').toBeGreaterThanOrEqual(0);
  return { id: round.id, balance };
}
