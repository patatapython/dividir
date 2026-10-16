import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGroupOverview } from '@/server/queries';
import { asCents } from '@/domain/money';
import { DeletePaymentButton } from '../delete-payment-button';
import { FinalAccountLines } from '../final-account';
import { ownerlessStatus } from '../ownerless-status';
import { TicketCard } from '@/app/_ui/ticket-card';
import { MoneyAmount } from '@/app/_ui/money-amount';
import { Stamp } from '@/app/_ui/stamp';
import { EmptyState } from '@/app/_ui/empty-state';
import { SectionLabel } from '@/app/_ui/section-label';
import { formatCalendarDate } from '@/app/_ui/dates';
import { LIST_ROW, SHOW_PARAM, shownCount, type PageSpec } from '@/app/_ui/show-more';
import { ShowMoreFooter } from '@/app/_ui/show-more-footer';
import { FoldableList } from '@/app/_ui/foldable-list';

/** Movimientos is a glance under the saldos: one short page at a time (T-71). */
const MOVEMENTS_PAGE: PageSpec = { pageSize: 20, max: 500 };

export default async function GroupHomePage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const shown = shownCount((await searchParams)[SHOW_PARAM], MOVEMENTS_PAGE);
  const overview = await getGroupOverview(token);
  if (!overview) notFound();
  const { balances, feed, participants, charges, externalCharges, ownerless } = overview;
  const balanceOf = new Map(balances.map((b) => [b.participantId, b.balanceCents]));
  const outsideOf = new Map(externalCharges.map((c) => [c.participantId, c.amountCents]));

  const personRows = participants.filter(
    (p) => !p.archivedAt || (balanceOf.get(p.id) ?? 0) !== 0 || (outsideOf.get(p.id) ?? 0) !== 0,
  );

  return (
    <main style={{ paddingTop: 16, paddingBottom: 32 }}>
      <SectionLabel level={2}>Saldos</SectionLabel>
      <div className="balance-grid">
        {personRows.map((p) => {
          const cents = balanceOf.get(p.id) ?? 0;
          return (
            <div className={cents > 0 ? 'balance-card balance-card--pos' : 'balance-card'} key={p.id}>
              <div className="balance-card-top">
                <strong>{p.name}</strong>
                {cents > 0 && <span className="sign-badge sign-badge--pos">▲ Le deben</span>}
                {cents < 0 && <span className="sign-badge">▼ Debe</span>}
              </div>
              <MoneyAmount cents={asCents(cents)} signed fit />
              <FinalAccountLines netCents={cents} outsideCents={outsideOf.get(p.id) ?? 0} />
            </div>
          );
        })}
      </div>

      <SectionLabel level={2}>Movimientos</SectionLabel>
      {feed.length === 0 ? (
        <EmptyState art="beer">Todavía no hay gastos entre vosotros. Añade el primero y reparte.</EmptyState>
      ) : (
        <FoldableList
          id="movements"
          label="Movimientos"
          total={feed.length}
          defaultExpanded={shown > MOVEMENTS_PAGE.pageSize}
          footer={
            <ShowMoreFooter
              listId="movements"
              path={`/g/${token}`}
              shown={shown}
              total={feed.length}
              spec={MOVEMENTS_PAGE}
              cappedNote={
                <a className="btn btn--ghost" href={`/g/${token}/exportar`} download>
                  Descargar todos en CSV
                </a>
              }
            />
          }
        >
          {feed.slice(0, shown).map((item) => (
            <article
              key={`${item.kind}-${item.id}`}
              {...LIST_ROW}
              className={item.kind === 'payment' ? 'movement-card movement-card--payment' : 'movement-card'}
            >
              <div className="movement-head">
                {item.kind === 'expense' ? (
                  <Link href={`/g/${token}/gastos/${item.id}`}>
                    <strong>{item.title}</strong>
                  </Link>
                ) : (
                  <strong>{item.title}</strong>
                )}
                {item.kind === 'expense' ? (
                  <MoneyAmount cents={asCents(-item.amountCents)} signed />
                ) : (
                  <MoneyAmount cents={asCents(item.amountCents)} />
                )}
              </div>
              <div className="movement-meta">
                <span>
                  {item.detail} · {formatCalendarDate(item.date)}
                </span>
                {item.kind === 'payment' && <Stamp>Pagado</Stamp>}
                {item.kind === 'payment' && <DeletePaymentButton token={token} paymentId={item.id} />}
              </div>
            </article>
          ))}
        </FoldableList>
      )}

      {/* Declared in Ajustes (D-04): the home only reminds, and only once there is something declared. */}
      {ownerless.declaredCents > 0 && (
        <Link className="leftover-line" href={`/g/${token}/ajustes`}>
          <span>
            <strong>Sobrante:</strong> {ownerlessStatus(ownerless.remainingCents)}
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      )}

      {/* Nobody has paid these yet: each person owes their share OUTSIDE the group
          (spec §7.4), so they never enter the saldos above — but they are expenses,
          shown signed like the rest, with what each one owes of them. */}
      {charges.length > 0 && (
        <TicketCard className="ticket--pending">
          <SectionLabel level={2}>Gastos sin pagar</SectionLabel>
          <p className="muted charge-note">Nadie los ha pagado todavía: cada uno debe su parte fuera del grupo.</p>
          <FoldableList label="Gastos sin pagar">
            {charges.map((c) => (
              <div key={c.id} {...LIST_ROW} className="movement-row">
                <div className="movement-head">
                  <Link href={`/g/${token}/gastos/sin-pagar/${c.id}`}>
                    <strong>{c.concept}</strong>
                  </Link>
                  <MoneyAmount cents={asCents(-c.amountCents)} signed />
                </div>
                <p className="charge-shares">
                  {c.shares.map((s, i) => (
                    <span key={s.participantId}>
                      {i > 0 && ' · '}
                      {s.name} <MoneyAmount cents={asCents(s.amountCents)} />
                    </span>
                  ))}
                </p>
                <div className="movement-meta">Sin pagar · {formatCalendarDate(c.date)}</div>
              </div>
            ))}
          </FoldableList>
        </TicketCard>
      )}
    </main>
  );
}
