'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { groupNavigation, MODES, type ModeId } from './group-navigation';

// The group layout is a server component; these read the pathname so the
// header, the mode views and the reparto action bar mark where the user is.

const HEADER_LINKS = [
  { href: '/actividad', label: 'Actividad' },
  { href: '/ajustes', label: 'Ajustes' },
];

export function HeaderLinks({ base }: { base: string }) {
  const pathname = usePathname();
  return (
    <nav className="appbar-links" aria-label="Grupo">
      {HEADER_LINKS.map((l) => {
        const href = `${base}${l.href}`;
        const active = pathname === href;
        return (
          <Link key={l.href} href={href} className={active ? 'tab tab--on' : 'tab'} aria-current={active ? 'page' : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ModeSwitch({ base }: { base: string }) {
  const { mode } = groupNavigation(usePathname(), base);
  return (
    <nav className="mode-switch" aria-label="Modalidad">
      {(Object.keys(MODES) as ModeId[]).map((id) => (
        <Link
          key={id}
          href={`${base}${MODES[id].views[0].href}`}
          className={mode === id ? 'mode-tab mode-tab--on' : 'mode-tab'}
          aria-current={mode === id ? 'page' : undefined}
        >
          {MODES[id].label}
        </Link>
      ))}
    </nav>
  );
}

/** Wraps the group's pages: the mode's surface, its views, its fixed intro
 * and (reparto only, D-01 §3) the bottom action bar. */
export function ModeFrame({ base, children }: { base: string; children: React.ReactNode }) {
  const { mode, view, isViewRoot } = groupNavigation(usePathname(), base);
  return (
    <div className={mode === 'bote' ? 'mode-surface mode-surface--bote' : 'mode-surface'}>
      <div className="container">
        {mode && (
          <div className="mode-head">
            <nav className="subviews" aria-label={mode === 'bote' ? 'Vistas del bote' : 'Vistas del reparto'}>
              {MODES[mode].views.map((v) => (
                <Link
                  key={v.id}
                  href={`${base}${v.href}`}
                  className={v.id === view ? 'subview subview--on' : 'subview'}
                  aria-current={v.id === view ? 'page' : undefined}
                >
                  {v.label}
                </Link>
              ))}
            </nav>
            {mode === 'bote' && <span className="mode-tag">Bote común</span>}
          </div>
        )}
        {mode && isViewRoot && <p className="mode-intro">{MODES[mode].intro}</p>}
        {children}
        {mode === 'reparto' && isViewRoot && (
          <div className="action-bar">
            <Link className="btn btn--primary" style={{ flex: 1 }} href={`${base}/gastos/nuevo`}>
              Añadir gasto
            </Link>
            <Link className="btn btn--ghost" href={`${base}/gastos/sin-pagar/nuevo`}>
              Gasto sin pagar
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
