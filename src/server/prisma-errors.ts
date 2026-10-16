import { Prisma } from '@/generated/prisma/client';

/** Single place that knows Prisma's error codes; actions ask by meaning. */
type KnownError = Prisma.PrismaClientKnownRequestError;

function hasCode(error: unknown, code: string): error is KnownError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/** A unique constraint rejected the write (P2002). */
export const isUniqueViolation = (error: unknown): error is KnownError => hasCode(error, 'P2002');

/** A foreign key rejected the write (P2003): a referenced row vanished, or a
 *  Restrict relation still points at the row being deleted. */
export const isForeignKeyViolation = (error: unknown): error is KnownError => hasCode(error, 'P2003');

/** The row a write or an *OrThrow read needs does not exist (P2025): a
 *  concurrent change deleted it after this action read it. */
export const isRecordNotFound = (error: unknown): error is KnownError => hasCode(error, 'P2025');

/** The model whose row was not found, from a P2025 (Prisma puts it in meta.modelName). */
export function vanishedModel(error: KnownError): Prisma.ModelName | null {
  const name = (error.meta as { modelName?: unknown } | undefined)?.modelName;
  return typeof name === 'string' && name in Prisma.ModelName ? (name as Prisma.ModelName) : null;
}
