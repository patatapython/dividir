import type { DomainErrorCode } from '@/domain/errors';

const MESSAGES: Record<DomainErrorCode, string> = {
  NOT_INTEGER_CENTS: 'Importe no válido',
  NEGATIVE_TOTAL: 'El importe debe ser mayor que cero',
  NO_BENEFICIARIES: 'Elige al menos un beneficiario',
  NEGATIVE_WEIGHT: 'Las partes no pueden ser negativas',
  ZERO_WEIGHT_SUM: 'Al menos una parte debe ser mayor que cero',
  PERCENT_SUM_MISMATCH: 'Los porcentajes deben sumar exactamente 100 %',
  EXACT_SUM_MISMATCH: 'Los importes deben sumar exactamente el total',
  UNSAFE_INTEGER: 'Importe demasiado grande',
  UNBALANCED: 'Los balances no cuadran',
  TOO_MANY_FOR_EXACT: 'Demasiados participantes para el cálculo exacto',
  DELTA_SUM_NONZERO: 'Los ajustes deben sumar cero',
  PAYER_SUM_MISMATCH: 'Los importes de los pagadores deben sumar el total',
  REFUND_EXCEEDS_EXPENSE: 'El reembolso supera el importe pendiente del gasto',
  ITEM_SUM_MISMATCH: 'Los ítems deben sumar el total del gasto',
  KITTY_NOTHING_TO_DISTRIBUTE: 'No hay nada que repartir',
  KITTY_SPEND_EXCEEDS_BALANCE: 'El gasto supera el saldo del bote',
  KITTY_BALANCE_NEGATIVE: 'El bote no puede quedar en negativo',
  KITTY_ROUND_ALREADY_OPEN: 'Ya hay una ronda abierta',
  KITTY_ROUND_CLOSED: 'La ronda del bote ya está cerrada',
  DUPLICATE_PARTICIPANT: 'Un participante no puede aparecer más de una vez',
};

export const domainErrorMessage = (code: DomainErrorCode): string => MESSAGES[code];
