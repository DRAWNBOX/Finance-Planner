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
 * GUI-G19 — the interest-bearing loan payoff branch of `LoanResults`.
 *
 * `e2e/loan-results.spec.ts` already owns the APR-0 partial-funding branch and
 * the honest unlinked-empty branch. This spec closes the remaining browser
 * branch: a configured linked ordinary loan carrying a nonzero nominal APR that
 * fully amortizes and clears within the projection window, so the committed
 * schedule observes a payoff month.
 *
 * Honesty note: these tests seed the *real* canonical v3 bytes through
 * `seedScenario` and drive the running app with role locators. They do NOT
 * certify the GUI-A/G or CA matrices, and they never import the
 * projection/report module to read expected values — every number below is
 * hand-computed from the seeded configuration. Vitest remains the owner of the
 * per-item engine math (`src/engine/loans.test.ts`).
 *
 * Determinism:
 * - Fresh isolated Chromium context per test (blank localStorage, no real
 *   profile); `seedScenario` pins the clock with `page.clock.setFixedTime`
 *   before the first navigation and writes the seed once.
 * - No arbitrary sleeps; every wait is a web-first assertion.
 *
 * Loan / liability shape (from `src/types.ts` + `src/engine/loans.ts`):
 * - `Loan` carries `startYearMonth` (first month); the inclusive term end
 *   (`endYearMonth`) lives on the linked `LiabilityDefinition`, which schedules
 *   one monthly occurrence per inclusive month. The required installment is
 *   `min(max(standard amortized payment, minimumMonthlyPayment), outstanding)`,
 *   with `standard = P·r / (1 − (1+r)^−n)`, `r = APR/12` (nominal), `n` the
 *   remaining inclusive months. Debt accrues monthly at the nominal `APR/12`.
 * - A funded payment is allocated interest-first, then principal; principal is
 *   reduced only by the amount actually paid.
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

// Locale formatter mirroring the exact one the LoanResults section uses
// (`en-US`, 2 digits) — never the report data.
const loanCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

/**
 * GUI-G19 fixture: one linked ordinary loan carrying a `6%` nominal APR.
 *
 * - `$1,000` opening principal, `startYearMonth: '2026-07'`, liability inclusive
 *   `endYearMonth: '2026-08'` ⇒ exactly two monthly installments (Jul + Aug).
 * - Configured `minimumMonthlyPayment: $505`. Over the two-month term the
 *   standard amortized share is ≈ `$503.75`/mo, so the `$505` minimum governs
 *   the first installment (and exceeds it, so it reduces principal).
 * - `Checking` opens at `$2,000` with `0%` growth, enough to fund both
 *   installments; no income and no other accounts.
 *
 * Hand-computed schedule (nominal `APR/12 = 6%/12 = 0.5%`):
 * - Jul 2026: interest `$1,000 × 0.005 = $5.00`; required `$505.00` ⇒ `$5.00`
 *   interest + `$500.00` principal paid; remaining principal `$500.00`.
 * - Aug 2026: interest `$500.00 × 0.005 = $2.50`; required capped at the
 *   outstanding `$502.50` ⇒ the loan clears, so the committed schedule observes
 *   payoff `2026-08` and the closing debt is `$0.00` (no phantom principal).
 */
const linkedInterestBearingLoanScenario = (): Scenario =>
  scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };
    next.manualReturns = { ...next.manualReturns, inflationEnabled: false, inflationRate: 0 };
    next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
      ...account,
      openingBalance: account.id === ACCOUNT_IDS.checking ? 2000 : 0,
      annualReturnRate: 0,
      retirementAnnualReturnRate: null
    }));
    const loan: Loan = {
      id: 'loan-interest',
      label: 'Interest-bearing payoff loan',
      enabled: true,
      showOnGraph: true,
      startYearMonth: '2026-07',
      originalAmount: 1000,
      downPayment: 0,
      currentBalance: 1000,
      annualInterestRate: 6,
      minimumMonthlyPayment: 505,
      extraMonthlyPayment: 0,
      paymentSourceAccount: ACCOUNT_IDS.checking,
      paymentSource: `account:${ACCOUNT_IDS.checking}`
    };
    next.loans = [loan];
    next.liabilities = [
      {
        id: 'liability-interest',
        kind: 'loan',
        label: loan.label,
        openingBalance: 1000,
        sourceConfigId: loan.id,
        annualInterestRate: 6,
        minimumMonthlyPayment: 505,
        extraMonthlyPayment: 0,
        endYearMonth: '2026-08'
      }
    ];
  });

test('GUI-G19: a 6% APR linked ordinary loan pays $5.00 then $2.50 interest, clears $1,000 principal over two months, and reports payoff 2026-08 with no phantom principal', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, linkedInterestBearingLoanScenario());
  await expectCleanSeed(page);

  await openPurchasesAndExpenses(page);

  const region = page.getByRole('region', { name: 'Observed results for Interest-bearing payoff loan' });
  await expect(region).toBeVisible();
  await expect(region.getByRole('heading', { name: 'Observed projection results' })).toBeVisible();

  // Jul 2026: the $505 configured minimum governs and is fully funded; the
  // nominal 0.5%/mo interest is $5.00, so $500.00 of principal is retired and
  // the debt is still outstanding — no payoff is claimed this month.
  await expect(region.getByText('Installment · 2026-07')).toBeVisible();
  await expect(region.getByText(/Requested \$505\.00 · paid \$505\.00 · unpaid \$0\.00 · funded/)).toBeVisible();

  // Aug 2026: interest on the remaining $500.00 is $2.50 and the required
  // installment is capped at the outstanding $502.50 (principal + interest), so
  // the loan clears and the committed schedule observes payoff 2026-08.
  await expect(region.getByText('Installment · 2026-08')).toBeVisible();
  await expect(
    region.getByText(/Requested \$502\.50 · paid \$502\.50 · unpaid \$0\.00 · funded · payoff 2026-08/)
  ).toBeVisible();

  // Closing debt is exactly $0.00 with no fabricated fee and no phantom extra
  // principal beyond the two funded installments.
  await expect(region.getByText('Remaining debt at projection close')).toBeVisible();
  await expect(region.getByText(loanCurrency(0), { exact: true })).toBeVisible();
  await expect(region.getByText('Principal $0.00 · interest $0.00 · fees $0.00')).toBeVisible();

  expect(errors).toEqual([]);
});
