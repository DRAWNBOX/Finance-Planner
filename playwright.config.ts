import { defineConfig, devices } from '@playwright/test';

/**
 * Bounded end-to-end configuration for the Finance Planner.
 *
 * Scope note: this suite is a small smoke gate over the real Vite dev server —
 * it does NOT certify the GUI-A/G or CA acceptance matrices. It drives the app
 * through role locators against a fresh, isolated Chromium context (blank
 * localStorage per test) and the deterministic fixed clock set inside each spec.
 *
 * The dev server is used directly (`vite dev`) so no separate build step is
 * required; port 4173 matches Vite's preview default while `--strictPort`
 * fails fast if something else already holds it.
 */
const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Long projections can be slow to settle; keep the fan-out small and bounded.
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
