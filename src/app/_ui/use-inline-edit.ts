'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Editing something in place (T-101, T-100): opening moves focus to the panel's
 * first input; closing hands it back to the control that opened it once the
 * action has finished — while it runs that control is disabled and takes no focus.
 */
export function useInlineEdit<Panel extends HTMLElement = HTMLDivElement>(pending: boolean) {
  const [editing, setEditing] = useState(false);
  const panel = useRef<Panel>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing) panel.current?.querySelector<HTMLElement>('input')?.focus();
    else if (returnFocus.current && !pending) { returnFocus.current = false; editButton.current?.focus(); }
  }, [editing, pending]);
  return {
    editing,
    panel,
    editButton,
    open: () => setEditing(true),
    close: () => { returnFocus.current = true; setEditing(false); },
  };
}
