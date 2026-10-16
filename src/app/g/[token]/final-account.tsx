import { asCents } from '@/domain/money';
import { finalAccount } from '@/domain/group-charge';
import { MoneyAmount } from '@/app/_ui/money-amount';

/**
 * Under a person's internal balance, while they owe a share of unpaid charges:
 * that share (paid outside the group) and everything they still have to put
 * in. The internal figure above stays the one the settlement plan uses; the
 * two are read side by side, never netted (domain `finalAccount`).
 */
export function FinalAccountLines({ netCents, outsideCents }: { netCents: number; outsideCents: number }) {
  if (outsideCents === 0) return null;
  const account = finalAccount(asCents(netCents), asCents(outsideCents));
  return (
    <dl className="final-account">
      <div>
        <dt>Sin pagar</dt>
        <dd><MoneyAmount cents={asCents(-account.paysOutside)} signed /></dd>
      </div>
      <div className="final-account-total">
        <dt>Total a poner</dt>
        <dd><MoneyAmount cents={account.totalToPay} /></dd>
      </div>
    </dl>
  );
}
