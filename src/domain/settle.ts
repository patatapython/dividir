import { DomainError } from './errors';
import { Cents, asCents } from './money';

export interface Transfer {
  from: string;
  to: string;
  amount: Cents;
}

interface Party {
  id: string;
  amount: number; // always positive: debt magnitude or credit magnitude
}

function assertZeroSum(balances: Map<string, Cents>): void {
  const sum = [...balances.values()].reduce((a, b) => a + b, 0);
  if (sum !== 0) throw new DomainError('UNBALANCED');
}

function splitParties(balances: Map<string, Cents>): { debtors: Party[]; creditors: Party[] } {
  const debtors: Party[] = [];
  const creditors: Party[] = [];
  for (const [id, balance] of balances) {
    if (balance < 0) debtors.push({ id, amount: -balance });
    else if (balance > 0) creditors.push({ id, amount: balance });
  }
  return { debtors, creditors };
}

/** Deterministic max: larger amount wins, ties broken by lower id. */
function maxParty(parties: Party[]): Party {
  return parties.reduce((best, p) =>
    p.amount > best.amount || (p.amount === best.amount && p.id < best.id) ? p : best,
  );
}

/**
 * Max debtor pays max creditor until settled (spec §3.3). ≤ m−1 transfers,
 * minimal total amount moved, 2-approximation of the optimal count.
 * Used when m > 16; also runs inside each partition found by settleExact.
 */
export function settleGreedy(balances: Map<string, Cents>): Transfer[] {
  assertZeroSum(balances);
  const { debtors, creditors } = splitParties(balances);
  const transfers: Transfer[] = [];
  let remainingDebtors = debtors;
  let remainingCreditors = creditors;
  while (remainingDebtors.length > 0) {
    const debtor = maxParty(remainingDebtors);
    const creditor = maxParty(remainingCreditors);
    const amount = Math.min(debtor.amount, creditor.amount);
    transfers.push({ from: debtor.id, to: creditor.id, amount: asCents(amount) });
    debtor.amount -= amount;
    creditor.amount -= amount;
    remainingDebtors = remainingDebtors.filter((d) => d.amount > 0);
    remainingCreditors = remainingCreditors.filter((c) => c.amount > 0);
  }
  return transfers;
}

/** Above this many non-zero balances settle() falls back to settleGreedy. */
export const EXACT_LIMIT = 16;

/**
 * Provably minimal transfer count via Maximal Zero-Sum Partitioning
 * (spec §3.3; Verhoeff 2004). Bitmask DP over subsets: the optimum is
 * m − g transfers where g is the maximum number of disjoint zero-sum
 * subgroups. O(3^m) time, O(2^m) space — m ≤ 16 by contract.
 *
 * Each partition part is atomic (no proper zero-sum subset, otherwise g
 * would not be maximal), so greedy inside a part of size k yields exactly
 * k−1 transfers and the total is exactly m − g.
 */
export function settleExact(balances: Map<string, Cents>): Transfer[] {
  assertZeroSum(balances);
  const entries = [...balances.entries()]
    .filter(([, value]) => value !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const m = entries.length;
  if (m === 0) return [];
  if (m > EXACT_LIMIT) throw new DomainError('TOO_MANY_FOR_EXACT');

  const full = (1 << m) - 1;
  const sums = new Array<number>(full + 1).fill(0);
  for (let mask = 1; mask <= full; mask++) {
    const lowBit = mask & -mask;
    const lowIndex = 31 - Math.clz32(lowBit);
    sums[mask] = sums[mask ^ lowBit] + entries[lowIndex][1];
  }

  // dp[mask] = max zero-sum parts exactly covering mask; -1 = not coverable.
  const dp = new Array<number>(full + 1).fill(-1);
  const choice = new Array<number>(full + 1).fill(0);
  dp[0] = 0;
  for (let mask = 1; mask <= full; mask++) {
    const lowBit = mask & -mask;
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
      if (!(sub & lowBit)) continue; // canonical part contains the lowest member
      if (sums[sub] !== 0) continue;
      const rest = dp[mask ^ sub];
      if (rest >= 0 && rest + 1 > dp[mask]) {
        dp[mask] = rest + 1;
        choice[mask] = sub;
      }
    }
  }

  const transfers: Transfer[] = [];
  let mask = full; // dp[full] >= 1 always: the whole set is zero-sum
  while (mask !== 0) {
    const part = choice[mask];
    const partBalances = new Map<string, Cents>();
    for (let i = 0; i < m; i++) {
      if (part & (1 << i)) partBalances.set(entries[i][0], entries[i][1]);
    }
    transfers.push(...settleGreedy(partBalances));
    mask ^= part;
  }
  return transfers;
}

/** Spec §3.3: exact optimum when feasible, greedy otherwise. Same UI either way. */
export function settle(balances: Map<string, Cents>): Transfer[] {
  const nonZero = [...balances.values()].filter((value) => value !== 0).length;
  return nonZero <= EXACT_LIMIT ? settleExact(balances) : settleGreedy(balances);
}
