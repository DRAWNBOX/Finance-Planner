import { test, expect } from '@playwright/test';
import type { Scenario } from '../src/types';
import {
  ACCOUNT_IDS,
  FIXED_NOW,
  SCHEMA_VERSION,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  planSections,
  readStoredEnvelope,
  saveIndicator,
  seedScenario,
  waitForSaved
} from './fixtures';

/**
 * Bounded browser GUI flows over the real Vite dev server (GUI-A01/A02/A03/A09
 * style: boot a projection, persist unrelated edits, and keep timeline clones
 * isolated). These drive the app through role locators against canonical v3
 * bytes seeded into the app's own localStorage key — they do NOT certify the
 * GUI-A/G or CA matrices; that remains Vitest's responsibility.
 *
 * Determinism: every test gets a fresh Chromium context, the clock is pinned
 * before navigation, and the seed is written once via `seedScenario` (no
 * repeating `addInitScript`). No arbitrary sleeps — waits are Playwright
 * auto-retries on role locators or the debounced save-status indicator.
 */

/** A valid plan that carries no enabled career, so the projection has no income stream. */
const noEnabledCareerScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = {
    ...scenario.careerPlan,
    enabled: false,
    entries: scenario.careerPlan.entries.map((entry) => ({ ...entry, enabled: false }))
  };
  return scenario;
};

test('seeded plan with no enabled career still renders chart, table and warnings without crashes', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, noEnabledCareerScenario());

  // A clean decode means the v3 seed was neither treated as corrupt nor as a
  // newer-version payload that must be preserved.
  await expectCleanSeed(page);
  await expect(saveIndicator(page)).not.toContainText('Newer plan preserved');

  // Default view (Options → Retirement) renders the projection results table.
  await expect(page.getByRole('region', { name: 'Projection results' })).toBeVisible();

  // Finances Prediction → Timeline renders both the chart and the results table.
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
  await expect(page.getByRole('region', { name: 'Projection chart' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Projection results' })).toBeVisible();

  // Warnings renders a real panel rather than crashing on an income-less plan.
  await planSections(page).getByRole('button', { name: 'Warnings' }).click();
  await expect(page.getByRole('heading', { name: 'Plan checks' })).toBeVisible();
  await expect(page.locator('.warning-panel')).toContainText(
    /Needs attention|Fallback used|No funding warnings in this plan/
  );

  expect(errors).toEqual([]);
});

test('two account return rates and a funding-order edit survive an unrelated edit and reload', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, createDefaultScenario(FIXED_NOW));
  await expectCleanSeed(page);

  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts & funding' })).toBeVisible();

  // Accounts are rendered in display order: Checking, Emergency Fund, HSA,
  // Investments, 401K. Set two base return rates plus one retirement override.
  await page.getByLabel('Annual return').nth(0).fill('4.5');
  await page.getByLabel('Annual return').nth(3).fill('7.25');
  await page.getByLabel('Retirement return').nth(0).fill('5.5');

  // Global funding order: make Emergency Fund primary instead of the default
  // Checking. `exact` avoids the "Remove Primary account" button's label match.
  await page.getByLabel('Primary account', { exact: true }).selectOption({ label: 'Emergency Fund' });

  // An unrelated account-label edit, then let the debounced autosave land.
  await page.getByLabel('Account name').first().fill('Main');
  await waitForSaved(page);

  await page.reload();
  await expectCleanSeed(page);
  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();

  await expect(page.getByLabel('Account name').first()).toHaveValue('Main');
  await expect(page.getByLabel('Annual return').nth(0)).toHaveValue('4.5');
  await expect(page.getByLabel('Annual return').nth(3)).toHaveValue('7.25');
  await expect(page.getByLabel('Retirement return').nth(0)).toHaveValue('5.5');
  await expect(page.getByLabel('Primary account', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);

  expect(errors).toEqual([]);
});

test('a dated career pay-plan cap and overflow persist and stay isolated across a cloned timeline', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, createDefaultScenario(FIXED_NOW));
  await expectCleanSeed(page);

  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Careers' }).click();
  await expect(page.getByRole('heading', { name: 'Career plan' })).toBeVisible();

  // Base plan: add a second, dated pay plan with a cap and an explicit overflow.
  await page.getByRole('button', { name: 'Pay plan' }).click();
  await page.locator('.account-career-plan-name input').first().fill('Base cap plan');
  await page.locator('.account-career-plan-name input[type="month"]').fill('2027-01');
  await page.getByLabel('Maximum account balance 1').fill('1000');
  await page.getByLabel('Overflow account 1').selectOption({ label: 'HSA' });
  await waitForSaved(page);

  // Clone into a named timeline and rename the plan only inside that clone.
  await page.getByRole('button', { name: 'Add timeline' }).click();
  await expect(page.getByText('Showing Timeline 1')).toBeVisible();
  await page.locator('.account-career-plan-name input').first().fill('Timeline cap plan');
  await waitForSaved(page);

  await page.reload();
  await expectCleanSeed(page);

  // The v3 bytes round-tripped as canonical schema 3.
  const envelope = await readStoredEnvelope(page);
  expect(envelope?.schemaVersion).toBe(SCHEMA_VERSION);

  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Careers' }).click();

  // The cloned timeline keeps the dated plan, its cap and its overflow.
  await expect(page.getByRole('tab', { name: 'Timeline cap plan' })).toBeVisible();
  await page.getByRole('tab', { name: 'Timeline cap plan' }).click();
  await expect(page.locator('.account-career-plan-name input[type="month"]')).toHaveValue('2027-01');
  await expect(page.getByLabel('Maximum account balance 1')).toHaveValue('1000');
  await expect(page.getByLabel('Overflow account 1')).toHaveValue(ACCOUNT_IDS.hsa);

  // Switching back to Default shows the base plan's own name — the clone's
  // rename did not leak across timelines (isolation).
  await page.getByLabel('Selected timeline').selectOption({ label: 'Base plan' });
  await expect(page.getByRole('tab', { name: 'Base cap plan' })).toBeVisible();
  await page.getByRole('tab', { name: 'Base cap plan' }).click();
  await expect(page.getByLabel('Maximum account balance 1')).toHaveValue('1000');
  await expect(page.getByLabel('Overflow account 1')).toHaveValue(ACCOUNT_IDS.hsa);

  expect(errors).toEqual([]);
});
