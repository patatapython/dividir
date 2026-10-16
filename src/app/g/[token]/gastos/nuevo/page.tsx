import { cookies } from 'next/headers';
import { requireGroup } from '@/server/group-scope';
import { getOwnerlessView } from '@/server/queries';
import { ExpenseForm } from '../expense-form';
import { todayKey } from '@/app/_ui/dates';

export default async function NewExpensePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const group = await requireGroup(token);
  const ownerless = await getOwnerlessView(group);

  const cookieStore = await cookies();
  const claimedId = cookieStore.get(`participant_${group.id}`)?.value ?? null;

  const participants = group.participants
    .filter((p) => !p.archivedAt)
    .map((p) => ({ id: p.id, name: p.name, archivedAt: p.archivedAt }));

  return (
    <main style={{ paddingTop: 16, paddingBottom: 32 }}>
      <ExpenseForm
        token={token}
        participants={participants}
        claimedId={claimedId}
        ownerlessRemainingCents={ownerless.declaredCents > 0 ? ownerless.remainingCents : undefined}
        today={todayKey()}
      />
    </main>
  );
}
