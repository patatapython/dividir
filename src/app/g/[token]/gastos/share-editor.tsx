'use client';

import type { SplitMode } from '@/domain/split';
import { RowInput } from '@/app/_ui/row-input';
import { MODE_LABELS, SHARE_ROW_ERROR, SPLIT_MODES, shareRowIssue, type ShareRow } from './ticket-model';

/** What a share row's number means, shown beside it. SHARES are bare counts. */
const SHARE_UNIT: Record<SplitMode, string | undefined> = {
  EQUAL: undefined,
  SHARES: undefined,
  PERCENTAGE: '%',
  EXACT: '€',
  ADJUSTMENT: '€',
};

/**
 * How one amount is split: the mode, then who it is split between. Shared by an expense line and an unpaid
 * charge, which split the same way (charge-model reuses the item share machinery).
 */
export function ShareEditor({ groupName, splitMode, shares, nameOf, onMode, onShare }: {
  /** Radio-group name; unique per editor on the page. */
  groupName: string;
  splitMode: SplitMode;
  shares: ShareRow[];
  nameOf: (id: string) => string;
  onMode: (mode: SplitMode) => void;
  onShare: (participantId: string, patch: { included?: boolean; raw?: string }) => void;
}) {
  return (
    <>
      <fieldset className="mode-fieldset">
        <legend>Modo de reparto</legend>
        {SPLIT_MODES.map((mode) => (
          <label key={mode} className="mode-option">
            <input type="radio" name={groupName} checked={splitMode === mode} onChange={() => onMode(mode)} />
            {MODE_LABELS[mode]}
          </label>
        ))}
      </fieldset>
      <fieldset className="shares">
        <legend>Entre quién se reparte</legend>
        {shares.map((row) => {
          const name = nameOf(row.participantId);
          const value =
            splitMode === 'EQUAL' ? null : (
              <RowInput
                label={`Parte de ${name}`}
                value={row.raw}
                onChange={(raw) => onShare(row.participantId, { raw })}
                isInvalid={(raw) => shareRowIssue(splitMode, { ...row, raw }) === 'invalid'}
                errorText={SHARE_ROW_ERROR[splitMode]}
                unit={SHARE_UNIT[splitMode]}
              />
            );
          return (
            <div key={row.participantId} className="share-row">
              <label>
                <input
                  type="checkbox"
                  checked={row.included}
                  aria-label={`Incluir a ${name}`}
                  onChange={(e) => onShare(row.participantId, { included: e.target.checked })}
                />
                {name}
              </label>
              {row.included && value}
            </div>
          );
        })}
      </fieldset>
    </>
  );
}
