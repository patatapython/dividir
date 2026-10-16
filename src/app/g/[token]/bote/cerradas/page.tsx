import { notFound } from 'next/navigation';
import { getClosedRounds } from '@/server/queries';
import { EmptyState } from '@/app/_ui/empty-state';
import { LIST_ROW, SHOW_PARAM, shownCount, type PageSpec } from '@/app/_ui/show-more';
import { ShowMoreFooter } from '@/app/_ui/show-more-footer';
import { FoldableList } from '@/app/_ui/foldable-list';
import { ClosedRoundCard } from '../closed-round-card';

/** A closed round is a whole sheet: a short page at a time, every one within reach (T-71). */
const CLOSED_ROUNDS_PAGE: PageSpec = { pageSize: 20, max: 500 };

/** Bote › Cerradas: every closed round as a full record (v1.3 §5). */
export default async function ClosedRoundsPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const shown = shownCount((await searchParams)[SHOW_PARAM], CLOSED_ROUNDS_PAGE);
  const page = await getClosedRounds(token, shown);
  if (!page) notFound();
  const { hasOpenRound, rounds, total } = page;

  return (
    <main style={{ paddingTop: 4, paddingBottom: 32 }}>
      {rounds.length === 0 ? (
        <EmptyState>Todavía no hay rondas cerradas. Cuando cierres una, aparecerá aquí con todo su detalle.</EmptyState>
      ) : (
        <FoldableList
          id="closed-rounds"
          label="Rondas cerradas"
          total={total}
          defaultExpanded={shown > CLOSED_ROUNDS_PAGE.pageSize}
          footer={<ShowMoreFooter listId="closed-rounds" path={`/g/${token}/bote/cerradas`} shown={shown} total={total} spec={CLOSED_ROUNDS_PAGE} />}
        >
          {rounds.map((r) => (
            <div key={r.id} {...LIST_ROW}>
              <ClosedRoundCard token={token} round={r} hasOpenRound={hasOpenRound} />
            </div>
          ))}
        </FoldableList>
      )}
    </main>
  );
}
