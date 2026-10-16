import { describe, expect, it } from 'vitest';
import { activityHref } from '../../src/app/g/[token]/actividad/activity-href';

const T = 't'.repeat(24);

describe('activityHref — where an activity entry leads', () => {
  it('an expense opens its form', () => {
    expect(activityHref(T, { kind: 'expense', id: 'e1' })).toBe(`/g/${T}/gastos/e1`);
  });

  it('a gasto sin pagar opens its own form', () => {
    expect(activityHref(T, { kind: 'charge', id: 'c1' })).toBe(`/g/${T}/gastos/sin-pagar/c1`);
  });

  it('the bote leads to the open round, or to the closed round\'s own page', () => {
    expect(activityHref(T, { kind: 'kitty', roundId: 'r1', closed: false })).toBe(`/g/${T}/bote`);
    expect(activityHref(T, { kind: 'kitty', roundId: 'r1', closed: true })).toBe(`/g/${T}/bote/cerradas/r1`);
  });

  it('people are managed in Ajustes', () => {
    expect(activityHref(T, { kind: 'participants' })).toBe(`/g/${T}/ajustes`);
  });
});
