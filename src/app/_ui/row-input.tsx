'use client';
import { useId } from 'react';
import { useCommittedVerdict } from './use-committed-verdict';

/**
 * A value typed inside a list row (a share, a payer's part): the row names it, so the label is for
 * assistive technology only. Its unit sits beside it instead of a sample placeholder, and its error lands
 * right under the row, judged on blur like every value (useCommittedVerdict). Returns row children:
 * the row's CSS lets the error take a full line (`.share-row .error`, `.payer-cell .error`).
 */
export function RowInput({ label, value, onChange, isInvalid, errorText, unit }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isInvalid: (value: string) => boolean;
  errorText: string;
  unit?: string;
}) {
  const errorId = useId();
  const { showError, commit } = useCommittedVerdict(value, isInvalid);
  return (
    <>
      <span className="row-input">
        <input
          className="mono"
          inputMode="decimal"
          aria-label={label}
          value={value}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={commit}
        />
        {unit && <span className="row-unit" aria-hidden="true">{unit}</span>}
      </span>
      {showError && <p id={errorId} className="error" role="alert">{errorText}</p>}
    </>
  );
}
