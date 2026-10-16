'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteGroup } from '@/server/actions/group';
import { Field } from '@/app/_ui/field';
import { Button } from '@/app/_ui/button';
import { SectionLabel } from '@/app/_ui/section-label';
import { runClientAction } from '@/app/_ui/run-client-action';
import { forgetRecentGroup } from '@/app/_ui/recent-groups-store';

export function GroupSettings({ token, groupName }: { token: string; groupName: string }) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => deleteGroup(token, confirmName));
      if (result.ok) {
        forgetRecentGroup(token);
        router.push('/');
      }
      else setError(result.error);
    });
  }

  return (
    <section className="panel panel--danger on-dark" style={{ marginTop: 20 }}>
      <SectionLabel level={2}>Zona de peligro</SectionLabel>
      <p className="muted">
        Eliminar el grupo borra todos sus datos de forma permanente. Para confirmar, escribe el nombre exacto del grupo:{' '}
        <strong>{groupName}</strong>
      </p>
      <form onSubmit={handleDelete}>
        <Field label="Nombre del grupo">
          <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={groupName} />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="danger" disabled={pending || confirmName !== groupName}>
          Eliminar grupo definitivamente
        </Button>
      </form>
    </section>
  );
}
