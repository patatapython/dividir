import { describe, expect, it } from 'vitest';
import {
  MAX_RECENT_GROUPS,
  forgetGroup,
  missingGroupToken,
  parseRecentGroups,
  rememberGroup,
} from '@/app/_ui/recent-groups';

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'b_b-bbbbbbbbbbbbbbbbbbbb';

describe('parseRecentGroups — what this device remembers is read defensively', () => {
  it('reads nothing stored as an empty list', () => {
    expect(parseRecentGroups(null)).toEqual([]);
  });

  it('ignores stored text that is not a list of groups', () => {
    expect(parseRecentGroups('not json')).toEqual([]);
    expect(parseRecentGroups('{"token":"x"}')).toEqual([]);
  });

  it('keeps only well-formed entries', () => {
    const raw = JSON.stringify([
      { token: TOKEN_A, name: 'Piso', visitedAt: 2 },
      { token: 42, name: 'Roto', visitedAt: 1 },
      { token: 'short', name: 'Token malo', visitedAt: 1 },
      { token: TOKEN_B, name: 'Viaje' },
    ]);
    expect(parseRecentGroups(raw)).toEqual([{ token: TOKEN_A, name: 'Piso', visitedAt: 2 }]);
  });
});

describe('rememberGroup', () => {
  it('puts the visited group first and refreshes its name', () => {
    const list = [
      { token: TOKEN_B, name: 'Viaje', visitedAt: 2 },
      { token: TOKEN_A, name: 'Piso viejo', visitedAt: 1 },
    ];
    expect(rememberGroup(list, { token: TOKEN_A, name: 'Piso' }, 3)).toEqual([
      { token: TOKEN_A, name: 'Piso', visitedAt: 3 },
      { token: TOKEN_B, name: 'Viaje', visitedAt: 2 },
    ]);
  });

  it(`keeps at most ${MAX_RECENT_GROUPS} groups, dropping the least recent`, () => {
    const many = Array.from({ length: MAX_RECENT_GROUPS }, (_, i) => ({
      token: String(i).padStart(24, 'x'),
      name: `G${i}`,
      visitedAt: MAX_RECENT_GROUPS - i,
    }));
    const next = rememberGroup(many, { token: TOKEN_A, name: 'Nuevo' }, 100);
    expect(next).toHaveLength(MAX_RECENT_GROUPS);
    expect(next[0].token).toBe(TOKEN_A);
    expect(next.map((g) => g.name)).not.toContain(`G${MAX_RECENT_GROUPS - 1}`);
  });
});

describe('forgetGroup', () => {
  it('drops the group and leaves the rest in order', () => {
    const list = [
      { token: TOKEN_A, name: 'Piso', visitedAt: 2 },
      { token: TOKEN_B, name: 'Viaje', visitedAt: 1 },
    ];
    expect(forgetGroup(list, TOKEN_A)).toEqual([{ token: TOKEN_B, name: 'Viaje', visitedAt: 1 }]);
  });
});

describe('missingGroupToken — a remembered link that leads nowhere', () => {
  // Only the unknown-group boundary (app/g/not-found.tsx) asks: reaching it means the
  // group layout found no group for the token, whatever page below it was asked for.
  it('is the token of any path under a group that is not found', () => {
    expect(missingGroupToken(`/g/${TOKEN_B}`)).toBe(TOKEN_B);
    expect(missingGroupToken(`/g/${TOKEN_B}/`)).toBe(TOKEN_B);
    expect(missingGroupToken(`/g/${TOKEN_A}/gastos/nuevo`)).toBe(TOKEN_A);
  });

  it('is nothing for a path that is not a group link', () => {
    expect(missingGroupToken('/no-existe')).toBeNull();
    expect(missingGroupToken('/g/short')).toBeNull();
    expect(missingGroupToken('/g/short/gastos')).toBeNull();
  });
});
