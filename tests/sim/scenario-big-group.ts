import { expect } from 'vitest';
import { createGroup, setOwnerlessExtra } from '../../src/server/actions/group';
import {
  addParticipant, archiveParticipant, claimParticipant, deleteParticipant, unarchiveParticipant, updateParticipant,
} from '../../src/server/actions/participants';
import { createExpense, deleteExpense, updateExpense } from '../../src/server/actions/expenses';
import { createRefund, deleteRefund } from '../../src/server/actions/refunds';
import { createPayment, deletePayment } from '../../src/server/actions/payments';
import {
  createGroupCharge, deleteGroupCharge, payGroupCharge, updateGroupCharge,
} from '../../src/server/actions/group-charge';
import {
  addContributions, addSpend, closeKittyRound, deleteContribution, deleteSpend, editContribution, editSpend,
  openKittyRound, reopenKittyRound,
} from '../../src/server/actions/kitty';
import { resetRateLimit } from '../../src/server/rate-limit';
import { prisma } from '../../src/server/db';
import { getGroupOverview } from '../../src/server/queries';
import type { Driver } from './driver';
import { typed } from './driver';
import type { Rng } from './rng';
import type { Roster } from './roster';
import { buildExpense, centsOf, isoDay, MODES, sharesFor, totalOf, type ExpenseIn, type Mode } from './generate';
import { checkActivity, checkKitty, checkLedger, openRoundBalance } from './invariants';

export const BIG_GROUP = {
  name: 'La peña del pueblo',
  expenses: 460,
  kittyRounds: 24,
  start: new Date('2026-03-01T00:00:00Z'),
  days: 200,
};

interface Person { id: string; name: string; archived: boolean }
interface Stored { input: ExpenseIn; refunded: number; refunds: string[] }

const ARCHIVED = /archivad/i;

/** Creating a group is rate-limited per client; the simulation is one client making many. */
export async function newGroup(driver: Driver, name: string, participantNames: string[]): Promise<string> {
  resetRateLimit();
  const created = await createGroup({ name, participantNames });
  if (!created.ok) throw new Error(`createGroup ${name}: ${created.error}`);
  driver.countActivity(created.data.token, 1);
  return created.data.token;
}

/**
 * A big group, lived for ~200 days: founders from the start, late joiners in two
 * waves, people who leave and one who comes back, hundreds of expenses in every split
 * mode, refunds, payments, unpaid charges, the Sobrante, and a bote round at most
 * gatherings. Returns the group token.
 */
export async function seedBigGroup(driver: Driver, rng: Rng, roster: Roster): Promise<string> {
  const token = await newGroup(driver, BIG_GROUP.name, roster.founders);
  driver.cover('P1');
  const people: Person[] = (await prisma.participant.findMany({ where: { groupId: token }, orderBy: { createdAt: 'asc' } }))
    .map((p) => ({ id: p.id, name: p.name, archived: false }));
  const active = () => people.filter((p) => !p.archived).map((p) => p.id);
  const archivedIds = () => people.filter((p) => p.archived).map((p) => p.id);

  // P13 — every founder opens the link on their own phone and says who they are.
  for (const p of people) {
    driver.as(token, p.id);
    const claimed = await claimParticipant(token, p.id);
    expect(claimed.ok).toBe(true);
  }
  driver.cover('P13');
  const actAsSomeone = () => driver.as(token, rng.pick(active()));

  const expenses = new Map<string, Stored>();
  const chargeIds: string[] = [];
  let declared = 0;
  let applied = 0;
  let kittyRoundsOpened = 0;
  const kittyPlan = kittyClosePlan(BIG_GROUP.kittyRounds);

  for (let step = 0; step < BIG_GROUP.expenses; step++) {
    const date = isoDay(BIG_GROUP.start, Math.floor((step * BIG_GROUP.days) / BIG_GROUP.expenses));
    actAsSomeone();

    // ---- milestones in the life of the group -------------------------------
    if (step === 20) {
      declared = 15_000;
      await driver.ok(token, 'S1 declare Sobrante', setOwnerlessExtra(token, { amount: typed(declared) }), 0);
      driver.cover('S1');
    }
    if (step === 80 || step === 250) {
      const wave = step === 80 ? roster.lateJoiners.slice(0, 3) : roster.lateJoiners.slice(3);
      for (const name of wave) {
        const { id } = await driver.ok(token, `P6 late joiner ${name}`, addParticipant(token, name));
        people.push({ id, name, archived: false });
        driver.as(token, id);
        expect((await claimParticipant(token, id)).ok).toBe(true);
      }
      driver.cover('P6');
      await lateJoinerIsNotRetroactive(driver, rng, token, expenses, people.at(-1)!.id);
    }
    if (step === 120) {
      const { id } = await driver.ok(token, 'P10 add someone by mistake', addParticipant(token, 'Invitado de prueba'));
      await driver.ok(token, 'P10 delete someone without movements', deleteParticipant(token, id));
      driver.cover('P10');
    }
    if (step === 150) {
      for (const leaver of rng.sample(people.filter((p) => !p.archived).slice(0, 24), 3)) {
        await driver.ok(token, `P8 archive ${leaver.name}`, archiveParticipant(token, leaver.id));
        leaver.archived = true;
      }
      driver.cover('P8');
      await archivedCannotBeNewlyReferenced(driver, rng, token, active(), archivedIds(), expenses, chargeIds);
    }
    if (step === 200) {
      for (const renamed of rng.sample(people.filter((p) => !p.archived), 2)) {
        const name = `${renamed.name} (el de siempre)`;
        await driver.ok(token, `P7 rename ${renamed.name}`, updateParticipant(token, renamed.id, name));
        renamed.name = name;
      }
      driver.cover('P7');
    }
    if (step === 300) {
      const back = people.find((p) => p.archived)!;
      await driver.ok(token, `P9 ${back.name} comes back`, unarchiveParticipant(token, back.id));
      back.archived = false;
      driver.cover('P9');
    }

    // ---- the expense of the day --------------------------------------------
    const remaining = declared - applied;
    const useSobrante = remaining > 0 && step > 20 && rng.chance(0.07);
    const mode: Mode | undefined = step < MODES.length * 4 ? MODES[step % MODES.length] : undefined;
    const input = buildExpense(rng, {
      date,
      active: active(),
      mode,
      itemized: rng.chance(0.15),
      payerCount: rng.chance(0.15) ? rng.int(2, 3) : 1,
      ownerlessCents: useSobrante ? (rng.chance(0.2) ? Number.MAX_SAFE_INTEGER : rng.int(500, Math.max(500, remaining))) : 0,
    });
    const { id } = await driver.ok(token, `expense ${step}`, createExpense(token, input));
    expenses.set(id, { input, refunded: 0, refunds: [] });
    const nobody = input.payers.filter((p) => p.participantId === null).reduce((a, p) => a + centsOf(p.amount), 0);
    applied += nobody;
    if (nobody > 0) driver.cover(nobody === totalOf(input) ? 'G7-100' : 'G7');
    for (const item of input.items) driver.cover(`G-${item.splitMode}`);
    if (input.items.length > 1) driver.cover('G8');
    if (input.payers.filter((p) => p.participantId !== null).length > 1) driver.cover('G6');

    // ---- what else happens around it ---------------------------------------
    if (step % 9 === 4) await editSomeExpense(driver, rng, token, expenses, active());
    if (step % 23 === 11) await deleteSomeExpense(driver, rng, token, expenses);
    if (step % 10 === 7) await refundSomething(driver, rng, token, expenses, active());
    if (step % 12 === 5) await payPartOfThePlan(driver, rng, token, date);
    if (step % 18 === 3 && chargeIds.length < 40) await unpaidCharges(driver, rng, token, date, active(), chargeIds);
    if (step % 19 === 9 && kittyRoundsOpened < BIG_GROUP.kittyRounds) {
      await kittyGathering(driver, rng, token, active(), archivedIds(), kittyPlan[kittyRoundsOpened], kittyRoundsOpened);
      kittyRoundsOpened++;
    }
    if (step === 350) {
      // S3 — somebody applies more Sobrante than was declared; S4 — it is emptied;
      // then declared again above what was applied, so some is left to apply.
      const needed = Math.max(declared - applied, 0) + 2_500;
      const overInput: ExpenseIn = {
        title: 'Cena pagada con lo que sobró', date,
        payers: [{ participantId: null, amount: typed(needed) }],
        items: [{ amount: typed(needed), splitMode: 'EQUAL', shares: sharesFor(rng, 'EQUAL', needed, rng.sample(active(), 6)) }],
      };
      const over = await driver.ok(token, 'S3 overshoot', createExpense(token, overInput));
      applied += needed;
      expenses.set(over.id, { input: overInput, refunded: 0, refunds: [] });
      const view = await getGroupOverview(token);
      expect(view!.ownerless.remainingCents, 'S3 the overshoot is surfaced as negative').toBeLessThan(0);
      await driver.ok(token, 'S4 empty the Sobrante', setOwnerlessExtra(token, { amount: '0' }), 0);
      declared = applied + 4_000;
      await driver.ok(token, 'S1 declare again', setOwnerlessExtra(token, { amount: typed(declared) }), 0);
      driver.cover('S3', 'S4');
    }
    if (step % 50 === 49) await checkLedger(driver, token);
  }

  // The remaining gatherings, so the bote has all its rounds and one stays open.
  while (kittyRoundsOpened < BIG_GROUP.kittyRounds) {
    await kittyGathering(driver, rng, token, active(), archivedIds(), kittyPlan[kittyRoundsOpened], kittyRoundsOpened);
    kittyRoundsOpened++;
  }
  await kittyStateMachine(driver, token);
  await duplicatePayment(driver, rng, token);
  await refundGuards(driver, rng, token, expenses, active());

  const overview = await checkLedger(driver, token);
  expect(overview.ownerless.appliedCents, 'S2 applied Sobrante is what nobody paid').toBe(applied);
  expect(overview.ownerless.remainingCents, 'S2 remaining = declared − applied').toBe(declared - applied);
  driver.cover('S2', 'S5');
  await checkKitty(driver, token);
  await checkActivity(driver, token);
  return token;
}

/** How each of the rounds ends: every closing, and the last one stays open. */
function kittyClosePlan(count: number): ('REPARTIR' | 'CERRAR' | 'REOPEN' | 'OPEN')[] {
  const cycle: ('REPARTIR' | 'CERRAR' | 'REOPEN')[] = ['REPARTIR', 'CERRAR', 'REPARTIR', 'REOPEN'];
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? 'OPEN' : cycle[i % cycle.length]));
}

export async function inputOf(expenseId: string): Promise<ExpenseIn | null> {
  const e = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { payers: true, items: { include: { shares: true } } },
  });
  if (!e) return null;
  return {
    title: e.title,
    date: e.date.toISOString().slice(0, 10),
    payers: e.payers.map((p) => ({ participantId: p.participantId, amount: typed(p.amountCents) })),
    items: e.items.map((i) => ({
      ...(i.label ? { label: i.label } : {}),
      amount: typed(i.amountCents),
      splitMode: i.splitMode as Mode,
      shares: i.shares.map((s) => ({ participantId: s.participantId, shareInput: s.shareInput })),
    })),
  };
}

async function editSomeExpense(driver: Driver, rng: Rng, token: string, expenses: Map<string, Stored>, active: string[]) {
  const candidates = [...expenses.entries()].filter(([, s]) => s.refunded === 0);
  if (candidates.length === 0) return;
  const [id, stored] = rng.pick(candidates);
  const keepsSobrante = stored.input.payers.some((p) => p.participantId === null);
  if (keepsSobrante || rng.chance(0.4)) {
    // Resent unchanged except the title: grandfathered people stay (P12, edit side).
    const input = { ...stored.input, title: `${stored.input.title} (corregido)`.slice(0, 120) };
    await driver.ok(token, 'G9 edit title', updateExpense(token, id, input));
    stored.input = input;
  } else {
    // A new amount, mode and payer, among the people active today.
    const input = buildExpense(rng, { date: stored.input.date, active, payerCount: rng.int(1, 2), itemized: rng.chance(0.2) });
    await driver.ok(token, 'G9 edit amount, mode and payers', updateExpense(token, id, input));
    stored.input = input;
  }
  driver.cover('G9');
}

async function deleteSomeExpense(driver: Driver, rng: Rng, token: string, expenses: Map<string, Stored>) {
  const withRefunds = [...expenses.entries()].filter(([, s]) => s.refunds.length > 0);
  const candidates = withRefunds.length > 0 && rng.chance(0.3) ? withRefunds : [...expenses.entries()];
  const [id, stored] = rng.pick(candidates);
  if (stored.input.payers.some((p) => p.participantId === null)) return; // keep the Sobrante count simple
  await driver.ok(token, 'G10 delete expense', deleteExpense(token, id));
  expenses.delete(id);
  driver.cover(stored.refunds.length > 0 ? 'G10-with-refunds' : 'G10');
}

async function refundSomething(driver: Driver, rng: Rng, token: string, expenses: Map<string, Stored>, active: string[]) {
  const candidates = [...expenses.entries()].filter(([, s]) => totalOf(s.input) - s.refunded >= 100);
  if (candidates.length === 0) return;
  const [id, stored] = rng.pick(candidates);
  const room = totalOf(stored.input) - stored.refunded;
  const receiver = rng.pick(active);
  const roll = rng.next();
  if (roll < 0.1) {
    await driver.refused('R3', createRefund(token, { expenseId: id, receivedById: receiver, amount: typed(room + 1) }), /supera/);
    return;
  }
  if (roll < 0.15 && stored.refunded > 0) {
    // R4 — lowering the expense below what was already refunded is refused.
    const input = { ...stored.input };
    const low = Math.max(1, stored.refunded - 1);
    input.items = [{ amount: typed(low), splitMode: 'EQUAL', shares: sharesFor(rng, 'EQUAL', low, rng.sample(active, 2)) }];
    input.payers = [{ participantId: rng.pick(active), amount: typed(low) }];
    await driver.refused('R4', updateExpense(token, id, input), /reembols/i);
    return;
  }
  const amount = roll < 0.3 ? room : rng.int(100, Math.max(100, Math.floor(room / 2)));
  const refund = await driver.ok(token, 'R1 refund', createRefund(token, { expenseId: id, receivedById: receiver, amount: typed(amount) }));
  stored.refunded += amount;
  stored.refunds.push(refund.id);
  driver.cover(amount === room ? 'R2' : 'R1');
  if (rng.chance(0.15)) {
    const refundId = stored.refunds.pop()!;
    await driver.ok(token, 'R5 delete refund', deleteRefund(token, refundId));
    stored.refunded -= amount;
    driver.cover('R5');
  }
}

async function payPartOfThePlan(driver: Driver, rng: Rng, token: string, date: string) {
  const overview = await getGroupOverview(token);
  if (!overview || overview.plan.length === 0) return;
  for (const transfer of rng.sample(overview.plan, rng.int(1, 3))) {
    const amount = rng.chance(0.5) ? transfer.amountCents : Math.max(1, Math.floor(transfer.amountCents / 2));
    await driver.ok(token, 'Pg1 payment', createPayment(token, { fromId: transfer.fromId, toId: transfer.toId, amount: typed(amount), date }));
  }
  driver.cover('Pg1');
}

async function duplicatePayment(driver: Driver, rng: Rng, token: string) {
  const overview = (await getGroupOverview(token))!;
  const [a, b] = rng.sample(overview.participants.filter((p) => p.archivedAt === null), 2);
  const input = { fromId: a.id, toId: b.id, amount: '10,00', date: '2026-09-20' };
  const first = await driver.ok(token, 'Pg2 first payment', createPayment(token, input));
  const again = await createPayment(token, input);
  expect(again.ok === false && again.code, 'Pg2 an identical payment within 30 s is flagged').toBe('DUPLICATE_PAYMENT');
  const forced = await driver.ok(token, 'Pg2 confirmed duplicate', createPayment(token, { ...input, confirmDuplicate: true }));
  await driver.ok(token, 'Pg4 delete the duplicate', deletePayment(token, forced.id));
  await driver.refused('Pg3', createPayment(token, { ...input, toId: a.id }), /misma persona/);
  expect(first.id).not.toBe(forced.id);
  driver.cover('Pg2', 'Pg4');
}

async function unpaidCharges(driver: Driver, rng: Rng, token: string, date: string, active: string[], chargeIds: string[]) {
  const mode = MODES[chargeIds.length % MODES.length];
  const cents = rng.int(40, 900) * 100;
  const people = rng.sample(active, rng.int(3, Math.min(20, active.length)));
  const input = { concept: rng.pick(['Casa rural', 'Autobús de la excursión', 'Reserva del restaurante', 'Fianza del local']), date, amount: typed(cents), splitMode: mode, shares: sharesFor(rng, mode, cents, people) };
  const { id } = await driver.ok(token, 'C1 unpaid charge', createGroupCharge(token, input));
  chargeIds.push(id);
  driver.cover('C1', `C-${mode}`);
  const roll = rng.next();
  if (roll < 0.2) {
    await driver.ok(token, 'C2 edit charge', updateGroupCharge(token, id, { ...input, concept: `${input.concept} (actualizado)` }));
    driver.cover('C2');
  } else if (roll < 0.3) {
    await driver.ok(token, 'C3 delete charge', deleteGroupCharge(token, id));
    chargeIds.pop();
    driver.cover('C3');
  } else if (roll < 0.55) {
    await driver.ok(token, 'C4 Lo pagó X', payGroupCharge(token, id, { payerId: rng.pick(active) }));
    chargeIds.pop();
    driver.cover('C4');
  }
}

/** R4 — an expense can't be lowered below what was already refunded of it. */
async function refundGuards(driver: Driver, rng: Rng, token: string, expenses: Map<string, Stored>, active: string[]) {
  const [id, stored] = [...expenses.entries()].find(([, s]) => s.refunded > 1)!;
  const low = stored.refunded - 1;
  const input: ExpenseIn = {
    ...stored.input,
    payers: [{ participantId: rng.pick(active), amount: typed(low) }],
    items: [{ amount: typed(low), splitMode: 'EQUAL', shares: sharesFor(rng, 'EQUAL', low, rng.sample(active, 2)) }],
  };
  await driver.refused('R4', updateExpense(token, id, input), /reembols/i);
}

/** G18 — editing an expense from before someone joined never charges them. */
async function lateJoinerIsNotRetroactive(driver: Driver, rng: Rng, token: string, expenses: Map<string, Stored>, joiner: string) {
  const before = (await getGroupOverview(token))!.balances.find((b) => b.participantId === joiner)!.balanceCents;
  const old = [...expenses.entries()].filter(([, s]) => s.refunded === 0 && !s.input.payers.some((p) => p.participantId === null));
  const [id, stored] = rng.pick(old);
  await driver.ok(token, 'G18 re-save an old expense', updateExpense(token, id, stored.input));
  const after = (await getGroupOverview(token))!.balances.find((b) => b.participantId === joiner)!.balanceCents;
  expect(after, 'G18 an old expense re-saved does not reach a late joiner').toBe(before);
  driver.cover('G18');
}

/** P12, B12, C5, P11 — archived people are kept out of anything new, and can't be deleted with history. */
async function archivedCannotBeNewlyReferenced(
  driver: Driver, rng: Rng, token: string, active: string[], archived: string[], expenses: Map<string, Stored>, chargeIds: string[],
) {
  const gone = archived[0];
  const input = buildExpense(rng, { date: '2026-06-01', active: [...active.slice(0, 3), gone], mode: 'EQUAL' });
  input.items = [{ amount: '30,00', splitMode: 'EQUAL', shares: sharesFor(rng, 'EQUAL', 3000, [active[0], gone]) }];
  input.payers = [{ participantId: active[1], amount: '30,00' }];
  await driver.refused('P12', createExpense(token, input), ARCHIVED);
  await driver.refused('P11', deleteParticipant(token, gone), /movimientos|no se puede/i);
  const open = await openRoundBalance(token);
  if (open) await driver.refused('B12', addContributions(token, open.id, { contributions: [{ participantId: gone, amount: '5,00' }] }), ARCHIVED);
  else driver.cover('B12-no-open-round');
  if (chargeIds.length > 0) await driver.refused('C5', payGroupCharge(token, chargeIds[0], { payerId: gone }), ARCHIVED);
  // Payments with archived people stay allowed on purpose (§5): they settle old debts.
  await driver.ok(token, 'P12 payment to an archived person', createPayment(token, { fromId: active[0], toId: gone, amount: '1,00', date: '2026-06-01' }));
  // Their old expenses can still be edited as they were (grandfathered).
  const theirs = [...expenses.entries()].find(([, s]) => s.refunded === 0 && s.input.items.some((i) => i.shares.some((sh) => sh.participantId === gone)));
  if (theirs) {
    await driver.ok(token, 'P12 edit an old expense of an archived person', updateExpense(token, theirs[0], theirs[1].input));
    driver.cover('P12-grandfathered');
  }
}

/** One gathering with the bote: open, contribute (some twice), spend, fix mistakes, close. */
async function kittyGathering(
  driver: Driver, rng: Rng, token: string, active: string[], archived: string[],
  plan: 'REPARTIR' | 'CERRAR' | 'REOPEN' | 'OPEN', index: number,
) {
  const preexisting = rng.chance(0.3) ? typed(rng.int(5, 60) * 100) : undefined;
  const round = await driver.ok(token, 'B1 open round', openKittyRound(token, { name: `Quedada ${index + 1}`, ...(preexisting ? { preexisting } : {}) }));
  driver.cover(preexisting ? 'B1-sobrante' : 'B1');
  await driver.refused('B11', openKittyRound(token, {}), /abierta/);

  const givers = rng.sample(active, rng.int(8, Math.min(26, active.length)));
  const amount = rng.pick([500, 1000, 1500, 2000]);
  await driver.ok(token, 'B2 contributions', addContributions(token, round.id, {
    contributions: givers.map((participantId) => ({ participantId, amount: typed(rng.chance(0.8) ? amount : rng.int(3, 40) * 100) })),
  }));
  driver.cover('B2');
  const again = rng.sample(givers, rng.int(1, 4));
  await driver.ok(token, 'B3 second round of contributions', addContributions(token, round.id, {
    contributions: again.map((participantId) => ({ participantId, amount: typed(amount) })),
  }));
  driver.cover('B3');
  if (archived.length > 0) {
    await driver.refused('B12', addContributions(token, round.id, { contributions: [{ participantId: archived[0], amount: '5,00' }] }), ARCHIVED);
  }

  // Spend most of it, a ticket at a time; the last try goes over and is refused.
  for (let n = rng.int(3, 12); n > 0; n--) {
    const { balance } = (await openRoundBalance(token))!;
    if (balance < 100) break;
    const cost = rng.int(100, Math.max(100, Math.floor(balance * 0.35)));
    await driver.ok(token, 'B4 spend', addSpend(token, round.id, { concept: rng.pick(['Ronda de cañas', 'Bravas', 'Chupitos', 'Hielo', 'Tabaco de liar', 'Taxi']), amount: typed(cost) }));
    driver.cover('B4');
  }
  const { balance } = (await openRoundBalance(token))!;
  await driver.refused('B5', addSpend(token, round.id, { concept: 'Ronda de más', amount: typed(balance + 1) }), /supera el saldo/);

  // Mistakes: a contribution typed wrong, a spend corrected, one removed.
  const rows = await prisma.kittyContribution.findMany({ where: { kittyRoundId: round.id }, orderBy: { id: 'asc' } });
  const wrong = rng.pick(rows);
  await driver.ok(token, 'B-edit contribution', editContribution(token, wrong.id, { participantId: wrong.participantId, amount: typed(wrong.amountCents + 500) }));
  const spends = await prisma.kittySpend.findMany({ where: { kittyRoundId: round.id }, orderBy: { id: 'asc' } });
  if (spends.length > 1) {
    await driver.ok(token, 'B-edit spend', editSpend(token, spends[0].id, { concept: `${spends[0].concept} (bien)`, amount: typed(spends[0].amountCents) }));
    await driver.ok(token, 'B-delete spend', deleteSpend(token, spends[1].id));
  }
  // B6 — taking out the biggest contribution would leave the bote negative: refused
  // whenever it would; otherwise it is simply allowed.
  const now = (await openRoundBalance(token))!.balance;
  const biggest = (await prisma.kittyContribution.findMany({ where: { kittyRoundId: round.id } })).sort((a, b) => b.amountCents - a.amountCents)[0];
  if (biggest.amountCents > now) {
    await driver.refused('B6', deleteContribution(token, biggest.id), /negativo/);
    if (biggest.amountCents - 1 > now) {
      await driver.refused('B6-edit', editContribution(token, biggest.id, { participantId: biggest.participantId, amount: '0,01' }), /negativo/);
    }
  } else {
    await driver.ok(token, 'B-delete contribution', deleteContribution(token, biggest.id));
  }
  await openRoundBalance(token);

  if (plan === 'OPEN') return;
  if (plan === 'REOPEN') {
    await driver.ok(token, 'B7 close', closeKittyRound(token, round.id, { action: 'CERRAR' }));
    await driver.ok(token, 'B9 reopen', reopenKittyRound(token, round.id));
    await driver.ok(token, 'B4 spend after reopening', addSpend(token, round.id, { concept: 'Se nos olvidó el hielo', amount: '1,00' }));
    await driver.ok(token, 'B8 distribute', closeKittyRound(token, round.id, { action: 'REPARTIR' }));
    driver.cover('B7', 'B8', 'B9');
    return;
  }
  await driver.ok(token, `close ${plan}`, closeKittyRound(token, round.id, { action: plan }));
  driver.cover(plan === 'CERRAR' ? 'B7' : 'B8');
}

/** B10, B13 and the closed-round guards, once the rounds exist. */
async function kittyStateMachine(driver: Driver, token: string) {
  const open = await prisma.kittyRound.findFirst({ where: { groupId: token, closedAt: null } });
  const closed = await prisma.kittyRound.findFirst({ where: { groupId: token, closedAt: { not: null } }, orderBy: { closedAt: 'asc' } });
  expect(open && closed, 'the bote has an open and a closed round').toBeTruthy();
  await driver.refused('B10', reopenKittyRound(token, closed!.id), /abierta/);
  await driver.refused('B-closed-spend', addSpend(token, closed!.id, { concept: 'Tarde', amount: '1,00' }), /cerrada/);
  const closedContribution = await prisma.kittyContribution.findFirst({ where: { kittyRoundId: closed!.id } });
  await driver.refused('B-closed-edit', deleteContribution(token, closedContribution!.id), /cerrada/);
  // B13 — a round whose balance is exactly 0 cannot be distributed (session 12): it is only closed.
  const zero = (await openRoundBalance(token))!;
  if (zero.balance > 0) {
    await driver.ok(token, 'B13 spend to zero', addSpend(token, open!.id, { concept: 'Último pago', amount: typed(zero.balance) }));
  }
  // B6 — with the bote at 0, taking back or lowering any contribution would leave it negative.
  const anyContribution = (await prisma.kittyContribution.findFirst({ where: { kittyRoundId: open!.id, amountCents: { gt: 1 } } }))!;
  await driver.refused('B6', deleteContribution(token, anyContribution.id), /negativo/);
  await driver.refused('B6-edit', editContribution(token, anyContribution.id, { participantId: anyContribution.participantId, amount: '0,01' }), /negativo/);
  await driver.refused('B13', closeKittyRound(token, open!.id, { action: 'REPARTIR' }), /nada que repartir/);
  await driver.ok(token, 'B13 close the zero round', closeKittyRound(token, open!.id, { action: 'CERRAR' }));
  const last = await driver.ok(token, 'B13 open the round that stays open', openKittyRound(token, { name: 'Quedada de Navidad', preexisting: '12,40' }));
  const everyone = await prisma.participant.findMany({ where: { groupId: token, archivedAt: null }, orderBy: { createdAt: 'asc' } });
  await driver.ok(token, 'B2 contributions for Navidad', addContributions(token, last.id, {
    contributions: everyone.map((p) => ({ participantId: p.id, amount: '20,00' })),
  }));
  await driver.ok(token, 'B4 spend for Navidad', addSpend(token, last.id, { concept: 'Cordero y turrones', amount: '187,35' }));
  driver.cover('B10', 'B13');
}
