import { notFound } from 'next/navigation';
import { requireGroup } from '@/server/group-scope';
import { getChargeForEdit } from '@/server/queries';
import { ChargeForm } from '../../charge-form';
import { deleteGroupCharge, payGroupCharge } from '@/server/actions/group-charge';
import { todayKey } from '@/app/_ui/dates';
import { DeleteZone } from '@/app/_ui/delete-zone';
import { PayChargeZone } from './pay-charge-zone';

export default async function EditChargePage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const group = await requireGroup(token);
  const charge = await getChargeForEdit(token, id);
  if (!charge) notFound();

  // Include archived participants too so existing shares are preserved on edit
  // (server grandfathers already-referenced ids; only NEW ones must be active).
  const participants = group.participants.map((p) => ({ id: p.id, name: p.name, archivedAt: p.archivedAt }));

  return (
    <main style={{ paddingTop: 16, paddingBottom: 32 }}>
      <ChargeForm token={token} participants={participants} charge={charge} chargeId={id} today={todayKey()} />
      <PayChargeZone
        concept={charge.concept}
        people={participants.filter((p) => !p.archivedAt)}
        action={payGroupCharge.bind(null, token, id)}
        redirectTo={`/g/${token}`}
      />
      <DeleteZone
        label="Eliminar gasto sin pagar"
        confirmTitle="¿Eliminar este gasto sin pagar?"
        action={deleteGroupCharge.bind(null, token, id)}
        redirectTo={`/g/${token}`}
      />
    </main>
  );
}
