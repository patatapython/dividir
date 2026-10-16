/**
 * Cumulative "Ver más" paging driven by the URL (`?mostrar=N`): the server renders
 * the first N rows, so it works without client JS and survives a reload. `max`
 * bounds what a hand-typed URL can ask for; reaching it is said, never silent.
 */
export interface PageSpec {
  pageSize: number;
  max: number;
}

export const SHOW_PARAM = 'mostrar';

/** Spread on each row of a paged list, so "Ver más" can hand focus to the first new one. */
export const LIST_ROW_ATTR = 'data-list-row';
export const LIST_ROW = { [LIST_ROW_ATTR]: '' };
/** The rows of the list itself: a row may hold rows of its own (a closed round's
 * payout inside the list of rounds), and those never count as rows of the list. */
export const OUTER_LIST_ROWS = `[${LIST_ROW_ATTR}]:not([${LIST_ROW_ATTR}] [${LIST_ROW_ATTR}])`;

export type ShowMoreState =
  | { kind: 'all'; visible: number }
  | { kind: 'more'; visible: number; next: number }
  | { kind: 'capped'; visible: number };

/** Rows the URL asks for: one page by default, never below one page nor above `max`. */
export function shownCount(raw: string | string[] | undefined, spec: PageSpec): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^\d+$/.test(value)) return spec.pageSize;
  return Math.min(Math.max(Number(value), spec.pageSize), spec.max);
}

export function showMoreState(shown: number, total: number, spec: PageSpec): ShowMoreState {
  if (total <= shown) return { kind: 'all', visible: total };
  if (shown >= spec.max) return { kind: 'capped', visible: shown };
  return { kind: 'more', visible: shown, next: Math.min(shown + spec.pageSize, spec.max) };
}
