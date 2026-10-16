import { execFileSync } from 'node:child_process';
import { TRUNCATE_ALL_SQL } from '../tests/support/truncate-all';
import { E2E_DATABASE_URL } from './e2e-db';

/**
 * Brings dividir_e2e to the current schema (`migrate deploy` creates the
 * database on first run) and empties it, so every run starts from zero.
 */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', env });
  execFileSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
    input: TRUNCATE_ALL_SQL,
    stdio: ['pipe', 'inherit', 'inherit'],
    env,
  });
}
