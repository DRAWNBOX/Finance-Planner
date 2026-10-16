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
 * GUI-A08 — browser display-consistency over one fixed, hand-computable scenario.
 *
 * One canonical scenario is seeded (exactly one $1,000 account opening, no
 * income/career, 0% account growth, 6% inflation) and projected once, then read
 * through the three display paths — the projection chart, the stacked account
 * series and the results table — under the shared "Display values in today's
 * dollars" toggle.
 *
 * Honesty note: this drives the real app over canonical v3 bytes seeded with
 * `seedScenario`; it does NOT certify the GUI-A/G or CA matrices. The exact
 * three-view **cents** equality and the signed-vs-account distinction with a real
 * liability remain owned by the RTL `ReportDisplayConsistency` suite. This spec
 * asserts the browser-level boundaries and the shared toggle behaviour.
 *
 * Determinism:
 * - Fresh isolated Chromium context per test (blank localStorage, no real
 *   profile); the clock is pinned by `seedScenario` before the first navigation.
 * - Every expected value is hand-computed from the fixed dates below through the
 *   D18 closed form `(1 + r)^(t/12)`, `t` = date-only clipped month coverage. The
 *   test never imports `viewAdapters` and never reads report output to derive a
 *   factor.
 * - The projection starts at the scenario `asOfDate` (2026-06-15) and closes each
 *   month on its real month-end. Yearly table rows read their last month close:
 *   the 2026 row observes 2026-12-31 and the 2027 row observes 2027-12-31. The
 *   chart's first point observes the clipped first month close, 2026-06-30.
 * - No arbitrary sleeps; every wait is a web-first assertion.
 */

const INFLATION_RATE = 6;
const START = { year: 2026, month: 6, day: 15 } as const;
const CLOSE_2026 = { year: 2026, month: 12, day: 31 } as const;
const CLOSE_2027 = { year: 2027, month: 12, day: 31 } as const;
const CHART_FIRST_CLOSE = { year: 2026, month: 6, day: 30 } as const;

type DateParts = { year: number; month: number; day: number };

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthOrdinal = (year: number, month: number): number => year * 12 + (month - 1);

/** Exact D18 date-only calendar-month coverage, replicated (not imported). */
const elapsedMonthCoverage = (start: DateParts, end: DateParts): number => {
  const startOrdinal = monthOrdinal(start.year, start.month);
  const endOrdinal = monthOrdinal(end.year, end.month);
  if (startOrdinal === endOrdinal) {
    return (end.day - start.day + 1) / daysInMonth(start.year, start.month);
  }
  const firstFraction =
    (daysInMonth(start.year, start.month) - start.day + 1) / daysInMonth(start.year, start.month);
  const lastFraction = end.day / daysInMonth(end.year, end.month);
  return firstFraction + (endOrdinal - startOrdinal - 1) + lastFraction;
};

/** `(1 + r)^(t/12)` for the fixed 6% rate from the fixed start to `end`. */
const factorTo = (end: DateParts): number =>
  Math.pow(1 + INFLATION_RATE / 100, elapsedMonthCoverage(START, end) / 12);

// Locale formatters mirroring the exact ones owned by each view (never the
// report data). The chart and stacked views hard-code `en-US`; the table uses the
// runtime default locale, so the test uses the same `undefined` locale.
const tableCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
const chartCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const stackedCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

/**
 * Fresh canonical scenario at the helper's fixed reference date: no income and
 * one funded account. The five canonical accounts are kept (the withdrawal plan
 * references the 401k id), but only Checking opens at $1,000 and every account
 * grows 0%.
 */
const noIncomeScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.manualReturns = { ...scenario.manualReturns, inflationEnabled: true, inflationRate: INFLATION_RATE };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: account.id === ACCOUNT_IDS.checking ? 1000 : 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
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

test("GUI-A08: today's-dollars toggles the table, chart tooltip and stacked note from one fixed scenario", async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, noIncomeScenario());
  await expectCleanSeed(page);
  await openTimeline(page);

  const closingCol = await headerIndex(page, 'Closing net worth');
  const assetsCol = await headerIndex(page, 'Assets');
  const closingCell = (year: string) => yearRow(page, year).locator('td').nth(closingCol - 1);
  const assetsCell = (year: string) => yearRow(page, year).locator('td').nth(assetsCol - 1);

  // Nominal: one $1,000 account, 0% growth, no activity ⇒ every year close is
  // exactly the persisted opening balance (input-derived, never read back from
  // the report).
  await expect(closingCell('2026')).toHaveText(tableCurrency(1000));
  await expect(assetsCell('2026')).toHaveText(tableCurrency(1000));
  await expect(closingCell('2027')).toHaveText(tableCurrency(1000));

  const chartRegion = page.getByRole('region', { name: 'Projection chart' });
  const chartSvg = chartRegion.getByRole('img', { name: /and total debt by month/ });
  const stackedRegion = page.getByRole('region', { name: 'Account assets over time' });
  const stackedSvg = stackedRegion.getByRole('img', { name: 'Monthly stacked account balances' });
  const note = page.getByText('Values shown in today’s dollars.');

  // Nominal chart tooltip (keyboard index 0 → 2026-06 close, whole dollars).
  await chartSvg.press('ArrowLeft');
  await expect(chartRegion.locator('.chart-tooltip')).toContainText(`Net worth: ${chartCurrency(1000)}`);

  // Nominal stacked tooltip (index 0) with no today's-dollars note.
  await expect(note).toBeHidden();
  await stackedSvg.hover({ position: { x: 1, y: 1 } });
  await expect(stackedRegion.locator('.savings-chart__tooltip')).toContainText(stackedCurrency(1000));

  const toggle = page.getByRole('checkbox', { name: /Display values in today/ });

  // Toggle ON: the table deflates each row with the factor for its own closing
  // observation date.
  await toggle.check();
  await expect(toggle).toBeChecked();

  const factor2026 = factorTo(CLOSE_2026);
  const factor2027 = factorTo(CLOSE_2027);
  await expect(closingCell('2026')).toHaveText(tableCurrency(1000 / factor2026));
  await expect(assetsCell('2026')).toHaveText(tableCurrency(1000 / factor2026));
  await expect(closingCell('2027')).toHaveText(tableCurrency(1000 / factor2027));

  // Monotonic deflation: a later observation date deflates further while the
  // nominal input stays flat.
  expect(1000 / factor2027).toBeLessThan(1000 / factor2026);
  expect(1000 / factor2026).toBeLessThan(1000);

  // The chart tooltip is whole dollars: assert it against its own independent
  // rounding, never against the table's exact cents.
  const factorFirst = factorTo(CHART_FIRST_CLOSE);
  await chartSvg.press('ArrowLeft');
  await expect(chartRegion.locator('.chart-tooltip')).toContainText(`Net worth: ${chartCurrency(1000 / factorFirst)}`);

  // Stacked note + deflated tooltip share the same enabled mode.
  await expect(note).toBeVisible();
  await stackedSvg.hover({ position: { x: 1, y: 1 } });
  await expect(stackedRegion.locator('.savings-chart__tooltip')).toContainText(stackedCurrency(1000 / factorFirst));

  // Toggle OFF: the nominal report is unchanged (display-only toggle).
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(closingCell('2026')).toHaveText(tableCurrency(1000));
  await expect(closingCell('2027')).toHaveText(tableCurrency(1000));
  await expect(note).toBeHidden();

  await chartSvg.press('ArrowLeft');
  await expect(chartRegion.locator('.chart-tooltip')).toContainText(`Net worth: ${chartCurrency(1000)}`);
  await stackedSvg.hover({ position: { x: 1, y: 1 } });
  await expect(stackedRegion.locator('.savings-chart__tooltip')).toContainText(stackedCurrency(1000));

  expect(errors).toEqual([]);
});

test('GUI-A08: the chart measure selector swaps signed net worth for account assets while the table keeps the signed column', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, noIncomeScenario());
  await expectCleanSeed(page);
  await openTimeline(page);

  const chartRegion = page.getByRole('region', { name: 'Projection chart' });
  const key = chartRegion.locator('.report-chart__key');
  await expect(chartRegion.getByRole('img', { name: 'Net worth and total debt by month' })).toBeVisible();
  await expect(key).toContainText('Net worth');
  await expect(key).not.toContainText('Account assets');

  await page.locator('.report-controls select').selectOption({ label: 'Account assets' });

  await expect(chartRegion.getByRole('img', { name: 'Account assets and total debt by month' })).toBeVisible();
  await expect(key).toContainText('Account assets');
  await expect(key).not.toContainText('Net worth');

  // With no liabilities signed net worth equals account assets ($1,000.00); the
  // signed-vs-account cents distinction stays owned by the RTL suite. The table
  // keeps its signed net-worth column regardless of the chart measure.
  await expect(resultsTable(page).getByRole('columnheader', { name: 'Closing net worth' })).toBeVisible();
  await expect(resultsTable(page).getByRole('columnheader', { name: 'Assets' })).toBeVisible();

  expect(errors).toEqual([]);
});
