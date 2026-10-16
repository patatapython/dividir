import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { SIM_DATABASE_URL } from './tests/sim/sim-db';

/**
 * The scale simulation: the same in-process
 * action calls and Next mocks as the integration suite, on its own database. Not
 * part of `npm run verify` — it is long and leaves its data behind for the browser.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/sim/**/*.sim.ts'],
    fileParallelism: false,
    globalSetup: ['tests/sim/global-setup.ts'],
    setupFiles: ['tests/server/next-mocks.ts'],
    env: { DATABASE_URL: SIM_DATABASE_URL },
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
