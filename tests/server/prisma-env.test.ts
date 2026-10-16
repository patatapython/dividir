import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Next reads `.env*` on its own; the Prisma 7 CLI does not. `prisma.config.ts` must load
// the same files with Next's own loader, or a developer's `.env` would point the app at
// one database and `prisma migrate` at another. A variable already set in the process
// (tests, E2E, the production compose file) must still win over any file.
const ROOT = process.cwd();
let project: string;

function datasourceLine(env: NodeJS.ProcessEnv): string {
  const run = spawnSync('npx', ['prisma', 'migrate', 'status'], { cwd: project, env, encoding: 'utf8' });
  return `${run.stdout}${run.stderr}`.split('\n').find((line) => line.startsWith('Datasource')) ?? '';
}

function envWithout(name: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env[name];
  return env;
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'dividir-prisma-env-'));
  cpSync(join(ROOT, 'prisma'), join(project, 'prisma'), { recursive: true });
  cpSync(join(ROOT, 'prisma.config.ts'), join(project, 'prisma.config.ts'));
  symlinkSync(join(ROOT, 'node_modules'), join(project, 'node_modules'));
  writeFileSync(join(project, '.env'), 'DATABASE_URL=postgresql://dividir:dividir@localhost:5433/from_dotenv\n');
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('prisma.config.ts environment', () => {
  it('reads DATABASE_URL from .env, like Next', () => {
    expect(datasourceLine(envWithout('DATABASE_URL'))).toContain('"from_dotenv"');
  }, 30_000);

  it('lets a DATABASE_URL set in the process win over .env', () => {
    const env = { ...process.env, DATABASE_URL: 'postgresql://dividir:dividir@localhost:5433/from_process' };
    expect(datasourceLine(env)).toContain('"from_process"');
  }, 30_000);
});
