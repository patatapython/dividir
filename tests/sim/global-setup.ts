import { execFileSync } from 'node:child_process';
import { TRUNCATE_ALL_SQL } from '../support/truncate-all';
import { SIM_DATABASE_URL } from './sim-db';

/**
 * Brings dividir_sim to the current schema and empties it, so every simulation
 * starts from zero and a fixed seed yields the same ledger.
 */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: SIM_DATABASE_URL };
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', env });
  execFileSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
    input: TRUNCATE_ALL_SQL,
    stdio: ['pipe', 'inherit', 'inherit'],
    env,
  });
}
