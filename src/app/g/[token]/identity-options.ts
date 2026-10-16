export interface IdentityParticipant {
  id: string;
  name: string;
  claimedAt: Date | null;
  archivedAt: Date | null;
}

export interface IdentityOption {
  id: string;
  name: string;
  /** The identity this device holds. */
  current: boolean;
  /** Chosen on some device, and not the one this device holds. */
  claimedElsewhere: boolean;
}

/**
 * Who can be chosen in the identity selector: active participants, plus this
 * device's own identity even if it was archived since (it is who this device
 * is, and dropping it would ask again on every visit).
 */
export function identityOptions(participants: IdentityParticipant[], claimedId: string | undefined): IdentityOption[] {
  return participants
    .filter((p) => !p.archivedAt || p.id === claimedId)
    .map((p) => {
      const current = p.id === claimedId;
      return { id: p.id, name: p.name, current, claimedElsewhere: !current && p.claimedAt !== null };
    });
}
