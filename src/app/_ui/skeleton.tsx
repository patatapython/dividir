export function Skeleton({ height, width }: { height: number; width?: string }) {
  return <div className="skeleton" style={{ height, width }} />;
}

/**
 * A route's loading state (T-36): the shape of the page it is about to show,
 * announced once to assistive technology. `name` pins which shape it is.
 */
export function SkeletonScreen({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <main className="skeleton-screen" aria-busy="true" data-skeleton={name}>
      <p className="sr-only" role="status">Cargando…</p>
      {children}
    </main>
  );
}
