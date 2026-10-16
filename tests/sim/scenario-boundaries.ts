import { expect } from 'vitest';
import { deleteGroup, setOwnerlessExtra } from '../../src/server/actions/group';
import { addParticipant, archiveParticipant, updateParticipant } from '../../src/server/actions/participants';
import { createExpense, deleteExpense, updateExpense } from '../../src/server/actions/expenses';
import { createRefund } from '../../src/server/actions/refunds';
import { createPayment } from '../../src/server/actions/payments';
import { createGroupCharge, payGroupCharge } from '../../src/server/actions/group-charge';
import { addContributions, addSpend, closeKittyRound, openKittyRound } from '../../src/server/actions/kitty';
import { prisma } from '../../src/server/db';
import type { Driver } from './driver';
import { newGroup } from './scenario-quintada';
import type { ExpenseIn } from './generate';

const GONE = /ya no existe/;
const TOO_BIG = /demasiado grande/i;

/**
 * Plan §4: every rule the server enforces, pushed at its edge (P2–P5, G12–G17), a
 * group reaching into another one (X1, X2) and a whole group deleted (Gr1). Each
 * refusal must be a Spanish message; an unhandled error fails the run.
 */
export async function probeBoundaries(driver: Driver, otherToken: string): Promise<string> {
  const token = await newGroup(driver, 'Límites', ['Joana', 'Mati', 'Chicho']);
  // By name: people created with the group tie on createdAt, so creation order is not theirs.
  const idOf = new Map((await prisma.participant.findMany({ where: { groupId: token } })).map((p) => [p.name, p.id]));
  const [joana, mati, chicho] = ['Joana', 'Mati', 'Chicho'].map((name) => idOf.get(name)!);

  // P2 — a name pasted from WhatsApp carries invisible word joiners (U+2060).
  await driver.refused('P2', addParticipant(token, '⁠Joana'), /ya existe|duplicad/i);
  const pasted = await driver.ok(token, 'P2 pasted name', addParticipant(token, '⁠Vanesa⁠ Po'));
  const stored = await prisma.participant.findUniqueOrThrow({ where: { id: pasted.id } });
  expect.soft(stored.name, 'P2 invisible characters never reach the stored name').toBe('Vanesa Po');
  // P3, P4 — the same person typed twice, even with other capitals or spacing.
  await driver.refused('P3', addParticipant(token, 'Joana'), /ya existe|duplicad/i);
  await driver.refused('P4', addParticipant(token, 'joana'), /ya existe|duplicad/i);
  await driver.refused('P4-spaces', addParticipant(token, 'Vanesa  Po'), /ya existe|duplicad/i);
  await driver.refused('P4-rename', updateParticipant(token, mati, 'JOANA'), /ya existe|duplicad/i);
  await driver.ok(token, 'P4 a person may change the capitals of their own name', updateParticipant(token, chicho, 'CHICHO'));
  // P5 — 50 characters is the limit.
  await driver.ok(token, 'P5 50 characters', addParticipant(token, 'x'.repeat(50)));
  await driver.refused('P5-51', addParticipant(token, 'y'.repeat(51)), /demasiado largo/);

  const single = (amount: string, overrides: Partial<ExpenseIn> = {}): ExpenseIn => ({
    title: 'Prueba', date: '2026-09-01',
    payers: [{ participantId: joana, amount }],
    items: [{ amount, splitMode: 'EQUAL', shares: [{ participantId: joana, shareInput: 1 }, { participantId: mati, shareInput: 1 }] }],
    ...overrides,
  });
  // G12 — the smallest amount, the largest, and beyond it.
  await driver.ok(token, 'G12 one cent', createExpense(token, single('0,01')));
  await driver.ok(token, 'G12 the largest amount', createExpense(token, single('1000000,00')));
  await driver.refused('G12-over', createExpense(token, single('1000000,01')), TOO_BIG);
  await driver.refused('G12-huge', createExpense(token, single('99999999999,99')), TOO_BIG);
  await driver.refused('G12-payment', createPayment(token, { fromId: joana, toId: mati, amount: '30000000', date: '2026-09-01' }), TOO_BIG);
  await driver.refused('G12-charge', createGroupCharge(token, {
    concept: 'Enorme', date: '2026-09-01', amount: '30000000', splitMode: 'EQUAL', shares: [{ participantId: joana, shareInput: 1 }],
  }), TOO_BIG);
  const lines = Array.from({ length: 3 }, () => ({ amount: '900000,00', splitMode: 'EQUAL' as const, shares: [{ participantId: joana, shareInput: 1 }] }));
  await driver.refused('G12-sum', createExpense(token, single('2700000,00', { items: lines, payers: [{ participantId: joana, amount: '2700000,00' }] })), TOO_BIG);
  await driver.refused('G12-weight', createExpense(token, single('10,00', {
    items: [{ amount: '10,00', splitMode: 'SHARES', shares: [{ participantId: joana, shareInput: 3_000_000_000 }, { participantId: mati, shareInput: 1 }] }],
  })), TOO_BIG);
  await driver.refused('G12-sobrante', setOwnerlessExtra(token, { amount: '30000000' }), TOO_BIG);
  await driver.refused('G12-zero', createExpense(token, single('0')), /no válido/);
  await driver.refused('G12-negative', createExpense(token, single('-5')), /no válido/);
  await driver.refused('G12-three-decimals', createExpense(token, single('12,505')), /no válido/);
  // G19 — a date that is not in the calendar is refused, never stored as another day.
  await driver.refused('G19-feb-30', createExpense(token, single('1,00', { date: '2026-02-30' })), /Fecha no válida/);
  await driver.refused('G19-month-13', createExpense(token, single('1,00', { date: '2026-13-01' })), /Fecha no válida/);
  await driver.refused('G19-payment', createPayment(token, { fromId: joana, toId: mati, amount: '1,00', date: '2026-04-31' }), /Fecha no válida/);
  // G13 — 120 characters of concept, not 121.
  await driver.ok(token, 'G13 120', createExpense(token, single('1,00', { title: 'c'.repeat(120) })));
  await driver.refused('G13-121', createExpense(token, single('1,00', { title: 'c'.repeat(121) })), /demasiado largo/);
  // G14–G17 — splits that don't add up.
  const split = (splitMode: ExpenseIn['items'][number]['splitMode'], inputs: number[]) => single('10,00', {
    items: [{ amount: '10,00', splitMode, shares: [joana, mati, chicho].map((participantId, i) => ({ participantId, shareInput: inputs[i] })) }],
  });
  await driver.refused('G14', createExpense(token, split('PERCENTAGE', [3333, 3333, 3333])), /100/);
  await driver.refused('G15', createExpense(token, split('EXACT', [300, 300, 300])), /sumar exactamente el total/);
  await driver.refused('G16', createExpense(token, split('ADJUSTMENT', [100, 0, 0])), /sumar cero/);
  await driver.refused('G16-negative-share', createExpense(token, split('ADJUSTMENT', [-500, 250, 250])), /negativas/);
  await driver.refused('G17', createExpense(token, single('10,00', { payers: [{ participantId: joana, amount: '9,99' }] })), /coincidir|pagadores/);
  await driver.refused('G-duplicate-share', createExpense(token, single('10,00', {
    items: [{ amount: '10,00', splitMode: 'EQUAL', shares: [{ participantId: joana, shareInput: 1 }, { participantId: joana, shareInput: 1 }] }],
  })), /más de una vez/);

  // X1 — ids from another group are "gone" here, whatever the action.
  const foreign = await foreignIds(otherToken);
  await driver.refused('X1-expense-update', updateExpense(token, foreign.expense, single('1,00')), GONE);
  await driver.refused('X1-expense-delete', deleteExpense(token, foreign.expense), GONE);
  await driver.refused('X1-refund', createRefund(token, { expenseId: foreign.expense, receivedById: joana, amount: '1,00' }), GONE);
  await driver.refused('X1-payment', createPayment(token, { fromId: joana, toId: foreign.participant, amount: '1,00', date: '2026-09-01' }), GONE);
  await driver.refused('X1-share', createExpense(token, single('2,00', {
    items: [{ amount: '2,00', splitMode: 'EQUAL', shares: [{ participantId: foreign.participant, shareInput: 1 }] }],
  })), GONE);
  await driver.refused('X1-archive', archiveParticipant(token, foreign.participant), GONE);
  if (foreign.charge) await driver.refused('X1-charge', payGroupCharge(token, foreign.charge, { payerId: joana }), GONE);
  await driver.refused('X1-round', closeKittyRound(token, foreign.round, { action: 'CERRAR' }), GONE);
  await driver.refused('G12-carry-in', openKittyRound(token, { preexisting: '30000000' }), TOO_BIG);
  const round = await driver.ok(token, 'open a round here', openKittyRound(token, {}));
  await driver.refused('G12-contribution', addContributions(token, round.id, { contributions: [{ participantId: joana, amount: '30000000' }] }), TOO_BIG);
  await driver.refused('G12-spend', addSpend(token, round.id, { concept: 'Enorme', amount: '30000000' }), TOO_BIG);
  await driver.refused('X1-contribution', addContributions(token, round.id, { contributions: [{ participantId: foreign.participant, amount: '1,00' }] }), GONE);
  driver.cover('X1');
  // X2 — a token that does not exist.
  await driver.refused('X2', createExpense('x'.repeat(24), single('1,00')), /Grupo no encontrado/);

  // Gr1 — the whole group goes, only with its exact name.
  await driver.refused('Gr1-wrong-name', deleteGroup(token, 'limites'), /nombre/i);
  const deleted = await deleteGroup(token, 'Límites');
  expect(deleted.ok, 'Gr1 delete with the exact name').toBe(true);
  expect(await prisma.participant.count({ where: { groupId: token } }), 'Gr1 nothing of the group is left').toBe(0);
  expect(await prisma.kittyRound.count({ where: { groupId: token } })).toBe(0);
  expect(await prisma.activityLog.count({ where: { groupId: token } })).toBe(0);
  driver.cover('Gr1');
  return token;
}

async function foreignIds(groupId: string) {
  const [expense, participant, charge, round] = await Promise.all([
    prisma.expense.findFirstOrThrow({ where: { groupId } }),
    prisma.participant.findFirstOrThrow({ where: { groupId, archivedAt: null } }),
    prisma.groupCharge.findFirst({ where: { groupId } }),
    prisma.kittyRound.findFirstOrThrow({ where: { groupId, closedAt: null } }),
  ]);
  return { expense: expense.id, participant: participant.id, charge: charge?.id ?? null, round: round.id };
}
