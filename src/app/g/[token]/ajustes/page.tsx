import { notFound } from 'next/navigation';
import { getSettingsView } from '@/server/queries';
import { GroupSettings } from '../group-settings';
import { ParticipantsSection } from './participants-section';
import { OwnerlessSection } from './ownerless-section';
import { ExportSection } from './export-section';

export default async function AjustesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getSettingsView(token);
  if (!view) notFound();

  return (
    <main style={{ paddingTop: 16, paddingBottom: 32 }}>
      <ParticipantsSection token={token} participants={view.participants} hasMovements={view.hasMovements} />
      <OwnerlessSection token={token} ownerless={view.ownerless} />
      <ExportSection token={token} />
      <GroupSettings token={token} groupName={view.groupName} />
    </main>
  );
}
