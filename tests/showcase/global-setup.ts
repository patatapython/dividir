import { execFileSync } from 'node:child_process';
import { TRUNCATE_ALL_SQL } from '../support/truncate-all';
import { SHOWCASE_DATABASE_URL } from './showcase-db';

/** Brings dividir_showcase to the current schema and empties it, so every run seeds the same story. */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: SHOWCASE_DATABASE_URL };
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', env });
  execFileSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
    input: TRUNCATE_ALL_SQL,
    stdio: ['pipe', 'inherit', 'inherit'],
    env,
  });
}
