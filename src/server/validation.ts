import { z } from 'zod';
import { MAX_AMOUNT_CENTS, parseAmount, parseNonNegativeAmount, parseSignedAmount } from '@/domain/money';
import { AMOUNT_TOO_LARGE, unreadableAmountMessage } from './amount-messages';
import { MIN_PARTICIPANTS } from '@/domain/group';
import { normalizeText, personNameKey } from '@/domain/text';

/**
 * Every free text is stored as normalizeText leaves it (no invisible characters, one
 * space at a time, trimmed) and its length is checked on that clean text.
 */
const text = () => z.string().overwrite(normalizeText);

export const participantNameSchema = text()
  .min(1, 'El nombre no puede estar vacío')
  .max(50, 'Nombre demasiado largo (máximo 50 caracteres)');

export const createGroupSchema = z
  .object({
    name: text().min(1, 'El nombre del grupo es obligatorio').max(80, 'Nombre demasiado largo'),
    participantNames: z.array(participantNameSchema).min(MIN_PARTICIPANTS, `Hacen falta al menos ${MIN_PARTICIPANTS} participantes`),
  })
  .superRefine((value, ctx) => {
    // The same person typed twice, even with other capitals (the database index agrees).
    const seen = new Set<string>();
    for (const name of value.participantNames) {
      if (seen.has(personNameKey(name))) {
        ctx.addIssue({ code: 'custom', message: `Participante duplicado: ${name}`, path: ['participantNames'] });
      }
      seen.add(personNameKey(name));
    }
  });

/** Raw user string → Cents. The server action is the authority (spec §6). */
export const amountSchema = z.string().transform((raw, ctx) => {
  const cents = parseAmount(raw);
  if (cents === null) {
    ctx.addIssue({ code: 'custom', message: unreadableAmountMessage(raw) });
    return z.NEVER;
  }
  return cents;
});

/** Raw user string → Cents ≥ 0. For totals the user may clear back to zero. */
export const nonNegativeAmountSchema = z.string().transform((raw, ctx) => {
  const cents = parseNonNegativeAmount(raw);
  if (cents === null) {
    // A readable negative gets its own message; anything else is just unreadable.
    const signed = parseSignedAmount(raw);
    const message = signed !== null && signed < 0 ? 'El importe no puede ser negativo' : unreadableAmountMessage(raw);
    ctx.addIssue({ code: 'custom', message });
    return z.NEVER;
  }
  return cents;
});

/** A calendar day `YYYY-MM-DD` that exists: "2026-02-30" is refused, never stored as 2 March. */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida')
  .refine((key) => {
    const day = new Date(`${key}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === key;
  }, 'Fecha no válida');

export const splitModeSchema = z.enum(['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES', 'ADJUSTMENT']);

export const shareInputSchema = z.object({
  participantId: z.string().min(1),
  // ADJUSTMENT deltas may be negative; domain layer validates per-mode. Bounded so a
  // weight or delta can always be stored (32-bit column): no mode needs more.
  shareInput: z.number().int().min(-MAX_AMOUNT_CENTS, 'Valor demasiado grande').max(MAX_AMOUNT_CENTS, 'Valor demasiado grande'),
});

export const payerInputSchema = z.object({
  // null = ownerless payer ("Sobrante" in the UI, spec §7.1); folded into settle().
  participantId: z.string().min(1).nullable(),
  amount: amountSchema,
});

export const itemInputSchema = z.object({
  label: text().max(120).optional(),
  amount: amountSchema,
  splitMode: splitModeSchema,
  shares: z.array(shareInputSchema).min(1, 'Elige al menos un beneficiario'),
});

export const expenseSchema = z
  .object({
    title: text().min(1, 'El concepto es obligatorio').max(120, 'Concepto demasiado largo'),
    date: dateSchema,
    payers: z.array(payerInputSchema).min(1, 'Elige al menos un pagador'),
    items: z.array(itemInputSchema).min(1, 'El gasto debe tener al menos un ítem'),
  })
  .superRefine((data, ctx) => {
    const payerSum = data.payers.reduce((acc, p) => acc + p.amount, 0);
    const itemSum = data.items.reduce((acc, i) => acc + i.amount, 0);
    if (itemSum > MAX_AMOUNT_CENTS) {
      ctx.addIssue({ code: 'custom', message: AMOUNT_TOO_LARGE, path: ['items'] });
    }
    if (payerSum !== itemSum) {
      ctx.addIssue({
        code: 'custom',
        message: 'La suma de los pagadores y la de los ítems deben coincidir',
        path: ['payers'],
      });
    }
  });

// Model A (spec §7.2): an unpaid group charge — concept + amount split across
// participants, with NO payer. Its shares are external debt, never in settle().
export const groupChargeSchema = z.object({
  concept: text().min(1, 'El concepto es obligatorio').max(120, 'Concepto demasiado largo'),
  date: dateSchema,
  amount: amountSchema,
  splitMode: splitModeSchema,
  shares: z.array(shareInputSchema).min(1, 'Elige al menos un participante'),
});

/** Who paid an unpaid charge in full (it becomes an ordinary expense of theirs). */
export const chargePaySchema = z.object({ payerId: z.string().min(1, 'Elige quién lo pagó') });

// Declared leftover ("Sobrante" in the UI; the ownerless extra pool). >= 0 (0 clears it); the remaining
// amount is derived in the read model (declared − what nobody already paid).
export const ownerlessExtraSchema = z.object({
  amount: nonNegativeAmountSchema,
});

export const paymentSchema = z
  .object({
    fromId: z.string().min(1),
    toId: z.string().min(1),
    amount: amountSchema,
    date: dateSchema,
    confirmDuplicate: z.boolean().optional().default(false),
  })
  .refine((value) => value.fromId !== value.toId, { message: 'El pagador y el receptor no pueden ser la misma persona' });

export const refundSchema = z.object({
  expenseId: z.string().min(1),
  receivedById: z.string().min(1),
  amount: amountSchema,
});

const ROUND_NAME_MAX = 120;
const roundName = () => text().max(ROUND_NAME_MAX, `Nombre demasiado largo (máximo ${ROUND_NAME_MAX} caracteres)`);

export const kittyOpenSchema = z.object({
  // Blank is allowed here: the round is then called "Ronda".
  name: roundName().optional(),
  // v1.3: user-entered leftover ("Sobrante de otra vez") — money already on the table.
  preexisting: amountSchema.optional(),
});

export const kittyRenameSchema = z.object({
  name: roundName().min(1, 'El nombre de la ronda no puede estar vacío'),
});

export const contributionSchema = z.object({
  participantId: z.string().min(1),
  amount: amountSchema,
});

// v1.3: contributions are entered inline for several participants at once.
export const contributionsSchema = z.object({
  contributions: z.array(contributionSchema).min(1, 'Añade al menos un aporte'),
});

export const spendSchema = z.object({
  concept: text().min(1, 'El concepto es obligatorio').max(120),
  amount: amountSchema,
});

export const kittyCloseSchema = z.object({ action: z.enum(['CERRAR', 'REPARTIR']) });
