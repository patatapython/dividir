import { defineConfig, devices } from '@playwright/test';
import { E2E_DATABASE_URL, E2E_PORT } from './e2e/e2e-db';

const baseURL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // A failure keeps its trace (network, DOM snapshots, console) so a flake can be
  // diagnosed instead of guessed at.
  use: { baseURL, trace: 'retain-on-failure' },
  // The app is used mostly on phones: the whole suite also runs on a touch
  // device at phone width, not a hand-picked subset.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // The production build, run like the container runs it (scripts/e2e-server.sh):
    // what ships is what is tested, and one server keeps up with every worker.
    command: 'scripts/e2e-server.sh',
    url: baseURL,
    // Never reuse: a server left running would serve a build of older code.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      HOSTNAME: 'localhost',
      PORT: String(E2E_PORT),
      // Like production behind its proxy; each test sends its own address (e2e/support.ts).
      TRUST_PROXY: '1',
    },
  },
});
