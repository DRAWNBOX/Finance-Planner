import { test, expect, type Page } from '@playwright/test';
import type { Scenario } from '../src/types';
import { createDefaultAccount } from '../src/defaultScenario';
import {
  ACCOUNT_IDS,
  FIXED_NOW,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  planSections,
  readStoredBytes,
  seedScenario
} from './fixtures';

/**
 * Bounded real-Chromium GUI-A04/G14 ordered-fallback UI branch.
 *
 * Honesty note: this drives the real Net Worth `AccountManagementEditor`'s shared
 * `FundingPolicyEditor` (`Funding accounts` region: Move up/down, Remove, Add
 * fallback) and the real Purchases & expenses `PurchaseFundingResults` read-only
 * region, over canonical v3 bytes seeded through the app's own codec via
 * `seedScenario`. It does NOT certify the GUI-A01–A10/G01–G40 or CA01–CA13
 * matrices; Vitest remains the owner of the per-item engine flows
 * (`src/engine/funding.test.ts`, `src/components/FundingPolicyEditor.test.tsx`,
 * `src/App.test.tsx`).
 *
 * Determinism:
 * - Fresh isolated Chromium context per test; the clock is pinned before the
 *   first navigation by `seedScenario` and the seed is written once (no
 *   repeating `addInitScript`). Every wait is a web-first assertion — no
 *   arbitrary sleeps.
 * - No projection/report import and no report-derived money value: the only
 *   money asserted is hand-computed from the literal opening balances below
 *   ($0 + $60 + $40 + $30) at 0% return / 0% withholding.
 *
 * Eligibility note (owner: `src/engine/taxes.ts`): an HSA is eligible but is
 * *penalised* (20% non-qualified before age 65), and a 401(k) is retirement
 * income; to keep the hand-calculation exact, the third fallback is a fresh
 * `savings` account seeded through the canonical `createDefaultAccount` factory
 * rather than the HSA or 401(k). All three fallbacks are then eligible
 * (`checking`/`savings`/`taxable`) with 0% withholding and 0% return.
 */

/** Extra eligible fallback account (savings → tax-exempt, no penalty). */
const EXTRA_SAVINGS_ID = 'savings-account-default';

/** Fresh canonical scenario at the helper's fixed reference date. */
const scenarioWith = (mutate: (scenario: Scenario) => void): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  mutate(scenario);
  return scenario;
};

/**
 * One-time `$100` purchase (2026-07) with **no** `fundingSource`/`sourceLines`,
 * so the actual draw is decided by the global ordered policy alone. The global
 * policy is primary `Checking` ($0) with three distinct eligible fallbacks in
 * seed order: `Emergency Fund` ($60), `Savings` ($40), `Investments` ($30);
 * careers are disabled (no income) and every rate is 0%.
 */
const fundingOrderScenario = (): Scenario =>
  scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };

    const extraSavings = createDefaultAccount({
      id: EXTRA_SAVINGS_ID,
      label: 'Savings',
      accountType: 'savings',
      openingBalance: 40,
      annualReturnRate: 0,
      displayOrder: 5
    });

    next.netWorth.accounts = [
      ...next.netWorth.accounts.map((account) => ({
        ...account,
        annualReturnRate: 0,
        retirementAnnualReturnRate: null,
        capitalGainsTaxRate: 0,
        openingBalance:
          account.id === ACCOUNT_IDS.checking
            ? 0
            : account.id === ACCOUNT_IDS.emergencyFund
              ? 60
              : account.id === ACCOUNT_IDS.investments
                ? 30
                : 0
      })),
      extraSavings
    ];

    next.fundingPolicy = {
      primaryAccountId: ACCOUNT_IDS.checking,
      fallbackAccountIds: [ACCOUNT_IDS.emergencyFund, EXTRA_SAVINGS_ID, ACCOUNT_IDS.investments]
    };

    next.largePurchases = [
      {
        id: 'purchase-order-100',
        label: 'Ordered purchase',
        enabled: true,
        showOnGraph: true,
        flagColor: '#abc',
        yearMonth: '2026-07',
        age: 40,
        amount: 100,
        categoryId: null
      }
    ];
  });

const openAccounts = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts & funding' })).toBeVisible();
};

const openPurchasesAndExpenses = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Purchases & expenses' }).click();
};

/** The global funding order editor on the Net Worth tab. */
const fundingOrder = (page: Page) => page.getByRole('region', { name: 'Funding accounts' });

const purchaseRegion = (page: Page) => page.getByRole('region', { name: 'Observed purchase funding' });

const purchaseDetails = (page: Page) => purchaseRegion(page).locator('details').first();

/** Expand the single purchase's disclosure and return its committed allocation rows. */
const expandedAllocations = async (page: Page) => {
  const details = purchaseDetails(page);
  await expect(details).toBeVisible();
  await details.locator('summary').click();
  return details.locator('li');
};

/** The persisted scenario half of the app's v3 envelope (read-only). */
const readStoredScenario = async (page: Page): Promise<Scenario> => {
  const raw = (await readStoredBytes(page)) as string;
  return (JSON.parse(raw) as { scenario: Scenario }).scenario;
};

/** The option values currently offered by the `Add fallback` picker (placeholder dropped). */
const addFallbackOptionValues = async (page: Page): Promise<string[]> =>
  (await fundingOrder(page).getByLabel('Add fallback').locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value)
  )).filter(Boolean);

test('GUI-A04/G14: reordering the global funding fallbacks through the Funding accounts editor changes the real purchase draw order, persists on pagehide/reload, and reports a D16 fallback', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, fundingOrderScenario());
  await expectCleanSeed(page);

  // Baseline: the actual draw follows the seeded fallback order — the empty
  // primary is skipped, then Emergency Fund $60 and Savings $40 complete $100.
  await openPurchasesAndExpenses(page);
  const baseline = await expandedAllocations(page);
  await expect(purchaseDetails(page).locator('summary')).toContainText(
    'Requested $100.00 · executed $100.00 · shortfall $0.00'
  );
  await expect(baseline).toHaveCount(2);
  await expect(baseline.nth(0)).toContainText('Emergency Fund · net $60.00 · gross $60.00 · tax $0.00 · penalty $0.00');
  await expect(baseline.nth(1)).toContainText('Savings · net $40.00 · gross $40.00 · tax $0.00 · penalty $0.00');

  // Real user interaction: the Net Worth Funding accounts editor shows the
  // seeded order and swaps the two fallbacks with the existing Move up control.
  await openAccounts(page);
  const order = fundingOrder(page);
  await expect(order.getByLabel('Primary account', { exact: true })).toHaveValue(ACCOUNT_IDS.checking);
  await expect(order.getByLabel('Fallback 1', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);
  await expect(order.getByLabel('Fallback 2', { exact: true })).toHaveValue(EXTRA_SAVINGS_ID);
  await expect(order.getByLabel('Fallback 3', { exact: true })).toHaveValue(ACCOUNT_IDS.investments);

  await order.getByRole('button', { name: 'Move Fallback 2 up', exact: true }).click();

  await expect(order.getByLabel('Fallback 1', { exact: true })).toHaveValue(EXTRA_SAVINGS_ID);
  await expect(order.getByLabel('Fallback 2', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);
  await expect(order.getByLabel('Fallback 3', { exact: true })).toHaveValue(ACCOUNT_IDS.investments);

  // The reordered draw: primary empty, then Savings $40 and Emergency Fund $60.
  await openPurchasesAndExpenses(page);
  const reordered = await expandedAllocations(page);
  await expect(purchaseDetails(page).locator('summary')).toContainText('Funded · 2026-07');
  await expect(purchaseDetails(page).locator('summary')).toContainText(
    'Requested $100.00 · executed $100.00 · shortfall $0.00'
  );
  await expect(reordered).toHaveCount(2);
  await expect(reordered.nth(0)).toContainText('Savings · net $40.00 · gross $40.00 · tax $0.00 · penalty $0.00');
  await expect(reordered.nth(1)).toContainText(
    'Emergency Fund · net $60.00 · gross $60.00 · tax $0.00 · penalty $0.00'
  );

  // Quote-time eligible order follows the edited policy (primary first).
  await expect(purchaseDetails(page).locator('p', { hasText: 'Eligible account order at quote:' })).toContainText(
    'Checking → Savings → Emergency Fund → Investments'
  );

  // No duplicate/self-source: each account is allocated at most once and the
  // configured primary (which drew $0) is never duplicated as a fallback.
  const allocatedLabels = await reordered.locator('strong').allTextContents();
  expect(new Set(allocatedLabels).size).toBe(allocatedLabels.length);
  await expect(reordered.filter({ hasText: 'Checking' })).toHaveCount(0);
  // The two non-primary sources were actually drawn from → exactly two D16 badges.
  await expect(purchaseDetails(page).getByText('Fallback used', { exact: true })).toHaveCount(2);

  // D16 selector: the Warnings tab leads with the fallback warning and no shortfall.
  await planSections(page).getByRole('button', { name: 'Warnings' }).click();
  const panel = page.locator('.warning-panel');
  await expect(panel.getByRole('heading', { name: 'Plan checks' })).toBeVisible();
  await expect(
    panel.locator('p.warning-warning').filter({ hasText: 'Funding fell back to a secondary source — 2026-07.' })
  ).toHaveCount(1);
  await expect(panel.locator('p.warning-error')).toHaveCount(0);
  await expect(panel).not.toContainText('Some scheduled payments could not be fully funded');

  // pagehide flushes the debounced autosave: the persisted order is the edited one.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const stored = await readStoredScenario(page);
  expect(stored.fundingPolicy?.primaryAccountId).toBe(ACCOUNT_IDS.checking);
  expect(stored.fundingPolicy?.fallbackAccountIds).toEqual([
    EXTRA_SAVINGS_ID,
    ACCOUNT_IDS.emergencyFund,
    ACCOUNT_IDS.investments
  ]);
  expect(stored.fundingPolicy?.fallbackAccountIds).not.toContain(ACCOUNT_IDS.checking);

  // The edited order and its observed draw survive a reload of those bytes.
  await page.reload();
  await expectCleanSeed(page);
  await openAccounts(page);
  const reloaded = fundingOrder(page);
  await expect(reloaded.getByLabel('Fallback 1', { exact: true })).toHaveValue(EXTRA_SAVINGS_ID);
  await expect(reloaded.getByLabel('Fallback 2', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);
  await expect(reloaded.getByLabel('Fallback 3', { exact: true })).toHaveValue(ACCOUNT_IDS.investments);

  await openPurchasesAndExpenses(page);
  const afterReload = await expandedAllocations(page);
  await expect(afterReload).toHaveCount(2);
  await expect(afterReload.nth(0)).toContainText('Savings · net $40.00 · gross $40.00');
  await expect(afterReload.nth(1)).toContainText('Emergency Fund · net $60.00 · gross $60.00');

  expect(errors).toEqual([]);
});

test('GUI-A04/G14: removing and re-adding a fallback keeps the ordered funding list deduplicated with no hidden sweep', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, fundingOrderScenario());
  await expectCleanSeed(page);

  await openAccounts(page);
  const order = fundingOrder(page);
  await expect(order.getByLabel('Fallback 1', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);
  await expect(order.getByLabel('Fallback 2', { exact: true })).toHaveValue(EXTRA_SAVINGS_ID);
  await expect(order.getByLabel('Fallback 3', { exact: true })).toHaveValue(ACCOUNT_IDS.investments);

  // Dedup at the source: the Add fallback picker only offers accounts not
  // already in the order (the chosen fallbacks are never re-selectable).
  expect(await addFallbackOptionValues(page)).toEqual([ACCOUNT_IDS.hsa, ACCOUNT_IDS.retirement401k]);

  // Chosen fallbacks are also disabled inside the primary selector, so no
  // duplicate/self-source reference can be created there either.
  const disabledPrimaryValues = await order
    .getByLabel('Primary account', { exact: true })
    .locator('option')
    .evaluateAll((options) =>
      options.filter((option) => (option as HTMLOptionElement).disabled).map((option) => (option as HTMLOptionElement).value)
    );
  expect(disabledPrimaryValues).toEqual(
    expect.arrayContaining([ACCOUNT_IDS.emergencyFund, EXTRA_SAVINGS_ID, ACCOUNT_IDS.investments])
  );

  // Remove the third fallback through the real control.
  await order.getByRole('button', { name: 'Remove Fallback 3', exact: true }).click();
  await expect(order.getByLabel('Fallback 3', { exact: true })).toHaveCount(0);
  await expect(order.getByLabel('Fallback 1', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);
  await expect(order.getByLabel('Fallback 2', { exact: true })).toHaveValue(EXTRA_SAVINGS_ID);

  // No hidden sweep: removal leaves an explicit two-item order and the removed
  // account is not silently re-inserted or swapped away.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  let stored = await readStoredScenario(page);
  expect(stored.fundingPolicy?.fallbackAccountIds).toEqual([ACCOUNT_IDS.emergencyFund, EXTRA_SAVINGS_ID]);

  // The removed account is offered again; the still-chosen ones remain excluded.
  expect(await addFallbackOptionValues(page)).toEqual([
    ACCOUNT_IDS.hsa,
    ACCOUNT_IDS.investments,
    ACCOUNT_IDS.retirement401k
  ]);

  // Re-add it; it appends at the end (positional order is preserved, no sweep).
  await order.getByLabel('Add fallback').selectOption(ACCOUNT_IDS.investments);
  await expect(order.getByLabel('Fallback 1', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);
  await expect(order.getByLabel('Fallback 2', { exact: true })).toHaveValue(EXTRA_SAVINGS_ID);
  await expect(order.getByLabel('Fallback 3', { exact: true })).toHaveValue(ACCOUNT_IDS.investments);
  // Dedup holds after the round trip: the picker excludes every chosen account.
  expect(await addFallbackOptionValues(page)).toEqual([ACCOUNT_IDS.hsa, ACCOUNT_IDS.retirement401k]);

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  stored = await readStoredScenario(page);
  expect(stored.fundingPolicy?.primaryAccountId).toBe(ACCOUNT_IDS.checking);
  expect(stored.fundingPolicy?.fallbackAccountIds).toEqual([
    ACCOUNT_IDS.emergencyFund,
    EXTRA_SAVINGS_ID,
    ACCOUNT_IDS.investments
  ]);

  expect(errors).toEqual([]);
});
