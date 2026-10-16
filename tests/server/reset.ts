import { prisma } from '../../src/server/db';
import { TRUNCATE_ALL_SQL } from '../support/truncate-all';

export async function resetDb() {
  await prisma.$executeRawUnsafe(TRUNCATE_ALL_SQL);
}
