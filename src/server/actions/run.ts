import { DomainError } from '@/domain/errors';
import { domainErrorMessage } from '../domain-messages';
import { fail, type ActionResult } from '../action-result';
import { ArchivedParticipantError, EntityGoneError, GroupNotFoundError, type ScopedEntity } from '../group-scope';
import { isForeignKeyViolation, isRecordNotFound, vanishedModel } from '../prisma-errors';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Uniform action wrapper: expected failures become typed results with
 * Spanish messages; unexpected errors propagate to the error boundary
 * (Next logs them server-side with the digest the boundary shows).
 * A foreign-key violation (P2003) or a vanished row (P2025) is expected: it
 * is the DB backstop when a concurrent change removed or still references a
 * row this action touches. Every row an action writes was first read scoped
 * to the group, so a P2025 cannot come from a scoping bug, only from a row
 * deleted in between. Both are mapped, so they are logged here instead.
 */
const ENTITY_NAMES: Record<ScopedEntity, string> = {
  participant: 'El participante',
  expense: 'El gasto',
  refund: 'La devolución',
  payment: 'El pago',
  charge: 'El gasto sin pagar',
  kittyRound: 'La ronda del bote',
  kittyContribution: 'El aporte',
  kittySpend: 'El gasto del bote',
};

const entityGone = (entity: ScopedEntity) =>
  `${ENTITY_NAMES[entity]} ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.`;

/**
 * Which row a person lost when a P2025 names a model: said the same way as a
 * scoped read that found nothing. Exhaustive on purpose — a new model must
 * decide. null: nothing a person would name (a line or share inside an
 * expense, the log, the bote's anchor); the general message covers those.
 */
const ENTITY_OF_MODEL: Record<Prisma.ModelName, ScopedEntity | null> = {
  Group: null,
  Participant: 'participant',
  Expense: 'expense',
  ExpenseItem: null,
  ExpenseShare: null,
  ExpensePayer: null,
  Payment: 'payment',
  Refund: 'refund',
  GroupCharge: 'charge',
  GroupChargeShare: null,
  ActivityLog: null,
  Kitty: null,
  KittyRound: 'kittyRound',
  KittyContribution: 'kittyContribution',
  KittySpend: 'kittySpend',
};

const CONCURRENT_CHANGE = 'Otro cambio en el grupo afecta a estos datos. Recarga la página e inténtalo de nuevo.';

export async function runAction<T>(work: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GroupNotFoundError) return fail('Grupo no encontrado');
    if (error instanceof EntityGoneError) return fail(entityGone(error.entity));
    if (error instanceof ArchivedParticipantError) return fail('No se puede usar un participante archivado');
    if (error instanceof DomainError) return fail(domainErrorMessage(error.code));
    if (isForeignKeyViolation(error) || isRecordNotFound(error)) {
      // Not rethrown, so Next never logs it; a real bug can look like a race.
      // Code and meta (model, constraint) only: the message may carry query
      // arguments, and the group token must never reach a log (spec §2.1).
      console.warn('[runAction] concurrent change mapped to a user message', {
        code: error.code,
        meta: error.meta,
      });
      const model = isRecordNotFound(error) ? vanishedModel(error) : null;
      const entity = model ? ENTITY_OF_MODEL[model] : null;
      return fail(entity ? entityGone(entity) : CONCURRENT_CHANGE);
    }
    throw error;
  }
}
