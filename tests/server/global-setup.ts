import { execFileSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-db';

export default function globalSetup() {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
