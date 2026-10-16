import type { ActivityTarget } from '@/server/queries';

/** The page where the entity an activity entry is about can be seen now (T-44). */
export function activityHref(token: string, target: ActivityTarget): string {
  const base = `/g/${token}`;
  switch (target.kind) {
    case 'expense':
      return `${base}/gastos/${target.id}`;
    case 'charge':
      return `${base}/gastos/sin-pagar/${target.id}`;
    case 'kitty':
      return target.closed ? `${base}/bote/cerradas/${target.roundId}` : `${base}/bote`;
    case 'participants':
      return `${base}/ajustes`;
  }
}
