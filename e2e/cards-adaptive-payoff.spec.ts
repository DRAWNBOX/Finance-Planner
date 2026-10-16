import { test, expect, type Page } from '@playwright/test';
import type { CashflowItem, Scenario } from '../src/types';
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
 * GUI-A06 / G24 — browser counterpart of the composed CA06 flow
 * `src/engine/phase5CrossFeature.test.ts` "recomputes an unfunded permanent-0%
 * installment and pays the residual in one final obligation (CA06)", shifted from
 * Jan→Mar to July→Sept inside the helper's fixed 2026-06-15 report horizon.
 *
 * Honesty note: this is a bounded browser flow over canonical v3 bytes seeded by
 * `seedScenario`; it does NOT certify the GUI-A/G or CA matrices — Vitest remains
 * the owner of the per-item engine math (`src/engine/cards.test.ts`,
 * `src/engine/phase5CrossFeature.test.ts`, `src/App.test.tsx`). The Chromium run
 * itself is owned by the parent, not this author; no browser is launched here.
 *
 * Fixture (mirrors the CA06 `baseScenario`, shifted two quarters): no careers,
 * `0%` account returns, a single `$100` permanent-0% (`zeroInterestCard`)
 * liability, Checking opening `$33.34` and every other account `$0`, one 0% plan
 * that starts `2026-07`, targets `2026-09`, pays on day 1 and funds from Checking,
 * plus one **explicit dated** `$66.66` one-time cashflow inflow into Checking on
 * `2026-09`. No fallback accounts, no expenses, no other obligations.
 *
 * Input-derived cents (hand-computed from the seeded inputs — the report is never
 * imported to derive expected values):
 *   - 2026-07 installment target = ceil(10000 / 3) = 3334 cents ($33.34); the
 *     `$33.34` opening funds it exactly, leaving 6666 cents of debt.
 *   - 2026-08 target = ceil(6666 / 2) = 3333 cents ($33.33); Checking is `$0`, so
 *     the occurrence is unfunded (`shortfall = 3333`), debt retained at 6666.
 *   - 2026-09 target = ceil(6666 / 1) = 6666 cents ($66.66); the dated inflow
 *     deposits 6666 cents first, the final obligation drains it, debt → 0.
 *
 * UI disclosure caveat (stated honestly, never fabricated): `App.tsx` renders the
 * card results as **one aggregated `ReportSchedule` row** plus one
 * `p.warning-error` per unfunded occurrence — there are **no per-month target
 * rows**. So this spec asserts the observable evidence: the single August
 * shortfall warning (pinning the exact month and its exact whole-dollar unpaid
 * amount), exactly one observed September payoff, and the report-backed closing
 * debt. It deliberately does **not** assert the aggregated schedule totals
 * (`requested`/`paid`/`unpaid` across all three months), whose whole-dollar
 * rounding would obscure the per-month cents the engine flow owns.
 *
 * Determinism: a fresh isolated Chromium context with blank localStorage, the
 * clock pinned via `seedScenario` before the first navigation, and role/text
 * locators with Playwright auto-retry — no arbitrary sleeps and never a
 * repeating `addInitScript`.
 */

/**
 * Mirrors `App.tsx`'s whole-dollar USD formatter (`maximumFractionDigits: 0`), so
 * the exact 3333-cent August shortfall ($33.33) surfaces as "$33" — driven by the
 * input-derived cents, not read back from the report.
 */
const appMoney = (cents: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);

/**
 * Mirrors the Timeline `ResultsTable` currency formatter (runtime default locale,
 * two fixed digits) — the view's own formatter, never the report data.
 */
const tableCurrency = (dollars: number): string =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(dollars);

/** One explicit dated inflow into Checking on `2026-09` (never a magic top-up). */
const residualTopUp = (): CashflowItem => ({
  id: 'card-residual-topup',
  category: 'pension_1',
  label: 'Residual top-up',
  enabled: true,
  cadence: 'one_time',
  direction: 'inflow',
  accountId: ACCOUNT_IDS.checking,
  amount: 66.66,
  startAge: 45,
  endAge: 45,
  startYearMonth: '2026-09',
  endYearMonth: '2026-09'
});

/** The shifted CA06 fixture at the helper's fixed reference date (2026-06-15). */
const adaptivePayoffScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.withdrawal = { ...scenario.withdrawal, sourceLines: [], fallbackAccountIds: [] };
  scenario.manualReturns = { ...scenario.manualReturns, inflationEnabled: false, inflationRate: 0 };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: account.id === ACCOUNT_IDS.checking ? 33.34 : 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  scenario.liabilities = [
    { id: 'liab-adaptive', kind: 'zeroInterestCard', label: 'Store card', openingBalance: 100 }
  ];
  scenario.cardPlans = [
    createDefaultZeroInterestCardPlan(FIXED_NOW, {
      id: 'cp-adaptive',
      liabilityId: 'liab-adaptive',
      initialBalance: 100,
      startYearMonth: '2026-07',
      targetYearMonth: '2026-09',
      paymentDay: 1,
      funding: { primaryAccountId: ACCOUNT_IDS.checking, fallbackAccountIds: [] }
    })
  ];
  scenario.cashflowItems = [residualTopUp()];
  return scenario;
};

const resultsTable = (page: Page) =>
  page.getByRole('region', { name: 'Projection results' }).getByRole('table');

/** The body row whose row header is exactly `year`. */
const yearRow = (page: Page, year: string) =>
  resultsTable(page).locator(`tbody tr:has(th[scope="row"]:text-is("${year}"))`);

/** Header index; the matching body `td` sits at `headerIndex - 1` (the row label is a th). */
const headerIndex = async (page: Page, header: string): Promise<number> => {
  const headers = (await resultsTable(page).locator('thead th').allTextContents()).map((text) => text.trim());
  const index = headers.indexOf(header);
  if (index < 0) throw new Error(`Missing table column header "${header}".`);
  return index;
};

test('GUI-A06/G24: an unfunded permanent-0% installment is retained, then a dated September inflow clears the residual in one observed payoff', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, adaptivePayoffScenario());
  await expectCleanSeed(page);

  // --- Expenses → Credit cards: the report-backed schedule + warnings --------
  await mainNav(page).getByRole('button', { name: 'Expenses' }).click();
  await planSections(page).getByRole('button', { name: 'Credit cards' }).click();
  await expect(page.getByRole('heading', { name: 'Card plans' })).toBeVisible();

  const results = page.locator('.card-results');
  await expect(results.getByRole('heading', { name: 'Observed projection results' })).toBeVisible();
  // Real report-backed activity, not the empty-state placeholder.
  await expect(results).not.toContainText('No scheduled card activity appears in this projection.');

  // Exactly one unfunded occurrence: August. July was fully funded, so it must
  // not appear; the exact 3333-cent unpaid principal ($33.33) renders whole-dollar
  // as "$33" — never a fabricated "$0" and never a spread across months.
  const shortfallWarnings = results.locator('p.warning-error');
  await expect(shortfallWarnings).toHaveCount(1);
  await expect(shortfallWarnings.first()).toHaveText(
    `Some scheduled payments could not be fully funded, beginning in 2026-08. Unpaid ${appMoney(3333)}.`
  );

  // No secondary source is configured, so no fallback banner is fabricated.
  await expect(results.locator('p.warning-warning')).toHaveCount(0);

  // Exactly one observed payoff, in September — the coincident final installment
  // issued the single remaining-principal request, so the payoff date records no
  // second debit. The per-month target rows are absent from this disclosure
  // (aggregated schedule + warnings only); the payoff month and the closing debt
  // below are the observable evidence for the September residual.
  const payoffRows = results.locator('p').filter({ hasText: 'payoff' });
  await expect(payoffRows).toHaveCount(1);
  await expect(payoffRows.first()).toContainText('payoff 2026-09');

  // --- D16 selectors: the Warnings tab leads with the August first shortfall ---
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Warnings' }).click();

  const panel = page.locator('.warning-panel');
  await expect(panel.getByRole('heading', { name: 'Plan checks' })).toBeVisible();
  const warningEntry = panel
    .locator('p.warning-error')
    .filter({ hasText: 'Some scheduled payments could not be fully funded, beginning in 2026-08.' });
  await expect(warningEntry).toHaveCount(1);
  await expect(panel.locator('p.warning-error').first()).toContainText(
    'Some scheduled payments could not be fully funded, beginning in 2026-08.'
  );
  // No fallback / exhaustion is invented for a single primary with no fallbacks.
  await expect(panel.locator('p.warning-warning')).toHaveCount(0);
  await expect(panel).not.toContainText('Fallback used');

  // --- Timeline table: the closing debt (and the drained Checking) are $0 -----
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();

  const liabilitiesCol = await headerIndex(page, 'Liabilities');
  const checkingCol = await headerIndex(page, `Account asset: ${ACCOUNT_IDS.checking}`);
  const row2026 = yearRow(page, '2026');
  await expect(row2026).toHaveCount(1);

  // The 2026 close clears the liability exactly (no retained residual) and leaves
  // Checking at $0: the $33.34 opening and the $66.66 dated inflow were each
  // consumed by the adaptive installments, never borrowed or double-debited.
  await expect(row2026.locator('td').nth(liabilitiesCol - 1)).toHaveText(tableCurrency(0));
  await expect(row2026.locator('td').nth(checkingCol - 1)).toHaveText(tableCurrency(0));

  expect(errors).toEqual([]);
});
