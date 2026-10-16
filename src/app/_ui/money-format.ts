import { Cents, asCents, formatCents } from '@/domain/money';

export function formatEuros(cents: Cents): string {
  return `${formatCents(cents)} €`;
}

export function formatSignedEuros(cents: Cents): string {
  if (cents > 0) return `+${formatCents(cents)} €`;
  if (cents < 0) return `−${formatCents(asCents(-cents))} €`;
  return `${formatCents(cents)} €`;
}
