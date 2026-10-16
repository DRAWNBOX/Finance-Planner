import { test, expect, type Page } from '@playwright/test';
import type { Loan, Scenario } from '../src/types';
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
 * GUI-A05 / GUI-G19 — the loan results disclosure (`LoanResults`).
 *
 * Bounded browser evidence for the committed / partial ordinary-loan path plus
 * the honest no-activity empty state. These flows are the browser counterpart of
 * the Vitest acceptance at `src/App.test.tsx` "shows only observed loan funding
 * and the signed closing debt from the shared report"; Vitest remains the owner
 * of the per-item engine math (`src/engine/loans.test.ts`,
 * `src/engine/projection.test.ts`).
 *
 * Honesty note: these tests seed the *real* canonical v3 bytes through
 * `seedScenario` and drive the running app with role locators. They do NOT
 * certify the GUI-A/G or CA matrices, and they never import the projection/report
 * module to read expected values — every number below is hand-computed from the
 * seeded configuration.
 *
 * Determinism:
 * - Fresh isolated Chromium context per test (blank localStorage, no real
 *   profile); `seedScenario` pins the clock with `page.clock.setFixedTime`
 *   before the first navigation and writes the seed once (no repeating
 *   `addInitScript`).
 * - No arbitrary sleeps; every wait is a web-first assertion.
 *
 * Loan / liability shape (from `src/types.ts` + `src/engine/loans.ts`):
 * - `Loan` carries `startYearMonth` (first month) but **no** end month and no
 *   payment day. The inclusive term end (`endYearMonth`) and `paymentDay` live on
 *   the linked `LiabilityDefinition`; `buildLoanEventDefinitions` schedules one
 *   monthly occurrence per inclusive month of the liability's `endYearMonth`
 *   (day-1 default), and the required installment is
 *   `min(max(standard amortized payment, minimumMonthlyPayment), outstanding)`.
 * - With APR `0%` and a non-null term, `standard = principal / remainingMonths`;
 *   a `$1,000` principal over 12 inclusive months is `$83.33`/mo, so the `$200`
 *   configured minimum governs the July 2026 request.
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

const openTimeline = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
};

// Locale formatters mirroring the exact ones owned by each view (never the
// report data): the LoanResults section uses `en-US` with 2 digits; the
// Timeline table uses the runtime default locale with 2 digits.
const loanCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
const tableCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

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

/**
 * GUI-A05 fixture: one linked APR-0 ordinary loan — `$1,000` opening debt, a
 * `$200` configured minimum payment from `Checking` opening `$100`, no income and
 * no growth. `startYearMonth: '2026-07'` and the liability's inclusive
 * `endYearMonth: '2027-06'` schedule twelve monthly installments beginning July
 * 2026 (a bounded term — no run-away horizon recurrence). The global clock is
 * pinned the month before by `seedScenario`, so July 2026 is the first and —
 * because `Checking` empties — the only funded installment.
 */
const linkedOrdinaryLoanScenario = (): Scenario =>
  scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };
    next.manualReturns = { ...next.manualReturns, inflationEnabled: false, inflationRate: 0 };
    next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
      ...account,
      openingBalance: account.id === ACCOUNT_IDS.checking ? 100 : 0,
      annualReturnRate: 0,
      retirementAnnualReturnRate: null
    }));
    const loan: Loan = {
      id: 'loan-observed',
      label: 'Observed ordinary loan',
      enabled: true,
      showOnGraph: true,
      startYearMonth: '2026-07',
      originalAmount: 1000,
      downPayment: 0,
      currentBalance: 1000,
      annualInterestRate: 0,
      minimumMonthlyPayment: 200,
      extraMonthlyPayment: 0,
      paymentSourceAccount: ACCOUNT_IDS.checking,
      paymentSource: `account:${ACCOUNT_IDS.checking}`
    };
    next.loans = [loan];
    next.liabilities = [
      {
        id: 'liability-observed',
        kind: 'loan',
        label: loan.label,
        openingBalance: 1000,
        sourceConfigId: loan.id,
        annualInterestRate: 0,
        minimumMonthlyPayment: 200,
        extraMonthlyPayment: 0,
        endYearMonth: '2027-06'
      }
    ];
  });

/**
 * GUI-A05 fixture: one loan contract with **no** linked liability and no observed
 * schedule. The engine skips it (no definitions, no money moves), so the
 * `LoanResults` section must show its honest empty state rather than a fabricated
 * balance or status.
 */
const unlinkedLoanScenario = (): Scenario =>
  scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };
    next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
      ...account,
      openingBalance: 0,
      annualReturnRate: 0,
      retirementAnnualReturnRate: null
    }));
    // No matching liability is seeded: `scenario.liabilities` stays empty.
    next.loans = [
      {
        id: 'loan-unlinked',
        label: 'Unlinked ordinary loan',
        enabled: true,
        showOnGraph: true,
        startYearMonth: '2026-07',
        originalAmount: 1000,
        downPayment: 0,
        currentBalance: 1000,
        annualInterestRate: 0,
        minimumMonthlyPayment: 200,
        extraMonthlyPayment: 0,
        paymentSourceAccount: ACCOUNT_IDS.checking,
        paymentSource: `account:${ACCOUNT_IDS.checking}`
      }
    ];
  });

test('GUI-A05/G19: a $200 July 2026 installment from $100 Checking pays $100, leaves $900 closing debt, and keeps net worth at −$900', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, linkedOrdinaryLoanScenario());
  await expectCleanSeed(page);

  await openPurchasesAndExpenses(page);

  const region = page.getByRole('region', { name: 'Observed results for Observed ordinary loan' });
  await expect(region).toBeVisible();
  await expect(region.getByRole('heading', { name: 'Observed projection results' })).toBeVisible();

  // July 2026 is the first scheduled installment; requested is the `$200`
  // configured minimum (the $83.33 amortized share is smaller), `Checking` funds
  // only its `$100`, and the unpaid `$100` stays on the liability.
  await expect(region.getByText('Installment · 2026-07')).toBeVisible();
  await expect(region.getByText(/Requested \$200\.00 · paid \$100\.00 · unpaid \$100\.00/)).toBeVisible();

  // Closing debt is the input-derived $1,000 principal less the funded $100; APR
  // is 0%, so there is no interest and no fabricated fee.
  await expect(region.getByText('Remaining debt at projection close')).toBeVisible();
  await expect(region.getByText(loanCurrency(900), { exact: true })).toBeVisible();
  await expect(region.getByText('Principal $900.00 · interest $0.00 · fees $0.00')).toBeVisible();

  // A $900 remaining principal is not a payoff — the section must not claim one.
  await expect(region.getByText(/payoff/i)).toHaveCount(0);

  // The signed net worth in the Timeline table: no account assets survive the
  // debit (Checking $100 → $0) minus the $900 closing debt = −$900.00.
  await openTimeline(page);
  const closingCol = await headerIndex(page, 'Closing net worth');
  const assetsCol = await headerIndex(page, 'Assets');
  const closingCell = resultsTable(page).locator('td').nth(closingCol - 1);
  const assetsCell = resultsTable(page).locator('td').nth(assetsCol - 1);
  await expect(closingCell).toHaveText(tableCurrency(-900));
  await expect(assetsCell).toHaveText(tableCurrency(0));

  expect(errors).toEqual([]);
});

test('GUI-A05/G19: an unlinked loan with no observed schedule shows the honest empty state and no fabricated balance', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, unlinkedLoanScenario());
  await expectCleanSeed(page);

  await openPurchasesAndExpenses(page);

  const region = page.getByRole('region', { name: 'Observed results for Unlinked ordinary loan' });
  await expect(region).toBeVisible();

  // No schedule and no liability link: no invented activity, and the debt balance
  // note states plainly that nothing is reported.
  await expect(region.getByText('No observed loan activity in this projection window.')).toBeVisible();
  await expect(region.getByText('This loan has no linked debt record, so no remaining balance is reported.')).toBeVisible();
  await expect(region.getByText('Remaining debt at projection close')).toHaveCount(0);
  await expect(region.getByText('Installment · 2026-07')).toHaveCount(0);

  expect(errors).toEqual([]);
});
