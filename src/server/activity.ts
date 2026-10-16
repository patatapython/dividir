import type { Prisma } from '@/generated/prisma/client';

export type ActivityAction =
  | 'group.create'
  | 'group.delete'
  | 'participant.create'
  | 'participant.update'
  | 'participant.delete'
  | 'participant.archive'
  | 'participant.unarchive'
  | 'expense.create'
  | 'expense.update'
  | 'expense.delete'
  | 'payment.create'
  | 'payment.delete'
  | 'refund.create'
  | 'refund.delete'
  | 'charge.create'
  | 'charge.update'
  | 'charge.delete'
  | 'charge.pay'
  | 'kitty.open'
  | 'kitty.contribute'
  | 'kitty.spend'
  | 'kitty.close'
  | 'kitty.reopen'
  | 'kitty.rename';

/** Always called INSIDE the same transaction as the entity write (spec §5). */
export function logActivity(
  tx: Prisma.TransactionClient,
  input: { groupId: string; actorName: string | null; action: ActivityAction; payload: Prisma.InputJsonValue },
) {
  return tx.activityLog.create({ data: input });
}
