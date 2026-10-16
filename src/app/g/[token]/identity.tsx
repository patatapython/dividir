'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useState, useTransition } from 'react';
import { claimParticipant } from '@/server/actions/participants';
import { Dialog } from '@/app/_ui/dialog';
import { Chip } from '@/app/_ui/chip';
import { Button } from '@/app/_ui/button';
import { runClientAction } from '@/app/_ui/run-client-action';
import type { IdentityOption } from './identity-options';
import { asksIdentity } from './group-navigation';

interface IdentityState {
  token: string;
  options: IdentityOption[];
  current: IdentityOption | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const IdentityContext = createContext<IdentityState | null>(null);

function useIdentity(): IdentityState {
  const state = useContext(IdentityContext);
  if (!state) throw new Error('Identity components must sit inside IdentityProvider');
  return state;
}

/**
 * Who this device is in the group (a convenience, spec §4.8). The header
 * control and the selector share this state but live apart: the selector must
 * not sit inside the dark header, whose `.on-dark` rules would recolour it.
 * A device with no identity yet is asked once, on the first page that asks
 * (asksIdentity): the share page does not, so a new group can be shared first
 * and asks when entered.
 */
export function IdentityProvider({ token, options, children }: {
  token: string; options: IdentityOption[]; children: React.ReactNode;
}) {
  const current = options.find((o) => o.current);
  const asks = asksIdentity(usePathname(), `/g/${token}`);
  const [openedByHand, setOpenedByHand] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Derived, not stored: the question appears the moment a page that asks is shown.
  const open = openedByHand || (!current && asks && !dismissed);
  function setOpen(next: boolean) {
    setOpenedByHand(next);
    // Only closing the question where the group asks answers it; a look on the share page does not.
    if (!next && asks) setDismissed(true);
  }
  return (
    <IdentityContext.Provider value={{ token, options, current, open, setOpen }}>
      {children}
    </IdentityContext.Provider>
  );
}

/** "Eres X", or "¿Quién eres?" when this device has no identity: both open the selector. */
export function IdentityButton() {
  const { current, setOpen } = useIdentity();
  return (
    <Button variant="ghost" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {current ? `Eres ${current.name}` : '¿Quién eres?'} <span aria-hidden="true">▾</span>
    </Button>
  );
}

export function IdentityDialog() {
  const { token, options, current, open, setOpen } = useIdentity();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setError(null);
    setOpen(false);
  }

  function choose(option: IdentityOption) {
    if (option.current) return close();
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => claimParticipant(token, option.id));
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <Dialog open={open} title="¿Quién eres?" onClose={close}>
      <p className="muted">Elige tu nombre para que tus acciones queden registradas en la actividad.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        {options.map((o) => (
          <Chip key={o.id} on={o.current} onToggle={pending ? undefined : () => choose(o)}>
            {o.name}
            {o.current && <span> (tú)</span>}
            {o.claimedElsewhere && <span className="muted"> (ya elegido en otro dispositivo)</span>}
          </Chip>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <Button variant="ghost" size="sm" onClick={close}>
        {current ? 'Cancelar' : 'Ahora no'}
      </Button>
    </Dialog>
  );
}
