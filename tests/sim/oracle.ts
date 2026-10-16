import { prisma } from '../../src/server/db';

/**
 * Independent oracle: every person's raw balance recomputed from the rows in the
 * database with plain sums — no domain code, no read model. If the app and this
 * disagree, one of them is wrong. `ownerless` is what "Sobrante" paid.
 */
export interface RawLedger {
  balances: Map<string, number>;
  ownerless: number;
}

export async function rawLedger(groupId: string): Promise<RawLedger> {
  const [people, payers, shares, payments, refunds] = await Promise.all([
    prisma.participant.findMany({ where: { groupId }, select: { id: true } }),
    prisma.expensePayer.findMany({ where: { expense: { groupId } }, select: { participantId: true, amountCents: true } }),
    prisma.expenseShare.findMany({ where: { item: { expense: { groupId } } }, select: { participantId: true, amountCents: true } }),
    prisma.payment.findMany({ where: { groupId }, select: { fromId: true, toId: true, amountCents: true } }),
    prisma.refund.findMany({ where: { groupId }, select: { receivedById: true, amountCents: true, sharesSnapshot: true } }),
  ]);
  const balances = new Map(people.map((p) => [p.id, 0]));
  let ownerless = 0;
  const add = (id: string, delta: number) => {
    if (!balances.has(id)) throw new Error(`oracle: row points at ${id}, not a person of this group`);
    balances.set(id, balances.get(id)! + delta);
  };
  for (const p of payers) {
    if (p.participantId === null) ownerless += p.amountCents;
    else add(p.participantId, p.amountCents);
  }
  for (const s of shares) add(s.participantId, -s.amountCents);
  for (const p of payments) {
    add(p.fromId, p.amountCents);
    add(p.toId, -p.amountCents);
  }
  for (const r of refunds) {
    add(r.receivedById, -r.amountCents);
    for (const s of r.sharesSnapshot as { participantId: string; amountCents: number }[]) add(s.participantId, s.amountCents);
  }
  return { balances, ownerless };
}

/** A `;` CSV with quoted cells, as ledgerCsv writes it (BOM and CRLF included). */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** "−12,50" / "-12,50" / "3,07" → cents. */
export function csvCents(text: string): number {
  const match = /^(-?)(\d+),(\d{2})$/.exec(text);
  if (!match) throw new Error(`not a CSV amount: ${JSON.stringify(text)}`);
  return (match[1] ? -1 : 1) * (Number(match[2]) * 100 + Number(match[3]));
}
