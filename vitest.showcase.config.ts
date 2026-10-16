import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { SHOWCASE_DATABASE_URL } from './tests/showcase/showcase-db';

/**
 * Seeds the fictional group shown in the README screenshots (tests/showcase/), through
 * the same in-process server actions and Next mocks as the integration suite, on its
 * own database. Not part of `npm run verify`.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/showcase/**/*.seed.ts'],
    globalSetup: ['tests/showcase/global-setup.ts'],
    setupFiles: ['tests/server/next-mocks.ts'],
    env: { DATABASE_URL: SHOWCASE_DATABASE_URL },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
