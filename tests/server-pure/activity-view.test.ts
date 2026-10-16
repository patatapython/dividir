import { describe, expect, it } from 'vitest';
import { describeActivity } from '../../src/server/activity-view';

const names = new Map([
  ['ana', 'Ana'],
  ['bea', 'Bea'],
  ['carla', 'Carla'],
]);

const expense = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  title: 'Cena',
  amountCents: 4000,
  payers: [{ participantId: 'ana', amountCents: 4000 }],
  ...over,
});

describe('describeActivity — what a log entry says, how much and where it leads', () => {
  it('an expense names its payer, its amount and the expense', () => {
    expect(describeActivity('expense.create', expense(), names)).toEqual({
      label: 'añadió un gasto',
      subject: 'Cena',
      detail: 'pagó Ana',
      amountCents: 4000,
      previousAmountCents: null,
      ref: { kind: 'expense', id: 'e1' },
    });
  });

  it('several payers are listed; the leftover pays as "Sobrante"', () => {
    const payers = [
      { participantId: 'ana', amountCents: 1000 },
      { participantId: 'bea', amountCents: 1000 },
      { participantId: null, amountCents: 2000 },
    ];
    expect(describeActivity('expense.create', expense({ payers }), names).detail).toBe('pagaron Ana, Bea y Sobrante');
  });

  it('an edit shows the new amount and the old one only when it changed', () => {
    const changed = describeActivity('expense.update', { previous: expense(), next: expense({ amountCents: 4500 }) }, names);
    expect(changed).toMatchObject({ label: 'editó un gasto', subject: 'Cena', amountCents: 4500, previousAmountCents: 4000 });
    expect(changed.ref).toEqual({ kind: 'expense', id: 'e1' });
    const same = describeActivity('expense.update', { previous: expense(), next: expense({ title: 'Cena larga' }) }, names);
    expect(same).toMatchObject({ subject: 'Cena larga', amountCents: 4000, previousAmountCents: null });
  });

  it('a deletion keeps what was deleted but leads nowhere', () => {
    expect(describeActivity('expense.delete', { previous: expense() }, names)).toMatchObject({
      label: 'eliminó un gasto',
      subject: 'Cena',
      amountCents: 4000,
      ref: null,
    });
  });

  it('a payment says who paid whom', () => {
    const payload = { id: 'p1', fromId: 'bea', toId: 'ana', amountCents: 1500 };
    expect(describeActivity('payment.create', payload, names)).toMatchObject({
      label: 'registró un pago',
      subject: null,
      detail: 'Bea → Ana',
      amountCents: 1500,
      ref: null,
    });
    expect(describeActivity('payment.delete', { previous: payload }, names)).toMatchObject({ detail: 'Bea → Ana', amountCents: 1500 });
  });

  it('a refund names who received it and leads to its expense', () => {
    expect(describeActivity('refund.create', { id: 'r1', expenseId: 'e1', receivedById: 'bea', amountCents: 500 }, names)).toMatchObject({
      label: 'registró un reembolso',
      detail: 'recibió Bea',
      amountCents: 500,
      ref: { kind: 'expense', id: 'e1' },
    });
  });

  it('a gasto sin pagar leads to its own form', () => {
    const charge = { id: 'c1', concept: 'Luz', amountCents: 9000 };
    expect(describeActivity('charge.create', charge, names)).toMatchObject({
      label: 'añadió un gasto sin pagar',
      subject: 'Luz',
      amountCents: 9000,
      ref: { kind: 'charge', id: 'c1' },
    });
    expect(describeActivity('charge.update', { previous: charge, next: { ...charge, amountCents: 9500 } }, names)).toMatchObject({
      amountCents: 9500,
      previousAmountCents: 9000,
    });
  });

  it('bote contributions say whose they were, and an edit or deletion is not reported as a contribution', () => {
    const bulk = {
      op: 'bulk',
      roundId: 'k1',
      totalCents: 3000,
      contributions: [
        { participantId: 'ana', amountCents: 1000 },
        { participantId: 'bea', amountCents: 2000 },
      ],
    };
    expect(describeActivity('kitty.contribute', bulk, names)).toMatchObject({
      label: 'registró aportes al bote',
      detail: 'de Ana y Bea',
      amountCents: 3000,
      ref: { kind: 'kittyRound', id: 'k1' },
    });
    expect(describeActivity('kitty.contribute', { op: 'edit', id: 'kc1', participantId: 'ana', amountCents: 1200 }, names)).toMatchObject({
      label: 'editó un aporte al bote',
      detail: 'de Ana',
      amountCents: 1200,
      ref: { kind: 'kittyContribution', id: 'kc1' },
    });
    expect(describeActivity('kitty.contribute', { op: 'delete', id: 'kc1', participantId: 'ana', amountCents: 1200 }, names)).toMatchObject({
      label: 'eliminó un aporte al bote',
      ref: null,
    });
  });

  it('a contribution logged before bulk entry existed still leads to its round', () => {
    // Pre-v1.3 shape: no `op`, no contribution id, but the round is known.
    expect(describeActivity('kitty.contribute', { roundId: 'k1', participantId: 'ana', amountCents: 500 }, names)).toMatchObject({
      label: 'aportó al bote',
      detail: 'de Ana',
      amountCents: 500,
      ref: { kind: 'kittyRound', id: 'k1' },
    });
  });

  it('bote spends carry their concept', () => {
    expect(describeActivity('kitty.spend', { roundId: 'k1', concept: 'Pan', amountCents: 300 }, names)).toMatchObject({
      label: 'registró un gasto del bote',
      subject: 'Pan',
      amountCents: 300,
      ref: { kind: 'kittyRound', id: 'k1' },
    });
    expect(describeActivity('kitty.spend', { op: 'edit', id: 's1', concept: 'Pan', amountCents: 350 }, names)).toMatchObject({
      label: 'editó un gasto del bote',
      ref: { kind: 'kittySpend', id: 's1' },
    });
    expect(describeActivity('kitty.spend', { op: 'delete', id: 's1', concept: 'Pan', amountCents: 350 }, names)).toMatchObject({
      label: 'eliminó un gasto del bote',
      ref: null,
    });
  });

  it('opening a round with money left from last time shows that amount', () => {
    expect(describeActivity('kitty.open', { id: 'k1', name: 'Agosto', carryInCents: 700 }, names)).toMatchObject({
      subject: 'Agosto',
      detail: 'con sobrante de otra vez',
      amountCents: 700,
      ref: { kind: 'kittyRound', id: 'k1' },
    });
    expect(describeActivity('kitty.open', { id: 'k1', name: null, carryInCents: 0 }, names)).toMatchObject({
      subject: null,
      detail: null,
      amountCents: null,
    });
  });

  it('closing a round says whether it was shared out, and among whom', () => {
    const payout = [
      { participantId: 'ana', amountCents: 400 },
      { participantId: 'carla', amountCents: 600 },
    ];
    expect(describeActivity('kitty.close', { roundId: 'k1', action: 'REPARTIR', payout }, names)).toMatchObject({
      detail: 'repartido entre Ana y Carla',
      amountCents: 1000,
      ref: { kind: 'kittyRound', id: 'k1' },
    });
    // Entries logged before session 12 carry no round name: no subject, as before.
    expect(describeActivity('kitty.close', { roundId: 'k1', action: 'CERRAR', leftoverCents: 200 }, names)).toMatchObject({
      subject: null,
      detail: 'sin repartir',
      amountCents: null,
    });
  });

  it('closing a round names it, as reopening does (session 12)', () => {
    expect(describeActivity('kitty.close', { roundId: 'k1', action: 'CERRAR', name: 'Agosto', leftoverCents: 0 }, names)).toMatchObject({
      subject: 'Agosto',
      detail: 'sin repartir',
    });
    expect(describeActivity('kitty.close', { roundId: 'k1', action: 'REPARTIR', name: 'Agosto', payout: [] }, names)).toMatchObject({
      subject: 'Agosto',
    });
  });

  it('renaming a round says its new name and the one it had before (T-100)', () => {
    expect(describeActivity('kitty.rename', { roundId: 'k1', previous: { name: 'Agsto' }, name: 'Agosto' }, names)).toMatchObject({
      label: 'renombró una ronda del bote',
      subject: 'Agosto',
      detail: 'antes Agsto',
      amountCents: null,
      ref: { kind: 'kittyRound', id: 'k1' },
    });
  });

  it('people changes lead to Ajustes while the person can still be found there', () => {
    expect(describeActivity('participant.update', { previous: { name: 'Bea' }, name: 'Beatriz' }, names)).toMatchObject({
      subject: 'Beatriz',
      detail: 'antes Bea',
      ref: { kind: 'participants' },
    });
    expect(describeActivity('participant.delete', { previous: { id: 'x', name: 'Dani' } }, names)).toMatchObject({
      subject: 'Dani',
      ref: null,
    });
  });

  it('the group creation lists who it started with', () => {
    expect(describeActivity('group.create', { name: 'Piso', participants: ['Ana', 'Bea'] }, names)).toMatchObject({
      label: 'creó el grupo',
      subject: 'Piso',
      detail: 'con Ana y Bea',
    });
  });

  it('people no longer in the group drop out of the detail instead of showing blanks', () => {
    const payload = { id: 'p1', fromId: 'gone', toId: 'ana', amountCents: 100 };
    expect(describeActivity('payment.create', payload, names).detail).toBeNull();
    expect(describeActivity('expense.create', expense({ payers: [{ participantId: 'gone', amountCents: 4000 }] }), names).detail).toBeNull();
  });

  it('a malformed or unknown entry degrades to its label, never throws', () => {
    expect(describeActivity('expense.create', null, names)).toMatchObject({ label: 'añadió un gasto', subject: null, amountCents: null, ref: null });
    expect(describeActivity('round.open', { name: 'x' }, names)).toMatchObject({ label: 'round.open', ref: null });
  });
});
