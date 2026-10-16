'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from './button';
import { TicketCard } from './ticket-card';

/**
 * Shared body of the route error boundaries. Never shows `error.message`: in
 * production server errors arrive redacted, and the digest is what matches the
 * server log line, so that is the only detail surfaced.
 */
export function ErrorFallback({ error, retry, backHref, backLabel, titleLevel }: {
  error: Error & { digest?: string };
  retry: () => void;
  backHref: string;
  backLabel: string;
  /** 1 on a bare page; 2 inside the group layout, whose h1 is the group name. */
  titleLevel: 1 | 2;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <TicketCard>
      {titleLevel === 1 ? <h1>Algo ha fallado</h1> : <h2 className="screen-title">Algo ha fallado</h2>}
      <p className="muted">No se ha podido cargar esta página. Puedes reintentarlo.</p>
      {error.digest ? <p className="muted">Código de error: {error.digest}</p> : null}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        <Button variant="dark" onClick={() => retry()}>
          Reintentar
        </Button>
        <Link className="btn btn--ghost" href={backHref}>
          {backLabel}
        </Link>
      </div>
    </TicketCard>
  );
}
