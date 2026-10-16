/**
 * P3S.1 — focused tests for the headless spending stream.
 *
 * Proves the stream schedules and executes large purchases, long-term monthly
 * purchases (inclusive start/end, day-31 clamp), career monthly-withdrawal
 * expenses and cashflow/life-event outflows; that each occurrence requests an
 * actual integer-cent target exactly once through `quoteFunding`/`commitFunding`;
 * that partial/unfunded/income-sourced obligations stay visible without invented
 * money; and that planner/card/loan/housing events are never duplicated.
 */

import { describe, expect, it } from 'vitest';

import {
  createDefaultCareerEntry,
  createDefaultCashflowItem,
  createDefaultHousingEntry,
  createDefaultLoan,
  createDefaultOrdinaryCardSchedule,
  createDefaultScenario
} from '../defaultScenario';
import type {
  CareerSourceLine,
  CashflowItem,
  LargePurchase,
  LifeEvent,
  LongTermPurchase,
  Scenario,
  SourceLine
} from '../types';
import type { CompiledScenarioContext } from './configuration';
import { compileScenarioContext } from './configuration';
import { projectScenario } from './projection';
import { createScheduler } from './scheduler';
import { buildSpendingEventDefinitions, createSpendingHandlers, SPENDING_HANDLER_IDS } from './spending';
import type { SpendingDateAnchor } from './spending';

const REFERENCE = new Date(2026, 0, 1, 12, 0, 0);
const DOB = '1980-10-01';
const CHECKING = 'checking-account-default';
const SAVINGS = 'emergencyFund-account-default';
const INVESTMENTS = 'investments-account-default';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Zeroed, career-free scenario anchored to a clean month start. */
const scenario = (): Scenario => {
  const value = createDefaultScenario(REFERENCE);
  value.netWorth.asOfDate = '2026-01-01';
  value.careerPlan = { enabled: false, entries: [] };
  value.cashflowItems = [];
  value.lifeEvents = [];
  value.netWorth.accounts = value.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  return value;
};

const setBalance = (target: Scenario, accountId: string, dollars: number): void => {
  target.netWorth.accounts = target.netWorth.accounts.map((account) =>
    account.id === accountId ? { ...account, openingBalance: dollars } : account
  );
};

const purchase = (overrides: Partial<LargePurchase> = {}): LargePurchase => ({
  id: 'buy',
  label: 'Buy',
  enabled: true,
  showOnGraph: true,
  yearMonth: '2026-03',
  yearMonthMarkerId: null,
  age: 45,
  amount: 1200,
  fundingSource: `account:${CHECKING}`,
  ...overrides
});

const longTerm = (overrides: Partial<LongTermPurchase> = {}): LongTermPurchase => ({
  id: 'lt',
  label: 'Long Term',
  enabled: true,
  showOnGraph: true,
  startYearMonth: '2026-01',
  endMode: 'duration',
  durationMonths: 3,
  endYearMonth: '',
  monthlyAmount: 300,
  fundingSource: `account:${CHECKING}`,
  ...overrides
});

const sourceLine = (accountId: string, amount: number, overrides: Partial<SourceLine> = {}): SourceLine => ({
  id: `line-${accountId}`,
  enabled: true,
  accountId,
  sourceType: 'account',
  sourceId: accountId,
  mode: 'amount',
  amount,
  ...overrides
});

const careerLine = (
  accountId: string,
  monthlyWithdrawal: number,
  overrides: Partial<CareerSourceLine> = {}
): CareerSourceLine => ({
  id: `career-line-${accountId}`,
  enabled: true,
  sourceType: 'account',
  sourceId: accountId,
  contributionRate: 0,
  savingsMonthly: false,
  monthlyWithdrawal,
  ...overrides
});

const outflowCashflow = (overrides: Partial<CashflowItem> = {}): CashflowItem => ({
  ...createDefaultCashflowItem('college_child_1', 45, 65, 30),
  id: 'college',
  amount: 500,
  accountId: CHECKING,
  startYearMonth: '2026-02',
  endYearMonth: '2026-03',
  ...overrides
});

const lifeEvent = (overrides: Partial<LifeEvent> = {}): LifeEvent => ({
  id: 'le',
  type: 'custom_expense',
  label: 'Life Event',
  enabled: true,
  cadence: 'one_time',
  direction: 'outflow',
  startAge: 45,
  endAge: 45,
  amount: 250,
  newSalary: 0,
  annualSalaryGrowthOverride: 0,
  accountId: CHECKING,
  startYearMonth: '2026-02',
  endYearMonth: '2026-02',
  ...overrides
});

const compile = (target: Scenario, horizonMonths = 12): CompiledScenarioContext =>
  compileScenarioContext(target, { horizonMonths });

/** Explicit, non-clock age anchor derived from the scenario + opening month. */
const anchorFor = (target: Scenario, context: CompiledScenarioContext): SpendingDateAnchor => ({
  dateOfBirth: target.options.dateOfBirth,
  currentAge: target.profile.currentAge,
  referenceYearMonth: context.metadata.startYearMonth
});

const runSpending = (target: Scenario, horizonMonths = 12, anchor?: SpendingDateAnchor) => {
  const context = compile(target, horizonMonths);
  const resolvedAnchor = anchor ?? anchorFor(target, context);
  return projectScenario(target, {
    horizonMonths,
    events: buildSpendingEventDefinitions(context, resolvedAnchor),
    handlerFactory: (deps) => createSpendingHandlers(deps, resolvedAnchor)
  });
};

const definitionsFor = (
  target: Scenario,
  horizonMonths = 12,
  anchor?: SpendingDateAnchor,
  diagnostics?: string[]
): string[] => {
  const context = compile(target, horizonMonths);
  return buildSpendingEventDefinitions(context, anchor ?? anchorFor(target, context), diagnostics).map(
    (definition) => definition.definitionId
  );
};

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

describe('spending stream — purchases', () => {
  it('funds a one-off large purchase exactly once from its explicit account', () => {
    const target = scenario();
    setBalance(target, CHECKING, 5000);
    target.largePurchases = [purchase()];

    const run = runSpending(target);
    expect(run.plans).toHaveLength(1);

    const plan = run.plans[0];
    expect(plan.definitionId).toBe('spending:purchase:buy');
    expect(plan.occurrenceId).toBe('spending:purchase:buy:2026-03-01');
    expect(plan.phase).toBe('discretionary');
    expect(plan.requestedCents).toBe(120000);
    expect(plan.executedCents).toBe(120000);
    expect(plan.shortfallCents).toBe(0);
    expect(plan.status).toBe('funded');
    expect(run.totals.closingCashCents).toBe(380000);

    // Caller scenario is never mutated (only state commits change money).
    expect(target.netWorth.accounts.find((account) => account.id === CHECKING)?.openingBalance).toBe(5000);

    // One execution only, recorded in its month.
    const march = run.monthlyCloses.find((close) => close.yearMonth === '2026-03');
    expect(march?.executedOccurrenceIds).toEqual(['spending:purchase:buy:2026-03-01']);
  });

  it('leaves a partially-funded purchase visible with an unpaid diagnostic', () => {
    const target = scenario();
    setBalance(target, CHECKING, 500);
    target.largePurchases = [purchase({ amount: 1200 })];

    const run = runSpending(target);
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].status).toBe('partial');
    expect(run.plans[0].executedCents).toBe(50000);
    expect(run.plans[0].shortfallCents).toBe(70000);
    expect(run.diagnostics.some((message) => message.includes('partially funded'))).toBe(true);
    expect(run.totals.closingCashCents).toBe(0);
  });

  it('fabricates no plan for a zero-balance (zero-income) obligation', () => {
    const target = scenario();
    target.largePurchases = [purchase()];

    const run = runSpending(target);
    expect(run.plans).toHaveLength(0);
    expect(run.diagnostics.some((message) => message.includes('could not be funded'))).toBe(true);
    expect(run.totals.closingCashCents).toBe(0);
  });

  it('keeps a legacy income funding source visibly unresolved (no invented money)', () => {
    const target = scenario();
    setBalance(target, CHECKING, 5000);
    target.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    target.largePurchases = [purchase({ fundingSource: 'income' })];

    expect(definitionsFor(target)).toContain('spending:purchase:buy');
    const run = runSpending(target);
    expect(run.plans).toHaveLength(0);
    expect(run.diagnostics.some((message) => message.includes('no funding source'))).toBe(true);
    expect(run.totals.closingCashCents).toBe(500000);
  });

  it('uses the configured global funding policy only when nothing is named', () => {
    const target = scenario();
    setBalance(target, CHECKING, 5000);
    target.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    target.largePurchases = [purchase({ fundingSource: undefined })];

    const run = runSpending(target);
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].executedCents).toBe(120000);
    expect(run.totals.closingCashCents).toBe(380000);
  });

  it('applies explicit ordered source-line quotas and reports the shortfall', () => {
    const target = scenario();
    setBalance(target, CHECKING, 2000);
    setBalance(target, SAVINGS, 2000);
    target.largePurchases = [
      purchase({ amount: 1000, fundingSource: undefined, sourceLines: [sourceLine(CHECKING, 300), sourceLine(SAVINGS, 400)] })
    ];

    const run = runSpending(target);
    expect(run.plans).toHaveLength(1);
    const plan = run.plans[0];
    expect(plan.status).toBe('partial');
    expect(plan.executedCents).toBe(70000);
    expect(plan.shortfallCents).toBe(30000);
    expect(plan.plan.allocations.map((allocation) => allocation.accountId)).toEqual([CHECKING, SAVINGS]);
    expect(plan.plan.allocations.map((allocation) => allocation.netFundedCents)).toEqual([30000, 40000]);
  });

  it('caps each source at its live balance while honoring later quotas', () => {
    const target = scenario();
    setBalance(target, CHECKING, 100);
    setBalance(target, SAVINGS, 2000);
    target.largePurchases = [
      purchase({ amount: 1000, fundingSource: undefined, sourceLines: [sourceLine(CHECKING, 300), sourceLine(SAVINGS, 400)] })
    ];

    const run = runSpending(target);
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].executedCents).toBe(50000);
    expect(run.plans[0].shortfallCents).toBe(50000);
    expect(run.plans[0].plan.allocations.map((allocation) => allocation.netFundedCents)).toEqual([10000, 40000]);
  });

  it('debits gross and credits the actual net for a taxable source', () => {
    const target = scenario();
    setBalance(target, INVESTMENTS, 5000);
    target.largePurchases = [purchase({ amount: 1000, fundingSource: `account:${INVESTMENTS}` })];

    const run = runSpending(target);
    expect(run.plans).toHaveLength(1);
    const plan = run.plans[0];
    expect(plan.executedCents).toBe(100000);
    expect(plan.grossDebitCents).toBe(103093);
    expect(plan.taxCents).toBe(3093);
    expect(plan.grossDebitCents).toBe(plan.executedCents + plan.taxCents + plan.penaltyCents);
    expect(run.totals.closingCashCents).toBe(500000 - 103093);
  });
});

// ---------------------------------------------------------------------------
// Long-term monthly purchases
// ---------------------------------------------------------------------------

describe('spending stream — long-term monthly purchases', () => {
  it('schedules inclusive months with a day-31 target clamped to the month end', () => {
    const target = scenario();
    target.longTermPurchases = [longTerm()];
    const context = compile(target, 6);
    const scheduler = createScheduler(context, buildSpendingEventDefinitions(context));

    const datesIn = (yearMonth: string): string[] =>
      (scheduler.batchFor(yearMonth)?.events ?? [])
        .filter((event) => event.definitionId === 'spending:longterm:lt')
        .map((event) => event.date);

    expect(datesIn('2026-01')).toEqual(['2026-01-31']);
    expect(datesIn('2026-02')).toEqual(['2026-02-28']); // day-31 clamps in a short month
    expect(datesIn('2026-03')).toEqual(['2026-03-31']);
    expect(datesIn('2026-04')).toEqual([]);
  });

  it('honors an explicit inclusive end month', () => {
    const target = scenario();
    target.longTermPurchases = [longTerm({ endMode: 'endDate', endYearMonth: '2026-04' })];
    const context = compile(target, 6);
    const scheduler = createScheduler(context, buildSpendingEventDefinitions(context));

    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map(
      (yearMonth) =>
        (scheduler.batchFor(yearMonth)?.events ?? []).filter((event) => event.definitionId === 'spending:longterm:lt').length
    );
    expect(months).toEqual([1, 1, 1, 1, 0]);
  });

  it('executes one mandatory payment per inclusive month', () => {
    const target = scenario();
    setBalance(target, CHECKING, 2000);
    target.longTermPurchases = [longTerm()];

    const run = runSpending(target, 6);
    expect(run.plans).toHaveLength(3);
    expect(run.plans.map((plan) => plan.yearMonth)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(run.plans.every((plan) => plan.executedCents === 30000)).toBe(true);
    expect(run.totals.closingCashCents).toBe(200000 - 90000);
  });

  it('ignores disabled and undated long-term purchases', () => {
    const target = scenario();
    setBalance(target, CHECKING, 2000);
    target.longTermPurchases = [
      longTerm({ id: 'lt-off', enabled: false }),
      longTerm({ id: 'lt-nodate', startYearMonth: '' })
    ];
    expect(definitionsFor(target, 6).filter((id) => id.startsWith('spending:longterm'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Career monthly withdrawals
// ---------------------------------------------------------------------------

describe('spending stream — career monthly withdrawals', () => {
  const career = (id: string, startYearMonth: string, endYearMonth: string, lines: CareerSourceLine[], raiseRate = 0) => {
    const entry = createDefaultCareerEntry(0, 45, 65, id);
    return {
      ...entry,
      startYearMonth,
      endYearMonth,
      annualRaiseRate: raiseRate,
      sourceLines: lines,
      payPlans: []
    };
  };

  it('funds each active career month from its own account and skips date gaps', () => {
    const target = scenario();
    target.careerPlan = {
      enabled: true,
      entries: [
        career('career-a', '2026-01', '2026-03', [careerLine(SAVINGS, 200)]),
        career('career-b', '2026-05', '2026-06', [careerLine(SAVINGS, 100)])
      ]
    };
    setBalance(target, SAVINGS, 2000);

    const run = runSpending(target, 6);
    expect(run.plans.map((plan) => plan.yearMonth)).toEqual(['2026-01', '2026-02', '2026-03', '2026-05', '2026-06']);
    expect(run.plans.some((plan) => plan.yearMonth === '2026-04')).toBe(false);
    expect(run.plans.slice(0, 3).every((plan) => plan.definitionId === `spending:career:career-a:${SAVINGS}`)).toBe(true);
    expect(run.plans.slice(3).every((plan) => plan.definitionId === `spending:career:career-b:${SAVINGS}`)).toBe(true);
    expect(run.plans.map((plan) => plan.executedCents)).toEqual([20000, 20000, 20000, 10000, 10000]);
  });

  it('keeps career withdrawals account-funded (no income) and degrades to a diagnostic', () => {
    const target = scenario();
    target.careerPlan = {
      enabled: true,
      entries: [career('career-a', '2026-01', '2026-01', [careerLine(SAVINGS, 300)])]
    };
    setBalance(target, SAVINGS, 100);

    const run = runSpending(target, 2);
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].status).toBe('partial');
    expect(run.plans[0].executedCents).toBe(10000);
    expect(run.plans[0].shortfallCents).toBe(20000);
    expect(run.diagnostics.some((message) => message.includes('partially funded'))).toBe(true);
  });

  it('scales only the withdrawals flagged to increase with the paycheck', () => {
    const target = scenario();
    target.careerPlan = {
      enabled: true,
      entries: [
        career('career-raise', '2026-01', '2027-01', [
          careerLine(SAVINGS, 100, { increaseWithdrawalWithPaycheck: true }),
          careerLine(CHECKING, 100, { increaseWithdrawalWithPaycheck: false })
        ], 12)
      ]
    };
    setBalance(target, SAVINGS, 10000);
    setBalance(target, CHECKING, 10000);

    const run = runSpending(target, 13);
    const savings = run.plans.filter(
      (plan) => plan.definitionId === `spending:career:career-raise:${SAVINGS}`
    );
    const checking = run.plans.filter(
      (plan) => plan.definitionId === `spending:career:career-raise:${CHECKING}`
    );

    expect(savings.map((plan) => plan.yearMonth)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01'
    ]);
    expect(savings[0].requestedCents).toBe(10000);
    expect(savings[savings.length - 1].requestedCents).toBe(11200);
    expect(checking.every((plan) => plan.requestedCents === 10000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cashflow / life-event outflows
// ---------------------------------------------------------------------------

describe('spending stream — cashflow and life-event outflows', () => {
  it('schedules only outflows and never the income stream inflows', () => {
    const target = scenario();
    setBalance(target, CHECKING, 10000);
    target.cashflowItems = [
      outflowCashflow(),
      { ...createDefaultCashflowItem('pension_1', 45, 65, 30), id: 'pension', startYearMonth: '2026-02', endYearMonth: '2026-03' }
    ];
    target.lifeEvents = [
      lifeEvent(),
      lifeEvent({ id: 'le-in', direction: 'inflow', type: 'custom_income' }),
      lifeEvent({ id: 'le-house', type: 'house_purchase', amount: 100000 })
    ];

    const ids = definitionsFor(target);
    expect(ids).toContain('spending:cashflow:college');
    expect(ids).not.toContain('spending:cashflow:pension');
    expect(ids).toContain('spending:life:le');
    expect(ids).not.toContain('spending:life:le-in');
    expect(ids).not.toContain('spending:life:le-house');

    const run = runSpending(target);
    expect(run.plans.map((plan) => plan.definitionId)).toEqual([
      'spending:cashflow:college',
      'spending:life:le',
      'spending:cashflow:college'
    ]);
    expect(run.totals.closingCashCents).toBe(1000000 - 125000);
  });
});

// ---------------------------------------------------------------------------
// Age-only cashflow / life-event outflows (F19 / F20)
// ---------------------------------------------------------------------------

describe('spending stream — age-only cashflow and life-event outflows', () => {
  it('derives a recurring schedule from startAge/endAge with no explicit month', () => {
    const target = scenario();
    setBalance(target, CHECKING, 100000);
    target.cashflowItems = [
      outflowCashflow({
        id: 'age-out',
        amount: 100,
        startAge: 46,
        endAge: 47,
        startYearMonth: undefined,
        endYearMonth: undefined
      }),
      {
        ...createDefaultCashflowItem('social_security', 46, 65, 30),
        id: 'age-in',
        direction: 'inflow',
        startAge: 46,
        endAge: 47,
        amount: 100
      }
    ];

    const ids = definitionsFor(target, 24);
    expect(ids).toContain('spending:cashflow:age-out');
    // Income is owned by the income stream: an age-only inflow is never scheduled here.
    expect(ids).not.toContain('spending:cashflow:age-in');

    const run = runSpending(target, 24);
    // DOB 1980-10-01 + age 46 → 2026-10; age 47 → 2027-10 (inclusive).
    expect(run.plans.map((plan) => plan.yearMonth)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
      '2027-10'
    ]);
    expect(run.plans.every((plan) => plan.definitionId === 'spending:cashflow:age-out')).toBe(true);
    expect(run.plans.every((plan) => plan.executedCents === 10000)).toBe(true);
    expect(run.plans.some((plan) => plan.definitionId === 'spending:cashflow:age-in')).toBe(false);
  });

  it('fires a one-time age-only outflow once at its resolved start month', () => {
    const target = scenario();
    setBalance(target, CHECKING, 10000);
    target.lifeEvents = [
      lifeEvent({
        id: 'age-one',
        cadence: 'one_time',
        startAge: 47,
        endAge: 47,
        startYearMonth: undefined,
        endYearMonth: undefined,
        amount: 250
      })
    ];

    const run = runSpending(target, 24);
    expect(run.plans.map((plan) => [plan.definitionId, plan.yearMonth])).toEqual([
      ['spending:life:age-one', '2027-10']
    ]);
  });

  it('lets an explicit year-month win over the age anchor', () => {
    const target = scenario();
    setBalance(target, CHECKING, 10000);
    target.cashflowItems = [
      outflowCashflow({ id: 'explicit', startAge: 60, endAge: 70, startYearMonth: '2026-03', endYearMonth: '2026-04' })
    ];

    const run = runSpending(target, 6);
    expect(run.plans.map((plan) => plan.yearMonth)).toEqual(['2026-03', '2026-04']);
  });

  it('keeps the horizon-end default for an explicitly dated recurring outflow', () => {
    const target = scenario();
    setBalance(target, CHECKING, 10000);
    target.cashflowItems = [
      outflowCashflow({
        id: 'explicit-open',
        amount: 50,
        startAge: 46,
        endAge: 47,
        startYearMonth: '2026-02',
        endYearMonth: undefined
      })
    ];

    const run = runSpending(target, 4);
    // Explicit start keeps the prior behavior: no end → horizon end (not age end).
    expect(run.plans.map((plan) => plan.yearMonth)).toEqual(['2026-02', '2026-03', '2026-04']);
  });

  it('lets a resolved marker date win over the age anchor', () => {
    const target = scenario();
    setBalance(target, CHECKING, 10000);
    target.dateMarkers = [{ id: 'm1', label: 'Marker', date: '2026-05-15' }];
    target.cashflowItems = [
      outflowCashflow({
        id: 'marked',
        cadence: 'one_time',
        startAge: 60,
        endAge: 70,
        startYearMonth: undefined,
        endYearMonth: undefined,
        startMarkerId: 'm1'
      })
    ];

    const run = runSpending(target, 6);
    expect(run.plans.map((plan) => plan.yearMonth)).toEqual(['2026-05']);
  });

  it('falls back to currentAge and the explicit opening month when the DOB is unusable', () => {
    const target = scenario();
    setBalance(target, CHECKING, 10000);
    target.cashflowItems = [
      outflowCashflow({
        id: 'age-fallback',
        amount: 100,
        startAge: 45,
        endAge: 46,
        startYearMonth: undefined,
        endYearMonth: undefined
      })
    ];

    const anchor: SpendingDateAnchor = {
      dateOfBirth: 'not-a-date',
      currentAge: 45,
      referenceYearMonth: '2026-01'
    };
    const run = runSpending(target, 18, anchor);
    // currentAge 45 at 2026-01 → start 2026-01; age 46 → 2027-01 (inclusive).
    expect(run.plans.map((plan) => plan.yearMonth)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01'
    ]);
  });

  it('leaves an age-only outflow unresolved with a diagnostic when no anchor exists', () => {
    const target = scenario();
    setBalance(target, CHECKING, 10000);
    target.cashflowItems = [
      outflowCashflow({ id: 'no-anchor', startAge: 46, endAge: 47, startYearMonth: undefined, endYearMonth: undefined })
    ];

    const context = compile(target, 24);
    const diagnostics: string[] = [];
    const ids = buildSpendingEventDefinitions(
      context,
      { dateOfBirth: 'not-a-date', currentAge: null },
      diagnostics
    ).map((definition) => definition.definitionId);

    // Invalid DOB and no current-age anchor → unresolved, never an arbitrary date.
    expect(ids).not.toContain('spending:cashflow:no-anchor');
    expect(diagnostics.join('\n')).toMatch(/no authoritative age anchor/);

    const run = runSpending(target, 24, { dateOfBirth: 'not-a-date', currentAge: null });
    expect(run.plans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Ownership guards
// ---------------------------------------------------------------------------

describe('spending stream — ownership', () => {
  it('does not duplicate planner/card/loan/housing events', () => {
    const target = scenario();
    setBalance(target, CHECKING, 10000);
    target.largePurchases = [purchase()];
    target.loans = [{ ...createDefaultLoan(45, DOB, REFERENCE), id: 'loan-x' }];
    target.cardPlans = [{ ...createDefaultOrdinaryCardSchedule(REFERENCE), id: 'card-x' }];
    target.housing = [{ ...createDefaultHousingEntry(45, DOB, REFERENCE), id: 'home-x' }];

    const ids = definitionsFor(target);
    expect(ids).toEqual(['spending:purchase:buy']);
    expect(ids.some((id) => id.includes('loan-x') || id.includes('card-x') || id.includes('home-x'))).toBe(false);
  });

  it('exposes one handler per spending namespace', () => {
    const deps = { context: compile(scenario(), 1) } as unknown as Parameters<typeof createSpendingHandlers>[0];
    const handlers = createSpendingHandlers(deps);
    expect(handlers.map((handler) => handler.handlerId)).toEqual([
      SPENDING_HANDLER_IDS.purchase,
      SPENDING_HANDLER_IDS.longterm,
      SPENDING_HANDLER_IDS.career,
      SPENDING_HANDLER_IDS.cashflow,
      SPENDING_HANDLER_IDS.life
    ]);
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D15 — posting journal attribution
// ---------------------------------------------------------------------------

describe('P4.1/D15 — spending posting journal attribution', () => {
  const expectedPurpose = (definitionId: string): string => {
    if (definitionId.startsWith('spending:purchase:')) return 'purchase';
    if (definitionId.startsWith('spending:longterm:')) return 'longTermPurchase';
    if (definitionId.startsWith('spending:career:')) return 'careerExpense';
    if (definitionId.startsWith('spending:cashflow:')) return 'cashflowOutflow';
    if (definitionId.startsWith('spending:life:')) return 'lifeEventOutflow';
    return '';
  };

  it('journals exactly one indexed posting per committed funding plan', () => {
    const target = scenario();
    setBalance(target, CHECKING, 5000);
    target.largePurchases = [purchase()];
    target.longTermPurchases = [longTerm()];

    const run = runSpending(target, 6);
    expect(run.plans.length).toBeGreaterThan(0);

    for (const plan of run.plans) {
      const rows = run.postings.filter((record) => record.posting.occurrenceId === plan.occurrenceId);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.posting.definitionId).toBe(plan.definitionId);
      expect(row.posting.purpose).toBe(expectedPurpose(plan.definitionId));
      expect(row.posting.phase).toBe(plan.phase);
      expect(row.posting.date).toBe(plan.date);
      // Exactly one account debit per committed plan, equal to its gross debit.
      expect(row.accountChanges).toEqual([{ accountId: CHECKING, deltaCents: -plan.grossDebitCents }]);
    }

    // Stream postings reconcile 1:1 with committed plans (nothing fabricated).
    expect(
      run.postings.filter((record) => (record.posting.definitionId ?? '').startsWith('spending:'))
    ).toHaveLength(run.plans.length);
  });

  it('journals nothing for a zero/unfunded occurrence', () => {
    const target = scenario();
    target.largePurchases = [purchase({ fundingSource: 'income' })];
    const run = runSpending(target, 6);
    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
  });

  it('preserves requested/tax/shortfall math alongside the taxable posting', () => {
    const target = scenario();
    setBalance(target, INVESTMENTS, 5000);
    target.largePurchases = [purchase({ amount: 1000, fundingSource: `account:${INVESTMENTS}` })];

    const run = runSpending(target, 6);
    expect(run.plans).toHaveLength(1);
    const plan = run.plans[0];
    // Unchanged CA04 math.
    expect(plan.executedCents).toBe(100000);
    expect(plan.grossDebitCents).toBe(103093);
    expect(plan.taxCents).toBe(3093);
    expect(plan.shortfallCents).toBe(0);
    expect(plan.grossDebitCents).toBe(plan.executedCents + plan.taxCents + plan.penaltyCents);

    const rows = run.postings.filter((record) => record.posting.occurrenceId === plan.occurrenceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.posting.purpose).toBe('purchase');
    expect(rows[0]?.accountChanges).toEqual([{ accountId: INVESTMENTS, deltaCents: -plan.grossDebitCents }]);
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D16 — funding outcomes for unfunded / partial quotes
// ---------------------------------------------------------------------------

describe('P4.1/D16 — spending funding outcomes', () => {
  it('records an unfunded outcome for a positive request that executes nothing', () => {
    const target = scenario();
    // A positive purchase request against an empty account: no commit, no plan.
    target.largePurchases = [purchase()];

    const run = runSpending(target, 6);
    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.occurrenceId).toBe('spending:purchase:buy:2026-03-01');
    expect(outcome.definitionId).toBe('spending:purchase:buy');
    expect(outcome.phase).toBe('discretionary');
    expect(outcome.committed).toBe(false);
    expect(outcome.plan.request.requestedCents).toBe(120000);
    expect(outcome.plan.executedCents).toBe(0);
    expect(outcome.plan.status).toBe('unfunded');
  });

  it('records a committed partial outcome while the plan audit keeps the shortfall', () => {
    const target = scenario();
    setBalance(target, CHECKING, 500);
    target.largePurchases = [purchase({ amount: 1200 })];

    const run = runSpending(target, 6);
    expect(run.plans).toHaveLength(1);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.committed).toBe(true);
    expect(outcome.plan.status).toBe('partial');
    expect(outcome.plan.shortfallCents).toBe(70000);
    // Committed real plan audit is preserved (not rewritten by the outcome).
    expect(run.plans[0]?.shortfallCents).toBe(70000);
    expect(run.postings).toHaveLength(1);
  });
});
