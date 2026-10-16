import { describe, expect, it } from 'vitest';
import { identityOptions } from '@/app/g/[token]/identity-options';

const people = [
  { id: 'a', name: 'Ana', claimedAt: new Date('2026-09-01'), archivedAt: null },
  { id: 'b', name: 'Bea', claimedAt: new Date('2026-09-02'), archivedAt: null },
  { id: 'c', name: 'Carlos', claimedAt: null, archivedAt: null },
  { id: 'd', name: 'Dani', claimedAt: null, archivedAt: new Date('2026-09-03') },
];

describe('identityOptions', () => {
  it('offers only active participants', () => {
    expect(identityOptions(people, undefined).map((o) => o.name)).toEqual(['Ana', 'Bea', 'Carlos']);
  });

  it('with nobody chosen here, flags everyone claimed on some device', () => {
    expect(identityOptions(people, undefined)).toEqual([
      { id: 'a', name: 'Ana', current: false, claimedElsewhere: true },
      { id: 'b', name: 'Bea', current: false, claimedElsewhere: true },
      { id: 'c', name: 'Carlos', current: false, claimedElsewhere: false },
    ]);
  });

  it('marks this device\'s identity as current, never as claimed elsewhere', () => {
    const ana = identityOptions(people, 'a').find((o) => o.id === 'a');
    expect(ana).toEqual({ id: 'a', name: 'Ana', current: true, claimedElsewhere: false });
  });

  it('keeps this device\'s identity even after it was archived, so it is not asked again', () => {
    expect(identityOptions(people, 'd').map((o) => [o.name, o.current])).toEqual([
      ['Ana', false], ['Bea', false], ['Carlos', false], ['Dani', true],
    ]);
  });

  it('ignores a stale cookie that names nobody in the group', () => {
    expect(identityOptions(people, 'zzz').some((o) => o.current)).toBe(false);
  });
});
