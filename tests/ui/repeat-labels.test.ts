import { describe, expect, it } from 'vitest';
import { labelSpends, orderContributionsWithLabels } from '@/app/_ui/repeat-labels';

describe('orderContributionsWithLabels', () => {
  it('sorts by participant name', () => {
    const result = orderContributionsWithLabels([
      { id: '1', participantId: 'p-jose', participantName: 'jose', amountCents: 5000 },
      { id: '2', participantId: 'p-alba', participantName: 'alba', amountCents: 5000 },
    ]);
    expect(result.map((c) => c.participantName)).toEqual(['alba', 'jose']);
  });

  it('leaves a single-contribution participant unlabeled', () => {
    const result = orderContributionsWithLabels([
      { id: '1', participantId: 'p-alba', participantName: 'alba', amountCents: 5000 },
    ]);
    expect(result[0].displayLabel).toBe('alba');
  });

  it('numbers repeat contributions from the same participant in original order', () => {
    const result = orderContributionsWithLabels([
      { id: '1', participantId: 'p-jose', participantName: 'jose', amountCents: 5000 },
      { id: '2', participantId: 'p-alba', participantName: 'alba', amountCents: 5000 },
      { id: '3', participantId: 'p-jose', participantName: 'jose', amountCents: 1000 },
    ]);
    const jose = result.filter((c) => c.participantId === 'p-jose');
    expect(jose.map((c) => c.displayLabel)).toEqual(['jose 1', 'jose 2']);
    expect(jose.map((c) => c.id)).toEqual(['1', '3']);
  });

  it('keeps different participants independently numbered', () => {
    const result = orderContributionsWithLabels([
      { id: '1', participantId: 'p-jose', participantName: 'jose', amountCents: 5000 },
      { id: '2', participantId: 'p-jose', participantName: 'jose', amountCents: 1000 },
      { id: '3', participantId: 'p-alba', participantName: 'alba', amountCents: 5000 },
      { id: '4', participantId: 'p-alba', participantName: 'alba', amountCents: 2000 },
    ]);
    expect(result.map((c) => c.displayLabel)).toEqual(['alba 1', 'alba 2', 'jose 1', 'jose 2']);
  });
});

// Session 12 loopback: two spends with the same concept ("Hielo" bought twice) were
// two rows, editors and delete buttons with one and the same accessible name.
describe('labelSpends', () => {
  it('keeps the spends in their order and a lone concept unlabeled', () => {
    const result = labelSpends([{ id: 's1', concept: 'Hielo' }, { id: 's2', concept: 'Cañas' }]);
    expect(result.map((s) => [s.id, s.displayLabel])).toEqual([['s1', 'Hielo'], ['s2', 'Cañas']]);
  });

  it('numbers repeats of a concept, capitals and stray spaces aside, in order', () => {
    const result = labelSpends([
      { id: 's1', concept: 'Hielo' },
      { id: 's2', concept: 'Cañas' },
      { id: 's3', concept: 'hielo ' },
    ]);
    expect(result.map((s) => s.displayLabel)).toEqual(['Hielo 1', 'Cañas', 'hielo 2']);
  });
});
