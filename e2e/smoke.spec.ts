import { test, expect, type Page } from '@playwright/test';

/**
 * Bounded end-to-end smoke tests for the Finance Planner.
 *
 * Honesty note: these tests verify that the app boots, the four top sections and
 * two representative report sub-tabs mount, one account edit round-trips through
 * reload, and the reset confirmation gates a destructive replace. They do NOT
 * certify the GUI-A01–A10 / G01–G40 or CA01–CA13 acceptance matrices; Vitest
 * remains the owner of those flows.
 *
 * Determinism:
 * - Every test starts from a fresh Chromium context, so localStorage is blank —
 *   the app hydrates from `createDefaultScenario` (no real user bytes, no
 *   persistent browser profile).
 * - `page.clock.setFixedTime` pins `Date.now`/`new Date` to 2026-06-15T12:00:00
 *   before the app boots. Unlike `clock.install`, `setFixedTime` keeps timers
 *   running, so the 550 ms autosave debounce still fires.
 */

const FIXED_NOW = new Date('2026-06-15T12:00:00');

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

/** Pin the clock, then open the app at the dev-server base URL. */
const openApp = async (page: Page): Promise<void> => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await expect(mainNav(page).getByRole('button', { name: 'Options' })).toBeVisible();
};

test('fresh profile navigates the four top sections plus Warnings and Date markers', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);

  const nav = mainNav(page);
  for (const name of ['Options', 'Finances Prediction', 'Net Worth', 'Expenses']) {
    await expect(nav.getByRole('button', { name })).toBeVisible();
  }

  await nav.getByRole('button', { name: 'Net Worth' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts & funding' })).toBeVisible();

  await nav.getByRole('button', { name: 'Expenses' }).click();
  await expect(page.getByRole('heading', { name: 'Plan expenses by account' })).toBeVisible();

  await nav.getByRole('button', { name: 'Finances Prediction' }).click();
  await expect(page.getByRole('heading', { name: 'Career plan' })).toBeVisible();

  const sections = planSections(page);
  await sections.getByRole('button', { name: 'Timeline' }).click();
  await expect(page.getByRole('region', { name: 'Projection results' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Projection chart' })).toBeVisible();

  await sections.getByRole('button', { name: 'Warnings' }).click();
  await expect(page.getByRole('heading', { name: 'Plan checks' })).toBeVisible();
  // The first-launch default plan legitimately reports funding warnings, so the
  // panel shows a D16 severity label rather than the empty-state message.
  const warningPanel = page.locator('.warning-panel');
  await expect(warningPanel).toBeVisible();
  await expect(warningPanel).toContainText(/Needs attention|Fallback used|No funding warnings in this plan/);

  await sections.getByRole('button', { name: 'Date markers' }).click();
  await expect(page.getByText(/No date markers yet/)).toBeVisible();

  expect(errors).toEqual([]);
});

test('an account edit survives a reload and a reset requires explicit confirmation', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);

  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();
  const accountName = page.getByLabel('Account name').first();
  await expect(accountName).toHaveValue('Checking');

  await accountName.fill('Main');
  await expect(saveIndicator(page)).toContainText('Saved on this device');

  await page.reload();
  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();
  await expect(page.getByLabel('Account name').first()).toHaveValue('Main');

  // Cancelling the reset keeps the edited plan untouched.
  await page.getByRole('button', { name: 'Reset plan' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Reset this plan?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep my plan' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Account name').first()).toHaveValue('Main');

  // Confirming the reset restores first-launch account labels.
  await page.getByRole('button', { name: 'Reset plan' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reset plan' }).click();
  await expect(page.getByLabel('Account name').first()).toHaveValue('Checking');

  expect(errors).toEqual([]);
});

test('first launch renders clean with no console or page errors', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);

  // The default Options → Retirement view projects the full horizon.
  await expect(page.getByRole('region', { name: 'Projection results' })).toBeVisible();

  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Warnings' }).click();
  await expect(page.getByRole('heading', { name: 'Plan checks' })).toBeVisible();

  expect(errors).toEqual([]);
});
