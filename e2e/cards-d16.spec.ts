import { test, expect } from '@playwright/test';
import type { Scenario } from '../src/types';
import { createDefaultZeroInterestCardPlan } from '../src/defaultScenario';
import {
  ACCOUNT_IDS,
  FIXED_NOW,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  planSections,
  seedScenario
} from './fixtures';

/**
 * GUI-A06 — a seeded permanent-0% card payoff that is only partly funded, driven
 * through real Chromium over the app's own canonical v3 bytes.
 *
 * Honesty note: these are bounded browser flows over `seedScenario`; they do NOT
 * certify the GUI-A/G or CA matrices — Vitest remains the owner of those per-item
 * engine flows (`src/engine/cards.test.ts`, `src/App.test.tsx`).
 *
 * Fixture (mirrors the `src/App.test.tsx` GUI-A06 funded/shortfall card cases):
 * career disabled; Checking $30 and every other account $0; a linked
 * `zeroInterestCard` liability with a $100 opening; and one permanent-0% plan that
 * starts 2026-07, targets 2026-09, pays on day 1, and funds from Checking.
 *
 * Hand-computed, input-derived cents (never read back from the report):
 *   - July installment target = ceil(10000 / 3) = 3334 cents ($33.34)
 *   - July committed debit    = min(3000, 3334) = 3000 cents ($30.00)
 *   - July unpaid principal   = 334 cents ($3.34)
 * App.tsx renders money with `maximumFractionDigits: 0`, so the report-backed
 * outcome warning surfaces that exact 334-cent shortfall as "Unpaid $3." (a
 * whole-dollar rounding of the same cents — never a fabricated $0). The
 * assertion pins the exact month and the exact rounded amount, not `> $0`.
 *
 * Determinism: each test gets a fresh Chromium context with blank localStorage,
 * the clock is pinned with `page.clock.setFixedTime` before the first navigation,
 * and the seed is written once via `seedScenario` (no repeating `addInitScript`).
 * Waits are Playwright auto-retries on role/text locators — no arbitrary sleeps.
 */

/**
 * Mirrors `App.tsx`'s whole-dollar USD formatter. The GUI renders money with
 * `maximumFractionDigits: 0`, so the exact 334-cent shortfall ($3.34) surfaces as
 * "$3". Kept here so the expected text is driven by the input-derived cents.
 */
const appMoney = (cents: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);

/** The GUI-A06 partial shortfall fixture at the helper's fixed reference date. */
const partiallyFundedCardScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: account.id === ACCOUNT_IDS.checking ? 30 : 0
  }));
  scenario.liabilities = [
    { id: 'liab-zero', kind: 'zeroInterestCard', label: 'Store card', openingBalance: 100 }
  ];
  scenario.cardPlans = [
    createDefaultZeroInterestCardPlan(FIXED_NOW, {
      id: 'cp-zero',
      liabilityId: 'liab-zero',
      initialBalance: 0,
      startYearMonth: '2026-07',
      targetYearMonth: '2026-09',
      paymentDay: 1,
      funding: { primaryAccountId: ACCOUNT_IDS.checking, fallbackAccountIds: [] }
    })
  ];
  return scenario;
};

test('GUI-A06: a $30-funded permanent-0% card payoff shows the July partial shortfall in the observed card results', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, partiallyFundedCardScenario());
  await expectCleanSeed(page);

  await mainNav(page).getByRole('button', { name: 'Expenses' }).click();
  await planSections(page).getByRole('button', { name: 'Credit cards' }).click();
  await expect(page.getByRole('heading', { name: 'Card plans' })).toBeVisible();

  const results = page.locator('.card-results');
  await expect(results.getByRole('heading', { name: 'Observed projection results' })).toBeVisible();
  // Real report-backed activity, not the empty-state placeholder.
  await expect(results).not.toContainText('No scheduled card activity appears in this projection.');

  // The committed debit is the report's executed total across the plan: the only
  // balance ever available was Checking's $30 (3000 cents), drained once in July.
  await expect(results).toContainText(/\bpaid \$30\b/);

  // The July outcome warning is selected from the real per-occurrence outcome and
  // carries the exact 334-cent unpaid principal ($3.34 rendered whole-dollar).
  const julyWarning = results.locator('p.warning-error', { hasText: '2026-07' });
  await expect(julyWarning).toHaveText(
    `Some scheduled payments could not be fully funded, beginning in 2026-07. Unpaid ${appMoney(334)}.`
  );

  // No secondary source is configured, so no fallback banner is fabricated.
  await expect(results.locator('p.warning-warning')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('GUI-A06 / D16: the Warnings tab leads with the July first shortfall as Needs attention, not fallback or exhaustion', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, partiallyFundedCardScenario());
  await expectCleanSeed(page);

  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Warnings' }).click();

  const panel = page.locator('.warning-panel');
  await expect(panel.getByRole('heading', { name: 'Plan checks' })).toBeVisible();

  // D16: the first warning is the completeness-shortfall selector, tagged as an
  // error ("Needs attention") and naming the first short month, July 2026.
  const shortfallEntry = panel
    .locator('p.warning-error')
    .filter({ hasText: 'Some scheduled payments could not be fully funded, beginning in 2026-07.' });
  await expect(shortfallEntry).toHaveCount(1);
  await expect(shortfallEntry).toContainText('Needs attention');

  // The leading warning is that shortfall — never the exhaustion or fallback selector.
  await expect(panel.locator('p.warning-error').first()).toContainText(
    'Some scheduled payments could not be fully funded, beginning in 2026-07.'
  );

  // No fallback was drawn (single primary, no fallback accounts): the panel must
  // not invent a "Fallback used" entry.
  await expect(panel.locator('p.warning-warning')).toHaveCount(0);
  await expect(panel).not.toContainText('Fallback used');

  expect(errors).toEqual([]);
});
