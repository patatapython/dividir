'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reopenKittyRound } from '@/server/actions/kitty';
import { asCents } from '@/domain/money';
import { Button } from '@/app/_ui/button';
import { ConfirmDialog } from '@/app/_ui/confirm-dialog';
import { MoneyAmount } from '@/app/_ui/money-amount';
import { SectionLabel } from '@/app/_ui/section-label';
import { FoldableList } from '@/app/_ui/foldable-list';
import { DotLeaderRow } from '@/app/_ui/dot-leader-row';
import { TicketCard } from '@/app/_ui/ticket-card';
import { Stamp } from '@/app/_ui/stamp';
import { labelSpends, orderContributionsWithLabels } from '@/app/_ui/repeat-labels';
import { runClientAction } from '@/app/_ui/run-client-action';
import type { ClosedRoundView } from '@/server/queries';
import { RoundName } from './round-name';


/** A closed round is a full record, not a tombstone (v1.3 §5): it expands to
 * the round's complete sheet, and mistakes are fixed by reopening it. */
export function ClosedRoundCard({
  token,
  round,
  hasOpenRound,
  defaultExpanded = false,
}: {
  token: string;
  round: ClosedRoundView;
  hasOpenRound: boolean;
  /** On the round's own page the whole sheet is what was asked for. */
  defaultExpanded?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reopen() {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => reopenKittyRound(token, round.id));
      if (!result.ok) { setError(result.error); return; }
      // The reopened round is the open one again: go where it is edited.
      setConfirming(false);
      router.push(`/g/${token}/bote`);
    });
  }

  const repartida = round.closeAction === 'REPARTIR';
  return (
    <TicketCard
      className={repartida ? 'ticket--featured closed-round' : 'ticket--featured closed-round closed-round--cerrada'}
    >
      <Stamp sticker tone={repartida ? 'lima' : 'arena'}>
        {repartida ? 'Repartido ✔' : 'Cerrado'}
      </Stamp>
      <RoundName token={token} roundId={round.id} name={round.name ?? 'Ronda'}>
        <h2 className="closed-round-title">{round.name ?? 'Ronda'}</h2>
      </RoundName>

      {round.closeAction === 'REPARTIR' ? (
        <FoldableList label="Reparto">
          {round.payout?.map((p) => (
            <DotLeaderRow
              key={p.participantId}
              listRow
              label={<span className="muted">{p.participantName}</span>}
              end={<MoneyAmount cents={asCents(p.amountCents)} />}
            />
          ))}
        </FoldableList>
      ) : (
        <DotLeaderRow
          label={<span className="muted">Sobran · informativo</span>}
          end={<MoneyAmount cents={asCents(round.leftoverCents)} />}
        />
      )}

      <div style={{ marginTop: 8 }}>
        <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Ocultar' : 'Ver detalle'}
        </Button>
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {round.carryInCents > 0 && (
            <DotLeaderRow
              label={<span className="muted">Sobrante de otra vez</span>}
              end={<MoneyAmount cents={asCents(round.carryInCents)} />}
            />
          )}

          {round.contributions.length > 0 && <SectionLabel level={3}>Aportes</SectionLabel>}
          <FoldableList label="Aportes">
            {orderContributionsWithLabels(round.contributions).map((c) => (
              <DotLeaderRow key={c.id} listRow label={c.displayLabel} end={<MoneyAmount cents={asCents(c.amountCents)} />} />
            ))}
          </FoldableList>

          {round.spends.length > 0 && <SectionLabel level={3}>Gastos del bote</SectionLabel>}
          <FoldableList label="Gastos del bote">
            {labelSpends(round.spends).map((s) => (
              <DotLeaderRow key={s.id} listRow label={s.displayLabel} end={<MoneyAmount cents={asCents(-s.amountCents)} signed />} />
            ))}
          </FoldableList>

          <div style={{ marginTop: 10 }}>
            <Button size="sm" variant="ghost" disabled={pending || hasOpenRound} onClick={() => { setError(null); setConfirming(true); }}>
              Reabrir ronda
            </Button>
            {hasOpenRound && (
              <p className="muted" style={{ marginTop: 4 }}>
                Cierra la ronda abierta para poder reabrir esta.
              </p>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={`¿Reabrir ${round.name ?? 'la ronda'}?`}
        confirmLabel="Reabrir"
        pending={pending}
        error={error}
        onConfirm={reopen}
        onCancel={() => { setConfirming(false); setError(null); }}
      >
        <p className="muted">
          {repartida
            ? 'Se descarta el reparto guardado; al cerrarla de nuevo se calculará otra vez.'
            : 'La ronda vuelve a admitir aportes y gastos hasta que la cierres de nuevo.'}
        </p>
      </ConfirmDialog>
    </TicketCard>
  );
}
