import type { Rng } from './rng';
import { typed } from './driver';

/**
 * Builders for realistic inputs, shaped exactly like the forms send them
 * (decimal-comma amounts; shareInput per split mode as src/domain/split.ts reads it).
 */
export type Mode = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES' | 'ADJUSTMENT';
export const MODES: readonly Mode[] = ['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES', 'ADJUSTMENT'];

export interface ShareIn { participantId: string; shareInput: number }
export interface ItemIn { label?: string; amount: string; splitMode: Mode; shares: ShareIn[] }
export interface PayerIn { participantId: string | null; amount: string }
export interface ExpenseIn { title: string; date: string; payers: PayerIn[]; items: ItemIn[] }

/** What a big group spends money on, with a plausible range in euros. */
const CONCEPTS: { title: string; min: number; max: number; lines?: string[] }[] = [
  { title: 'Cena en el asador', min: 180, max: 900, lines: ['Carne', 'Vino', 'Postres', 'Cafés'] },
  { title: 'Cañas en la plaza', min: 12, max: 95 },
  { title: 'Vermú del domingo', min: 20, max: 120 },
  { title: 'Gasolina de la furgoneta', min: 45, max: 110 },
  { title: 'Supermercado para la peña', min: 40, max: 320, lines: ['Bebida', 'Hielo', 'Comida', 'Vasos y platos'] },
  { title: 'Charanga de fiestas', min: 300, max: 1200 },
  { title: 'Lotería de Navidad', min: 20, max: 400 },
  { title: 'Camisetas de la quinta', min: 150, max: 600, lines: ['Camisetas', 'Estampado', 'Envío'] },
  { title: 'Almuerzo en el bar', min: 30, max: 160 },
  { title: 'Alquiler del local', min: 200, max: 800 },
  { title: 'Autobús a la romería', min: 250, max: 700 },
  { title: 'Pinchos y bravas', min: 15, max: 90 },
  { title: 'Regalo de cumpleaños', min: 30, max: 200 },
  { title: 'Entradas del concierto', min: 60, max: 540 },
  { title: 'Paella popular', min: 90, max: 450, lines: ['Arroz y marisco', 'Leña', 'Bebida'] },
];

export function isoDay(start: Date, offsetDays: number): string {
  const day = new Date(start.getTime() + offsetDays * 86_400_000);
  return day.toISOString().slice(0, 10);
}

/** Splits `total` cents into `n` positive integer parts, uneven like real tickets. */
function randomParts(rng: Rng, total: number, n: number): number[] {
  if (total < n) throw new Error('cannot split below one cent each');
  const cuts = new Set<number>();
  while (cuts.size < n - 1) cuts.add(rng.int(1, total - 1));
  const points = [0, ...[...cuts].sort((a, b) => a - b), total];
  return points.slice(1).map((p, i) => p - points[i]);
}

/** One item's shares for `people`, valid for `mode` and `cents`. */
export function sharesFor(rng: Rng, mode: Mode, cents: number, people: string[]): ShareIn[] {
  switch (mode) {
    case 'EQUAL':
      return people.map((participantId) => ({ participantId, shareInput: 1 }));
    case 'SHARES':
      return people.map((participantId) => ({ participantId, shareInput: rng.int(1, 4) }));
    case 'PERCENTAGE': {
      const parts = randomParts(rng, 10_000, people.length);
      return people.map((participantId, i) => ({ participantId, shareInput: parts[i] }));
    }
    case 'EXACT': {
      const parts = randomParts(rng, cents, people.length);
      return people.map((participantId, i) => ({ participantId, shareInput: parts[i] }));
    }
    case 'ADJUSTMENT': {
      // Deltas that sum to 0 and never push a share below zero: move up to a
      // quarter of the smallest equal share from one person to another.
      const base = Math.floor(cents / people.length);
      const deltas = people.map(() => 0);
      const moves = rng.int(1, Math.max(1, Math.floor(people.length / 2)));
      for (let m = 0; m < moves && people.length > 1 && base >= 4; m++) {
        const from = rng.int(0, people.length - 1);
        let to = rng.int(0, people.length - 1);
        if (to === from) to = (from + 1) % people.length;
        const amount = rng.int(1, Math.floor(base / 4));
        deltas[from] -= amount;
        deltas[to] += amount;
      }
      return people.map((participantId, i) => ({ participantId, shareInput: deltas[i] }));
    }
  }
}

export interface ExpenseOptions {
  date: string;
  active: string[];
  /** Force a mode for the single item (otherwise random). */
  mode?: Mode;
  itemized?: boolean;
  payerCount?: number;
  /** Cents paid by "Sobrante" (null payer); may be the whole amount. */
  ownerlessCents?: number;
}

export function buildExpense(rng: Rng, options: ExpenseOptions): ExpenseIn {
  const concept = rng.pick(CONCEPTS);
  const itemized = options.itemized ?? false;
  const lineLabels = itemized ? rng.sample(concept.lines ?? ['Primera parte', 'Segunda parte', 'Tercera parte'], rng.int(2, 3)) : [undefined];
  const items: ItemIn[] = lineLabels.map((label) => {
    const cents = rng.int(concept.min * 100, concept.max * 100) / lineLabels.length;
    const amount = Math.max(Math.round(cents), 100);
    const mode = options.mode ?? rng.pick(MODES);
    const count = Math.min(options.active.length, rng.chance(0.3) ? options.active.length : rng.int(2, Math.min(14, options.active.length)));
    const people = rng.sample(options.active, count);
    return { ...(label ? { label } : {}), amount: typed(amount), splitMode: mode, shares: sharesFor(rng, mode, amount, people) };
  });
  const total = items.reduce((sum, item) => sum + centsOf(item.amount), 0);
  return { title: concept.title, date: options.date, payers: buildPayers(rng, total, options), items };
}

function buildPayers(rng: Rng, total: number, options: ExpenseOptions): PayerIn[] {
  const ownerless = Math.min(options.ownerlessCents ?? 0, total);
  const rest = total - ownerless;
  const payers: PayerIn[] = ownerless > 0 ? [{ participantId: null, amount: typed(ownerless) }] : [];
  if (rest === 0) return payers;
  const count = Math.min(options.payerCount ?? 1, rest, options.active.length);
  const who = rng.sample(options.active, count);
  const parts = count === 1 ? [rest] : randomParts(rng, rest, count);
  return [...payers, ...who.map((participantId, i) => ({ participantId, amount: typed(parts[i]) }))];
}

export function centsOf(amount: string): number {
  const [whole, fraction = '0'] = amount.split(',');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function totalOf(expense: ExpenseIn): number {
  return expense.items.reduce((sum, item) => sum + centsOf(item.amount), 0);
}
