import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/server/test-db';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/server/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['tests/server/global-setup.ts'],
    setupFiles: ['tests/server/next-mocks.ts'],
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
});
