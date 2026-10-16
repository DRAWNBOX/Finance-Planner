import { test, expect, type Page } from '@playwright/test';
import type { Scenario } from '../src/types';
import {
  ACCOUNT_IDS,
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
 * GUI-A06 / G23 — ordinary expected-payment card-plan CRUD driven through the real
 * CardPlanEditor UI over a fresh canonical v3 seed, then a named-timeline
 * isolation check.
 *
 * Honesty note: this is a bounded browser flow over `seedScenario`; it does NOT
 * certify the GUI-A/G or CA matrices — Vitest remains the owner of those per-item
 * engine flows (`src/engine/cards.test.ts`, `src/App.test.tsx`).
 *
 * Flow: add an "expected payment" plan; set a known amount, first/last month and
 * Checking source; duplicate it; edit the copy's label/amount; remove the
 * original; autosave; reload; assert the surviving edited ordinary plan is the
 * only canonical `cardPlans` entry and that no `zeroInterestCard` liability was
 * fabricated. Then clone a named timeline, edit only the clone, switch back to
 * Base plan and assert the base plan is isolated.
 *
 * No expected money is derived from `projectFeatureScenario` output — every
 * assertion is a literal hand-entered value. Determinism: a fresh Chromium
 * context with blank localStorage, the clock pinned via `seedScenario` before the
 * first navigation, and role/label locators with Playwright auto-retry (no
 * arbitrary sleeps).
 */

const openCreditCards = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Expenses' }).click();
  await planSections(page).getByRole('button', { name: 'Credit cards' }).click();
};

test('GUI-A06 / G23: an ordinary expected-payment plan survives add/duplicate/edit/remove as the only stored plan, with no card liability, and stays isolated in a named timeline', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, createDefaultScenario(FIXED_NOW));
  await expectCleanSeed(page);

  await openCreditCards(page);
  await expect(page.getByRole('heading', { name: 'Card plans' })).toBeVisible();
  // Fresh canonical seed carries no card plans yet.
  await expect(page.getByText('No card plans in this scenario. Add a payment schedule or a permanent 0% payoff plan.')).toBeVisible();

  // --- Add an ordinary expected-payment plan -------------------------------
  await page.getByRole('button', { name: 'Add expected payment' }).click();

  await page.getByLabel('Expected monthly payment ($)').fill('50');
  await page.getByLabel(/^First payment month$/).fill('2026-07');
  await page.getByLabel(/^Last payment month \(inclusive\)$/).fill('2026-09');
  // A known source: Checking. Ordinary plans never create or link card debt.
  await page.getByLabel('Primary account', { exact: true }).selectOption(ACCOUNT_IDS.checking);

  // --- Duplicate, then edit one copy ---------------------------------------
  await page.getByRole('button', { name: 'Duplicate plan' }).click();

  // The duplicate becomes the active plan; rename and re-price only the copy.
  await page.getByLabel('Plan name').fill('Edited card plan');
  await page.getByLabel('Expected monthly payment ($)').fill('75');

  // Remove the original: select it by its still-default label, then delete it.
  await page.getByLabel('Selected card plan').selectOption({ label: 'Expected Payment' });
  await page.getByRole('button', { name: 'Remove plan' }).click();

  // Only the edited copy remains and is the active plan.
  await expect(page.getByLabel('Plan name')).toHaveValue('Edited card plan');
  await waitForSaved(page);

  // --- Canonical bytes carry exactly the surviving edited ordinary plan -----
  const beforeReload = JSON.parse((await readStoredBytes(page)) as string) as { scenario: Scenario };
  const basePlans = beforeReload.scenario.cardPlans ?? [];
  expect(basePlans).toHaveLength(1);
  expect(basePlans[0]).toMatchObject({
    kind: 'expectedPayment',
    label: 'Edited card plan',
    amount: 75,
    startYearMonth: '2026-07',
    endYearMonth: '2026-09'
  });
  expect(basePlans[0].funding?.primaryAccountId).toBe(ACCOUNT_IDS.checking);
  // An ordinary expected payment creates no zero-interest card liability.
  expect((beforeReload.scenario.liabilities ?? []).filter((liability) => liability.kind === 'zeroInterestCard')).toEqual([]);

  // --- Reload restores the surviving plan from canonical bytes -------------
  await page.reload();
  await expectCleanSeed(page);
  await openCreditCards(page);
  await expect(page.getByLabel('Plan name')).toHaveValue('Edited card plan');
  await expect(page.getByLabel('Expected monthly payment ($)')).toHaveValue('75');
  await expect(page.getByLabel(/^First payment month$/)).toHaveValue('2026-07');
  await expect(page.getByLabel(/^Last payment month \(inclusive\)$/)).toHaveValue('2026-09');

  // --- Named-timeline isolation --------------------------------------------
  await page.getByRole('button', { name: 'Add timeline' }).click();
  await expect(page.getByText('Showing Timeline 1')).toBeVisible();

  // Rename the plan only inside the new named timeline (a deep clone).
  await page.getByLabel('Plan name').fill('Timeline card plan');
  await waitForSaved(page);

  // Switching back to Base plan shows the untouched base plan.
  await page.getByLabel('Selected timeline').selectOption('');
  await expect(page.getByLabel('Plan name')).toHaveValue('Edited card plan');
  await waitForSaved(page);

  const afterTimeline = JSON.parse((await readStoredBytes(page)) as string) as { scenario: Scenario };
  expect(afterTimeline.scenario.cardPlans ?? []).toHaveLength(1);
  expect(afterTimeline.scenario.cardPlans?.[0].label).toBe('Edited card plan');
  const timeline = afterTimeline.scenario.timelines?.[0];
  expect(timeline?.label).toBe('Timeline 1');
  expect(timeline?.cardPlans).toHaveLength(1);
  expect(timeline?.cardPlans[0]).toMatchObject({ kind: 'expectedPayment', label: 'Timeline card plan', amount: 75 });
  // The clone never mints a second card liability on the base scenario either.
  expect((afterTimeline.scenario.liabilities ?? []).filter((liability) => liability.kind === 'zeroInterestCard')).toEqual([]);

  expect(errors).toEqual([]);
});
