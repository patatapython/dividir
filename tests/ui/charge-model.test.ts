import { describe, expect, it } from 'vitest';
import {
  initialCharge,
  fromChargeForEdit,
  toChargeInput,
  chargePreview,
  chargeProblems,
  setSplitMode,
  updateChargeShare,
} from '@/app/g/[token]/gastos/charge-model';

const PERSONS = ['a', 'b', 'c', 'd'];
const TODAY = '2026-07-16';

describe('initialCharge', () => {
  it('starts empty, EQUAL, everyone included', () => {
    const s = initialCharge(PERSONS, TODAY);
    expect(s.concept).toBe('');
    expect(s.date).toBe(TODAY);
    expect(s.splitMode).toBe('EQUAL');
    expect(s.shares).toHaveLength(4);
    expect(s.shares.every((r) => r.included)).toBe(true);
    expect(toChargeInput(s)).toBeNull(); // no concept, no amount
    expect(chargeProblems(s)).toEqual([{ kind: 'title-missing' }, { kind: 'amount-missing' }]);
  });
});

describe('toChargeInput', () => {
  it('produces a valid charge input (casa rural 400 equal among 4)', () => {
    let s = initialCharge(PERSONS, TODAY);
    s = { ...s, concept: 'Casa rural', amountRaw: '400,00' };
    expect(toChargeInput(s)).toEqual({
      concept: 'Casa rural',
      date: TODAY,
      amount: 40000,
      splitMode: 'EQUAL',
      shares: PERSONS.map((p) => ({ participantId: p, shareInput: 1 })),
    });
  });

  it('is null until a concept is given', () => {
    let s = initialCharge(PERSONS, TODAY);
    s = { ...s, amountRaw: '400,00' };
    expect(toChargeInput(s)).toBeNull();
  });

  it('excludes unchecked participants from an EQUAL split', () => {
    let s = initialCharge(PERSONS, TODAY);
    s = { ...s, concept: 'Casa', amountRaw: '300,00' };
    s = updateChargeShare(s, 'd', { included: false });
    const input = toChargeInput(s);
    expect(input?.shares).toEqual([
      { participantId: 'a', shareInput: 1 },
      { participantId: 'b', shareInput: 1 },
      { participantId: 'c', shareInput: 1 },
    ]);
  });
});

describe('chargePreview', () => {
  it('splits the amount equally', () => {
    let s = initialCharge(PERSONS, TODAY);
    s = { ...s, concept: 'Casa rural', amountRaw: '400,00' };
    expect(chargePreview(s)).toEqual({
      rows: PERSONS.map((p) => ({ participantId: p, amountCents: 10000 })),
    });
  });

  it('shows nothing while a weighted split does not add up, and says why', () => {
    let s = initialCharge(PERSONS, TODAY);
    s = { ...s, concept: 'Casa', amountRaw: '100,00' };
    s = setSplitMode(s, 'PERCENTAGE');
    s = updateChargeShare(s, 'c', { included: false });
    s = updateChargeShare(s, 'd', { included: false });
    s = updateChargeShare(s, 'a', { raw: '50' });
    s = updateChargeShare(s, 'b', { raw: '10' });
    expect(chargePreview(s)).toBeNull();
    expect(chargeProblems(s)).toEqual([{ kind: 'percent-sum', sum: 6000 }]);
    expect(toChargeInput(s)).toBeNull();
  });
});

describe('fromChargeForEdit round-trip', () => {
  it('reconstructs an EQUAL charge back to the same input', () => {
    const sample = {
      id: 'c1',
      concept: 'Casa rural',
      amountCents: 40000,
      date: TODAY,
      splitMode: 'EQUAL' as const,
      shares: PERSONS.map((p) => ({ participantId: p, shareInput: 1 })),
    };
    expect(toChargeInput(fromChargeForEdit(sample, PERSONS))).toEqual({
      concept: 'Casa rural',
      date: TODAY,
      amount: 40000,
      splitMode: 'EQUAL',
      shares: PERSONS.map((p) => ({ participantId: p, shareInput: 1 })),
    });
  });

  it('reconstructs a PERCENTAGE charge over a subset', () => {
    const shares = [
      { participantId: 'a', shareInput: 6000 },
      { participantId: 'c', shareInput: 4000 },
    ];
    const sample = { id: 'c2', concept: 'Luz', amountCents: 12345, date: TODAY, splitMode: 'PERCENTAGE' as const, shares };
    expect(toChargeInput(fromChargeForEdit(sample, PERSONS))).toEqual({
      concept: 'Luz',
      date: TODAY,
      amount: 12345,
      splitMode: 'PERCENTAGE',
      shares,
    });
  });

  it('does not pull a later joiner into an ADJUSTMENT charge on edit', () => {
    const shares = [
      { participantId: 'a', shareInput: 300 },
      { participantId: 'b', shareInput: -300 },
      { participantId: 'c', shareInput: 0 },
    ];
    const sample = { id: 'c3', concept: 'Gas', amountCents: 9000, date: TODAY, splitMode: 'ADJUSTMENT' as const, shares };
    // 'd' joined after the charge was saved.
    expect(toChargeInput(fromChargeForEdit(sample, PERSONS))?.shares).toEqual(shares);
  });
});
