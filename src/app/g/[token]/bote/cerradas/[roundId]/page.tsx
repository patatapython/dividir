import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClosedRound } from '@/server/queries';
import { ClosedRoundCard } from '../../closed-round-card';

/**
 * Bote › Cerradas › one round: its own address, so a link to it (Actividad) reaches
 * it whichever page of Cerradas it falls on (session 12). Unknown, open or another
 * group's round → the group's not-found.
 */
export default async function ClosedRoundPage({ params }: { params: Promise<{ token: string; roundId: string }> }) {
  const { token, roundId } = await params;
  const page = await getClosedRound(token, roundId);
  if (!page) notFound();

  return (
    <main style={{ paddingTop: 4, paddingBottom: 32 }}>
      <p>
        <Link href={`/g/${token}/bote/cerradas`}>← Todas las rondas cerradas</Link>
      </p>
      <ClosedRoundCard token={token} round={page.round} hasOpenRound={page.hasOpenRound} defaultExpanded />
    </main>
  );
}
