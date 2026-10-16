import { describe, expect, it } from 'vitest';
import { asCents } from '@/domain/money';
import { formatEuros, formatSignedEuros } from '@/app/_ui/money-format';

describe('formatEuros', () => {
  it('appends the euro suffix', () => {
    expect(formatEuros(asCents(1250))).toBe('12,50 €');
  });
});

describe('formatSignedEuros', () => {
  it('prefixes credits with +', () => expect(formatSignedEuros(asCents(4230))).toBe('+42,30 €'));
  it('uses U+2212 for debts', () => expect(formatSignedEuros(asCents(-1875))).toBe('−18,75 €'));
  it('renders zero unsigned', () => expect(formatSignedEuros(asCents(0))).toBe('0,00 €'));
});
