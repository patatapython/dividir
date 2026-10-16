import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { requireGroup } from '@/server/group-scope';
import { getExpenseForEdit, getOwnerlessView } from '@/server/queries';
import { ExpenseForm } from '../expense-form';
import { RefundsSection } from '../refunds-section';
import { deleteExpense } from '@/server/actions/expenses';
import { todayKey } from '@/app/_ui/dates';
import { DeleteZone } from '@/app/_ui/delete-zone';

export default async function EditExpensePage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const group = await requireGroup(token);
  const expense = await getExpenseForEdit(token, id); // §2.1: scoped, null on miss
  if (!expense) notFound();
  const ownerless = await getOwnerlessView(group);

  const cookieStore = await cookies();
  const claimedId = cookieStore.get(`participant_${group.id}`)?.value ?? null;

  // Edit keeps every participant (archived too — existing shares may reference them).
  const participants = group.participants
    .map((p) => ({ id: p.id, name: p.name, archivedAt: p.archivedAt }));

  const activePersons = group.participants
    .filter((p) => !p.archivedAt)
    .map((p) => ({ id: p.id, name: p.name }));
  // Refund receiver must be a selectable (active) person.
  const firstPersonPayerId = expense.payers.find((p) => activePersons.some((ap) => ap.id === p.participantId))?.participantId;

  return (
    <main style={{ paddingTop: 16, paddingBottom: 32 }}>
      <ExpenseForm
        token={token}
        participants={participants}
        claimedId={claimedId}
        expense={expense}
        expenseId={expense.id}
        ownerlessRemainingCents={ownerless.declaredCents > 0 ? ownerless.remainingCents : undefined}
        today={todayKey()}
      />
      <RefundsSection
        token={token}
        expenseId={expense.id}
        refunds={expense.refunds}
        persons={activePersons}
        defaultReceiverId={firstPersonPayerId ?? activePersons[0]?.id ?? ''}
      />
      <DeleteZone
        label="Eliminar gasto"
        confirmTitle="¿Eliminar este gasto?"
        action={deleteExpense.bind(null, token, expense.id)}
        redirectTo={`/g/${token}`}
      />
    </main>
  );
}
