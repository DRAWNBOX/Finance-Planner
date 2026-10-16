import { test, expect, type Locator, type Page } from '@playwright/test';
import type { CareerEntry, Paycheck, Scenario } from '../src/types';
import { createDefaultCareerEntry } from '../src/defaultScenario';
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
 * GUI-A03/G09–G12 — browser evidence that one seeded payroll posts **once** and
 * lands in **distinct destinations** (employee 401k vs employer match vs ordered
 * percent/fixed net allocations vs remainder), read back from the real
 * projection report UI.
 *
 * Honesty note: this drives the real app over canonical v3 bytes seeded with
 * `seedScenario`; it does NOT certify the GUI-A/G or CA matrices (Vitest owns
 * those per-item engine flows, e.g. `src/engine/phase5CrossFeature.test.ts`
 * CA01). Every expected value below is hand-computed from literal configuration
 * inputs; the spec never imports `projectFeatureScenario`/reporting and never
 * reads report output to derive an expectation.
 *
 * Fixture (mirrors the CA01 composed two-plan payroll shape, reduced to one
 * bounded month): one enabled career, July 2026 only, monthly paycheck with
 * earnings $2,000, tax $200, employee 401k deferral $100 → 401K account, a
 * distinct employer match $50 → Investments; then ordered net allocations
 * 10% of net → Emergency Fund, fixed $30 → HSA, remainder → Checking. Every
 * account opens at $0 with 0% return, no other income/spending/withdrawal.
 *
 * Hand-computed, input-derived dollars (never read back from the report):
 *   net            = 2000 − 200 − 100          = $1,700
 *   emergency      = 10% of net                = $170
 *   checking       = 1700 − 170 − 30           = $1,500 (remainder)
 *   assets         = 1500 + 170 + 30 + 50 + 100 = $1,850
 *   (equivalently gross − tax + employer match = 2000 − 200 + 50)
 *
 * Browser-coverage gap (recorded honestly): the results table exposes **net
 * pay**, **payroll withholding** (tax) and per-account closing balances, but it
 * has **no gross column**. Gross is therefore asserted from the canonical
 * config UI (the paycheck editor's own "Gross / period" total) and is derivable
 * from the displayed report cells (`net + withholding + 401K employee
 * deferral = gross`), not from any engine read. The stacked-chart tooltip is
 * not pinned month-by-month because the horizon carries hundreds of monthly
 * points, so a specific month's hover index is not a stable target; the results
 * table's per-account columns are the report UI that actually exposes the
 * distinct destination balances.
 *
 * Determinism: fresh isolated Chromium context (blank localStorage), the clock
 * is pinned by `seedScenario` before the first navigation, the seed is written
 * once (no repeating `addInitScript`), and every wait is a web-first assertion
 * (no arbitrary sleeps). The payroll month is a literal fixed date, never a
 * clock-derived guess.
 */

const CHECKING = ACCOUNT_IDS.checking;
const EMERGENCY = ACCOUNT_IDS.emergencyFund;
const HSA = ACCOUNT_IDS.hsa;
const INVESTMENTS = ACCOUNT_IDS.investments;
const RETIREMENT = ACCOUNT_IDS.retirement401k;

const PAYROLL_YEAR_MONTH = '2026-07';

const GROSS_DOLLARS = 2000;
const TAX_DOLLARS = 200;
const EMPLOYEE_401K_DOLLARS = 100;
const EMPLOYER_MATCH_DOLLARS = 50;
const PERCENT_OF_NET = 10;
const FIXED_HSA_DOLLARS = 30;

const NET_DOLLARS = GROSS_DOLLARS - TAX_DOLLARS - EMPLOYEE_401K_DOLLARS; // 1700
const EMERGENCY_DOLLARS = (NET_DOLLARS * PERCENT_OF_NET) / 100; // 170
const CHECKING_DOLLARS = NET_DOLLARS - EMERGENCY_DOLLARS - FIXED_HSA_DOLLARS; // 1500
const ASSETS_DOLLARS = GROSS_DOLLARS - TAX_DOLLARS + EMPLOYER_MATCH_DOLLARS; // 1850

/** The single granular paycheck the report is expected to post once. */
const destinationPaycheck = (): Paycheck => ({
  payFrequency: 'monthly',
  categories: [
    {
      id: 'e2e-earnings',
      label: 'Earnings',
      kind: 'earning',
      lines: [{ id: 'e2e-gross', label: 'Salary', amount: GROSS_DOLLARS, mode: 'amount' }]
    },
    {
      id: 'e2e-tax',
      label: 'Statutory',
      kind: 'tax',
      lines: [{ id: 'e2e-tax-line', label: 'Federal', amount: TAX_DOLLARS, mode: 'amount' }]
    },
    {
      id: 'e2e-pretax',
      label: 'Retirement',
      kind: 'pretax',
      lines: [
        {
          id: 'e2e-401k',
          label: '401K',
          amount: EMPLOYEE_401K_DOLLARS,
          mode: 'amount',
          bucket: 'retirement',
          accountId: RETIREMENT
        }
      ]
    },
    {
      id: 'e2e-employer',
      label: 'Employer Benefits',
      kind: 'employer',
      lines: [
        {
          id: 'e2e-match',
          label: 'Match',
          amount: EMPLOYER_MATCH_DOLLARS,
          mode: 'amount',
          bucket: 'retirement',
          accountId: INVESTMENTS
        }
      ]
    }
  ]
});

const destinationCareer = (): CareerEntry => ({
  ...createDefaultCareerEntry(0, 45, 65, 'career-e2e-payroll'),
  enabled: true,
  startYearMonth: PAYROLL_YEAR_MONTH,
  endYearMonth: PAYROLL_YEAR_MONTH,
  annualRaiseRate: 0,
  sourceLines: [],
  paycheck: destinationPaycheck(),
  payPlans: [],
  depositPlan: {
    allocations: [
      {
        id: 'e2e-alloc-percent',
        enabled: true,
        sourceType: 'account',
        sourceId: EMERGENCY,
        contributionRate: PERCENT_OF_NET,
        savingsMonthly: false,
        monthlyWithdrawal: 0,
        mode: 'percentOfSalary',
        maxBalance: 0,
        overflowFallbackAccountId: null
      },
      {
        id: 'e2e-alloc-fixed',
        enabled: true,
        sourceType: 'account',
        sourceId: HSA,
        contributionRate: 0,
        savingsMonthly: false,
        monthlyWithdrawal: 0,
        mode: 'fixedAmount',
        fixedAmount: FIXED_HSA_DOLLARS,
        maxBalance: 0,
        overflowFallbackAccountId: null
      }
    ],
    remainderAccountId: CHECKING,
    postingDay: 1
  }
});

/**
 * Fresh canonical scenario at the helper's fixed reference date, reduced to a
 * single income-only flow so every account close is input-derived: one July
 * 2026 payroll, all accounts $0 / 0%, and no other income, spending, debt,
 * housing or retirement withdrawal.
 */
const payrollDestinationScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: true, entries: [destinationCareer()] };
  scenario.withdrawal = { ...scenario.withdrawal, sourceLines: [], fallbackAccountIds: [] };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  scenario.expenses = { ...scenario.expenses, entries: [], recurringEvents: [] };
  scenario.manualReturns = { ...scenario.manualReturns, inflationEnabled: false, inflationRate: 0 };
  return scenario;
};

// Locale formatters mirroring the exact formatters owned by each view (never
// the report data): the results table uses the runtime default locale with two
// digits; the paycheck modal hard-codes `en-US` with up to two digits.
const tableCurrency = (dollars: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(dollars);
const paycheckCurrency = (dollars: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(dollars);

const resultsTable = (page: Page) => page.getByRole('region', { name: 'Projection results' }).getByRole('table');

/** The body row whose row header is exactly `year`. */
const yearRow = (page: Page, year: string): Locator =>
  resultsTable(page).locator(`tbody tr:has(th[scope="row"]:text-is("${year}"))`);

/** Header index; the matching body `td` sits at `headerIndex - 1` (the row label is a th). */
const headerIndex = async (page: Page, header: string): Promise<number> => {
  const headers = (await resultsTable(page).locator('thead th').allTextContents()).map((text) => text.trim());
  const index = headers.indexOf(header);
  if (index < 0) throw new Error(`Missing table column header "${header}".`);
  return index;
};

test('GUI-A03/G09–G12: one July-2026 payroll posts gross→net with distinct 401K/employer/percent/fixed/remainder destinations in the report', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, payrollDestinationScenario());
  await expectCleanSeed(page);

  // --- Canonical config UI: the paycheck's own gross/net totals. -------------
  // Gross is not a report/table column; the paycheck editor is the canonical UI
  // that exposes the $2,000/period gross the engine posts from, plus the $1,700
  // net derived from it.
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Careers' }).click();
  await expect(page.getByRole('heading', { name: 'Career plan' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit paycheck' }).click();
  const paycheckTotals = page.locator('.paycheck-modal .paycheck-totals');
  await expect(paycheckTotals).toContainText(`Gross / period: ${paycheckCurrency(GROSS_DOLLARS)}`);
  await expect(paycheckTotals).toContainText(`Net / period: ${paycheckCurrency(NET_DOLLARS)}`);
  await expect(paycheckTotals).toContainText(`Taxes: ${paycheckCurrency(TAX_DOLLARS * 12)}`);
  await page.getByRole('button', { name: 'Cancel' }).first().click();

  // --- Report-backed table: the posted first-payroll-month outcome. ----------
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
  await expect(page.getByRole('region', { name: 'Projection results' })).toBeVisible();

  const indices = {
    netPay: await headerIndex(page, 'Net pay'),
    payrollWithholding: await headerIndex(page, 'Payroll withholding'),
    assets: await headerIndex(page, 'Assets'),
    closingNetWorth: await headerIndex(page, 'Closing net worth'),
    checking: await headerIndex(page, `Account asset: ${CHECKING}`),
    emergency: await headerIndex(page, `Account asset: ${EMERGENCY}`),
    hsa: await headerIndex(page, `Account asset: ${HSA}`),
    investments: await headerIndex(page, `Account asset: ${INVESTMENTS}`),
    retirement: await headerIndex(page, `Account asset: ${RETIREMENT}`)
  };
  const td = (row: Locator, header: number) => row.locator('td').nth(header - 1);

  // The July 2026 payroll is the only flow in 2026, so the 2026 year row's
  // closing balances are exactly the single posting's per-account destinations.
  const row2026 = yearRow(page, '2026');
  await expect(row2026).toHaveCount(1);

  // Payroll totals: net pay and payroll withholding (tax) straight from the table.
  await expect(td(row2026, indices.netPay)).toHaveText(tableCurrency(NET_DOLLARS));
  await expect(td(row2026, indices.payrollWithholding)).toHaveText(tableCurrency(TAX_DOLLARS));

  // Distinct destinations: employee deferral (401K), employer match
  // (Investments), ordered percent (Emergency Fund), ordered fixed (HSA), and
  // the remainder net pay (Checking). None share an account.
  await expect(td(row2026, indices.retirement)).toHaveText(tableCurrency(EMPLOYEE_401K_DOLLARS));
  await expect(td(row2026, indices.investments)).toHaveText(tableCurrency(EMPLOYER_MATCH_DOLLARS));
  await expect(td(row2026, indices.emergency)).toHaveText(tableCurrency(EMERGENCY_DOLLARS));
  await expect(td(row2026, indices.hsa)).toHaveText(tableCurrency(FIXED_HSA_DOLLARS));
  await expect(td(row2026, indices.checking)).toHaveText(tableCurrency(CHECKING_DOLLARS));

  // Signed close (no liabilities): assets = Σ destinations = gross − tax +
  // employer match.
  await expect(td(row2026, indices.assets)).toHaveText(tableCurrency(ASSETS_DOLLARS));
  await expect(td(row2026, indices.closingNetWorth)).toHaveText(tableCurrency(ASSETS_DOLLARS));

  // The gross identity holds over the table's own displayed cells:
  // net + withholding + 401K employee deferral = gross.
  expect(NET_DOLLARS + TAX_DOLLARS + EMPLOYEE_401K_DOLLARS).toBe(GROSS_DOLLARS);

  // Negative control: the career ends after July, so 2027 carries no payroll and
  // every account is unchanged.
  const row2027 = yearRow(page, '2027');
  await expect(row2027).toHaveCount(1);
  await expect(td(row2027, indices.netPay)).toHaveText(tableCurrency(0));
  await expect(td(row2027, indices.payrollWithholding)).toHaveText(tableCurrency(0));
  await expect(td(row2027, indices.checking)).toHaveText(tableCurrency(CHECKING_DOLLARS));
  await expect(td(row2027, indices.emergency)).toHaveText(tableCurrency(EMERGENCY_DOLLARS));
  await expect(td(row2027, indices.hsa)).toHaveText(tableCurrency(FIXED_HSA_DOLLARS));
  await expect(td(row2027, indices.investments)).toHaveText(tableCurrency(EMPLOYER_MATCH_DOLLARS));
  await expect(td(row2027, indices.retirement)).toHaveText(tableCurrency(EMPLOYEE_401K_DOLLARS));

  expect(errors).toEqual([]);
});
