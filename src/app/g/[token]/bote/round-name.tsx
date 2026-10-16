'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { renameKittyRound } from '@/server/actions/kitty';
import { Button } from '@/app/_ui/button';
import { Field } from '@/app/_ui/field';
import { runClientAction } from '@/app/_ui/run-client-action';
import { useInlineEdit } from '@/app/_ui/use-inline-edit';

/**
 * A round's heading with its "Renombrar" (T-100): the field opens right under the
 * name, which stays in view, the way people are renamed in Ajustes. It works the
 * same on an open and on a closed round — the name moves no money.
 */
export function RoundName({ token, roundId, name, children }: {
  token: string;
  roundId: string;
  /** The name as shown: the stored one, or the default. */
  name: string;
  /** The heading that shows the name. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const edit = useInlineEdit<HTMLFormElement>(pending);

  function open() {
    setDraft(name);
    setError(null);
    edit.open();
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => renameKittyRound(token, roundId, { name: draft }));
      if (result.ok) { edit.close(); router.refresh(); } else { setError(result.error); }
    });
  }

  function cancel() {
    setError(null);
    edit.close();
  }

  return (
    <>
      {children}
      {edit.editing ? (
        <form ref={edit.panel} className="round-name-edit" onSubmit={save}>
          {/* The name is right above: said only to screen readers, so every round's field has its own name. */}
          <Field label={<>Nuevo nombre<span className="sr-only"> para {name}</span></>} error={error} errorId={`${roundId}-name-error`}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={120}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${roundId}-name-error` : undefined}
            />
          </Field>
          <div className="row-edit-actions">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>Guardar nombre</Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={cancel}>Cancelar</Button>
          </div>
        </form>
      ) : (
        <div className="round-name-actions">
          <Button ref={edit.editButton} size="sm" variant="ghost" aria-label={`Renombrar ${name}`} onClick={open}>
            Renombrar
          </Button>
        </div>
      )}
    </>
  );
}
