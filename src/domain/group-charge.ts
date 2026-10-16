import { Cents, asCents } from './money';

export interface GroupChargeForTotals {
  shares: { participantId: string; amountCents: Cents }[];
}

/**
 * Model A (spec §3, §7.2): an unpaid group charge has NO payer — each
 * participant's share is a debt owed OUTSIDE (to the landlord), never to another
 * member. This sums each person's external debt across all charges.
 *
 * It never enters computeBalances / settle(): modelling it as "the bote paid it"
 * would invent money that does not exist and make the debt vanish (spec §3, proof
 * by absurdity). The two layers stay physically separate — surfaced as its own
 * "Gastos sin pagar" list, never blended into the internal net.
 */
export function externalChargesByParticipant(
  charges: GroupChargeForTotals[],
): Map<string, Cents> {
  const totals = new Map<string, number>();
  for (const charge of charges) {
    for (const share of charge.shares) {
      totals.set(share.participantId, (totals.get(share.participantId) ?? 0) + share.amountCents);
    }
  }
  return new Map([...totals.entries()].map(([id, v]) => [id, asCents(v)]));
}

export interface FinalAccount {
  /** Owed to other members: the internal settlement (Saldos plan). */
  paysInside: Cents;
  /** Share of the unpaid charges, paid outside the group. */
  paysOutside: Cents;
  /** Owed to this person by other members. */
  receives: Cents;
  /** Everything this person still has to put in: inside plus outside. */
  totalToPay: Cents;
}

/**
 * One person's final account while charges are unpaid (owner review, session
 * 10). The two layers above stay separate for settle(); this only reads them
 * side by side, and never nets one against the other: a creditor who also
 * owes a share outside still has to pay it AND still has to be paid, which a
 * single netted figure would hide.
 */
export function finalAccount(internalNetCents: Cents, outsideShareCents: Cents): FinalAccount {
  const paysInside = Math.max(0, -internalNetCents);
  return {
    paysInside: asCents(paysInside),
    paysOutside: outsideShareCents,
    receives: asCents(Math.max(0, internalNetCents)),
    totalToPay: asCents(paysInside + outsideShareCents),
  };
}
