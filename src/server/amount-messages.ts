import { isAmountTooLarge } from '@/domain/money';

/**
 * What a person reads when a typed amount can't be taken, said the same way by the
 * form (on blur) and by the server (on save). Pure: safe in client components.
 */
export const INVALID_AMOUNT = 'Importe no válido (ejemplo: 12,50)';
export const INVALID_SIGNED_AMOUNT = 'Importe no válido (ejemplo: -5,00)';
export const AMOUNT_TOO_LARGE = 'Importe demasiado grande (máximo 1.000.000 €)';

/** Why `raw` is not an amount: beyond the ceiling, or simply unreadable (`unreadable`). */
export function unreadableAmountMessage(raw: string, unreadable: string = INVALID_AMOUNT): string {
  return isAmountTooLarge(raw) ? AMOUNT_TOO_LARGE : unreadable;
}
