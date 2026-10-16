'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addParticipant, deleteParticipant, updateParticipant, archiveParticipant, unarchiveParticipant } from '@/server/actions/participants';
import type { ParticipantView } from '@/server/queries';
import { Field } from '@/app/_ui/field';
import { Button } from '@/app/_ui/button';
import { ConfirmDialog } from '@/app/_ui/confirm-dialog';
import { SectionLabel } from '@/app/_ui/section-label';
import { runClientAction } from '@/app/_ui/run-client-action';
import type { ActionResult } from '@/server/action-result';
import { FoldableList } from '@/app/_ui/foldable-list';
import { LIST_ROW } from '@/app/_ui/show-more';

export function ParticipantsSection({
  token,
  participants,
  hasMovements,
}: {
  token: string;
  participants: ParticipantView[];
  hasMovements: boolean;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ParticipantView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<ActionResult<unknown>>) {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(work);
      if (result.ok) {
        setNewName('');
        setEditingId(null);
        setDeleteTarget(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const active = participants.filter((p) => !p.archivedAt);
  const archived = participants.filter((p) => p.archivedAt);

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="card-head">
        <SectionLabel level={2}>Participantes</SectionLabel>
        <span className="card-head-meta">{active.length} activos</span>
      </div>
      <>
        {hasMovements && (
          <p className="muted">
            Los repartos no son retroactivos: un participante nuevo solo entra en los gastos que se creen o editen a partir de ahora.
          </p>
        )}
        <FoldableList as="ul" label="Participantes" style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
          {active.map((p) => (
            <li key={p.id} {...LIST_ROW} className="participant-row">
              {editingId === p.id ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', flexWrap: 'wrap' }}>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label={`Nuevo nombre para ${p.name}`}
                    style={{ maxWidth: '12rem' }}
                  />
                  <Button size="sm" disabled={pending} onClick={() => run(() => updateParticipant(token, p.id, editName))}>
                    Guardar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <>
                  <span>{p.name}</span>
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button variant="ghost" size="sm" onClick={() => { setEditingId(p.id); setEditName(p.name); }}>
                      Renombrar
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => archiveParticipant(token, p.id))}>
                      Archivar
                    </Button>
                    <Button variant="danger" size="sm" disabled={pending} onClick={() => { setError(null); setDeleteTarget(p); }}>
                      Eliminar
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
          {archived.map((p) => (
            <li key={p.id} {...LIST_ROW} className="participant-row participant-archived">
              <span>{p.name}</span>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => unarchiveParticipant(token, p.id))}>
                Recuperar
              </Button>
            </li>
          ))}
        </FoldableList>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addParticipant(token, newName));
          }}
        >
          <Field label="Nuevo participante">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre" required />
          </Field>
          <Button type="submit" variant="dark" size="sm" disabled={pending}>
            Añadir
          </Button>
        </form>
        {error && !deleteTarget && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`¿Eliminar a ${deleteTarget?.name ?? ''}?`}
        pending={pending}
        error={error}
        onConfirm={() => { if (deleteTarget) run(() => deleteParticipant(token, deleteTarget.id)); }}
        onCancel={() => { setDeleteTarget(null); setError(null); }}
      >
        <p className="muted">Solo se puede eliminar a quien no tiene gastos (pagados o sin pagar), pagos ni aportes; si los tiene, archívalo.</p>
      </ConfirmDialog>
    </section>
  );
}
