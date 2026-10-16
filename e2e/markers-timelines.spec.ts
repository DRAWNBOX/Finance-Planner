import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  FIXED_NOW,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  planSections,
  readStoredBytes,
  seedScenario,
  waitForSaved
} from './fixtures';

/**
 * Bounded real-Chromium GUI-A09 / G38 flows for the shared date-marker registry.
 *
 * Honesty note: these specs drive the real Date markers editor and the
 * HousingEditor `DateOrMarkerInput` controls in Chromium, then assert only
 * deterministic UI strings and canonical schema-v3 storage bytes. They do NOT
 * certify the GUI-A01–A10 / G01–G40 or CA01–CA13 matrices; Vitest remains the
 * owner of the per-item marker-reference engine flows (see `src/commands.test.ts`
 * "shared marker across inactive timelines").
 *
 * Determinism:
 * - Every test runs in a fresh Playwright context, seeds canonical v3 bytes
 *   through the app's own codec via `seedScenario`, and pins the clock before
 *   navigation.
 * - No arbitrary sleeps: waits are web-first assertions or the debounced
 *   save-status indicator (`waitForSaved`).
 * - The marker branch of `DateOrMarkerInput` replaces the year-month inputs, so
 *   the tests read the UI's resolved `.date-or-marker-resolved` output instead of
 *   typing into a disabled/replaced field.
 */

interface PersistedShape {
  schemaVersion?: number;
  scenario?: {
    dateMarkers?: Array<{ label: string; date: string }>;
    housing?: Array<{ startYearMonth?: string; startMarkerId?: string | null }>;
    timelines?: Array<{ housing?: Array<{ startYearMonth?: string; startMarkerId?: string | null }> }>;
  };
}

const openFinancesSection = async (page: Page, name: string): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name }).click();
};

/** The UI's resolved readout for a `DateOrMarkerInput` (a sibling of its select). */
const resolvedFor = (markerSelect: Locator): Locator =>
  markerSelect.locator('xpath=../span[contains(@class, "date-or-marker-resolved")]');

/** The labelled Start marker select of the currently rendered housing entry. */
const housingStartMarker = (page: Page): Locator =>
  page.locator('.housing-editor').getByRole('combobox', { name: 'Start Marker', exact: true });

/**
 * Creates the reusable "Launch" marker (2027-03-01) through the Date markers tab
 * and a rental whose Start source is that marker, then asserts March 2027.
 */
const createMarkerLinkedRental = async (page: Page): Promise<void> => {
  await openFinancesSection(page, 'Date markers');
  const markerEditor = page.locator('.date-markers-editor');
  await expect(markerEditor.getByText(/No date markers yet/)).toBeVisible();

  await page.getByRole('button', { name: '+ Date Marker' }).click();
  const markerName = markerEditor.getByLabel('Name', { exact: true });
  await expect(markerName).toHaveValue('New marker');
  await markerName.fill('Launch');

  const markerDate = markerEditor.getByLabel('Date', { exact: true });
  await markerDate.fill('2027-03-01');
  await expect(markerDate).toHaveValue('2027-03-01');

  await openFinancesSection(page, 'Housing');
  await page.getByRole('button', { name: '+ Rental' }).click();
  const housing = page.locator('.housing-editor');
  await expect(housing.getByRole('button', { name: 'Apartment' })).toBeVisible();

  // The real DateOrMarkerInput source toggle: pressing Marker makes it the active
  // source (aria-pressed) and reveals the labelled marker select.
  const startSource = housing.getByRole('group', { name: 'Start date source', exact: true });
  await expect(startSource.getByRole('button', { name: 'Date', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await startSource.getByRole('button', { name: 'Marker', exact: true }).click();

  const startMarker = housingStartMarker(page);
  await expect(startMarker).toBeVisible();
  await startMarker.selectOption({ label: 'Launch' });
  await expect(startMarker).toHaveValue(/.+/);
  await expect(resolvedFor(startMarker)).toHaveText('March 2027');
};

/** Moves the single Launch marker to a new ISO date through the Date markers tab. */
const moveLaunchMarker = async (page: Page, isoDate: string): Promise<void> => {
  await openFinancesSection(page, 'Date markers');
  const markerDate = page.locator('.date-markers-editor').getByLabel('Date', { exact: true });
  await expect(markerDate).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await markerDate.fill(isoDate);
  await expect(markerDate).toHaveValue(isoDate);
};

test('GUI-A09/G38: a rental Start linked to a shared marker follows a marker date change without relinking', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, createDefaultScenario(FIXED_NOW));
  await expectCleanSeed(page);

  await createMarkerLinkedRental(page);

  // Move the marker; the link is never re-created, only the resolved month moves.
  await moveLaunchMarker(page, '2027-05-01');

  await openFinancesSection(page, 'Housing');
  const startMarker = housingStartMarker(page);
  await expect(startMarker).toHaveValue(/.+/); // still linked to Launch
  await expect(resolvedFor(startMarker)).toHaveText('May 2027');
  // The selected entry is the rental, not a stale selection.
  await expect(page.locator('.housing-editor').getByRole('button', { name: 'Apartment' })).toHaveClass(/active/);
  // Unrelated settings are untouched.
  await expect(page.locator('.housing-editor').getByRole('spinbutton', { name: 'Monthly Rent' })).toHaveValue('1500');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await waitForSaved(page);
  const raw = await readStoredBytes(page);
  expect(raw).not.toBeNull();
  const persisted = JSON.parse(raw as string) as PersistedShape;
  expect(persisted.schemaVersion).toBe(3);
  expect(persisted.scenario?.dateMarkers).toEqual([expect.objectContaining({ label: 'Launch', date: '2027-05-01' })]);
  expect(persisted.scenario?.housing?.[0]?.startYearMonth).toBe('2027-05');
  expect(persisted.scenario?.housing?.[0]?.startMarkerId).toBeTruthy();

  expect(errors).toEqual([]);
});

test('GUI-A09/G38: a marker change reaches both the base plan and a cloned named timeline', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, createDefaultScenario(FIXED_NOW));
  await expectCleanSeed(page);

  await createMarkerLinkedRental(page);

  // Clone the current (base) set into a named timeline before editing the marker.
  await page.getByRole('button', { name: 'Add timeline' }).click();
  await expect(page.getByRole('region', { name: 'Timeline manager' }).getByText('Showing Timeline 1')).toBeVisible();

  // The clone carries the same marker link and resolves to March 2027.
  const cloneMarker = housingStartMarker(page);
  await expect(cloneMarker).toHaveValue(/.+/);
  await expect(resolvedFor(cloneMarker)).toHaveText('March 2027');

  // Move the shared marker once; every referencing scope resolves to May 2027.
  await moveLaunchMarker(page, '2027-05-01');

  // The active named clone follows.
  await openFinancesSection(page, 'Housing');
  await expect(resolvedFor(housingStartMarker(page))).toHaveText('May 2027');

  // Switching back to the base plan shows the same resolved month, still linked.
  await page.getByLabel('Selected timeline').selectOption({ label: 'Base plan' });
  await expect(page.getByText('Showing the original plan')).toBeVisible();
  await expect(resolvedFor(housingStartMarker(page))).toHaveText('May 2027');

  // Cloning / cross-view switching leaves no stale modal behind and no stale selection.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.housing-editor').getByRole('button', { name: 'Apartment' })).toHaveClass(/active/);

  await waitForSaved(page);
  const raw = await readStoredBytes(page);
  expect(raw).not.toBeNull();
  const persisted = JSON.parse(raw as string) as PersistedShape;
  expect(persisted.schemaVersion).toBe(3);
  expect(persisted.scenario?.dateMarkers).toEqual([expect.objectContaining({ label: 'Launch', date: '2027-05-01' })]);
  expect(persisted.scenario?.housing?.[0]?.startYearMonth).toBe('2027-05');
  expect(persisted.scenario?.housing?.[0]?.startMarkerId).toBeTruthy();
  expect(persisted.scenario?.timelines?.[0]?.housing?.[0]?.startYearMonth).toBe('2027-05');
  expect(persisted.scenario?.timelines?.[0]?.housing?.[0]?.startMarkerId).toBeTruthy();

  expect(errors).toEqual([]);
});
