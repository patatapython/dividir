import { describe, expect, it } from 'vitest';
import { ownerlessStatus } from '../../src/app/g/[token]/ownerless-status';

describe('ownerlessStatus — what is left of the declared leftover', () => {
  it('says how much is left while there is some', () => {
    expect(ownerlessStatus(8000)).toBe('quedan 80,00 €');
  });

  it('says nothing is left at exactly zero', () => {
    expect(ownerlessStatus(0)).toBe('quedan 0,00 €');
  });

  it('names an overshoot as money applied beyond the declared total, never a negative "quedan"', () => {
    expect(ownerlessStatus(-500)).toBe('aplicado 5,00 € de más');
  });
});
