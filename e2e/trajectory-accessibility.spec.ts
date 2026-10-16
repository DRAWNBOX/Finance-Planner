import { test, expect, type Page } from '@playwright/test';

/**
 * Bounded real-Chromium GUI-A09 / GUI-A10 accessibility flows.
 *
 * Honesty note: these two specs drive the app through accessible controls in a
 * real Chromium browser — the Trajectory save / select / rename / delete /
 * reload round-trip, the DateOrMarkerInput `aria-pressed` source toggle, and
 * BufferedNumberInput Escape-cancel / Enter-commit keyboard semantics. They do
 * NOT certify the GUI-A01–A10 / G01–G40 or CA01–CA13 matrices; Vitest remains
 * the owner of those flows. In particular the cross-format **legacy refusal**
 * branch is not exercised here because it needs a seeded legacy snapshot and
 * this lane intentionally does not depend on a shared fixture module. Only
 * deterministic UI strings produced by the live default run are asserted, and
 * the storage check is a format-level shape check, not a re-derivation of the
 * funding math.
 *
 * Determinism:
 * - Every test starts from a fresh isolated Chromium context, so localStorage
 *   is blank and the app hydrates from `createDefaultScenario` (no shared seed,
 *   no persistent profile).
 * - `page.clock.setFixedTime` pins `Date.now` / `new Date` before the app boots.
 *   Unlike `clock.install`, `setFixedTime` keeps timers running, so the 550 ms
 *   autosave debounce still fires. All waits use web-first assertions (no
 *   arbitrary sleeps).
 */

const FIXED_NOW = new Date('2026-06-15T12:00:00');
const STORAGE_KEY = 'finance-planner-state';

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main sections' });
const planSections = (page: Page) => page.getByRole('complementary', { name: 'Plan sections' });
const saveIndicator = (page: Page) => page.getByRole('banner').getByRole('status');

const collectErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
};

/** Pin the clock, then open the app at the fixed Vite base URL. */
const openApp = async (page: Page): Promise<void> => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await expect(mainNav(page).getByRole('button', { name: 'Finances Prediction' })).toBeVisible();
};

/** Enter the Finances Prediction top section and pick one plan sub-tab. */
const openFinanceSection = async (page: Page, name: string): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name }).click();
};

test('GUI-A09/A10: saves, selects, renames, deletes and reloads a canonical trajectory via accessible controls', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await openFinanceSection(page, 'Trajectory');

  const manager = page.getByRole('region', { name: 'Trajectory manager' });
  await expect(manager).toBeVisible();
  await expect(manager.getByText('No trajectories saved yet')).toBeVisible();

  // The live default run exposes a prepared report, so the save form is offered
  // (the "Save unavailable." fallback is not shown) and Freeze date is required.
  const saveButton = page.getByRole('button', { name: 'Save measured trajectory' });
  await expect(saveButton).toBeVisible();
  await expect(manager.getByText('Save unavailable.')).toBeHidden();

  const nameField = page.getByLabel('Snapshot name');
  const freezeField = page.getByLabel('Freeze date');

  await nameField.fill('E2E A09');
  await freezeField.fill('2026-06-15');
  await saveButton.click();
  await expect(manager.getByText('1 saved', { exact: true })).toBeVisible();

  await nameField.fill('E2E A09b');
  await freezeField.fill('2026-06-15');
  await saveButton.click();
  await expect(manager.getByText('2 saved', { exact: true })).toBeVisible();

  const items = manager.locator('.tm-item');
  await expect(items).toHaveCount(2);

  // The canonical snapshot records the signed net-worth measurement basis
  // (`assetsMinusLiabilities`), never the legacy asset-only label.
  await expect(items.first()).toContainText('assetsMinusLiabilities');

  // Select the first saved context through the actual radio control; both froze
  // the same run, so a like-for-like comparison is offered.
  await manager.getByRole('radio').first().check();
  await expect(manager.getByText(/Ready to compare/)).toBeVisible();

  // Rename through the accessible textbox; the accessible name mirrors the label.
  // `exact` avoids matching the sibling "Rename E2E A09b" (substring match).
  await manager.getByRole('textbox', { name: 'Rename E2E A09', exact: true }).fill('Renamed A09');
  await expect(manager.getByRole('textbox', { name: 'Rename Renamed A09', exact: true })).toHaveValue('Renamed A09');

  // Deletion is gated by a window.confirm; accept it in the real browser.
  page.on('dialog', (dialog) => dialog.accept());
  await manager.getByRole('button', { name: 'Remove Renamed A09', exact: true }).click();
  await expect(manager.getByText('1 saved', { exact: true })).toBeVisible();
  await expect(manager.getByText('Renamed A09')).toBeHidden();

  // Flush the coalesced autosave, then reload to prove persistence.
  await expect(saveIndicator(page)).toContainText('Saved on this device');
  await page.reload();
  await openFinanceSection(page, 'Trajectory');
  await expect(page.getByRole('region', { name: 'Trajectory manager' }).getByText('1 saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Rename E2E A09b', exact: true })).toHaveValue('E2E A09b');

  // Format-level persistence check of the allowlisted schema-v3 codec. This
  // confirms a canonical (formatVersion 2) signed-cents snapshot was stored; it
  // is not a re-run of the funding/exhaustion matrix.
  const persisted = (await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as Record<string, unknown>,
    STORAGE_KEY
  )) as {
    schemaVersion?: number;
    scenario?: { trajectorySnapshots?: Array<{ formatVersion?: number; annualPoints?: Array<{ netWorthCents?: unknown }> }> };
  };
  expect(persisted.schemaVersion).toBe(3);
  const snapshots = persisted.scenario?.trajectorySnapshots ?? [];
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]?.formatVersion).toBe(2);
  expect(snapshots[0]?.annualPoints?.length ?? 0).toBeGreaterThan(0);
  expect(typeof snapshots[0]?.annualPoints?.[0]?.netWorthCents).toBe('number');

  expect(errors).toEqual([]);
});

test('GUI-A09 accessibility: DateOrMarkerInput aria-pressed toggle and BufferedNumberInput keyboard commit/cancel', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);

  // 1) Create one reusable date marker through the accessible marker editor.
  await openFinanceSection(page, 'Date markers');
  const markerEditor = page.locator('.date-markers-editor');
  await expect(markerEditor.getByText(/No date markers yet/)).toBeVisible();

  await page.getByRole('button', { name: '+ Date Marker' }).click();
  const markerName = markerEditor.getByLabel('Name', { exact: true });
  await expect(markerName).toHaveValue('New marker');
  await markerName.fill('Launch');
  await expect(markerEditor.getByLabel('Name', { exact: true })).toHaveValue('Launch');
  await expect(markerEditor.getByLabel('Date', { exact: true })).not.toHaveValue('');

  // 2) Add a rental so a DateOrMarkerInput with an available marker is mounted.
  await planSections(page).getByRole('button', { name: 'Housing' }).click();
  const housing = page.locator('.housing-editor');
  await page.getByRole('button', { name: '+ Rental' }).click();
  await expect(housing.getByRole('button', { name: 'Apartment' })).toBeVisible();

  // 3) The DateOrMarkerInput source toggle exposes the active side via aria-pressed.
  //
  const startSource = housing.getByRole('group', { name: 'Start date source' });
  const dateOption = startSource.getByRole('button', { name: 'Date', exact: true });
  const markerOption = startSource.getByRole('button', { name: 'Marker', exact: true });
  const startYear = housing.getByRole('textbox', { name: 'Start Year', exact: true });

  await expect(dateOption).toHaveAttribute('aria-pressed', 'true');
  await expect(markerOption).toHaveAttribute('aria-pressed', 'false');
  await expect(housing.getByRole('combobox', { name: 'Start Marker' })).toBeHidden();
  await expect(startYear).toBeVisible();

  await markerOption.click();
  await expect(markerOption).toHaveAttribute('aria-pressed', 'true');
  await expect(dateOption).toHaveAttribute('aria-pressed', 'false');
  const markerSelect = housing.getByRole('combobox', { name: 'Start Marker' });
  await expect(markerSelect).toBeVisible();
  await expect(markerSelect).toHaveValue(/.+/);
  await expect(markerSelect).toContainText('Launch');
  await expect(startYear).toBeHidden();

  await dateOption.click();
  await expect(dateOption).toHaveAttribute('aria-pressed', 'true');
  await expect(markerOption).toHaveAttribute('aria-pressed', 'false');
  await expect(housing.getByRole('combobox', { name: 'Start Marker' })).toBeHidden();
  await expect(startYear).toBeVisible();

  // 4) BufferedNumberInput keyboard semantics in a real browser (not jsdom).
  const rent = housing.getByRole('spinbutton', { name: 'Monthly Rent' });
  await expect(rent).toBeVisible();
  const committedRent = await rent.inputValue();

  // Escape cancels the dirty draft and restores the committed value.
  await rent.fill('4321');
  await expect(rent).toHaveValue('4321');
  await rent.press('Escape');
  await expect(rent).toHaveValue(committedRent);
  await expect(rent).not.toBeFocused();

  // A re-edit commits on Enter (and blurs the field).
  await rent.fill('9876');
  await expect(rent).toHaveValue('9876');
  await rent.press('Enter');
  await expect(rent).toHaveValue('9876');
  await expect(rent).not.toBeFocused();

  // Tab moves focus off the field (blur runs the same commit path).
  await rent.focus();
  await expect(rent).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(rent).not.toBeFocused();

  // The committed value survives a reload, proving onCommit wrote scenario state
  // rather than only the local draft.
  await expect(saveIndicator(page)).toContainText('Saved on this device');
  await page.reload();
  await openFinanceSection(page, 'Housing');
  await expect(page.locator('.housing-editor').getByRole('spinbutton', { name: 'Monthly Rent' })).toHaveValue('9876');

  // The date marker created earlier also survives the reload.
  await planSections(page).getByRole('button', { name: 'Date markers' }).click();
  await expect(page.locator('.date-markers-editor').getByLabel('Name', { exact: true })).toHaveValue('Launch');

  expect(errors).toEqual([]);
});
