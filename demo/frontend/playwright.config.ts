import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke-test config for /play/ (demo/frontend/e2e/*.spec.ts).
 *
 * Serves the already-built `dist/` via `astro preview` under the real GitHub
 * Pages base path, so every test hits the same paths production does. Build
 * once beforehand (`npm run build`); this config never rebuilds on its own.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4331/inocs-sum-bss-pt-network-design/',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx astro preview --port 4331',
    url: 'http://localhost:4331/inocs-sum-bss-pt-network-design/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
