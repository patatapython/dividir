import type { Prisma } from '@/generated/prisma/client';
import { prisma } from './db';
import { asCents, type Cents } from '@/domain/money';
import { computeBalances, filterSettleable } from '@/domain/balances';
import { settle } from '@/domain/settle';
import { kittyBalance } from '@/domain/kitty';
import { externalChargesByParticipant } from '@/domain/group-charge';
import { PARTICIPANT_ORDER } from './group-scope';
import { dbDateToString } from './dates';
import type { SplitMode } from '@/domain/split';
import { describeActivity, OWNERLESS_NAME, type ActivityRef } from './activity-view';

export interface ParticipantView { id: string; name: string; claimed: boolean; archivedAt: Date | null }
export interface BalanceView { participantId: string; name: string; balanceCents: number }
export interface TransferView { fromId: string; fromName: string; toId: string; toName: string; amountCents: number }
export interface FeedItem {
  kind: 'expense' | 'payment';
  id: string;
  date: string;
  createdAt: Date;
  title: string;
  detail: string;
  amountCents: number;
}
export interface ExternalChargeView { participantId: string; name: string; amountCents: number }
export interface ChargeShareView { participantId: string; name: string; amountCents: number }
/** An unpaid charge with what each person owes of it outside the group, in participant order. */
export interface ChargeListItem { id: string; concept: string; amountCents: number; date: string; shares: ChargeShareView[] }
// Declared leftover ("Sobrante" in the UI). remainingCents is DERIVED (declared −
// applied) and may go negative if nobody has paid more than was declared.
export interface OwnerlessView { declaredCents: number; appliedCents: number; remainingCents: number }
export interface GroupOverview {
  group: { id: string; name: string };
  participants: ParticipantView[];
  balances: BalanceView[];
  plan: TransferView[];
  feed: FeedItem[];
  externalCharges: ExternalChargeView[];
  charges: ChargeListItem[];
  ownerless: OwnerlessView;
}

type ExpenseWithRelations = {
  id: string;
  title: string;
  amountCents: number;
  date: Date;
  createdAt: Date;
  payers: { participantId: string | null; amountCents: number }[];
  items: { shares: { participantId: string; amountCents: number }[] }[];
};

function aggregateItemShares(expense: ExpenseWithRelations): { participantId: string; amountCents: Cents }[] {
  const map = new Map<string, number>();
  for (const item of expense.items) {
    for (const s of item.shares) {
      map.set(s.participantId, (map.get(s.participantId) ?? 0) + s.amountCents);
    }
  }
  return [...map.entries()].map(([participantId, amountCents]) => ({ participantId, amountCents: asCents(amountCents) }));
}

/**
 * Refund shares are read from the frozen snapshot computed once at creation
 * time — NEVER recomputed from the (possibly since-edited) expense.
 */
function refundSharesFromSnapshot(snapshot: unknown): { participantId: string; amountCents: Cents }[] {
  return (snapshot as { participantId: string; amountCents: number }[]).map((s) => ({
    participantId: s.participantId,
    amountCents: asCents(s.amountCents),
  }));
}

/**
 * Last tiebreak of every list order: rows can tie on date and createdAt (one
 * transaction, bulk inserts), and a partial order would let "Ver más" re-sort
 * a row across the page boundary. Code-point order, not locale order.
 */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Feed line for an expense's payer. An ownerless payer reads "Sobrante". */
function payerDetail(payers: { participantId: string | null }[], nameOf: Map<string, string>): string {
  const first = payers[0];
  if (!first) return 'Pagó';
  if (first.participantId === null) return `Pagó ${OWNERLESS_NAME}`;
  return `Pagó ${nameOf.get(first.participantId) ?? ''}`;
}

export async function getGroupOverview(token: string): Promise<GroupOverview | null> {
  const group = await prisma.group.findUnique({
    where: { id: token },
    include: {
      participants: { orderBy: PARTICIPANT_ORDER },
      expenses: {
        include: { payers: true, items: { include: { shares: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      },
      payments: { include: { from: true, to: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] },
      refunds: true,
      groupCharges: { include: { shares: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] },
    },
  });
  if (!group) return null;

  const nameOf = new Map(group.participants.map((p) => [p.id, p.name]));

  const balancesMap = computeBalances(
    group.participants.map((p) => p.id),
    group.expenses.map((e) => ({
      payers: e.payers.map((p) => ({ participantId: p.participantId, amountCents: asCents(p.amountCents) })),
      shares: aggregateItemShares(e),
    })),
    group.payments.map((p) => ({ fromId: p.fromId, toId: p.toId, amountCents: asCents(p.amountCents) })),
    group.refunds.map((r) => ({
      expenseId: r.expenseId,
      receivedById: r.receivedById,
      amountCents: asCents(r.amountCents),
      shares: refundSharesFromSnapshot(r.sharesSnapshot),
    })),
  );

  // Fold the ownerless bucket onto the people before settle() — the
  // settleable vector is zero-sum by construction (spec §4/§7.1).
  const people = group.participants.map((p) => ({ id: p.id, isArchived: p.archivedAt !== null }));
  const settleableMap = filterSettleable(balancesMap, people);
  const plan = settle(settleableMap).map((t) => ({
    fromId: t.from,
    fromName: nameOf.get(t.from) ?? '',
    toId: t.to,
    toName: nameOf.get(t.to) ?? '',
    amountCents: t.amount,
  }));

  // Model A external debt — sums each person's share across unpaid charges;
  // surfaced in its OWN section, never blended into the internal net (spec §7.4).
  const externalMap = externalChargesByParticipant(
    group.groupCharges.map((c) => ({
      shares: c.shares.map((s) => ({ participantId: s.participantId, amountCents: asCents(s.amountCents) })),
    })),
  );

  const ownerlessApplied = group.expenses
    .flatMap((e) => e.payers)
    .filter((p) => p.participantId === null)
    .reduce((acc, p) => acc + p.amountCents, 0);

  const feed: FeedItem[] = [
    ...group.expenses.map((e) => ({
      kind: 'expense' as const,
      id: e.id,
      date: dbDateToString(e.date),
      createdAt: e.createdAt,
      title: e.title,
      detail: payerDetail(e.payers, nameOf),
      amountCents: e.amountCents,
    })),
    ...group.payments.map((p) => ({
      kind: 'payment' as const,
      id: p.id,
      date: dbDateToString(p.date),
      createdAt: p.createdAt,
      title: 'Pago',
      detail: `${p.from.name} → ${p.to.name}`,
      amountCents: p.amountCents,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime() || byCodePoint(b.id, a.id));

  return {
    group: { id: group.id, name: group.name },
    participants: group.participants.map((p) => ({ id: p.id, name: p.name, claimed: p.claimedAt !== null, archivedAt: p.archivedAt })),
    balances: group.participants.map((p) => ({
      participantId: p.id,
      name: p.name,
      balanceCents: settleableMap.get(p.id) ?? 0,
    })),
    plan,
    feed,
    externalCharges: group.participants
      .map((p) => ({ participantId: p.id, name: p.name, amountCents: externalMap.get(p.id) ?? 0 }))
      .filter((e) => e.amountCents !== 0),
    charges: group.groupCharges.map((c) => {
      const shareOf = new Map(c.shares.map((s) => [s.participantId, s.amountCents]));
      return {
        id: c.id,
        concept: c.concept,
        amountCents: c.amountCents,
        date: dbDateToString(c.date),
        shares: group.participants.flatMap((p) => {
          const amountCents = shareOf.get(p.id) ?? 0;
          return amountCents === 0 ? [] : [{ participantId: p.id, name: p.name, amountCents }];
        }),
      };
    }),
    ownerless: ownerlessView(group.ownerlessExtraCents, ownerlessApplied),
  };
}

/**
 * The declared leftover ("Sobrante") — declared once; how much is left is DERIVED as
 * declared − what nobody already paid across expenses, so it never drifts.
 */
function ownerlessView(declaredCents: number, appliedCents: number): OwnerlessView {
  return { declaredCents, appliedCents, remainingCents: declaredCents - appliedCents };
}

/**
 * The ownerless figures alone, for form pages that already hold the group row
 * (the layout's read) and need no balance math: one aggregate over the payers.
 */
export async function getOwnerlessView(group: { id: string; ownerlessExtraCents: number }): Promise<OwnerlessView> {
  const applied = await prisma.expensePayer.aggregate({
    _sum: { amountCents: true },
    where: { participantId: null, expense: { groupId: group.id } },
  });
  return ownerlessView(group.ownerlessExtraCents, applied._sum.amountCents ?? 0);
}

export interface SettingsView {
  groupName: string;
  participants: ParticipantView[];
  hasMovements: boolean;
  /** The declared leftover lives here: Ajustes is the one place it is declared (D-04). */
  ownerless: OwnerlessView;
}

/** Settings tab (/ajustes): participants, the declared leftover and the danger zone — no balance math. */
export async function getSettingsView(token: string): Promise<SettingsView | null> {
  const group = await prisma.group.findUnique({
    where: { id: token },
    include: {
      participants: { orderBy: PARTICIPANT_ORDER },
      _count: { select: { expenses: true, payments: true } },
    },
  });
  if (!group) return null;
  return {
    groupName: group.name,
    participants: group.participants.map((p) => ({ id: p.id, name: p.name, claimed: p.claimedAt !== null, archivedAt: p.archivedAt })),
    hasMovements: group._count.expenses + group._count.payments > 0,
    ownerless: await getOwnerlessView(group),
  };
}

type LedgerShare = { participantId: string; amountCents: number };

/** Everything the reparto ledger is made of, for the CSV export (T-53). The bote is its own modality (D-01). */
export interface LedgerExport {
  groupName: string;
  participants: { id: string; name: string; archived: boolean }[];
  expenses: { id: string; date: string; createdAt: Date; title: string; amountCents: number; payers: { participantId: string | null; amountCents: number }[]; shares: LedgerShare[] }[];
  payments: { id: string; date: string; createdAt: Date; fromId: string; toId: string; amountCents: number }[];
  refunds: { id: string; createdAt: Date; expenseTitle: string; receivedById: string; amountCents: number; shares: LedgerShare[] }[];
  charges: { id: string; date: string; createdAt: Date; concept: string; amountCents: number; shares: LedgerShare[] }[];
}

/** One scoped read of the whole reparto ledger: every relation hangs off the group row (§2.1). */
export async function getLedgerExport(token: string): Promise<LedgerExport | null> {
  const group = await prisma.group.findUnique({
    where: { id: token },
    include: {
      participants: { orderBy: PARTICIPANT_ORDER },
      expenses: { include: { payers: true, items: { include: { shares: true } } } },
      payments: true,
      refunds: { include: { expense: { select: { title: true } } } },
      groupCharges: { include: { shares: true } },
    },
  });
  if (!group) return null;
  return {
    groupName: group.name,
    participants: group.participants.map((p) => ({ id: p.id, name: p.name, archived: p.archivedAt !== null })),
    expenses: group.expenses.map((e) => ({
      id: e.id,
      date: dbDateToString(e.date),
      createdAt: e.createdAt,
      title: e.title,
      amountCents: e.amountCents,
      payers: e.payers.map((p) => ({ participantId: p.participantId, amountCents: p.amountCents })),
      shares: aggregateItemShares(e),
    })),
    payments: group.payments.map((p) => ({
      id: p.id,
      date: dbDateToString(p.date),
      createdAt: p.createdAt,
      fromId: p.fromId,
      toId: p.toId,
      amountCents: p.amountCents,
    })),
    refunds: group.refunds.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      expenseTitle: r.expense.title,
      receivedById: r.receivedById,
      amountCents: r.amountCents,
      shares: refundSharesFromSnapshot(r.sharesSnapshot),
    })),
    charges: group.groupCharges.map((c) => ({
      id: c.id,
      date: dbDateToString(c.date),
      createdAt: c.createdAt,
      concept: c.concept,
      amountCents: c.amountCents,
      shares: c.shares.map((s) => ({ participantId: s.participantId, amountCents: s.amountCents })),
    })),
  };
}

export interface KittyView {
  activeParticipants: { id: string; name: string }[];
  openRound: {
    id: string;
    name: string | null;
    carryInCents: number;
    balanceCents: number;
    contributions: { id: string; participantId: string; participantName: string; amountCents: number }[];
    spends: { id: string; concept: string; amountCents: number }[];
  } | null;
}

export interface ClosedRoundView {
  id: string;
  name: string | null;
  closeAction: string;
  carryInCents: number;
  leftoverCents: number;
  contributions: { id: string; participantId: string; participantName: string; amountCents: number }[];
  spends: { id: string; concept: string; amountCents: number }[];
  payout: { participantId: string; participantName: string; amountCents: number }[] | null;
  closedAt: Date;
}

export interface ClosedRoundsPage {
  hasOpenRound: boolean;
  /** The newest `limit` closed rounds. */
  rounds: ClosedRoundView[];
  total: number;
}

export interface ClosedRoundPage {
  hasOpenRound: boolean;
  round: ClosedRoundView;
}

/**
 * Read-only projection of the communal bote's open round (§8, v1.3 delta) for
 * Bote › Ronda; closed rounds are paged by getClosedRounds. The bote never
 * enters person-to-person settle(), so this view is fully independent of
 * getGroupOverview's balances.
 */
export async function getKittyView(token: string): Promise<KittyView | null> {
  const group = await prisma.group.findUnique({
    where: { id: token },
    include: { participants: { orderBy: PARTICIPANT_ORDER } },
  });
  if (!group) return null;
  const nameOf = new Map(group.participants.map((p) => [p.id, p.name]));

  const activeParticipants = group.participants
    .filter((p) => p.archivedAt === null)
    .map((p) => ({ id: p.id, name: p.name }));

  const open = await prisma.kittyRound.findFirst({
    where: { groupId: group.id, closedAt: null }, // §2.1 scope
    include: { contributions: { orderBy: { id: 'asc' } }, spends: { orderBy: { date: 'asc' } } },
  });

  const openRound = open
    ? {
        id: open.id,
        name: open.name,
        carryInCents: open.carryInCents,
        balanceCents: kittyBalance({
          carryInCents: asCents(open.carryInCents),
          contributions: open.contributions.map((c) => asCents(c.amountCents)),
          spends: open.spends.map((s) => asCents(s.amountCents)),
        }) as number,
        contributions: open.contributions.map((c) => ({
          id: c.id,
          participantId: c.participantId,
          participantName: nameOf.get(c.participantId) ?? '',
          amountCents: c.amountCents,
        })),
        spends: open.spends.map((s) => ({ id: s.id, concept: s.concept, amountCents: s.amountCents })),
      }
    : null;

  return { activeParticipants, openRound };
}

/**
 * Bote › Cerradas, paged like every long list (T-71): the newest `limit` closed
 * rounds and how many there are, so none is ever out of reach (session 11, F-04).
 * A closed round's leftover is DERIVED here (carryIn + aportes − gastos) —
 * informational only, never stored (v1.3 §1).
 */
export async function getClosedRounds(token: string, limit: number): Promise<ClosedRoundsPage | null> {
  const group = await prisma.group.findUnique({ where: { id: token }, include: { participants: true } });
  if (!group) return null;
  const nameOf = new Map(group.participants.map((p) => [p.id, p.name]));
  const where = { groupId: group.id, closedAt: { not: null } }; // §2.1 scope
  const [total, open, closed] = await Promise.all([
    prisma.kittyRound.count({ where }),
    prisma.kittyRound.count({ where: { groupId: group.id, closedAt: null } }),
    prisma.kittyRound.findMany({
      where,
      orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: CLOSED_ROUND_SHEET,
    }),
  ]);
  return { hasOpenRound: open > 0, rounds: closed.map((r) => closedRoundView(r, nameOf)), total };
}

/**
 * One closed round of the group, by id: its own page, so a link to it (Actividad)
 * never depends on which page of Cerradas the round falls on (session 12). Null
 * when the token is unknown, or the round is not a closed round OF THIS GROUP
 * (another group's id reads as missing, spec §2.1).
 */
export async function getClosedRound(token: string, roundId: string): Promise<ClosedRoundPage | null> {
  const group = await prisma.group.findUnique({ where: { id: token }, include: { participants: true } });
  if (!group) return null;
  const [round, open] = await Promise.all([
    prisma.kittyRound.findFirst({
      where: { id: roundId, groupId: group.id, closedAt: { not: null } }, // §2.1 scope
      include: CLOSED_ROUND_SHEET,
    }),
    prisma.kittyRound.count({ where: { groupId: group.id, closedAt: null } }),
  ]);
  if (!round) return null;
  return { hasOpenRound: open > 0, round: closedRoundView(round, new Map(group.participants.map((p) => [p.id, p.name]))) };
}

const CLOSED_ROUND_SHEET = {
  contributions: { orderBy: { id: 'asc' } },
  spends: { orderBy: { date: 'asc' } },
} satisfies Prisma.KittyRoundInclude;

/** A closed round's leftover is DERIVED here (v1.3 §1): REPARTIR empties it, CERRAR leaves an informational figure. */
function closedRoundView(
  r: Prisma.KittyRoundGetPayload<{ include: typeof CLOSED_ROUND_SHEET }>,
  nameOf: Map<string, string>,
): ClosedRoundView {
  return {
    id: r.id,
    name: r.name,
    closeAction: r.closeAction ?? '',
    carryInCents: r.carryInCents,
    leftoverCents:
      r.closeAction === 'REPARTIR'
        ? 0
        : (kittyBalance({
            carryInCents: asCents(r.carryInCents),
            contributions: r.contributions.map((c) => asCents(c.amountCents)),
            spends: r.spends.map((s) => asCents(s.amountCents)),
          }) as number),
    contributions: r.contributions.map((c) => ({
      id: c.id,
      participantId: c.participantId,
      participantName: nameOf.get(c.participantId) ?? '',
      amountCents: c.amountCents,
    })),
    spends: r.spends.map((s) => ({ id: s.id, concept: s.concept, amountCents: s.amountCents })),
    payout:
      (r.payoutSnapshot as { participantId: string; amountCents: number }[] | null)?.map((p) => ({
        participantId: p.participantId,
        participantName: nameOf.get(p.participantId) ?? '',
        amountCents: p.amountCents,
      })) ?? null,
    closedAt: r.closedAt as Date,
  };
}

export interface ExpenseForEdit {
  id: string;
  title: string;
  amountCents: number;
  date: string;
  payers: { participantId: string | null; amountCents: number }[];
  items: {
    label: string | null;
    amountCents: number;
    splitMode: SplitMode;
    shares: { participantId: string; shareInput: number }[];
  }[];
  refunds: { id: string; receivedById: string; receivedByName: string; amountCents: number; createdAt: Date }[];
}

export async function getExpenseForEdit(token: string, expenseId: string): Promise<ExpenseForEdit | null> {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId: token }, // §2.1 scope filter
    include: {
      payers: true,
      items: { include: { shares: true }, orderBy: { createdAt: 'asc' } },
      refunds: { include: { receivedBy: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!expense) return null;
  return {
    id: expense.id,
    title: expense.title,
    amountCents: expense.amountCents,
    date: dbDateToString(expense.date),
    payers: expense.payers.map((p) => ({ participantId: p.participantId, amountCents: p.amountCents })),
    items: expense.items.map((item) => ({
      label: item.label,
      amountCents: item.amountCents,
      splitMode: item.splitMode,
      shares: item.shares.map((s) => ({ participantId: s.participantId, shareInput: s.shareInput })),
    })),
    refunds: expense.refunds.map((r) => ({
      id: r.id,
      receivedById: r.receivedById,
      receivedByName: r.receivedBy.name,
      amountCents: r.amountCents,
      createdAt: r.createdAt,
    })),
  };
}

export interface ChargeForEdit {
  id: string;
  concept: string;
  amountCents: number;
  date: string;
  splitMode: SplitMode;
  shares: { participantId: string; shareInput: number }[];
}

export async function getChargeForEdit(token: string, chargeId: string): Promise<ChargeForEdit | null> {
  const charge = await prisma.groupCharge.findFirst({
    where: { id: chargeId, groupId: token }, // §2.1 scope filter
    include: { shares: true },
  });
  if (!charge) return null;
  return {
    id: charge.id,
    concept: charge.concept,
    amountCents: charge.amountCents,
    date: dbDateToString(charge.date),
    splitMode: charge.splitMode,
    shares: charge.shares.map((s) => ({ participantId: s.participantId, shareInput: s.shareInput })),
  };
}

/** Where an entry leads, resolved against live data: only entities that still exist in this group. */
export type ActivityTarget =
  | { kind: 'expense' | 'charge'; id: string }
  | { kind: 'kitty'; roundId: string; closed: boolean }
  | { kind: 'participants' };

export interface ActivityView {
  id: string;
  actorName: string | null;
  action: string;
  label: string;
  subject: string | null;
  detail: string | null;
  amountCents: number | null;
  previousAmountCents: number | null;
  target: ActivityTarget | null;
  createdAt: Date;
}

export interface ActivityPage { entries: ActivityView[]; total: number }

/** Ids of the refs of one kind, for a single scoped existence query. */
function refIds(refs: (ActivityRef | null)[], kind: Exclude<ActivityRef['kind'], 'participants'>): string[] {
  return [...new Set(refs.flatMap((r) => (r && r.kind === kind ? [r.id] : [])))];
}

/**
 * Turns each entry's ref into a link target. Every lookup is scoped by groupId
 * (§2.1): a payload naming another group's id resolves to nothing, like a
 * deleted row. Bote entries lead to the round's view (open or closed).
 */
async function resolveTargets(groupId: string, refs: (ActivityRef | null)[]): Promise<(ActivityTarget | null)[]> {
  const ids = (kind: Exclude<ActivityRef['kind'], 'participants'>) => refIds(refs, kind);
  const [expenses, charges, rounds, contributions, spends] = await Promise.all([
    ids('expense').length ? prisma.expense.findMany({ where: { groupId, id: { in: ids('expense') } }, select: { id: true } }) : [],
    ids('charge').length ? prisma.groupCharge.findMany({ where: { groupId, id: { in: ids('charge') } }, select: { id: true } }) : [],
    ids('kittyRound').length
      ? prisma.kittyRound.findMany({ where: { groupId, id: { in: ids('kittyRound') } }, select: { id: true, closedAt: true } })
      : [],
    ids('kittyContribution').length
      ? prisma.kittyContribution.findMany({
          where: { id: { in: ids('kittyContribution') }, round: { groupId } },
          select: { id: true, round: { select: { id: true, closedAt: true } } },
        })
      : [],
    ids('kittySpend').length
      ? prisma.kittySpend.findMany({
          where: { id: { in: ids('kittySpend') }, round: { groupId } },
          select: { id: true, round: { select: { id: true, closedAt: true } } },
        })
      : [],
  ]);
  const liveExpenses = new Set(expenses.map((e) => e.id));
  const liveCharges = new Set(charges.map((c) => c.id));
  // Every bote ref (round, contribution, spend) leads to the round it belongs to.
  const roundOf = new Map<string, { roundId: string; closed: boolean }>([
    ...rounds.map((r) => [r.id, { roundId: r.id, closed: r.closedAt !== null }] as const),
    ...[...contributions, ...spends].map((c) => [c.id, { roundId: c.round.id, closed: c.round.closedAt !== null }] as const),
  ]);
  return refs.map((ref) => {
    if (!ref) return null;
    if (ref.kind === 'participants') return ref;
    if (ref.kind === 'expense') return liveExpenses.has(ref.id) ? { kind: 'expense', id: ref.id } : null;
    if (ref.kind === 'charge') return liveCharges.has(ref.id) ? { kind: 'charge', id: ref.id } : null;
    const round = roundOf.get(ref.id);
    return round ? { kind: 'kitty', ...round } : null;
  });
}

/** The newest `limit` log entries and how many the group has in all (for "Ver más"). */
export async function getActivity(token: string, limit: number): Promise<ActivityPage | null> {
  const group = await prisma.group.findUnique({ where: { id: token }, include: { participants: true } });
  if (!group) return null;
  const where = { groupId: group.id };
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit }),
    prisma.activityLog.count({ where }),
  ]);
  const nameOf = new Map(group.participants.map((p) => [p.id, p.name]));
  const described = rows.map((e) => describeActivity(e.action, e.payload, nameOf));
  const targets = await resolveTargets(group.id, described.map((d) => d.ref));
  const entries = rows.map((e, i) => {
    const d = described[i];
    return {
      id: e.id,
      actorName: e.actorName,
      action: e.action,
      label: d.label,
      subject: d.subject,
      detail: d.detail,
      amountCents: d.amountCents,
      previousAmountCents: d.previousAmountCents,
      target: targets[i],
      createdAt: e.createdAt,
    };
  });
  return { entries, total };
}
