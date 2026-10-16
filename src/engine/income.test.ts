import { describe, expect, it } from 'vitest';

import {
  buildIncomeEventDefinitions,
  createIncomeHandlers,
  INCOME_CAP_EVENT_PURPOSE,
  INCOME_CAP_HANDLER_ID,
  INCOME_EVENT_PURPOSE,
  INCOME_HANDLER_ID,
  INCOME_OTHER_EVENT_PURPOSE,
  INCOME_OTHER_HANDLER_ID,
  resolveIncomeMonth,
  resolveMonthlyGrossCents,
  resolveOtherIncomeCentsForMonth,
  resolveOtherIncomeInflows
} from './income';
import { compileScenarioContext, type CompiledScenarioContext } from './configuration';
import { buildState, type EngineState } from './state';
import { createScheduler, type EventExecutionContext, type EventPhase, type ScheduledEvent } from './scheduler';
import type { ProjectionHandlerDependencies } from './projection';
import type { PostingFlowFacts } from './journal';
import { createDefaultCareerEntry, createDefaultScenario } from '../defaultScenario';
import type {
  AccountDefinition,
  CareerDepositPlan,
  CareerEntry,
  CareerPayPlan,
  CareerSourceLine,
  CashflowItem,
  LifeEvent,
  Paycheck,
  PaycheckInfo,
  Scenario
} from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REFERENCE_DATE = new Date(2026, 0, 15, 12, 0, 0);

const CHECKING = 'checking-account-default';
const RETIREMENT = 'retirement401k-account-default';
const HSA = 'hsa-account-default';
const INVESTMENTS = 'investments-account-default';

/** CA01 paycheck: monthly gross $10,000, tax $2,000, employee retirement $500. */
const makeCa01Paycheck = (): Paycheck => ({
  payFrequency: 'monthly',
  categories: [
    {
      id: 'cat-earn',
      label: 'Earnings',
      kind: 'earning',
      lines: [{ id: 'line-gross', label: 'Salary', amount: 10000, mode: 'amount' }]
    },
    {
      id: 'cat-tax',
      label: 'Statutory',
      kind: 'tax',
      lines: [{ id: 'line-tax', label: 'Federal', amount: 2000, mode: 'amount' }]
    },
    {
      id: 'cat-pretax',
      label: 'Other Deductions',
      kind: 'pretax',
      lines: [
        { id: 'line-ret', label: '401k', amount: 500, mode: 'amount', accountId: RETIREMENT, bucket: 'retirement' }
      ]
    }
  ]
});

/** CA01 ordered allocations: 10% of net -> retirement, fixed $100/period -> HSA. */
const ca01DepositPlan = (): CareerDepositPlan => ({
  remainderAccountId: CHECKING,
  allocations: [
    {
      id: 'alloc-ret',
      enabled: true,
      sourceType: 'account',
      sourceId: RETIREMENT,
      contributionRate: 10,
      savingsMonthly: false,
      monthlyWithdrawal: 0,
      mode: 'percentOfSalary'
    },
    {
      id: 'alloc-hsa',
      enabled: true,
      sourceType: 'account',
      sourceId: HSA,
      contributionRate: 0,
      savingsMonthly: false,
      monthlyWithdrawal: 0,
      mode: 'fixedAmount',
      fixedAmount: 100
    }
  ]
});

const makeCareer = (overrides: Partial<CareerEntry> = {}): CareerEntry => {
  const base = createDefaultCareerEntry(0, 40, 65, 'career-1');
  return {
    ...base,
    startYearMonth: '2026-01',
    endYearMonth: '2026-12',
    annualRaiseRate: 0,
    paycheck: makeCa01Paycheck(),
    payPlans: [],
    depositPlan: ca01DepositPlan(),
    ...overrides
  };
};

interface Harness {
  scenario: Scenario;
  context: CompiledScenarioContext;
  state: EngineState;
  deps: ProjectionHandlerDependencies;
}

interface HarnessOptions {
  horizonMonths?: number;
  accountOverrides?: Record<string, (account: AccountDefinition) => Partial<AccountDefinition>>;
  dateOfBirth?: string;
  cashflowItems?: CashflowItem[];
  lifeEvents?: LifeEvent[];
}

const makeHarness = (entries: CareerEntry[], options: HarnessOptions = {}): Harness => {
  const scenario = createDefaultScenario(REFERENCE_DATE);
  scenario.careerPlan = { enabled: true, entries };
  if (options.accountOverrides) {
    scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) =>
      options.accountOverrides?.[account.id] ? { ...account, ...options.accountOverrides[account.id](account) } : account
    );
  }
  if (options.dateOfBirth !== undefined) {
    scenario.options = { ...scenario.options, dateOfBirth: options.dateOfBirth };
  }
  if (options.cashflowItems) {
    scenario.cashflowItems = options.cashflowItems;
  }
  if (options.lifeEvents) {
    scenario.lifeEvents = options.lifeEvents;
  }
  const context = compileScenarioContext(scenario, {
    startDate: '2026-01-01',
    horizonMonths: options.horizonMonths ?? 12
  });
  const state = buildState(context.opening);
  const deps: ProjectionHandlerDependencies = {
    state,
    context,
    accounts: scenario.netWorth.accounts,
    dateOfBirth: scenario.options.dateOfBirth ?? null,
    funding: context.funding
  };
  return { scenario, context, state, deps };
};

const handlerFor = (deps: ProjectionHandlerDependencies, handlerId: string) => {
  const handler = createIncomeHandlers(deps).find((candidate) => candidate.handlerId === handlerId);
  if (!handler) {
    throw new Error(`No handler "${handlerId}".`);
  }
  return handler;
};

const makeExecution = (
  context: CompiledScenarioContext,
  yearMonth: string,
  definitionId: string
): EventExecutionContext => {
  const activeCareer = context.getActiveCareer(yearMonth);
  const phase: EventPhase = definitionId === 'income:cap' ? 'cap' : 'income';
  const purpose =
    definitionId === 'income:cap'
      ? INCOME_CAP_EVENT_PURPOSE
      : definitionId === 'income:other'
        ? INCOME_OTHER_EVENT_PURPOSE
        : INCOME_EVENT_PURPOSE;
  const event: ScheduledEvent = {
    occurrenceId: `${definitionId}:${yearMonth}-01`,
    definitionId,
    date: `${yearMonth}-01`,
    yearMonth,
    phase,
    priority: 0,
    purpose,
    occurrenceIndex: 1,
    handlerId: INCOME_HANDLER_ID
  };
  return {
    context,
    event,
    yearMonth,
    date: `${yearMonth}-01`,
    occurrenceIndex: 1,
    activeCareer,
    activePayPlan: activeCareer ? context.getActivePayPlan(activeCareer.careerId, yearMonth) : null
  };
};

// ---------------------------------------------------------------------------
// P3I.1 — month-scoped selection + definitions
// ---------------------------------------------------------------------------

describe('income — month-scoped career/pay-plan selection', () => {
  it('emits one namespaced monthly definition per active career', () => {
    const { context } = makeHarness([makeCareer()]);
    const definitions = buildIncomeEventDefinitions(context);

    expect(definitions).toHaveLength(1);
    expect(definitions[0].definitionId).toBe('income:career-1');
    expect(definitions[0].phase).toBe('income');
    expect(definitions[0].handlerId).toBe(INCOME_HANDLER_ID);
    expect(definitions[0].recurrence.frequency).toBe('monthly');
    expect(definitions[0].recurrence.startDate).toBe('2026-01-01');
    expect(definitions[0].recurrence.endDate).toBe('2026-12-31');

    const execution = makeExecution(context, '2026-03', 'income:career-1');
    expect(definitions[0].resolveTarget(execution)).toBe(1_000_000);
    expect(definitions[0].isActive?.(execution)).toBe(true);
  });

  it('resolves overlapping careers by the most recently started month', () => {
    const early = makeCareer({ id: 'career-early', startYearMonth: '2026-01', endYearMonth: '2026-12' });
    const late = makeCareer({ id: 'career-late', startYearMonth: '2026-04', endYearMonth: '2026-12' });
    const { context } = makeHarness([early, late]);

    expect(resolveIncomeMonth(context, '2026-03')?.careerId).toBe('career-early');
    expect(resolveIncomeMonth(context, '2026-04')?.careerId).toBe('career-late');
  });

  it('posts nothing in an explicit date gap (no age-only fallback)', () => {
    const first = makeCareer({ id: 'career-a', startYearMonth: '2026-01', endYearMonth: '2026-03' });
    const second = makeCareer({ id: 'career-b', startYearMonth: '2026-06', endYearMonth: '2026-12' });
    const { context, deps } = makeHarness([first, second]);
    const handler = createIncomeHandlers(deps)[0];

    const gap = makeExecution(context, '2026-05', 'income:career-a');
    expect(resolveIncomeMonth(context, '2026-05')).toBeNull();
    expect(resolveMonthlyGrossCents(context, '2026-05')).toBe(0);
    expect(handler.resolveTarget?.(gap, deps)).toBe(0);
    expect(handler.execute({ execution: gap, targetCents: 0, deps }).committed).toBe(false);

    const defA = buildIncomeEventDefinitions(context).find((d) => d.definitionId === 'income:career-a');
    expect(defA?.isActive?.(gap)).toBe(false);
    expect(defA?.isActive?.(makeExecution(context, '2026-02', 'income:career-a'))).toBe(true);
  });

  it('switches to a pay plan at its effective month', () => {
    const plan: CareerPayPlan = {
      id: 'plan-2',
      label: 'Plan 2',
      effectiveYearMonth: '2026-07',
      paycheck: {
        payFrequency: 'monthly',
        categories: [
          {
            id: 'cat-earn',
            label: 'Earnings',
            kind: 'earning',
            lines: [{ id: 'line-gross', label: 'Salary', amount: 12000, mode: 'amount' }]
          }
        ]
      },
      sourceLines: [],
      depositPlan: { remainderAccountId: CHECKING, allocations: [] },
      annualRaiseRate: 0
    };
    const { context } = makeHarness([makeCareer({ payPlans: [plan] })]);

    expect(resolveMonthlyGrossCents(context, '2026-06')).toBe(1_000_000);
    expect(resolveMonthlyGrossCents(context, '2026-07')).toBe(1_200_000);
    expect(resolveMonthlyGrossCents(context, '2026-12')).toBe(1_200_000);
  });

  it('resets the cumulative-share target to share #1 at a midyear plan switch', () => {
    // Weekly $1000 => annual target $52,000 = 5,200,000 cents, whose twelve
    // shares are non-uniform (5200000 % 12 = 4). Calendar-month indexing would
    // start August at share #8; the plan's effective month must start at #1.
    const weeklyPaycheck = (amount: number): Paycheck => ({
      payFrequency: 'weekly',
      categories: [
        {
          id: 'cat-earn',
          label: 'Earnings',
          kind: 'earning',
          lines: [{ id: 'line-gross', label: 'Salary', amount, mode: 'amount' }]
        }
      ]
    });
    const plan: CareerPayPlan = {
      id: 'plan-midyear',
      label: 'Midyear plan',
      effectiveYearMonth: '2026-08',
      paycheck: weeklyPaycheck(1000),
      sourceLines: [],
      depositPlan: { remainderAccountId: CHECKING, allocations: [] },
      annualRaiseRate: 0
    };
    const { context } = makeHarness([makeCareer({ payPlans: [plan], endYearMonth: '2027-12' })], {
      horizonMonths: 24
    });

    // August is occurrence #1 of the new plan (share #1 != calendar share #8).
    expect(resolveMonthlyGrossCents(context, '2026-07')).toBe(1_000_000);
    expect(resolveMonthlyGrossCents(context, '2026-08')).toBe(433_333);
    expect(resolveMonthlyGrossCents(context, '2026-09')).toBe(433_334);
    // July 2027 is occurrence #12, closing the plan's first twelve-month cycle.
    expect(resolveMonthlyGrossCents(context, '2027-07')).toBe(433_333);

    const months = [
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07'
    ];
    const annualSum = months.reduce((total, month) => total + resolveMonthlyGrossCents(context, month), 0);
    // The twelve plan occurrences reconcile exactly to the annual target.
    expect(annualSum).toBe(5_200_000);
  });

  it('treats an explicitly zero line target as valid (resolves to zero)', () => {
    const paycheck: Paycheck = {
      payFrequency: 'monthly',
      categories: [
        {
          id: 'cat-earn',
          label: 'Earnings',
          kind: 'earning',
          lines: [
            { id: 'line-gross', label: 'Salary', amount: 10000, mode: 'amount' },
            { id: 'line-zero', label: 'Zero line', amount: 0, mode: 'amount' }
          ]
        }
      ]
    };
    const { context } = makeHarness([makeCareer({ paycheck })]);

    // The zero line contributes nothing and never throws into the annual target.
    expect(resolveMonthlyGrossCents(context, '2026-02')).toBe(1_000_000);
  });

  it('raises from the effective date using month precision (no age)', () => {
    const { context } = makeHarness([makeCareer({ annualRaiseRate: 12, endYearMonth: '2027-12' })], {
      horizonMonths: 24
    });

    expect(resolveMonthlyGrossCents(context, '2026-01')).toBe(1_000_000);
    // 12 months elapsed -> (1.12)^1
    expect(resolveMonthlyGrossCents(context, '2027-01')).toBe(1_120_000);
  });

  it('never reads a flat-only paycheckInfo (D9 granular authority)', () => {
    const career = makeCareer({
      paycheck: undefined,
      paycheckInfo: { grossSalary: 120000 } as PaycheckInfo
    });
    const { context } = makeHarness([career]);

    expect(resolveIncomeMonth(context, '2026-02')).toBeNull();
    expect(resolveMonthlyGrossCents(context, '2026-02')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P3I.2 — payroll compilation and posting
// ---------------------------------------------------------------------------

describe('income — payroll posting', () => {
  it('CA01: posts gross once and routes every destination exactly', () => {
    const { context, state, deps } = makeHarness([makeCareer()]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    const target = handler.resolveTarget?.(execution, deps) ?? 0;
    expect(target).toBe(1_000_000);

    const result = handler.execute({ execution, targetCents: target, deps });
    expect(result.committed).toBe(true);
    expect(result.diagnostics ?? []).toEqual([]);

    // Employee $500 + 10%-of-net allocation $750.
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(125_000);
    expect(state.getAccountBalanceCents(HSA)).toBe(10_000);
    // Gross 10000 - tax 2000 - employee 500 - allocations 850 = remainder.
    expect(state.getAccountBalanceCents(CHECKING)).toBe(665_000);
    // Net worth: gross - tax only (internal transfers net to zero).
    expect(state.getTotals().netWorthCents).toBe(800_000);
  });

  it('posts nothing when salary is zero', () => {
    const paycheck: Paycheck = {
      payFrequency: 'monthly',
      categories: [
        {
          id: 'cat-earn',
          label: 'Earnings',
          kind: 'earning',
          lines: [{ id: 'line-gross', label: 'Salary', amount: 0, mode: 'amount' }]
        }
      ]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    expect(handler.resolveTarget?.(execution, deps)).toBe(0);
    const result = handler.execute({ execution, targetCents: 0, deps });
    expect(result.committed).toBe(false);
    expect(state.getTotals().netWorthCents).toBe(0);
  });

  it('posts employer match separately without deducting it from net pay', () => {
    const paycheck = makeCa01Paycheck();
    paycheck.categories.push({
      id: 'cat-employer',
      label: 'Employer Benefits',
      kind: 'employer',
      lines: [{ id: 'line-match', label: 'Match', amount: 200, mode: 'amount', accountId: RETIREMENT, bucket: 'retirement' }]
    });
    const { context, state, deps } = makeHarness([makeCareer({ paycheck })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    const result = handler.execute({ execution, targetCents: 1_000_000, deps });
    expect(result.committed).toBe(true);

    // employee 500 + allocation 750 + employer 200.
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(145_000);
    // Net pay is unchanged by the employer deposit.
    expect(state.getAccountBalanceCents(CHECKING)).toBe(665_000);
    // Income (8000) + separate employer money (200).
    expect(state.getTotals().netWorthCents).toBe(820_000);
  });

  it('CA01: resolves valid employee retirement/HSA destinations with no unresolved diagnostic', () => {
    const paycheck = makeCa01Paycheck();
    paycheck.categories[2].lines.push({
      id: 'line-hsa',
      label: 'HSA',
      amount: 250,
      mode: 'amount',
      accountId: HSA,
      bucket: 'hsa'
    });
    const { context, state, deps } = makeHarness([makeCareer({ paycheck })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    const result = handler.execute({ execution, targetCents: 1_000_000, deps });

    expect(result.committed).toBe(true);
    expect(result.diagnostics ?? []).toEqual([]);
    // Both employee destinations are credited (valid existing paths).
    expect(state.getAccountBalanceCents(RETIREMENT)).toBeGreaterThan(50_000);
    expect(state.getAccountBalanceCents(HSA)).toBeGreaterThan(0);
    expect(state.getTotals().netWorthCents).toBe(800_000);
  });

  it('keeps an employee retirement deduction in the remainder when its destination is missing', () => {
    const paycheck = makeCa01Paycheck();
    // Blank account id => unresolved employee retirement destination.
    paycheck.categories[2].lines[0].accountId = '';
    const { context, state, deps } = makeHarness([makeCareer({ paycheck })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    const result = handler.execute({ execution, targetCents: 1_000_000, deps });

    expect(result.committed).toBe(true);
    expect(result.diagnostics?.some((note) => note.includes('no resolvable destination'))).toBe(true);

    // Gross 10000 - tax 2000 stays; the unresolved $500 is NOT destroyed and
    // does NOT become an invented allocation (net pay budget stays 7500).
    // allocation 10% of 7500 = 750 -> retirement; fixed 100 -> HSA.
    expect(state.getAccountBalanceCents(CHECKING)).toBe(715_000);
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(75_000);
    expect(state.getAccountBalanceCents(HSA)).toBe(10_000);
    // Net worth is gross - tax only (the $500 remains inside the system).
    expect(state.getTotals().netWorthCents).toBe(800_000);
  });

  it('keeps the deduction in the remainder for an unresolved alternate account id', () => {
    const paycheck = makeCa01Paycheck();
    paycheck.categories[2].lines[0].accountId = 'retirement-account-does-not-exist';
    const { context, state, deps } = makeHarness([makeCareer({ paycheck })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    const result = handler.execute({ execution, targetCents: 1_000_000, deps });

    expect(result.committed).toBe(true);
    expect(result.diagnostics?.some((note) => note.includes('no resolvable destination'))).toBe(true);
    expect(state.getAccountBalanceCents(CHECKING)).toBe(715_000);
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(75_000);
    expect(state.getAccountBalanceCents(HSA)).toBe(10_000);
    expect(state.getTotals().netWorthCents).toBe(800_000);
  });

  it('keeps an employee HSA deduction in the remainder when its destination is missing', () => {
    const paycheck = makeCa01Paycheck();
    paycheck.categories[2].lines.push({
      id: 'line-hsa',
      label: 'HSA',
      amount: 250,
      mode: 'amount',
      accountId: '',
      bucket: 'hsa'
    });
    const { context, state, deps } = makeHarness([makeCareer({ paycheck })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    const result = handler.execute({ execution, targetCents: 1_000_000, deps });

    expect(result.committed).toBe(true);
    expect(result.diagnostics?.some((note) => note.includes('no resolvable destination'))).toBe(true);

    // net 10000 - 2000 tax - 500 retirement - 250 HSA = 7250;
    // 10% of 7250 = 725 -> retirement; fixed 100 -> HSA. Unresolved 250 stays.
    expect(state.getAccountBalanceCents(CHECKING)).toBe(667_500);
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(122_500);
    expect(state.getAccountBalanceCents(HSA)).toBe(10_000);
    expect(state.getTotals().netWorthCents).toBe(800_000);
  });
});

// ---------------------------------------------------------------------------
// P3I.3 — ordered net allocations, remainder, unmet
// ---------------------------------------------------------------------------

describe('income — ordered allocations and remainder', () => {
  it('deposits multiple allocation lines to distinct accounts in order', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [
        {
          id: 'a1',
          enabled: true,
          sourceType: 'account',
          sourceId: RETIREMENT,
          contributionRate: 20,
          savingsMonthly: false,
          monthlyWithdrawal: 0
        },
        {
          id: 'a2',
          enabled: true,
          sourceType: 'account',
          sourceId: HSA,
          contributionRate: 0,
          savingsMonthly: false,
          monthlyWithdrawal: 0,
          mode: 'fixedAmount',
          fixedAmount: 50
        }
      ]
    };
    const paycheck: Paycheck = {
      payFrequency: 'monthly',
      categories: [
        {
          id: 'cat-earn',
          label: 'Earnings',
          kind: 'earning',
          lines: [{ id: 'line-gross', label: 'Salary', amount: 10000, mode: 'amount' }]
        },
        {
          id: 'cat-tax',
          label: 'Statutory',
          kind: 'tax',
          lines: [{ id: 'line-tax', label: 'Federal', amount: 2000, mode: 'amount' }]
        }
      ]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck, depositPlan })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    expect(handler.execute({ execution, targetCents: 1_000_000, deps }).committed).toBe(true);

    // Net 8000: 20% (1600) -> retirement, fixed 50 -> HSA, 6350 remainder.
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(160_000);
    expect(state.getAccountBalanceCents(HSA)).toBe(5_000);
    expect(state.getAccountBalanceCents(CHECKING)).toBe(635_000);
    expect(state.getTotals().netWorthCents).toBe(800_000);
  });

  it('leaves a missing destination unresolved in the remainder (no invented deposit)', () => {
    const depositPlan = ca01DepositPlan();
    depositPlan.allocations = [{ ...depositPlan.allocations[0], sourceId: '' }];
    const { context, state, deps } = makeHarness([makeCareer({ depositPlan })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    const result = handler.execute({ execution, targetCents: 1_000_000, deps });
    expect(result.committed).toBe(true);
    expect(result.diagnostics?.some((note) => note.includes('no resolvable destination'))).toBe(true);

    // Gross 10000 - tax 2000 - employee 500 = 7500 stays in the remainder.
    expect(state.getAccountBalanceCents(CHECKING)).toBe(750_000);
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(50_000);
    expect(state.getTotals().netWorthCents).toBe(800_000);
  });

  it('reports unmet allocations without reallocating them when net pay is exhausted', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [
        {
          id: 'a1',
          enabled: true,
          sourceType: 'account',
          sourceId: RETIREMENT,
          contributionRate: 100,
          savingsMonthly: false,
          monthlyWithdrawal: 0
        },
        {
          id: 'a2',
          enabled: true,
          sourceType: 'account',
          sourceId: HSA,
          contributionRate: 50,
          savingsMonthly: false,
          monthlyWithdrawal: 0
        }
      ]
    };
    const paycheck: Paycheck = {
      payFrequency: 'monthly',
      categories: [
        {
          id: 'cat-earn',
          label: 'Earnings',
          kind: 'earning',
          lines: [{ id: 'line-gross', label: 'Salary', amount: 10000, mode: 'amount' }]
        },
        {
          id: 'cat-tax',
          label: 'Statutory',
          kind: 'tax',
          lines: [{ id: 'line-tax', label: 'Federal', amount: 2000, mode: 'amount' }]
        }
      ]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck, depositPlan })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    const result = handler.execute({ execution, targetCents: 1_000_000, deps });
    expect(result.committed).toBe(true);
    expect(result.diagnostics?.some((note) => note.includes('unmet'))).toBe(true);

    // Net 8000: 100% -> retirement; the second 50% request has nothing left.
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(800_000);
    expect(state.getAccountBalanceCents(HSA)).toBe(0);
    expect(state.getAccountBalanceCents(CHECKING)).toBe(0);
    expect(state.getTotals().netWorthCents).toBe(800_000);
  });

  it('posts nothing when the remainder destination is missing', () => {
    const depositPlan: CareerDepositPlan = { remainderAccountId: null, allocations: [] };
    const { context, state, deps } = makeHarness([makeCareer({ depositPlan })]);
    const handler = createIncomeHandlers(deps)[0];
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    const result = handler.execute({ execution, targetCents: 1_000_000, deps });
    expect(result.committed).toBe(false);
    expect(result.diagnostics?.some((note) => note.includes('remainder destination'))).toBe(true);
    expect(state.getTotals().netWorthCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P3I.4 — incoming cap overflow + cap-phase existing excess
// ---------------------------------------------------------------------------

const grossTaxPaycheck = (): Paycheck => ({
  payFrequency: 'monthly',
  categories: [
    {
      id: 'cat-earn',
      label: 'Earnings',
      kind: 'earning',
      lines: [{ id: 'line-gross', label: 'Salary', amount: 10000, mode: 'amount' }]
    },
    {
      id: 'cat-tax',
      label: 'Statutory',
      kind: 'tax',
      lines: [{ id: 'line-tax', label: 'Federal', amount: 2000, mode: 'amount' }]
    }
  ]
});

const cappedAllocation = (
  sourceId: string,
  contributionRate: number,
  maxBalance: number,
  overflowFallbackAccountId: string | null
): CareerSourceLine => ({
  id: `alloc-${sourceId}`,
  enabled: true,
  sourceType: 'account',
  sourceId,
  contributionRate,
  savingsMonthly: false,
  monthlyWithdrawal: 0,
  maxBalance,
  overflowFallbackAccountId
});

const retirementWithBalance = (openingBalance: number) => () => ({ openingBalance });

describe('income — P3I.4 incoming cap overflow', () => {
  it('routes incoming overflow to the explicit fallback without over-filling the cap', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [cappedAllocation(RETIREMENT, 100, 5000, INVESTMENTS)]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck: grossTaxPaycheck(), depositPlan })], {
      accountOverrides: { [RETIREMENT]: retirementWithBalance(4000) }
    });
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    const result = payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps
    });

    expect(result.committed).toBe(true);
    // Net 8000: headroom 1000 -> retirement, 7000 overflow -> investments.
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(500_000);
    expect(state.getAccountBalanceCents(INVESTMENTS)).toBe(700_000);
    expect(state.getAccountBalanceCents(CHECKING)).toBe(0);
    // Opening 4000 + 8000 income = 12000.
    expect(state.getTotals().netWorthCents).toBe(1_200_000);
    expect(result.diagnostics?.some((note) => note.includes('incoming overflow'))).toBe(true);
  });

  it('leaves incoming overflow in the account when the fallback is missing', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [cappedAllocation(RETIREMENT, 100, 5000, null)]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck: grossTaxPaycheck(), depositPlan })], {
      accountOverrides: { [RETIREMENT]: retirementWithBalance(4000) }
    });
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    const result = payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps
    });

    expect(result.committed).toBe(true);
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(1_200_000);
    expect(result.diagnostics?.some((note) => note.includes('was left in the account'))).toBe(true);
  });

  it('rejects a self overflow destination', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [cappedAllocation(RETIREMENT, 100, 5000, RETIREMENT)]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck: grossTaxPaycheck(), depositPlan })], {
      accountOverrides: { [RETIREMENT]: retirementWithBalance(4000) }
    });
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    const result = payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps
    });

    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(1_200_000);
    expect(result.diagnostics?.some((note) => note.includes('source account'))).toBe(true);
  });

  it('rejects a cyclic overflow path', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [
        cappedAllocation(RETIREMENT, 100, 5000, INVESTMENTS),
        cappedAllocation(INVESTMENTS, 0, 100000, RETIREMENT)
      ]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck: grossTaxPaycheck(), depositPlan })], {
      accountOverrides: { [RETIREMENT]: retirementWithBalance(4000) }
    });
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    const result = payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps
    });

    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(1_200_000);
    expect(result.diagnostics?.some((note) => note.includes('cycle'))).toBe(true);
  });
});

describe('income — P3I.4 cap-phase existing excess', () => {
  it('moves existing excess only when a cap is explicitly configured', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [cappedAllocation(RETIREMENT, 0, 3000, INVESTMENTS)]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck: grossTaxPaycheck(), depositPlan })], {
      accountOverrides: { [RETIREMENT]: retirementWithBalance(4000) }
    });

    const capDef = buildIncomeEventDefinitions(context).find((d) => d.definitionId === 'income:cap');
    expect(capDef?.phase).toBe('cap');

    const cap = handlerFor(deps, INCOME_CAP_HANDLER_ID);
    const execution = makeExecution(context, '2026-02', 'income:cap');
    expect(cap.resolveTarget?.(execution, deps)).toBe(100_000);
    const result = cap.execute({ execution, targetCents: 100_000, deps });

    expect(result.committed).toBe(true);
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(300_000);
    expect(state.getAccountBalanceCents(INVESTMENTS)).toBe(100_000);
    expect(result.diagnostics?.some((note) => note.includes('existing excess'))).toBe(true);
  });

  it('refuses to reroute existing excess out of a restricted account', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [cappedAllocation(RETIREMENT, 0, 3000, INVESTMENTS)]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck: grossTaxPaycheck(), depositPlan })], {
      accountOverrides: {
        [RETIREMENT]: (account) => ({
          openingBalance: 4000,
          withdrawalPolicy: { ...account.withdrawalPolicy, restrictionNote: 'Restricted' }
        })
      }
    });
    const cap = handlerFor(deps, INCOME_CAP_HANDLER_ID);
    const result = cap.execute({
      execution: makeExecution(context, '2026-02', 'income:cap'),
      targetCents: 100_000,
      deps
    });

    expect(result.committed).toBe(false);
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(400_000);
    expect(result.diagnostics?.some((note) => note.includes('restricted'))).toBe(true);
  });

  it('orders the cap-phase definition after income for the same month', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [cappedAllocation(RETIREMENT, 0, 3000, INVESTMENTS)]
    };
    const { context } = makeHarness([makeCareer({ paycheck: grossTaxPaycheck(), depositPlan })]);
    const definitions = buildIncomeEventDefinitions(context);
    const scheduler = createScheduler(context, definitions, { startDate: '2026-02-01', endDate: '2026-02-28' });

    const batch = scheduler.batchFor('2026-02');
    expect(batch?.events.map((event) => event.phase)).toEqual(['income', 'cap']);
    expect(batch?.events.map((event) => event.definitionId)).toEqual(['income:career-1', 'income:cap']);
  });

  it('emits no cap definition when every maxBalance is off (0)', () => {
    const { context } = makeHarness([makeCareer()]);
    expect(buildIncomeEventDefinitions(context).map((d) => d.definitionId)).toEqual(['income:career-1']);
  });
});

// ---------------------------------------------------------------------------
// P3I.5 — dated other-income inflows
// ---------------------------------------------------------------------------

const cashflowInflow = (overrides: Partial<CashflowItem> = {}): CashflowItem => ({
  id: 'cf-1',
  category: 'inheritance',
  label: 'Inheritance',
  enabled: true,
  cadence: 'one_time',
  direction: 'inflow',
  amount: 50000,
  startAge: 0,
  endAge: 0,
  accountId: INVESTMENTS,
  ...overrides
});

const lifeEventInflow = (overrides: Partial<LifeEvent> = {}): LifeEvent => ({
  id: 'le-1',
  type: 'custom_income',
  label: 'Gift',
  enabled: true,
  cadence: 'one_time',
  direction: 'inflow',
  startAge: 0,
  endAge: 0,
  amount: 7000,
  newSalary: 0,
  annualSalaryGrowthOverride: 0,
  accountId: INVESTMENTS,
  startYearMonth: '2026-06',
  ...overrides
});

describe('income — P3I.5 other-income inflows', () => {
  it('posts a one-time inflow at its exact month only', () => {
    const { context, state, deps } = makeHarness([makeCareer()], {
      cashflowItems: [cashflowInflow({ startYearMonth: '2026-06' })]
    });
    const other = handlerFor(deps, INCOME_OTHER_HANDLER_ID);

    expect(other.resolveTarget?.(makeExecution(context, '2026-05', 'income:other'), deps)).toBe(0);
    const due = makeExecution(context, '2026-06', 'income:other');
    expect(other.resolveTarget?.(due, deps)).toBe(5_000_000);

    const result = other.execute({ execution: due, targetCents: 5_000_000, deps });
    expect(result.committed).toBe(true);
    expect(state.getAccountBalanceCents(INVESTMENTS)).toBe(5_000_000);
    expect(state.getTotals().netWorthCents).toBe(5_000_000);
  });

  it('splits a recurring annual inflow across the months in range', () => {
    const { context, state, deps } = makeHarness([makeCareer()], {
      cashflowItems: [
        cashflowInflow({
          category: 'pension_1',
          cadence: 'recurring',
          amount: 24000,
          startYearMonth: '2026-01',
          endYearMonth: '2026-03'
        })
      ]
    });
    const other = handlerFor(deps, INCOME_OTHER_HANDLER_ID);

    expect(other.resolveTarget?.(makeExecution(context, '2026-02', 'income:other'), deps)).toBe(200_000);
    expect(other.resolveTarget?.(makeExecution(context, '2026-04', 'income:other'), deps)).toBe(0);

    const result = other.execute({
      execution: makeExecution(context, '2026-02', 'income:other'),
      targetCents: 200_000,
      deps
    });
    expect(result.committed).toBe(true);
    expect(state.getAccountBalanceCents(INVESTMENTS)).toBe(200_000);
  });

  it('derives an age-only date deterministically from a valid date of birth', () => {
    const { context } = makeHarness([makeCareer()], {
      dateOfBirth: '1980-10-01',
      cashflowItems: [cashflowInflow({ startYearMonth: undefined, startAge: 46 })]
    });
    const resolution = resolveOtherIncomeInflows(context, '1980-10-01');

    expect(resolution.diagnostics).toEqual([]);
    expect(resolution.inflows[0]?.startYearMonth).toBe('2026-10');
    expect(resolveOtherIncomeCentsForMonth(resolution, '2026-10')).toBe(5_000_000);
    expect(resolveOtherIncomeCentsForMonth(resolution, '2026-09')).toBe(0);
  });

  it('reports an explicit diagnostic for an age-only item with no valid DOB', () => {
    const { context } = makeHarness([makeCareer()], {
      cashflowItems: [cashflowInflow({ startYearMonth: undefined, startAge: 46 })]
    });

    const resolution = resolveOtherIncomeInflows(context, '');
    expect(resolution.inflows).toEqual([]);
    expect(resolution.diagnostics.some((note) => note.includes('no valid date of birth'))).toBe(true);

    // Age-derived definitions require the date of birth at build time.
    const otherDef = buildIncomeEventDefinitions(context, { dateOfBirth: '1980-10-01' }).find(
      (d) => d.definitionId === 'income:other'
    );
    expect(otherDef?.resolveTarget(makeExecution(context, '2026-10', 'income:other'))).toBe(5_000_000);
    expect(otherDef?.resolveTarget(makeExecution(context, '2026-09', 'income:other'))).toBe(0);
  });

  it('ignores outflows, property-sale cashflows and housing/other life events', () => {
    const { context } = makeHarness([makeCareer()], {
      cashflowItems: [
        cashflowInflow({ id: 'outflow-item', category: 'college_child_1', direction: 'outflow', startYearMonth: '2026-06' }),
        cashflowInflow({ id: 'sale-item', category: 'home_real_estate', startYearMonth: '2026-06' })
      ],
      lifeEvents: [
        lifeEventInflow({ id: 'sale', type: 'house_sale' }),
        lifeEventInflow({ id: 'income', type: 'custom_income', startYearMonth: '2026-07' })
      ]
    });

    const resolution = resolveOtherIncomeInflows(context, null);
    expect(resolution.inflows.map((inflow) => inflow.id)).toEqual(['life:income']);
  });

  it('reports a missing destination and posts nothing', () => {
    const { context, state, deps } = makeHarness([makeCareer()], {
      cashflowItems: [cashflowInflow({ accountId: '', startYearMonth: '2026-06' })]
    });
    const other = handlerFor(deps, INCOME_OTHER_HANDLER_ID);
    const result = other.execute({
      execution: makeExecution(context, '2026-06', 'income:other'),
      targetCents: 5_000_000,
      deps
    });

    expect(result.committed).toBe(false);
    expect(result.diagnostics?.some((note) => note.includes('no resolvable destination'))).toBe(true);
    expect(state.getTotals().netWorthCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P4.1 D15 — income posting-journal stamping
// ---------------------------------------------------------------------------

const deltaByAccount = (changes: readonly { accountId: string; deltaCents: number }[]): Map<string, number> =>
  new Map(changes.map((change) => [change.accountId, change.deltaCents]));

describe('income — D15 posting-journal stamping', () => {
  it('journals one stamped row per payroll commit, crediting gross exactly once', () => {
    const { context, state, deps } = makeHarness([makeCareer()]);
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    const execution = makeExecution(context, '2026-02', 'income:career-1');

    expect(state.getPostings()).toEqual([]);
    const result = payroll.execute({ execution, targetCents: 1_000_000, deps });
    expect(result.committed).toBe(true);

    const postings = state.getPostings();
    expect(postings).toHaveLength(1);
    const record = postings[0];
    expect(record.posting).toMatchObject({
      occurrenceId: 'income:career-1:2026-02-01',
      definitionId: 'income:career-1',
      purpose: INCOME_EVENT_PURPOSE,
      date: '2026-02-01',
      phase: 'income'
    });
    expect(record.posting.facts).toBeDefined();

    // The append-only indexes resolve the same single occurrence/definition/month.
    expect(state.getPostingsByOccurrence('income:career-1:2026-02-01')).toHaveLength(1);
    expect(state.getPostingsByDefinition('income:career-1')).toHaveLength(1);
    expect(state.getPostingsByMonth('2026-02')).toHaveLength(1);

    // Gross is credited once: the declared conservation delta is gross − tax,
    // and each sparse account delta already nets its own transfers/deductions.
    expect(record.expectedNetWorthDeltaCents).toBe(800_000);
    const byAccount = deltaByAccount(record.accountChanges);
    expect(byAccount.get(CHECKING)).toBe(665_000);
    expect(byAccount.get(RETIREMENT)).toBe(125_000);
    expect(byAccount.get(HSA)).toBe(10_000);
    expect(record.accountChanges.reduce((total, change) => total + change.deltaCents, 0)).toBe(
      record.expectedNetWorthDeltaCents
    );
  });

  it('keeps the payroll posting purpose distinct from withdrawal-withholding purposes', () => {
    const { context, state, deps } = makeHarness([makeCareer()]);
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    const execution = makeExecution(context, '2026-02', 'income:career-1');
    payroll.execute({ execution, targetCents: 1_000_000, deps });

    const purpose = state.getPostings()[0].posting.purpose;
    // Payroll taxes are stamped as payroll (`income`), never as the funding
    // purposes used for retirement/planner withdrawal withholding, so the audit
    // never aggregates payroll deductions into withdrawal taxes.
    expect(purpose).toBe(INCOME_EVENT_PURPOSE);
    expect(['retirement', 'planner']).not.toContain(purpose);
  });

  it('journals the cap existing-excess transfer as a zero net-worth posting', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [cappedAllocation(RETIREMENT, 0, 3000, INVESTMENTS)]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck: grossTaxPaycheck(), depositPlan })], {
      accountOverrides: { [RETIREMENT]: retirementWithBalance(4000) }
    });
    const cap = handlerFor(deps, INCOME_CAP_HANDLER_ID);

    const result = cap.execute({
      execution: makeExecution(context, '2026-02', 'income:cap'),
      targetCents: 100_000,
      deps
    });
    expect(result.committed).toBe(true);

    const postings = state.getPostings();
    expect(postings).toHaveLength(1);
    const record = postings[0];
    expect(record.posting).toEqual({
      occurrenceId: 'income:cap:2026-02-01',
      definitionId: 'income:cap',
      purpose: INCOME_CAP_EVENT_PURPOSE,
      date: '2026-02-01',
      phase: 'cap'
    });
    // The internal cap transfer never carries payroll facts.
    expect(record.posting.facts).toBeUndefined();
    // Internal transfer: equal and opposite account deltas, net-worth delta 0.
    expect(record.expectedNetWorthDeltaCents).toBe(0);
    const byAccount = deltaByAccount(record.accountChanges);
    expect(byAccount.get(RETIREMENT)).toBe(-100_000);
    expect(byAccount.get(INVESTMENTS)).toBe(100_000);
  });

  it('journals a positive-delta posting for dated other income', () => {
    const { context, state, deps } = makeHarness([makeCareer()], {
      cashflowItems: [cashflowInflow({ startYearMonth: '2026-06' })]
    });
    const other = handlerFor(deps, INCOME_OTHER_HANDLER_ID);

    const result = other.execute({
      execution: makeExecution(context, '2026-06', 'income:other'),
      targetCents: 5_000_000,
      deps
    });
    expect(result.committed).toBe(true);

    const postings = state.getPostings();
    expect(postings).toHaveLength(1);
    const record = postings[0];
    expect(record.posting.definitionId).toBe('income:other');
    expect(record.posting.purpose).toBe(INCOME_OTHER_EVENT_PURPOSE);
    expect(record.posting.phase).toBe('income');
    // Facts are payroll-only: the dated-inflow posting leaves them absent.
    expect(record.posting.facts).toBeUndefined();
    expect(record.expectedNetWorthDeltaCents).toBe(5_000_000);
    expect(record.accountChanges).toEqual([{ accountId: INVESTMENTS, deltaCents: 5_000_000 }]);
  });

  it('journals nothing and loses nothing when a destination is missing', () => {
    // Payroll with no remainder destination: no commit, no journal row, no loss.
    const payrollHarness = makeHarness([makeCareer({ depositPlan: { remainderAccountId: null, allocations: [] } })]);
    const payroll = handlerFor(payrollHarness.deps, INCOME_HANDLER_ID);
    const payrollResult = payroll.execute({
      execution: makeExecution(payrollHarness.context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps: payrollHarness.deps
    });
    expect(payrollResult.committed).toBe(false);
    expect(payrollHarness.state.getPostings()).toEqual([]);
    expect(payrollHarness.state.getTotals().netWorthCents).toBe(0);

    // Other income with an unknown destination: no commit, no journal row, no loss.
    const otherHarness = makeHarness([makeCareer()], {
      cashflowItems: [cashflowInflow({ accountId: '', startYearMonth: '2026-06' })]
    });
    const other = handlerFor(otherHarness.deps, INCOME_OTHER_HANDLER_ID);
    const otherResult = other.execute({
      execution: makeExecution(otherHarness.context, '2026-06', 'income:other'),
      targetCents: 5_000_000,
      deps: otherHarness.deps
    });
    expect(otherResult.committed).toBe(false);
    expect(otherHarness.state.getPostings()).toEqual([]);
    expect(otherHarness.state.getTotals().netWorthCents).toBe(0);
  });

  it('journals nothing for a zero/no-op income commit', () => {
    const zeroPaycheck: Paycheck = {
      payFrequency: 'monthly',
      categories: [
        {
          id: 'cat-earn',
          label: 'Earnings',
          kind: 'earning',
          lines: [{ id: 'line-gross', label: 'Salary', amount: 0, mode: 'amount' }]
        }
      ]
    };
    const payrollHarness = makeHarness([makeCareer({ paycheck: zeroPaycheck })]);
    const payroll = handlerFor(payrollHarness.deps, INCOME_HANDLER_ID);
    const payrollResult = payroll.execute({
      execution: makeExecution(payrollHarness.context, '2026-02', 'income:career-1'),
      targetCents: 0,
      deps: payrollHarness.deps
    });
    expect(payrollResult.committed).toBe(false);
    expect(payrollHarness.state.getPostings()).toEqual([]);

    // A cap pass with no excess above the cap is a no-op: no journal row.
    const capHarness = makeHarness(
      [
        makeCareer({
          paycheck: grossTaxPaycheck(),
          depositPlan: { remainderAccountId: CHECKING, allocations: [cappedAllocation(RETIREMENT, 0, 5000, INVESTMENTS)] }
        })
      ],
      { accountOverrides: { [RETIREMENT]: retirementWithBalance(4000) } }
    );
    const cap = handlerFor(capHarness.deps, INCOME_CAP_HANDLER_ID);
    const capResult = cap.execute({
      execution: makeExecution(capHarness.context, '2026-02', 'income:cap'),
      targetCents: 0,
      deps: capHarness.deps
    });
    expect(capResult.committed).toBe(false);
    expect(capHarness.state.getPostings()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P4.2 — payroll posting facts (D15)
// ---------------------------------------------------------------------------

/** The exact gross-conservation identity the journal validates. */
const expectGrossConservation = (facts: PostingFlowFacts): void => {
  expect(facts.grossEarningsCents).toBe(
    facts.netPayCents +
      facts.payrollTaxCents +
      facts.otherDeductionsCents +
      facts.employeeRetirementCents +
      facts.employeeHsaCents +
      facts.unresolvedEmployeeCents
  );
};

describe('income — D15 payroll posting facts', () => {
  it('stamps CA01 source-driven executed figures', () => {
    const { context, state, deps } = makeHarness([makeCareer()]);
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps
    });

    const facts = state.getPostings()[0].posting.facts as PostingFlowFacts;
    expect(facts).toEqual({
      grossEarningsCents: 1_000_000,
      netPayCents: 750_000,
      payrollTaxCents: 200_000,
      otherDeductionsCents: 0,
      employeeRetirementCents: 50_000,
      employeeHsaCents: 0,
      employerRetirementCents: 0,
      employerHsaCents: 0,
      unresolvedEmployeeCents: 0,
      allocations: [
        { lineId: 'alloc-ret', accountId: RETIREMENT, requestedCents: 75_000, executedCents: 75_000 },
        { lineId: 'alloc-hsa', accountId: HSA, requestedCents: 10_000, executedCents: 10_000 }
      ]
    });
    expectGrossConservation(facts);
  });

  it('records a missing employee destination as unresolved, never as net pay', () => {
    const paycheck = makeCa01Paycheck();
    paycheck.categories[2].lines[0].accountId = '';
    const { context, state, deps } = makeHarness([makeCareer({ paycheck })]);
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps
    });

    const facts = state.getPostings()[0].posting.facts as PostingFlowFacts;
    // gross 10000 = net 7500 + tax 2000 + unresolved 500 (employee retirement).
    expect(facts.netPayCents).toBe(750_000);
    expect(facts.payrollTaxCents).toBe(200_000);
    expect(facts.employeeRetirementCents).toBe(0);
    expect(facts.unresolvedEmployeeCents).toBe(50_000);
    expectGrossConservation(facts);

    // The retained 500 stays in the system: assets = net 7500 + unresolved 500.
    expect(state.getAccountBalanceCents(CHECKING)).toBe(715_000);
    expect(state.getAccountBalanceCents(RETIREMENT)).toBe(75_000);
    expect(state.getAccountBalanceCents(HSA)).toBe(10_000);
    expect(state.getTotals().netWorthCents).toBe(800_000);
  });

  it('stamps actual taken amounts, not planned, when gross pay is exhausted', () => {
    const paycheck: Paycheck = {
      payFrequency: 'monthly',
      categories: [
        {
          id: 'cat-earn',
          label: 'Earnings',
          kind: 'earning',
          lines: [{ id: 'line-gross', label: 'Salary', amount: 1000, mode: 'amount' }]
        },
        {
          id: 'cat-tax',
          label: 'Statutory',
          kind: 'tax',
          lines: [{ id: 'line-tax', label: 'Federal', amount: 500, mode: 'amount' }]
        },
        {
          id: 'cat-pretax',
          label: 'Other Deductions',
          kind: 'pretax',
          lines: [
            { id: 'line-ret', label: '401k', amount: 800, mode: 'amount', accountId: RETIREMENT, bucket: 'retirement' }
          ]
        }
      ]
    };
    const depositPlan: CareerDepositPlan = { remainderAccountId: CHECKING, allocations: [] };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck, depositPlan })]);
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    const result = payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 100_000,
      deps
    });

    expect(result.committed).toBe(true);
    expect(result.diagnostics?.some((note) => note.includes('truncated'))).toBe(true);

    const facts = state.getPostings()[0].posting.facts as PostingFlowFacts;
    expect(facts.grossEarningsCents).toBe(100_000);
    expect(facts.netPayCents).toBe(0);
    expect(facts.payrollTaxCents).toBe(50_000);
    // Planned employee retirement was 80000; only 50000 remained after tax.
    expect(facts.employeeRetirementCents).toBe(50_000);
    expect(facts.unresolvedEmployeeCents).toBe(0);
    expectGrossConservation(facts);
  });

  it('stamps oversubscribed requests with executed bounded by net pay', () => {
    const depositPlan: CareerDepositPlan = {
      remainderAccountId: CHECKING,
      allocations: [
        {
          id: 'alloc-over',
          enabled: true,
          sourceType: 'account',
          sourceId: RETIREMENT,
          contributionRate: 150,
          savingsMonthly: false,
          monthlyWithdrawal: 0
        }
      ]
    };
    const { context, state, deps } = makeHarness([makeCareer({ paycheck: grossTaxPaycheck(), depositPlan })]);
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    const result = payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps
    });
    expect(result.committed).toBe(true);

    const facts = state.getPostings()[0].posting.facts as PostingFlowFacts;
    const [allocation] = facts.allocations;
    // Requested 150% of net (8000) = 12000; executed is bounded at net pay 8000.
    expect(allocation.requestedCents).toBe(1_200_000);
    expect(allocation.executedCents).toBe(800_000);
    expect(facts.allocations.reduce((total, line) => total + line.executedCents, 0)).toBeLessThanOrEqual(
      facts.netPayCents
    );
    expectGrossConservation(facts);
  });

  it('keeps employer deposits external to gross conservation', () => {
    const paycheck = makeCa01Paycheck();
    paycheck.categories.push({
      id: 'cat-employer',
      label: 'Employer Benefits',
      kind: 'employer',
      lines: [
        { id: 'line-match', label: 'Match', amount: 200, mode: 'amount', accountId: RETIREMENT, bucket: 'retirement' }
      ]
    });
    const { context, state, deps } = makeHarness([makeCareer({ paycheck })]);
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps
    });

    const facts = state.getPostings()[0].posting.facts as PostingFlowFacts;
    expect(facts.employerRetirementCents).toBe(20_000);
    expectGrossConservation(facts);
    // External employer money adds to assets but is not part of gross: 8000 + 200.
    expect(state.getTotals().netWorthCents).toBe(820_000);
  });

  it('deep-freezes the journal payroll facts and their allocations', () => {
    const { context, state, deps } = makeHarness([makeCareer()]);
    const payroll = handlerFor(deps, INCOME_HANDLER_ID);
    payroll.execute({
      execution: makeExecution(context, '2026-02', 'income:career-1'),
      targetCents: 1_000_000,
      deps
    });

    const facts = state.getPostings()[0].posting.facts as PostingFlowFacts;
    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts.allocations)).toBe(true);
    expect(Object.isFrozen(facts.allocations[0])).toBe(true);
  });
});
