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
  seedScenario
} from './fixtures';

/**
 * GUI-A04 / GUI-G17-G18 — the two *unfunded / partial* purchase disclosures that
 * the existing `$200` fully-funded browser flow (`obligations-planner.spec.ts`)
 * does not cover:
 *
 *   1. a one-time `$500` purchase whose explicit eligible primary + fallback both
 *      hold `$0` — a report-backed "Skipped · no funds debited" (D16 shortfall
 *      warning), requested `$500.00`, no committed paid allocations and no
 *      invented `-$500` balance; and
 *   2. a recurring monthly `$100` long-term purchase for two inclusive months
 *      with Checking opening `$150` / `0%` return and no income — the first month
 *      commits the full `$100` and the second only `$50`, leaving a real `$50`
 *      partial shortfall on the `spending:longterm:` disclosure.
 *
 * Honesty note: these are bounded browser flows over canonical v3 bytes seeded by
 * `seedScenario`; they do NOT certify the GUI-A/G or CA matrices — Vitest remains
 * the owner of the per-item engine flows (`src/engine/spending.test.ts`,
 * `src/App.test.tsx`, `src/components/PurchaseFundingResults.test.tsx`).
 *
 * Determinism: each test gets a fresh Chromium context (blank localStorage), the
 * clock is pinned with `page.clock.setFixedTime` before the first navigation, and
 * the seed is written once via `seedScenario` (no repeating `addInitScript`).
 * Selectors are role/heading scoped and waits rely on Playwright auto-retry — no
 * arbitrary sleeps. Every expected value below is hand-computed from the fixture
 * inputs and never read back from the report.
 *
 * Recurrence rule pinned from `src/engine/spending.ts` (owner of the rule): a
 * long-term purchase schedules **one mandatory occurrence per inclusive month**
 * (`startYearMonth` … `startYearMonth + durationMonths − 1`, day-31 clamped to the
 * month end) and each occurrence quotes the **live** account balance at execution
 * time. Two inclusive months with `$150` and no income therefore debit `$100` then
 * `$50` (`src/engine/spending.test.ts` "executes one mandatory payment per
 * inclusive month").
 */

/** Fresh canonical scenario at the helper's fixed reference date. */
const scenarioWith = (mutate: (scenario: Scenario) => void): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  mutate(scenario);
  return scenario;
};

const openPurchasesAndExpenses = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Purchases & expenses' }).click();
};

/**
 * GUI-A04 / D16 fixture: a `$500` one-time purchase with an explicit eligible
 * primary (`Checking`) and fallback (`Emergency Fund`), both opening at `$0` and
 * `0%` return; no income and no other obligation. The global funding policy names
 * the eligible order explicitly, so the panel must show `Checking → Emergency Fund`
 * rather than the `'income'`-unresolved "No eligible accounts" case.
 */
const zeroFundPurchaseScenario = (): Scenario =>
  scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };
    next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
      ...account,
      openingBalance: 0,
      annualReturnRate: 0
    }));
    next.fundingPolicy = {
      primaryAccountId: ACCOUNT_IDS.checking,
      fallbackAccountIds: [ACCOUNT_IDS.emergencyFund]
    };
    next.largePurchases = [
      {
        id: 'purchase-zero-fund',
        label: 'Zero-fund purchase',
        enabled: true,
        showOnGraph: true,
        flagColor: '#abc',
        yearMonth: '2026-07',
        age: 40,
        amount: 500,
        categoryId: null
      }
    ];
  });

/**
 * GUI-G17/G18 fixture: a `$100`-monthly long-term purchase for two inclusive
 * months (2026-07, 2026-08) funded explicitly from `Checking` (`account:checking`,
 * no per-line quotas), which opens at `$150` with `0%` return and no income.
 * Hand-computed: July requests `$100` and commits `$100` (balance `$50`); August
 * requests `$100` but only `$50` is available, so it commits `$50` with a `$50`
 * shortfall — the per-occurrence live-balance behavior owned by `spending.ts`.
 */
const longTermPartialScenario = (): Scenario =>
  scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };
    next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
      ...account,
      openingBalance: account.id === ACCOUNT_IDS.checking ? 150 : 0,
      annualReturnRate: 0
    }));
    next.longTermPurchases = [
      {
        id: 'longterm-partial',
        label: 'Two-month plan',
        enabled: true,
        showOnGraph: true,
        flagColor: '#abc',
        startYearMonth: '2026-07',
        endMode: 'duration',
        durationMonths: 2,
        endYearMonth: '',
        monthlyAmount: 100,
        sourceLines: [],
        fundingSource: `account:${ACCOUNT_IDS.checking}`
      }
    ];
  });

test('GUI-A04/D16: a $500 purchase from two $0 eligible accounts skips with no funds debited and no phantom negative', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, zeroFundPurchaseScenario());
  await expectCleanSeed(page);

  await openPurchasesAndExpenses(page);

  // The one-time purchase is the only seeded purchase, so its disclosure region
  // is unambiguous; the region carries the report-backed outcome for its id.
  const region = page.getByRole('region', { name: 'Observed purchase funding' });
  await expect(region).toBeVisible();

  const summary = region.locator('summary');
  await expect(summary).toHaveCount(1);
  // Zero-debit outcome: the report marks it skipped, not a fabricated debit.
  await expect(summary).toContainText('Skipped · no funds debited · 2026-07');
  await expect(summary).toHaveClass(/purchase-funding__shortfall/);
  // Requested $500 (input-derived), no debit posted, full $500 shortfall.
  await expect(summary).toContainText('Requested $500.00 · no debit posted · shortfall $500.00');

  await summary.click();

  // Explicit eligible order from the configured global policy — both accounts at $0.
  await expect(region.locator('p', { hasText: 'Eligible account order at quote:' })).toContainText(
    'Checking → Emergency Fund'
  );
  await expect(region.getByText(/Skipped or unfunded/)).toBeVisible();
  await expect(region.getByText(/No account debit was committed/)).toBeVisible();

  // No committed paid allocations exist for a skipped purchase.
  await expect(region.locator('li')).toHaveCount(0);

  // The unchanged $0 accounts must never be shown as an invented -$500 balance.
  await expect(region).not.toContainText('-$');
  await expect(region).not.toContainText('-$500');

  // D16: the completeness-shortfall selector leads the Warnings tab as an error.
  await planSections(page).getByRole('button', { name: 'Warnings' }).click();
  const panel = page.locator('.warning-panel');
  await expect(panel.getByRole('heading', { name: 'Plan checks' })).toBeVisible();
  const shortfallEntry = panel
    .locator('p.warning-error')
    .filter({ hasText: 'Some scheduled payments could not be fully funded, beginning in 2026-07.' });
  await expect(shortfallEntry).toHaveCount(1);
  await expect(shortfallEntry).toContainText('Needs attention');

  expect(errors).toEqual([]);
});

test('GUI-G17/G18: a two-month $100 long-term plan over $150 debits $100 then $50 and reports the $50 partial shortfall', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, longTermPartialScenario());
  await expectCleanSeed(page);

  await openPurchasesAndExpenses(page);

  // The recurring purchase is the only seeded purchase, so the disclosure region
  // for the `spending:longterm:<id>` definition is unambiguous.
  const region = page.getByRole('region', { name: 'Observed purchase funding' });
  await expect(region).toBeVisible();

  // One occurrence per inclusive month: 2026-07 fully funded, 2026-08 partial.
  await expect(region.locator('summary')).toHaveCount(2);

  const july = region.locator('details').filter({ hasText: 'Funded · 2026-07' });
  const august = region.locator('details').filter({ hasText: 'Partly funded · 2026-08' });

  // July: requested $100, executed $100, no shortfall.
  await expect(july.locator('summary')).toContainText('Requested $100.00 · executed $100.00 · shortfall $0.00');
  await expect(july.locator('li')).toHaveCount(1);
  await expect(july.locator('li').first()).toContainText('Checking · net $100.00 · gross $100.00 · tax $0.00 · penalty $0.00');

  // August: requested $100, executed $50, shortfall $50 (live balance after July).
  await expect(august.locator('summary')).toContainText('Requested $100.00 · executed $50.00 · shortfall $50.00');
  await expect(august.locator('summary')).toHaveClass(/purchase-funding__shortfall/);
  await august.locator('summary').click();
  await expect(august.locator('li')).toHaveCount(1);
  await expect(august.locator('li').first()).toContainText('Checking · net $50.00 · gross $50.00 · tax $0.00 · penalty $0.00');
  await expect(august).toContainText('Unfunded $50.00; no further debit was made.');

  // Explicit single source: the quote-time eligible order is Checking alone.
  await expect(region.locator('p', { hasText: 'Eligible account order at quote:' }).first()).toContainText('Checking');

  // D16: the first shortfall month is August; eligible exhaustion may coexist.
  await planSections(page).getByRole('button', { name: 'Warnings' }).click();
  const panel = page.locator('.warning-panel');
  await expect(panel.locator('p.warning-error').first()).toContainText(
    'Some scheduled payments could not be fully funded, beginning in 2026-08.'
  );

  expect(errors).toEqual([]);
});
