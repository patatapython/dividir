import type { CSSProperties } from 'react';
import { Cents } from '@/domain/money';
import { formatEuros, formatSignedEuros } from './money-format';

/**
 * An amount, never split across lines. With `fit` it also carries its length in
 * characters (--amount-chars), so the box that must hold it — a saldo card — can size
 * it to fit instead of shrinking every amount alike (session 11, F-08).
 */
export function MoneyAmount({ cents, signed = false, fit = false }: { cents: Cents; signed?: boolean; fit?: boolean }) {
  const cls = signed ? `money ${cents > 0 ? 'money--pos' : cents < 0 ? 'money--neg' : ''}` : 'money';
  const text = signed ? formatSignedEuros(cents) : formatEuros(cents);
  const style = fit ? ({ '--amount-chars': text.length } as CSSProperties) : undefined;
  return (
    <span className={cls.trim()} style={style}>
      {text}
    </span>
  );
}
