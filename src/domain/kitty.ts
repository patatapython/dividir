import { Cents, asCents } from './money';
import { allocate } from './allocate';
import { DomainError } from './errors';

export interface KittyContributionInput {
  participantId: string;
  amountCents: Cents;
}

export interface KittyPayout {
  participantId: string;
  amountCents: Cents;
}

const sum = (xs: Cents[]): number => xs.reduce((a, c) => a + c, 0);

/** Bote balance = carried surplus + contributions − communal spends. */
export function kittyBalance(input: {
  carryInCents: Cents;
  contributions: Cents[];
  spends: Cents[];
}): Cents {
  return asCents(input.carryInCents + sum(input.contributions) - sum(input.spends));
}

/**
 * Distributes the whole balance among the round's contributors, proportional
 * to each one's contribution (LRM, deterministic). Equal contributions →
 * equal payout. Requires a positive total weight and a positive balance: a
 * round with no contributions, or with the bote at 0, can only be closed —
 * a payout of zeros is not a distribution.
 */
export function distributeKitty(
  balanceCents: Cents,
  contributions: KittyContributionInput[],
): KittyPayout[] {
  const weights = contributions.map((c) => c.amountCents);
  if (balanceCents === 0 || weights.reduce((a, w) => a + w, 0) <= 0) {
    throw new DomainError('KITTY_NOTHING_TO_DISTRIBUTE');
  }
  const parts = allocate(balanceCents, weights); // allocate throws NEGATIVE_TOTAL if balance < 0
  return contributions.map((c, i) => ({ participantId: c.participantId, amountCents: parts[i] }));
}
