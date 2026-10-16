/**
 * Reads one activity log entry: what it says, how much money it moved and which
 * entity it is about (T-44). Pure — the payload is the snapshot each action wrote
 * (`logActivity`), read defensively because old entries predate some fields.
 * Money stays in cents; the UI formats it. Deletions never lead anywhere: what
 * they are about can no longer be seen.
 */

/** The entity an entry is about. `getActivity` turns it into a link only while it still exists. */
export type ActivityRef =
  | { kind: 'expense' | 'charge' | 'kittyRound' | 'kittyContribution' | 'kittySpend'; id: string }
  | { kind: 'participants' };

export interface ActivityDescription {
  label: string;
  subject: string | null;
  detail: string | null;
  amountCents: number | null;
  /** Set only when an edit changed the amount. */
  previousAmountCents: number | null;
  ref: ActivityRef | null;
}

/** An ownerless payer, as the rest of the UI names it (D-04). */
export const OWNERLESS_NAME = 'Sobrante';

const ACTION_LABELS: Record<string, string> = {
  'group.create': 'creó el grupo',
  'group.delete': 'eliminó el grupo',
  'participant.create': 'añadió un participante',
  'participant.update': 'renombró un participante',
  'participant.delete': 'eliminó un participante',
  'participant.archive': 'archivó un participante',
  'participant.unarchive': 'desarchivó un participante',
  'expense.create': 'añadió un gasto',
  'expense.update': 'editó un gasto',
  'expense.delete': 'eliminó un gasto',
  'payment.create': 'registró un pago',
  'payment.delete': 'eliminó un pago',
  'refund.create': 'registró un reembolso',
  'refund.delete': 'eliminó un reembolso',
  'charge.create': 'añadió un gasto sin pagar',
  'charge.update': 'editó un gasto sin pagar',
  'charge.delete': 'eliminó un gasto sin pagar',
  'charge.pay': 'marcó como pagado un gasto sin pagar',
  'kitty.open': 'abrió una ronda del bote',
  'kitty.contribute': 'aportó al bote',
  'kitty.spend': 'registró un gasto del bote',
  'kitty.close': 'cerró una ronda del bote',
  'kitty.reopen': 'reabrió una ronda del bote',
  'kitty.rename': 'renombró una ronda del bote',
};

/** kitty.contribute / kitty.spend share one action; `op` says what really happened. */
const KITTY_OP_LABELS: Record<string, Record<string, string>> = {
  'kitty.contribute': { bulk: 'registró aportes al bote', edit: 'editó un aporte al bote', delete: 'eliminó un aporte al bote' },
  'kitty.spend': { edit: 'editó un gasto del bote', delete: 'eliminó un gasto del bote' },
};

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(record) : [];
}

const conjunction = new Intl.ListFormat('es', { style: 'long', type: 'conjunction' });

/** "Ana, Bea y Carla"; people no longer in the group drop out; null when nobody is left. */
function names(ids: unknown[], nameOf: ReadonlyMap<string, string>): { text: string; count: number } | null {
  const known = ids.map((id) => (id === null ? OWNERLESS_NAME : nameOf.get(String(id)))).filter((n): n is string => !!n);
  return known.length === 0 ? null : { text: conjunction.format(known), count: known.length };
}

function prefixed(prefix: string, who: { text: string } | null): string | null {
  return who ? `${prefix} ${who.text}` : null;
}

function idRef(kind: Exclude<ActivityRef['kind'], 'participants'>, id: unknown): ActivityRef | null {
  const value = text(id);
  return value ? { kind, id: value } : null;
}

function describe(
  base: Pick<ActivityDescription, 'label'> & Partial<ActivityDescription>,
): ActivityDescription {
  return { subject: null, detail: null, amountCents: null, previousAmountCents: null, ref: null, ...base };
}

/** Before/after amounts of an edit: the old one only when it changed. */
function amounts(previous: Json, next: Json): Pick<ActivityDescription, 'amountCents' | 'previousAmountCents'> {
  const now = cents(next.amountCents);
  const before = cents(previous.amountCents);
  return { amountCents: now, previousAmountCents: before !== null && before !== now ? before : null };
}

/** "pagó Ana" / "pagaron Ana y Sobrante"; null when none of the payers can be named. */
export function payersDetail(payers: { participantId?: unknown }[], nameOf: ReadonlyMap<string, string>): string | null {
  const who = names(payers.map((p) => p.participantId ?? null), nameOf);
  if (!who) return null;
  return `${who.count === 1 ? 'pagó' : 'pagaron'} ${who.text}`;
}

export function describeActivity(action: string, payload: unknown, nameOf: ReadonlyMap<string, string>): ActivityDescription {
  const data = record(payload);
  const previous = record(data.previous);
  const op = text(data.op);
  const label = (op && KITTY_OP_LABELS[action]?.[op]) ?? ACTION_LABELS[action] ?? action;

  switch (action) {
    case 'group.create':
      return describe({ label, subject: text(data.name), detail: prefixed('con', listNames(data.participants)) });
    case 'participant.create':
      return describe({ label, subject: text(data.name), ref: { kind: 'participants' } });
    case 'participant.update':
      return describe({ label, subject: text(data.name), detail: prefixed('antes', listNames([previous.name])), ref: { kind: 'participants' } });
    case 'participant.archive':
    case 'participant.unarchive':
      return describe({ label, subject: text(previous.name), ref: { kind: 'participants' } });
    case 'participant.delete':
      return describe({ label, subject: text(previous.name) });

    case 'expense.create':
      return describe({ label, subject: text(data.title), detail: payersDetail(list(data.payers), nameOf), amountCents: cents(data.amountCents), ref: idRef('expense', data.id) });
    case 'expense.update': {
      const next = record(data.next);
      return describe({ label, subject: text(next.title), detail: payersDetail(list(next.payers), nameOf), ...amounts(previous, next), ref: idRef('expense', next.id) });
    }
    case 'expense.delete':
      return describe({ label, subject: text(previous.title), detail: payersDetail(list(previous.payers), nameOf), amountCents: cents(previous.amountCents) });

    case 'payment.create':
    case 'payment.delete': {
      const payment = action === 'payment.create' ? data : previous;
      const from = nameOf.get(String(payment.fromId));
      const to = nameOf.get(String(payment.toId));
      return describe({ label, detail: from && to ? `${from} → ${to}` : null, amountCents: cents(payment.amountCents) });
    }

    case 'refund.create':
    case 'refund.delete': {
      const refund = action === 'refund.create' ? data : previous;
      return describe({
        label,
        detail: prefixed('recibió', names([refund.receivedById], nameOf)),
        amountCents: cents(refund.amountCents),
        ref: action === 'refund.create' ? idRef('expense', refund.expenseId) : null,
      });
    }

    case 'charge.create':
      return describe({ label, subject: text(data.concept), amountCents: cents(data.amountCents), ref: idRef('charge', data.id) });
    case 'charge.update': {
      const next = record(data.next);
      return describe({ label, subject: text(next.concept), ...amounts(previous, next), ref: idRef('charge', next.id) });
    }
    case 'charge.delete':
      return describe({ label, subject: text(previous.concept), amountCents: cents(previous.amountCents) });
    case 'charge.pay':
      // The charge is gone; the entry leads to the expense it became.
      return describe({
        label,
        subject: text(previous.concept),
        detail: prefixed('pagó', names([data.payerId], nameOf)),
        amountCents: cents(previous.amountCents),
        ref: idRef('expense', data.expenseId),
      });

    case 'kitty.open': {
      const carryIn = cents(data.carryInCents);
      const hasCarryIn = carryIn !== null && carryIn > 0;
      return describe({
        label,
        subject: text(data.name),
        detail: hasCarryIn ? 'con sobrante de otra vez' : null,
        amountCents: hasCarryIn ? carryIn : null,
        ref: idRef('kittyRound', data.id),
      });
    }
    case 'kitty.contribute': {
      if (op === 'bulk') {
        const contributions = list(data.contributions);
        return describe({ label, detail: prefixed('de', names(contributions.map((c) => c.participantId), nameOf)), amountCents: cents(data.totalCents), ref: idRef('kittyRound', data.roundId) });
      }
      // A single contribution: edited, deleted, or created before bulk entry existed
      // (that old shape has no contribution id, but it names its round).
      return describe({
        label,
        detail: prefixed('de', names([data.participantId], nameOf)),
        amountCents: cents(data.amountCents),
        ref: op === 'delete' ? null : op === 'edit' ? idRef('kittyContribution', data.id) : idRef('kittyRound', data.roundId),
      });
    }
    case 'kitty.spend':
      return describe({
        label,
        subject: text(data.concept),
        amountCents: cents(data.amountCents),
        ref: op === 'delete' ? null : op === 'edit' ? idRef('kittySpend', data.id) : idRef('kittyRound', data.roundId),
      });
    case 'kitty.close': {
      // The round's name at close time (session 12); entries logged before carry none.
      const ref = idRef('kittyRound', data.roundId);
      const subject = text(data.name);
      if (data.action !== 'REPARTIR') return describe({ label, subject, detail: 'sin repartir', ref });
      const payout = list(data.payout);
      const total = payout.reduce((acc, p) => acc + (cents(p.amountCents) ?? 0), 0);
      return describe({ label, subject, detail: prefixed('repartido entre', names(payout.map((p) => p.participantId), nameOf)), amountCents: total, ref });
    }
    case 'kitty.reopen':
      return describe({ label, subject: text(data.name), ref: idRef('kittyRound', data.roundId) });
    case 'kitty.rename':
      return describe({ label, subject: text(data.name), detail: prefixed('antes', listNames([previous.name])), ref: idRef('kittyRound', data.roundId) });

    default:
      return describe({ label, subject: text(data.title) ?? text(data.name) });
  }
}

/** Names written into the payload itself (not ids): the group's starting list, a previous name. */
function listNames(values: unknown): { text: string } | null {
  const known = (Array.isArray(values) ? values : []).map(text).filter((n): n is string => n !== null);
  return known.length === 0 ? null : { text: conjunction.format(known) };
}
