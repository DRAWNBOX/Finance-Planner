import { describe, expect, it } from 'vitest';

import {
  BASE_TIMELINE_ID,
  CONTEXT_SCHEMA_VERSION,
  ContextValidationError,
  compileScenarioContext,
  type CompiledAccount
} from './configuration';
import { FULL_HORIZON_MONTHS, addMonths, endOfMonthDate } from './dates';
import { addTimeline, applyToActiveTimeline } from '../commands';
import {
  createDefaultCareerEntry,
  createDefaultCashflowItem,
  createDefaultHousingEntry,
  createDefaultLoan,
  createDefaultOrdinaryCardSchedule,
  createDefaultScenario,
  createDefaultZeroInterestCardPlan
} from '../defaultScenario';
import type { CardPlan, CareerEntry, CareerPayPlan, LargePurchase, Scenario } from '../types';

// Local noon cannot roll into an adjacent calendar month in any time zone, so
// the wall-clock-free factories receive an explicit, deterministic reference.
const REFERENCE_DATE = new Date(2026, 0, 15, 12, 0, 0);
const DOB = '1980-10-01';

const makeScenario = (): Scenario => createDefaultScenario(REFERENCE_DATE);

const makePurchase = (id: string, yearMonth = '2030-01'): LargePurchase => ({
  id,
  label: id,
  enabled: true,
  showOnGraph: true,
  yearMonth,
  yearMonthMarkerId: null,
  age: 50,
  amount: 1000
});

const makeCareer = (id: string, startYearMonth: string, endYearMonth: string): CareerEntry => ({
  ...createDefaultCareerEntry(0, 45, 65, id),
  startYearMonth,
  endYearMonth
});

const makePlan = (id: string, effectiveYearMonth: string): CareerPayPlan => ({
  id,
  label: id,
  effectiveYearMonth,
  paycheck: { payFrequency: 'monthly', categories: [] },
  sourceLines: []
});

const purchaseIds = (scenario: Scenario, timelineId?: string | null): string[] =>
  compileScenarioContext(scenario, timelineId === undefined ? {} : { timelineId }).domains.purchases.map((p) => p.id);

describe('configuration — selection and isolation', () => {
  it('compiles base vs timeline domains in isolation', () => {
    let scenario = makeScenario();
    scenario.largePurchases = [makePurchase('p-base', '2030-01')];
    scenario = addTimeline(scenario, { id: 'tl-a', label: 'Timeline A' });
    scenario = applyToActiveTimeline(scenario, (data) => ({
      ...data,
      purchases: [makePurchase('p-tl', '2031-02')]
    }));

    expect(purchaseIds(scenario, BASE_TIMELINE_ID)).toEqual(['p-base']);
    expect(purchaseIds(scenario, null)).toEqual(['p-base']);
    expect(purchaseIds(scenario, 'tl-a')).toEqual(['p-tl']);

    const active = compileScenarioContext(scenario);
    expect(active.timelineId).toBe('tl-a');
    expect(active.timelineLabel).toBe('Timeline A');
    expect(active.domains.purchases.map((p) => p.id)).toEqual(['p-tl']);
  });

  it('falls back to base and diagnoses a dangling active timeline id', () => {
    const scenario = makeScenario();
    scenario.activeTimelineId = 'ghost';
    const ctx = compileScenarioContext(scenario);
    expect(ctx.timelineId).toBeNull();
    expect(ctx.metadata.timelineId).toBeNull();
    expect(ctx.diagnostics.some((message) => message.includes('ghost'))).toBe(true);
  });

  it('throws for an unknown explicit timeline id', () => {
    expect(() => compileScenarioContext(makeScenario(), { timelineId: 'does-not-exist' })).toThrow(
      ContextValidationError
    );
  });

  it('validates inactive timelines without simulating or including them', () => {
    let scenario = makeScenario();
    scenario = addTimeline(scenario, { id: 'tl-1', label: 'Timeline 1' });
    const loan = { ...createDefaultLoan(45, DOB, REFERENCE_DATE), id: 'loan-tl' };
    scenario = applyToActiveTimeline(scenario, (data) => ({ ...data, loans: [loan] }));

    const base = compileScenarioContext(scenario, { timelineId: 'base' });
    expect(base.domains.loans).toHaveLength(0);
    expect(base.funding.obligations.some((order) => order.obligationId === 'loan-tl')).toBe(false);

    const timeline = compileScenarioContext(scenario, { timelineId: 'tl-1' });
    expect(timeline.domains.loans.map((entry) => entry.id)).toEqual(['loan-tl']);
    expect(timeline.funding.obligations.some((order) => order.obligationId === 'loan-tl')).toBe(true);
  });

  it('never mutates the input scenario', () => {
    const scenario = makeScenario();
    scenario.largePurchases = [makePurchase('p1')];
    const before = JSON.stringify(scenario);
    compileScenarioContext(scenario);
    compileScenarioContext(scenario, { timelineId: 'base', horizonMonths: 120 });
    expect(JSON.stringify(scenario)).toBe(before);
  });
});

describe('configuration — opening provenance and indexes', () => {
  it('indexes accounts, liabilities and properties by stable id', () => {
    const scenario = makeScenario();
    scenario.liabilities = [{ id: 'l1', kind: 'loan', openingBalance: 5000, annualInterestRate: 6 }];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-15',
      measurement: 'assetsMinusLiabilities',
      accounts: [],
      liabilities: [{ liabilityId: 'l1', balance: 0 }],
      properties: []
    };
    const ctx = compileScenarioContext(scenario);

    expect(ctx.getAccount('checking-account-default')?.accountId).toBe('checking-account-default');
    expect(ctx.getAccount('missing')).toBeUndefined();
    expect(ctx.getLiability('l1')?.liabilityId).toBe('l1');
    expect(ctx.getLiability('missing')).toBeUndefined();
    expect(ctx.getProperty('missing')).toBeUndefined();
    expect(ctx.opening.measurement).toBe('assetsMinusLiabilities');
    expect(ctx.metadata.hasOpeningSnapshot).toBe(true);
  });

  it('lets an observed zero liability win over configured debt', () => {
    const scenario = makeScenario();
    scenario.liabilities = [{ id: 'l1', kind: 'loan', openingBalance: 5000 }];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-15',
      measurement: 'assetsMinusLiabilities',
      accounts: [],
      liabilities: [{ liabilityId: 'l1', balance: 0 }],
      properties: []
    };
    const liability = compileScenarioContext(scenario).getLiability('l1');
    expect(liability?.openingBalance).toBe(0);
    expect(liability?.openingSource).toBe('observed');
    expect(liability?.observedFrom).toBe('liability');
  });

  it('records property-only observed debt exactly once', () => {
    const scenario = makeScenario();
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-15',
      measurement: 'assetsMinusLiabilities',
      accounts: [],
      liabilities: [],
      properties: [{ propertyId: 'prop1', value: 300000, debtBalance: 200000 }]
    };
    const ctx = compileScenarioContext(scenario);
    const synthetic = ctx.liabilities.filter((liability) => liability.liabilityId === 'property:prop1');
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].openingBalance).toBe(200000);
    expect(synthetic[0].observedFrom).toBe('property');
    expect(ctx.liabilities).toHaveLength(1);
    expect(ctx.properties).toHaveLength(1);
  });

  it('does not duplicate debt when a configured liability already links the property', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'mort1', kind: 'mortgage', openingBalance: 999999, linkedPropertyId: 'prop1' }
    ];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-15',
      measurement: 'assetsMinusLiabilities',
      accounts: [],
      liabilities: [],
      properties: [{ propertyId: 'prop1', value: 300000, debtBalance: 200000 }]
    };
    const ctx = compileScenarioContext(scenario);
    expect(ctx.liabilities).toHaveLength(1);
    expect(ctx.getLiability('mort1')?.openingBalance).toBe(200000);
    expect(ctx.getLiability('mort1')?.observedFrom).toBe('property');
    expect(ctx.getLiability('property:prop1')).toBeUndefined();
  });

  it('prefers an observed account balance and preserves provenance', () => {
    const scenario = makeScenario();
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-15',
      measurement: 'assetOnly',
      accounts: [{ accountId: 'checking-account-default', balance: 123 }],
      liabilities: [],
      properties: []
    };
    const account = compileScenarioContext(scenario).getAccount('checking-account-default');
    expect(account?.openingBalance).toBe(123);
    expect(account?.openingSource).toBe('observed');
  });

  it('exposes account rates with the retirement override', () => {
    const scenario = makeScenario();
    scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) =>
      account.id === 'investments-account-default'
        ? { ...account, annualReturnRate: 6, retirementAnnualReturnRate: 4 }
        : account
    );
    const ctx = compileScenarioContext(scenario);
    expect(ctx.getAccountRate('investments-account-default', 'accumulation')).toBe(6);
    expect(ctx.getAccountRate('investments-account-default', 'retirement')).toBe(4);
    expect(ctx.getAccountRate('checking-account-default', 'retirement')).toBe(0);
    expect(ctx.getAccountRate('missing', 'accumulation')).toBeNull();
  });
});

describe('configuration — liability source-config links', () => {
  it('threads sourceConfigId and resolves a loan id that differs from the liability id', () => {
    const scenario = makeScenario();
    scenario.loans = [{ ...createDefaultLoan(45, DOB, REFERENCE_DATE), id: 'loan-A' }];
    scenario.liabilities = [
      { id: 'liability-X', kind: 'loan', openingBalance: 25000, annualInterestRate: 6.5, sourceConfigId: 'loan-A' }
    ];
    const ctx = compileScenarioContext(scenario);

    const linked = ctx.getLiability('liability-X');
    expect(linked?.sourceConfigId).toBe('loan-A');
    // Identity lookup still works, and the loan config id resolves through the link.
    expect(ctx.getLiability('loan-A')).toBe(linked);
    expect(ctx.getLiabilityBySourceConfigId('loan-A')).toBe(linked);
    expect(ctx.getLiability('loan-A')).toBe(ctx.getLiabilityBySourceConfigId('loan-A'));
    expect(ctx.getLiability('missing')).toBeUndefined();
    expect(ctx.getLiabilityBySourceConfigId('missing')).toBeUndefined();
    expect(ctx.diagnostics.some((message) => message.includes('sourceConfigId'))).toBe(false);

    // Deep-frozen / no alias: the compiled record never re-points at the input.
    expect(Object.isFrozen(linked)).toBe(true);
    scenario.liabilities[0].sourceConfigId = 'mutated';
    expect(ctx.getLiability('liability-X')?.sourceConfigId).toBe('loan-A');
    expect(ctx.getLiabilityBySourceConfigId('mutated')).toBeUndefined();
  });

  it('reports duplicate sourceConfigId references deterministically and leaves the link unresolved', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'liab-b', kind: 'loan', openingBalance: 100, sourceConfigId: 'loan-dup' },
      { id: 'liab-a', kind: 'loan', openingBalance: 200, sourceConfigId: 'loan-dup' }
    ];
    const ctx = compileScenarioContext(scenario);

    // No silent winner: the ambiguous link resolves to nothing.
    expect(ctx.getLiabilityBySourceConfigId('loan-dup')).toBeUndefined();
    expect(ctx.getLiability('loan-dup')).toBeUndefined();
    // Each liability still resolves by its own id and keeps its own link.
    expect(ctx.getLiability('liab-a')?.sourceConfigId).toBe('loan-dup');
    expect(ctx.getLiability('liab-b')?.sourceConfigId).toBe('loan-dup');

    const message = ctx.diagnostics.find((entry) => entry.includes('sourceConfigId "loan-dup"'));
    expect(message).toBeDefined();
    // Deterministic, sorted liability ids independent of the input order.
    expect(message).toContain('liab-a, liab-b');

    const reordered = compileScenarioContext({
      ...scenario,
      liabilities: [scenario.liabilities[1], scenario.liabilities[0]]
    });
    expect(reordered.getLiabilityBySourceConfigId('loan-dup')).toBeUndefined();
    expect(reordered.diagnostics.find((entry) => entry.includes('sourceConfigId "loan-dup"'))).toBe(message);
  });

  it('keeps an observed zero authoritative while threading sourceConfigId', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'liability-X', kind: 'loan', openingBalance: 25000, sourceConfigId: 'loan-A' }
    ];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-15',
      measurement: 'assetsMinusLiabilities',
      accounts: [],
      liabilities: [{ liabilityId: 'liability-X', balance: 0 }],
      properties: []
    };
    const liability = compileScenarioContext(scenario).getLiability('liability-X');
    expect(liability?.openingBalance).toBe(0);
    expect(liability?.openingSource).toBe('observed');
    expect(liability?.observedFrom).toBe('liability');
    expect(liability?.sourceConfigId).toBe('loan-A');
  });

  it('resolves the source-config link identically when an inactive timeline is selected', () => {
    let scenario = makeScenario();
    scenario.liabilities = [
      { id: 'liability-X', kind: 'loan', openingBalance: 25000, sourceConfigId: 'loan-A' }
    ];
    scenario = addTimeline(scenario, { id: 'tl-id', label: 'Timeline Identity' });

    // `addTimeline` activates `tl-id`; the base timeline is now inactive.
    const inactiveBase = compileScenarioContext(scenario, { timelineId: 'base' });
    const active = compileScenarioContext(scenario);

    expect(scenario.activeTimelineId).toBe('tl-id');
    expect(inactiveBase.timelineId).toBeNull();
    expect(active.timelineId).toBe('tl-id');
    expect(active.timelineLabel).toBe('Timeline Identity');
    expect(inactiveBase.getLiabilityBySourceConfigId('loan-A')?.liabilityId).toBe('liability-X');
    expect(active.getLiabilityBySourceConfigId('loan-A')?.liabilityId).toBe('liability-X');
    // The global liability set is not timeline-scoped: both selections agree.
    expect(active.getLiability('liability-X')).toEqual(inactiveBase.getLiability('liability-X'));
  });

  it('leaves global configuration, deep-freezing and the default horizon unaffected', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'liability-X', kind: 'loan', openingBalance: 25000, sourceConfigId: 'loan-A' }
    ];
    const ctx = compileScenarioContext(scenario);
    expect(ctx.metadata.horizonMonths).toBe(FULL_HORIZON_MONTHS);
    expect(Object.isFrozen(ctx.global)).toBe(true);
    expect(Object.isFrozen(ctx.global.withdrawal)).toBe(true);
    expect(Object.isFrozen(ctx.liabilities)).toBe(true);
    expect(ctx.liabilities.every((liability) => Object.isFrozen(liability))).toBe(true);
  });
});

describe('configuration — markers and chains', () => {
  it('resolves a valid marker reference into the purchase month', () => {
    const scenario = makeScenario();
    scenario.dateMarkers = [{ id: 'm1', label: 'Retire', date: '2030-06-15' }];
    scenario.largePurchases = [{ ...makePurchase('p1'), yearMonthMarkerId: 'm1' }];
    const ctx = compileScenarioContext(scenario);
    expect(ctx.domains.purchases[0].yearMonth).toBe('2030-06');
    expect(ctx.domains.purchases[0].yearMonthMarkerId).toBe('m1');
  });

  it('clears dangling marker references and reports them as diagnostics', () => {
    const scenario = makeScenario();
    scenario.largePurchases = [{ ...makePurchase('p1'), yearMonthMarkerId: 'missing' }];
    const ctx = compileScenarioContext(scenario);
    expect(ctx.domains.purchases[0].yearMonthMarkerId).toBeNull();
    expect(ctx.diagnostics.some((message) => message.includes('missing'))).toBe(true);
  });

  it('validates dangling markers in an inactive timeline without compiling it', () => {
    let scenario = makeScenario();
    scenario = addTimeline(scenario, { id: 'tl-x', label: 'Timeline X' });
    scenario = applyToActiveTimeline(scenario, (data) => ({
      ...data,
      purchases: [{ ...makePurchase('p-tl'), yearMonthMarkerId: 'ghost' }]
    }));
    const base = compileScenarioContext(scenario, { timelineId: 'base' });
    expect(base.domains.purchases).toHaveLength(0);
    expect(base.diagnostics.some((message) => message.includes('ghost'))).toBe(true);
  });

  it('reports unknown housing career links', () => {
    const scenario = makeScenario();
    scenario.housing = [
      { ...createDefaultHousingEntry(45, DOB, REFERENCE_DATE), id: 'home-1', linkedCareerStartId: 'ghost-career' }
    ];
    const ctx = compileScenarioContext(scenario);
    expect(ctx.diagnostics.some((message) => message.includes('ghost-career'))).toBe(true);
  });
});

describe('configuration — careers and pay plans', () => {
  it('handles a scenario with no careers', () => {
    const scenario = makeScenario();
    scenario.careerPlan = { enabled: true, entries: [] };
    const ctx = compileScenarioContext(scenario);
    expect(ctx.careers).toHaveLength(0);
    expect(ctx.careerIntervals).toHaveLength(0);
    expect(ctx.getActiveCareer('2030-01')).toBeNull();
  });

  it('leaves a gap with no active career between explicit windows', () => {
    const scenario = makeScenario();
    scenario.careerPlan = {
      enabled: true,
      entries: [makeCareer('c1', '2026-01', '2026-06'), makeCareer('c2', '2027-01', '2027-12')]
    };
    const ctx = compileScenarioContext(scenario);
    expect(ctx.getActiveCareer('2026-03')?.careerId).toBe('c1');
    expect(ctx.getActiveCareer('2026-09')).toBeNull();
    expect(ctx.getActiveCareer('2027-06')?.careerId).toBe('c2');
  });

  it('prefers the most recently started career on overlap', () => {
    const scenario = makeScenario();
    scenario.careerPlan = {
      enabled: true,
      entries: [makeCareer('early', '2026-01', '2026-12'), makeCareer('late', '2026-04', '2026-12')]
    };
    const ctx = compileScenarioContext(scenario);
    expect(ctx.getActiveCareer('2026-02')?.careerId).toBe('early');
    expect(ctx.getActiveCareer('2026-05')?.careerId).toBe('late');
  });

  it('resolves pay-plan effective boundaries per month', () => {
    const career = makeCareer('c1', '2026-01', '2026-12');
    career.payPlans = [makePlan('plan-a', '2026-04'), makePlan('plan-b', '2026-08')];
    const scenario = makeScenario();
    scenario.careerPlan = { enabled: true, entries: [career] };
    const ctx = compileScenarioContext(scenario);

    expect(ctx.getActivePayPlan('c1', '2026-03')?.planId).toBeNull();
    expect(ctx.getActivePayPlan('c1', '2026-04')?.planId).toBe('plan-a');
    expect(ctx.getActivePayPlan('c1', '2026-07')?.planId).toBe('plan-a');
    expect(ctx.getActivePayPlan('c1', '2026-08')?.planId).toBe('plan-b');
    expect(ctx.getActivePayPlan('other', '2026-08')).toBeNull();

    const intervals = ctx.careerIntervals[0].payPlanIntervals;
    expect(intervals.map((interval) => [interval.startYearMonth, interval.endYearMonth, interval.planId])).toEqual([
      ['2026-01', '2026-03', null],
      ['2026-04', '2026-07', 'plan-a'],
      ['2026-08', '2026-12', 'plan-b']
    ]);
  });

  it('treats a plan effective before the career start as active from the start', () => {
    const career = makeCareer('c1', '2026-06', '2026-12');
    career.payPlans = [makePlan('pre', '2025-01')];
    const scenario = makeScenario();
    scenario.careerPlan = { enabled: true, entries: [career] };
    const ctx = compileScenarioContext(scenario);
    expect(ctx.getActivePayPlan('c1', '2026-06')?.planId).toBe('pre');
    expect(ctx.careerIntervals[0].payPlanIntervals[0].planId).toBe('pre');
  });

  it('clamps an inverted career range and reports it', () => {
    const career = makeCareer('c1', '2030-05', '2029-01');
    const scenario = makeScenario();
    scenario.careerPlan = { enabled: true, entries: [career] };
    const ctx = compileScenarioContext(scenario);
    expect(ctx.getCareer('c1')?.endYearMonth).toBe('2030-05');
    expect(ctx.diagnostics.some((message) => message.includes('ends before it starts'))).toBe(true);
  });
});

describe('configuration — ordered funding sources', () => {
  it('orders the global primary first, then deduped fallbacks', () => {
    const scenario = makeScenario();
    scenario.fundingPolicy = {
      primaryAccountId: 'checking-account-default',
      fallbackAccountIds: ['investments-account-default', 'checking-account-default', 'emergencyFund-account-default']
    };
    scenario.incomeFallbackAccountId = 'emergencyFund-account-default';
    scenario.incomeFallbackAccountId2 = 'checking-account-default';
    const global = compileScenarioContext(scenario).funding.global;

    expect(global.primaryAccountId).toBe('checking-account-default');
    expect(global.fallbackAccountIds).toEqual([
      'investments-account-default',
      'checking-account-default',
      'emergencyFund-account-default'
    ]);
    expect(global.orderedAccountIds).toEqual([
      'checking-account-default',
      'investments-account-default',
      'emergencyFund-account-default'
    ]);
    expect(global.incomeFallbackAccountIds).toEqual(['emergencyFund-account-default', 'checking-account-default']);
  });

  it('orders the retirement list and each retirement source', () => {
    const scenario = makeScenario();
    scenario.withdrawal.fallbackAccountIds = ['emergencyFund-account-default'];
    const source = (scenario.withdrawal.sourceLines ?? [])[0];
    source.fallbackAccountIds = ['investments-account-default', 'investments-account-default'];
    const retirement = compileScenarioContext(scenario).funding.retirement;
    expect(retirement.fallbackAccountIds).toEqual(['emergencyFund-account-default']);
    expect(retirement.sources[0].orderedAccountIds).toEqual([
      'retirement401k-account-default',
      'investments-account-default'
    ]);
  });

  it('extracts per-obligation ordered account ids and the income flag', () => {
    const scenario = makeScenario();
    const loan = { ...createDefaultLoan(45, DOB, REFERENCE_DATE), id: 'loan-1' };
    loan.paymentSource = 'account:investments-account-default';
    loan.paymentSourceAccount = 'investments-account-default';
    const home = {
      ...createDefaultHousingEntry(45, DOB, REFERENCE_DATE),
      id: 'home-1',
      paymentSource: 'income' as const,
      downPaymentSource: 'account:investments-account-default' as const
    };
    scenario.loans = [loan];
    scenario.housing = [home];
    const ctx = compileScenarioContext(scenario);

    const loanOrder = ctx.getObligationSourceOrder('loan-1');
    expect(loanOrder?.domain).toBe('loan');
    expect(loanOrder?.primaryAccountId).toBe('investments-account-default');
    expect(loanOrder?.orderedAccountIds).toEqual(['investments-account-default']);

    const homeOrder = ctx.getObligationSourceOrder('home-1');
    expect(homeOrder?.domain).toBe('housing');
    expect(homeOrder?.usesIncome).toBe(true);
    expect(homeOrder?.orderedAccountIds).toEqual(['investments-account-default']);
  });

  it('orders the selected timeline\u2019s card-plan funding (timeline-local)', () => {
    let scenario = makeScenario();
    scenario.cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
        id: 'cp-base',
        funding: {
          primaryAccountId: 'checking-account-default',
          fallbackAccountIds: ['investments-account-default']
        }
      })
    ];
    scenario = addTimeline(scenario, { id: 'tl-a', label: 'Timeline A' });
    scenario = applyToActiveTimeline(scenario, (data) => ({
      ...data,
      cardPlans: [
        createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
          id: 'cp-tl',
          funding: {
            primaryAccountId: 'emergencyFund-account-default',
            fallbackAccountIds: []
          }
        })
      ]
    }));

    const base = compileScenarioContext(scenario, { timelineId: 'base' });
    expect(base.funding.cardPlans.map((order) => order.obligationId)).toEqual(['cp-base']);
    expect(base.funding.cardPlans[0].orderedAccountIds).toEqual([
      'checking-account-default',
      'investments-account-default'
    ]);

    const timeline = compileScenarioContext(scenario, { timelineId: 'tl-a' });
    expect(timeline.funding.cardPlans.map((order) => order.obligationId)).toEqual(['cp-tl']);
    expect(timeline.funding.cardPlans[0].orderedAccountIds).toEqual(['emergencyFund-account-default']);
  });
});

describe('configuration — horizon and metadata', () => {
  it('defaults to a 960 full-month horizon with exact metadata', () => {
    const ctx = compileScenarioContext(makeScenario());
    expect(ctx.metadata.horizonMonths).toBe(FULL_HORIZON_MONTHS);
    expect(ctx.metadata.horizonMonths).toBe(960);
    expect(ctx.metadata.startYearMonth).toBe('2026-01');
    expect(ctx.metadata.endYearMonth).toBe(addMonths('2026-01', 959));
    expect(ctx.metadata.endYearMonth).toBe('2105-12');
    expect(ctx.metadata.endOrdinal - ctx.metadata.startOrdinal).toBe(959);
    expect(ctx.metadata.endDate).toBe(endOfMonthDate('2105-12'));
    expect(ctx.metadata.endDate).toBe('2105-12-31');
    expect(ctx.metadata.schemaVersion).toBe(CONTEXT_SCHEMA_VERSION);
    expect(ctx.metadata.contextId.length).toBeGreaterThan(0);
  });

  it('supports a custom horizon', () => {
    const ctx = compileScenarioContext(makeScenario(), { horizonMonths: 12 });
    expect(ctx.metadata.horizonMonths).toBe(12);
    expect(ctx.metadata.startYearMonth).toBe('2026-01');
    expect(ctx.metadata.endYearMonth).toBe('2026-12');
    expect(ctx.metadata.endDate).toBe('2026-12-31');
  });

  it('defaults the start date from the opening observation, not the wall clock', () => {
    const scenario = makeScenario();
    scenario.netWorth.asOfDate = '2027-03-20';
    const ctx = compileScenarioContext(scenario);
    expect(ctx.metadata.startDate).toBe('2027-03-20');
    expect(ctx.metadata.startYearMonth).toBe('2027-03');
  });

  it('honors an explicit start date', () => {
    const ctx = compileScenarioContext(makeScenario(), { startDate: '2030-05-05' });
    expect(ctx.metadata.startDate).toBe('2030-05-05');
    expect(ctx.metadata.startYearMonth).toBe('2030-05');
  });

  it('rejects an invalid start date, an invalid horizon and a missing observation', () => {
    expect(() => compileScenarioContext(makeScenario(), { startDate: 'not-a-date' })).toThrow(ContextValidationError);
    expect(() => compileScenarioContext(makeScenario(), { horizonMonths: 0 })).toThrow(ContextValidationError);
    const scenario = makeScenario();
    scenario.netWorth.asOfDate = '';
    expect(() => compileScenarioContext(scenario)).toThrow(ContextValidationError);
  });
});

describe('configuration — immutability', () => {
  it('returns deep-frozen data with immutable reads and deep clones', () => {
    const scenario = makeScenario();
    scenario.largePurchases = [makePurchase('p1')];
    const ctx = compileScenarioContext(scenario);

    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.metadata)).toBe(true);
    expect(Object.isFrozen(ctx.accounts)).toBe(true);
    expect(Object.isFrozen(ctx.domains.purchases)).toBe(true);
    expect(Object.isFrozen(ctx.domains.purchases[0])).toBe(true);
    expect(Object.isFrozen(ctx.funding.global)).toBe(true);
    expect(Object.isFrozen(ctx.careerIntervals)).toBe(true);

    expect(() => {
      (ctx.accounts as unknown as CompiledAccount[]).push({} as CompiledAccount);
    }).toThrow();

    // The compiled domain is a deep clone, never an alias of the input.
    expect(ctx.domains.purchases[0]).not.toBe(scenario.largePurchases[0]);

    // No mutable map or internal index leaks through the public object.
    expect(Object.values(ctx).some((value) => value instanceof Map)).toBe(false);
    expect((ctx as unknown as Record<string, unknown>).accountIndex).toBeUndefined();
    expect((ctx as unknown as Record<string, unknown>).obligationIndex).toBeUndefined();

    // Later scenario mutations cannot reach the compiled context.
    scenario.netWorth.accounts[0].openingBalance = 999999;
    expect(ctx.getAccount('checking-account-default')?.openingBalance).toBe(0);
  });
});

describe('configuration — global (non-timeline) configuration', () => {
  it('exposes deep-cloned, deep-frozen global config and timeline-local card plans', () => {
    const scenario = makeScenario();
    scenario.cardPlans = [createDefaultOrdinaryCardSchedule(REFERENCE_DATE, { id: 'cp1' })];
    scenario.cashflowItems = [createDefaultCashflowItem('social_security', 45, 65, 25)];
    const ctx = compileScenarioContext(scenario);

    // Card plans are timeline-local, never part of the global config.
    expect(ctx.domains.cardPlans.map((plan) => plan.id)).toEqual(['cp1']);
    expect((ctx.global as unknown as Record<string, unknown>).cardPlans).toBeUndefined();
    expect(ctx.global.cashflowItems.map((item) => item.id)).toEqual(['social_security-default']);
    expect(ctx.global.lifeEvents).toEqual([]);
    expect(ctx.global.expenses).toBeDefined();
    expect(ctx.global.withdrawal).toBeDefined();

    expect(Object.isFrozen(ctx.domains)).toBe(true);
    expect(Object.isFrozen(ctx.domains.cardPlans)).toBe(true);
    expect(Object.isFrozen(ctx.domains.cardPlans[0])).toBe(true);
    expect(Object.isFrozen(ctx.global)).toBe(true);
    expect(Object.isFrozen(ctx.global.cashflowItems[0])).toBe(true);
    expect(Object.isFrozen(ctx.global.expenses)).toBe(true);
    expect(Object.isFrozen(ctx.global.withdrawal)).toBe(true);

    // Deep clone: never an alias of the input, and later edits cannot leak in.
    expect(ctx.domains.cardPlans[0]).not.toBe(scenario.cardPlans[0]);
    expect(ctx.global.cashflowItems[0]).not.toBe(scenario.cashflowItems[0]);
    expect(ctx.global.expenses).not.toBe(scenario.expenses);
    scenario.cardPlans[0].label = 'mutated-after-compile';
    expect(ctx.domains.cardPlans[0].label).not.toBe('mutated-after-compile');
  });

  it('never mutates the global sections of the input scenario', () => {
    const scenario = makeScenario();
    scenario.cardPlans = [createDefaultOrdinaryCardSchedule(REFERENCE_DATE, { id: 'cp1' })];
    scenario.cashflowItems = [createDefaultCashflowItem('social_security', 45, 65, 25)];
    const before = JSON.stringify(scenario);
    compileScenarioContext(scenario);
    compileScenarioContext(scenario, { timelineId: 'base' });
    expect(JSON.stringify(scenario)).toBe(before);
  });

  it('keeps global configuration fixed while timeline-local card plans switch', () => {
    let scenario = makeScenario();
    scenario.cardPlans = [createDefaultOrdinaryCardSchedule(REFERENCE_DATE, { id: 'cp-base' })];
    scenario.cashflowItems = [createDefaultCashflowItem('social_security', 45, 65, 25)];
    scenario = addTimeline(scenario, { id: 'tl-g', label: 'Timeline G' });
    scenario = applyToActiveTimeline(scenario, (data) => ({
      ...data,
      purchases: [makePurchase('p-tl')],
      cardPlans: [createDefaultOrdinaryCardSchedule(REFERENCE_DATE, { id: 'cp-tl' })]
    }));

    const active = compileScenarioContext(scenario);
    const base = compileScenarioContext(scenario, { timelineId: 'base' });
    const timeline = compileScenarioContext(scenario, { timelineId: 'tl-g' });

    expect(active.timelineId).toBe('tl-g');

    // Global (non-timeline) configuration is identical across every selection.
    expect(base.global.cashflowItems.map((item) => item.id)).toEqual(['social_security-default']);
    expect(timeline.global.cashflowItems.map((item) => item.id)).toEqual(['social_security-default']);
    expect(active.global.cashflowItems.map((item) => item.id)).toEqual(['social_security-default']);
    // ...but every compiled clone is independent.
    expect(timeline.global.cashflowItems[0]).not.toBe(base.global.cashflowItems[0]);

    // Card plans are timeline-local and switch with the selected timeline.
    expect(base.domains.cardPlans.map((plan) => plan.id)).toEqual(['cp-base']);
    expect(timeline.domains.cardPlans.map((plan) => plan.id)).toEqual(['cp-tl']);
    expect(active.domains.cardPlans.map((plan) => plan.id)).toEqual(['cp-tl']);
    expect(timeline.domains.cardPlans[0]).not.toBe(base.domains.cardPlans[0]);

    // The selected timeline's own domains switch; base stays base.
    expect(base.domains.purchases).toHaveLength(0);
    expect(timeline.domains.purchases.map((p) => p.id)).toEqual(['p-tl']);
  });
});

describe('configuration — timeline-local card plans (v4)', () => {
  const expectedPlan = (id: string): CardPlan =>
    createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
      id,
      amount: 50,
      startYearMonth: '2030-01',
      endYearMonth: '2030-01'
    });

  const zeroPlan = (id: string, liabilityId: string): CardPlan =>
    createDefaultZeroInterestCardPlan(REFERENCE_DATE, {
      id,
      liabilityId,
      initialBalance: 100,
      startYearMonth: '2030-01',
      targetYearMonth: '2030-03'
    });

  /** Adds a named timeline and replaces its card plans (addTimeline activates it). */
  const addCardTimeline = (scenario: Scenario, id: string, cardPlans: CardPlan[]): Scenario => {
    const withTimeline = addTimeline(scenario, { id, label: id });
    return applyToActiveTimeline(withTimeline, (data) => ({ ...data, cardPlans }));
  };

  it('compiles distinct base / timeline A / timeline B expected and 0% card obligations', () => {
    let scenario = makeScenario();
    scenario.liabilities = [{ id: 'liab-base-zero', kind: 'zeroInterestCard', openingBalance: 100 }];
    scenario.cardPlans = [expectedPlan('base-ordinary'), zeroPlan('base-zero', 'liab-base-zero')];

    scenario = addCardTimeline(scenario, 'tl-a', [
      expectedPlan('a-ordinary'),
      zeroPlan('a-zero', 'liab-a-zero')
    ]);
    scenario = addCardTimeline(scenario, 'tl-b', [expectedPlan('b-ordinary')]);

    const base = compileScenarioContext(scenario, { timelineId: 'base' });
    expect(base.domains.cardPlans.map((plan) => plan.id)).toEqual(['base-ordinary', 'base-zero']);
    expect(base.domains.cardPlans.map((plan) => plan.kind)).toEqual([
      'expectedPayment',
      'zeroInterestPayoff'
    ]);
    expect(base.funding.cardPlans.map((order) => order.obligationId)).toEqual(['base-ordinary', 'base-zero']);
    expect(base.funding.cardPlans.map((order) => order.domain)).toEqual([
      'cardPlan.expectedPayment',
      'cardPlan.zeroInterestPayoff'
    ]);

    const a = compileScenarioContext(scenario, { timelineId: 'tl-a' });
    expect(a.domains.cardPlans.map((plan) => plan.id)).toEqual(['a-ordinary', 'a-zero']);
    expect(a.funding.cardPlans.map((order) => order.obligationId)).toEqual(['a-ordinary', 'a-zero']);
    // No base obligation leaks into timeline A's funding orders.
    expect(a.funding.cardPlans.some((order) => order.obligationId.startsWith('base-'))).toBe(false);

    const b = compileScenarioContext(scenario, { timelineId: 'tl-b' });
    expect(b.domains.cardPlans.map((plan) => plan.id)).toEqual(['b-ordinary']);
    expect(b.funding.cardPlans.map((order) => order.obligationId)).toEqual(['b-ordinary']);
    expect(b.funding.cardPlans.some((order) => order.obligationId.startsWith('a-'))).toBe(false);
  });

  it('never leaks a card plan across timelines when switching the selection', () => {
    let scenario = makeScenario();
    scenario.cardPlans = [expectedPlan('base-ordinary')];
    scenario = addCardTimeline(scenario, 'tl-a', [zeroPlan('a-zero', 'liab-a-zero')]);

    const base = compileScenarioContext(scenario, { timelineId: 'base' });
    const a = compileScenarioContext(scenario, { timelineId: 'tl-a' });

    expect(base.domains.cardPlans.map((plan) => plan.id)).toEqual(['base-ordinary']);
    expect(a.domains.cardPlans.map((plan) => plan.id)).toEqual(['a-zero']);
    expect(a.domains.cardPlans.some((plan) => plan.id === 'base-ordinary')).toBe(false);
    expect(base.domains.cardPlans.some((plan) => plan.id === 'a-zero')).toBe(false);
    // Repeated selection is stable (no accumulating/de-duplicated leakage).
    expect(compileScenarioContext(scenario, { timelineId: 'base' }).domains.cardPlans.map((plan) => plan.id)).toEqual([
      'base-ordinary'
    ]);
  });

  it('excludes an inactive timeline’s card plans from the base compilation', () => {
    let scenario = makeScenario();
    scenario.activeTimelineId = null;
    scenario.cardPlans = [expectedPlan('base-ordinary')];
    // addCardTimeline activates tl-a; the base view must still be the base plans.
    scenario = addCardTimeline(scenario, 'tl-a', [zeroPlan('a-zero', 'liab-inactive')]);

    const base = compileScenarioContext(scenario, { timelineId: 'base' });
    expect(base.timelineId).toBeNull();
    expect(base.domains.cardPlans.map((plan) => plan.id)).toEqual(['base-ordinary']);
    expect(base.funding.cardPlans.map((order) => order.obligationId)).toEqual(['base-ordinary']);

    const active = compileScenarioContext(scenario);
    expect(active.timelineId).toBe('tl-a');
    expect(active.domains.cardPlans.map((plan) => plan.id)).toEqual(['a-zero']);
  });
});
