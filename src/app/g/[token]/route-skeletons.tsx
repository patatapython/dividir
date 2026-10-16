import { Skeleton, SkeletonScreen } from '@/app/_ui/skeleton';

// One skeleton per kind of group page, sized after the page it stands in for.

function Rows({ count, height }: { count: number; height: number }) {
  return Array.from({ length: count }, (_, i) => <Skeleton key={i} height={height} />);
}

/**
 * The group's own boundary: what Next shows while it does not yet know which
 * page is coming (a navigation whose prefetch has not arrived). It must not
 * pretend to be any one page, so it is only the page's frame.
 */
export function GroupSkeleton() {
  return (
    <SkeletonScreen name="group">
      <Skeleton height={32} width="50%" />
      <Skeleton height={160} />
      <Skeleton height={96} />
    </SkeletonScreen>
  );
}

/** Gastos: the saldos grid, then the movements. */
export function LedgerSkeleton() {
  return (
    <SkeletonScreen name="ledger">
      <div className="balance-grid">
        <Rows count={4} height={76} />
      </div>
      <Skeleton height={18} width="40%" />
      <Rows count={3} height={64} />
    </SkeletonScreen>
  );
}

/** Saldos: one row per person, then the transfers. */
export function BalancesSkeleton() {
  return (
    <SkeletonScreen name="balances">
      <Rows count={3} height={56} />
      <Skeleton height={18} width="45%" />
      <Rows count={2} height={64} />
    </SkeletonScreen>
  );
}

/** A gasto or gasto sin pagar being written or edited: title, live ticket, actions. */
export function FormSkeleton() {
  return (
    <SkeletonScreen name="form">
      <Skeleton height={32} width="55%" />
      <Skeleton height={460} />
      <div className="skeleton-actions">
        <Skeleton height={48} width="60%" />
        <Skeleton height={48} width="35%" />
      </div>
    </SkeletonScreen>
  );
}

/** Bote, open round: its balance, then aportes and gastos. */
export function RoundSkeleton() {
  return (
    <SkeletonScreen name="round">
      <Skeleton height={120} />
      <Rows count={2} height={150} />
    </SkeletonScreen>
  );
}

/** Bote, closed rounds. */
export function ClosedRoundsSkeleton() {
  return (
    <SkeletonScreen name="closed-rounds">
      <Rows count={2} height={170} />
    </SkeletonScreen>
  );
}

/** Actividad: a day label and its entries. */
export function ActivitySkeleton() {
  return (
    <SkeletonScreen name="activity">
      <Skeleton height={28} width="30%" />
      <Rows count={5} height={22} />
    </SkeletonScreen>
  );
}

/** Ajustes: participants, the declared Sobrante, danger zone. */
export function SettingsSkeleton() {
  return (
    <SkeletonScreen name="settings">
      <Skeleton height={200} />
      <Skeleton height={170} />
      <Skeleton height={150} />
    </SkeletonScreen>
  );
}

/** Compartir: one panel with the link, its actions and the QR code. */
export function ShareSkeleton() {
  return (
    <SkeletonScreen name="share">
      <Skeleton height={480} />
    </SkeletonScreen>
  );
}
