import { describe, expect, it } from 'vitest';
import {
  amountSchema,
  contributionsSchema,
  createGroupSchema,
  dateSchema,
  expenseSchema,
  groupChargeSchema,
  kittyCloseSchema,
  kittyOpenSchema,
  kittyRenameSchema,
  nonNegativeAmountSchema,
  ownerlessExtraSchema,
  participantNameSchema,
  paymentSchema,
  shareInputSchema,
} from '../../src/server/validation';

/** First issue message, or null when the input is valid. */
function firstError(result: { success: boolean; error?: { issues: { message: string }[] } }): string | null {
  return result.success ? null : (result.error?.issues[0]?.message ?? null);
}

describe('participantNameSchema', () => {
  it('trims and keeps a normal name', () => {
    expect(participantNameSchema.parse('  Ana ')).toBe('Ana');
  });

  it('rejects a blank name after trimming', () => {
    expect(firstError(participantNameSchema.safeParse('   '))).toBe('El nombre no puede estar vacío');
  });

  it('stores a pasted name without its invisible characters or doubled spaces', () => {
    expect(participantNameSchema.parse('\u2060Irene\u2060  Lu')).toBe('Irene Lu');
    expect(firstError(participantNameSchema.safeParse('\u2060\u200B'))).toBe('El nombre no puede estar vacío');
  });

  it('accepts 50 characters and rejects 51', () => {
    expect(participantNameSchema.safeParse('a'.repeat(50)).success).toBe(true);
    expect(firstError(participantNameSchema.safeParse('a'.repeat(51)))).toBe(
      'Nombre demasiado largo (máximo 50 caracteres)',
    );
  });
});

describe('createGroupSchema', () => {
  it('accepts a named group with two distinct people', () => {
    expect(createGroupSchema.safeParse({ name: 'Viaje', participantNames: ['Ana', 'Beto'] }).success).toBe(true);
  });

  it('rejects fewer than the minimum participants', () => {
    expect(firstError(createGroupSchema.safeParse({ name: 'Viaje', participantNames: ['Ana'] }))).toBe(
      'Hacen falta al menos 2 participantes',
    );
  });

  it('rejects a duplicate name, reporting it on participantNames', () => {
    const result = createGroupSchema.safeParse({ name: 'Viaje', participantNames: ['Ana', 'Beto', 'Ana'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ message: 'Participante duplicado: Ana', path: ['participantNames'] }),
    ]);
  });

  it('detects duplicates after trimming, as the database will store them', () => {
    expect(firstError(createGroupSchema.safeParse({ name: 'Viaje', participantNames: ['Ana', ' Ana '] }))).toBe(
      'Participante duplicado: Ana',
    );
  });

  it('treats names differing only in capitals, spacing or invisible characters as the same person', () => {
    for (const twin of ['ana', 'ANA', '\u2060Ana']) {
      expect(firstError(createGroupSchema.safeParse({ name: 'Viaje', participantNames: ['Ana', twin] }))).toBe(
        `Participante duplicado: ${twin.replace('\u2060', '')}`,
      );
    }
    expect(createGroupSchema.safeParse({ name: 'Viaje', participantNames: ['Rubén', 'Ruben'] }).success).toBe(true);
  });

  it('stores the group name clean, as it will be typed to delete it', () => {
    expect(createGroupSchema.parse({ name: '\u2060Pe\u00f1a  del pueblo ', participantNames: ['Ana', 'Beto'] }).name).toBe('Pe\u00f1a del pueblo');
  });

  it('rejects a blank group name', () => {
    expect(firstError(createGroupSchema.safeParse({ name: '  ', participantNames: ['Ana', 'Beto'] }))).toBe(
      'El nombre del grupo es obligatorio',
    );
  });
});

describe('amountSchema (strictly positive)', () => {
  it.each([
    ['12,50', 1250],
    ['12.5', 1250],
    [' 7 ', 700],
  ])('parses %j to %d cents', (raw, cents) => {
    expect(amountSchema.parse(raw)).toBe(cents);
  });

  it.each(['0', '-5,00', 'abc', '12,345', ''])('rejects %j', (raw) => {
    expect(firstError(amountSchema.safeParse(raw))).toBe('Importe no válido (ejemplo: 12,50)');
  });
  it('says an amount above the ceiling is too large, instead of unreadable', () => {
    expect(amountSchema.parse('1000000,00')).toBe(100_000_000);
    expect(firstError(amountSchema.safeParse('1000000,01'))).toBe('Importe demasiado grande (máximo 1.000.000 €)');
    expect(firstError(amountSchema.safeParse('99999999999'))).toBe('Importe demasiado grande (máximo 1.000.000 €)');
  });
});

describe('nonNegativeAmountSchema', () => {
  it('accepts zero, so a declared total can be cleared', () => {
    expect(nonNegativeAmountSchema.parse('0')).toBe(0);
  });

  it('parses a positive amount', () => {
    expect(nonNegativeAmountSchema.parse('80,00')).toBe(8000);
  });

  it('rejects a negative amount by name', () => {
    expect(firstError(nonNegativeAmountSchema.safeParse('-5,00'))).toBe('El importe no puede ser negativo');
  });

  it.each(['cinco', '+80,00', '-0'])('rejects %j as an invalid amount, like any other total', (raw) => {
    expect(firstError(nonNegativeAmountSchema.safeParse(raw))).toBe('Importe no válido (ejemplo: 12,50)');
  });

  it('says an amount above the ceiling is too large', () => {
    expect(firstError(nonNegativeAmountSchema.safeParse('30000000'))).toBe('Importe demasiado grande (máximo 1.000.000 €)');
  });

  it('is the amount rule of the ownerless extra pool', () => {
    expect(ownerlessExtraSchema.parse({ amount: '0' })).toEqual({ amount: 0 });
  });
});

describe('dateSchema', () => {
  it('accepts a calendar date key', () => {
    expect(dateSchema.safeParse('2026-09-24').success).toBe(true);
  });

  it.each(['24/09/2026', '2026-9-24', '2026-09-24T10:00'])('rejects %j', (raw) => {
    expect(firstError(dateSchema.safeParse(raw))).toBe('Fecha no válida');
  });

  it.each(['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2027-02-29'])(
    'rejects %j, a day that is not in the calendar (never stored as another day)',
    (raw) => {
      expect(firstError(dateSchema.safeParse(raw))).toBe('Fecha no válida');
    },
  );

  it('accepts a leap day in a leap year', () => {
    expect(dateSchema.safeParse('2028-02-29').success).toBe(true);
  });
});

describe('shareInputSchema', () => {
  it('accepts a negative integer (an ADJUSTMENT delta)', () => {
    expect(shareInputSchema.safeParse({ participantId: 'p1', shareInput: -500 }).success).toBe(true);
  });

  it('refuses a value too large to store, in either direction', () => {
    expect(shareInputSchema.safeParse({ participantId: 'p1', shareInput: 100_000_000 }).success).toBe(true);
    expect(firstError(shareInputSchema.safeParse({ participantId: 'p1', shareInput: 3_000_000_000 }))).toBe('Valor demasiado grande');
    expect(firstError(shareInputSchema.safeParse({ participantId: 'p1', shareInput: -3_000_000_000 }))).toBe('Valor demasiado grande');
  });

  it('rejects a fractional share input: cents and weights are integers', () => {
    expect(shareInputSchema.safeParse({ participantId: 'p1', shareInput: 1.5 }).success).toBe(false);
  });
});

describe('expenseSchema', () => {
  const base = {
    title: 'Cena',
    date: '2026-09-24',
    payers: [{ participantId: 'p1', amount: '30,00' }],
    items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [{ participantId: 'p1', shareInput: 1 }] }],
  };

  it('accepts payers that add up to the items', () => {
    expect(expenseSchema.safeParse(base).success).toBe(true);
  });

  it('rejects payers that do not add up to the items, on the payers path', () => {
    const result = expenseSchema.safeParse({ ...base, payers: [{ participantId: 'p1', amount: '29,99' }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        message: 'La suma de los pagadores y la de los ítems deben coincidir',
        path: ['payers'],
      }),
    ]);
  });

  it('compares the sums across several payers and several items', () => {
    const result = expenseSchema.safeParse({
      ...base,
      payers: [
        { participantId: 'p1', amount: '10,00' },
        { participantId: null, amount: '15,50' },
      ],
      items: [
        { amount: '20,00', splitMode: 'EQUAL', shares: [{ participantId: 'p1', shareInput: 1 }] },
        { amount: '5,50', splitMode: 'EQUAL', shares: [{ participantId: 'p1', shareInput: 1 }] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an ownerless payer (null participant)', () => {
    const result = expenseSchema.safeParse({ ...base, payers: [{ participantId: null, amount: '30,00' }] });
    expect(result.success).toBe(true);
  });

  it('refuses lines that add up to more than the ceiling, on the items path', () => {
    const line = { amount: '600000,00', splitMode: 'EQUAL', shares: [{ participantId: 'p1', shareInput: 1 }] };
    const payers = [{ participantId: 'p1', amount: '600000,00' }, { participantId: 'p2', amount: '600000,00' }];
    const result = expenseSchema.safeParse({ ...base, payers, items: [line, line] });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ message: 'Importe demasiado grande (máximo 1.000.000 €)', path: ['items'] }),
    );
  });

  it('rejects an expense with no items', () => {
    expect(firstError(expenseSchema.safeParse({ ...base, items: [] }))).toBe('El gasto debe tener al menos un ítem');
  });

  it('rejects an item with no beneficiaries', () => {
    const result = expenseSchema.safeParse({
      ...base,
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [] }],
    });
    expect(firstError(result)).toBe('Elige al menos un beneficiario');
  });

  it('rejects an unknown split mode', () => {
    const result = expenseSchema.safeParse({
      ...base,
      items: [{ amount: '30,00', splitMode: 'HALF', shares: [{ participantId: 'p1', shareInput: 1 }] }],
    });
    expect(result.success).toBe(false);
  });
});

describe('groupChargeSchema', () => {
  it('has no payer and needs at least one participant', () => {
    const result = groupChargeSchema.safeParse({
      concept: 'Casa rural',
      date: '2026-09-24',
      amount: '400,00',
      splitMode: 'EQUAL',
      shares: [],
    });
    expect(firstError(result)).toBe('Elige al menos un participante');
  });
});

describe('paymentSchema', () => {
  const base = { fromId: 'p1', toId: 'p2', amount: '10,00', date: '2026-09-24' };

  it('defaults confirmDuplicate to false', () => {
    expect(paymentSchema.parse(base).confirmDuplicate).toBe(false);
  });

  it('rejects a payment to oneself', () => {
    expect(firstError(paymentSchema.safeParse({ ...base, toId: 'p1' }))).toBe(
      'El pagador y el receptor no pueden ser la misma persona',
    );
  });
});

describe('kitty schemas', () => {
  it('opens a round with nothing at all', () => {
    expect(kittyOpenSchema.parse({})).toEqual({});
  });

  it('parses a preexisting amount when given', () => {
    expect(kittyOpenSchema.parse({ preexisting: '12,00' })).toEqual({ preexisting: 1200 });
  });

  it('renames a round only to a non-empty name of at most 120 characters', () => {
    expect(kittyRenameSchema.parse({ name: ' Agosto ' })).toEqual({ name: 'Agosto' });
    expect(firstError(kittyRenameSchema.safeParse({ name: '' }))).toBe('El nombre de la ronda no puede estar vacío');
    expect(kittyRenameSchema.safeParse({ name: 'a'.repeat(120) }).success).toBe(true);
    expect(firstError(kittyRenameSchema.safeParse({ name: 'a'.repeat(121) }))).toBe('Nombre demasiado largo (máximo 120 caracteres)');
  });

  it('needs at least one contribution', () => {
    expect(firstError(contributionsSchema.safeParse({ contributions: [] }))).toBe('Añade al menos un aporte');
  });

  it('closes only with CERRAR or REPARTIR', () => {
    expect(kittyCloseSchema.safeParse({ action: 'REPARTIR' }).success).toBe(true);
    expect(kittyCloseSchema.safeParse({ action: 'GUARDAR' }).success).toBe(false);
  });
});
