import { notFound } from 'next/navigation';
import { getKittyView } from '@/server/queries';
import { KittyControls } from '../kitty-controls';

/** Bote › Ronda: the open round, or the way to open one (D-01). Closed
 * rounds live in Bote › Cerradas. */
export default async function BotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getKittyView(token);
  if (!view) notFound();

  return (
    <main style={{ paddingTop: 4, paddingBottom: 32 }}>
      <KittyControls token={token} participants={view.activeParticipants} openRound={view.openRound} />
    </main>
  );
}
