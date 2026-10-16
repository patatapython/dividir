export type DomainErrorCode =
  | 'NOT_INTEGER_CENTS'
  | 'NEGATIVE_TOTAL'
  | 'NO_BENEFICIARIES'
  | 'NEGATIVE_WEIGHT'
  | 'ZERO_WEIGHT_SUM'
  | 'PERCENT_SUM_MISMATCH'
  | 'EXACT_SUM_MISMATCH'
  | 'UNSAFE_INTEGER'
  | 'UNBALANCED'
  | 'TOO_MANY_FOR_EXACT'
  | 'DELTA_SUM_NONZERO'
  | 'PAYER_SUM_MISMATCH'
  | 'REFUND_EXCEEDS_EXPENSE'
  | 'ITEM_SUM_MISMATCH'
  | 'KITTY_NOTHING_TO_DISTRIBUTE'
  | 'KITTY_SPEND_EXCEEDS_BALANCE'
  | 'KITTY_BALANCE_NEGATIVE'
  | 'KITTY_ROUND_ALREADY_OPEN'
  | 'KITTY_ROUND_CLOSED'
  | 'DUPLICATE_PARTICIPANT';

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode) {
    super(code);
    this.name = 'DomainError';
  }
}
