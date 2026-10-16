import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/domain/**/*.test.ts', 'tests/ui/**/*.test.ts', 'tests/server-pure/**/*.test.ts', 'tests/repo/**/*.test.ts'],
  },
});
