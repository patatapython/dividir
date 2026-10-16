import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'prisma/config';

// The Prisma 7 CLI does not read `.env` files; Next does. Load them with Next's own
// loader so the app and `prisma migrate` always see the same DATABASE_URL. Variables
// already set in the process (tests, E2E, compose.prod.yml) win over any file.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

// Dev credentials are non-secret and already public in docker-compose.yml.
// Production MUST set DATABASE_URL (compose prod profile does).
const DEV_DATABASE_URL = 'postgresql://dividir:dividir@localhost:5433/dividir';
// Shadow DB: used only by `prisma migrate dev`/`migrate diff` to compute
// migration diffs; never holds real data.
const DEV_SHADOW_DATABASE_URL = 'postgresql://dividir:dividir@localhost:5433/dividir_shadow';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? DEV_DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? DEV_SHADOW_DATABASE_URL,
  },
});
