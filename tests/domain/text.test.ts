import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeText, personNameKey } from '../../src/domain/text';

describe('normalizeText', () => {
  it.each([
    ['⁠Joana', 'Joana'], // pasted from WhatsApp: a word joiner before the name
    ['⁠Vanesa⁠ Po', 'Vanesa Po'],
    ['﻿Mati​', 'Mati'],
    ['  Vanesa   Po  ', 'Vanesa Po'],
    ['Vanesa Po', 'Vanesa Po'], // a non-breaking space is a space
    ['Ana\tMaría\n', 'Ana María'],
    ['Rubén', 'Rubén'], // decomposed accent (as some keyboards send it) → one character
    ['Cumple 🎂', 'Cumple 🎂'],
    ['👨‍👩‍👧', '👨‍👩‍👧'], // joiners inside an emoji sequence are kept
  ])('%j → %j', (raw, clean) => {
    expect(normalizeText(raw)).toBe(clean);
  });

  it('is idempotent and leaves no invisible or doubled spacing behind (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (raw) => {
        const clean = normalizeText(raw);
        expect(normalizeText(clean)).toBe(clean);
        expect(clean).toBe(clean.trim());
        expect(clean).not.toMatch(/\s{2}|[­​‎‏⁠﻿]/);
      }),
    );
  });
});

describe('personNameKey', () => {
  it('is the same for names that only differ in capitals, spacing or invisible characters', () => {
    const key = personNameKey('Vanesa Po');
    for (const variant of ['vanesa po', 'VANESA  PO', '⁠Vanesa⁠ Po', ' Vanesa Po ']) {
      expect(personNameKey(variant)).toBe(key);
    }
  });

  it('keeps accents: Rubén and Ruben are different names', () => {
    expect(personNameKey('Rubén')).not.toBe(personNameKey('Ruben'));
  });
});
