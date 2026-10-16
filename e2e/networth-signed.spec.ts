import { test, expect, type Page } from '@playwright/test';
import type { Scenario } from '../src/types';
import {
  FIXED_NOW,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  planSections,
  seedScenario
} from './fixtures';

/**
 * GUI-A08 — browser signed-net-worth branch (the case the prior
 * `display-consistency.spec.ts` fixture could not cover, because it carried no
 * liability).
 *
 * One canonical scenario is seeded with all accounts at $0 and a single
 * configured opening liability of $100 at 0% with no scheduled payments. With no
 * income/career, no account growth and no loan config (`scenario.loans` is
 * empty, and loans are only scheduled from `context.domains.loans`), the
 * liability is stable opening debt: the signed report net worth must be exactly
 * −$100.00 while account assets are exactly $0.00 across the whole horizon.
 *
 * Honesty note: this drives the real app over canonical v3 bytes seeded with
 * `seedScenario`; it does NOT certify the GUI-A/G or CA matrices. Every expected
 * value is literal configuration (`openingBalance: 100` dollars, other accounts
 * `0`); this spec never imports the projection/report and never re-runs funding.
 *
 * Determinism:
 * - Fresh isolated Chromium context (blank localStorage, no real profile); the
 *   clock is pinned by `seedScenario` before the first navigation.
 * - No arbitrary sleeps; every wait is a web-first assertion.
 */

const LIABILITY_DOLLARS = 100;

/**
 * Fresh canonical scenario at the helper's fixed reference date: no income, no
 * account assets, one stable 0% opening liability. The five canonical accounts
 * are kept (the withdrawal plan references the 401k id) but all open at $0.
 */
const signedLiabilityScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.manualReturns = { ...scenario.manualReturns, inflationEnabled: false, inflationRate: 0 };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  // One valid configured opening liability: persisted dollars, 0% rate, and no
  // payment schedule (no `scenario.loans` entry links it). `openingBalance` is
  // dollars per `src/types.ts` (`LiabilityDefinition`), so this is exactly $100.
  scenario.liabilities = [
    {
      id: 'e2e-opening-liability',
      kind: 'loan',
      label: 'E2E opening liability',
      openingBalance: LIABILITY_DOLLARS,
      annualInterestRate: 0,
      minimumMonthlyPayment: 0
    }
  ];
  return scenario;
};

const openTimeline = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
};

const resultsTable = (page: Page) => page.getByRole('region', { name: 'Projection results' }).getByRole('table');

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

// Locale formatters mirroring the exact ones owned by each view (never the
// report data): the table uses the runtime default locale with 2 digits; the
// chart hard-codes `en-US` with 0 digits.
const tableCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
const chartCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

test('GUI-A08 signed net worth: a $100 configured opening liability keeps the table signed net worth negative while the chart account-assets measure reads 0', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, signedLiabilityScenario());
  await expectCleanSeed(page);
  await openTimeline(page);

  const closingCol = await headerIndex(page, 'Closing net worth');
  const assetsCol = await headerIndex(page, 'Assets');
  const closingCell = (table: ReturnType<typeof resultsTable>) => table.locator('td').nth(closingCol - 1);
  const assetsCell = (table: ReturnType<typeof resultsTable>) => table.locator('td').nth(assetsCol - 1);

  // Signed report-backed table values, literal from config: net worth = 0 − 100.
  await expect(closingCell(yearRow(page, '2026'))).toHaveText(tableCurrency(-LIABILITY_DOLLARS));
  await expect(assetsCell(yearRow(page, '2026'))).toHaveText(tableCurrency(0));

  // Stability: no schedule and a 0% rate mean the liability never moves, so the
  // signed net worth is still −$100.00 at 2027 and at the final horizon row.
  await expect(closingCell(yearRow(page, '2027'))).toHaveText(tableCurrency(-LIABILITY_DOLLARS));
  await expect(closingCell(resultsTable(page).locator('tbody tr').last())).toHaveText(tableCurrency(-LIABILITY_DOLLARS));

  const chartRegion = page.getByRole('region', { name: 'Projection chart' });
  const key = chartRegion.locator('.report-chart__key');
  const chartSvg = chartRegion.getByRole('img', { name: /and total debt by month/ });

  // Default measure is signed net worth: the label is "Net worth" and the
  // tooltip value stays strictly negative.
  await expect(chartSvg).toBeVisible();
  await expect(key).toContainText('Net worth');
  await chartSvg.press('ArrowLeft'); // index 0 → 2026-06 close
  await expect(chartRegion.locator('.chart-tooltip')).toContainText(`Net worth: ${chartCurrency(-LIABILITY_DOLLARS)}`);
  await expect(chartRegion.locator('.chart-tooltip')).toContainText(`Total debt: ${chartCurrency(LIABILITY_DOLLARS)}`);

  // Switch the chart measurement to account assets: the chart reads $0 while the
  // table keeps the signed net-worth column at −$100.00.
  await page.locator('.report-controls select').selectOption({ label: 'Account assets' });

  await expect(chartRegion.getByRole('img', { name: 'Account assets and total debt by month' })).toBeVisible();
  await expect(key).toContainText('Account assets');
  await expect(key).not.toContainText('Net worth');
  await chartSvg.press('ArrowLeft');
  await expect(chartRegion.locator('.chart-tooltip')).toContainText(`Account assets: ${chartCurrency(0)}`);

  // The table is not affected by the chart measure selector: it still reports the
  // signed net worth and the $0 account assets.
  await expect(closingCell(yearRow(page, '2026'))).toHaveText(tableCurrency(-LIABILITY_DOLLARS));
  await expect(assetsCell(yearRow(page, '2026'))).toHaveText(tableCurrency(0));

  expect(errors).toEqual([]);
});
