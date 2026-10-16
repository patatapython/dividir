import { cookies } from 'next/headers';
import { prisma } from './db';

export async function currentActorName(groupId: string): Promise<string | null> {
  const cookieStore = await cookies();
  const participantId = cookieStore.get(`participant_${groupId}`)?.value;
  if (!participantId) return null;
  // Scoped lookup even for the cookie — a forged id from another group yields null.
  const participant = await prisma.participant.findFirst({ where: { id: participantId, groupId } });
  return participant?.name ?? null;
}
