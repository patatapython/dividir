import { requireGroup } from '@/server/group-scope';
import { ChargeForm } from '../../charge-form';
import { todayKey } from '@/app/_ui/dates';

export default async function NewChargePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const group = await requireGroup(token);

  const participants = group.participants
    .filter((p) => !p.archivedAt)
    .map((p) => ({ id: p.id, name: p.name, archivedAt: p.archivedAt }));

  return (
    <main style={{ paddingTop: 16, paddingBottom: 32 }}>
      <ChargeForm token={token} participants={participants} today={todayKey()} />
    </main>
  );
}
