import { describe, expect, it } from 'vitest';
import { shownCount, showMoreState, type PageSpec } from '../../src/app/_ui/show-more';

const SPEC: PageSpec = { pageSize: 20, max: 100 };

describe('shownCount — how many rows the URL asks for', () => {
  it('starts at one page when the parameter is absent', () => {
    expect(shownCount(undefined, SPEC)).toBe(20);
  });

  it('honours a plain positive integer', () => {
    expect(shownCount('40', SPEC)).toBe(40);
  });

  it('never shows less than one page', () => {
    expect(shownCount('3', SPEC)).toBe(20);
    expect(shownCount('0', SPEC)).toBe(20);
  });

  it('clamps a hand-typed huge value to the maximum', () => {
    expect(shownCount('999999', SPEC)).toBe(100);
  });

  it('ignores anything that is not a plain integer', () => {
    for (const raw of ['', 'abc', '-40', '40.5', '4e1', ' 40', '0x28']) {
      expect(shownCount(raw, SPEC)).toBe(20);
    }
  });

  it('reads the first value when the parameter is repeated', () => {
    expect(shownCount(['60', '80'], SPEC)).toBe(60);
  });
});

describe('showMoreState — what sits under the list', () => {
  it('nothing more when everything is already shown', () => {
    expect(showMoreState(20, 7, SPEC)).toEqual({ kind: 'all', visible: 7 });
    expect(showMoreState(40, 40, SPEC)).toEqual({ kind: 'all', visible: 40 });
  });

  it('offers the next page while there is more below the maximum', () => {
    expect(showMoreState(20, 85, SPEC)).toEqual({ kind: 'more', visible: 20, next: 40 });
  });

  it('never offers beyond the maximum', () => {
    expect(showMoreState(90, 500, { pageSize: 20, max: 100 })).toEqual({ kind: 'more', visible: 90, next: 100 });
  });

  it('says the cap was reached instead of hiding the rest silently', () => {
    expect(showMoreState(100, 500, SPEC)).toEqual({ kind: 'capped', visible: 100 });
  });
});
