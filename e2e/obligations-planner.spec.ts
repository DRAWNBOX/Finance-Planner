import { test, expect, type Page } from '@playwright/test';
import type { ExpenseEntry, Scenario } from '../src/types';
import { createDefaultRentalEntry } from '../src/defaultScenario';
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
 * Bounded Chromium flows for the observed obligation/planner report panels
 * (GUI-A04 purchase funding, GUI-A07 selected-account weekly planner summary,
 * GUI-A05 property-free rental results).
 *
 * Honesty note: these are bounded browser flows over canonical v3 bytes seeded
 * via `seedScenario`; they do NOT certify the GUI-A/G or CA matrices — Vitest
 * remains the owner of those per-item engine flows.
 *
 * Determinism:
 * - Every test runs in a fresh Playwright context (blank localStorage), the
 *   clock is pinned with `page.clock.setFixedTime` before the first navigation,
 *   and the seed is written once via `seedScenario` (no repeating
 *   `addInitScript`). Selectors use role/heading/region. No arbitrary sleeps.
 * - All expected values are hand-computed from the fixtures below (never read
 *   back from report output): $200 purchase = $100 Checking + $60 Emergency
 *   Fund + $40 Investments; planner week = $10 Emergency Fund + $15 Checking;
 *   one-month rent = $1500 Checking debit.
 */

/** Fresh canonical scenario at the helper's fixed reference date. */
const scenarioWith = (mutate: (scenario: Scenario) => void): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  mutate(scenario);
  return scenario;
};

/** The local-noon clock for the planner week (matches the Vitest fixed-date fixture). */
const PLANNER_NOW = new Date(2026, 9, 14, 12, 0, 0); // Wed 2026-10-14

const openFinancesSection = async (page: Page, section: string): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: section }).click();
};

test('GUI-A04: a $200 purchase debits the global primary and two ordered fallbacks with no shortfall or phantom negative', async ({ page }) => {
  const errors = collectErrors(page);

  const scenario = scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };
    next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
      ...account,
      openingBalance:
        account.id === ACCOUNT_IDS.checking
          ? 100
          : account.id === ACCOUNT_IDS.emergencyFund
            ? 60
            : account.id === ACCOUNT_IDS.investments
              ? 40
              : 0,
      capitalGainsTaxRate: 0
    }));
    next.fundingPolicy = {
      primaryAccountId: ACCOUNT_IDS.checking,
      fallbackAccountIds: [ACCOUNT_IDS.emergencyFund, ACCOUNT_IDS.investments]
    };
    next.largePurchases = [
      {
        id: 'purchase-three-sources',
        label: 'Three-source purchase',
        enabled: true,
        showOnGraph: true,
        flagColor: '#abc',
        yearMonth: '2026-07',
        age: 40,
        amount: 200,
        fundingSource: undefined,
        categoryId: null
      }
    ];
  });

  await seedScenario(page, scenario);
  await expectCleanSeed(page);

  await openFinancesSection(page, 'Purchases & expenses');

  const region = page.getByRole('region', { name: 'Observed purchase funding' });
  await expect(region).toBeVisible();

  // Hand-computed: $200 fully executed across the three configured sources.
  const summary = region.locator('summary');
  await expect(summary).toContainText('Funded · 2026-07');
  await expect(summary).toContainText('Requested $200.00 · executed $200.00 · shortfall $0.00');

  // Expand the observed detail.
  await summary.click();

  await expect(region.locator('p', { hasText: 'Eligible account order at quote:' })).toContainText(
    'Checking → Emergency Fund → Investments'
  );

  // Three committed net/gross allocations: $100 + $60 + $40 = $200, 0% rates.
  const allocations = region.locator('li');
  await expect(allocations).toHaveCount(3);
  await expect(allocations.nth(0)).toContainText('Checking · net $100.00 · gross $100.00 · tax $0.00 · penalty $0.00');
  await expect(allocations.nth(1)).toContainText('Emergency Fund · net $60.00 · gross $60.00');
  await expect(allocations.nth(2)).toContainText('Investments · net $40.00 · gross $40.00');

  // Only the two sources drawn beyond the configured primary are badged.
  await expect(region.getByText('Fallback used', { exact: true })).toHaveCount(2);

  // No shortfall and no phantom negative balance is invented.
  await expect(region).not.toContainText('Unfunded');
  await expect(region).not.toContainText('-$');
  await expect(region).not.toContainText('Skipped · no funds debited');

  expect(errors).toEqual([]);
});

test('GUI-A07: the selected-account weekly planner summary reports requested/paid/selected from the real report and excludes occurred imports', async ({ page }) => {
  const errors = collectErrors(page);

  // Explicit ordered source: Emergency Fund ($10) primary, Checking ($15) fallback.
  const plannedEntry: ExpenseEntry = {
    id: 'plan-week-25',
    label: 'Week groceries',
    amount: 25,
    startDate: '2026-10-14',
    endDate: '2026-10-14',
    accountId: ACCOUNT_IDS.checking,
    notes: '',
    originType: 'manual',
    importSourceId: null,
    importBatchId: null,
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
    categoryId: 'food',
    provenance: 'planner',
    planningStatus: 'planned',
    fundingSource: `account:${ACCOUNT_IDS.emergencyFund}`
  };
  const occurredEntry: ExpenseEntry = {
    id: 'imp-week-99',
    label: 'Imported meal',
    amount: 99,
    startDate: '2026-10-13',
    endDate: '2026-10-13',
    accountId: ACCOUNT_IDS.checking,
    notes: '',
    originType: 'imported',
    importSourceId: 'src',
    importBatchId: 'batch',
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
    categoryId: 'food',
    provenance: 'imported',
    planningStatus: 'occurred',
    sourceDate: '2026-10-13',
    sourceSign: 'debit',
    asOf: '2026-10-20'
  };

  const scenario = scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };
    // 0% growth: Checking $100, Emergency Fund $10, else $0.
    next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
      ...account,
      openingBalance: account.id === ACCOUNT_IDS.checking ? 100 : account.id === ACCOUNT_IDS.emergencyFund ? 10 : 0
    }));
    next.expenses = {
      ...next.expenses,
      activePlanningAccountId: ACCOUNT_IDS.checking,
      categoriesByAccountId: { [ACCOUNT_IDS.checking]: [{ id: 'food', label: 'Food' }] },
      entries: [plannedEntry, occurredEntry]
    };
  });

  // The engine start date stays 2026-06-15 (scenario `asOfDate`); the planner
  // week follows the pinned UI clock at local noon Wed 2026-10-14.
  await seedScenario(page, scenario, PLANNER_NOW);
  await expectCleanSeed(page);

  await mainNav(page).getByRole('button', { name: 'Expenses' }).click();
  await expect(page.getByRole('heading', { name: 'Plan expenses by account' })).toBeVisible();

  const outcomesRegion = page.getByRole('region', { name: 'This week observed planner outcomes' });
  await expect(outcomesRegion).toContainText('2026-10-11 – 2026-10-17');

  // Hand-computed anchors: $25.00 requested, $25.00 paid across all accounts,
  // $15.00 paid from the selected Checking account, Checking close $85.00.
  const stat = (label: string) =>
    outcomesRegion.locator('dl > div').filter({ hasText: label }).locator('dd');
  await expect(stat('Requested')).toHaveText('$25.00');
  await expect(stat('Paid · all accounts')).toHaveText('$25.00');
  await expect(stat('Paid from selected account')).toHaveText('$15.00');

  // The honest copy: a scheduled outcome summary, not a weekly balance forecast.
  await expect(outcomesRegion).toContainText('not a weekly balance forecast');
  await expect(outcomesRegion).toContainText('Occurred imports are excluded');
  // The occurred $99 sibling never joins the scheduled summary.
  await expect(outcomesRegion).not.toContainText('$99.00');

  const balanceRegion = page.getByRole('region', { name: 'Monthly funded balance' });
  const octoberRow = balanceRegion.locator('li').filter({ hasText: 'Oct 2026' });
  await expect(octoberRow).toContainText('$85.00');

  // The occurred import stays visible and view-only.
  await expect(page.getByText('Imported meal')).toBeVisible();
  await expect(page.getByText('Occurred · view only')).toBeVisible();

  expect(errors).toEqual([]);
});

test('GUI-A05: a property-free rental funds its one-month rent from the configured account, not a config placeholder', async ({ page }) => {
  const errors = collectErrors(page);

  const scenario = scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };
    next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
      ...account,
      openingBalance: account.id === ACCOUNT_IDS.checking ? 1500 : 0
    }));
    // A standalone rental with a single-month inclusive range: exactly one $1,500
    // rent occurrence, funded from Checking. Zero ancillary groups so the report
    // table carries only the real rent obligation.
    next.housing = [
      {
        ...createDefaultRentalEntry(next.profile.currentAge, next.options.dateOfBirth, FIXED_NOW),
        id: 'apartment-rental',
        label: 'Apartment',
        startYearMonth: '2026-07',
        endYearMonth: '2026-07',
        monthlyRent: 1500,
        propertyTaxYearly: 0,
        homeInsuranceYearly: 0,
        hoaMonthly: 0,
        maintenanceMonthly: 0,
        rentalIncomeMonthly: 0,
        paymentSource: `account:${ACCOUNT_IDS.checking}`
      }
    ];
  });

  await seedScenario(page, scenario);
  await expectCleanSeed(page);

  await openFinancesSection(page, 'Housing');

  const region = page.getByRole('region', { name: 'Apartment results' });
  await expect(region).toBeVisible();

  // Property-free: no fabricated property/debt placeholder, only the rent note.
  await expect(region).toContainText('Rental costs are included below. This rental has no linked property or mortgage.');
  await expect(region).not.toContainText('No housing obligations were observed in this projection window.');

  // The observed obligations table carries the real one-month rent debit
  // (requested $1,500.00 / paid $1,500.00 / unpaid $0.00) from the report.
  const obligations = region.getByRole('table', { name: 'Observed housing obligations' });
  await expect(obligations).toBeVisible();
  const rentRow = obligations.locator('tbody tr').filter({ hasText: 'Rent' });
  await expect(rentRow).toHaveCount(1);
  await expect(rentRow.locator('td').nth(0)).toHaveText('$1,500.00');
  await expect(rentRow.locator('td').nth(1)).toHaveText('$1,500.00');
  await expect(rentRow.locator('td').nth(2)).toHaveText('$0.00');

  // Fully funded: no shortfall warning.
  await expect(region).not.toContainText('Some housing costs were only partly paid');

  expect(errors).toEqual([]);
});
