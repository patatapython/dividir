'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { OUTER_LIST_ROWS, SHOW_PARAM, showMoreState, type PageSpec } from './show-more';

/**
 * Footer of a URL-paged list: how much is shown, and either "Ver más" or the
 * notice that the cap was reached. The count is a live region, so the new total
 * is announced; `scroll={false}` keeps the reader in place, and once the rows
 * arrive focus moves to the first new one (the link may be gone by then, and
 * focus would otherwise fall back to the page).
 */
export function ShowMoreFooter({ listId, path, shown, total, spec, cappedNote }: {
  /** id of the element that holds the rows marked with LIST_ROW. */
  listId: string;
  path: string;
  shown: number;
  total: number;
  spec: PageSpec;
  /** Where the rest can be seen once the cap is reached. */
  cappedNote?: ReactNode;
}) {
  const state = showMoreState(shown, total, spec);
  const firstNewRow = useRef<number | null>(null);

  useEffect(() => {
    const index = firstNewRow.current;
    if (index === null || state.visible <= index) return;
    firstNewRow.current = null;
    const row = document.getElementById(listId)?.querySelectorAll<HTMLElement>(OUTER_LIST_ROWS)[index];
    if (!row) return;
    row.tabIndex = -1;
    row.focus();
  }, [listId, state.visible]);

  if (total <= spec.pageSize) return null;
  return (
    <div className="show-more">
      <p className="show-more-count" role="status">
        {state.kind === 'capped'
          ? `Se muestran ${state.visible} de ${total}, empezando por lo más reciente.`
          : `Mostrando ${state.visible} de ${total}`}
      </p>
      {state.kind === 'capped' && cappedNote}
      {state.kind === 'more' && (
        <Link
          className="btn btn--ghost"
          href={`${path}?${SHOW_PARAM}=${state.next}`}
          scroll={false}
          onClick={() => {
            firstNewRow.current = state.visible;
          }}
        >
          Ver más
        </Link>
      )}
    </div>
  );
}
