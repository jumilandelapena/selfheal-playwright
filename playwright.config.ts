import { defineConfig, devices } from '@playwright/test';

/** The demo app listens here. The healer reads this value from the config too. */
export const PORT = process.env.PORT ?? '4173';
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  // Short timeouts keep a broken-locator run fast; the demo app responds instantly.
  timeout: 15_000,
  expect: { timeout: 3_000 },
  use: {
    baseURL: BASE_URL,
    actionTimeout: 3_000,
    navigationTimeout: 10_000,
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec tsx demo-app/server.ts',
    url: `${BASE_URL}/healthz`,
    // The healer starts the app itself and then runs Playwright against it.
    reuseExistingServer: true,
    env: { APP_VERSION: process.env.APP_VERSION ?? '1', PORT },
    timeout: 30_000,
  },
});
