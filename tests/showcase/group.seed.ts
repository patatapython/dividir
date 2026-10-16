import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { ActionResult } from '../../src/server/action-result';
import { createExpense } from '../../src/server/actions/expenses';
import { createGroup } from '../../src/server/actions/group';
import { createGroupCharge } from '../../src/server/actions/group-charge';
import { addContributions, addSpend, closeKittyRound, openKittyRound } from '../../src/server/actions/kitty';
import { claimParticipant } from '../../src/server/actions/participants';
import { createPayment } from '../../src/server/actions/payments';
import { prisma } from '../../src/server/db';
import { resetRateLimit } from '../../src/server/rate-limit';
import { cookieJar } from '../server/next-mocks';

/**
 * The fictional group of the README screenshots: five friends on a weekend in a
 * rural house. Every name is invented. It is seeded through the real server actions,
 * so the screenshots show exactly what the app computes. The ids the capture script
 * needs are written to tests/showcase/.out/manifest.json.
 */
const OUT = fileURLToPath(new URL('./.out/', import.meta.url));
const PEOPLE = ['Lucía', 'Mateo', 'Carmen', 'Diego', 'Sara'] as const;
type Person = (typeof PEOPLE)[number];

/**
 * Runs one action and dates the activity it wrote at `when` (Madrid time), so
 * Actividad tells the weekend as it happened instead of "today, all at once".
 */
async function at<T>(when: string, label: string, call: () => Promise<ActionResult<T>>): Promise<T> {
  const before = new Date();
  const result = await call();
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
  await prisma.activityLog.updateMany({ where: { createdAt: { gte: before } }, data: { createdAt: new Date(`${when}:00+02:00`) } });
  return result.data;
}

it('seeds the showcase group', async () => {
  resetRateLimit();
  const { token } = await at('2026-10-08T21:30', 'create group', () =>
    createGroup({ name: 'Casa rural en Asturias', participantNames: [...PEOPLE] }));
  const rows = await prisma.participant.findMany({ where: { groupId: token } });
  const id = (name: Person) => rows.find((p) => p.name === name)!.id;
  const everyone = PEOPLE.map(id);
  const equal = (people: string[]) => people.map((participantId) => ({ participantId, shareInput: 1 }));

  // Each friend acts from their own phone, so Actividad shows who did what.
  const as = async (name: Person) => {
    cookieJar.set(`participant_${token}`, id(name));
    await at('2026-10-08T21:35', `claim ${name}`, () => claimParticipant(token, id(name)));
  };

  // A bote round for the drive there, shared out on arrival.
  await as('Diego');
  const trip = await at('2026-10-09T09:10', 'open trip round', () => openKittyRound(token, { name: 'Viaje en coche' }));
  await at('2026-10-09T09:12', 'trip contributions', () => addContributions(token, trip.id, {
    contributions: [id('Diego'), id('Carmen'), id('Sara')].map((participantId) => ({ participantId, amount: '15,00' })),
  }));
  await at('2026-10-09T11:40', 'trip tolls', () => addSpend(token, trip.id, { concept: 'Peajes', amount: '18,60' }));
  await at('2026-10-09T12:05', 'trip coffee', () => addSpend(token, trip.id, { concept: 'Cafés en el área de servicio', amount: '9,45' }));
  await at('2026-10-09T13:30', 'trip share out', () => closeKittyRound(token, trip.id, { action: 'REPARTIR' }));

  await at('2026-10-09T13:45', 'fuel', () => createExpense(token, {
    title: 'Gasolina', date: '2026-10-09',
    payers: [{ participantId: id('Diego'), amount: '62,00' }],
    items: [{ amount: '62,00', splitMode: 'EQUAL', shares: equal([id('Diego'), id('Carmen'), id('Sara')]) }],
  }));

  await as('Lucía');
  await at('2026-10-09T14:00', 'rent', () => createExpense(token, {
    title: 'Alquiler de la casa', date: '2026-10-09',
    payers: [{ participantId: id('Lucía'), amount: '640,00' }],
    items: [{ amount: '640,00', splitMode: 'EQUAL', shares: equal(everyone) }],
  }));

  await as('Mateo');
  const groceries = await at('2026-10-09T18:20', 'groceries', () => createExpense(token, {
    title: 'Compra en el súper', date: '2026-10-09',
    payers: [{ participantId: id('Mateo'), amount: '87,45' }],
    items: [
      { label: 'Comida', amount: '62,45', splitMode: 'EQUAL', shares: equal(everyone) },
      {
        label: 'Vino y sidra', amount: '25,00', splitMode: 'SHARES',
        shares: ([['Lucía', 2], ['Mateo', 1], ['Diego', 2], ['Sara', 1]] as const)
          .map(([name, weight]) => ({ participantId: id(name), shareInput: weight })),
      },
    ],
  }));

  // The bote of the weekend itself, still open.
  await as('Sara');
  const weekend = await at('2026-10-09T20:00', 'open weekend round', () => openKittyRound(token, { name: 'Fin de semana' }));
  await at('2026-10-09T20:05', 'weekend contributions', () => addContributions(token, weekend.id, {
    contributions: everyone.map((participantId) => ({ participantId, amount: '20,00' })),
  }));
  await at('2026-10-10T19:00', 'ice', () => addSpend(token, weekend.id, { concept: 'Hielo y bebidas', amount: '23,40' }));
  await at('2026-10-11T09:30', 'bread', () => addSpend(token, weekend.id, { concept: 'Pan y desayunos', amount: '18,75' }));

  await as('Carmen');
  await at('2026-10-10T23:10', 'dinner', () => createExpense(token, {
    title: 'Cena en la sidrería', date: '2026-10-10',
    payers: [{ participantId: id('Carmen'), amount: '100,00' }, { participantId: id('Sara'), amount: '56,80' }],
    items: [{ amount: '156,80', splitMode: 'EQUAL', shares: equal(everyone) }],
  }));

  await as('Sara');
  await at('2026-10-11T13:00', 'kayak', () => createExpense(token, {
    title: 'Kayak en el Sella', date: '2026-10-11',
    payers: [{ participantId: id('Sara'), amount: '150,00' }],
    items: [{ amount: '150,00', splitMode: 'EQUAL', shares: equal([id('Lucía'), id('Mateo'), id('Sara')]) }],
  }));

  await as('Lucía');
  await at('2026-10-12T12:30', 'cheese', () => createExpense(token, {
    title: 'Quesos para llevar', date: '2026-10-12',
    payers: [{ participantId: id('Lucía'), amount: '34,20' }],
    items: [{ amount: '34,20', splitMode: 'EXACT', shares: [{ participantId: id('Mateo'), shareInput: 1240 }, { participantId: id('Carmen'), shareInput: 2180 }] }],
  }));

  await as('Mateo');
  await at('2026-10-12T17:00', 'payment', () =>
    createPayment(token, { fromId: id('Mateo'), toId: id('Lucía'), amount: '50,00', date: '2026-10-12' }));

  await as('Carmen');
  await at('2026-10-12T17:30', 'cleaning', () => createGroupCharge(token, {
    concept: 'Limpieza de la casa', date: '2026-10-12', amount: '60,00', splitMode: 'EQUAL', shares: equal(everyone),
  }));

  expect(await prisma.expense.count({ where: { groupId: token } })).toBe(6);
  mkdirSync(OUT, { recursive: true });
  const manifest = { token, viewer: id('Lucía'), itemizedExpense: groceries.id, closedRound: trip.id };
  writeFileSync(`${OUT}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
});
