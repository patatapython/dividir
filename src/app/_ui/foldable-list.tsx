'use client';

import { Children, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { foldState } from './fold';
import { LIST_ROW_ATTR } from './show-more';

/**
 * A long read list that shows its first rows and folds the rest behind one toggle
 * (D-09). The toggle never unmounts: folding keeps focus on it and takes the screen
 * back to the top of the folded box (the rows the reader was scrolling are gone, and
 * staying put leaves them somewhere unrelated); expanding hands focus to the first
 * newly shown row, the direct child marked with LIST_ROW at that index — a row
 * without the mark leaves focus on the toggle. The count is a live region, said
 * only once the reader has used the toggle.
 *
 * Each child is one row; never pass a form's inputs (a hidden input still counts).
 *
 * A paged list passes its whole `total` and its "Ver más" as `footer`, shown only
 * while the list is unfolded — so "Ver más" is only ever used unfolded, and the
 * list keeps that state through the navigation. `defaultExpanded` opens a list
 * loaded past its first page (a reload of `?mostrar=40`). A list whose "Ver más"
 * lives outside it (Actividad's days) is keyed by the rows shown instead, so it
 * remounts unfolded when more load.
 */
export function FoldableList({ label, children, as: Tag = 'div', id, className, style, defaultExpanded = false, total, footer }: {
  /** What the list is, so two toggles on one screen never share a name ("Aportes"). */
  label: string;
  children: ReactNode;
  as?: 'div' | 'ul';
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  defaultExpanded?: boolean;
  /** The whole list, when only part of it is loaded (paged lists). */
  total?: number;
  /** Shown under the rows while the list is unfolded (a paged list's "Ver más"). */
  footer?: ReactNode;
}) {
  const ownId = useId();
  const listId = id ?? ownId;
  const rows = Children.toArray(children);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [touched, setTouched] = useState(false);
  const list = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const state = foldState(rows.length, expanded, total);
  const hiddenFrom = useRef<number | null>(null);

  useEffect(() => {
    if (!touched) return;
    if (!expanded) {
      if (list.current) scrollToBoxStart(list.current);
      return;
    }
    const index = hiddenFrom.current;
    hiddenFrom.current = null;
    if (index === null) return;
    const row = list.current?.querySelectorAll<HTMLElement>(`:scope > [${LIST_ROW_ATTR}]`)[index];
    if (!row) return;
    row.tabIndex = -1;
    row.focus();
  }, [expanded, touched]);

  return (
    <>
      <Tag ref={list as React.Ref<never>} id={listId} className={className} style={style}>
        {rows.slice(0, state.visible)}
      </Tag>
      {(!state.foldable || expanded) && footer}
      {state.foldable && (
        <div className="fold-toggle">
          <button
            ref={toggle}
            type="button"
            className="btn btn--sm fold-toggle-button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => {
              if (!expanded) hiddenFrom.current = state.visible;
              setTouched(true);
              setExpanded(!expanded);
            }}
          >
            <span className="fold-arrow" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
            {state.toggle}
            <span className="sr-only"> · {label}</span>
          </button>
          <p className="sr-only" role="status">{touched ? state.status : ''}</p>
        </div>
      )}
    </>
  );
}

/** Where a list's box starts: the heading just above it (past a note, or inside a
 * card head), else the card it sits in, else the list itself. */
function boxStart(list: HTMLElement): HTMLElement {
  let sibling = list.previousElementSibling;
  for (let step = 0; sibling && step < 3; step++, sibling = sibling.previousElementSibling) {
    if (sibling.matches('h1, h2, h3') || sibling.querySelector('h1, h2, h3')) return sibling as HTMLElement;
  }
  return list.closest<HTMLElement>('.ticket-wrap') ?? list;
}

const BOX_GAP_PX = 12;

/** Brings the box start back into view when folding left it above the screen. */
function scrollToBoxStart(list: HTMLElement) {
  const top = boxStart(list).getBoundingClientRect().top;
  if (top >= 0) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: window.scrollY + top - BOX_GAP_PX, behavior: reduce ? 'auto' : 'smooth' });
}
