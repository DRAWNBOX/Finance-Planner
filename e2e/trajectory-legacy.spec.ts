import { test, expect, type Page } from '@playwright/test';
import type { Scenario, TrajectorySnapshot } from '../src/types';
import {
  FIXED_NOW,
  SCHEMA_VERSION,
  STORAGE_KEY,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  planSections,
  saveIndicator,
  seedScenario,
  waitForSaved
} from './fixtures';

/**
 * Bounded real-Chromium GUI-A10 cross-format **legacy refusal** flow.
 *
 * Honesty note: this drives the app through accessible controls against the
 * *real* canonical v3 bytes for a scenario that carries one **legacy
 * (unversioned) asset-only** trajectory snapshot. It does NOT certify the
 * GUI-A01–A10 / G01–G40 or CA01–CA13 matrices — Vitest remains the owner of
 * those flows (`src/App.test.tsx` owns the equivalent refusal branch, which is
 * the fixture mirrored below). The storage checks are format-level shape checks
 * (is the entry still unversioned?), not a re-derivation of the funding math,
 * and no finance total is read back from the report.
 *
 * Determinism:
 * - `seedScenario` pins the clock with `page.clock.setFixedTime` before the
 *   first navigation, writes the canonical bytes once through the app's own
 *   allowlisted codec (never hand-rolled storage bytes), then reloads into them.
 * - Every test runs in a fresh Chromium context (blank localStorage). All waits
 *   are web-first assertions on role/text locators or the debounced save-status
 *   indicator — no arbitrary sleeps.
 */

/** Fixed creation date for the seeded legacy entry (never a wall clock). */
const LEGACY_CREATED_AT = '2025-01-01';

/**
 * The legacy ({@link TrajectorySnapshot}) seed mirrored from the
 * `src/App.test.tsx` GUI-A10 fixture: no `formatVersion`, no `context`, empty
 * `years`. The codec's legacy path must round-trip it unchanged and the UI must
 * keep it visibly archived as asset-only data.
 */
const legacyAssetOnlySnapshot = (): TrajectorySnapshot => ({
  id: 'legacy',
  label: 'Legacy',
  createdAt: LEGACY_CREATED_AT,
  survivesToEnd: true,
  depletedAge: null,
  endAge: 90,
  endingBalance: 0,
  summary: '',
  years: []
});

const scenarioWithLegacySnapshot = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.trajectorySnapshots = [legacyAssetOnlySnapshot()];
  return scenario;
};

const openTrajectoryTab = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Trajectory' }).click();
};

interface PersistedTrajectoryEntry {
  id?: string;
  label?: string;
  formatVersion?: number;
  years?: unknown[];
  annualPoints?: unknown[];
}

const readPersistedTrajectorySnapshots = async (page: Page): Promise<PersistedTrajectoryEntry[]> => {
  const envelope = (await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as Record<string, unknown>,
    STORAGE_KEY
  )) as {
    schemaVersion?: number;
    scenario?: { trajectorySnapshots?: PersistedTrajectoryEntry[] };
  };
  expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
  return envelope.scenario?.trajectorySnapshots ?? [];
};

test('GUI-A10: a seeded legacy trajectory stays archived asset-only and is refused against the current canonical run', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, scenarioWithLegacySnapshot());
  // A clean decode: the seeded legacy entry was neither treated as corrupt nor
  // as a newer-format payload that must be preserved.
  await expectCleanSeed(page);

  await openTrajectoryTab(page);

  const manager = page.getByRole('region', { name: 'Trajectory manager' });
  await expect(manager).toBeVisible();
  await expect(manager.getByText('1 saved', { exact: true })).toBeVisible();
  await expect(manager.getByText('No trajectories saved yet')).toBeHidden();

  // The entry renders its unversioned asset-only identity and is never relabeled
  // as signed `assetsMinusLiabilities` net worth (no pretend conversion).
  const item = manager.locator('.tm-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Legacy');
  await expect(item).toContainText('asset-only · not comparable');
  await expect(item).not.toContainText('assetsMinusLiabilities');

  // Saving the *current canonical* trajectory is still offered (a prepared
  // report exists), so the refusal only affects comparison of the legacy entry.
  await expect(page.getByRole('button', { name: 'Save measured trajectory' })).toBeVisible();
  await expect(manager.getByText('Save unavailable.')).toBeHidden();

  // Selecting the legacy entry through the real radio blocks comparison with the
  // signed current run and states the refusal in the app's own copy.
  await item.getByRole('radio').check();
  await expect(
    manager.getByText(/This legacy snapshot is archived as asset-only data and cannot be compared with canonical net worth\./)
  ).toBeVisible();
  await expect(
    page.getByText(/Legacy asset-only data is archived and never overlaid with signed net worth\./)
  ).toBeVisible();

  // No phantom overlay: the chart legend marks the saved trajectory as not shown.
  await expect(page.getByText('Saved trajectory (not shown)')).toBeVisible();

  // Format-level persistence check: the seeded legacy entry was accepted by the
  // codec as-is and is still unversioned with no fabricated annual points.
  const persisted = await readPersistedTrajectorySnapshots(page);
  expect(persisted).toHaveLength(1);
  expect(persisted[0]?.id).toBe('legacy');
  expect(persisted[0]?.label).toBe('Legacy');
  expect(persisted[0]?.formatVersion).toBeUndefined();
  expect(persisted[0]?.years).toEqual([]);
  expect(persisted[0]?.annualPoints).toBeUndefined();

  expect(errors).toEqual([]);
});

test('GUI-A10: saving the current canonical trajectory alongside the legacy entry keeps the legacy entry unversioned', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, scenarioWithLegacySnapshot());
  await expectCleanSeed(page);
  await openTrajectoryTab(page);

  const manager = page.getByRole('region', { name: 'Trajectory manager' });
  await expect(manager.getByText('1 saved', { exact: true })).toBeVisible();

  // The canonical save path coexists with the archived legacy entry.
  await page.getByLabel('Snapshot name').fill('Canonical current');
  await page.getByLabel('Freeze date').fill('2026-06-15');
  const saveButton = page.getByRole('button', { name: 'Save measured trajectory' });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(manager.getByText('2 saved', { exact: true })).toBeVisible();

  // Selecting the legacy entry still refuses comparison; the canonical save did
  // not reinterpret or convert it.
  const legacyItem = manager.locator('.tm-item').filter({ hasText: 'Legacy' });
  await expect(legacyItem).toHaveCount(1);
  await legacyItem.getByRole('radio').check();
  await expect(
    manager.getByText(/This legacy snapshot is archived as asset-only data and cannot be compared with canonical net worth\./)
  ).toBeVisible();

  // Both formats coexist in the canonical v3 bytes: the legacy entry stays
  // unversioned while the newly saved entry is canonical `formatVersion: 2`.
  await waitForSaved(page);
  const persisted = await readPersistedTrajectorySnapshots(page);
  expect(persisted).toHaveLength(2);
  const legacy = persisted.find((entry) => entry.id === 'legacy');
  const canonical = persisted.find((entry) => entry.formatVersion === 2);
  expect(legacy?.formatVersion).toBeUndefined();
  expect(legacy?.years).toEqual([]);
  expect(canonical?.formatVersion).toBe(2);
  expect((canonical?.annualPoints?.length ?? 0)).toBeGreaterThan(0);

  // The save-status indicator never reports the preserved-newer-payload guard.
  await expect(saveIndicator(page)).not.toContainText('Newer plan preserved');

  expect(errors).toEqual([]);
});
