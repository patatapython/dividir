import { describe, expect, it } from 'vitest';
import {
  OWNERLESS_PAYER,
  initialTicket,
  fromExpenseForEdit,
  ticketTotal,
  togglePayer,
  choosePayer,
  setMultiPayer,
  setPayerAmount,
  effectivePayerAmounts,
  payerMismatch,
  addItem,
  removeItem,
  updateItem,
  updateShare,
  shareRowIssue,
  checkItem,
  expenseProblems,
  describeProblem,
  previewShares,
  toExpenseInput,
  itemSummary,
  type ItemRow,
  SPLIT_MODES,
} from '@/app/g/[token]/gastos/ticket-model';
import type { ExpenseForEdit } from '@/server/queries';

const PERSONS = ['a', 'b', 'c', 'd'];
const TODAY = '2026-07-03';
const NAMES: Record<string, string> = { a: 'Marta', b: 'Rubén', c: 'Lucía', d: 'Ana' };
const nameOf = (id: string) => NAMES[id] ?? id;

function itemWith(splitMode: ItemRow['splitMode'], shares: ItemRow['shares']): ItemRow {
  return { id: 'x', label: '', amountRaw: '10,00', splitMode, shares };
}

describe('initialTicket', () => {
  it('starts with one EQUAL item, everyone included, single empty payer', () => {
    const s = initialTicket(PERSONS, 'a', TODAY);
    expect(s.items).toHaveLength(1);
    expect(s.items[0].splitMode).toBe('EQUAL');
    expect(s.items[0].shares).toHaveLength(4);
    expect(s.items[0].shares.every((r) => r.included)).toBe(true);
    expect(s.payers).toEqual([{ participantId: 'a', amountRaw: '' }]);
    expect(ticketTotal(s)).toBeNull();
  });
});

describe('fast path (single item, single payer)', () => {
  it('produces a valid expense input from title + amount', () => {
    let s = initialTicket(PERSONS, 'a', TODAY);
    s = updateItem(s, s.items[0].id, { amountRaw: '84,60' });
    expect(ticketTotal(s)).toBe(8460);
    expect(effectivePayerAmounts(s)).toEqual([{ participantId: 'a', amountCents: 8460 }]);

    const withTitle = { ...s, title: 'Cena' };
    expect(toExpenseInput(withTitle)).toEqual({
      title: 'Cena',
      date: TODAY,
      payers: [{ participantId: 'a', amount: 8460 }],
      items: [
        {
          amount: 8460,
          splitMode: 'EQUAL',
          shares: [
            { participantId: 'a', shareInput: 1 },
            { participantId: 'b', shareInput: 1 },
            { participantId: 'c', shareInput: 1 },
            { participantId: 'd', shareInput: 1 },
          ],
        },
      ],
    });
  });
});

describe('multi-payer', () => {
  function twoPayerBase() {
    let s = initialTicket(PERSONS, 'a', TODAY);
    s = updateItem(s, s.items[0].id, { amountRaw: '84,60' });
    s = { ...s, title: 'Cena' };
    return togglePayer(s, 'b');
  }

  it('is incomplete while payer amounts are empty', () => {
    const s = twoPayerBase();
    expect(s.payers).toHaveLength(2);
    expect(effectivePayerAmounts(s)).toBeNull();
    expect(toExpenseInput(s)).toBeNull();
  });

  it('squares when payer amounts sum to the total', () => {
    let s = twoPayerBase();
    s = setPayerAmount(s, 'a', '50,00');
    s = setPayerAmount(s, 'b', '34,60');
    expect(payerMismatch(s)).toBeNull();
    expect(effectivePayerAmounts(s)).toEqual([
      { participantId: 'a', amountCents: 5000 },
      { participantId: 'b', amountCents: 3460 },
    ]);
  });

  it('reports the exact mismatch when they do not', () => {
    let s = twoPayerBase();
    s = setPayerAmount(s, 'a', '50,00');
    s = setPayerAmount(s, 'b', '30,00');
    expect(payerMismatch(s)).toEqual({ payersSum: 8000, total: 8460 });
  });

  it('never removes the last payer', () => {
    const s = initialTicket(PERSONS, 'a', TODAY);
    expect(togglePayer(s, 'a')).toEqual(s);
  });
});

describe('payer choice (T-47): one tap in simple mode, several payers on request', () => {
  it('a new expense has one payer, in simple mode', () => {
    const s = initialTicket(PERSONS, 'a', TODAY);
    expect(s.multiPayer).toBe(false);
    expect(s.payers).toEqual([{ participantId: 'a', amountRaw: '' }]);
  });

  it('choosing another payer replaces the payer in one step, and that payer pays the total', () => {
    let s = initialTicket(PERSONS, 'a', TODAY);
    s = updateItem(s, s.items[0].id, { amountRaw: '30,00' });
    s = choosePayer(s, 'b');
    expect(s.payers).toEqual([{ participantId: 'b', amountRaw: '' }]);
    expect(effectivePayerAmounts(s)).toEqual([{ participantId: 'b', amountCents: 3000 }]);
  });

  it('the Sobrante can be the one payer', () => {
    const s = choosePayer(initialTicket(PERSONS, 'a', TODAY), OWNERLESS_PAYER);
    expect(s.payers).toEqual([{ participantId: OWNERLESS_PAYER, amountRaw: '' }]);
  });

  it('several payers is an explicit mode: it keeps the payer and then adds others', () => {
    let s = setMultiPayer(initialTicket(PERSONS, 'a', TODAY), true);
    expect(s.multiPayer).toBe(true);
    s = togglePayer(s, 'b');
    expect(s.payers.map((p) => p.participantId)).toEqual(['a', 'b']);
  });

  it('back to one payer keeps the first one and drops the split amounts', () => {
    let s = setMultiPayer(initialTicket(PERSONS, 'a', TODAY), true);
    s = togglePayer(s, 'b');
    s = setPayerAmount(s, 'a', '10,00');
    s = setMultiPayer(s, false);
    expect(s.multiPayer).toBe(false);
    expect(s.payers).toEqual([{ participantId: 'a', amountRaw: '' }]);
  });

  it('adding a payer is several-payer editing', () => {
    expect(togglePayer(initialTicket(PERSONS, 'a', TODAY), 'b').multiPayer).toBe(true);
  });
});

describe('items', () => {
  it('adds and removes items respecting a minimum of one', () => {
    let s = initialTicket(PERSONS, 'a', TODAY);
    s = addItem(s, 'item-2', PERSONS);
    expect(s.items).toHaveLength(2);
    expect(removeItem(s, 'item-2').items).toHaveLength(1);

    const single = initialTicket(PERSONS, 'a', TODAY);
    expect(removeItem(single, single.items[0].id).items).toHaveLength(1);
  });

  it('resets shares when the split mode changes', () => {
    let s = initialTicket(PERSONS, 'a', TODAY);
    const id = s.items[0].id;
    s = updateShare(s, id, 'b', { included: false, raw: '5' });
    s = updateItem(s, id, { splitMode: 'SHARES' });
    expect(s.items[0].splitMode).toBe('SHARES');
    expect(s.items[0].shares.every((sh) => sh.included && sh.raw === '')).toBe(true);
  });
});

describe('checkItem, ready', () => {
  const ok = (item: ItemRow) => {
    const r = checkItem(item);
    if (!r.ok) throw new Error(`expected a ready item, got ${JSON.stringify(r.problems)}`);
    return r.inputs;
  };
  it('converts each mode to domain shareInput integers', () => {
    expect(ok(itemWith('PERCENTAGE', [{ participantId: 'a', included: true, raw: '100' }]))).toEqual([
      { participantId: 'a', shareInput: 10000 },
    ]);
    expect(ok(itemWith('SHARES', [{ participantId: 'a', included: true, raw: '2' }]))).toEqual([
      { participantId: 'a', shareInput: 2 },
    ]);
    expect(ok(itemWith('EXACT', [{ participantId: 'a', included: true, raw: '10,00' }]))).toEqual([
      { participantId: 'a', shareInput: 1000 },
    ]);
    expect(
      ok(
        itemWith('ADJUSTMENT', [
          { participantId: 'a', included: true, raw: '-1,00' },
          { participantId: 'b', included: true, raw: '+1' },
          { participantId: 'c', included: true, raw: '' },
        ]),
      ),
    ).toEqual([
      { participantId: 'a', shareInput: -100 },
      { participantId: 'b', shareInput: 100 },
      { participantId: 'c', shareInput: 0 },
    ]);
    expect(
      ok(
        itemWith('EQUAL', [
          { participantId: 'a', included: true, raw: '' },
          { participantId: 'b', included: false, raw: '' },
        ]),
      ),
    ).toEqual([{ participantId: 'a', shareInput: 1 }]);
  });
});

describe('shareRowIssue', () => {
  const row = (raw: string, included = true) => ({ participantId: 'a', included, raw });
  it('tells a row still to be filled from a row that cannot be read', () => {
    expect(shareRowIssue('PERCENTAGE', row(''))).toBe('empty');
    expect(shareRowIssue('PERCENTAGE', row('  '))).toBe('empty');
    expect(shareRowIssue('PERCENTAGE', row('treinta'))).toBe('invalid');
    expect(shareRowIssue('EXACT', row('12,'))).toBe('invalid');
    expect(shareRowIssue('SHARES', row('1,5'))).toBe('invalid');
    expect(shareRowIssue('SHARES', row('2'))).toBeNull();
    expect(shareRowIssue('EXACT', row('12,50'))).toBeNull();
  });
  it('asks nothing of rows that carry no value', () => {
    expect(shareRowIssue('EQUAL', row('whatever'))).toBeNull();
    expect(shareRowIssue('PERCENTAGE', row('', false))).toBeNull(); // not included
  });
  it('refuses a weight too large to store, like the server', () => {
    expect(shareRowIssue('SHARES', row('100000000'))).toBeNull();
    expect(shareRowIssue('SHARES', row('3000000000'))).toBe('invalid');
  });
  it('reads a blank adjustment as zero, never as missing', () => {
    expect(shareRowIssue('ADJUSTMENT', row(''))).toBeNull();
    expect(shareRowIssue('ADJUSTMENT', row('+-5'))).toBe('invalid');
  });
});

describe('checkItem, problems', () => {
  const problems = (item: ItemRow) => {
    const r = checkItem(item);
    if (r.ok) throw new Error('expected problems');
    return r.problems;
  };
  const rows = (...raws: string[]) => raws.map((raw, i) => ({ participantId: PERSONS[i], included: true, raw }));

  it('lists empty and invalid rows apart, by participant', () => {
    expect(problems(itemWith('EXACT', rows('', 'x', '', '5,00')))).toEqual([
      { kind: 'shares-missing', participantIds: ['a', 'c'] },
      { kind: 'shares-invalid', participantIds: ['b'] },
    ]);
  });

  it('tells a missing amount from an unreadable one', () => {
    expect(problems({ ...itemWith('EQUAL', rows('')), amountRaw: '' })).toEqual([{ kind: 'amount-missing' }]);
    expect(problems({ ...itemWith('EQUAL', rows('')), amountRaw: '12,' })).toEqual([{ kind: 'amount-invalid' }]);
  });

  it('needs somebody to split between, in every mode', () => {
    expect(problems(itemWith('EQUAL', [{ participantId: 'a', included: false, raw: '' }]))).toEqual([{ kind: 'nobody' }]);
    expect(problems(itemWith('ADJUSTMENT', [{ participantId: 'a', included: false, raw: '' }]))).toEqual([
      { kind: 'nobody' },
    ]);
  });

  it('leaves an unticked row out of an ADJUSTMENT split, like any other mode', () => {
    const r = checkItem(
      itemWith('ADJUSTMENT', [
        { participantId: 'a', included: true, raw: '+1' },
        { participantId: 'b', included: true, raw: '-1' },
        { participantId: 'c', included: false, raw: '+7' },
      ]),
    );
    if (!r.ok) throw new Error('expected a split');
    expect(r.inputs.map((i) => i.participantId)).toEqual(['a', 'b']);
  });

  it('says by how much a split misses, per mode', () => {
    expect(problems(itemWith('PERCENTAGE', rows('50', '10')))).toEqual([{ kind: 'percent-sum', sum: 6000 }]);
    expect(problems(itemWith('EXACT', rows('4,00', '5,00')))).toEqual([{ kind: 'exact-sum', sum: 900, total: 1000 }]);
    expect(problems(itemWith('ADJUSTMENT', rows('+5', '', '', '')))).toEqual([{ kind: 'adjustment-sum', sum: 500 }]);
    expect(problems(itemWith('ADJUSTMENT', rows('-5', '+5', '', '')))).toEqual([{ kind: 'adjustment-negative' }]);
    expect(problems(itemWith('SHARES', rows('0', '0')))).toEqual([{ kind: 'shares-zero' }]);
  });
});

describe('expenseProblems', () => {
  it('names everything a fresh ticket still needs', () => {
    expect(expenseProblems(initialTicket(PERSONS, 'a', TODAY))).toEqual([
      { kind: 'title-missing' },
      { kind: 'amount-missing' },
    ]);
  });

  it('places a problem on its line once the ticket has several', () => {
    let s = { ...initialTicket(PERSONS, 'a', TODAY), title: 'Cena' };
    s = updateItem(s, s.items[0].id, { amountRaw: '10,00' });
    s = addItem(s, 'item-2', PERSONS);
    s = updateItem(s, 'item-2', { label: 'Vino' });
    s = addItem(s, 'item-3', PERSONS);
    s = updateItem(s, 'item-3', { amountRaw: '5,00', splitMode: 'PERCENTAGE' });
    expect(expenseProblems(s)).toEqual([
      { kind: 'amount-missing', line: 'Vino' },
      { kind: 'shares-missing', participantIds: PERSONS, line: 'Línea 3' },
    ]);
  });

  it('checks what each payer paid', () => {
    let s = { ...initialTicket(PERSONS, 'a', TODAY), title: 'Cena' };
    s = updateItem(s, s.items[0].id, { amountRaw: '10,00' });
    s = togglePayer(s, 'b');
    s = togglePayer(s, OWNERLESS_PAYER);
    s = setPayerAmount(s, 'b', 'x');
    expect(expenseProblems(s)).toEqual([
      { kind: 'payers-missing', participantIds: ['a', OWNERLESS_PAYER] },
      { kind: 'payers-invalid', participantIds: ['b'] },
    ]);
    s = setPayerAmount(s, 'a', '4,00');
    s = setPayerAmount(s, 'b', '4,00');
    s = setPayerAmount(s, OWNERLESS_PAYER, '1,00');
    expect(expenseProblems(s)).toEqual([{ kind: 'payers-mismatch', payersSum: 900, total: 1000 }]);
  });

  it('needs a date', () => {
    let s = { ...initialTicket(PERSONS, 'a', TODAY), title: 'Cena', date: '' };
    s = updateItem(s, s.items[0].id, { amountRaw: '10,00' });
    expect(expenseProblems(s)).toEqual([{ kind: 'date-missing' }]);
  });

  it('keeps save closed while the lines add up to more than the ceiling', () => {
    let s = { ...initialTicket(PERSONS, 'a', TODAY), title: 'Casa' };
    s = updateItem(s, s.items[0].id, { amountRaw: '600000,00' });
    s = addItem(s, 'item-2', PERSONS);
    s = updateItem(s, 'item-2', { amountRaw: '600000,00' });
    expect(expenseProblems(s)).toEqual([{ kind: 'total-too-large' }]);
    expect(toExpenseInput(s)).toBeNull();
    expect(describeProblem({ kind: 'total-too-large' }, nameOf)).toBe('El total pasa del máximo de 1.000.000 €.');
  });

  it('keeps save closed while the split does not add up', () => {
    let s = { ...initialTicket(PERSONS, 'a', TODAY), title: 'Cena' };
    const id = s.items[0].id;
    s = updateItem(s, id, { amountRaw: '10,00', splitMode: 'PERCENTAGE' });
    s = updateShare(s, id, 'c', { included: false });
    s = updateShare(s, id, 'd', { included: false });
    s = updateShare(s, id, 'a', { raw: '50' });
    s = updateShare(s, id, 'b', { raw: '10' });
    expect(expenseProblems(s)).toEqual([{ kind: 'percent-sum', sum: 6000 }]);
    expect(toExpenseInput(s)).toBeNull();
  });
});

describe('describeProblem', () => {
  it('says what is missing without accusing a value still being typed', () => {
    expect(describeProblem({ kind: 'title-missing' }, nameOf)).toBe('Falta el concepto.');
    expect(describeProblem({ kind: 'amount-invalid' }, nameOf)).toBe('Completa o corrige el importe.');
    expect(describeProblem({ kind: 'shares-missing', participantIds: ['a', 'b', 'c'] }, nameOf)).toBe(
      'Falta la parte de Marta, Rubén y Lucía.',
    );
    expect(describeProblem({ kind: 'shares-invalid', participantIds: ['d'] }, nameOf)).toBe(
      'Completa o corrige la parte de Ana.',
    );
  });

  it('gives the figures of a split that misses', () => {
    expect(describeProblem({ kind: 'percent-sum', sum: 6000 }, nameOf)).toBe('Los porcentajes suman 60 %; deben sumar 100 %.');
    expect(describeProblem({ kind: 'percent-sum', sum: 9999 }, nameOf)).toBe(
      'Los porcentajes suman 99,99 %; deben sumar 100 %.',
    );
    expect(describeProblem({ kind: 'exact-sum', sum: 900, total: 1000 }, nameOf)).toBe(
      'Las partes suman 9,00 € y el importe es 10,00 €.',
    );
    expect(describeProblem({ kind: 'adjustment-sum', sum: -500 }, nameOf)).toBe('Los ajustes suman −5,00 €; deben sumar 0.');
  });

  it('prefixes the line and names the ownerless payer', () => {
    expect(describeProblem({ kind: 'amount-missing', line: 'Vino' }, nameOf)).toBe('Vino: falta el importe.');
    expect(describeProblem({ kind: 'payers-missing', participantIds: ['a', OWNERLESS_PAYER] }, nameOf)).toBe(
      'Falta cuánto pagó cada uno: Marta y Sobrante.',
    );
  });
});

describe('previewShares', () => {
  it('aggregates equal items across the ticket', () => {
    let s = initialTicket(PERSONS, 'a', TODAY);
    s = updateItem(s, s.items[0].id, { amountRaw: '10,00' });
    s = addItem(s, 'item-2', PERSONS);
    s = updateItem(s, 'item-2', { amountRaw: '20,00' });
    expect(previewShares(s)).toEqual({
      rows: [
        { participantId: 'a', amountCents: 750 },
        { participantId: 'b', amountCents: 750 },
        { participantId: 'c', amountCents: 750 },
        { participantId: 'd', amountCents: 750 },
      ],
    });
  });

  it('shows nothing while the split does not add up (the reason is listed by expenseProblems)', () => {
    let s = initialTicket(PERSONS, 'a', TODAY);
    const id = s.items[0].id;
    s = updateItem(s, id, { amountRaw: '10,00', splitMode: 'PERCENTAGE' });
    s = updateShare(s, id, 'c', { included: false });
    s = updateShare(s, id, 'd', { included: false });
    s = updateShare(s, id, 'a', { raw: '50' });
    s = updateShare(s, id, 'b', { raw: '10' });
    expect(previewShares(s)).toBeNull();
  });
});

describe('fromExpenseForEdit round-trip', () => {
  it('reconstructs payers and items, ignoring refunds', () => {
    const sample = {
      id: 'exp1',
      title: 'Cena',
      amountCents: 9000,
      date: '2026-07-03',
      payers: [
        { participantId: 'a', amountCents: 5000 },
        { participantId: 'b', amountCents: 4000 },
      ],
      items: [
        {
          label: 'Comida',
          amountCents: 9000,
          splitMode: 'EQUAL' as const,
          shares: [
            { participantId: 'a', shareInput: 1 },
            { participantId: 'b', shareInput: 1 },
            { participantId: 'c', shareInput: 1 },
            { participantId: 'd', shareInput: 1 },
          ],
        },
      ],
      refunds: [
        { id: 'r1', receivedById: 'a', receivedByName: 'Marta', amountCents: 500, createdAt: new Date('2026-07-03') },
      ],
    };
    expect(fromExpenseForEdit(sample, PERSONS).multiPayer).toBe(true);
    expect(fromExpenseForEdit({ ...sample, payers: [{ participantId: 'a', amountCents: 9000 }] }, PERSONS).multiPayer).toBe(false);
    expect(toExpenseInput(fromExpenseForEdit(sample, PERSONS))).toEqual({
      title: 'Cena',
      date: '2026-07-03',
      payers: [
        { participantId: 'a', amount: 5000 },
        { participantId: 'b', amount: 4000 },
      ],
      items: [
        {
          label: 'Comida',
          amount: 9000,
          splitMode: 'EQUAL',
          shares: [
            { participantId: 'a', shareInput: 1 },
            { participantId: 'b', shareInput: 1 },
            { participantId: 'c', shareInput: 1 },
            { participantId: 'd', shareInput: 1 },
          ],
        },
      ],
    });
  });
});

describe('fromExpenseForEdit round-trip in weighted modes', () => {
  const edited = (items: ExpenseForEdit['items']) => ({
    id: 'exp2',
    title: 'Súper',
    amountCents: items.reduce((acc, i) => acc + i.amountCents, 0),
    date: TODAY,
    payers: [{ participantId: 'a', amountCents: items.reduce((acc, i) => acc + i.amountCents, 0) }],
    items,
    refunds: [],
  });

  it('keeps each item\'s mode, subset and stored inputs (SHARES, PERCENTAGE, EXACT)', () => {
    const items: ExpenseForEdit['items'] = [
      {
        label: 'Vino',
        amountCents: 2000,
        splitMode: 'SHARES',
        shares: [
          { participantId: 'a', shareInput: 2 },
          { participantId: 'b', shareInput: 1 },
          { participantId: 'c', shareInput: 1 },
        ],
      },
      {
        label: 'Carne',
        amountCents: 3000,
        splitMode: 'PERCENTAGE',
        shares: [
          { participantId: 'a', shareInput: 5000 },
          { participantId: 'b', shareInput: 3333 },
          { participantId: 'd', shareInput: 1667 },
        ],
      },
      {
        label: 'Pan',
        amountCents: 450,
        splitMode: 'EXACT',
        shares: [
          { participantId: 'c', shareInput: 125 },
          { participantId: 'd', shareInput: 325 },
        ],
      },
    ];
    expect(toExpenseInput(fromExpenseForEdit(edited(items), PERSONS))).toEqual({
      title: 'Súper',
      date: TODAY,
      payers: [{ participantId: 'a', amount: 5450 }],
      items: items.map((i) => ({ label: i.label, amount: i.amountCents, splitMode: i.splitMode, shares: i.shares })),
    });
  });

  it('keeps signed ADJUSTMENT deltas, zero included', () => {
    const items: ExpenseForEdit['items'] = [
      {
        label: null,
        amountCents: 10000,
        splitMode: 'ADJUSTMENT',
        shares: [
          { participantId: 'a', shareInput: 1000 },
          { participantId: 'b', shareInput: -500 },
          { participantId: 'c', shareInput: 0 },
          { participantId: 'd', shareInput: -500 },
        ],
      },
    ];
    expect(toExpenseInput(fromExpenseForEdit(edited(items), PERSONS))?.items).toEqual([
      { amount: 10000, splitMode: 'ADJUSTMENT', shares: items[0].shares },
    ]);
  });

  it('does not pull a later joiner into an ADJUSTMENT item on edit', () => {
    const items: ExpenseForEdit['items'] = [
      {
        label: null,
        amountCents: 9000,
        splitMode: 'ADJUSTMENT',
        shares: [
          { participantId: 'a', shareInput: 0 },
          { participantId: 'b', shareInput: 0 },
          { participantId: 'c', shareInput: 0 },
        ],
      },
    ];
    // 'd' joined the group after this expense was saved (or was archived before it):
    // including them would change who pays, or make the server refuse the edit.
    expect(toExpenseInput(fromExpenseForEdit(edited(items), PERSONS))?.items[0].shares).toEqual(items[0].shares);
  });
});

describe('ownerless payer ("Sobrante" in the UI)', () => {
  it('toExpenseInput emits a null participantId for the ownerless payer', () => {
    let s = initialTicket(PERSONS, 'a', TODAY);
    s = updateItem(s, s.items[0].id, { amountRaw: '200,00' });
    s = { ...s, title: 'Comida' };
    s = togglePayer(s, OWNERLESS_PAYER);
    s = setPayerAmount(s, 'a', '100,00');
    s = setPayerAmount(s, OWNERLESS_PAYER, '100,00');
    const input = toExpenseInput(s);
    expect(input?.payers).toContainEqual({ participantId: null, amount: 10000 });
    expect(input?.payers).toContainEqual({ participantId: 'a', amount: 10000 });
  });

  it('fromExpenseForEdit maps a null payer back to the sentinel and round-trips to null', () => {
    const sample = {
      id: 'e',
      title: 'Comida',
      amountCents: 20000,
      date: TODAY,
      payers: [
        { participantId: null, amountCents: 10000 },
        { participantId: 'a', amountCents: 10000 },
      ],
      items: [
        {
          label: null,
          amountCents: 20000,
          splitMode: 'EQUAL' as const,
          shares: PERSONS.map((p) => ({ participantId: p, shareInput: 1 })),
        },
      ],
      refunds: [],
    };
    const s = fromExpenseForEdit(sample, PERSONS);
    expect(s.payers).toContainEqual({ participantId: OWNERLESS_PAYER, amountRaw: '100,00' });
    expect(toExpenseInput(s)?.payers).toContainEqual({ participantId: null, amount: 10000 });
  });
});

describe('itemSummary', () => {
  const base = itemWith('EQUAL', PERSONS.map((p) => ({ participantId: p, included: true, raw: '' })));

  it('describes an equal split among everyone', () => {
    expect(itemSummary(base, nameOf, 4)).toBe('todos · partes iguales');
  });

  it('lists the two included people', () => {
    const two = {
      ...base,
      shares: [
        { participantId: 'a', included: true, raw: '' },
        { participantId: 'b', included: true, raw: '' },
        { participantId: 'c', included: false, raw: '' },
        { participantId: 'd', included: false, raw: '' },
      ],
    };
    expect(itemSummary(two, nameOf, 4)).toBe('Marta y Rubén');
  });

  it('names the single excluded person', () => {
    const three = {
      ...base,
      shares: [
        { participantId: 'a', included: true, raw: '' },
        { participantId: 'b', included: true, raw: '' },
        { participantId: 'c', included: false, raw: '' },
        { participantId: 'd', included: true, raw: '' },
      ],
    };
    expect(itemSummary(three, nameOf, 4)).toBe('todos menos Lucía');
  });

  it('uses the mode label for non-equal splits', () => {
    expect(itemSummary({ ...base, splitMode: 'EXACT' }, nameOf, 4)).toBe('Importes exactos');
  });
});

describe('SPLIT_MODES', () => {
  it('offers every split mode once, simplest first', () => {
    expect(SPLIT_MODES).toEqual(['EQUAL', 'SHARES', 'PERCENTAGE', 'EXACT', 'ADJUSTMENT']);
  });
});
