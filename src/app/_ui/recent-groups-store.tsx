'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import {
  RECENT_GROUPS_KEY,
  forgetGroup,
  missingGroupToken,
  parseRecentGroups,
  rememberGroup,
  type RecentGroup,
} from './recent-groups';
import { SectionLabel } from './section-label';

// This browser's storage behind "Tus grupos". Storage can be missing or refused (private
// modes, blocked site data): every access degrades to "nothing remembered", never an error.
const CHANGED = 'dividir:groups-changed';

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(RECENT_GROUPS_KEY);
  } catch {
    return null;
  }
}

function update(change: (list: RecentGroup[]) => RecentGroup[]) {
  try {
    window.localStorage.setItem(RECENT_GROUPS_KEY, JSON.stringify(change(parseRecentGroups(readRaw()))));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Not remembered on this device; the group itself is unaffected.
  }
}

export function forgetRecentGroup(token: string) {
  update((list) => forgetGroup(list, token));
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange); // other tabs
  window.addEventListener(CHANGED, onChange); // this tab
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** Remembers the group being visited, first in the list and with its current name. */
export function RememberGroup({ token, name }: { token: string; name: string }) {
  useEffect(() => update((list) => rememberGroup(list, { token, name }, Date.now())), [token, name]);
  return null;
}

/** On a not-found group home, drops that link from the list: it leads nowhere any more. */
export function ForgetMissingGroup() {
  const token = missingGroupToken(usePathname());
  useEffect(() => {
    if (token) forgetRecentGroup(token);
  }, [token]);
  return null;
}

/** "Tus grupos" on the landing: nothing until this device has visited a group. */
export function RecentGroups() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const groups = useMemo(() => parseRecentGroups(raw), [raw]);
  const titleId = useId();
  if (groups.length === 0) return null;
  return (
    <section className="panel recent-groups" aria-labelledby={titleId}>
      <SectionLabel level={2}><span id={titleId}>Tus grupos</span></SectionLabel>
      <ul>
        {groups.map((g) => (
          <li key={g.token}>
            <Link className="recent-group" href={`/g/${g.token}`}>
              <span>{g.name}</span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="muted">Guardados solo en este dispositivo.</p>
    </section>
  );
}
