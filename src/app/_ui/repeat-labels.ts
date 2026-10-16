import { normalizeText } from '@/domain/text';

/**
 * Tags each item with a display label: its text alone, or "text 1" / "text 2" when
 * several items share the same key. Order is kept. The label is what a row shows AND
 * what names its controls, so two rows never share an accessible name.
 */
function numberRepeats<T>(items: T[], keyOf: (item: T) => string, textOf: (item: T) => string): (T & { displayLabel: string })[] {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(keyOf(item), (totals.get(keyOf(item)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return items.map((item) => {
    const key = keyOf(item);
    const seq = (seen.get(key) ?? 0) + 1;
    seen.set(key, seq);
    return { ...item, displayLabel: (totals.get(key) ?? 0) > 1 ? `${textOf(item)} ${seq}` : textOf(item) };
  });
}

interface NamedContribution {
  participantId: string;
  participantName: string;
}

/** Orders contributions by participant name (so repeat contributors sit
 * together) and tags each with a display label — "Ana" for a single
 * contribution, "Ana 1" / "Ana 2" when the same person contributed more
 * than once, so repeats are visible at a glance instead of buried in
 * chronological order. */
export function orderContributionsWithLabels<T extends NamedContribution>(
  contributions: T[],
): (T & { displayLabel: string })[] {
  const ordered = [...contributions].sort((a, b) => a.participantName.localeCompare(b.participantName, 'es'));
  return numberRepeats(ordered, (c) => c.participantId, (c) => c.participantName);
}

/** Spends of the bote keep their order; a concept bought twice ("Hielo") becomes
 * "Hielo 1" / "Hielo 2" (capitals and stray spaces do not make two concepts). */
export function labelSpends<T extends { concept: string }>(spends: T[]): (T & { displayLabel: string })[] {
  return numberRepeats(spends, (s) => normalizeText(s.concept).toLowerCase(), (s) => normalizeText(s.concept));
}
