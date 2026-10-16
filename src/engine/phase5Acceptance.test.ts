/**
 * Phase 5 P5.1 — integrated feature projection acceptance (D23 / D26).
 *
 * Proves the single integrated orchestration:
 *
 * - the **raw** `projectScenario` facade is unchanged and still reports
 *   `complete: false`, `processors: false`, `reporting: false` and the full
 *   deferred-domain list;
 * - `projectFeatureScenario` composes all four streams over exactly one selected
 *   timeline, builds **one** immutable `ProjectionReport` from the frozen run and
 *   returns it attached, marking `complete: true` only for a full horizon with
 *   every handler present;
 * - a partial `scheduleWindow` keeps the composed run honestly incomplete;
 * - the **D26** fixed-date contention fixture: payroll allocation, an ordinary
 *   card, a rent/housing group, a loan installment, retirement spending, a
 *   planner recurrence and a discretionary purchase compete for the same account
 *   in the same month. Expected executed/shortfall/balances are computed from the
 *   configuration math (each $ amount × 100 cents, drawn in phase order), never
 *   read back from the run output.
 *
 * The fixture is intentionally one month: every obligation is a single dated
 * occurrence on 2026-01-01, so the only money is the payroll that posts first and
 * the balance is exactly the running remainder.
 */

import { describe, expect, it } from 'vitest';

import {
  createDefaultCareerEntry,
  createDefaultOrdinaryCardSchedule,
  createDefaultRentalEntry,
  createDefaultRetirementWithdrawalSource,
  createDefaultScenario
} from '../defaultScenario';
import type {
  CareerEntry,
  CashflowItem,
  ExpenseEntry,
  HousingEntry,
  LargePurchase,
  LiabilityDefinition,
  Loan,
  OrdinaryCardSchedule,
  Paycheck,
  PropertyDefinition,
  Scenario,
  Timeline
} from '../types';
import { CARD_ID_NAMESPACE } from './cards';
import { projectFeatureScenario } from './featureHandlers';
import { HOUSING_HANDLER_IDS } from './housing';
import { LOAN_INSTALLMENT_HANDLER_ID } from './loans';
import { PLANNER_HANDLER_ID } from './planner';
import { projectScenario } from './projection';
import { RETIREMENT_HANDLER_ID } from './retirement';

const REFERENCE = new Date(2026, 0, 1, 12, 0, 0);
const DOB = '1980-10-01';
const CHECKING = 'checking-account-default';

// ---------------------------------------------------------------------------
// Zeroed, income-free base scenario (career/timelines configured per test)
// ---------------------------------------------------------------------------

const baseScenario = (): Scenario => {
  const value = createDefaultScenario(REFERENCE);
  value.netWorth.asOfDate = '2026-01-01';
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
  value.timelines = [];
  value.activeTimelineId = null;
  value.expenses = { ...value.expenses, entries: [], recurringEvents: [] };
  value.netWorth.accounts = value.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  return value;
};

const setOpeningBalance = (scenario: Scenario, accountId: string, dollars: number): void => {
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) =>
    account.id === accountId ? { ...account, openingBalance: dollars } : account
  );
};

// ---------------------------------------------------------------------------
// D26 components — each names its own request in dollars, from its config
// ---------------------------------------------------------------------------

/** Payroll: a single monthly $800 earnings line, net paid to checking. */
const payrollCareer = (): CareerEntry => {
  const base = createDefaultCareerEntry(0, 45, 65, 'career-d26');
  const paycheck: Paycheck = {
    payFrequency: 'monthly',
    categories: [
      {
        id: 'paycheck-category-earnings',
        label: 'Earnings',
        kind: 'earning',
        lines: [{ id: 'paycheck-line-earnings-regular', label: 'Regular', amount: 800, mode: 'amount' }]
      },
      { id: 'paycheck-category-statutory', label: 'Statutory', kind: 'tax', lines: [] }
    ]
  };
  return {
    ...base,
    enabled: true,
    startYearMonth: '2026-01',
    endYearMonth: '2026-12',
    annualRaiseRate: 0,
    sourceLines: [],
    payPlans: [],
    paycheck,
    depositPlan: { allocations: [], remainderAccountId: CHECKING, postingDay: 1 }
  };
};

const ordinaryCard = (id: string, amount: number): OrdinaryCardSchedule =>
  createDefaultOrdinaryCardSchedule(REFERENCE, {
    id,
    amount,
    startYearMonth: '2026-01',
    endYearMonth: '2026-01',
    paymentDay: 1,
    funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] }
  });

const rentHousing = (): HousingEntry => ({
  ...createDefaultRentalEntry(45, DOB, REFERENCE),
  id: 'home-d26',
  startYearMonth: '2026-01',
  endYearMonth: '',
  monthlyRent: 200,
  propertyTaxYearly: 0,
  homeInsuranceYearly: 0,
  hoaMonthly: 0,
  maintenanceMonthly: 0,
  pmiMonthly: 0,
  paymentSource: `account:${CHECKING}`,
  appreciationRate: 0,
  sellingCostsRate: 0
});

const rentProperty = (): PropertyDefinition => ({
  id: 'home-d26',
  label: 'Rental',
  value: 0,
  requiredDownPayment: 0,
  status: 'owned',
  debtLink: null,
  appreciationRate: 0,
  sellingCostsRate: 0
});

const loan = (): Loan => ({
  id: 'loan-d26',
  label: 'loan-d26',
  enabled: true,
  showOnGraph: true,
  startYearMonth: '2026-01',
  originalAmount: 3000,
  downPayment: 0,
  currentBalance: 3000,
  annualInterestRate: 0,
  minimumMonthlyPayment: 300,
  extraMonthlyPayment: 0,
  paymentSourceAccount: CHECKING,
  paymentSource: `account:${CHECKING}`
});

const liability = (): LiabilityDefinition => ({
  id: 'loan-d26',
  kind: 'loan',
  openingBalance: 3000,
  annualInterestRate: 0,
  minimumMonthlyPayment: 300,
  endYearMonth: '2027-12',
  paymentDay: 1
});

/** Retirement: amount mode, one-month horizon → its sole occurrence requests the full amount. */
const retirementSource = () =>
  createDefaultRetirementWithdrawalSource(REFERENCE, {
    id: 'ret-d26',
    label: 'Retirement Withdrawal',
    accountId: CHECKING,
    mode: 'amount',
    amount: 100,
    firstWithdrawalDate: '2026-01-01',
    initialWithdrawalValuationDate: '2026-01-01',
    paymentDay: 1,
    fallbackAccountIds: []
  });

const plannerEntry = (): ExpenseEntry => ({
  id: 'plan-d26',
  label: 'Plan',
  amount: 100,
  startDate: '2026-01-01',
  endDate: '2026-01-01',
  accountId: CHECKING,
  notes: '',
  originType: 'manual',
  importSourceId: null,
  importBatchId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  categoryId: null,
  fundingSource: `account:${CHECKING}`
});

const purchase = (over: Partial<LargePurchase> = {}): LargePurchase => ({
  id: 'buy-d26',
  label: 'Buy',
  enabled: true,
  showOnGraph: true,
  yearMonth: '2026-01',
  yearMonthMarkerId: null,
  age: 45,
  amount: 500,
  fundingSource: `account:${CHECKING}`,
  ...over
});

const inflow = (id: string, amount: number, startYearMonth: string): CashflowItem => ({
  id,
  category: 'pension_1',
  label: 'Pension',
  enabled: true,
  cadence: 'one_time',
  direction: 'inflow',
  accountId: CHECKING,
  amount,
  startAge: 45,
  endAge: 45,
  startYearMonth,
  endYearMonth: startYearMonth
});

const makeTimeline = (id: string, purchases: LargePurchase[]): Timeline => ({
  id,
  label: id,
  purchases,
  longTermPurchases: [],
  loans: [],
  creditCards: [],
  cardPlans: [],
  careerPlan: { enabled: false, entries: [] },
  housing: []
});

/** The full D26 contention scenario: every obligation competes for checking in 2026-01. */
const d26Scenario = (): Scenario => {
  const value = baseScenario();
  value.careerPlan = { enabled: true, entries: [payrollCareer()] };
  value.cardPlans = [ordinaryCard('card-d26', 150)];
  value.housing = [rentHousing()];
  value.properties = [rentProperty()];
  value.loans = [loan()];
  value.liabilities = [liability()];
  value.withdrawal = { ...value.withdrawal, sourceLines: [retirementSource()], fallbackAccountIds: [] };
  value.expenses = { ...value.expenses, entries: [plannerEntry()], recurringEvents: [] };
  value.largePurchases = [purchase()];
  return value;
};

// Independently computed from the D26 config (dollars × 100), never from output:
// payroll net 80000 posts first on 2026-01-01; obligations draw in the frozen
// mandatory band order (loan → housing → card → planner → retirement), then the
// discretionary purchase:
//   loan       30000  → 30000, remaining 50000
//   rent       20000  → 20000, remaining 30000
//   card       15000  → 15000, remaining 15000
//   planner    10000  → 10000, remaining  5000
//   retirement 10000  →  5000 (short 5000), remaining 0
//   purchase   50000  →     0 (short 50000)
// Closing balance 0; total executed net 80000.
const D26 = {
  income: 80_000,
  loan: 30_000,
  rent: 20_000,
  card: 15_000,
  planner: 10_000,
  retirementRequested: 10_000,
  retirementExecuted: 5_000,
  retirementShortfall: 5_000,
  purchaseRequested: 50_000,
  purchaseShortfall: 50_000,
  closing: 0
} as const;

// ---------------------------------------------------------------------------
// D23 — truthful coverage + one report
// ---------------------------------------------------------------------------

describe('Phase 5 P5.1 — D23 truthful coverage and the single report', () => {
  it('keeps the raw kernel facade incomplete while the composed run is complete and reported', () => {
    const scenario = baseScenario();
    scenario.cashflowItems = [inflow('inflow-1', 1000, '2026-01')];

    const raw = projectScenario(scenario, { horizonMonths: 1 });
    expect(raw.complete).toBe(false);
    expect(raw.featureCoverage.processors).toBe(false);
    expect(raw.featureCoverage.reporting).toBe(false);
    expect(raw.featureCoverage.deferred.length).toBeGreaterThan(0);

    const composed = projectFeatureScenario(scenario, { horizonMonths: 1 });
    expect(composed.complete).toBe(true);
    expect(composed.featureCoverage.processors).toBe(true);
    expect(composed.featureCoverage.reporting).toBe(true);
    expect(composed.featureCoverage.deferred).toEqual([]);

    // The single report reconciles with the frozen postings/plans/outcomes.
    expect(Object.isFrozen(composed.report)).toBe(true);
    expect(composed.report.postingCount).toBe(composed.postings.length);
    expect(composed.report.planCount).toBe(composed.plans.length);
    expect(composed.report.outcomeCount).toBe(composed.fundingOutcomes.length);

    // Reporting is built from the frozen run only: byte-identical on a rebuild.
    const again = projectFeatureScenario(scenario, { horizonMonths: 1 });
    expect(JSON.stringify(again.report)).toBe(JSON.stringify(composed.report));
  });

  it('honestly reports an incomplete run when a schedule window truncates the horizon', () => {
    const scenario = baseScenario();
    scenario.cashflowItems = [inflow('inflow-1', 1000, '2026-06')];

    const composed = projectFeatureScenario(scenario, {
      horizonMonths: 6,
      scheduleWindow: { startDate: '2026-01-01', endDate: '2026-03-31' }
    });
    expect(composed.complete).toBe(false);
    expect(composed.featureCoverage.deferred).toContain('partialScheduleWindow');
    // A report can still be read, but the run never claims full coverage.
    expect(composed.report.postingCount).toBe(composed.postings.length);
    expect(composed.monthlyCloses).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// D26 — fixed-date cross-feature contention
// ---------------------------------------------------------------------------

describe('Phase 5 P5.1 — D26 cross-feature contention (one account, one month)', () => {
  it('posts payroll once, draws every obligation in phase order, and shortfalls the correct requests', () => {
    const run = projectFeatureScenario(d26Scenario(), { horizonMonths: 1 });

    expect(run.complete).toBe(true);
    expect(run.featureCoverage.processors).toBe(true);
    expect(run.featureCoverage.reporting).toBe(true);
    expect(run.featureCoverage.deferred).toEqual([]);

    // One month, starting from zero: income posts first, everything spends it.
    expect(run.monthlyCloses).toHaveLength(1);
    expect(run.monthlyCloses[0].openingCashCents).toBe(0);
    expect(run.monthlyCloses[0].closingCashCents).toBe(D26.closing);

    // Committed funding plans in the frozen mandatory band order:
    // loan/mortgage → housing → cards → planner/living → retirement.
    expect(run.plans.map((plan) => plan.handlerId)).toEqual([
      LOAN_INSTALLMENT_HANDLER_ID,
      HOUSING_HANDLER_IDS.rent,
      `${CARD_ID_NAMESPACE}card-d26:expected`,
      PLANNER_HANDLER_ID,
      RETIREMENT_HANDLER_ID
    ]);

    const byHandler = new Map(run.plans.map((plan) => [plan.handlerId, plan]));

    const loanPlan = byHandler.get(LOAN_INSTALLMENT_HANDLER_ID);
    expect(loanPlan?.requestedCents).toBe(D26.loan);
    expect(loanPlan?.executedCents).toBe(D26.loan);
    expect(loanPlan?.shortfallCents).toBe(0);

    const rentPlan = byHandler.get(HOUSING_HANDLER_IDS.rent);
    expect(rentPlan?.requestedCents).toBe(D26.rent);
    expect(rentPlan?.executedCents).toBe(D26.rent);
    expect(rentPlan?.shortfallCents).toBe(0);

    const cardPlan = byHandler.get(`${CARD_ID_NAMESPACE}card-d26:expected`);
    expect(cardPlan?.requestedCents).toBe(D26.card);
    expect(cardPlan?.executedCents).toBe(D26.card);
    expect(cardPlan?.shortfallCents).toBe(0);

    const plannerPlan = byHandler.get(PLANNER_HANDLER_ID);
    expect(plannerPlan?.requestedCents).toBe(D26.planner);
    expect(plannerPlan?.executedCents).toBe(D26.planner);
    expect(plannerPlan?.shortfallCents).toBe(0);

    // Retirement is the first mandatory request the month cannot fully satisfy.
    const retirementPlan = byHandler.get(RETIREMENT_HANDLER_ID);
    expect(retirementPlan?.requestedCents).toBe(D26.retirementRequested);
    expect(retirementPlan?.executedCents).toBe(D26.retirementExecuted);
    expect(retirementPlan?.shortfallCents).toBe(D26.retirementShortfall);
    expect(retirementPlan?.phase).toBe('mandatory');

    // Total net actually executed = the payroll that arrived first.
    expect(run.totals.executedNetCents).toBe(D26.income);

    // The discretionary purchase competes last and receives nothing.
    const purchaseOutcome = run.fundingOutcomes.find(
      (outcome) => outcome.definitionId === 'spending:purchase:buy-d26'
    );
    expect(purchaseOutcome).toBeDefined();
    expect(purchaseOutcome?.committed).toBe(false);
    expect(purchaseOutcome?.phase).toBe('discretionary');
    expect(purchaseOutcome?.plan.request.requestedCents).toBe(D26.purchaseRequested);
    expect(purchaseOutcome?.plan.executedCents).toBe(0);
    expect(purchaseOutcome?.plan.shortfallCents).toBe(D26.purchaseShortfall);
    expect(run.plans.some((plan) => plan.definitionId === 'spending:purchase:buy-d26')).toBe(false);

    // Exact shortfall warnings for the two unmet requests (never a fallback).
    expect(
      run.diagnostics.some(
        (message) =>
          message.includes('buy-d26') &&
          message.includes('could not be funded') &&
          message.includes('unpaid 50000')
      )
    ).toBe(true);
    expect(
      run.diagnostics.some(
        (message) =>
          message.includes('ret-d26') &&
          message.includes('partially funded') &&
          message.includes('paid 5000¢') &&
          message.includes('unpaid 5000¢')
      )
    ).toBe(true);

    // The one report is consistent with the postings of this run.
    expect(run.report.postingCount).toBe(run.postings.length);
    expect(run.report.planCount).toBe(run.plans.length);
  });

  it('D26/CA02 conserves signed net worth on every committed posting (account + property − liability) and closes with zero residual', () => {
    const run = projectFeatureScenario(d26Scenario(), { horizonMonths: 1 });

    // Field accessors use the ACTUAL PostingRecord change shapes:
    //   AccountChange  → accountId, deltaCents
    //   LiabilityChange→ principalDeltaCents, accruedInterestDeltaCents, feesDeltaCents
    //   PropertyChange → valueDeltaCents, acquisitionDepositDeltaCents
    type PostingChanges = {
      readonly accountChanges: readonly { readonly deltaCents: number }[];
      readonly liabilityChanges: readonly {
        readonly principalDeltaCents?: number;
        readonly accruedInterestDeltaCents?: number;
        readonly feesDeltaCents?: number;
      }[];
      readonly propertyChanges: readonly {
        readonly valueDeltaCents?: number;
        readonly acquisitionDepositDeltaCents?: number;
      }[];
      readonly expectedNetWorthDeltaCents: number;
    };

    const accountDeltaOf = (record: PostingChanges): number =>
      record.accountChanges.reduce((total, change) => total + change.deltaCents, 0);
    const liabilityDeltaOf = (record: PostingChanges): number =>
      record.liabilityChanges.reduce(
        (total, change) =>
          total +
          (change.principalDeltaCents ?? 0) +
          (change.accruedInterestDeltaCents ?? 0) +
          (change.feesDeltaCents ?? 0),
        0
      );
    const propertyDeltaOf = (record: PostingChanges): number =>
      record.propertyChanges.reduce(
        (total, change) => total + (change.valueDeltaCents ?? 0) + (change.acquisitionDepositDeltaCents ?? 0),
        0
      );
    // Signed net-worth delta: Σaccount + Σproperty − Σliability. Using
    // ΣaccountChanges as the whole delta is WRONG for a debt principal payment
    // (cash down, debt down = net-zero) or a property/deposit transfer.
    const derivedNetWorthDeltaOf = (record: PostingChanges): number =>
      accountDeltaOf(record) + propertyDeltaOf(record) - liabilityDeltaOf(record);

    // Hand-computed D26 per-posting expected deltas, from the fixture alone
    // (never read back from the run): payroll net +80000¢; loan 0¢ (cash −30000¢
    // offset by debt principal −30000¢); rent −20000¢; card −15000¢ (ordinary
    // card has no liability link); planner −10000¢; retirement executed −5000¢.
    expect(run.postings.map((record) => record.expectedNetWorthDeltaCents)).toEqual([
      D26.income,
      0,
      -D26.rent,
      -D26.card,
      -D26.planner,
      -D26.retirementExecuted
    ]);

    // The core D26/CA02 per-posting reconciliation: for EVERY committed posting
    // the independently derived signed delta equals the declared net-worth delta.
    for (const record of run.postings) {
      expect(derivedNetWorthDeltaOf(record)).toBe(record.expectedNetWorthDeltaCents);
    }

    // The liability-principal branch must be live, else the oracle is vacuous.
    const liabilityPrincipalRecord = run.postings.find((record) =>
      record.liabilityChanges.some((change) => (change.principalDeltaCents ?? 0) !== 0)
    );
    expect(liabilityPrincipalRecord).toBeDefined();
    expect(
      liabilityPrincipalRecord!.liabilityChanges.reduce(
        (total, change) => total + (change.principalDeltaCents ?? 0),
        0
      )
    ).toBe(-D26.loan);
    // Hand-computed: the $300 installment debits checking 30000¢ AND drains
    // principal 30000¢; the declared net-worth delta is therefore exactly 0¢,
    // which ΣaccountChanges alone (−30000¢) would get wrong.
    expect(accountDeltaOf(liabilityPrincipalRecord!)).toBe(-D26.loan);
    expect(liabilityPrincipalRecord!.expectedNetWorthDeltaCents).toBe(0);

    // A pure spending posting (no liability, no property) must also be live and
    // its delta is just the account outflow.
    const pureSpendingRecord = run.postings.find(
      (record) =>
        record.liabilityChanges.length === 0 &&
        record.propertyChanges.length === 0 &&
        accountDeltaOf(record) < 0
    );
    expect(pureSpendingRecord).toBeDefined();
    expect(pureSpendingRecord!.expectedNetWorthDeltaCents).toBe(accountDeltaOf(pureSpendingRecord!));

    // Pin the D26 planner recurrence ($100) as one such pure spending posting.
    const plannerRecord = run.postings.find(
      (record) =>
        record.liabilityChanges.length === 0 &&
        record.propertyChanges.length === 0 &&
        accountDeltaOf(record) === -D26.planner
    );
    expect(plannerRecord).toBeDefined();
    expect(plannerRecord!.expectedNetWorthDeltaCents).toBe(-D26.planner);

    // Hand-computed opening: 0¢ cash − 3000¢ debt = −300000¢.
    expect(run.opening.totals.netWorthCents).toBe(-300_000);

    // Month close = opening + Σ declared per-posting deltas, zero residual.
    const postedDelta = run.postings.reduce(
      (total, record) => total + record.expectedNetWorthDeltaCents,
      0
    );
    expect(postedDelta).toBe(
      D26.income - D26.rent - D26.card - D26.planner - D26.retirementExecuted
    );
    const close = run.monthlyCloses[0];
    expect(run.opening.totals.netWorthCents + postedDelta).toBe(close.totals.netWorthCents);
    expect(close.totals.netWorthCents - (run.opening.totals.netWorthCents + postedDelta)).toBe(0);
    expect(close.totals.netWorthCents).toBe(run.totals.closingNetWorthCents);
    // Hand-computed closing: 0¢ cash − 2700¢ debt = −270000¢.
    expect(close.totals.netWorthCents).toBe(-270_000);
    expect(close.totals.assetsCents - close.totals.liabilityCents).toBe(close.totals.netWorthCents);
  });
});

// ---------------------------------------------------------------------------
// Timeline isolation / no-career / zero-income composition
// ---------------------------------------------------------------------------

describe('Phase 5 P5.1 — composed timeline isolation and empty-income states', () => {
  it('projects exactly one named timeline and never leaks the inactive timeline', () => {
    const scenario = baseScenario();
    setOpeningBalance(scenario, CHECKING, 1000);
    scenario.largePurchases = [purchase({ id: 'base-buy', amount: 100 })];
    scenario.timelines = [makeTimeline('tl-1', [purchase({ id: 'tl-buy', amount: 200 })])];
    scenario.activeTimelineId = null;

    const onTimeline = projectFeatureScenario(scenario, { timelineId: 'tl-1', horizonMonths: 1 });
    expect(onTimeline.metadata.timelineId).toBe('tl-1');
    expect(onTimeline.complete).toBe(true);
    expect(onTimeline.fundingOutcomes.some((o) => o.definitionId === 'spending:purchase:tl-buy')).toBe(true);
    expect(onTimeline.fundingOutcomes.some((o) => o.definitionId === 'spending:purchase:base-buy')).toBe(false);

    const onBase = projectFeatureScenario(scenario, { timelineId: 'base', horizonMonths: 1 });
    expect(onBase.metadata.timelineId).toBeNull();
    expect(onBase.fundingOutcomes.some((o) => o.definitionId === 'spending:purchase:base-buy')).toBe(true);
    expect(onBase.fundingOutcomes.some((o) => o.definitionId === 'spending:purchase:tl-buy')).toBe(false);
  });

  it('produces a complete, reported run with no career and no income', () => {
    const run = projectFeatureScenario(baseScenario(), { horizonMonths: 3 });
    expect(run.complete).toBe(true);
    expect(run.monthlyCloses).toHaveLength(3);
    expect(run.report.postingCount).toBe(run.postings.length);
    // No payroll/other-income definition posts anything when nothing is configured.
    expect(run.postings.every((record) => !(record.posting.definitionId ?? '').startsWith('income:'))).toBe(true);
  });
});
