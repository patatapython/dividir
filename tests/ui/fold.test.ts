import { describe, expect, it } from 'vitest';
import { FOLD_LIMIT, foldState } from '../../src/app/_ui/fold';

describe('foldState — a long read list shows its first rows until expanded (D-09)', () => {
  it('folds to five rows', () => {
    expect(FOLD_LIMIT).toBe(5);
  });

  it('leaves a list of five or fewer alone: nothing to fold, no toggle', () => {
    for (const total of [0, 1, 5]) {
      expect(foldState(total, false)).toEqual({ foldable: false, visible: total });
      expect(foldState(total, true)).toEqual({ foldable: false, visible: total });
    }
  });

  it('shows five of a longer list while folded and says how many there are', () => {
    expect(foldState(28, false)).toEqual({
      foldable: true,
      visible: 5,
      toggle: 'Ver todos (28)',
      status: 'Mostrando 5 de 28',
    });
  });

  it('shows every row once expanded and offers to fold again', () => {
    expect(foldState(28, true)).toEqual({
      foldable: true,
      visible: 28,
      toggle: 'Plegar',
      status: 'Mostrando 28 de 28',
    });
  });

  it('folds a list of six: one hidden row is still a hidden row', () => {
    expect(foldState(6, false)).toMatchObject({ foldable: true, visible: 5, toggle: 'Ver todos (6)' });
  });

  it('names a paged list by what is loaded of the whole, never "todos" while more remain', () => {
    expect(foldState(20, false, 451)).toMatchObject({ toggle: 'Ver 20 de 451', status: 'Mostrando 5 de 451' });
    expect(foldState(20, true, 451)).toMatchObject({ toggle: 'Plegar', status: 'Mostrando 20 de 451' });
    expect(foldState(18, false, 18)).toMatchObject({ toggle: 'Ver todos (18)' });
  });
});
