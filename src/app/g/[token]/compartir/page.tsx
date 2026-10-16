import { requireGroup } from '@/server/group-scope';
import { SharePanel } from './share-panel';

/** Where a group is shared from: the first step after creating it, and the header's "Compartir" (T-40). */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const group = await requireGroup(token);
  return (
    <main style={{ paddingTop: 16, paddingBottom: 32 }}>
      <SharePanel token={token} groupName={group.name} />
    </main>
  );
}
