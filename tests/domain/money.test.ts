import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MAX_AMOUNT_CENTS, asCents, formatCents, isAmountTooLarge, parseAmount, parseNonNegativeAmount, parseSignedAmount } from '../../src/domain/money';
import { DomainError } from '../../src/domain/errors';

describe('asCents', () => {
  it('accepts safe integers', () => {
    expect(asCents(1250)).toBe(1250);
    expect(asCents(0)).toBe(0);
    expect(asCents(-305)).toBe(-305);
  });

  it('rejects non-integers and unsafe integers', () => {
    expect(() => asCents(12.5)).toThrow(DomainError);
    expect(() => asCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(DomainError);
    expect(() => asCents(NaN)).toThrow(DomainError);
  });
});

describe('parseAmount', () => {
  it.each([
    ['12,50', 1250],
    ['12.50', 1250],
    ['12,5', 1250],
    ['12', 1200],
    ['0,01', 1],
    [' 7,00 ', 700],
  ])('parses %s to %d cents', (input, cents) => {
    expect(parseAmount(input)).toBe(cents);
  });

  it.each(['', 'abc', '12,345', '-5', '0', '0,00', '1.234,56', '12,50€', '1e3'])(
    'rejects %s',
    (input) => {
      expect(parseAmount(input)).toBeNull();
    },
  );
});

describe('parseNonNegativeAmount', () => {
  it.each([
    ['0', 0],
    ['0,00', 0],
    ['80,5', 8050],
  ])('parses %j to %d cents', (input, cents) => {
    expect(parseNonNegativeAmount(input)).toBe(cents);
  });

  it.each(['+5', '-5', '-0', '', 'abc', '1,234'])('rejects signed or unreadable input %j', (input) => {
    expect(parseNonNegativeAmount(input)).toBeNull();
  });

  it('agrees with parseAmount on every positive amount', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const positive = parseAmount(input);
        if (positive !== null) expect(parseNonNegativeAmount(input)).toBe(positive);
      }),
    );
  });
});

describe('parseSignedAmount', () => {
  it.each([
    ['-5,00', -500],
    ['+5,00', 500],
    ['0', 0],
    ['0,00', 0],
    ['12,50', 1250],
    ['-12,50', -1250],
    ['+12', 1200],
    ['-0,01', -1],
  ])('parses %s to %d cents', (input, cents) => {
    expect(parseSignedAmount(input)).toBe(cents);
  });

  it.each(['', 'abc', '1,234', '12,50€', '1e3', '--5', '5-'])(
    'rejects %s',
    (input) => {
      expect(parseSignedAmount(input)).toBeNull();
    },
  );
});

describe('the amount ceiling', () => {
  it('is one million euros, well inside the 32-bit database columns even summed a few times', () => {
    expect(MAX_AMOUNT_CENTS).toBe(100_000_000);
    expect(MAX_AMOUNT_CENTS * 20).toBeLessThan(2_147_483_647);
  });

  it('reads the ceiling itself and nothing above it, in every parser', () => {
    expect(parseAmount('1000000,00')).toBe(MAX_AMOUNT_CENTS);
    expect(parseAmount('1000000,01')).toBeNull();
    expect(parseNonNegativeAmount('99999999999999')).toBeNull();
    expect(parseSignedAmount('-1000000,00')).toBe(-MAX_AMOUNT_CENTS);
    expect(parseSignedAmount('-1000000,01')).toBeNull();
  });

  it.each([
    ['1000000,01', true],
    ['-1000000,01', true],
    ['99999999999999', true],
    ['1000000', false],
    ['12,50', false],
    ['abc', false],
    ['12,345', false],
  ])('knows %j is too large: %s', (input, tooLarge) => {
    expect(isAmountTooLarge(input)).toBe(tooLarge);
  });

  it('never parses what it calls too large (property)', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        if (isAmountTooLarge(input)) {
          expect(parseAmount(input)).toBeNull();
          expect(parseSignedAmount(input)).toBeNull();
        }
      }),
    );
  });
});

describe('formatCents', () => {
  it('formats with decimal comma', () => {
    expect(formatCents(asCents(1250))).toBe('12,50');
    expect(formatCents(asCents(5))).toBe('0,05');
    expect(formatCents(asCents(-305))).toBe('-3,05');
  });

  it('round-trips through parseAmount for every positive amount up to the ceiling (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_AMOUNT_CENTS }), (cents) => {
        return parseAmount(formatCents(asCents(cents))) === cents;
      }),
    );
  });
});
