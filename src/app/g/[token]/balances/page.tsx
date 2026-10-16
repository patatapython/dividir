import { notFound } from 'next/navigation';
import { getGroupOverview } from '@/server/queries';
import { asCents } from '@/domain/money';
import { RegisterPaymentButton } from './register-payment-button';
import { DeletePaymentButton } from '../delete-payment-button';
import { FinalAccountLines } from '../final-account';
import { TicketCard } from '@/app/_ui/ticket-card';
import { SectionLabel } from '@/app/_ui/section-label';
import { DotLeaderRow } from '@/app/_ui/dot-leader-row';
import { MoneyAmount } from '@/app/_ui/money-amount';
import { Stamp } from '@/app/_ui/stamp';
import { EmptyState } from '@/app/_ui/empty-state';
import { formatCalendarDate } from '@/app/_ui/dates';
import { PixelArt } from '@/app/_ui/pixel-art';
import { FoldableList } from '@/app/_ui/foldable-list';
import { LIST_ROW } from '@/app/_ui/show-more';

export default async function BalancesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const overview = await getGroupOverview(token);
  if (!overview) notFound();
  const { balances, plan, participants, feed, externalCharges } = overview;
  const balanceOf = new Map(balances.map((b) => [b.participantId, b.balanceCents]));
  const outsideOf = new Map(externalCharges.map((c) => [c.participantId, c.amountCents]));

  const personRows = participants.filter(
    (p) => !p.archivedAt || (balanceOf.get(p.id) ?? 0) !== 0 || (outsideOf.get(p.id) ?? 0) !== 0,
  );
  const payments = feed.filter((f) => f.kind === 'payment');

  return (
    <main style={{ paddingTop: 16, paddingBottom: 32 }}>
      <SectionLabel level={2}>Saldo neto</SectionLabel>
      <FoldableList label="Saldo neto">
        {personRows.map((p) => {
          const cents = balanceOf.get(p.id) ?? 0;
          return (
            <div
              key={p.id}
              {...LIST_ROW}
              className={cents > 0 ? 'balance-card balance-card--row balance-card--pos' : 'balance-card balance-card--row'}
            >
              <div className="balance-name">
                <strong>{p.name}</strong>
                {cents > 0 && <span className="sign-badge sign-badge--pos">▲ Le deben</span>}
                {cents < 0 && <span className="sign-badge">▼ Debe</span>}
              </div>
              <MoneyAmount cents={asCents(cents)} signed />
              <FinalAccountLines netCents={cents} outsideCents={outsideOf.get(p.id) ?? 0} />
            </div>
          );
        })}
      </FoldableList>

      {/* "Todo saldado" is a verdict on money that moved between people; a group without
          movements has none. An unpaid charge is not one: it is listed apart, below. */}
      {feed.length === 0 ? (
        <EmptyState>Todavía no hay gastos entre vosotros. Cuando alguien pague el primero, aquí veréis quién debe a quién.</EmptyState>
      ) : plan.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 0' }}>
          <div className="settled-art" aria-hidden="true">
            <PixelArt name="beer" />
            <PixelArt name="wine" />
          </div>
          <Stamp display sticker>Todo saldado</Stamp>
          <p className="muted" style={{ marginTop: 14 }}>No queda ninguna deuda pendiente.</p>
        </div>
      ) : (
        <>
          <SectionLabel level={2}>
            Plan para saldar · {plan.length} {plan.length === 1 ? 'pago' : 'pagos'}
          </SectionLabel>
          <FoldableList label="Plan para saldar">
            {plan.map((t) => (
              <TicketCard key={`${t.fromId}-${t.toId}-${t.amountCents}`} listRow>
                <DotLeaderRow
                  label={<strong>{t.fromName} → {t.toName}</strong>}
                  end={<strong><MoneyAmount cents={asCents(t.amountCents)} /></strong>}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <span className="muted">quedará saldado</span>
                  <RegisterPaymentButton token={token} fromId={t.fromId} toId={t.toId} amountCents={t.amountCents} />
                </div>
              </TicketCard>
            ))}
          </FoldableList>
        </>
      )}

      {externalCharges.length > 0 && (
        <>
          <SectionLabel level={2}>Gastos sin pagar</SectionLabel>
          <p className="muted" style={{ marginBottom: 8 }}>
            Nadie los ha pagado todavía: cada uno paga su parte fuera del grupo, a quien corresponda. No entran
            en el plan de arriba. Si alguien paga uno entero de su bolsillo, abre ese gasto desde Gastos y usa «¿Ya lo ha pagado alguien?».
          </p>
          <TicketCard className="ticket--pending">
            <FoldableList label="Gastos sin pagar">
              {externalCharges.map((c) => (
                <DotLeaderRow key={c.participantId} listRow label={c.name} end={<MoneyAmount cents={asCents(-c.amountCents)} signed />} />
              ))}
            </FoldableList>
          </TicketCard>
        </>
      )}

      {payments.length > 0 && (
        <>
          <SectionLabel level={2}>Pagos registrados</SectionLabel>
          <FoldableList label="Pagos registrados">
            {payments.map((p) => (
              <TicketCard key={p.id} listRow>
                <DotLeaderRow
                  label={<strong>{p.detail}</strong>}
                  end={<strong><MoneyAmount cents={asCents(p.amountCents)} /></strong>}
                />
                <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span>{formatCalendarDate(p.date)}</span>
                  <Stamp animated>Pagado</Stamp>
                  <DeletePaymentButton token={token} paymentId={p.id} />
                </div>
              </TicketCard>
            ))}
          </FoldableList>
        </>
      )}
    </main>
  );
}
