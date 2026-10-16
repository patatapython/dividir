/**
 * D-01/D-02: a group has two independent modes, the person-to-person split
 * (reparto) and the communal kitty (bote), each with its own views. Activity
 * and settings belong to no mode. This is the single map from a pathname to
 * where the user is; every navigation element reads it instead of matching
 * routes on its own.
 */
export type ModeId = 'reparto' | 'bote';

interface ModeView {
  id: string;
  label: string;
  /** Route suffix after `/g/<token>`. */
  href: string;
}

interface Mode {
  label: string;
  /** Fixed one-line explanation shown on the mode's views. */
  intro: string;
  views: ModeView[];
}

export const MODES: Record<ModeId, Mode> = {
  reparto: {
    label: 'Reparto',
    intro: 'Reparto entre personas: cada gasto se divide y al final se salda.',
    views: [
      { id: 'gastos', label: 'Gastos', href: '' },
      { id: 'saldos', label: 'Saldos', href: '/balances' },
    ],
  },
  bote: {
    label: 'Bote',
    intro: 'Dinero de todos y de nadie: se aporta, se gasta y lo que sobra se reparte. No entra en los saldos.',
    views: [
      { id: 'ronda', label: 'Ronda', href: '/bote' },
      { id: 'cerradas', label: 'Cerradas', href: '/bote/cerradas' },
    ],
  },
};

export interface GroupNavigation {
  mode: ModeId | null;
  view: string | null;
  /** The pathname IS the view (not a form nested under it). */
  isViewRoot: boolean;
}

const NOWHERE: GroupNavigation = { mode: null, view: null, isViewRoot: false };

export function groupNavigation(pathname: string, base: string): GroupNavigation {
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return NOWHERE;
  const rest = pathname.slice(base.length).replace(/\/+$/, '');
  for (const [mode, { views }] of Object.entries(MODES) as [ModeId, Mode][]) {
    const exact = views.find((v) => v.href === rest);
    if (exact) return { mode, view: exact.id, isViewRoot: true };
  }
  // Expense and charge forms live under /gastos and belong to the Gastos view;
  // a closed round's own page lives under Cerradas.
  if (rest.startsWith('/gastos/')) return { mode: 'reparto', view: 'gastos', isViewRoot: false };
  if (rest.startsWith('/bote/cerradas/')) return { mode: 'bote', view: 'cerradas', isViewRoot: false };
  return NOWHERE;
}

/** Where the group is shared from: after creating it, and from the header (T-40). */
export const SHARE_HREF = '/compartir';

/**
 * Whether a device with no identity is asked "¿Quién eres?" on this page. Every group page
 * asks except the share page: it is for inviting others, and the group asks once entered.
 */
export function asksIdentity(pathname: string, base: string): boolean {
  return pathname.replace(/\/+$/, '') !== `${base}${SHARE_HREF}`;
}
