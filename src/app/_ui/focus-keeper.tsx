'use client';

import { useEffect } from 'react';

/** Rendered on screen: a closed <dialog> or a hidden branch cannot take focus. */
function isRendered(el: Element): boolean {
  return el.getClientRects().length > 0;
}

function isUsable(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && isRendered(el) && !el.matches(':disabled');
}

/**
 * Focus never falls back to the document because the page changed under the
 * control holding it (T-76, extended in session 10). Deleting a row removes the
 * button that opened its confirmation; archiving swaps "Archivar" for
 * "Recuperar" in place; a submit button disables itself while it works; a keyed
 * reorder moves a whole form. Each time the browser drops focus to <body> and
 * the next Tab starts over at the top of the page. This remembers whatever
 * takes focus and its ancestors and, when a change to the page leaves focus on
 * <body>, gives it back: to the control itself if it is still usable (it only
 * moved), otherwise to its nearest ancestor still on screen, the list, form or
 * section it lived in, focusable only until focus leaves it again.
 * Leaving on purpose is a pointer press outside the control (moving on by
 * keyboard already lands focus elsewhere): that forgets it, so nothing steals
 * focus back later. `focusout` cannot tell the two apart: the browser fires it
 * just BEFORE removing or disabling the control, while it still looks usable
 * (measured in session 10). Only changes on the same page count: when the path changed,
 * focus after a navigation belongs to the router (Next updates the URL before
 * it swaps the content, so the path is already new).
 */
export function FocusKeeper() {
  useEffect(() => {
    let ancestors: Element[] = [];
    let path = '';

    const remember = (event: FocusEvent) => {
      path = location.pathname;
      ancestors = [];
      for (let node = event.target as Element | null; node && node !== document.body; node = node.parentElement) {
        ancestors.push(node);
      }
    };

    const leave = (event: PointerEvent) => {
      if (ancestors.length > 0 && !ancestors[0].contains(event.target as Node)) ancestors = [];
    };

    const restore = () => {
      if (ancestors.length === 0) return;
      if (location.pathname !== path) {
        ancestors = [];
        return;
      }
      const active = document.activeElement;
      // Something else already has focus, or a modal dialog manages it.
      if ((active && active !== document.body) || document.querySelector('dialog[open]')) return;
      const [control, ...containers] = ancestors;
      ancestors = [];
      if (isUsable(control)) {
        control.focus({ preventScroll: true });
        if (document.activeElement === control) return;
      }
      const target = containers.find((node) => node.isConnected && isRendered(node));
      if (!(target instanceof HTMLElement)) return;
      if (!target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      }
      target.focus({ preventScroll: true });
    };

    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    document.addEventListener('focusin', remember);
    document.addEventListener('pointerdown', leave, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', remember);
      document.removeEventListener('pointerdown', leave, true);
    };
  }, []);

  return null;
}
