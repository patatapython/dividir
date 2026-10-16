import { describe, expect, it } from 'vitest';
import { ledgerCsv, ledgerFilename, type LedgerData } from '../../src/app/g/[token]/exportar/ledger-csv';

const people = [
  { id: 'ana', name: 'Ana', archived: false },
  { id: 'bea', name: 'Bea', archived: false },
  { id: 'carla', name: 'Carla', archived: true },
];

const base: LedgerData = {
  participants: people,
  expenses: [],
  payments: [],
  refunds: [],
  charges: [],
};

/** Parses our own output back: BOM stripped, CRLF rows, `;` cells (fixtures avoid quoting). */
function rows(csv: string): string[][] {
  expect(csv.startsWith('﻿')).toBe(true);
  return csv.slice(1).split('\r\n').filter((line, i, all) => i < all.length - 1 || line !== '').map((line) => line.split(';'));
}

const cents = (cell: string) => Math.round(Number(cell.replace(',', '.')) * 100);

describe('ledgerCsv — the reparto ledger as a spreadsheet', () => {
  it('has one column per person, archived included, and a saldo row of zeros when empty', () => {
    expect(rows(ledgerCsv(base))).toEqual([
      ['Fecha', 'Tipo', 'Concepto', 'Importe', 'Detalle', 'Ana', 'Bea', 'Carla'],
      ['', 'Saldo', '', '', '', '0,00', '0,00', '0,00'],
    ]);
  });

  it('each movement shows its effect on every person, oldest first, and the columns add up to the saldo', () => {
    const data: LedgerData = {
      ...base,
      expenses: [
        {
          id: 'x1',
          date: '2026-07-02',
          createdAt: new Date('2026-07-02T10:00:00Z'),
          title: 'Cena',
          amountCents: 3000,
          payers: [{ participantId: 'ana', amountCents: 3000 }],
          shares: [
            { participantId: 'ana', amountCents: 1000 },
            { participantId: 'bea', amountCents: 1000 },
            { participantId: 'carla', amountCents: 1000 },
          ],
        },
      ],
      payments: [{ id: 'p1', date: '2026-07-03', createdAt: new Date('2026-07-03T10:00:00Z'), fromId: 'bea', toId: 'ana', amountCents: 1000 }],
      refunds: [
        {
          id: 'r1',
          createdAt: new Date('2026-07-01T09:00:00Z'), // before the payment, after nothing: sorted by its own day
          expenseTitle: 'Cena',
          receivedById: 'ana',
          amountCents: 300,
          shares: [
            { participantId: 'ana', amountCents: 100 },
            { participantId: 'bea', amountCents: 100 },
            { participantId: 'carla', amountCents: 100 },
          ],
        },
      ],
    };
    const table = rows(ledgerCsv(data));
    expect(table.slice(1)).toEqual([
      ['2026-07-01', 'Reembolso', 'Cena', '3,00', 'recibió Ana', '-2,00', '1,00', '1,00'],
      ['2026-07-02', 'Gasto', 'Cena', '30,00', 'pagó Ana', '20,00', '-10,00', '-10,00'],
      ['2026-07-03', 'Pago', '', '10,00', 'Bea → Ana', '-10,00', '10,00', '0,00'],
      ['', 'Saldo', '', '', '', '8,00', '1,00', '-9,00'],
    ]);
    for (const row of table.slice(1)) {
      expect(row.slice(5).map(cents).reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  it('rows tied on date and creation time keep one order, by id, on every download', () => {
    const at = new Date('2026-07-03T10:00:00Z');
    const payment = (id: string, amountCents: number) => ({ id, date: '2026-07-03', createdAt: at, fromId: 'bea', toId: 'ana', amountCents });
    const table = rows(ledgerCsv({ ...base, payments: [payment('p-b', 200), payment('p-a', 100)] }));
    expect(table.slice(1, 3).map((r) => r[3])).toEqual(['1,00', '2,00']);
    const flipped = rows(ledgerCsv({ ...base, payments: [payment('p-a', 100), payment('p-b', 200)] }));
    expect(flipped).toEqual(table);
  });

  it('leftover money gets its own column, folded onto the active people before the saldo', () => {
    const data: LedgerData = {
      ...base,
      expenses: [
        {
          id: 'x2',
          date: '2026-07-02',
          createdAt: new Date('2026-07-02T10:00:00Z'),
          title: 'Comida',
          amountCents: 200,
          payers: [
            { participantId: 'ana', amountCents: 100 },
            { participantId: null, amountCents: 100 },
          ],
          shares: [
            { participantId: 'ana', amountCents: 100 },
            { participantId: 'bea', amountCents: 100 },
          ],
        },
      ],
    };
    const table = rows(ledgerCsv(data));
    expect(table[0]).toEqual(['Fecha', 'Tipo', 'Concepto', 'Importe', 'Detalle', 'Ana', 'Bea', 'Carla', 'Sobrante']);
    expect(table.slice(1)).toEqual([
      ['2026-07-02', 'Gasto', 'Comida', '2,00', 'pagaron Ana y Sobrante', '0,00', '-1,00', '0,00', '1,00'],
      // Carla is archived: the fold goes to the active people only, as in Saldos.
      ['', 'Reparto del sobrante', '', '', '', '0,50', '0,50', '0,00', '-1,00'],
      ['', 'Saldo', '', '', '', '0,50', '-0,50', '0,00', '0,00'],
    ]);
  });

  it('gastos sin pagar sit in their own block with their own total, never in the saldo', () => {
    const data: LedgerData = {
      ...base,
      charges: [
        {
          id: 'x3',
          date: '2026-07-05',
          createdAt: new Date('2026-07-05T10:00:00Z'),
          concept: 'Luz',
          amountCents: 900,
          shares: [
            { participantId: 'ana', amountCents: 450 },
            { participantId: 'bea', amountCents: 450 },
          ],
        },
      ],
    };
    const table = rows(ledgerCsv(data));
    expect(table.slice(1)).toEqual([
      ['', 'Saldo', '', '', '', '0,00', '0,00', '0,00'],
      [''],
      ['2026-07-05', 'Gasto sin pagar', 'Luz', '9,00', '', '-4,50', '-4,50', '0,00'],
      ['', 'Total gastos sin pagar', '', '', '', '-4,50', '-4,50', '0,00'],
    ]);
  });

  it('quotes cells that need it and defuses text a spreadsheet would run as a formula', () => {
    const data: LedgerData = {
      ...base,
      participants: [
        { id: 'ana', name: '=Ana', archived: false },
        { id: 'bea', name: 'Bea "B"', archived: false },
      ],
      charges: [
        {
          id: 'x4',
          date: '2026-07-05',
          createdAt: new Date('2026-07-05T10:00:00Z'),
          concept: 'Luz; agua\ny gas',
          amountCents: 100,
          shares: [{ participantId: 'ana', amountCents: 100 }],
        },
      ],
    };
    const csv = ledgerCsv(data);
    expect(csv).toContain(`;'=Ana;"Bea ""B"""\r\n`);
    expect(csv).toContain(`;"Luz; agua\ny gas";`);
    // Our own negative amounts are numbers, not text: never defused.
    expect(csv).toContain(';-1,00;');
  });
});

describe('ledgerFilename', () => {
  it('is ASCII, dated, and safe for any group name', () => {
    expect(ledgerFilename('Piso de la Calle Ñ, 2º', '2026-09-24')).toBe('dividir-piso-de-la-calle-n-2-2026-09-24.csv');
    expect(ledgerFilename('***', '2026-09-24')).toBe('dividir-grupo-2026-09-24.csv');
  });
});
