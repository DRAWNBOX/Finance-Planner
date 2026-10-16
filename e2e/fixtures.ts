import { expect, type Page } from '@playwright/test';
import { createDefaultScenario } from '../src/defaultScenario';
import { createDefaultUiState, encodeAppState } from '../src/codec';
import type { Scenario } from '../src/types';

/**
 * Shared, safe browser helpers for the Finance Planner e2e suite.
 *
 * Honesty note: these helpers seed the *real* canonical v3 bytes (the same
 * allowlisted codec the app uses) into the app's own localStorage key and drive
 * the app through the browser. They do NOT certify the GUI-A/G or CA acceptance
 * matrices; Vitest remains the owner of the per-item engine flows.
 *
 * Determinism:
 * - `seedScenario` pins the clock with `page.clock.setFixedTime` BEFORE the
 *   first navigation, establishes the origin with `page.goto('/')`, writes the
 *   canonical bytes once via `page.evaluate`, then `page.reload()`s so the app
 *   hydrates from those bytes. It deliberately avoids a repeating
 *   `addInitScript`, which would clobber a user's later edits on every reload.
 * - Each test runs in a fresh Playwright context (blank localStorage below),
 *   so no real browser profile is ever touched.
 * - The write funnels through the app's guarded `saveAppState` path during the
 *   test; the helper only performs the initial explicit seed.
 */

export const STORAGE_KEY = 'finance-planner-state';
export const SCHEMA_VERSION = 3;
export const FIXED_NOW = new Date('2026-06-15T12:00:00');

/** Stable first-launch account ids (preserved across load/reset). */
export const ACCOUNT_IDS = {
  checking: 'checking-account-default',
  emergencyFund: 'emergencyFund-account-default',
  hsa: 'hsa-account-default',
  investments: 'investments-account-default',
  retirement401k: 'retirement401k-account-default'
} as const;

export { createDefaultScenario };

/**
 * Normalizes the app's UI state exactly as the codec does. Kept here so specs
 * never hand-roll the envelope shape.
 */
export const seedState = (scenario: Scenario) => ({
  scenario,
  ui: createDefaultUiState()
});

/**
 * Writes canonical v3 bytes for `scenario` under the app's storage key, then
 * reloads so the running app hydrates from exactly those bytes.
 */
export const seedScenario = async (
  page: Page,
  scenario: Scenario,
  fixedDate: Date = FIXED_NOW
): Promise<void> => {
  const { json, schemaVersion } = encodeAppState(seedState(scenario), fixedDate);
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Expected canonical schema v${SCHEMA_VERSION} bytes, received v${schemaVersion}.`);
  }
  const parsed = JSON.parse(json) as { schemaVersion?: number };
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Encoded bytes are not the expected canonical schema version.');
  }

  // Pin time before navigation so the app boots on the deterministic date.
  await page.clock.setFixedTime(fixedDate);
  await page.goto('/');

  // Wait for the app shell to mount (and Vite's cold-start dependency
  // optimization to settle) before writing bytes, then reload into them.
  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('button', { name: 'Options' })
    .waitFor();

  const origin = await page.evaluate(() => window.location.origin);
  if (!origin.startsWith('http')) {
    throw new Error(`seedScenario could not establish an http origin (got "${origin}").`);
  }

  await page.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: STORAGE_KEY, value: json }
  );

  await page.reload();
};

/** Raw bytes currently persisted under the app's storage key. */
export const readStoredBytes = (page: Page): Promise<string | null> =>
  page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);

/** Parsed persisted envelope, or null when nothing is stored. */
export const readStoredEnvelope = async (
  page: Page
): Promise<{ schemaVersion?: number } | null> => {
  const raw = await readStoredBytes(page);
  return raw === null ? null : (JSON.parse(raw) as { schemaVersion?: number });
};

export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main sections' });
export const planSections = (page: Page) => page.getByRole('complementary', { name: 'Plan sections' });
export const saveIndicator = (page: Page) => page.getByRole('banner').getByRole('status');

/** Collects console errors and uncaught page errors for a test. */
export const collectErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
};

/**
 * Asserts the freshly-seeded plan was accepted: not reported as a newer-version
 * payload ("Newer plan preserved") or an unreadable one ("Plan needs attention").
 * A clean decode leaves an untouched plan "Ready to save".
 */
export const expectCleanSeed = async (page: Page): Promise<void> => {
  await expect(saveIndicator(page)).toHaveText('Ready to save');
};

/** Waits (bounded, via Playwright auto-retry) for the debounced autosave to land. */
export const waitForSaved = async (page: Page): Promise<void> => {
  await expect(saveIndicator(page)).toHaveText('Saved on this device');
};
