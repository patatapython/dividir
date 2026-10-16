import { asCents } from '@/domain/money';
import { formatEuros } from '@/app/_ui/money-format';

/**
 * What is left of the declared leftover ("Sobrante"), in the one wording every screen
 * shares. The remaining figure is derived on the server (declared − applied) and goes
 * negative when more was applied than declared: that is said as an overshoot, never
 * as a negative "quedan".
 */
export function ownerlessStatus(remainingCents: number): string {
  return remainingCents >= 0
    ? `quedan ${formatEuros(asCents(remainingCents))}`
    : `aplicado ${formatEuros(asCents(-remainingCents))} de más`;
}
