import { DomainError } from './errors';

export type Cents = number & { readonly __brand: 'Cents' };

export function asCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new DomainError('NOT_INTEGER_CENTS');
  return value as Cents;
}

/**
 * The largest amount any single typed value may hold: 1.000.000,00 €. The database
 * stores cents in 32-bit integers (up to 21.474.836,47 €), so an amount above this
 * ceiling — or a sum of a few — could never be stored; it is refused as input.
 */
export const MAX_AMOUNT_CENTS = 100_000_000;

const AMOUNT_RE = /^([+-])?(\d+)(?:[.,](\d{1,2}))?$/;

/** The typed text as signed cents and whether it carried a sign; null when unreadable. */
function read(input: string): { cents: number; signed: boolean } | null {
  const match = AMOUNT_RE.exec(input.trim());
  if (!match) return null;
  const whole = Number(match[2]);
  const fraction = match[3] ? Number(match[3].padEnd(2, '0')) : 0;
  const magnitude = whole * 100 + fraction;
  // Digits beyond exact integer range still read as an amount: a (far) too large one.
  const cents = (match[1] === '-' ? -1 : 1) * (Number.isSafeInteger(magnitude) ? magnitude : Infinity);
  return { cents, signed: match[1] !== undefined };
}

/** Readable as an amount, but beyond the ceiling (so no parser returns it). */
export function isAmountTooLarge(input: string): boolean {
  const value = read(input);
  return value !== null && Math.abs(value.cents) > MAX_AMOUNT_CENTS;
}

/**
 * Parse a user-typed amount ("12,50", "12.50", "12") into cents.
 * Accepts comma or dot as decimal separator, max 2 decimals, must be > 0.
 * Returns null for anything invalid — callers turn that into a typed error.
 */
export function parseAmount(input: string): Cents | null {
  const cents = parseNonNegativeAmount(input);
  return cents !== null && cents > 0 ? cents : null;
}

/**
 * Same unsigned syntax as parseAmount, but zero is allowed — for a declared
 * total the user may clear. No sign is accepted, not even "+" or "-0".
 */
export function parseNonNegativeAmount(input: string): Cents | null {
  const value = read(input);
  if (value === null || value.signed || value.cents > MAX_AMOUNT_CENTS) return null;
  return value.cents as Cents;
}

/**
 * Parse a user-typed signed delta ("-5,00", "+5,00", "0") into cents
 * Same comma/dot decimal rules as parseAmount, but accepts an
 * optional leading sign and zero — used ONLY for ADJUSTMENT delta fields
 * (parseAmount stays untouched for totals, which must stay positive).
 * Returns null for anything invalid.
 */
export function parseSignedAmount(input: string): Cents | null {
  const value = read(input);
  if (value === null || Math.abs(value.cents) > MAX_AMOUNT_CENTS) return null;
  return (value.cents === 0 ? 0 : value.cents) as Cents;
}

export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  return `${sign}${whole},${String(abs % 100).padStart(2, '0')}`;
}
