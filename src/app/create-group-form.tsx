'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createGroup } from '@/server/actions/group';
import { MIN_PARTICIPANTS } from '@/domain/group';
import { Field } from './_ui/field';
import { Button } from './_ui/button';
import { runClientAction } from '@/app/_ui/run-client-action';
import { normalizeText } from '@/domain/text';

interface ParticipantRow {
  /** Stable across removals, so each input keeps its own DOM node and focus. */
  key: number;
  name: string;
}

const firstRows = (): ParticipantRow[] => Array.from({ length: MIN_PARTICIPANTS }, (_, key) => ({ key, name: '' }));

export function CreateGroupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<ParticipantRow[]>(firstRows);
  const nextKey = useRef(MIN_PARTICIPANTS);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  // A row to focus once it is on screen: the one just added, or the one that took a removed row's place.
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (focusKey === null) return;
    inputs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  function updateRow(key: number, value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, name: value } : row)));
  }

  function addRow() {
    const key = nextKey.current++;
    setRows((prev) => [...prev, { key, name: '' }]);
    setFocusKey(key);
  }

  function removeRow(index: number) {
    const remaining = rows.filter((_, i) => i !== index);
    setRows(remaining);
    setFocusKey(remaining[Math.min(index, remaining.length - 1)].key);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => createGroup({
        name,
        participantNames: rows.map((row) => normalizeText(row.name)).filter((p) => p !== ''),
      }));
      // Sharing is the first step of a new group (T-40).
      if (result.ok) router.push(`/g/${result.data.token}/compartir`);
      else setError(result.error);
    });
  }

  const removable = rows.length > MIN_PARTICIPANTS;
  return (
    <form onSubmit={handleSubmit}>
      <Field label="Nombre del grupo">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Viaje a Roma" required />
      </Field>
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="section-label" style={{ marginBottom: 8 }}>Participantes (mínimo {MIN_PARTICIPANTS})</legend>
        {rows.map((row, index) => (
          <div className="participant-input" key={row.key}>
            <Field label={`Participante ${index + 1}`}>
              <input
                ref={(el) => { if (el) inputs.current.set(row.key, el); else inputs.current.delete(row.key); }}
                value={row.name}
                onChange={(e) => updateRow(row.key, e.target.value)}
                placeholder="Nombre"
              />
            </Field>
            {removable && (
              <Button type="button" variant="ghost" size="sm" aria-label={`Quitar participante ${index + 1}`} onClick={() => removeRow(index)}>
                Quitar
              </Button>
            )}
          </div>
        ))}
      </fieldset>
      <p>
        <Button type="button" variant="ghost" size="sm" onClick={addRow}>
          Añadir participante
        </Button>
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Creando…' : 'Crear grupo'}
      </Button>
    </form>
  );
}
