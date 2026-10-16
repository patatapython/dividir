'use client';

import { useParams } from 'next/navigation';
import { ErrorFallback } from '@/app/_ui/error-fallback';

// Renders inside the group layout, so the header and tabs stay usable.
export default function GroupError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { token } = useParams<{ token: string }>();
  return (
    <div style={{ paddingTop: 16 }}>
      <ErrorFallback error={error} retry={retry} backHref={`/g/${token}`} backLabel="Volver al grupo" titleLevel={2} />
    </div>
  );
}
