/**
 * Phase 5 P5.5 — cross-feature CA01–CA13 acceptance (Q-owned).
 *
 * This suite links the correctness-acceptance cases **across features** over the
 * single integrated `projectFeatureScenario` path plus the pure kernel owners
 * (`taxes.ts`, `valuation.ts`). It intentionally does **not** re-implement the
 * focused stream suites; it re-fixtures each case with whole-dollar / zero-rate
 * configurations so every expected cent value is independently hand-computed
 * from the configuration (never read back from the run).
 *
 * Case map (see `refactor/coverage_register.md` §CA01–CA13):
 *
 * - **CA01/CA02/CA13** — payroll posted once to distinct destinations, ordered
 *   net allocations + remainder, opening + postings = close, signed
 *   assets − liabilities, a 24-month composed run whose annual flows are the sum
 *   of the actual month flows (first/last stock observations, no double annual
 *   income), and a byte-identical ordered audit whose concrete
 *   chronological/phase-band order is asserted (not a lexicographic `.sort()`).
 *   CA01 also composes a dated **two-plan** payroll whose employee 401k deferral
 *   and employer match route to distinct accounts, with ordered percent + fixed
 *   net allocations and a 2026-04 pay-plan switch (annual = Σ months, one
 *   employer deposit per month, gross conservation), and bounds ordered
 *   allocations to actual net pay when they **over-subscribe** (full → partial →
 *   skipped, no proportional scaling or borrowing). It also resolves two
 *   overlapping explicit-window careers to the most recently started one with no
 *   double payroll posted, and caps an incoming net allocation at a configured
 *   `maxBalance`, routing only the excess once to its explicit overflow account.
 *   The full five-band mandatory order is also asserted separately by the D26
 *   fixture in `phase5Acceptance.test.ts`; this CA13 case exercises the same
 *   frozen band contract over its own fixed-date fixture (loan → card → planner,
 *   then a discretionary purchase).
 * - **CA03** — primary/fallback split and an atomic no-op (unfunded debits
 *   nothing, journals nothing).
 * - **CA04** — gross = net + tax + penalty identity and the non-qualified HSA
 *   extra-penalty waiver at the holder's birthday, exercised end-to-end through
 *   a planner debit from HSA.
 * - **CA05** — debt payment is funded-only; principal reduces cash and debt
 *   equally (full / partial / zero funding).
 * - **CA06** — permanent-0% adaptive payoff (`$33.34`/`$33.33`/`$33.33`), a
 *   **composed-path** underfunded re-split (Jan `$33.34` funded, Feb `$33.33`
 *   zero-funded, the final date sweeps the recomputed `$66.66` residual in one
 *   obligation while the coincident payoff no-ops) and an ordinary card's twelve
 *   payments with no debt.
 * - **CA07** — 4% basis is frozen from the observed source balance; an explicit
 *   0% stays zero.
 * - **CA08** — exact-APY monthly compounding (full month, 24 months, clipped
 *   partial month) and a day-31 clamp.
 * - **CA09** — held-deposit acquisition: `$30k` held, then `$30k` completes into
 *   a `$300k` property / `$240k` mortgage in the same commit (no second expense).
 * - **CA10** — one occurrence per dated manual/recurring record, monthly day-31
 *   clamp, and an occurred observation that stays permanently view-only.
 * - **CA11** — **reference only**: canonical save/load is covered by the P1
 *   codec suite (`src/codec.test.ts`, `src/storage.test.ts`); not duplicated here.
 * - **CA12** — compatible frozen comparisons: the built report is immutable and
 *   a re-run is byte-identical; the D16/D25 shortfall diagnostic is exact.
 *
 * No wall clock is read: every fixture uses fixed 2026 dates and the selected
 * base timeline (`activeTimelineId: null`, `timelines: []`). The card timeline
 * oracle decision is deliberately untouched.
 */

import { describe, expect, it } from 'vitest';

import {
  createDefaultCareerEntry,
  createDefaultCashflowItem,
  createDefaultHousingEntry,
  createDefaultOrdinaryCardSchedule,
  createDefaultRetirementWithdrawalSource,
  createDefaultScenario,
  createDefaultZeroInterestCardPlan
} from '../defaultScenario';
import type {
  CareerEntry,
  CareerPayPlan,
  CareerSourceLine,
  CashflowItem,
  ExpenseEntry,
  HousingEntry,
  LargePurchase,
  LiabilityDefinition,
  Loan,
  Paycheck,
  PropertyDefinition,
  RecurringExpenseEvent,
  Scenario
} from '../types';
import { buildWithholdingProfile, grossToNet, isHsaPenaltyWaived } from './taxes';
import { projectFeatureScenario } from './featureHandlers';
import { LOAN_INSTALLMENT_HANDLER_ID } from './loans';
import { PLANNER_HANDLER_ID } from './planner';
import { RETIREMENT_HANDLER_ID } from './retirement';
import { SPENDING_HANDLER_IDS } from './spending';

const REFERENCE = new Date(2026, 0, 1, 12, 0, 0);
const DOB = '1980-10-01';
const START = '2026-01-01';

const CHECKING = 'checking-account-default';
const EMERGENCY = 'emergencyFund-account-default';
const HSA = 'hsa-account-default';
const RETIREMENT = 'retirement401k-account-default';
const INVESTMENTS = 'investments-account-default';

// ---------------------------------------------------------------------------
// Zeroed, income-free base scenario (one feature configured per test)
// ---------------------------------------------------------------------------

const baseScenario = (): Scenario => {
  const value = createDefaultScenario(REFERENCE);
  value.netWorth.asOfDate = START;
  value.careerPlan = { enabled: false, entries: [] };
  value.withdrawal = { ...value.withdrawal, sourceLines: [], fallbackAccountIds: [] };
  value.cashflowItems = [];
  value.lifeEvents = [];
  value.largePurchases = [];
  value.longTermPurchases = [];
  value.loans = [];
  value.housing = [];
  value.properties = [];
  value.liabilities = [];
  value.cardPlans = [];
  value.creditCards = [];
  value.timelines = [];
  value.activeTimelineId = null;
  value.expenses = { ...value.expenses, entries: [], recurringEvents: [] };
  value.manualReturns = { ...value.manualReturns, inflationEnabled: false };
  value.netWorth.accounts = value.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  value.fundingPolicy = { ...value.fundingPolicy, primaryAccountId: CHECKING, fallbackAccountIds: [] };
  return value;
};

const setOpening = (scenario: Scenario, accountId: string, dollars: number): void => {
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) =>
    account.id === accountId ? { ...account, openingBalance: dollars } : account
  );
};

const setRate = (scenario: Scenario, accountId: string, percent: number): void => {
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) =>
    account.id === accountId ? { ...account, annualReturnRate: percent } : account
  );
};

const accountBalance = (snapshot: { accounts: readonly { accountId: string; balanceCents: number }[] }, id: string) =>
  snapshot.accounts.find((account) => account.accountId === id)?.balanceCents;

const liabilityPrincipal = (
  snapshot: { liabilities: readonly { liabilityId: string; principalCents: number }[] },
  id: string
) => snapshot.liabilities.find((liability) => liability.liabilityId === id)?.principalCents;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const sourceLine = (over: Partial<CareerSourceLine> & Pick<CareerSourceLine, 'id' | 'sourceId'>): CareerSourceLine => ({
  enabled: true,
  sourceType: 'account',
  contributionRate: 0,
  savingsMonthly: false,
  monthlyWithdrawal: 0,
  maxBalance: 0,
  overflowFallbackAccountId: null,
  ...over
});

/** Monthly `$1,000` gross, `$100` tax, `$50` employee retirement; 10% of net → emergency. */
const payrollCareer = (over: Partial<CareerEntry> = {}): CareerEntry => {
  const base = createDefaultCareerEntry(0, 45, 65, 'career-cross');
  const paycheck: Paycheck = {
    payFrequency: 'monthly',
    categories: [
      {
        id: 'cat-earnings',
        label: 'Earnings',
        kind: 'earning',
        lines: [{ id: 'line-earnings', label: 'Regular', amount: 1000, mode: 'amount' }]
      },
      { id: 'cat-tax', label: 'Statutory', kind: 'tax', lines: [{ id: 'line-tax', label: 'Tax', amount: 100, mode: 'amount' }] },
      {
        id: 'cat-retirement',
        label: 'Retirement',
        kind: 'pretax',
        lines: [
          {
            id: 'line-retirement',
            label: '401K',
            amount: 50,
            mode: 'amount',
            bucket: 'retirement',
            accountId: RETIREMENT
          }
        ]
      }
    ]
  };
  return {
    ...base,
    enabled: true,
    startYearMonth: '2026-01',
    endYearMonth: '2026-12',
    annualRaiseRate: 0,
    sourceLines: [],
    paycheck,
    payPlans: [],
    depositPlan: {
      allocations: [sourceLine({ id: 'alloc-emergency', sourceId: EMERGENCY, contributionRate: 10 })],
      remainderAccountId: CHECKING,
      postingDay: 1
    },
    ...over
  };
};

/**
 * Monthly paycheck from per-period dollar amounts. The employee retirement
 * deferral is routed to `RETIREMENT` and the employer match to `INVESTMENTS`, so
 * the two never share a destination (CA01 — distinct employer fund).
 */
const composedPaycheck = (amounts: {
  gross: number;
  tax: number;
  employeeRetirement: number;
  employerMatch: number;
}): Paycheck => ({
  payFrequency: 'monthly',
  categories: [
    {
      id: 'composed-earnings',
      label: 'Earnings',
      kind: 'earning',
      lines: [{ id: 'composed-gross', label: 'Salary', amount: amounts.gross, mode: 'amount' }]
    },
    {
      id: 'composed-tax',
      label: 'Statutory',
      kind: 'tax',
      lines: [{ id: 'composed-tax-line', label: 'Federal', amount: amounts.tax, mode: 'amount' }]
    },
    {
      id: 'composed-pretax',
      label: 'Other Deductions',
      kind: 'pretax',
      lines: [
        {
          id: 'composed-retirement',
          label: '401k',
          amount: amounts.employeeRetirement,
          mode: 'amount',
          accountId: RETIREMENT,
          bucket: 'retirement'
        }
      ]
    },
    {
      id: 'composed-employer',
      label: 'Employer Benefits',
      kind: 'employer',
      lines: [
        {
          id: 'composed-match',
          label: 'Match',
          amount: amounts.employerMatch,
          mode: 'amount',
          accountId: INVESTMENTS,
          bucket: 'retirement'
        }
      ]
    }
  ]
});

/** Ordered net allocations: one percent line, then one fixed-amount line. */
const composedDepositPlan = (percentRate: number, fixedMonthly: number) => ({
  allocations: [
    sourceLine({
      id: 'composed-alloc-percent',
      sourceId: EMERGENCY,
      mode: 'percentOfSalary',
      contributionRate: percentRate
    }),
    sourceLine({ id: 'composed-alloc-fixed', sourceId: HSA, mode: 'fixedAmount', contributionRate: 0, fixedAmount: fixedMonthly })
  ],
  remainderAccountId: CHECKING,
  postingDay: 1
});

/**
 * CA01 composed career: a career-level initial plan plus one dated pay plan
 * effective 2026-04 that changes gross, tax, every deduction, the percent
 * allocation rate, the fixed allocation and the employer match.
 *
 * Initial plan (per month, dollars): gross 2000, tax 300, employee 401k 200,
 * employer match 150, 10% of net → emergency, fixed 50 → HSA, remainder checking.
 * Switch plan (effective 2026-04): gross 3000, tax 500, employee 401k 100,
 * employer match 100, 20% of net → emergency, fixed 25 → HSA, remainder checking.
 */
const composedPayrollCareer = (): CareerEntry => {
  const base = createDefaultCareerEntry(0, 45, 65, 'career-composed');
  const switchPlan: CareerPayPlan = {
    id: 'pay-plan-switch',
    label: 'Switch',
    effectiveYearMonth: '2026-04',
    paycheck: composedPaycheck({ gross: 3000, tax: 500, employeeRetirement: 100, employerMatch: 100 }),
    sourceLines: [],
    depositPlan: composedDepositPlan(20, 25),
    annualRaiseRate: 0
  };
  return {
    ...base,
    enabled: true,
    startYearMonth: '2026-01',
    endYearMonth: '2026-12',
    annualRaiseRate: 0,
    sourceLines: [],
    paycheck: composedPaycheck({ gross: 2000, tax: 300, employeeRetirement: 200, employerMatch: 150 }),
    payPlans: [switchPlan],
    depositPlan: composedDepositPlan(10, 50)
  };
};

/**
 * CA01 over-subscription: one initial plan whose ordered fixed allocations request
 * more than net pay. Monthly gross 1000 − tax 100 = net 90000¢, but the four
 * ordered allocations request 50000 + 30000 + 20000 + 5000 = 105000¢.
 * Per ADR-009 allocations deposit in configured order until net pay is exhausted
 * (partial where the remainder is smaller, skipped at 0), with no proportional
 * scaling, minted deposit or borrowing.
 */
const oversubscribedPayrollCareer = (): CareerEntry => ({
  ...createDefaultCareerEntry(0, 45, 65, 'career-over'),
  enabled: true,
  startYearMonth: '2026-01',
  endYearMonth: '2026-12',
  annualRaiseRate: 0,
  sourceLines: [],
  paycheck: composedPaycheck({ gross: 1000, tax: 100, employeeRetirement: 0, employerMatch: 0 }),
  payPlans: [],
  depositPlan: {
    allocations: [
      sourceLine({ id: 'over-a', sourceId: EMERGENCY, mode: 'fixedAmount', contributionRate: 0, fixedAmount: 500 }),
      sourceLine({ id: 'over-b', sourceId: HSA, mode: 'fixedAmount', contributionRate: 0, fixedAmount: 300 }),
      sourceLine({ id: 'over-c', sourceId: INVESTMENTS, mode: 'fixedAmount', contributionRate: 0, fixedAmount: 200 }),
      sourceLine({ id: 'over-d', sourceId: RETIREMENT, mode: 'fixedAmount', contributionRate: 0, fixedAmount: 50 })
    ],
    remainderAccountId: CHECKING,
    postingDay: 1
  }
});

/**
 * CA01 career overlap: two explicit-window careers that overlap. The compiler
 * prefers the most recently started career on overlap (A from 2026-01, B from
 * 2026-03), so 2026-01/02 post A and 2026-03/04 post B — never both. Each has
 * one fixed allocation to emergency; dates come from `startYearMonth`, never an
 * age guess.
 */
const overlapCareer = (over: {
  id: string;
  startYearMonth: string;
  gross: number;
  tax: number;
  fixedMonthly: number;
}): CareerEntry => ({
  ...createDefaultCareerEntry(0, 45, 65, over.id),
  enabled: true,
  startYearMonth: over.startYearMonth,
  endYearMonth: '2026-12',
  annualRaiseRate: 0,
  sourceLines: [],
  paycheck: composedPaycheck({ gross: over.gross, tax: over.tax, employeeRetirement: 0, employerMatch: 0 }),
  payPlans: [],
  depositPlan: {
    allocations: [
      sourceLine({
        id: `alloc-${over.id}`,
        sourceId: EMERGENCY,
        mode: 'fixedAmount',
        contributionRate: 0,
        fixedAmount: over.fixedMonthly
      })
    ],
    remainderAccountId: CHECKING,
    postingDay: 1
  }
});

/**
 * CA01 cap/overflow (P3I.4): one fixed $300/month net allocation into emergency,
 * whose `maxBalance` is $500 (persisted dollars; `buildCapTargets` converts to
 * 50000¢) with an explicit overflow account. Month 1 deposits 30000 (under cap);
 * month 2 fills the remaining 20000 and routes the excess 10000 once to
 * investments. Paycheck: gross 1000 − tax 100 = net 90000.
 */
const cappedPayrollCareer = (): CareerEntry => ({
  ...createDefaultCareerEntry(0, 45, 65, 'career-cap'),
  enabled: true,
  startYearMonth: '2026-01',
  endYearMonth: '2026-12',
  annualRaiseRate: 0,
  sourceLines: [],
  paycheck: composedPaycheck({ gross: 1000, tax: 100, employeeRetirement: 0, employerMatch: 0 }),
  payPlans: [],
  depositPlan: {
    allocations: [
      sourceLine({
        id: 'cap-emergency',
        sourceId: EMERGENCY,
        mode: 'fixedAmount',
        contributionRate: 0,
        fixedAmount: 300,
        maxBalance: 500,
        overflowFallbackAccountId: INVESTMENTS
      })
    ],
    remainderAccountId: CHECKING,
    postingDay: 1
  }
});

const expenseEntry = (over: Partial<ExpenseEntry> & Pick<ExpenseEntry, 'id'>): ExpenseEntry => ({
  label: over.id,
  amount: 0,
  startDate: START,
  endDate: START,
  accountId: CHECKING,
  notes: '',
  originType: 'manual',
  importSourceId: null,
  importBatchId: null,
  createdAt: `${START}T00:00:00.000Z`,
  updatedAt: `${START}T00:00:00.000Z`,
  categoryId: null,
  fundingSource: `account:${CHECKING}`,
  ...over
});

const recurringEvent = (
  over: Partial<RecurringExpenseEvent> & Pick<RecurringExpenseEvent, 'id'>
): RecurringExpenseEvent => ({
  label: over.id,
  amount: 0,
  accountId: CHECKING,
  paymentAccountId: null,
  categoryId: null,
  cadence: 'monthly',
  rule: 'on_date',
  startDate: START,
  endDate: START,
  enabled: true,
  fundingSource: `account:${CHECKING}`,
  ...over
});

const purchase = (over: Partial<LargePurchase> & Pick<LargePurchase, 'id'>): LargePurchase => ({
  label: over.id,
  enabled: true,
  showOnGraph: true,
  yearMonth: '2026-01',
  yearMonthMarkerId: null,
  age: 45,
  amount: 0,
  fundingSource: `account:${CHECKING}`,
  ...over
});

/** One explicit dated inflow (never a magic top-up): funds `accountId` in `startYearMonth`. */
const inflow = (id: string, amountDollars: number, startYearMonth: string): CashflowItem => ({
  ...createDefaultCashflowItem('pension_1', 45, 65, 30),
  id,
  label: 'Residual top-up',
  enabled: true,
  cadence: 'one_time',
  direction: 'inflow',
  accountId: CHECKING,
  amount: amountDollars,
  startAge: 45,
  endAge: 45,
  startYearMonth,
  endYearMonth: startYearMonth
});

const loanFixture = (over: Partial<Loan> = {}): Loan => ({
  id: 'loan-1',
  label: 'loan-1',
  enabled: true,
  showOnGraph: true,
  startYearMonth: '2026-01',
  originalAmount: 1200,
  downPayment: 0,
  currentBalance: 1200,
  annualInterestRate: 0,
  minimumMonthlyPayment: 100,
  extraMonthlyPayment: 0,
  paymentSourceAccount: CHECKING,
  paymentSource: `account:${CHECKING}`,
  ...over
});

const loanLiability = (over: Partial<LiabilityDefinition> = {}): LiabilityDefinition => ({
  id: 'loan-1',
  kind: 'loan',
  openingBalance: 1200,
  annualInterestRate: 0,
  minimumMonthlyPayment: 100,
  endYearMonth: '2026-12',
  paymentDay: 1,
  ...over
});

// ---------------------------------------------------------------------------
// CA01 + CA02 + CA13 — payroll once, ordered allocations, conservation,
// deterministic ordered audit
// ---------------------------------------------------------------------------

describe('P5.5 CA01/CA02/CA13 — payroll, conservation and determinism', () => {
  it('posts payroll once to distinct destinations and reconciles the close', () => {
    const scenario = baseScenario();
    scenario.careerPlan = { enabled: true, entries: [payrollCareer()] };

    const run = projectFeatureScenario(scenario, { horizonMonths: 1 });

    expect(run.complete).toBe(true);
    // gross 100000 − tax 10000 − employee retirement 5000 = net 85000.
    expect(run.postings).toHaveLength(1);
    const facts = run.postings[0].posting.facts;
    expect(facts?.grossEarningsCents).toBe(100_000);
    expect(facts?.payrollTaxCents).toBe(10_000);
    expect(facts?.employeeRetirementCents).toBe(5_000);
    expect(facts?.netPayCents).toBe(85_000);
    // 10%-of-net allocation = 8500 to emergency, remainder 76500 to checking.
    expect(facts?.allocations).toHaveLength(1);
    expect(facts?.allocations[0]).toMatchObject({ accountId: EMERGENCY, requestedCents: 8_500, executedCents: 8_500 });

    const close = run.monthlyCloses[0];
    expect(accountBalance(close.snapshot, CHECKING)).toBe(76_500);
    expect(accountBalance(close.snapshot, EMERGENCY)).toBe(8_500);
    expect(accountBalance(close.snapshot, RETIREMENT)).toBe(5_000);

    // CA02 — opening + postings = close, and signed assets − liabilities.
    expect(run.opening.totals.netWorthCents).toBe(0);
    expect(close.closingCashCents).toBe(90_000);
    expect(close.totals.assetsCents - close.totals.liabilityCents).toBe(close.totals.netWorthCents);
    const postedDelta = run.postings.reduce((sum, record) => sum + record.expectedNetWorthDeltaCents, 0);
    expect(run.opening.totals.netWorthCents + postedDelta).toBe(run.totals.closingNetWorthCents);
  });

  it('composes a dated two-plan payroll with distinct employee/employer destinations and ordered percent + fixed allocations (CA01)', () => {
    const scenario = baseScenario();
    scenario.careerPlan = { enabled: true, entries: [composedPayrollCareer()] };

    const run = projectFeatureScenario(scenario, { horizonMonths: 5 });
    expect(run.complete).toBe(true);
    // One payroll posting per month (2026-01..2026-05); the plan switches at 2026-04.
    expect(run.postings).toHaveLength(5);
    const facts = run.postings.map((record) => record.posting.facts!);

    // Three pre-switch months (initial career-level plan).
    for (let index = 0; index < 3; index += 1) {
      const month = facts[index];
      expect(month.grossEarningsCents).toBe(200_000);
      expect(month.payrollTaxCents).toBe(30_000);
      expect(month.employeeRetirementCents).toBe(20_000);
      expect(month.employerRetirementCents).toBe(15_000);
      expect(month.employerHsaCents).toBe(0);
      expect(month.netPayCents).toBe(150_000);
      // gross conservation: gross = net + tax + employee 401k deferral.
      expect(month.grossEarningsCents).toBe(
        month.netPayCents + month.payrollTaxCents + month.employeeRetirementCents
      );
      // ordered percent (10% of 150000) then fixed ($50) allocation.
      expect(month.allocations.map((entry) => [entry.accountId, entry.requestedCents, entry.executedCents])).toEqual([
        [EMERGENCY, 15_000, 15_000],
        [HSA, 5_000, 5_000]
      ]);
    }

    // Two post-switch months (the 2026-04 plan).
    for (let index = 3; index < 5; index += 1) {
      const month = facts[index];
      expect(month.grossEarningsCents).toBe(300_000);
      expect(month.payrollTaxCents).toBe(50_000);
      expect(month.employeeRetirementCents).toBe(10_000);
      expect(month.employerRetirementCents).toBe(10_000);
      expect(month.netPayCents).toBe(240_000);
      expect(month.grossEarningsCents).toBe(
        month.netPayCents + month.payrollTaxCents + month.employeeRetirementCents
      );
      // ordered percent (20% of 240000) then fixed ($25) allocation.
      expect(month.allocations.map((entry) => [entry.accountId, entry.requestedCents, entry.executedCents])).toEqual([
        [EMERGENCY, 48_000, 48_000],
        [HSA, 2_500, 2_500]
      ]);
    }

    // Per-account postings for a pre-switch month: the employee deferral and the
    // employer match land in DISTINCT accounts; the ordered allocations hit their
    // own accounts; the remainder lands in checking.
    const deltasOf = (record: { accountChanges: readonly { accountId: string; deltaCents: number }[] }) =>
      new Map(record.accountChanges.map((change) => [change.accountId, change.deltaCents]));
    const january = deltasOf(run.postings[0]);
    expect(january.get(CHECKING)).toBe(130_000);
    expect(january.get(EMERGENCY)).toBe(15_000);
    expect(january.get(HSA)).toBe(5_000);
    expect(january.get(RETIREMENT)).toBe(20_000);
    expect(january.get(INVESTMENTS)).toBe(15_000);

    // ...and a post-switch month, with every changed amount.
    const april = deltasOf(run.postings[3]);
    expect(april.get(CHECKING)).toBe(189_500);
    expect(april.get(EMERGENCY)).toBe(48_000);
    expect(april.get(HSA)).toBe(2_500);
    expect(april.get(RETIREMENT)).toBe(10_000);
    expect(april.get(INVESTMENTS)).toBe(10_000);

    // Cumulative per-account stock across 3 pre-switch + 2 post-switch months.
    const may = run.monthlyCloses[4].snapshot;
    expect(accountBalance(may, CHECKING)).toBe(769_000);
    expect(accountBalance(may, EMERGENCY)).toBe(141_000);
    expect(accountBalance(may, HSA)).toBe(20_000);
    expect(accountBalance(may, RETIREMENT)).toBe(80_000);
    expect(accountBalance(may, INVESTMENTS)).toBe(65_000);

    // No duplicate employer deposit: exactly the configured match once per month.
    expect(run.postings.map((record) => record.posting.facts!.employerRetirementCents)).toEqual([
      15_000, 15_000, 15_000, 10_000, 10_000
    ]);

    // opening + postings = close (signed); each posting's declared net-worth delta
    // is gross − tax + employer match (internal transfers net to zero).
    expect(run.opening.totals.netWorthCents).toBe(0);
    expect(run.postings.map((record) => record.expectedNetWorthDeltaCents)).toEqual([
      185_000, 185_000, 185_000, 260_000, 260_000
    ]);
    const runDelta = run.postings.reduce((sum, record) => sum + record.expectedNetWorthDeltaCents, 0);
    expect(run.opening.totals.netWorthCents + runDelta).toBe(run.totals.closingNetWorthCents);
    expect(run.totals.closingNetWorthCents).toBe(1_075_000);
    const close = run.monthlyCloses[4];
    expect(close.closingCashCents).toBe(1_075_000);
    expect(close.totals.assetsCents - close.totals.liabilityCents).toBe(close.totals.netWorthCents);
  });

  it('bounds ordered net allocations to actual net pay and never borrows on over-subscription (CA01)', () => {
    const scenario = baseScenario();
    scenario.careerPlan = { enabled: true, entries: [oversubscribedPayrollCareer()] };

    const run = projectFeatureScenario(scenario, { horizonMonths: 1 });

    // Gross is posted once: a single direct payroll posting, no funding plan, no retry.
    expect(run.complete).toBe(true);
    expect(run.postings).toHaveLength(1);
    expect(run.plans).toHaveLength(0);

    // net = gross 100000 − tax 10000 = 90000 cents; the four fixed requests total 105000.
    const facts = run.postings[0].posting.facts!;
    expect(facts.grossEarningsCents).toBe(100_000);
    expect(facts.payrollTaxCents).toBe(10_000);
    expect(facts.netPayCents).toBe(90_000);
    expect(facts.employeeRetirementCents).toBe(0);
    expect(facts.employerRetirementCents).toBe(0);

    // Configured order deposits until net pay is exhausted: a and b fully, c only
    // the remaining 10000, d skipped at 0 remaining. No reallocation or borrowing.
    expect(
      facts.allocations.map((entry) => [entry.lineId, entry.accountId, entry.requestedCents, entry.executedCents])
    ).toEqual([
      ['over-a', EMERGENCY, 50_000, 50_000],
      ['over-b', HSA, 30_000, 30_000],
      ['over-c', INVESTMENTS, 20_000, 10_000],
      ['over-d', RETIREMENT, 5_000, 0]
    ]);
    const totalRequested = facts.allocations.reduce((sum, entry) => sum + entry.requestedCents, 0);
    const totalExecuted = facts.allocations.reduce((sum, entry) => sum + entry.executedCents, 0);
    expect(totalRequested).toBe(105_000);
    expect(totalExecuted).toBe(90_000); // exactly net pay, never more

    // Expected account closes: the funded allocations and an exact-zero remainder.
    const close = run.monthlyCloses[0];
    expect(accountBalance(close.snapshot, CHECKING)).toBe(0);
    expect(accountBalance(close.snapshot, EMERGENCY)).toBe(50_000);
    expect(accountBalance(close.snapshot, HSA)).toBe(30_000);
    expect(accountBalance(close.snapshot, INVESTMENTS)).toBe(10_000);
    expect(accountBalance(close.snapshot, RETIREMENT)).toBe(0);
    expect(close.closingCashCents).toBe(90_000);

    // Audit matches: the posting's account deltas are exactly the executed deposits
    // (the skipped allocation contributes no delta at all).
    const deltaByAccount = new Map(
      run.postings[0].accountChanges.map((change) => [change.accountId, change.deltaCents])
    );
    expect(deltaByAccount.get(EMERGENCY)).toBe(50_000);
    expect(deltaByAccount.get(HSA)).toBe(30_000);
    expect(deltaByAccount.get(INVESTMENTS)).toBe(10_000);
    expect(deltaByAccount.get(RETIREMENT)).toBeUndefined();

    // No implicit borrowing / negative cash; signed close reconciles opening + postings.
    expect(close.snapshot.accounts.every((account) => account.balanceCents >= 0)).toBe(true);
    expect(run.opening.totals.netWorthCents).toBe(0);
    expect(run.postings[0].expectedNetWorthDeltaCents).toBe(90_000);
    expect(run.totals.closingNetWorthCents).toBe(90_000);
    expect(close.totals.assetsCents - close.totals.liabilityCents).toBe(close.totals.netWorthCents);

    // Exact unmet diagnostics: c short by 10000, d skipped at 0 remaining.
    expect(
      run.diagnostics.some(
        (message) =>
          message.includes('"over-c"') && message.includes('unmet by 10000') && message.includes('net pay exhausted')
      )
    ).toBe(true);
    expect(
      run.diagnostics.some(
        (message) =>
          message.includes('"over-d"') && message.includes('of 5000 cents is unmet') && message.includes('net pay exhausted')
      )
    ).toBe(true);
  });

  it('resolves overlapping careers by most-recent start and never double-posts payroll (CA01)', () => {
    const scenario = baseScenario();
    scenario.careerPlan = {
      enabled: true,
      entries: [
        overlapCareer({ id: 'career-early', startYearMonth: '2026-01', gross: 2000, tax: 200, fixedMonthly: 300 }),
        overlapCareer({ id: 'career-late', startYearMonth: '2026-03', gross: 3000, tax: 500, fixedMonthly: 500 })
      ]
    };
    const before = JSON.stringify(scenario);

    const run = projectFeatureScenario(scenario, { horizonMonths: 4 });

    expect(run.complete).toBe(true);
    // Exactly one payroll posting per month (2026-01..04): A, A, B, B — never both.
    expect(run.postings).toHaveLength(4);
    const facts = run.postings.map((record) => record.posting.facts!);

    // 2026-01/02: career A. net = 200000 − 20000 = 180000; fixed 300 → emergency.
    for (let index = 0; index < 2; index += 1) {
      const month = facts[index];
      expect(month.grossEarningsCents).toBe(200_000);
      expect(month.payrollTaxCents).toBe(20_000);
      expect(month.netPayCents).toBe(180_000);
      expect(month.allocations.map((entry) => [entry.accountId, entry.executedCents])).toEqual([[EMERGENCY, 30_000]]);
    }

    // 2026-03/04: career B. net = 300000 − 50000 = 250000; fixed 500 → emergency.
    for (let index = 2; index < 4; index += 1) {
      const month = facts[index];
      expect(month.grossEarningsCents).toBe(300_000);
      expect(month.payrollTaxCents).toBe(50_000);
      expect(month.netPayCents).toBe(250_000);
      expect(month.allocations.map((entry) => [entry.accountId, entry.executedCents])).toEqual([[EMERGENCY, 50_000]]);
    }

    // No double income: one occurrence per month, no duplicate payroll ids.
    const occurrenceIds = run.postings.map((record) => record.posting.occurrenceId);
    expect(occurrenceIds).toEqual([
      'income:career-early:2026-01-01',
      'income:career-early:2026-02-01',
      'income:career-late:2026-03-01',
      'income:career-late:2026-04-01'
    ]);
    expect(new Set(occurrenceIds).size).toBe(occurrenceIds.length);

    // Hand-computed closes = 2×A + 2×B (no month posts both careers).
    const close = run.monthlyCloses[3];
    expect(accountBalance(close.snapshot, CHECKING)).toBe(700_000); // 2×150000 + 2×200000
    expect(accountBalance(close.snapshot, EMERGENCY)).toBe(160_000); // 2×30000 + 2×50000
    expect(close.closingCashCents).toBe(860_000); // 2×180000 + 2×250000
    expect(run.totals.closingNetWorthCents).toBe(860_000);
    expect(close.totals.assetsCents - close.totals.liabilityCents).toBe(close.totals.netWorthCents);

    // opening + postings = close; each posting's declared delta is net (gross − tax).
    expect(run.opening.totals.netWorthCents).toBe(0);
    expect(run.postings.map((record) => record.expectedNetWorthDeltaCents)).toEqual([
      180_000, 180_000, 250_000, 250_000
    ]);
    const postedDelta = run.postings.reduce((sum, record) => sum + record.expectedNetWorthDeltaCents, 0);
    expect(run.opening.totals.netWorthCents + postedDelta).toBe(run.totals.closingNetWorthCents);

    // The caller's scenario config is never mutated.
    expect(JSON.stringify(scenario)).toBe(before);
  });

  it('caps an incoming net allocation at maxBalance and routes only the excess once to the configured overflow account (CA01)', () => {
    const scenario = baseScenario();
    scenario.careerPlan = { enabled: true, entries: [cappedPayrollCareer()] };
    const before = JSON.stringify(scenario);

    const run = projectFeatureScenario(scenario, { horizonMonths: 2 });

    expect(run.complete).toBe(true);
    // One payroll posting per month; the cap-phase existing-excess pass has no
    // excess to move (balance ≤ cap), so it never commits — no duplicate posting.
    expect(run.postings).toHaveLength(2);

    const firstFacts = run.postings[0].posting.facts!;
    expect(firstFacts.grossEarningsCents).toBe(100_000);
    expect(firstFacts.payrollTaxCents).toBe(10_000);
    expect(firstFacts.netPayCents).toBe(90_000);
    expect(
      firstFacts.allocations.map((entry) => [entry.accountId, entry.requestedCents, entry.executedCents])
    ).toEqual([[EMERGENCY, 30_000, 30_000]]);

    // Month 1: the $300 allocation fits under the $500 cap → no overflow. (The
    // posting has no investments delta, confirmed by the audit map below.)
    const jan = run.monthlyCloses[0];
    expect(accountBalance(jan.snapshot, CHECKING)).toBe(60_000); // 90000 net − 30000 allocation
    expect(accountBalance(jan.snapshot, EMERGENCY)).toBe(30_000);
    expect(accountBalance(jan.snapshot, INVESTMENTS)).toBe(0);
    expect(accountBalance(jan.snapshot, EMERGENCY)).toBeLessThanOrEqual(50_000);
    expect(jan.closingCashCents).toBe(90_000);
    expect(jan.totals.netWorthCents).toBe(90_000);

    // Month 2: fills to exactly the $500 cap (20000) and routes the excess 10000 once.
    const feb = run.monthlyCloses[1];
    expect(accountBalance(feb.snapshot, CHECKING)).toBe(120_000);
    expect(accountBalance(feb.snapshot, EMERGENCY)).toBe(50_000); // exactly the cap, never over
    expect(accountBalance(feb.snapshot, INVESTMENTS)).toBe(10_000);
    expect(feb.closingCashCents).toBe(180_000);
    expect(feb.totals.netWorthCents).toBe(180_000);
    // Exactly one overflow diagnostic, in the second month, for the exact excess.
    const overflowDiagnostics = run.diagnostics.filter((message) => message.includes('incoming overflow'));
    expect(overflowDiagnostics).toHaveLength(1);
    expect(overflowDiagnostics[0]).toContain('10000');
    expect(overflowDiagnostics[0]).toContain('2026-02');
    expect(overflowDiagnostics[0]).toContain(EMERGENCY);
    expect(overflowDiagnostics[0]).toContain(INVESTMENTS);

    // Exact posting/audit account deltas — no loss or creation of cents.
    const janDelta = new Map(run.postings[0].accountChanges.map((change) => [change.accountId, change.deltaCents]));
    expect(janDelta.get(CHECKING)).toBe(60_000);
    expect(janDelta.get(EMERGENCY)).toBe(30_000);
    expect(janDelta.get(INVESTMENTS)).toBeUndefined();

    const febDelta = new Map(run.postings[1].accountChanges.map((change) => [change.accountId, change.deltaCents]));
    expect(febDelta.get(CHECKING)).toBe(60_000);
    expect(febDelta.get(EMERGENCY)).toBe(20_000);
    expect(febDelta.get(INVESTMENTS)).toBe(10_000);

    // Closing signed net worth is consistent and preserves every cent across months.
    expect(run.opening.totals.netWorthCents).toBe(0);
    expect(run.postings.map((record) => record.expectedNetWorthDeltaCents)).toEqual([90_000, 90_000]);
    expect(feb.totals.assetsCents - feb.totals.liabilityCents).toBe(feb.totals.netWorthCents);
    expect(feb.totals.netWorthCents).toBe(2 * 90_000);

    // The caller's scenario config is never mutated.
    expect(JSON.stringify(scenario)).toBe(before);
  });

  it('reconciles a multi-month close grid and sums actual months (annual = Σ months)', () => {
    const scenario = baseScenario();
    scenario.careerPlan = {
      enabled: true,
      entries: [
        payrollCareer({
          paycheck: {
            payFrequency: 'monthly',
            categories: [
              {
                id: 'cat-earnings',
                label: 'Earnings',
                kind: 'earning',
                lines: [{ id: 'line-earnings', label: 'Regular', amount: 1000, mode: 'amount' }]
              }
            ]
          },
          depositPlan: { allocations: [], remainderAccountId: CHECKING, postingDay: 1 }
        })
      ]
    };
    scenario.expenses = {
      ...scenario.expenses,
      entries: [expenseEntry({ id: 'plan-feb', amount: 500, startDate: '2026-02-01', endDate: '2026-02-01' })],
      recurringEvents: []
    };

    const run = projectFeatureScenario(scenario, { horizonMonths: 3 });

    // $1,000/mo net (no deductions) − $500 one-time planner debit in Feb.
    expect(run.monthlyCloses.map((close) => close.closingCashCents)).toEqual([100_000, 150_000, 250_000]);
    expect(run.totals.executedNetCents).toBe(50_000); // only the funded planner debit is a plan.
    expect(run.totals.closingCashCents).toBe(250_000);
    expect(run.monthlyCloses[2].totals.assetsCents - run.monthlyCloses[2].totals.liabilityCents).toBe(
      run.monthlyCloses[2].totals.netWorthCents
    );
  });

  it('reconciles a 24-month composed run by its actual months (annual = Σ months, no double annual income)', () => {
    const scenario = baseScenario();
    // Two full payroll years ($1,000 gross / $100 tax / $50 employee 401k monthly,
    // 10% of net → emergency, remainder → checking) plus one $500 planner debit.
    scenario.careerPlan = {
      enabled: true,
      entries: [payrollCareer({ endYearMonth: '2027-12' })]
    };
    scenario.expenses = {
      ...scenario.expenses,
      entries: [expenseEntry({ id: 'plan-once', amount: 500, startDate: '2026-02-01', endDate: '2026-02-01' })],
      recurringEvents: []
    };

    const run = projectFeatureScenario(scenario, { horizonMonths: 24 });
    const report = run.report;

    expect(run.complete).toBe(true);
    expect(report.months).toHaveLength(24);
    expect(report.years).toHaveLength(2);
    expect(report.years.map((year) => year.label)).toEqual(['2026', '2027']);
    expect(report.years.map((year) => year.monthCount)).toEqual([12, 12]);

    // Independent monthly payroll facts: gross 100000, tax 10000, 401k 5000 → net 85000.
    const monthlyGross = 100_000;
    const monthlyNet = 85_000;

    const monthsOf = (label: string) => report.months.filter((month) => month.yearMonth.startsWith(label));
    const sumFlow = (
      label: string,
      key:
        | 'grossEarningsCents'
        | 'netPayCents'
        | 'payrollTaxCents'
        | 'employeeRetirementCents'
        | 'executedSpendingCents'
        | 'netWorthDeltaCents'
    ): number => monthsOf(label).reduce((total, month) => total + month.flow[key], 0);

    // Each year's flow is the safe-cent sum of that year's *actual* month flows —
    // never an independent annual budget and never last-month × 12.
    for (const year of report.years) {
      expect(year.flow.grossEarningsCents).toBe(sumFlow(year.label, 'grossEarningsCents'));
      expect(year.flow.netPayCents).toBe(sumFlow(year.label, 'netPayCents'));
      expect(year.flow.payrollTaxCents).toBe(sumFlow(year.label, 'payrollTaxCents'));
      expect(year.flow.employeeRetirementCents).toBe(sumFlow(year.label, 'employeeRetirementCents'));
      expect(year.flow.executedSpendingCents).toBe(sumFlow(year.label, 'executedSpendingCents'));
      expect(year.flow.netWorthDeltaCents).toBe(sumFlow(year.label, 'netWorthDeltaCents'));
    }

    // Independently computed annual flows (24 payroll months; one $500 planner
    // debit lands in Feb 2026, so 2026 spends 50000 and 2027 spends 0).
    expect(report.years.map((year) => year.flow.grossEarningsCents)).toEqual([12 * monthlyGross, 12 * monthlyGross]);
    expect(report.years.map((year) => year.flow.netPayCents)).toEqual([12 * monthlyNet, 12 * monthlyNet]);
    expect(report.years.map((year) => year.flow.payrollTaxCents)).toEqual([120_000, 120_000]);
    expect(report.years.map((year) => year.flow.employeeRetirementCents)).toEqual([60_000, 60_000]);
    expect(report.years.map((year) => year.flow.executedSpendingCents)).toEqual([50_000, 0]);

    // No double annual income: the annual groups re-add nothing beyond the actual
    // months (Σ years === Σ months), and 2027 is its own year, not cumulative.
    const summedMonthsNet = report.months.reduce((total, month) => total + month.flow.netPayCents, 0);
    const summedYearsNet = report.years.reduce((total, year) => total + year.flow.netPayCents, 0);
    expect(summedMonthsNet).toBe(24 * monthlyNet);
    expect(summedYearsNet).toBe(summedMonthsNet);
    expect(report.years[1].flow.netPayCents).not.toBe(summedYearsNet);

    // Opening/closing stocks are the first opening / last closing observation of
    // the year, never a sum.
    for (const year of report.years) {
      const months = monthsOf(year.label);
      expect(year.firstYearMonth).toBe(months[0].yearMonth);
      expect(year.lastYearMonth).toBe(months[months.length - 1].yearMonth);
      expect(year.opening).toEqual(months[0].opening);
      expect(year.closing).toEqual(months[months.length - 1].closing);
    }

    // Independently computed closing stocks: checking +76500/mo (−50000 in Feb
    // 2026), emergency +8500/mo, 401k +5000/mo.
    expect(run.monthlyCloses[0].openingCashCents).toBe(0);
    expect(run.monthlyCloses[11].closingCashCents).toBe(1_030_000); // 868000 + 102000 + 60000
    expect(report.years[0].closing.netWorthCents).toBe(1_030_000);
    expect(report.years[1].opening.netWorthCents).toBe(1_030_000);
    expect(report.years[1].closing.netWorthCents).toBe(2_110_000);
    expect(run.monthlyCloses[23].closingCashCents).toBe(2_110_000);

    // Signed assets − liabilities for the run (no liabilities configured here).
    const closing = report.totals.closing;
    expect(closing.liabilityCents).toBe(0);
    expect(closing.assetsCents - closing.liabilityCents).toBe(closing.netWorthCents);
    expect(run.totals.closingNetWorthCents).toBe(closing.netWorthCents);
    expect(run.totals.closingNetWorthCents).toBe(2_110_000);
    expect(run.totals.closingCashCents).toBe(closing.assetsCents);
  });

  it('produces a byte-identical ordered audit and asserts the frozen chronological/phase-band order (CA13)', () => {
    const scenario = baseScenario();
    scenario.careerPlan = { enabled: true, entries: [payrollCareer()] };
    scenario.loans = [loanFixture()];
    scenario.liabilities = [loanLiability({ openingBalance: 300, minimumMonthlyPayment: 100, endYearMonth: '2026-03' })];
    // Known fixed-date competing definitions across mandatory bands on the same
    // day (2026-01-01): loan (band 1) → card (band 3) → planner (band 4), plus a
    // discretionary purchase on 2026-02-01. The frozen order is
    // `date → phase → band → intra-stream`, so a plain lexicographic sort of the
    // occurrence ids (`card:` < `loan:` < `planner:`) is NOT the execution order.
    scenario.cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE, {
        id: 'card-ca13',
        amount: 10,
        startYearMonth: '2026-01',
        endYearMonth: '2026-03',
        paymentDay: 1,
        funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] }
      })
    ];
    scenario.expenses = {
      ...scenario.expenses,
      entries: [expenseEntry({ id: 'plan-ca13', amount: 500, startDate: '2026-01-01', endDate: '2026-01-01' })],
      recurringEvents: []
    };
    scenario.largePurchases = [purchase({ id: 'buy-ca13', amount: 100, yearMonth: '2026-02' })];

    const first = projectFeatureScenario(scenario, { horizonMonths: 3 });
    const second = projectFeatureScenario(scenario, { horizonMonths: 3 });

    expect(JSON.stringify(second.plans)).toBe(JSON.stringify(first.plans));
    expect(JSON.stringify(second.postings)).toBe(JSON.stringify(first.postings));
    expect(JSON.stringify(second.monthlyCloses)).toBe(JSON.stringify(first.monthlyCloses));
    expect(JSON.stringify(second.diagnostics)).toBe(JSON.stringify(first.diagnostics));

    // Concrete frozen order, independently derived from the config and the band
    // map (loan 1_000+10, card 3_000+100, planner 4_000+0) on the fixed dates:
    //   Jan 1: loan installment → card → planner      (three mandatory bands)
    //   Feb 1: loan installment → card → purchase     (mandatory before discretionary)
    //   Mar 1: loan installment → card
    const expectedOccurrenceIds = [
      'loan:loan-1:installment:2026-01-01',
      'card:card-ca13:2026-01-01',
      'planner:plan-ca13:2026-01-01',
      'loan:loan-1:installment:2026-02-01',
      'card:card-ca13:2026-02-01',
      'spending:purchase:buy-ca13:2026-02-01',
      'loan:loan-1:installment:2026-03-01',
      'card:card-ca13:2026-03-01'
    ];
    const occurrenceIds = first.plans.map((plan) => plan.occurrenceId);
    expect(occurrenceIds).toEqual(expectedOccurrenceIds);

    // The concrete order is date-major then phase/band — it is explicitly NOT the
    // lexicographic sort of the ids (the prior weak assertion).
    expect([...occurrenceIds].sort()).not.toEqual(occurrenceIds);
    expect(first.plans.map((plan) => plan.date)).toEqual([
      '2026-01-01',
      '2026-01-01',
      '2026-01-01',
      '2026-02-01',
      '2026-02-01',
      '2026-02-01',
      '2026-03-01',
      '2026-03-01'
    ]);
    expect(first.plans.map((plan) => plan.phase)).toEqual([
      'mandatory',
      'mandatory',
      'mandatory',
      'mandatory',
      'mandatory',
      'discretionary',
      'mandatory',
      'mandatory'
    ]);
  });
});

// ---------------------------------------------------------------------------
// CA05 — debt is funded-only (full / partial / zero)
// ---------------------------------------------------------------------------

describe('P5.5 CA05 — debt payment is funded-only', () => {
  const project = (checkingDollars: number) => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, checkingDollars);
    scenario.loans = [loanFixture()];
    scenario.liabilities = [loanLiability()];
    return projectFeatureScenario(scenario, { horizonMonths: 1 });
  };

  it('reduces cash and debt equally when fully funded', () => {
    const run = project(2000); // $2,000 available vs $100 required (0% APR, 12 months → 1200/12).
    const plan = run.plans.find((entry) => entry.handlerId === LOAN_INSTALLMENT_HANDLER_ID);
    expect(plan?.requestedCents).toBe(10_000);
    expect(plan?.executedCents).toBe(10_000);
    expect(plan?.shortfallCents).toBe(0);
    const close = run.monthlyCloses[0];
    expect(accountBalance(close.snapshot, CHECKING)).toBe(190_000);
    expect(liabilityPrincipal(close.snapshot, 'loan-1')).toBe(110_000);
    expect(close.totals.netWorthCents).toBe(80_000); // assets 190000 − debt 110000
  });

  it('retains the unpaid instalment when only partially funded', () => {
    const run = project(40); // $40 available vs $100 required.
    const plan = run.plans.find((entry) => entry.handlerId === LOAN_INSTALLMENT_HANDLER_ID);
    expect(plan?.executedCents).toBe(4_000);
    expect(plan?.shortfallCents).toBe(6_000);
    const close = run.monthlyCloses[0];
    expect(accountBalance(close.snapshot, CHECKING)).toBe(0);
    expect(liabilityPrincipal(close.snapshot, 'loan-1')).toBe(116_000);
  });

  it('debits nothing and journals nothing when no source can fund', () => {
    const run = project(0);
    expect(run.plans.some((entry) => entry.handlerId === LOAN_INSTALLMENT_HANDLER_ID)).toBe(false);
    expect(run.postings).toHaveLength(0);
    expect(liabilityPrincipal(run.monthlyCloses[0].snapshot, 'loan-1')).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// CA06 — 0% adaptive payoff and an ordinary card's twelve payments
// ---------------------------------------------------------------------------

describe('P5.5 CA06 — card schedules', () => {
  it('pays a $100 permanent-0% balance as 33.34 / 33.33 / 33.33', () => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, 100);
    scenario.liabilities = [{ id: 'card-liab', kind: 'zeroInterestCard', openingBalance: 100 }];
    scenario.cardPlans = [
      createDefaultZeroInterestCardPlan(REFERENCE, {
        id: 'card-1',
        liabilityId: 'card-liab',
        initialBalance: 100,
        startYearMonth: '2026-01',
        targetYearMonth: '2026-03',
        paymentDay: 1,
        funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] }
      })
    ];

    const run = projectFeatureScenario(scenario, { horizonMonths: 3 });
    const installments = run.plans
      .filter((plan) => plan.definitionId === 'card:card-1')
      .map((plan) => plan.executedCents);
    expect(installments).toEqual([3_334, 3_333, 3_333]);
    expect(installments.reduce((sum, cents) => sum + cents, 0)).toBe(10_000);
    expect(accountBalance(run.monthlyCloses[2].snapshot, CHECKING)).toBe(0);
    expect(liabilityPrincipal(run.monthlyCloses[2].snapshot, 'card-liab')).toBe(0);
  });

  it('runs an ordinary card for twelve payments and creates no debt', () => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, 1000);
    scenario.cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE, {
        id: 'ordinary-1',
        amount: 10,
        startYearMonth: '2026-01',
        endYearMonth: '2026-12',
        paymentDay: 1,
        funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] }
      })
    ];

    const run = projectFeatureScenario(scenario, { horizonMonths: 12 });
    const payments = run.plans.filter((plan) => plan.definitionId === 'card:ordinary-1');
    expect(payments).toHaveLength(12);
    expect(payments.every((plan) => plan.executedCents === 1_000)).toBe(true);
    expect(run.monthlyCloses[11].snapshot.liabilities).toHaveLength(0);
    expect(accountBalance(run.monthlyCloses[11].snapshot, CHECKING)).toBe(88_000); // 100000 − 12000
  });

  it('recomputes an unfunded permanent-0% installment and pays the residual in one final obligation (CA06)', () => {
    const scenario = baseScenario();
    // Jan opens with exactly one $33.34 installment; nothing is left for Feb.
    setOpening(scenario, CHECKING, 33.34);
    scenario.liabilities = [{ id: 'card-liab', kind: 'zeroInterestCard', openingBalance: 100 }];
    scenario.cardPlans = [
      createDefaultZeroInterestCardPlan(REFERENCE, {
        id: 'card-1',
        liabilityId: 'card-liab',
        initialBalance: 100,
        startYearMonth: '2026-01',
        targetYearMonth: '2026-03',
        paymentDay: 1,
        funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] }
      })
    ];
    // An explicit dated inflow (never a magic mechanism): March income funds the
    // recomputed residual before that month's mandatory card obligation.
    scenario.cashflowItems = [inflow('residual-topup', 66.66, '2026-03')];

    const run = projectFeatureScenario(scenario, { horizonMonths: 3 });
    expect(run.complete).toBe(true);

    // Committed obligations: Jan 3334, then the recomputed final 6666. The
    // zero-funded Feb attempt fabricates no plan row.
    const installments = run.plans.filter((plan) => plan.definitionId === 'card:card-1');
    expect(
      installments.map(
        (plan) => `${plan.yearMonth}:${plan.requestedCents}/${plan.executedCents}/${plan.shortfallCents}`
      )
    ).toEqual(['2026-01:3334/3334/0', '2026-03:6666/6666/0']);

    // Feb's positive quote is retained as D16 evidence: after Jan the remaining
    // 6666 splits over the two remaining dates → ceil(6666/2) = 3333, executed 0.
    const february = run.fundingOutcomes.find(
      (outcome) => outcome.definitionId === 'card:card-1' && outcome.yearMonth === '2026-02'
    );
    expect(february).toBeDefined();
    expect(february?.committed).toBe(false);
    expect(february?.plan.request.requestedCents).toBe(3_333);
    expect(february?.plan.executedCents).toBe(0);
    expect(february?.plan.shortfallCents).toBe(3_333);
    expect(february?.plan.status).toBe('unfunded');
    // Exactly Jan/Feb/Mar quotes — the coincident payoff issued no extra quote.
    expect(run.fundingOutcomes.filter((outcome) => outcome.definitionId === 'card:card-1')).toHaveLength(3);

    // Debt snapshots: 6666 retained after Jan, still 6666 after the unfunded Feb,
    // then cleared exactly by the single March obligation.
    expect(liabilityPrincipal(run.monthlyCloses[0].snapshot, 'card-liab')).toBe(6_666);
    expect(liabilityPrincipal(run.monthlyCloses[1].snapshot, 'card-liab')).toBe(6_666);
    expect(liabilityPrincipal(run.monthlyCloses[2].snapshot, 'card-liab')).toBe(0);
    expect(accountBalance(run.monthlyCloses[0].snapshot, CHECKING)).toBe(0);
    expect(accountBalance(run.monthlyCloses[1].snapshot, CHECKING)).toBe(0);
    expect(accountBalance(run.monthlyCloses[2].snapshot, CHECKING)).toBe(0);

    // Exactly one card debit per funded date; the coincident payoff no-ops so the
    // residual principal is never charged twice for the same liability/date.
    const cardPostings = run.postings.filter((record) => record.posting.definitionId === 'card:card-1');
    expect(cardPostings.map((record) => record.posting.date)).toEqual(['2026-01-01', '2026-03-01']);
    expect(run.postings.some((record) => record.posting.definitionId === 'card:card-1:payoff')).toBe(false);
    const principalReduced = cardPostings.reduce(
      (sum, record) =>
        sum + record.liabilityChanges.reduce((inner, change) => inner + (change.principalDeltaCents ?? 0), 0),
      0
    );
    expect(principalReduced).toBe(-10_000);

    // Untaxed 0% funding keeps the gross = net + tax + penalty identity.
    for (const plan of installments) {
      expect(plan.grossDebitCents).toBe(plan.executedCents + plan.taxCents + plan.penaltyCents);
      expect(plan.taxCents).toBe(0);
      expect(plan.penaltyCents).toBe(0);
    }

    // No borrowing / negative account anywhere in the run.
    expect(
      run.monthlyCloses.every((close) => close.snapshot.accounts.every((account) => account.balanceCents >= 0))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CA07 — 4% basis, frozen from the observed balance; explicit 0 stays zero
// ---------------------------------------------------------------------------

describe('P5.5 CA07 — retirement percentage basis', () => {
  const percentSource = (rate: number) =>
    createDefaultRetirementWithdrawalSource(REFERENCE, {
      id: 'ret-1',
      accountId: RETIREMENT,
      mode: 'percentOfInitialBalance',
      initialWithdrawalRatePercent: rate,
      firstWithdrawalDate: START,
      initialWithdrawalValuationDate: START,
      paymentDay: 1,
      fallbackAccountIds: []
    });

  it('freezes 4% of the $100,000 opening balance and reconciles 12 months', () => {
    const scenario = baseScenario();
    setOpening(scenario, RETIREMENT, 100_000);
    scenario.withdrawal = { ...scenario.withdrawal, sourceLines: [percentSource(4)], fallbackAccountIds: [] };

    const run = projectFeatureScenario(scenario, { horizonMonths: 12 });
    const withdrawals = run.plans.filter((plan) => plan.handlerId === RETIREMENT_HANDLER_ID);
    expect(withdrawals).toHaveLength(12);
    // First cumulative share of a $4,000 annual target = 400000/12 → 33333.
    expect(withdrawals[0].requestedCents).toBe(33_333);
    expect(withdrawals.reduce((sum, plan) => sum + plan.executedCents, 0)).toBe(400_000);
    expect(accountBalance(run.monthlyCloses[11].snapshot, RETIREMENT)).toBe(9_600_000);
  });

  it('keeps an explicit 0% source at zero (no fabricated withdrawal)', () => {
    const scenario = baseScenario();
    setOpening(scenario, RETIREMENT, 100_000);
    scenario.withdrawal = { ...scenario.withdrawal, sourceLines: [percentSource(0)], fallbackAccountIds: [] };

    const run = projectFeatureScenario(scenario, { horizonMonths: 3 });
    expect(run.plans.some((plan) => plan.handlerId === RETIREMENT_HANDLER_ID)).toBe(false);
    expect(accountBalance(run.monthlyCloses[2].snapshot, RETIREMENT)).toBe(10_000_000);
  });
});

// ---------------------------------------------------------------------------
// CA08 — exact APY (full / 24 months / clipped partial) and day-31 clamp
// ---------------------------------------------------------------------------

describe('P5.5 CA08 — exact APY and day-31 clamp', () => {
  it('compounds a stated 6.5% APY exactly (monthly, no drift)', () => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, 10_000);
    setRate(scenario, CHECKING, 6.5);

    const oneMonth = projectFeatureScenario(scenario, { horizonMonths: 1 });
    const monthlyGrowth = Math.round(1_000_000 * (Math.pow(1.065, 1 / 12) - 1)); // 5262¢ (independent)
    expect(oneMonth.monthlyCloses[0].growthCents).toBe(monthlyGrowth);
    expect(accountBalance(oneMonth.monthlyCloses[0].snapshot, CHECKING)).toBe(1_000_000 + monthlyGrowth);

    // Two years: (1 + monthlyRate)^24 = 1.065^2, but each month rounds to cents.
    let closing = 1_000_000;
    const monthlyRate = Math.pow(1.065, 1 / 12) - 1;
    for (let month = 0; month < 24; month += 1) {
      closing += Math.round(closing * monthlyRate);
    }
    const twoYears = projectFeatureScenario(scenario, { horizonMonths: 24 });
    expect(accountBalance(twoYears.monthlyCloses[23].snapshot, CHECKING)).toBe(closing); // 1134226¢
    expect(accountBalance(twoYears.monthlyCloses[23].snapshot, CHECKING)).not.toBe(1_134_225); // ≠ naive single-round
  });

  it('uses a clipped partial-month exponent starting mid-month', () => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, 10_000);
    setRate(scenario, CHECKING, 6.5);

    const run = projectFeatureScenario(scenario, { startDate: '2026-01-16', horizonMonths: 1 });
    const fraction = 16 / 31; // covered Jan 16–31 inclusive.
    expect(run.monthlyCloses[0].monthFraction).toBeCloseTo(fraction, 10);
    const expected = Math.round(1_000_000 * (Math.pow(1.065, fraction / 12) - 1)); // 2712¢ (independent)
    expect(run.monthlyCloses[0].growthCents).toBe(expected);
  });

  it('clamps a monthly day-31 target to the last valid day of a short month', () => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, 100);
    scenario.expenses = {
      ...scenario.expenses,
      entries: [],
      recurringEvents: [
        recurringEvent({
          id: 'rec-jan',
          amount: 10,
          startDate: '2026-01-31',
          endDate: '2026-02-28',
          dayOfMonth: 31
        })
      ]
    };

    const run = projectFeatureScenario(scenario, { horizonMonths: 2 });
    const occurrenceIds = run.plans.map((plan) => plan.occurrenceId);
    expect(occurrenceIds).toContain('recurrence:rec-jan:2026-01-31');
    expect(occurrenceIds).toContain('recurrence:rec-jan:2026-02-28'); // clamped, not skipped
    expect(occurrenceIds).not.toContain('recurrence:rec-jan:2026-02-31');
  });
});

// ---------------------------------------------------------------------------
// CA04 — tax identity and the non-qualified HSA waiver
// ---------------------------------------------------------------------------

describe('P5.5 CA04 — withholding identity and HSA waiver', () => {
  it('keeps gross = net + tax + penalty for independent components', () => {
    const retirement = buildWithholdingProfile(
      {
        accountType: 'retirement401k',
        withdrawalPolicy: { withdrawalTaxRate: 3, penaltyRate: 0 }
      },
      { hsaQualifiedMedical: false },
      { withdrawalDate: START, dateOfBirth: DOB }
    );
    const taxed = grossToNet(100_000, retirement); // $1,000 gross at 3% → $30 tax.
    expect(taxed.taxCents).toBe(3_000);
    expect(taxed.penaltyCents).toBe(0);
    expect(taxed.netCents).toBe(97_000);
    expect(taxed.grossCents).toBe(taxed.netCents + taxed.taxCents + taxed.penaltyCents);
  });

  it('applies the non-qualified HSA penalty before the waiver age and waives it at 65', () => {
    const hsaAccount = {
      accountType: 'hsa' as const,
      withdrawalPolicy: {
        withdrawalTaxRate: 0,
        penaltyRate: 0,
        hsa: { nonQualifiedPenaltyRate: 20, nonQualifiedPenaltyWaiverAge: 65 }
      }
    };
    const before = buildWithholdingProfile(
      hsaAccount,
      { hsaQualifiedMedical: false },
      { withdrawalDate: '2026-01-01', dateOfBirth: '1980-01-01' } // age 46.
    );
    const beforePosting = grossToNet(60_000, before);
    expect(beforePosting.penaltyCents).toBe(12_000); // 20% of $600.
    expect(beforePosting.netCents).toBe(48_000);

    const after = buildWithholdingProfile(
      hsaAccount,
      { hsaQualifiedMedical: false },
      { withdrawalDate: '2026-01-01', dateOfBirth: '1960-01-01' } // age 66 → waived.
    );
    const afterPosting = grossToNet(60_000, after);
    expect(afterPosting.penaltyCents).toBe(0);
    expect(afterPosting.netCents).toBe(60_000);
    expect(isHsaPenaltyWaived('2026-01-01', '1960-01-01')).toBe(true);
    expect(isHsaPenaltyWaived('2026-01-01', '1980-01-01')).toBe(false);

    const qualified = buildWithholdingProfile(
      hsaAccount,
      { hsaQualifiedMedical: true },
      { withdrawalDate: '2026-01-01', dateOfBirth: '1980-01-01' }
    );
    expect(qualified.taxExempt).toBe(true);
    expect(qualified.qualifiedMedical).toBe(true);
  });

  it('grosses up a planner debit from HSA by the 20% penalty (end-to-end)', () => {
    const scenario = baseScenario();
    scenario.options = { ...scenario.options, dateOfBirth: '1980-01-01' }; // age 46 → penalty applies.
    setOpening(scenario, HSA, 1000);
    scenario.expenses = {
      ...scenario.expenses,
      entries: [
        expenseEntry({ id: 'plan-hsa', amount: 100, accountId: HSA, fundingSource: `account:${HSA}` })
      ],
      recurringEvents: []
    };

    const run = projectFeatureScenario(scenario, { horizonMonths: 1 });
    const plan = run.plans.find((entry) => entry.handlerId === PLANNER_HANDLER_ID);
    expect(plan?.requestedCents).toBe(10_000);
    expect(plan?.executedCents).toBe(10_000);
    expect(plan?.penaltyCents).toBe(2_500); // minimal gross $125 → net $100 after 20% penalty.
    expect(plan?.grossDebitCents).toBe(12_500);
    expect(accountBalance(run.monthlyCloses[0].snapshot, HSA)).toBe(87_500); // 100000 − 12500
  });
});

// ---------------------------------------------------------------------------
// CA03 — primary/fallback split and an atomic no-op
// ---------------------------------------------------------------------------

describe('P5.5 CA03 — ordered split and atomic no-op', () => {
  it('splits a $300 purchase primary-first across two accounts by per-source quota', () => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, 500);
    setOpening(scenario, EMERGENCY, 500);
    scenario.largePurchases = [
      purchase({
        id: 'buy-split',
        amount: 300,
        sourceLines: [
          { id: 's-checking', enabled: true, accountId: CHECKING, sourceType: 'account', sourceId: CHECKING, mode: 'amount', amount: 100 },
          { id: 's-emergency', enabled: true, accountId: EMERGENCY, sourceType: 'account', sourceId: EMERGENCY, mode: 'amount', amount: 200 }
        ]
      })
    ];

    const run = projectFeatureScenario(scenario, { horizonMonths: 1 });
    const plan = run.plans.find((entry) => entry.handlerId === SPENDING_HANDLER_IDS.purchase);
    expect(plan?.executedCents).toBe(30_000);
    expect(plan?.plan.allocations.map((allocation) => [allocation.accountId, allocation.netFundedCents])).toEqual([
      [CHECKING, 10_000],
      [EMERGENCY, 20_000]
    ]);
    const close = run.monthlyCloses[0];
    expect(accountBalance(close.snapshot, CHECKING)).toBe(40_000);
    expect(accountBalance(close.snapshot, EMERGENCY)).toBe(30_000);
  });

  it('leaves an unfunded request as an atomic no-op (nothing debited or journalled)', () => {
    const scenario = baseScenario(); // every account stays at $0.
    scenario.largePurchases = [purchase({ id: 'buy-empty', amount: 300 })];

    const run = projectFeatureScenario(scenario, { horizonMonths: 1 });
    expect(run.plans.some((entry) => entry.handlerId === SPENDING_HANDLER_IDS.purchase)).toBe(false);
    expect(run.postings).toHaveLength(0);
    expect(run.monthlyCloses[0].closingCashCents).toBe(0);
    // The unfunded quote is still recorded as shortfall evidence (D16).
    const outcome = run.fundingOutcomes.find((entry) => entry.definitionId === 'spending:purchase:buy-empty');
    expect(outcome?.committed).toBe(false);
    expect(outcome?.plan.executedCents).toBe(0);
    expect(outcome?.plan.shortfallCents).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// CA10 — occurrence identity, occurred view-only, monthly day-31
// ---------------------------------------------------------------------------

describe('P5.5 CA10 — planner occurrence identity and occurred view-only', () => {
  it('schedules each dated record once and never reschedules an occurred observation', () => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, 1000);
    scenario.expenses = {
      ...scenario.expenses,
      entries: [
        expenseEntry({ id: 'plan-one', amount: 100, startDate: '2026-01-01', endDate: '2026-01-01' }),
        expenseEntry({
          id: 'plan-occurred',
          amount: 500,
          startDate: '2026-01-15',
          endDate: '2026-01-15',
          planningStatus: 'occurred'
        })
      ],
      recurringEvents: []
    };

    const run = projectFeatureScenario(scenario, { horizonMonths: 1 });
    const occurrenceIds = run.plans.map((plan) => plan.occurrenceId);
    expect(occurrenceIds).toEqual(['planner:plan-one:2026-01-01']);
    expect(run.plans.some((plan) => plan.definitionId === 'planner:plan-occurred')).toBe(false);
    expect(accountBalance(run.monthlyCloses[0].snapshot, CHECKING)).toBe(90_000); // only the $100 plan debits.
  });
});

// ---------------------------------------------------------------------------
// CA09 — held-deposit acquisition completes atomically with no second expense
// ---------------------------------------------------------------------------

describe('P5.5 CA09 — held-deposit acquisition', () => {
  it('holds $30k, then completes into a $300k property / $240k mortgage in one commit', () => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, 60_000);
    scenario.liabilities = [
      loanLiability({
        id: 'mortgage-1',
        kind: 'mortgage',
        openingBalance: 0,
        annualInterestRate: 0,
        minimumMonthlyPayment: 0,
        endYearMonth: null,
        paymentDay: 1,
        linkedPropertyId: 'home-1'
      })
    ];
    scenario.properties = [
      {
        id: 'home-1',
        label: 'Home',
        value: 0,
        status: 'pending',
        requiredDownPayment: 60_000,
        debtLink: 'mortgage-1',
        appreciationRate: 0,
        sellingCostsRate: 0,
        fundingEvents: [
          { id: 'f1', date: '2026-01-01', amount: 30_000, accountId: CHECKING },
          { id: 'f2', date: '2026-02-01', amount: 30_000, accountId: CHECKING }
        ]
      } as PropertyDefinition
    ];
    scenario.housing = [
      {
        ...createDefaultHousingEntry(45, DOB, REFERENCE),
        id: 'home-1',
        startYearMonth: '2026-01',
        purchasePrice: 300_000,
        downPayment: 0,
        annualInterestRate: 0,
        loanTermYears: 0,
        extraMonthlyPayment: 0,
        monthlyRent: 0,
        endYearMonth: '',
        propertyTaxYearly: 0,
        homeInsuranceYearly: 0,
        hoaMonthly: 0,
        maintenanceMonthly: 0,
        pmiMonthly: 0,
        rentalIncomeMonthly: 0,
        sellYearMonth: '',
        appreciationRate: 0,
        sellingCostsRate: 0,
        paymentSource: `account:${CHECKING}`
      } as HousingEntry
    ];

    const run = projectFeatureScenario(scenario, { horizonMonths: 2 });

    // January: $30k held as a non-appreciating pending deposit; no mortgage yet.
    const jan = run.monthlyCloses[0].snapshot;
    expect(accountBalance(jan, CHECKING)).toBe(3_000_000);
    expect(jan.properties[0]).toMatchObject({ status: 'pending', valueCents: 0, acquisitionDepositCents: 3_000_000 });
    expect(jan.liabilities).toHaveLength(0);

    // February: the second $30k releases the held deposit and completes atomically.
    const feb = run.monthlyCloses[1].snapshot;
    expect(accountBalance(feb, CHECKING)).toBe(0);
    expect(feb.properties[0]).toMatchObject({ status: 'owned', valueCents: 30_000_000, acquisitionDepositCents: 0 });
    expect(liabilityPrincipal(feb, 'mortgage-1')).toBe(24_000_000);
    // Equity == the $60k down payment actually paid; no second down-payment expense.
    expect(run.monthlyCloses[1].totals.netWorthCents).toBe(6_000_000);
    expect(run.plans.filter((plan) => plan.handlerId === 'housing.funding')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// CA12 — compatible frozen comparisons (report immutability + exact wording)
// ---------------------------------------------------------------------------

describe('P5.5 CA12 — frozen comparisons and exact shortfall language', () => {
  it('builds one immutable report that is byte-identical on re-run', () => {
    const scenario = baseScenario();
    setOpening(scenario, CHECKING, 100);
    scenario.largePurchases = [purchase({ id: 'buy-short', amount: 500 })];

    const first = projectFeatureScenario(scenario, { horizonMonths: 1 });
    const second = projectFeatureScenario(scenario, { horizonMonths: 1 });
    expect(Object.isFrozen(first.report)).toBe(true);
    expect(JSON.stringify(second.report)).toBe(JSON.stringify(first.report));
    expect(first.report.postingCount).toBe(first.postings.length);
    // Exact shortfall wording (a partial debit is reported, never as exhaustion).
    expect(
      first.diagnostics.some(
        (message) =>
          message.includes('buy-short') && message.includes('unpaid 40000') && message.includes('partially funded')
      )
    ).toBe(true);
  });
});
