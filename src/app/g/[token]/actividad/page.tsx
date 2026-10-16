import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getActivity, type ActivityView } from '@/server/queries';
import { asCents } from '@/domain/money';
import { MoneyAmount } from '@/app/_ui/money-amount';
import { formatEuros } from '@/app/_ui/money-format';
import { activityHref } from './activity-href';
import { EmptyState } from '@/app/_ui/empty-state';
import { dayKey, formatDay, formatTime, previousDayKey, todayKey } from '@/app/_ui/dates';
import { LIST_ROW, SHOW_PARAM, shownCount, type PageSpec } from '@/app/_ui/show-more';
import { ShowMoreFooter } from '@/app/_ui/show-more-footer';
import { FoldableList } from '@/app/_ui/foldable-list';

/** The log only grows; it is read one page at a time and never cut silently (T-71). */
const ACTIVITY_PAGE: PageSpec = { pageSize: 50, max: 500 };


/**
 * One entry: who did what, to which thing, and how much (T-44). The thing is a
 * link while it can still be seen; without a named thing the verb is the link.
 */
function EntryText({ token, entry }: { token: string; entry: ActivityView }) {
  const href = entry.target ? activityHref(token, entry.target) : null;
  const linked = (text: string) => (href ? <Link href={href}>{text}</Link> : text);
  const detail = [entry.detail, entry.previousAmountCents !== null ? `antes ${formatEuros(asCents(entry.previousAmountCents))}` : null]
    .filter((part): part is string => part !== null)
    .join(' · ');
  return (
    <span className="journal-body">
      <span>
        {entry.actorName ?? 'Alguien'}{' '}
        {entry.subject ? (
          <>
            {entry.label}: {linked(entry.subject)}
          </>
        ) : (
          linked(entry.label)
        )}
      </span>
      {detail && <span className="journal-detail">{detail}</span>}
    </span>
  );
}

export default async function ActivityPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const shown = shownCount((await searchParams)[SHOW_PARAM], ACTIVITY_PAGE);
  const page = await getActivity(token, shown);
  if (!page) notFound();
  const activity = page.entries;

  // Group consecutive entries by calendar day (activity is newest-first).
  const groups: { key: string; label: string; entries: ActivityView[] }[] = [];
  for (const entry of activity) {
    const key = dayKey(entry.createdAt);
    const last = groups[groups.length - 1];
    if (!last || last.key !== key) {
      groups.push({ key, label: formatDay(entry.createdAt), entries: [entry] });
    } else {
      last.entries.push(entry);
    }
  }

  return (
    <main id="activity" style={{ paddingTop: 16, paddingBottom: 32 }}>
      {activity.length === 0 ? (
        <EmptyState>Aún no hay actividad.</EmptyState>
      ) : (
        (() => {
          const today = todayKey();
          const yesterday = previousDayKey(today);
          return groups.map((group) => {
            const recent = group.key === today || group.key === yesterday;
            const prefix = group.key === today ? 'Hoy · ' : group.key === yesterday ? 'Ayer · ' : '';
            return (
              <section key={group.key} className="journal-day">
                <h2 className={recent ? 'day-label' : 'day-label day-label--old'}>
                  {prefix}
                  {group.label}
                </h2>
                {/* Money (tinta bar: the entry carries an amount) vs. group life (lima bar). Redundant with the text. */}
                {/* One fold per day; past the first page every day opens unfolded, so
                    "Ver más" (whose count is page-wide) finds every loaded entry. */}
                <FoldableList key={shown} label={`${prefix}${group.label}`} defaultExpanded={shown > ACTIVITY_PAGE.pageSize}>
                  {group.entries.map((entry) => (
                    <div key={entry.id} {...LIST_ROW} className={entry.amountCents !== null ? 'journal-row' : 'journal-row journal-row--life'}>
                      <span className="mono journal-time">{formatTime(entry.createdAt)}</span>
                      <EntryText token={token} entry={entry} />
                      {entry.amountCents !== null && <MoneyAmount cents={asCents(entry.amountCents)} />}
                    </div>
                  ))}
                </FoldableList>
              </section>
            );
          });
        })()
      )}
      <ShowMoreFooter listId="activity" path={`/g/${token}/actividad`} shown={shown} total={page.total} spec={ACTIVITY_PAGE} />
    </main>
  );
}
