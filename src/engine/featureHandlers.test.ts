/**
 * Phase 3 D10 — integration-lane tests for the feature-handler composition seam.
 *
 * These tests prove the *composition* behaviour owned by `featureHandlers.ts`,
 * consuming the settled stream APIs (income / spending / planner / cards / loans /
 * retirement / housing):
 *
 * - every stream's definitions are assembled with deterministic, stable ids;
 * - the `mandatory` phase is banded into the frozen canonical order
 *   (loan/mortgage → housing → cards → planner/living → retirement) with
 *   intra-stream order preserved;
 * - a repeated stable id is de-duplicated (first wins) and **reported**, never
 *   silently dropped;
 * - the wrapper selects exactly one named timeline (explicit, active, or base)
 *   and one canonical context;
 * - a tiny integrated run routes income into one shared account *before*
 *   same-date mandatory/discretionary obligations (no future-income funding, no
 *   double-processing);
 * - a zero-career scenario posts no payroll income.
 *
 * Focused CA01/CA05/CA06/CA09/CA10 components stay in their own stream suites;
 * combined P5 acceptance is explicitly deferred.
 */

import { describe, expect, it } from 'vitest';

import {
  createDefaultHousingEntry,
  createDefaultOrdinaryCardSchedule,
  createDefaultRentalEntry,
  createDefaultRetirementWithdrawalSource,
  createDefaultScenario
} from '../defaultScenario';
import type {
  CashflowItem,
  ExpenseEntry,
  HousingEntry,
  LargePurchase,
  LiabilityDefinition,
  Loan,
  LongTermPurchase,
  OrdinaryCardSchedule,
  PropertyDefinition,
  Scenario,
  Timeline
} from '../types';
import { BASE_TIMELINE_ID, compileScenarioContext } from './configuration';
import { buildState } from './state';
import { endOfMonthDate } from './dates';
import {
  createFeatureEventDefinitions,
  createFeatureHandlerFactory,
  FEATURE_MANDATORY_BANDS,
  projectFeatureScenario
} from './featureHandlers';
import { INCOME_HANDLER_ID, INCOME_OTHER_HANDLER_ID } from './income';
import { LOAN_INSTALLMENT_HANDLER_ID } from './loans';
import { SPENDING_HANDLER_IDS } from './spending';
import { HOUSING_HANDLER_IDS } from './housing';
import { CARD_ID_NAMESPACE } from './cards';
import { PLANNER_DEFINITION_PREFIX } from './planner';
import { retirementDefinitionId } from './retirement';

const REFERENCE = new Date(2026, 0, 1, 12, 0, 0);
const DOB = '1980-10-01';
const CHECKING = 'checking-account-default';
const RETIREMENT = 'retirement401k-account-default';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Zeroed, career-free, income-free scenario anchored to a clean month start. */
const zeroedScenario = (): Scenario => {
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

const purchase = (over: Partial<LargePurchase> = {}): LargePurchase => ({
  id: 'buy',
  label: 'Buy',
  enabled: true,
  showOnGraph: true,
  yearMonth: '2026-01',
  yearMonthMarkerId: null,
  age: 45,
  amount: 100,
  fundingSource: `account:${CHECKING}`,
  ...over
});

const longTerm = (over: Partial<LongTermPurchase> = {}): LongTermPurchase => ({
  id: 'lt',
  label: 'Long Term',
  enabled: true,
  showOnGraph: true,
  startYearMonth: '2026-01',
  endMode: 'duration',
  durationMonths: 1,
  endYearMonth: '',
  monthlyAmount: 100,
  fundingSource: `account:${CHECKING}`,
  ...over
});

const loan = (id = 'loan-1'): Loan => ({
  id,
  label: id,
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

const liability = (id = 'loan-1'): LiabilityDefinition => ({
  id,
  kind: 'loan',
  openingBalance: 3000,
  annualInterestRate: 0,
  minimumMonthlyPayment: 300,
  endYearMonth: '2026-12',
  paymentDay: 1
});

const cardPlan = (id: string, amount: number): OrdinaryCardSchedule =>
  createDefaultOrdinaryCardSchedule(REFERENCE, {
    id,
    amount,
    startYearMonth: '2026-01',
    endYearMonth: '2026-01',
    paymentDay: 1,
    funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] }
  });

const rentalProperty = (id = 'home-1'): PropertyDefinition => ({
  id,
  label: 'Rental',
  value: 0,
  requiredDownPayment: 0,
  status: 'owned',
  debtLink: null,
  appreciationRate: 0,
  sellingCostsRate: 0
});

const rentalHousing = (id = 'home-1'): HousingEntry => ({
  ...createDefaultRentalEntry(45, DOB, REFERENCE),
  id,
  startYearMonth: '2026-01',
  endYearMonth: '',
  monthlyRent: 150,
  propertyTaxYearly: 0,
  homeInsuranceYearly: 0,
  hoaMonthly: 0,
  maintenanceMonthly: 0,
  pmiMonthly: 0,
  paymentSource: `account:${CHECKING}`,
  appreciationRate: 0,
  sellingCostsRate: 0
});

const mortgageProperty = (id = 'home-m', debtLink = 'mort-m'): PropertyDefinition => ({
  id,
  label: 'Home',
  value: 300_000,
  requiredDownPayment: 0,
  status: 'owned',
  debtLink,
  appreciationRate: 0,
  sellingCostsRate: 0
});

const mortgageLiability = (id = 'mort-m', propertyId = 'home-m'): LiabilityDefinition => ({
  id,
  kind: 'mortgage',
  openingBalance: 240_000,
  annualInterestRate: 6.5,
  minimumMonthlyPayment: 1500,
  endYearMonth: '2031-06',
  paymentDay: 1,
  linkedPropertyId: propertyId
});

const mortgageHousing = (id = 'home-m'): HousingEntry => ({
  ...createDefaultHousingEntry(45, DOB, REFERENCE),
  id,
  housingType: 'mortgage',
  startYearMonth: '2026-01',
  sellYearMonth: '',
  annualInterestRate: 6.5,
  // A deliberately wrong legacy term: the contractual liability end must win.
  loanTermYears: 30,
  extraMonthlyPayment: 0,
  propertyTaxYearly: 0,
  homeInsuranceYearly: 0,
  hoaMonthly: 0,
  maintenanceMonthly: 0,
  pmiMonthly: 0,
  monthlyRent: 0,
  paymentSource: `account:${CHECKING}`,
  appreciationRate: 0,
  sellingCostsRate: 0
});

const expenseEntry = (id: string): ExpenseEntry => ({
  id,
  label: 'Plan',
  amount: 100,
  startDate: '2026-01-05',
  endDate: '2026-01-05',
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

const retirementSource = (id = 'ret-1') =>
  createDefaultRetirementWithdrawalSource(REFERENCE, {
    id,
    accountId: RETIREMENT,
    firstWithdrawalDate: '2026-01-01',
    initialWithdrawalValuationDate: '2026-01-01'
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

// ---------------------------------------------------------------------------
// Assembly: deterministic ids + canonical mandatory ordering
// ---------------------------------------------------------------------------

describe('featureHandlers — event-definition assembly', () => {
  it('assembles all four streams with deterministic ids and canonical mandatory bands', () => {
    const scenario = zeroedScenario();
    scenario.largePurchases = [purchase({ id: 'buy-1', amount: 100 })];
    scenario.longTermPurchases = [longTerm({ id: 'lt-1' })];
    scenario.loans = [loan('loan-1')];
    scenario.liabilities = [liability('loan-1')];
    scenario.cardPlans = [cardPlan('card-1', 200)];
    scenario.housing = [rentalHousing('home-1')];
    scenario.properties = [rentalProperty('home-1')];
    scenario.expenses = { ...scenario.expenses, entries: [expenseEntry('plan-1')] };
    scenario.withdrawal = { ...scenario.withdrawal, sourceLines: [retirementSource('ret-1')] };

    const context = compileScenarioContext(scenario, { horizonMonths: 12 });
    const definitions = createFeatureEventDefinitions(scenario, context);
    const byId = new Map(definitions.map((definition) => [definition.definitionId, definition]));

    // One definition per stream, namespaced by its stable stream id.
    expect(byId.has('spending:purchase:buy-1')).toBe(true);
    expect(byId.has('spending:longterm:lt-1')).toBe(true);
    expect(byId.has('loan:loan-1:installment')).toBe(true);
    expect(byId.has(`${CARD_ID_NAMESPACE}card-1`)).toBe(true);
    expect(byId.has('housing:home-1:rent')).toBe(true);
    expect(byId.has(`${PLANNER_DEFINITION_PREFIX}plan-1`)).toBe(true);
    expect(byId.has(retirementDefinitionId('ret-1'))).toBe(true);

    // Canonical mandatory order: loan < housing < cards < planner/living < retirement.
    expect(byId.get('loan:loan-1:installment')?.priority).toBe(FEATURE_MANDATORY_BANDS.loan + 10);
    expect(byId.get('housing:home-1:rent')?.priority).toBe(FEATURE_MANDATORY_BANDS.housing + 10);
    expect(byId.get(`${CARD_ID_NAMESPACE}card-1`)?.priority).toBe(FEATURE_MANDATORY_BANDS.card + 100);
    expect(byId.get('spending:longterm:lt-1')?.priority).toBe(FEATURE_MANDATORY_BANDS.plannerLiving);
    expect(byId.get(`${PLANNER_DEFINITION_PREFIX}plan-1`)?.priority).toBe(FEATURE_MANDATORY_BANDS.plannerLiving);
    expect(byId.get(retirementDefinitionId('ret-1'))?.priority).toBe(FEATURE_MANDATORY_BANDS.retirement);

    expect(FEATURE_MANDATORY_BANDS.loan).toBeLessThan(FEATURE_MANDATORY_BANDS.housing);
    expect(FEATURE_MANDATORY_BANDS.housing).toBeLessThan(FEATURE_MANDATORY_BANDS.card);
    expect(FEATURE_MANDATORY_BANDS.card).toBeLessThan(FEATURE_MANDATORY_BANDS.plannerLiving);
    expect(FEATURE_MANDATORY_BANDS.plannerLiving).toBeLessThan(FEATURE_MANDATORY_BANDS.retirement);

    // Non-mandatory phases are untouched.
    expect(byId.get('spending:purchase:buy-1')?.phase).toBe('discretionary');
    expect(byId.get('loan:loan-1:accrual')?.phase).toBe('accrual');

    // Deterministic id list across repeated calls.
    const again = createFeatureEventDefinitions(scenario, context);
    expect(again.map((definition) => definition.definitionId)).toEqual(
      definitions.map((definition) => definition.definitionId)
    );
  });

  it('passes the compiled liabilities to housing so the mortgage window is contractual', () => {
    const scenario = zeroedScenario();
    scenario.properties = [mortgageProperty()];
    scenario.liabilities = [mortgageLiability()];
    scenario.housing = [mortgageHousing()];

    const context = compileScenarioContext(scenario, { horizonMonths: 12 });
    const mortgage = createFeatureEventDefinitions(scenario, context).find(
      (definition) => definition.definitionId === 'housing:home-m:mortgage'
    );

    expect(mortgage?.phase).toBe('mandatory');
    expect(mortgage?.priority).toBe(FEATURE_MANDATORY_BANDS.housing + 10);
    // Contractual liability end (2031-06) wins over the 30-year legacy fallback.
    expect(mortgage?.recurrence.endDate).toBe(endOfMonthDate('2031-06'));
  });

  it('de-duplicates a repeated stable id and reports the collision instead of dropping it silently', () => {
    const scenario = zeroedScenario();
    // Two plans sharing an id is a misconfiguration; the composer must not
    // silently discard one of two *different* obligations.
    scenario.cardPlans = [cardPlan('dup-card', 100), cardPlan('dup-card', 250)];

    const context = compileScenarioContext(scenario, { horizonMonths: 12 });
    const diagnostics: string[] = [];
    const definitions = createFeatureEventDefinitions(scenario, context, diagnostics);

    const collisions = definitions.filter((definition) => definition.definitionId === `${CARD_ID_NAMESPACE}dup-card`);
    expect(collisions).toHaveLength(1);
    expect(diagnostics.some((message) => message.includes(`${CARD_ID_NAMESPACE}dup-card`) && message.includes('more than once'))).toBe(true);

    // The wrapper surfaces the same feature diagnostic on the run.
    const run = projectFeatureScenario(scenario, { horizonMonths: 12 });
    expect(run.diagnostics.some((message) => message.includes(`${CARD_ID_NAMESPACE}dup-card`) && message.includes('more than once'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Timeline selection: base vs inactive timeline
// ---------------------------------------------------------------------------

describe('featureHandlers — timeline selection', () => {
  it('selects exactly one named timeline and honours explicit base vs inactive timeline', () => {
    const scenario = zeroedScenario();
    scenario.activeTimelineId = null;
    scenario.largePurchases = [purchase({ id: 'base-buy', amount: 100 })];
    scenario.timelines = [makeTimeline('tl-1', [purchase({ id: 'tl-buy', amount: 200 })])];

    const baseContext = compileScenarioContext(scenario, { timelineId: BASE_TIMELINE_ID, horizonMonths: 12 });
    const baseIds = createFeatureEventDefinitions(scenario, baseContext).map((definition) => definition.definitionId);
    expect(baseIds).toContain('spending:purchase:base-buy');
    expect(baseIds).not.toContain('spending:purchase:tl-buy');

    const timelineContext = compileScenarioContext(scenario, { timelineId: 'tl-1', horizonMonths: 12 });
    const timelineIds = createFeatureEventDefinitions(scenario, timelineContext).map((definition) => definition.definitionId);
    expect(timelineIds).toContain('spending:purchase:tl-buy');
    expect(timelineIds).not.toContain('spending:purchase:base-buy');

    // Wrapper: explicit base, explicit inactive timeline, then active resolution.
    expect(projectFeatureScenario(scenario, { timelineId: 'base', horizonMonths: 12 }).metadata.timelineId).toBeNull();
    expect(projectFeatureScenario(scenario, { timelineId: 'tl-1', horizonMonths: 12 }).metadata.timelineId).toBe('tl-1');

    scenario.activeTimelineId = 'tl-1';
    expect(projectFeatureScenario(scenario, { horizonMonths: 12 }).metadata.timelineId).toBe('tl-1');
  });

  it('assembles the selected timeline\u2019s card plans and never the inactive timeline\u2019s', () => {
    const scenario = zeroedScenario();
    scenario.activeTimelineId = null;
    scenario.cardPlans = [cardPlan('base-card', 100)];
    scenario.timelines = [makeTimeline('tl-card', [])];
    scenario.timelines[0].cardPlans = [cardPlan('tl-card-plan', 200)];

    const baseContext = compileScenarioContext(scenario, { timelineId: BASE_TIMELINE_ID, horizonMonths: 12 });
    const baseIds = createFeatureEventDefinitions(scenario, baseContext).map(
      (definition) => definition.definitionId
    );
    expect(baseIds).toContain(`${CARD_ID_NAMESPACE}base-card`);
    expect(baseIds).not.toContain(`${CARD_ID_NAMESPACE}tl-card-plan`);

    const timelineContext = compileScenarioContext(scenario, { timelineId: 'tl-card', horizonMonths: 12 });
    const timelineIds = createFeatureEventDefinitions(scenario, timelineContext).map(
      (definition) => definition.definitionId
    );
    expect(timelineIds).toContain(`${CARD_ID_NAMESPACE}tl-card-plan`);
    expect(timelineIds).not.toContain(`${CARD_ID_NAMESPACE}base-card`);
  });
});

// ---------------------------------------------------------------------------
// Integrated contention: income funds same-date obligations from one account
// ---------------------------------------------------------------------------

describe('featureHandlers — integrated income → obligation contention', () => {
  it('posts income before same-date loan/rent/card/purchase sharing one account, once each', () => {
    const scenario = zeroedScenario();
    scenario.cashflowItems = [inflow('inflow-1', 1000, '2026-01')];
    scenario.largePurchases = [purchase({ id: 'buy-1', amount: 500 })];
    scenario.loans = [loan('loan-1')];
    scenario.liabilities = [liability('loan-1')];
    scenario.cardPlans = [cardPlan('card-1', 200)];
    scenario.housing = [rentalHousing('home-1')];
    scenario.properties = [rentalProperty('home-1')];

    const run = projectFeatureScenario(scenario, { horizonMonths: 1 });

    // Income ($1,000) arrived first and funded every same-date obligation:
    // loan 300 + rent 150 + card 200 + purchase 350 (partial of 500) = 1,000.
    expect(run.totals.executedNetCents).toBe(100_000);
    expect(run.monthlyCloses[0].openingCashCents).toBe(0);
    expect(run.monthlyCloses[0].closingCashCents).toBe(0);

    expect(run.plans.map((plan) => plan.handlerId)).toEqual([
      LOAN_INSTALLMENT_HANDLER_ID,
      HOUSING_HANDLER_IDS.rent,
      `${CARD_ID_NAMESPACE}card-1:expected`,
      SPENDING_HANDLER_IDS.purchase
    ]);

    const purchasePlan = run.plans.find((plan) => plan.handlerId === SPENDING_HANDLER_IDS.purchase);
    expect(purchasePlan?.requestedCents).toBe(50_000);
    expect(purchasePlan?.executedCents).toBe(35_000);
    expect(purchasePlan?.shortfallCents).toBe(15_000);

    // The composer still exposes a pure handler factory for the facade.
    const context = compileScenarioContext(scenario, { horizonMonths: 1 });
    const handlerIds = createFeatureHandlerFactory(scenario)({
      state: buildState(context.opening),
      context,
      accounts: scenario.netWorth.accounts,
      dateOfBirth: scenario.options.dateOfBirth,
      funding: context.funding
    }).map((handler) => handler.handlerId);
    expect(handlerIds).toEqual(
      expect.arrayContaining([
        INCOME_OTHER_HANDLER_ID,
        LOAN_INSTALLMENT_HANDLER_ID,
        HOUSING_HANDLER_IDS.rent,
        SPENDING_HANDLER_IDS.purchase,
        `${CARD_ID_NAMESPACE}card-1:expected`
      ])
    );
  });

  it('never funds an earlier obligation from later income and posts no payroll for a zero-career scenario', () => {
    const scenario = zeroedScenario();
    scenario.cashflowItems = [inflow('inflow-late', 1000, '2026-03')];
    scenario.largePurchases = [purchase({ id: 'buy-early', yearMonth: '2026-01', amount: 400 })];

    const context = compileScenarioContext(scenario, { horizonMonths: 6 });
    const ids = createFeatureEventDefinitions(scenario, context).map((definition) => definition.definitionId);
    // No career → no payroll definition; only the dated other-income inflow.
    expect(ids.filter((id) => id.startsWith('income:'))).toEqual(['income:other']);

    const run = projectFeatureScenario(scenario, { horizonMonths: 6 });
    const january = run.monthlyCloses.find((close) => close.yearMonth === '2026-01');
    const march = run.monthlyCloses.find((close) => close.yearMonth === '2026-03');
    expect(january?.closingCashCents).toBe(0);
    expect(march?.closingCashCents).toBe(100_000);

    // The January purchase stayed visibly unfunded; no plan was fabricated.
    expect(run.totals.executedPlanCount).toBe(0);
    expect(run.diagnostics.some((message) => message.includes('buy-early') && message.includes('could not be funded'))).toBe(true);
    expect(run.diagnostics.some((message) => message.includes(INCOME_HANDLER_ID))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RV04/F23 — housing funding events follow the selected timeline
// ---------------------------------------------------------------------------

describe('featureHandlers — RV04/F23 housing funding-event timeline scope', () => {
  const GLOBAL_EVENT = { id: 'f-base', date: '2026-01-15', amount: 30_000, accountId: CHECKING };

  /** Pending acquisition whose dated events live on the global `PropertyDefinition`. */
  const pendingProperty = (fundingEvents = [GLOBAL_EVENT]): PropertyDefinition => ({
    id: 'home-1',
    label: 'Future home',
    value: 300_000,
    requiredDownPayment: 60_000,
    status: 'pending',
    debtLink: null,
    appreciationRate: 0,
    sellingCostsRate: 0,
    fundingEvents
  });

  const pendingHousing = (fundingEvents?: HousingEntry['fundingEvents']): HousingEntry => ({
    ...createDefaultHousingEntry(45, DOB, REFERENCE),
    id: 'home-1',
    housingType: 'mortgage',
    startYearMonth: '2026-01',
    purchasePrice: 300_000,
    downPayment: 60_000,
    annualInterestRate: 0,
    loanTermYears: 0,
    extraMonthlyPayment: 0,
    propertyTaxYearly: 0,
    homeInsuranceYearly: 0,
    hoaMonthly: 0,
    maintenanceMonthly: 0,
    pmiMonthly: 0,
    monthlyRent: 0,
    rentalIncomeMonthly: 0,
    sellYearMonth: '',
    paymentSource: `account:${CHECKING}`,
    appreciationRate: 0,
    sellingCostsRate: 0,
    ...(fundingEvents === undefined ? {} : { fundingEvents })
  });

  const housingFundingIds = (definitions: readonly { definitionId: string }[]): string[] =>
    definitions
      .filter((definition) => definition.definitionId.startsWith('housing:home-1:funding:'))
      .map((definition) => definition.definitionId);

  it('schedules the global funding events for the base timeline', () => {
    const scenario = zeroedScenario();
    scenario.properties = [pendingProperty()];
    scenario.housing = [pendingHousing()];

    const context = compileScenarioContext(scenario, { timelineId: BASE_TIMELINE_ID, horizonMonths: 12 });
    expect(housingFundingIds(createFeatureEventDefinitions(scenario, context))).toEqual([
      `housing:home-1:funding:${CHECKING}:f-base`
    ]);
  });

  it('schedules only the selected timeline\u2019s events and never the inactive global/base list', () => {
    const scenario = zeroedScenario();
    scenario.properties = [pendingProperty()];
    scenario.timelines = [makeTimeline('tl-h', [])];
    scenario.timelines[0].housing = [
      pendingHousing([{ id: 'f-tl', date: '2026-02-15', amount: 60_000, accountId: CHECKING }])
    ];

    const context = compileScenarioContext(scenario, { timelineId: 'tl-h', horizonMonths: 12 });
    const ids = housingFundingIds(createFeatureEventDefinitions(scenario, context));

    // Exactly one event: the timeline's own. The global/inactive event is not
    // simulated, inherited, or double-scheduled.
    expect(ids).toEqual([`housing:home-1:funding:${CHECKING}:f-tl`]);
  });

  it('schedules no funding event for a legacy timeline whose housing entry omits fundingEvents', () => {
    const scenario = zeroedScenario();
    scenario.properties = [pendingProperty()];
    scenario.timelines = [makeTimeline('tl-legacy', [])];
    scenario.timelines[0].housing = [pendingHousing()];

    const context = compileScenarioContext(scenario, { timelineId: 'tl-legacy', horizonMonths: 12 });
    expect(housingFundingIds(createFeatureEventDefinitions(scenario, context))).toEqual([]);
  });
});
