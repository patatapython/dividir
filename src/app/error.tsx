'use client';

import { ErrorFallback } from '@/app/_ui/error-fallback';

export default function RootError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="container" style={{ paddingTop: 32 }}>
      <ErrorFallback error={error} retry={retry} backHref="/" backLabel="Ir al inicio" titleLevel={1} />
    </main>
  );
}
