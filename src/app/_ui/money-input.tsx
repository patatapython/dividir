'use client';
import { useId } from 'react';
import { parseAmount, parseSignedAmount } from '@/domain/money';
import { INVALID_AMOUNT, INVALID_SIGNED_AMOUNT, unreadableAmountMessage } from '@/server/amount-messages';
import { Field } from './field';
import { useCommittedVerdict } from './use-committed-verdict';

/**
 * An amount field, judged when the user leaves it (useCommittedVerdict). There is no placeholder on
 * purpose: a sample amount reads as an amount already entered.
 */
export function MoneyInput({ label, value, onChange, signed = false, hero = false, inline = false }: {
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  signed?: boolean;
  /** The protagonist amount of a form. */
  hero?: boolean;
  /** Label and amount on one row, as in a per-person list. */
  inline?: boolean;
}) {
  const parse = signed ? parseSignedAmount : parseAmount;
  const errorId = useId();
  const { showError, commit } = useCommittedVerdict(value, (v) => v.trim() !== '' && parse(v) === null);
  const className = [hero && 'field--amount', inline && 'field--inline'].filter(Boolean).join(' ') || undefined;

  return (
    <Field
      label={label}
      error={showError ? unreadableAmountMessage(value, signed ? INVALID_SIGNED_AMOUNT : INVALID_AMOUNT) : null}
      errorId={errorId}
      className={className}
    >
      <input
        className="mono"
        inputMode="decimal"
        value={value}
        aria-invalid={showError || undefined}
        aria-describedby={showError ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
      />
    </Field>
  );
}
