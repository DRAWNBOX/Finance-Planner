/**
 * P3H.1/P3H.2/P3H.4 — focused headless tests for the housing/property stream.
 *
 * Exercises the real kernel seams: `compileScenarioContext` → `buildState` →
 * `buildHousingEventDefinitions` → `createScheduler` → `createHousingHandlers`,
 * driving every scheduled event exactly as the facade does (handler
 * `resolveTarget` when present, else the definition resolver; a `0` target is
 * never executed). All postings go through `state.commitChanges` /
 * `commitFunding`; the state is read directly for precise assertions.
 *
 * Covers CA09 (held deposit then atomic completion with deposit delta `-$30k`,
 * not `-$60k`), failed/zero/partial funding, pending no growth/cost, observed
 * owned value+debt appreciation, zero-down completion, underwater/surplus sale
 * reconciliation, no double count and no mutation on invalid terms, and P3H.3
 * mortgage accrual/PI+extra (full/partial/zero), actual-LTV PMI, ancillary
 * groups after payoff, grouped source fallback, rental dates/income, and
 * ancillary stopping at sale.
 */

import { describe, expect, it } from 'vitest';

import { createDefaultHousingEntry, createDefaultRentalEntry, createDefaultScenario } from '../defaultScenario';
import type {
  AccountDefinition,
  HousingEntry,
  LiabilityDefinition,
  PropertyDefinition,
  Scenario,
  Timeline
} from '../types';
import { compileScenarioContext } from './configuration';
import type { FundingPlan } from './contracts';
import { quoteLoanInstallment } from './loans';
import type { EventExecutionContext, EventDefinition } from './scheduler';
import { createScheduler } from './scheduler';
import { buildState, type EngineState } from './state';
import { quotePropertyAppreciation } from './valuation';
import {
  buildHousingContext,
  buildHousingEventDefinitions,
  createHousingHandlers,
  HOUSING_HANDLER_IDS,
  HOUSING_PRIORITY,
  HOUSING_PURPOSES,
  parseHousingDefinitionId,
  resolveHousingPlans,
  standaloneRentalPlanId,
  validateAcquisitionTerms
} from './housing';
import { projectScenario, type ProjectionHandlerDependencies } from './projection';

// ---------------------------------------------------------------------------
// Fixtures + harness
// ---------------------------------------------------------------------------

const REFERENCE_DATE = new Date('2026-01-15');

const policy = () => ({
  allowAutomaticFallback: true,
  withdrawalTaxRate: 0,
  penaltyRate: 0,
  restrictionNote: ''
});

const account = (id: string, openingBalance: number): AccountDefinition => ({
  id,
  label: id,
  accountType: 'checking',
  openingBalance,
  annualReturnRate: 0,
  retirementAnnualReturnRate: null,
  displayOrder: 0,
  withdrawalPolicy: policy()
});

/** Taxable brokerage account (default assumed gain 20% / LTCG 15% apply). */
const taxableAccount = (id: string, openingBalance: number): AccountDefinition => ({
  ...account(id, openingBalance),
  accountType: 'taxable'
});

const liability = (over: Partial<LiabilityDefinition> & { id: string }): LiabilityDefinition => ({
  kind: 'mortgage',
  openingBalance: 0,
  ...over
});

const property = (over: Partial<PropertyDefinition> & { id: string }): PropertyDefinition => ({
  value: 0,
  requiredDownPayment: 0,
  status: 'pending',
  ...over
});

const housing = (over: Partial<HousingEntry> & { id: string }): HousingEntry => ({
  ...createDefaultHousingEntry(40, '1986-01-01', REFERENCE_DATE),
  startYearMonth: '2026-01',
  sellYearMonth: '',
  appreciationRate: 0,
  sellingCostsRate: 0,
  // P3H.3 fields default off; individual tests opt in explicitly.
  annualInterestRate: 0,
  extraMonthlyPayment: 0,
  loanTermYears: 0,
  propertyTaxYearly: 0,
  homeInsuranceYearly: 0,
  hoaMonthly: 0,
  maintenanceMonthly: 0,
  pmiMonthly: 0,
  monthlyRent: 0,
  rentalIncomeMonthly: 0,
  ...over
});

/**
 * P5.1/F17 — a rental built from `createDefaultRentalEntry` (no linked
 * `PropertyDefinition`). Defaults read from the real editor factory; each test
 * opts into an explicit funding/income account.
 */
const rental = (over: Partial<HousingEntry> & { id: string }): HousingEntry => ({
  ...createDefaultRentalEntry(40, '1986-01-01', REFERENCE_DATE),
  startYearMonth: '2026-01',
  endYearMonth: '',
  ...over
});

interface ScenarioInput {
  accounts: AccountDefinition[];
  properties?: PropertyDefinition[];
  liabilities?: LiabilityDefinition[];
  housing?: HousingEntry[];
}

const makeScenario = (input: ScenarioInput): Scenario => {
  const scenario = createDefaultScenario(REFERENCE_DATE);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.timelines = [];
  scenario.activeTimelineId = null;
  scenario.netWorth.asOfDate = '2026-01-01';
  scenario.netWorth.accounts = input.accounts;
  scenario.properties = input.properties ?? [];
  scenario.liabilities = input.liabilities ?? [];
  scenario.housing = input.housing ?? [];
  return scenario;
};

interface TimelineSample {
  occurrenceId: string;
  status: string;
  valueCents: number;
  depositCents: number;
}

interface HousingRun {
  state: EngineState;
  events: readonly EventDefinition[];
  plans: FundingPlan[];
  diagnostics: string[];
  timeline: TimelineSample[];
  openingNetWorthCents: number;
}

/** Drives the scheduled housing events the way the projection facade does. */
const runHousing = (scenario: Scenario, horizonMonths = 6, timelineId: string | null = null): HousingRun => {
  const context = compileScenarioContext(scenario, { horizonMonths, timelineId });
  const state = buildState(context.opening);
  const openingNetWorthCents = state.getTotals().netWorthCents;

  const housingContext = buildHousingContext(scenario, context.domains.housing, context.liabilities, {
    timelineId: context.timelineId
  });
  const events = buildHousingEventDefinitions(housingContext);
  const scheduler = createScheduler(context, events);

  const deps: ProjectionHandlerDependencies = {
    state,
    context,
    accounts: scenario.netWorth.accounts,
    dateOfBirth: null,
    funding: context.funding
  };
  const handlers = new Map(createHousingHandlers(deps).map((handler) => [handler.handlerId, handler]));

  const plans: FundingPlan[] = [];
  const diagnostics: string[] = [];
  const timeline: TimelineSample[] = [];

  for (const batch of scheduler.collect()) {
    for (const event of batch.events) {
      const handler = event.handlerId ? handlers.get(event.handlerId) : undefined;
      if (!handler) {
        continue;
      }
      const execution: EventExecutionContext = {
        context,
        event,
        yearMonth: event.yearMonth,
        date: event.date,
        occurrenceIndex: event.occurrenceIndex,
        activeCareer: batch.activeCareer,
        activePayPlan: batch.activePayPlan
      };
      const target = handler.resolveTarget ? handler.resolveTarget(execution, deps) : scheduler.resolveTarget(event);
      if (!Number.isSafeInteger(target) || target <= 0) {
        continue;
      }
      const result = handler.execute({ execution, targetCents: target, deps });
      if (result.plan) {
        plans.push(result.plan);
      }
      if (result.diagnostics) {
        diagnostics.push(...result.diagnostics);
      }
      const runtime = state.getProperty(
        parseHousingDefinitionId(event.definitionId)?.propertyId ?? event.definitionId
      );
      timeline.push({
        occurrenceId: event.occurrenceId,
        status: runtime?.status ?? 'missing',
        valueCents: runtime?.valueCents ?? -1,
        depositCents: runtime?.acquisitionDepositCents ?? -1
      });
    }
  }

  return { state, events, plans, diagnostics, timeline, openingNetWorthCents };
};

/**
 * Runs the real projection facade with the housing stream wired in, so the
 * facade-level `fundingOutcomes` (P4.1/D16 evidence) can be asserted alongside
 * the committed-only `plans` audit and the D15 journal. The events are scheduled
 * from the richer {@link buildHousingContext} (which carries the persisted dated
 * funding events); the handlers resolve plans from the compiled context exactly
 * as `featureHandlers.ts` wires them.
 */
const runHousingProjection = (scenario: Scenario, horizonMonths = 6) => {
  const context = compileScenarioContext(scenario, { horizonMonths });
  const housingContext = buildHousingContext(scenario, context.domains.housing, context.liabilities, {
    timelineId: context.timelineId
  });
  return projectScenario(scenario, {
    horizonMonths,
    events: buildHousingEventDefinitions(housingContext),
    handlerFactory: (deps) => createHousingHandlers(deps)
  });
};

// ---------------------------------------------------------------------------
// Definition-id parsing + plan resolution
// ---------------------------------------------------------------------------

describe('housing definition ids + plan resolution', () => {
  it('parses every housing definition kind', () => {
    expect(parseHousingDefinitionId('housing:home-1:funding:checkingA:f1')).toEqual({
      propertyId: 'home-1',
      kind: 'funding',
      fundingAccountId: 'checkingA',
      fundingEventId: 'f1'
    });
    expect(parseHousingDefinitionId('housing:home-1:funding::f2')).toEqual({
      propertyId: 'home-1',
      kind: 'funding',
      fundingAccountId: null,
      fundingEventId: 'f2'
    });
    expect(parseHousingDefinitionId('housing:home-1:complete')).toEqual({ propertyId: 'home-1', kind: 'completion' });
    expect(parseHousingDefinitionId('housing:home-1:appreciate')).toEqual({
      propertyId: 'home-1',
      kind: 'appreciation'
    });
    expect(parseHousingDefinitionId('housing:home-1:sale')).toEqual({ propertyId: 'home-1', kind: 'sale' });
    expect(parseHousingDefinitionId('housing:home-1:accrual')).toEqual({
      propertyId: 'home-1',
      kind: 'mortgageAccrual'
    });
    expect(parseHousingDefinitionId('housing:home-1:mortgage')).toEqual({ propertyId: 'home-1', kind: 'mortgage' });
    expect(parseHousingDefinitionId('housing:home-1:taxesInsurance')).toEqual({
      propertyId: 'home-1',
      kind: 'taxesInsurance'
    });
    expect(parseHousingDefinitionId('housing:home-1:hoaMaintenance')).toEqual({
      propertyId: 'home-1',
      kind: 'hoaMaintenance'
    });
    expect(parseHousingDefinitionId('housing:home-1:pmi')).toEqual({ propertyId: 'home-1', kind: 'pmi' });
    expect(parseHousingDefinitionId('housing:home-1:rent')).toEqual({ propertyId: 'home-1', kind: 'rent' });
    expect(parseHousingDefinitionId('housing:home-1:rentalIncome')).toEqual({
      propertyId: 'home-1',
      kind: 'rentalIncome'
    });
    expect(parseHousingDefinitionId('other:home-1:sale')).toBeNull();
  });

  it('links a property to its housing entry through sourceConfigId', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'canonical-1',
          status: 'pending',
          value: 0,
          requiredDownPayment: 60000,
          debtLink: 'mort-1',
          sourceConfigId: 'home-1'
        })
      ],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });
    const context = compileScenarioContext(scenario, { horizonMonths: 1 });
    const plans = resolveHousingPlans(buildHousingContext(scenario, context.domains.housing));
    expect(plans).toHaveLength(1);
    // Pending compiled value is 0; the price comes from the linked housing entry.
    expect(plans[0].priceCents).toBe(30_000_000);
    expect(plans[0].requiredDownPaymentCents).toBe(6_000_000);
    expect(plans[0].mortgageId).toBe('mort-1');
  });
});

// ---------------------------------------------------------------------------
// CA09 — held deposit then atomic completion
// ---------------------------------------------------------------------------

describe('P3H.2 CA09 — held deposit then atomic completion', () => {
  const ca09 = (): Scenario =>
    makeScenario({
      accounts: [account('checkingA', 100000), account('checkingB', 100000)],
      properties: [
        property({
          id: 'home-1',
          label: 'Future home',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          appreciationRate: 0,
          sellingCostsRate: 6,
          fundingEvents: [
            { id: 'f1', date: '2026-01-15', amount: 30000, accountId: 'checkingA' },
            { id: 'f2', date: '2026-03-15', amount: 30000, accountId: 'checkingB' }
          ]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

  it('holds $30k, then completes atomically with a -$30k deposit delta and +$240k mortgage', () => {
    const run = runHousing(ca09(), 6);
    const { state } = run;

    // First funding: deposit held, still pending, no home/mortgage.
    const afterFirst = run.timeline.find((sample) =>
      sample.occurrenceId.startsWith('housing:home-1:funding:checkingA:f1')
    );
    expect(afterFirst?.status).toBe('pending');
    expect(afterFirst?.valueCents).toBe(0);
    expect(afterFirst?.depositCents).toBe(3_000_000);

    // Completion (folded into the second funding): owned, value $300k, no deposit.
    const afterSecond = run.timeline.find((sample) =>
      sample.occurrenceId.startsWith('housing:home-1:funding:checkingB:f2')
    );
    expect(afterSecond?.status).toBe('owned');
    expect(afterSecond?.valueCents).toBe(30_000_000);
    expect(afterSecond?.depositCents).toBe(0);

    // The deposit is never doubled to $60k: the held $30k is released and the new
    // $30k becomes equity, so the state deposit delta is -$30k.
    expect(Math.max(...run.timeline.map((sample) => sample.depositCents))).toBe(3_000_000);

    const home = state.getProperty('home-1')!;
    expect(home.status).toBe('owned');
    expect(home.valueCents).toBe(30_000_000);
    expect(home.acquisitionDepositCents).toBe(0);
    expect(home.mortgageId).toBe('mort-1');
    expect(home.completedDate).toBe('2026-03-15');

    // Mortgage created at completion ($240k), not opened as debt.
    expect(state.getLiability('mort-1')?.principalCents).toBe(24_000_000);
    expect(state.getLiability('mort-1')?.kind).toBe('mortgage');

    // Exactly the $60k down payment left the accounts; no second down payment.
    expect(state.getAccountBalanceCents('checkingA')).toBe(7_000_000);
    expect(state.getAccountBalanceCents('checkingB')).toBe(7_000_000);

    // Net worth is unchanged (internal exchange, no ownership cost).
    expect(state.getTotals().netWorthCents).toBe(run.openingNetWorthCents);
    expect(run.openingNetWorthCents).toBe(20_000_000);
  });
});

// ---------------------------------------------------------------------------
// CA09 regression — an over-large funding event is capped to what is outstanding
// ---------------------------------------------------------------------------

describe('P3H.2 CA09 — funding event target is capped to the outstanding down payment', () => {
  it('debits only the $5k outstanding from a $10k event on a $55k held deposit', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000), account('checkingB', 100000)],
      properties: [
        property({
          id: 'home-1',
          label: 'Future home',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          appreciationRate: 0,
          sellingCostsRate: 0,
          fundingEvents: [
            { id: 'f1', date: '2026-01-15', amount: 55000, accountId: 'checkingA' },
            { id: 'f2', date: '2026-03-15', amount: 10000, accountId: 'checkingB' }
          ]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

    const run = runHousing(scenario, 6);

    // First event holds $55k; still pending, no home/mortgage.
    const afterFirst = run.timeline.find((sample) => sample.occurrenceId.startsWith('housing:home-1:funding:checkingA:f1'));
    expect(afterFirst?.status).toBe('pending');
    expect(afterFirst?.depositCents).toBe(5_500_000);

    // The second event is capped: only the $5k outstanding is debited and the
    // acquisition completes (never a $10k debit that leaves $5k unrestored).
    const afterSecond = run.timeline.find((sample) => sample.occurrenceId.startsWith('housing:home-1:funding:checkingB:f2'));
    expect(afterSecond?.status).toBe('owned');
    expect(afterSecond?.valueCents).toBe(30_000_000);
    expect(afterSecond?.depositCents).toBe(0);

    // The state deposit is never doubled: the held $55k is released and only the
    // new $5k becomes equity.
    expect(Math.max(...run.timeline.map((sample) => sample.depositCents))).toBe(5_500_000);

    const f2Plan = run.plans.find((plan) => plan.request.id.includes(':f2'));
    expect(f2Plan?.request.requestedCents).toBe(500_000);
    expect(f2Plan?.executedCents).toBe(500_000);

    const home = run.state.getProperty('home-1')!;
    expect(home.status).toBe('owned');
    expect(home.valueCents).toBe(30_000_000);
    expect(home.acquisitionDepositCents).toBe(0);
    expect(home.mortgageId).toBe('mort-1');
    expect(home.completedDate).toBe('2026-03-15');
    expect(run.state.getLiability('mort-1')?.principalCents).toBe(24_000_000);

    // Only the $5k outstanding left checkingB — the other $5k of the event stays.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(4_500_000);
    expect(run.state.getAccountBalanceCents('checkingB')).toBe(9_500_000);

    // Internal exchange: net worth is exactly unchanged (the 5k is not lost).
    expect(run.state.getTotals().netWorthCents).toBe(run.openingNetWorthCents);
    expect(run.openingNetWorthCents).toBe(20_000_000);
  });

  it('caps a taxable overage to the net outstanding and withholds a separate tax', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000), taxableAccount('brokerage', 100000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          appreciationRate: 0,
          sellingCostsRate: 0,
          fundingEvents: [
            { id: 'f1', date: '2026-01-15', amount: 55000, accountId: 'checkingA' },
            { id: 'f2', date: '2026-03-15', amount: 10000, accountId: 'brokerage' }
          ]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

    const run = runHousing(scenario, 6);

    const f2Plan = run.plans.find((plan) => plan.request.id.includes(':f2'))!;
    // Requested net is capped at the $5k outstanding, not the $10k event amount.
    expect(f2Plan.request.requestedCents).toBe(500_000);
    expect(f2Plan.executedCents).toBe(500_000);

    const allocation = f2Plan.allocations[0];
    expect(allocation.accountId).toBe('brokerage');
    expect(allocation.netFundedCents).toBe(500_000);
    // Taxable gross-up: the withheld tax is separate and the gross-net identity holds.
    expect(allocation.withheldTaxCents).toBeGreaterThan(0);
    expect(allocation.grossDebitCents).toBeGreaterThan(500_000);
    expect(allocation.grossDebitCents).toBe(
      allocation.netFundedCents + allocation.withheldTaxCents + allocation.penaltyCents
    );

    // Only the real gross debit left the account; the acquisition completes.
    expect(run.state.getAccountBalanceCents('brokerage')).toBe(10_000_000 - allocation.grossDebitCents);
    const home = run.state.getProperty('home-1')!;
    expect(home.status).toBe('owned');
    expect(home.valueCents).toBe(30_000_000);
    expect(home.acquisitionDepositCents).toBe(0);
    expect(run.state.getLiability('mort-1')?.principalCents).toBe(24_000_000);

    // Net-worth drop is exactly the realized tax (no lost equity, no fake refund).
    expect(run.openingNetWorthCents - run.state.getTotals().netWorthCents).toBe(
      allocation.withheldTaxCents + allocation.penaltyCents
    );
  });

  it('holds the partial deposit and never creates an incomplete property on shortfall', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000), account('checkingB', 3000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [
            { id: 'f1', date: '2026-01-15', amount: 55000, accountId: 'checkingA' },
            // Event amount exceeds the $5k outstanding, but only $3k is available.
            { id: 'f2', date: '2026-03-15', amount: 10000, accountId: 'checkingB' }
          ]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

    const run = runHousing(scenario, 6);
    const home = run.state.getProperty('home-1')!;
    expect(home.status).toBe('pending');
    expect(home.valueCents).toBe(0);
    expect(home.acquisitionDepositCents).toBe(5_800_000);
    expect(run.state.getLiability('mort-1')).toBeUndefined();
    expect(home.mortgageId).toBeNull();
    expect(run.state.getAccountBalanceCents('checkingB')).toBe(0);

    const f2Plan = run.plans.find((plan) => plan.request.id.includes(':f2'))!;
    expect(f2Plan.request.requestedCents).toBe(500_000);
    expect(f2Plan.executedCents).toBe(300_000);

    // No ownership cost was fabricated: net worth is unchanged.
    expect(run.state.getTotals().netWorthCents).toBe(run.openingNetWorthCents);
  });

  it('posts nothing when an over-large event targets invalid acquisition terms', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      properties: [
        property({
          id: 'home-1',
          value: 50000,
          debtLink: 'mort-1',
          // Required down payment exceeds the price: invalid terms.
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 100000, accountId: 'checkingA' }]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 10000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 50000, downPayment: 60000 })]
    });

    const run = runHousing(scenario, 3);
    const home = run.state.getProperty('home-1')!;
    expect(home.status).toBe('pending');
    expect(home.valueCents).toBe(0);
    expect(home.acquisitionDepositCents).toBe(0);
    expect(run.state.getLiability('mort-1')).toBeUndefined();
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000_000);
    expect(run.state.getTotals().netWorthCents).toBe(run.openingNetWorthCents);
    expect(run.plans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Failed / zero / partial funding
// ---------------------------------------------------------------------------

describe('P3H.2 — partial and zero funding below the required down payment', () => {
  it('keeps the held net and creates nothing when only part of the down payment is funded', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 10000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 60000, accountId: 'checkingA' }]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

    const run = runHousing(scenario, 3);
    const home = run.state.getProperty('home-1')!;
    expect(home.status).toBe('pending');
    expect(home.valueCents).toBe(0);
    expect(home.acquisitionDepositCents).toBe(1_000_000);
    expect(run.state.getLiability('mort-1')).toBeUndefined();
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(0);
  });

  it('debits nothing when the funding source has no balance (zero-fund)', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 60000, accountId: 'checkingA' }]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

    const run = runHousing(scenario, 3);
    const home = run.state.getProperty('home-1')!;
    expect(home.status).toBe('pending');
    expect(home.acquisitionDepositCents).toBe(0);
    expect(run.state.getLiability('mort-1')).toBeUndefined();
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(0);
    expect(run.state.getTotals().netWorthCents).toBe(run.openingNetWorthCents);
  });
});

// ---------------------------------------------------------------------------
// Pending: no ownership cost / growth
// ---------------------------------------------------------------------------

describe('P3H.1/P3H.2 — pending acquisition holds a non-appreciating deposit', () => {
  it('never appreciates and never creates ownership costs while pending', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 10000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          appreciationRate: 10,
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 10000, accountId: 'checkingA' }]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000, appreciationRate: 10 })]
    });

    const run = runHousing(scenario, 12);
    const home = run.state.getProperty('home-1')!;
    expect(home.status).toBe('pending');
    expect(home.valueCents).toBe(0);
    expect(home.acquisitionDepositCents).toBe(1_000_000);
    // An appreciation event is scheduled, but a pending property never gains value.
    expect(run.events.some((event) => event.definitionId === 'housing:home-1:appreciate')).toBe(true);
    // A required > 0 acquisition has no separate completion event.
    expect(run.events.some((event) => event.definitionId === 'housing:home-1:complete')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Observed owned value + debt appreciation
// ---------------------------------------------------------------------------

describe('P3H.1 — observed owned property value and debt appreciate via valuation.ts', () => {
  it('applies exact effective-annual appreciation through quotePropertyAppreciation', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'home-2',
          value: 350000,
          debtLink: 'mort-2',
          requiredDownPayment: 0,
          status: 'owned',
          appreciationRate: 12,
          sellingCostsRate: 0
        })
      ],
      liabilities: [liability({ id: 'mort-2', openingBalance: 200000, linkedPropertyId: 'home-2' })],
      housing: [housing({ id: 'home-2', purchasePrice: 350000, downPayment: 0, appreciationRate: 12 })]
    });

    const run = runHousing(scenario, 1);
    const home = run.state.getProperty('home-2')!;
    const expected = quotePropertyAppreciation(35_000_000, 0.12, 1, 'owned');
    expect(expected.ok).toBe(true);
    if (expected.ok) {
      expect(home.valueCents).toBe(expected.appreciation.closingValueCents);
    }
    // Debt is untouched by appreciation; observed opening debt is retained once.
    expect(run.state.getLiability('mort-2')?.principalCents).toBe(20_000_000);
    expect(home.mortgageId).toBe('mort-2');
    expect(run.openingNetWorthCents).toBe(35_000_000 - 20_000_000);
  });
});

// ---------------------------------------------------------------------------
// Zero-down completion
// ---------------------------------------------------------------------------

describe('P3H.2 — zero-down completion without funding', () => {
  it('completes a zero-down valid acquisition atomically with no cash movement', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'home-3',
          value: 300000,
          debtLink: 'mort-3',
          requiredDownPayment: 0,
          status: 'pending',
          acquisitionYearMonth: '2026-02',
          appreciationRate: 0
        })
      ],
      liabilities: [liability({ id: 'mort-3', openingBalance: 300000, linkedPropertyId: 'home-3' })],
      housing: [housing({ id: 'home-3', purchasePrice: 300000, downPayment: 0 })]
    });

    const run = runHousing(scenario, 3);
    const home = run.state.getProperty('home-3')!;
    expect(home.status).toBe('owned');
    expect(home.valueCents).toBe(30_000_000);
    expect(home.acquisitionDepositCents).toBe(0);
    expect(home.mortgageId).toBe('mort-3');
    expect(home.completedDate).toBe('2026-02-01');
    expect(run.state.getLiability('mort-3')?.principalCents).toBe(30_000_000);
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(0);
    // Acquiring a 100%-financed home is net-worth neutral.
    expect(run.state.getTotals().netWorthCents).toBe(run.openingNetWorthCents);
    expect(run.events.some((event) => event.definitionId === 'housing:home-3:complete')).toBe(true);
    // A direct non-cash completion commits with no fabricated funding plan.
    expect(run.plans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sale / disposition
// ---------------------------------------------------------------------------

describe('P3H.4 — atomic sale, proceeds and retained deficiency', () => {
  it('deposits net surplus after selling costs and settles the actual linked debt', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'home-4',
          value: 400000,
          debtLink: 'mort-4',
          requiredDownPayment: 0,
          status: 'owned',
          sellingCostsRate: 5,
          appreciationRate: 0
        })
      ],
      liabilities: [liability({ id: 'mort-4', openingBalance: 200000, linkedPropertyId: 'home-4' })],
      housing: [
        housing({
          id: 'home-4',
          purchasePrice: 400000,
          downPayment: 0,
          sellYearMonth: '2026-02',
          saleProceedsAccountId: 'checkingA',
          sellingCostsRate: 5,
          appreciationRate: 0
        })
      ]
    });

    const run = runHousing(scenario, 3);
    const home = run.state.getProperty('home-4')!;
    expect(home.status).toBe('sold');
    expect(home.valueCents).toBe(0);
    expect(home.mortgageId).toBeNull();
    // Linked debt settled to zero, no deficiency retained.
    expect(run.state.getLiability('mort-4')?.principalCents).toBe(0);
    expect(run.state.getLiability('housing:home-4:saleDeficiency')).toBeUndefined();
    // $400k − $20k costs − $200k debt = $180k net proceeds.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(18_000_000);
    // Net worth drop is exactly the real selling cost ($20k).
    expect(run.openingNetWorthCents - run.state.getTotals().netWorthCents).toBe(2_000_000);
    // The disposition is a direct non-cash commit: no fabricated funding plan.
    expect(run.plans).toHaveLength(0);
  });

  it('retains an underwater deficiency once and charges only the selling cost', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'home-4',
          value: 200000,
          debtLink: 'mort-4',
          requiredDownPayment: 0,
          status: 'owned',
          sellingCostsRate: 6,
          appreciationRate: 0
        })
      ],
      liabilities: [liability({ id: 'mort-4', openingBalance: 250000, linkedPropertyId: 'home-4' })],
      housing: [
        housing({
          id: 'home-4',
          purchasePrice: 200000,
          downPayment: 0,
          sellYearMonth: '2026-02',
          saleProceedsAccountId: 'checkingA',
          sellingCostsRate: 6,
          appreciationRate: 0
        })
      ]
    });

    const run = runHousing(scenario, 3);
    const home = run.state.getProperty('home-4')!;
    expect(home.status).toBe('sold');
    expect(home.valueCents).toBe(0);
    // Underwater: $200k − $12k costs − $250k debt = −$62k deficiency, retained once.
    const deficiency = run.state.getLiability('housing:home-4:saleDeficiency');
    expect(deficiency?.kind).toBe('saleDeficiency');
    expect(deficiency?.principalCents).toBe(6_200_000);
    // The original debt is settled; no cash proceeds were fabricated.
    expect(run.state.getLiability('mort-4')?.principalCents).toBe(0);
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(0);
    // Net worth drop is only the selling cost.
    expect(run.openingNetWorthCents - run.state.getTotals().netWorthCents).toBe(1_200_000);
    expect(run.state.getTotals().netWorthCents).toBe(-6_200_000);
  });
});

// ---------------------------------------------------------------------------
// No double count and no mutation on invalid
// ---------------------------------------------------------------------------

describe('P3H — no double count and no mutation on invalid terms', () => {
  it('ignores a funding event scheduled after the acquisition already completed', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000), account('checkingB', 100000)],
      properties: [
        property({
          id: 'home-5',
          value: 300000,
          debtLink: 'mort-5',
          requiredDownPayment: 30000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [
            { id: 'f1', date: '2026-01-15', amount: 30000, accountId: 'checkingA' },
            { id: 'f2', date: '2026-02-15', amount: 30000, accountId: 'checkingB' }
          ]
        })
      ],
      liabilities: [liability({ id: 'mort-5', openingBalance: 270000, linkedPropertyId: 'home-5' })],
      housing: [housing({ id: 'home-5', purchasePrice: 300000, downPayment: 30000 })]
    });

    const run = runHousing(scenario, 4);
    const home = run.state.getProperty('home-5')!;
    expect(home.status).toBe('owned');
    expect(home.valueCents).toBe(30_000_000);
    expect(home.acquisitionDepositCents).toBe(0);
    expect(run.state.getLiability('mort-5')?.principalCents).toBe(27_000_000);
    // The later funding event is a no-op: only the first $30k down payment left cash.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(7_000_000);
    expect(run.state.getAccountBalanceCents('checkingB')).toBe(10_000_000);
  });

  it('posts nothing and leaves state untouched when the required down payment exceeds the price', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      properties: [
        property({
          id: 'home-6',
          value: 50000,
          debtLink: 'mort-6',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 30000, accountId: 'checkingA' }]
        })
      ],
      liabilities: [liability({ id: 'mort-6', openingBalance: 10000, linkedPropertyId: 'home-6' })],
      housing: [housing({ id: 'home-6', purchasePrice: 50000, downPayment: 60000 })]
    });

    const run = runHousing(scenario, 3);
    const home = run.state.getProperty('home-6')!;
    expect(home.status).toBe('pending');
    expect(home.valueCents).toBe(0);
    expect(home.acquisitionDepositCents).toBe(0);
    expect(run.state.getLiability('mort-6')).toBeUndefined();
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000_000);
    expect(run.state.getTotals().netWorthCents).toBe(run.openingNetWorthCents);
    expect(run.plans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Structural compatibility + explicit ordering
// ---------------------------------------------------------------------------

describe('housing — compiled context compatibility and same-date ordering', () => {
  it('accepts a compiled context directly (funding events come from the richer builder)', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [property({ id: 'home-7', value: 200000, requiredDownPayment: 0, status: 'owned', appreciationRate: 0 })],
      housing: [housing({ id: 'home-7', purchasePrice: 200000, downPayment: 0, appreciationRate: 0 })]
    });
    const context = compileScenarioContext(scenario, { horizonMonths: 2 });
    const definitions = buildHousingEventDefinitions(context);
    expect(definitions.some((definition) => definition.definitionId === 'housing:home-7:appreciate')).toBe(true);
  });

  it('uses explicit accrual priorities sale < funding < completion and a close appreciation phase', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'home-8',
          value: 300000,
          debtLink: 'mort-8',
          requiredDownPayment: 0,
          status: 'pending',
          acquisitionYearMonth: '2026-02',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 0, accountId: 'checkingA' }],
          sellingCostsRate: 0
        })
      ],
      liabilities: [liability({ id: 'mort-8', openingBalance: 300000, linkedPropertyId: 'home-8' })],
      housing: [housing({ id: 'home-8', purchasePrice: 300000, downPayment: 0, sellYearMonth: '2026-05' })]
    });
    const context = compileScenarioContext(scenario, { horizonMonths: 6 });
    const definitions = buildHousingEventDefinitions(buildHousingContext(scenario, context.domains.housing));
    const byId = new Map(definitions.map((definition) => [definition.definitionId, definition]));

    expect(byId.get('housing:home-8:sale')?.phase).toBe('accrual');
    expect(byId.get('housing:home-8:sale')?.priority).toBe(HOUSING_PRIORITY.sale);
    expect(byId.get('housing:home-8:funding:checkingA:f1')?.phase).toBe('accrual');
    expect(byId.get('housing:home-8:funding:checkingA:f1')?.priority).toBe(HOUSING_PRIORITY.funding);
    expect(byId.get('housing:home-8:complete')?.phase).toBe('accrual');
    expect(byId.get('housing:home-8:complete')?.priority).toBe(HOUSING_PRIORITY.completion);
    expect(byId.get('housing:home-8:appreciate')?.phase).toBe('close');
    expect(HOUSING_PRIORITY.sale).toBeLessThan(HOUSING_PRIORITY.funding);
    expect(HOUSING_PRIORITY.funding).toBeLessThan(HOUSING_PRIORITY.completion);
    // All eleven handlers are registered under their stable ids.
    expect(createHousingHandlers({
      state: buildState(compileScenarioContext(scenario, { horizonMonths: 1 }).opening),
      context: compileScenarioContext(scenario, { horizonMonths: 1 }),
      accounts: scenario.netWorth.accounts,
      dateOfBirth: null,
      funding: compileScenarioContext(scenario, { horizonMonths: 1 }).funding
    }).map((handler) => handler.handlerId).sort()).toEqual(
      [
        HOUSING_HANDLER_IDS.appreciation,
        HOUSING_HANDLER_IDS.completion,
        HOUSING_HANDLER_IDS.funding,
        HOUSING_HANDLER_IDS.sale,
        HOUSING_HANDLER_IDS.accrual,
        HOUSING_HANDLER_IDS.mortgage,
        HOUSING_HANDLER_IDS.taxesInsurance,
        HOUSING_HANDLER_IDS.hoaMaintenance,
        HOUSING_HANDLER_IDS.pmi,
        HOUSING_HANDLER_IDS.rent,
        HOUSING_HANDLER_IDS.rentalIncome
      ].sort()
    );
  });

  it('validateAcquisitionTerms rejects missing/over-large terms without mutation', () => {
    const base = resolveHousingPlans({
      properties: [
        {
          propertyId: 'p',
          status: 'pending',
          value: 0,
          requiredDownPayment: 0,
          debtLink: 'm',
          fundingEvents: []
        }
      ],
      domains: { housing: [] }
    })[0];
    expect(validateAcquisitionTerms(base).ok).toBe(false);
    expect(
      validateAcquisitionTerms({
        ...base,
        priceCents: 10_000,
        requiredDownPaymentCents: 10_000,
        mortgageId: null
      }).ok
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P3H.3 — mortgage accrual + PI/extra installment (funded-only)
// ---------------------------------------------------------------------------

describe('P3H.3 — mortgage accrual + PI/extra installment', () => {
  const mortgageScenario = (checkingBalance: number): Scenario =>
    makeScenario({
      accounts: [account('checkingA', checkingBalance)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 0,
          status: 'owned',
          appreciationRate: 0,
          sellingCostsRate: 0
        })
      ],
      liabilities: [
        liability({
          id: 'mort-1',
          openingBalance: 240000,
          linkedPropertyId: 'home-1',
          annualInterestRate: 6,
          endYearMonth: '2055-12'
        })
      ],
      housing: [
        housing({
          id: 'home-1',
          purchasePrice: 300000,
          downPayment: 60000,
          annualInterestRate: 6,
          loanTermYears: 30,
          paymentSource: 'account:checkingA'
        })
      ]
    });

  it('accrues nominal APR/12, then pays the standard installment interest-first', () => {
    const run = runHousing(mortgageScenario(100000), 1);
    const quote = quoteLoanInstallment({
      principalCents: 24_000_000,
      accruedInterestCents: 120_000,
      feesCents: 0,
      annualRate: 0.06,
      remainingMonths: 360,
      minimumPaymentCents: 0
    });
    expect(quote.ok).toBe(true);
    const required = quote.ok ? quote.quote.requiredCents : 0;
    const principalPaid = required - 120_000;
    expect(principalPaid).toBeGreaterThan(0);

    const mortgage = run.state.getLiability('mort-1')!;
    expect(run.state.getProperty('home-1')?.mortgageId).toBe('mort-1');
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000_000 - required);
    expect(mortgage.accruedInterestCents).toBe(0);
    expect(mortgage.principalCents).toBe(24_000_000 - principalPaid);
    expect(run.plans.some((plan) => plan.request.purpose === 'housingMortgagePayment')).toBe(true);
    // The month's net-worth drop is exactly the interest expense.
    expect(run.openingNetWorthCents - run.state.getTotals().netWorthCents).toBe(120_000);
  });

  it('reduces debt only by the funded amount (partial) and retains unpaid interest', () => {
    // $1,000 = 100,000 cents available against a ~$1,438.92 installment.
    const run = runHousing(mortgageScenario(1000), 1);
    const mortgage = run.state.getLiability('mort-1')!;
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(0);
    expect(mortgage.principalCents).toBe(24_000_000);
    expect(mortgage.accruedInterestCents).toBe(120_000 - 100_000);
  });

  it('posts nothing when the mortgage is unfunded (zero), retaining all interest', () => {
    const run = runHousing(mortgageScenario(0), 1);
    const mortgage = run.state.getLiability('mort-1')!;
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(0);
    expect(mortgage.principalCents).toBe(24_000_000);
    expect(mortgage.accruedInterestCents).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// P3H.3 — PMI + ancillary groups
// ---------------------------------------------------------------------------

describe('P3H.3 — PMI and ancillary groups', () => {
  const ownedHome = (
    over: { value: number; principal: number; monthly: Partial<HousingEntry> },
    balance: number
  ): Scenario =>
    makeScenario({
      accounts: [account('checkingA', balance)],
      properties: [
        property({
          id: 'home-1',
          value: over.value,
          debtLink: 'mort-1',
          requiredDownPayment: 0,
          status: 'owned',
          appreciationRate: 0
        })
      ],
      liabilities: [
        liability({ id: 'mort-1', openingBalance: over.principal, linkedPropertyId: 'home-1', annualInterestRate: 0 })
      ],
      housing: [
        housing({
          id: 'home-1',
          purchasePrice: over.value,
          downPayment: 0,
          annualInterestRate: 0,
          loanTermYears: 0,
          paymentSource: 'account:checkingA',
          ...over.monthly
        })
      ]
    });

  it('charges PMI only when actual principal > 0 and actual LTV > 80%', () => {
    const high = runHousing(ownedHome({ value: 250000, principal: 240000, monthly: { pmiMonthly: 150 } }, 100000), 1);
    expect(high.state.getAccountBalanceCents('checkingA')).toBe(10_000_000 - 15_000);
    expect(high.state.getTotals().netWorthCents).toBe(high.openingNetWorthCents - 15_000);

    const low = runHousing(ownedHome({ value: 350000, principal: 240000, monthly: { pmiMonthly: 150 } }, 100000), 1);
    expect(low.state.getAccountBalanceCents('checkingA')).toBe(10_000_000);
  });

  it('continues taxes/insurance and HOA/maintenance after the mortgage is paid off', () => {
    const run = runHousing(
      ownedHome(
        {
          value: 300000,
          principal: 0,
          monthly: { propertyTaxYearly: 1200, homeInsuranceYearly: 600, hoaMonthly: 100, maintenanceMonthly: 50 }
        },
        100000
      ),
      1
    );
    // $150/mo escrow + $150/mo HOA+maintenance = $300.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000_000 - 30_000);
    expect(run.state.getTotals().netWorthCents).toBe(run.openingNetWorthCents - 30_000);
  });

  it('routes each group to its own source with a fallback to paymentSource', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000), account('checkingB', 100000)],
      properties: [
        property({ id: 'home-1', value: 250000, debtLink: 'mort-1', requiredDownPayment: 0, status: 'owned' })
      ],
      liabilities: [
        liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1', annualInterestRate: 0 })
      ],
      housing: [
        housing({
          id: 'home-1',
          purchasePrice: 250000,
          downPayment: 0,
          annualInterestRate: 0,
          loanTermYears: 0,
          paymentSource: 'account:checkingA',
          taxesInsuranceSource: 'account:checkingB',
          propertyTaxYearly: 1200,
          hoaMonthly: 100,
          pmiMonthly: 150
        })
      ]
    });
    const run = runHousing(scenario, 1);
    // Taxes+insurance ($100) from checkingB; HOA ($100) + PMI ($150) fall back to paymentSource (checkingA).
    expect(run.state.getAccountBalanceCents('checkingB')).toBe(10_000_000 - 10_000);
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000_000 - 25_000);
  });
});

// ---------------------------------------------------------------------------
// P3H.3 — pending has no ownership costs; ancillary stops at sale; rentals
// ---------------------------------------------------------------------------

describe('P3H.3 — pending, sale end, and rental flows', () => {
  it('charges no PMI/taxes/HOA while the acquisition is pending', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 10000, accountId: 'checkingA' }]
        })
      ],
      liabilities: [
        liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1', annualInterestRate: 6 })
      ],
      housing: [
        housing({
          id: 'home-1',
          purchasePrice: 300000,
          downPayment: 60000,
          annualInterestRate: 6,
          loanTermYears: 30,
          paymentSource: 'account:checkingA',
          propertyTaxYearly: 3600,
          hoaMonthly: 100,
          pmiMonthly: 150
        })
      ]
    });
    const run = runHousing(scenario, 3);
    const home = run.state.getProperty('home-1')!;
    expect(home.status).toBe('pending');
    expect(home.acquisitionDepositCents).toBe(1_000_000);
    // Only the $10k deposit left the account; no ownership costs while pending.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000_000 - 1_000_000);
    expect(run.state.getLiability('mort-1')).toBeUndefined();
  });

  it('charges no tax/insurance in or after the sale month', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      properties: [property({ id: 'home-1', value: 0, requiredDownPayment: 0, status: 'owned' })],
      housing: [
        housing({
          id: 'home-1',
          purchasePrice: 0,
          downPayment: 0,
          paymentSource: 'account:checkingA',
          propertyTaxYearly: 1200,
          sellYearMonth: '2026-02'
        })
      ]
    });
    const run = runHousing(scenario, 3);
    expect(run.state.getProperty('home-1')?.status).toBe('sold');
    // Only January's $100 escrow before the February sale.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000_000 - 10_000);
  });

  it('charges rent and deposits rental income monthly through the inclusive end', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 10000), account('checkingB', 0)],
      properties: [
        property({ id: 'rent-1', value: 0, requiredDownPayment: 0, status: 'owned', sourceConfigId: 'rent-1' })
      ],
      housing: [
        housing({
          id: 'rent-1',
          housingType: 'rental',
          startYearMonth: '2026-01',
          endYearMonth: '2026-03',
          monthlyRent: 1500,
          rentalIncomeMonthly: 1000,
          rentalIncomeAccountId: 'checkingB',
          paymentSource: 'account:checkingA',
          purchasePrice: 0,
          downPayment: 0
        })
      ]
    });
    const run = runHousing(scenario, 5);
    // Three inclusive months (Jan–Mar): $1,500 rent out, $1,000 income in.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(1_000_000 - 3 * 150_000);
    expect(run.state.getAccountBalanceCents('checkingB')).toBe(3 * 100_000);
    expect(run.openingNetWorthCents - run.state.getTotals().netWorthCents).toBe(3 * (150_000 - 100_000));
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D15 — posting journal attribution
// ---------------------------------------------------------------------------

describe('P4.1/D15 — housing posting journal attribution', () => {
  const accountCredits = (state: EngineState, accountId: string): number[] =>
    state
      .getPostings()
      .flatMap((posting) => posting.accountChanges)
      .filter((change) => change.accountId === accountId)
      .map((change) => change.deltaCents);

  it('CA09 scores two postings: the held deposit, then one atomic cash/property/debt completion', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000), account('checkingB', 100000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          appreciationRate: 0,
          fundingEvents: [
            { id: 'f1', date: '2026-01-15', amount: 30000, accountId: 'checkingA' },
            { id: 'f2', date: '2026-03-15', amount: 30000, accountId: 'checkingB' }
          ]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

    const run = runHousing(scenario, 6);
    const first = run.state.getPostingsByDefinition('housing:home-1:funding:checkingA:f1');
    const second = run.state.getPostingsByDefinition('housing:home-1:funding:checkingB:f2');

    // Exactly two committed postings: no fabricated rows for the zero-value
    // pending month or the (appreciationRate 0) valuation events.
    expect(run.state.getPostings()).toHaveLength(2);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    // Row 1 — deposit held while pending: cash out, held deposit in, no debt.
    expect(first[0].posting).toEqual({
      occurrenceId: 'housing:home-1:funding:checkingA:f1:2026-01-15',
      definitionId: 'housing:home-1:funding:checkingA:f1',
      purpose: HOUSING_PURPOSES.funding,
      date: '2026-01-15',
      phase: 'accrual'
    });
    expect(first[0].accountChanges).toEqual([{ accountId: 'checkingA', deltaCents: -3_000_000 }]);
    expect(first[0].propertyChanges).toEqual([
      { propertyId: 'home-1', acquisitionDepositDeltaCents: 3_000_000 }
    ]);
    expect(first[0].liabilityChanges).toEqual([]);
    expect(first[0].expectedNetWorthDeltaCents).toBe(0);

    // Row 2 — the same commit funds cash AND completes the acquisition: the
    // previously held $30k is released (`-$30k`, never `-$60k`), the new cash
    // becomes $300k equity, and the $240k mortgage is created.
    expect(second[0].accountChanges).toEqual([{ accountId: 'checkingB', deltaCents: -3_000_000 }]);
    expect(second[0].propertyChanges).toEqual([
      {
        propertyId: 'home-1',
        acquisitionDepositDeltaCents: -3_000_000,
        valueDeltaCents: 30_000_000,
        status: 'owned',
        mortgageId: 'mort-1',
        completedDate: '2026-03-15'
      }
    ]);
    expect(second[0].liabilityChanges).toEqual([
      { liabilityId: 'mort-1', create: true, kind: 'mortgage', principalDeltaCents: 24_000_000 }
    ]);
    // Internal exchange: conservation declares a zero net-worth delta.
    expect(second[0].expectedNetWorthDeltaCents).toBe(0);

    // No duplicate held deposit or mortgage: the deposit peaked at exactly $30k
    // and only one mortgage ever existed.
    const depositDeltas = run.state
      .getPostings()
      .flatMap((posting) => posting.propertyChanges)
      .map((change) => change.acquisitionDepositDeltaCents ?? 0);
    expect(depositDeltas).toEqual([3_000_000, -3_000_000]);
    const mortgageCreations = run.state
      .getPostings()
      .flatMap((posting) => posting.liabilityChanges)
      .filter((change) => change.create === true && change.kind === 'mortgage');
    expect(mortgageCreations).toHaveLength(1);

    // Signed net-worth reconciliation: every declared delta sums to the actual
    // opening→closing change (exact, no residual).
    const declaredSum = run.state
      .getPostings()
      .reduce((total, posting) => total + posting.expectedNetWorthDeltaCents, 0);
    expect(declaredSum).toBe(run.state.getTotals().netWorthCents - run.openingNetWorthCents);
  });

  it('caps a $55k + $10k overage to the $5k outstanding and journals only that', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000), account('checkingB', 100000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          appreciationRate: 0,
          sellingCostsRate: 0,
          fundingEvents: [
            { id: 'f1', date: '2026-01-15', amount: 55000, accountId: 'checkingA' },
            { id: 'f2', date: '2026-03-15', amount: 10000, accountId: 'checkingB' }
          ]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

    const run = runHousing(scenario, 6);
    const first = run.state.getPostingsByDefinition('housing:home-1:funding:checkingA:f1');
    const second = run.state.getPostingsByDefinition('housing:home-1:funding:checkingB:f2');

    expect(run.state.getPostings()).toHaveLength(2);
    expect(first[0].accountChanges).toEqual([{ accountId: 'checkingA', deltaCents: -5_500_000 }]);
    expect(first[0].propertyChanges).toEqual([
      { propertyId: 'home-1', acquisitionDepositDeltaCents: 5_500_000 }
    ]);

    // The over-large event is capped: only the $5k outstanding is debited and
    // converted, so no overfunded cash is silently lost (declared delta 0).
    expect(second[0].accountChanges).toEqual([{ accountId: 'checkingB', deltaCents: -500_000 }]);
    expect(second[0].propertyChanges?.[0].acquisitionDepositDeltaCents).toBe(-5_500_000);
    expect(second[0].propertyChanges?.[0].valueDeltaCents).toBe(30_000_000);
    expect(second[0].liabilityChanges).toEqual([
      { liabilityId: 'mort-1', create: true, kind: 'mortgage', principalDeltaCents: 24_000_000 }
    ]);
    expect(second[0].expectedNetWorthDeltaCents).toBe(0);
  });

  it('journals an underwater sale once: selling cost + retained deficiency, never duplicated', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'home-4',
          value: 200000,
          debtLink: 'mort-4',
          requiredDownPayment: 0,
          status: 'owned',
          sellingCostsRate: 6,
          appreciationRate: 0
        })
      ],
      liabilities: [liability({ id: 'mort-4', openingBalance: 250000, linkedPropertyId: 'home-4' })],
      housing: [
        housing({
          id: 'home-4',
          purchasePrice: 200000,
          downPayment: 0,
          sellYearMonth: '2026-02',
          saleProceedsAccountId: 'checkingA',
          sellingCostsRate: 6,
          appreciationRate: 0
        })
      ]
    });

    const run = runHousing(scenario, 3);
    const sale = run.state.getPostingsByDefinition('housing:home-4:sale');
    expect(sale).toHaveLength(1);
    expect(sale[0].posting.purpose).toBe(HOUSING_PURPOSES.sale);
    expect(sale[0].posting.phase).toBe('accrual');

    // Property disposed and the actual linked debt settled in the same commit.
    expect(sale[0].propertyChanges).toEqual([
      { propertyId: 'home-4', valueDeltaCents: -20_000_000, status: 'sold', mortgageId: null }
    ]);
    expect(sale[0].accountChanges).toEqual([]);
    // Net-worth delta is exactly the real $12k selling cost.
    expect(sale[0].expectedNetWorthDeltaCents).toBe(-1_200_000);
    // Underwater: the $62k shortfall is retained once as a `saleDeficiency`.
    const deficiencies = run.state
      .getPostings()
      .flatMap((posting) => posting.liabilityChanges)
      .filter((change) => change.kind === 'saleDeficiency');
    expect(deficiencies).toEqual([
      {
        liabilityId: 'housing:home-4:saleDeficiency',
        create: true,
        kind: 'saleDeficiency',
        principalDeltaCents: 6_200_000
      }
    ]);
    const declaredSum = run.state
      .getPostings()
      .reduce((total, posting) => total + posting.expectedNetWorthDeltaCents, 0);
    expect(declaredSum).toBe(run.state.getTotals().netWorthCents - run.openingNetWorthCents);
  });

  it('stamps grouped mortgage accrual, mortgage PI+extra, rent and rental income; never phantom income', () => {
    // Owned home + mortgage: accrual (direct) and PI+extra (funded) both stamped.
    const mortgageRun = runHousing(
      makeScenario({
        accounts: [account('checkingA', 100000)],
        properties: [
          property({
            id: 'home-1',
            value: 300000,
            debtLink: 'mort-1',
            requiredDownPayment: 0,
            status: 'owned',
            appreciationRate: 0,
            sellingCostsRate: 0
          })
        ],
        liabilities: [
          liability({
            id: 'mort-1',
            openingBalance: 240000,
            linkedPropertyId: 'home-1',
            annualInterestRate: 6,
            endYearMonth: '2055-12'
          })
        ],
        housing: [
          housing({
            id: 'home-1',
            purchasePrice: 300000,
            downPayment: 60000,
            annualInterestRate: 6,
            loanTermYears: 30,
            paymentSource: 'account:checkingA'
          })
        ]
      }),
      1
    );

    const accrual = mortgageRun.state.getPostingsByDefinition('housing:home-1:accrual');
    expect(accrual).toHaveLength(1);
    expect(accrual[0].posting.purpose).toBe(HOUSING_PURPOSES.mortgageAccrual);
    expect(accrual[0].posting.phase).toBe('accrual');
    expect(accrual[0].liabilityChanges).toEqual([
      { liabilityId: 'mort-1', accruedInterestDeltaCents: 120_000 }
    ]);
    expect(accrual[0].expectedNetWorthDeltaCents).toBe(-120_000);

    const payment = mortgageRun.state.getPostingsByDefinition('housing:home-1:mortgage');
    expect(payment).toHaveLength(1);
    expect(payment[0].posting.purpose).toBe(HOUSING_PURPOSES.mortgagePayment);
    expect(payment[0].posting.phase).toBe('mandatory');
    // Funded principal reduction is net-worth neutral; only the accrual is expense.
    expect(payment[0].expectedNetWorthDeltaCents).toBe(0);
    expect(payment[0].accountChanges).toHaveLength(1);
    expect(payment[0].liabilityChanges?.[0]?.liabilityId).toBe('mort-1');

    // Rental: rent out (mandatory) and rental income in (income) are distinct
    // postings; the income is exactly the configured amount every month.
    const rentalRun = runHousing(
      makeScenario({
        accounts: [account('checkingA', 10000), account('checkingB', 0)],
        properties: [property({ id: 'rent-1', value: 0, requiredDownPayment: 0, status: 'owned', sourceConfigId: 'rent-1' })],
        housing: [
          housing({
            id: 'rent-1',
            housingType: 'rental',
            startYearMonth: '2026-01',
            endYearMonth: '2026-03',
            monthlyRent: 1500,
            rentalIncomeMonthly: 1000,
            rentalIncomeAccountId: 'checkingB',
            paymentSource: 'account:checkingA',
            purchasePrice: 0,
            downPayment: 0
          })
        ]
      }),
      5
    );

    const rentPostings = rentalRun.state.getPostingsByDefinition('housing:rent-1:rent');
    expect(rentPostings).toHaveLength(3);
    for (const posting of rentPostings) {
      expect(posting.posting.purpose).toBe(HOUSING_PURPOSES.rent);
      expect(posting.posting.phase).toBe('mandatory');
      expect(posting.accountChanges).toEqual([{ accountId: 'checkingA', deltaCents: -150_000 }]);
    }

    const incomePostings = rentalRun.state.getPostingsByDefinition('housing:rent-1:rentalIncome');
    expect(incomePostings).toHaveLength(3);
    for (const posting of incomePostings) {
      expect(posting.posting.purpose).toBe(HOUSING_PURPOSES.rentalIncome);
      expect(posting.posting.phase).toBe('income');
      expect(posting.accountChanges).toEqual([{ accountId: 'checkingB', deltaCents: 100_000 }]);
    }
    // No phantom income: the only credits to the rental account are the exact
    // configured monthly rental income (3 × $1,000), never salary or a duplicate.
    expect(accountCredits(rentalRun.state, 'checkingB')).toEqual([100_000, 100_000, 100_000]);
  });

  it('journals nothing for a rejected or zero/unfunded funding occurrence', () => {
    // Invalid terms (required down payment exceeds price): the event posts nothing.
    const invalid = runHousing(
      makeScenario({
        accounts: [account('checkingA', 100000)],
        properties: [
          property({
            id: 'home-6',
            value: 50000,
            debtLink: 'mort-6',
            requiredDownPayment: 60000,
            status: 'pending',
            acquisitionYearMonth: '2026-01',
            fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 30000, accountId: 'checkingA' }]
          })
        ],
        liabilities: [liability({ id: 'mort-6', openingBalance: 10000, linkedPropertyId: 'home-6' })],
        housing: [housing({ id: 'home-6', purchasePrice: 50000, downPayment: 60000 })]
      }),
      3
    );
    expect(invalid.state.getPostings()).toHaveLength(0);

    // Zero-fund (empty source): no plan, no posting, no revision bump.
    const zero = runHousing(
      makeScenario({
        accounts: [account('checkingA', 0)],
        properties: [
          property({
            id: 'home-1',
            value: 300000,
            debtLink: 'mort-1',
            requiredDownPayment: 60000,
            status: 'pending',
            acquisitionYearMonth: '2026-01',
            fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 60000, accountId: 'checkingA' }]
          })
        ],
        liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
        housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
      }),
      3
    );
    expect(zero.state.getPostings()).toHaveLength(0);
    // The journal never fabricates an opening row.
    expect(zero.state.getPostings().some((posting) => posting.posting.phase === 'opening')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D16 — funding outcomes for unfunded / partial housing quotes
// ---------------------------------------------------------------------------

describe('P4.1/D16 — housing funding outcomes', () => {
  it('records an unfunded pending down-payment outcome with eligible sources and no plan/posting', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 60000, accountId: 'checkingA' }]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

    const run = runHousingProjection(scenario, 3);

    // A positive request executes nothing: no committed plan, no journal row.
    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.definitionId).toBe('housing:home-1:funding:checkingA:f1');
    expect(outcome.handlerId).toBe(HOUSING_HANDLER_IDS.funding);
    expect(outcome.phase).toBe('accrual');
    expect(outcome.committed).toBe(false);
    expect(outcome.plan.status).toBe('unfunded');
    expect(outcome.plan.request.requestedCents).toBe(6_000_000);
    expect(outcome.plan.executedCents).toBe(0);
    expect(outcome.plan.shortfallCents).toBe(6_000_000);
    // Eligible-source evidence and typed skip reason (D16), never inferred.
    expect(outcome.eligibleSources).toEqual([{ accountId: 'checkingA', balanceCents: 0 }]);
    expect(outcome.skippedSources.map((source) => source.reason)).toContain('zero-balance');
  });

  it('records one unfunded outcome per monthly rent group with eligible sources and no posting', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({ id: 'rent-1', value: 0, requiredDownPayment: 0, status: 'owned', sourceConfigId: 'rent-1' })
      ],
      housing: [
        housing({
          id: 'rent-1',
          housingType: 'rental',
          startYearMonth: '2026-01',
          endYearMonth: '2026-03',
          monthlyRent: 1500,
          rentalIncomeMonthly: 0,
          paymentSource: 'account:checkingA',
          purchasePrice: 0,
          downPayment: 0
        })
      ]
    });

    const run = runHousingProjection(scenario, 3);

    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(3);
    for (const outcome of run.fundingOutcomes) {
      expect(outcome.definitionId).toBe('housing:rent-1:rent');
      expect(outcome.handlerId).toBe(HOUSING_HANDLER_IDS.rent);
      expect(outcome.phase).toBe('mandatory');
      expect(outcome.committed).toBe(false);
      expect(outcome.plan.status).toBe('unfunded');
      expect(outcome.plan.request.requestedCents).toBe(150_000);
      expect(outcome.plan.executedCents).toBe(0);
      expect(outcome.plan.shortfallCents).toBe(150_000);
      expect(outcome.eligibleSources).toEqual([{ accountId: 'checkingA', balanceCents: 0 }]);
      expect(outcome.skippedSources.map((source) => source.reason)).toContain('zero-balance');
    }
  });

  it('records one unfunded outcome per monthly mortgage group with no accrual or posting', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 0,
          status: 'owned',
          appreciationRate: 0,
          sellingCostsRate: 0
        })
      ],
      liabilities: [
        liability({
          id: 'mort-1',
          openingBalance: 240000,
          linkedPropertyId: 'home-1',
          annualInterestRate: 0,
          endYearMonth: '2055-12'
        })
      ],
      housing: [
        housing({
          id: 'home-1',
          purchasePrice: 300000,
          downPayment: 0,
          annualInterestRate: 0,
          loanTermYears: 0,
          paymentSource: 'account:checkingA'
        })
      ]
    });

    const run = runHousingProjection(scenario, 3);

    // No interest (APR 0) so no accrual posting; the PI+extra group is unfunded.
    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(3);
    for (const outcome of run.fundingOutcomes) {
      expect(outcome.definitionId).toBe('housing:home-1:mortgage');
      expect(outcome.handlerId).toBe(HOUSING_HANDLER_IDS.mortgage);
      expect(outcome.phase).toBe('mandatory');
      expect(outcome.committed).toBe(false);
      expect(outcome.plan.status).toBe('unfunded');
      expect(outcome.plan.executedCents).toBe(0);
      expect(outcome.plan.shortfallCents).toBe(outcome.plan.request.requestedCents);
      expect(outcome.eligibleSources).toEqual([{ accountId: 'checkingA', balanceCents: 0 }]);
      expect(outcome.skippedSources.map((source) => source.reason)).toContain('zero-balance');
    }
  });

  it('records a committed partial down-payment outcome alongside exactly one journal row', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 10000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 60000, accountId: 'checkingA' }]
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]
    });

    const run = runHousingProjection(scenario, 3);

    // One committed partial plan, mirrored by exactly one outcome and one row.
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0]?.status).toBe('partial');
    expect(run.plans[0]?.executedCents).toBe(1_000_000);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.committed).toBe(true);
    expect(outcome.plan.status).toBe('partial');
    expect(outcome.plan.executedCents).toBe(1_000_000);
    expect(outcome.plan.shortfallCents).toBe(5_000_000);

    const rows = run.postings.filter(
      (record) => record.posting.definitionId === 'housing:home-1:funding:checkingA:f1'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.posting.purpose).toBe(HOUSING_PURPOSES.funding);
    expect(rows[0]?.accountChanges).toEqual([{ accountId: 'checkingA', deltaCents: -1_000_000 }]);
    // The held deposit is exactly the executed net; the acquisition never completes.
    expect(rows[0]?.propertyChanges).toEqual([
      { propertyId: 'home-1', acquisitionDepositDeltaCents: 1_000_000 }
    ]);
  });
});

// ---------------------------------------------------------------------------
// RV04/F23 — timeline-scoped funding events (base vs named timeline)
// ---------------------------------------------------------------------------

/** A timeline shell carrying only housing; the other local domains stay empty. */
const timelineWith = (id: string, housingEntries: HousingEntry[]): Timeline => ({
  id,
  label: id,
  purchases: [],
  longTermPurchases: [],
  loans: [],
  creditCards: [],
  cardPlans: [],
  careerPlan: { enabled: false, entries: [] },
  housing: housingEntries
});

const fundingIds = (context: Parameters<typeof resolveHousingPlans>[0]): string[] =>
  resolveHousingPlans(context)[0].fundingEvents.map((event) => event.id);

const fundingDefinitionIds = (definitions: readonly EventDefinition[]): string[] =>
  definitions
    .filter((definition) => parseHousingDefinitionId(definition.definitionId)?.kind === 'funding')
    .map((definition) => parseHousingDefinitionId(definition.definitionId)?.fundingEventId ?? '');

describe('RV04/F23 — buildHousingContext timeline scope', () => {
  const baseProperty = (): PropertyDefinition =>
    property({
      id: 'home-1',
      value: 300000,
      debtLink: 'mort-1',
      requiredDownPayment: 60000,
      status: 'pending',
      acquisitionYearMonth: '2026-01',
      fundingEvents: [{ id: 'f-base', date: '2026-01-15', amount: 30000, accountId: 'checkingA' }]
    });

  const scenarioWith = (housingEntries: HousingEntry[], timelines: Timeline[] = []): Scenario => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      properties: [baseProperty()],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: housingEntries
    });
    scenario.timelines = timelines;
    return scenario;
  };

  it('base (timelineId null) reads the global PropertyDefinition.fundingEvents', () => {
    const scenario = scenarioWith([housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 })]);

    const context = buildHousingContext(scenario, scenario.housing, undefined, { timelineId: null });
    expect(fundingIds(context)).toEqual(['f-base']);

    const definitions = buildHousingEventDefinitions(context);
    expect(fundingDefinitionIds(definitions)).toEqual(['f-base']);
  });

  it('a named timeline reads only the linked selected HousingEntry.fundingEvents, never the global list', () => {
    const timelineHousing = housing({
      id: 'home-1',
      purchasePrice: 300000,
      downPayment: 60000,
      fundingEvents: [{ id: 'f-tl', date: '2026-02-15', amount: 60000, accountId: 'checkingA' }]
    });
    const scenario = scenarioWith([], [timelineWith('tl-A', [timelineHousing])]);

    const context = buildHousingContext(scenario, [timelineHousing], undefined, { timelineId: 'tl-A' });
    expect(fundingIds(context)).toEqual(['f-tl']);
    expect(fundingDefinitionIds(buildHousingEventDefinitions(context))).toEqual(['f-tl']);
  });

  it('a legacy named timeline without fundingEvents schedules no funding event (never inherits the global list)', () => {
    const legacyHousing = housing({ id: 'home-1', purchasePrice: 300000, downPayment: 60000 });
    const scenario = scenarioWith([], [timelineWith('tl-legacy', [legacyHousing])]);

    const context = buildHousingContext(scenario, [legacyHousing], undefined, { timelineId: 'tl-legacy' });
    expect(fundingIds(context)).toEqual([]);
    expect(fundingDefinitionIds(buildHousingEventDefinitions(context))).toEqual([]);
  });

  it('matches the linked housing entry by sourceConfigId and honours an explicit empty list', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      properties: [
        property({
          id: 'prop-1',
          value: 300000,
          requiredDownPayment: 60000,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          sourceConfigId: 'home-cfg',
          fundingEvents: [{ id: 'f-base', date: '2026-01-15', amount: 30000, accountId: 'checkingA' }]
        })
      ],
      housing: []
    });
    scenario.timelines = [];

    // The property id (`prop-1`) and housing id (`home-cfg`) differ; matching is
    // by `sourceConfigId`, and the global `f-base` is still never inherited.
    const matched = housing({
      id: 'home-cfg',
      purchasePrice: 300000,
      downPayment: 60000,
      fundingEvents: [{ id: 'f-cfg', date: '2026-02-15', amount: 60000, accountId: 'checkingA' }]
    });
    expect(fundingIds(buildHousingContext(scenario, [matched], undefined, { timelineId: 'tl-A' }))).toEqual(['f-cfg']);

    // An explicit `[]` is honoured as empty, not treated as "fall back to global".
    const explicitEmpty = housing({ id: 'home-cfg', purchasePrice: 300000, downPayment: 60000, fundingEvents: [] });
    expect(fundingIds(buildHousingContext(scenario, [explicitEmpty], undefined, { timelineId: 'tl-A' }))).toEqual([]);
  });

  it('deep-copies a cloned timeline list so editing A leaves base and B intact', () => {
    const clone = (): HousingEntry =>
      housing({
        id: 'home-1',
        purchasePrice: 300000,
        downPayment: 60000,
        fundingEvents: [{ id: 'f-base', date: '2026-01-15', amount: 30000, accountId: 'checkingA' }]
      });
    const timelineA = clone();
    const timelineB = clone();
    const scenario = scenarioWith([], [
      timelineWith('tl-A', [timelineA]),
      timelineWith('tl-B', [timelineB])
    ]);

    // Edit A only. Base keeps reading the untouched global property list.
    timelineA.fundingEvents![0] = {
      ...timelineA.fundingEvents![0],
      id: 'f-a',
      amount: 99999
    };

    const base = buildHousingContext(scenario, scenario.housing, undefined, { timelineId: null });
    const a = buildHousingContext(scenario, [timelineA], undefined, { timelineId: 'tl-A' });
    const b = buildHousingContext(scenario, [timelineB], undefined, { timelineId: 'tl-B' });

    expect(resolveHousingPlans(base)[0].fundingEvents[0]).toMatchObject({ id: 'f-base', amountCents: 3_000_000 });
    expect(resolveHousingPlans(a)[0].fundingEvents[0]).toMatchObject({ id: 'f-a', amountCents: 9_999_900 });
    expect(resolveHousingPlans(b)[0].fundingEvents[0]).toMatchObject({ id: 'f-base', amountCents: 3_000_000 });
  });

  it('drives different held-deposit / cash balances for the same global property across timelines', () => {
    const partial = housing({
      id: 'home-1',
      purchasePrice: 300000,
      downPayment: 60000,
      fundingEvents: [{ id: 'f-a', date: '2026-01-15', amount: 30000, accountId: 'checkingA' }]
    });
    const full = housing({
      id: 'home-1',
      purchasePrice: 300000,
      downPayment: 60000,
      fundingEvents: [{ id: 'f-b', date: '2026-01-15', amount: 60000, accountId: 'checkingA' }]
    });
    const scenario = scenarioWith([], [
      timelineWith('tl-A', [partial]),
      timelineWith('tl-B', [full])
    ]);

    const runA = runHousing(scenario, 3, 'tl-A');
    const runB = runHousing(scenario, 3, 'tl-B');

    // Timeline A holds a partial deposit and stays pending: $30k left checking.
    expect(runA.state.getProperty('home-1')?.status).toBe('pending');
    expect(runA.state.getProperty('home-1')?.acquisitionDepositCents).toBe(3_000_000);
    expect(runA.state.getAccountBalanceCents('checkingA')).toBe(7_000_000);

    // Timeline B funds the full $60k and completes: $60k left checking, no deposit.
    expect(runB.state.getProperty('home-1')?.status).toBe('owned');
    expect(runB.state.getProperty('home-1')?.acquisitionDepositCents).toBe(0);
    expect(runB.state.getAccountBalanceCents('checkingA')).toBe(4_000_000);
  });

  it('keeps the global observed opening property shared and schedules it once (no duplicate event)', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          status: 'owned',
          debtLink: 'mort-1',
          requiredDownPayment: 0,
          appreciationRate: 0,
          sellingCostsRate: 0
        })
      ],
      liabilities: [liability({ id: 'mort-1', openingBalance: 240000, linkedPropertyId: 'home-1' })],
      housing: []
    });
    scenario.timelines = [timelineWith('tl-A', [housing({ id: 'home-1', purchasePrice: 300000, downPayment: 0 })])];

    const context = buildHousingContext(
      scenario,
      scenario.timelines[0].housing,
      undefined,
      { timelineId: 'tl-A' }
    );

    // Identity/status/debtLink stay the shared global observed opening.
    expect(context.properties).toHaveLength(1);
    expect(context.properties[0]).toMatchObject({ propertyId: 'home-1', value: 300000, status: 'owned', debtLink: 'mort-1' });

    const definitions = buildHousingEventDefinitions(context);
    expect(definitions.filter((definition) => definition.definitionId === 'housing:home-1:appreciate')).toHaveLength(1);
    expect(fundingDefinitionIds(definitions)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P5.1/F17 — property-free standalone rentals
// ---------------------------------------------------------------------------

describe('P5.1/F17 — property-free standalone rentals', () => {
  it('resolves a rental not linked to any property as a property-free plan', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      housing: [rental({ id: 'apt-1' })]
    });

    const plans = resolveHousingPlans(compileScenarioContext(scenario, { horizonMonths: 3 }));
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan.propertyId).toBe(standaloneRentalPlanId('apt-1'));
    expect(plan.propertyId).toBe('rental:apt-1');
    expect(plan.propertyFree).toBe(true);
    expect(plan.housingType).toBe('rental');

    // No fabricated owned asset / mortgage / debt.
    expect(plan.mortgage).toBeNull();
    expect(plan.mortgageId).toBeNull();
    expect(plan.priceCents).toBe(0);
    expect(plan.requiredDownPaymentCents).toBe(0);
    expect(plan.fundingEvents).toEqual([]);
    expect(plan.saleDate).toBeNull();
    expect(plan.completionDate).toBeNull();
    expect(plan.appreciationRate).toBe(0);
    expect(plan.startDate).toBe('2026-01-01');

    // Rent, renters insurance (homeInsuranceYearly 300 → 25/mo) and no PMI.
    expect(plan.groups.rent.monthlyCents).toBe(150_000);
    expect(plan.groups.taxesInsurance.monthlyCents).toBe(2_500);
    expect(plan.groups.pmi.monthlyCents).toBe(0);
  });

  it('schedules only rent/ancillary/income definitions, never a property lifecycle', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 10000)],
      housing: [rental({ id: 'apt-1', startYearMonth: '2026-01', endYearMonth: '2026-03' })]
    });
    const run = runHousing(scenario, 5);
    const ids = run.events.map((event) => event.definitionId);
    expect(ids).toContain('housing:rental:apt-1:rent');
    expect(ids).toContain('housing:rental:apt-1:taxesInsurance');
    expect(ids.some((id) => /:(appreciate|sale|complete|mortgage|accrual)(:|$)/.test(id))).toBe(false);
    expect(ids.some((id) => id.includes(':funding:'))).toBe(false);
  });

  it('posts $1500 rent (funded) and rental income once into the configured account', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000), account('checkingB', 0)],
      housing: [
        rental({
          id: 'apt-1',
          startYearMonth: '2026-01',
          endYearMonth: '2026-03',
          monthlyRent: 1500,
          homeInsuranceYearly: 0,
          rentalIncomeMonthly: 1000,
          rentalIncomeAccountId: 'checkingB',
          paymentSource: 'account:checkingA'
        })
      ]
    });

    const run = runHousing(scenario, 5);

    // Three inclusive months: $1,500 rent out, $1,000 income in.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000_000 - 3 * 150_000);
    expect(run.state.getAccountBalanceCents('checkingB')).toBe(3 * 100_000);
    expect(run.state.getPostingsByDefinition('housing:rental:apt-1:rent')).toHaveLength(3);
    expect(run.state.getPostingsByDefinition('housing:rental:apt-1:rentalIncome')).toHaveLength(3);

    // Opening assets are unchanged and no owned asset/property was fabricated.
    expect(run.state.getProperty(standaloneRentalPlanId('apt-1'))).toBeUndefined();
    expect(run.state.getTotals().netWorthCents).toBe(run.openingNetWorthCents - 3 * (150_000 - 100_000));
  });

  it('warns and holds a zero rent shortfall when the funding account is empty', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      housing: [
        rental({
          id: 'apt-1',
          startYearMonth: '2026-01',
          endYearMonth: '2026-01',
          monthlyRent: 1500,
          homeInsuranceYearly: 0,
          paymentSource: 'account:checkingA'
        })
      ]
    });

    const run = runHousing(scenario, 1);
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(0);
    // Nothing executed or posted: the unfunded quote is evidence, not a plan row.
    expect(run.plans.filter((plan) => plan.executedCents > 0)).toHaveLength(0);
    expect(run.state.getPostings()).toHaveLength(0);
    expect(
      run.diagnostics.some(
        (message) => message.includes(HOUSING_PURPOSES.rent) && message.includes('not funded')
      )
    ).toBe(true);
  });

  it('funds rent partially and warns on the account shortage', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 500)],
      housing: [
        rental({
          id: 'apt-1',
          startYearMonth: '2026-01',
          endYearMonth: '2026-01',
          monthlyRent: 1500,
          homeInsuranceYearly: 0,
          paymentSource: 'account:checkingA'
        })
      ]
    });

    const run = runHousing(scenario, 1);
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(0);
    const plan = run.plans.find((candidate) => candidate.request.purpose === HOUSING_PURPOSES.rent);
    expect(plan?.executedCents).toBe(50_000);
    expect(plan?.shortfallCents).toBe(100_000);
    expect(run.diagnostics.some((message) => message.includes('short by'))).toBe(true);
  });

  it('schedules rent through the inclusive end month (day-31 safe)', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      housing: [
        rental({
          id: 'apt-1',
          startYearMonth: '2026-01',
          endYearMonth: '2026-03',
          monthlyRent: 1500,
          homeInsuranceYearly: 0,
          paymentSource: 'account:checkingA'
        })
      ]
    });

    const context = compileScenarioContext(scenario, { horizonMonths: 5 });
    const definitions = buildHousingEventDefinitions(
      buildHousingContext(scenario, context.domains.housing, context.liabilities, {
        timelineId: context.timelineId
      })
    );
    const rent = definitions.find((definition) => definition.definitionId === 'housing:rental:apt-1:rent');
    expect(rent?.recurrence.endDate).toBe('2026-03-31');

    const run = runHousing(scenario, 5);
    expect(run.state.getPostingsByDefinition('housing:rental:apt-1:rent')).toHaveLength(3);
  });

  it('posts rent for a zero-career/no-income scenario', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      housing: [
        rental({
          id: 'apt-1',
          startYearMonth: '2026-01',
          endYearMonth: '2026-03',
          monthlyRent: 1500,
          homeInsuranceYearly: 0,
          paymentSource: 'account:checkingA'
        })
      ]
    });
    expect(scenario.careerPlan.enabled).toBe(false);

    const run = runHousing(scenario, 3);
    expect(run.state.getPostingsByDefinition('housing:rental:apt-1:rent')).toHaveLength(3);
  });

  it('deposits same-date rental income before the rent obligation', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 0)],
      housing: [
        rental({
          id: 'apt-1',
          startYearMonth: '2026-01',
          endYearMonth: '2026-01',
          monthlyRent: 1500,
          homeInsuranceYearly: 0,
          rentalIncomeMonthly: 2000,
          rentalIncomeAccountId: 'checkingA',
          paymentSource: 'account:checkingA'
        })
      ]
    });

    const run = runHousing(scenario, 1);
    // Income ($2,000, `income` phase) posts before rent ($1,500, `mandatory`),
    // so the rent is fully funded and $500 remains.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(50_000);
    const rent = run.plans.find((candidate) => candidate.request.purpose === HOUSING_PURPOSES.rent);
    expect(rent?.executedCents).toBe(150_000);
  });

  it('runs a property-backed mortgage and a standalone rental the same month without double counting', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100000)],
      properties: [
        property({
          id: 'home-1',
          value: 300000,
          debtLink: 'mort-1',
          requiredDownPayment: 0,
          status: 'owned',
          appreciationRate: 0,
          sellingCostsRate: 0
        })
      ],
      liabilities: [
        liability({
          id: 'mort-1',
          openingBalance: 240000,
          linkedPropertyId: 'home-1',
          annualInterestRate: 0,
          endYearMonth: '2055-12'
        })
      ],
      housing: [
        housing({
          id: 'home-1',
          housingType: 'mortgage',
          startYearMonth: '2026-01',
          purchasePrice: 300000,
          downPayment: 0,
          annualInterestRate: 0,
          loanTermYears: 0,
          paymentSource: 'account:checkingA'
        }),
        rental({
          id: 'apt-1',
          startYearMonth: '2026-01',
          endYearMonth: '2026-01',
          monthlyRent: 1500,
          homeInsuranceYearly: 0,
          paymentSource: 'account:checkingA'
        })
      ]
    });

    const run = runHousing(scenario, 1);
    // Each obligation posts exactly once on its own namespaced definition id.
    expect(run.plans.filter((plan) => plan.request.purpose === HOUSING_PURPOSES.mortgagePayment)).toHaveLength(1);
    expect(run.plans.filter((plan) => plan.request.purpose === HOUSING_PURPOSES.rent)).toHaveLength(1);
    expect(run.state.getPostingsByDefinition('housing:home-1:mortgage')).toHaveLength(1);
    expect(run.state.getPostingsByDefinition('housing:rental:apt-1:rent')).toHaveLength(1);

    // The standalone rental is not a property; the mortgage home is.
    expect(run.state.getProperty('home-1')?.status).toBe('owned');
    expect(run.state.getProperty(standaloneRentalPlanId('apt-1'))).toBeUndefined();

    const plans = resolveHousingPlans(compileScenarioContext(scenario, { horizonMonths: 1 }));
    expect(plans.find((plan) => plan.propertyId === 'home-1')?.propertyFree).toBe(false);
    expect(plans.find((plan) => plan.propertyId === standaloneRentalPlanId('apt-1'))?.propertyFree).toBe(true);
  });

  it('does not duplicate a property-backed rental as a standalone plan', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 10000)],
      properties: [
        property({ id: 'rent-1', value: 0, requiredDownPayment: 0, status: 'owned', sourceConfigId: 'rent-1' })
      ],
      housing: [
        rental({
          id: 'rent-1',
          startYearMonth: '2026-01',
          endYearMonth: '2026-03',
          monthlyRent: 1500,
          rentalIncomeMonthly: 1000,
          rentalIncomeAccountId: 'checkingA',
          paymentSource: 'account:checkingA'
        })
      ]
    });

    const plans = resolveHousingPlans(compileScenarioContext(scenario, { horizonMonths: 3 }));
    expect(plans).toHaveLength(1);
    expect(plans[0].propertyId).toBe('rent-1');
    expect(plans[0].propertyFree).toBe(false);

    // Existing property-backed ids/behavior are unchanged.
    const run = runHousing(scenario, 5);
    expect(run.state.getPostingsByDefinition('housing:rent-1:rent')).toHaveLength(3);
    expect(run.state.getPostingsByDefinition('housing:rent-1:rentalIncome')).toHaveLength(3);
    expect(run.state.getPostingsByDefinition('housing:rental:rent-1:rent')).toHaveLength(0);
  });

  it('keeps each timeline\u2019s standalone rental isolated from the other and the base', () => {
    const rentalA = rental({
      id: 'apt-A',
      startYearMonth: '2026-01',
      endYearMonth: '2026-02',
      monthlyRent: 1000,
      homeInsuranceYearly: 0,
      paymentSource: 'account:checkingA'
    });
    const rentalB = rental({
      id: 'apt-B',
      startYearMonth: '2026-01',
      endYearMonth: '2026-02',
      monthlyRent: 2000,
      homeInsuranceYearly: 0,
      paymentSource: 'account:checkingA'
    });
    const scenario = makeScenario({ accounts: [account('checkingA', 100000)], housing: [] });
    scenario.timelines = [timelineWith('tl-A', [rentalA]), timelineWith('tl-B', [rentalB])];

    const baseRun = runHousing(scenario, 2, null);
    const runA = runHousing(scenario, 2, 'tl-A');
    const runB = runHousing(scenario, 2, 'tl-B');

    // Base never sees either timeline's rental.
    expect(baseRun.events.some((event) => event.definitionId === 'housing:rental:apt-A:rent')).toBe(false);
    expect(baseRun.events.some((event) => event.definitionId === 'housing:rental:apt-B:rent')).toBe(false);

    // A and B each schedule only their own rental.
    expect(runA.events.some((event) => event.definitionId === 'housing:rental:apt-A:rent')).toBe(true);
    expect(runA.events.some((event) => event.definitionId === 'housing:rental:apt-B:rent')).toBe(false);
    expect(runB.events.some((event) => event.definitionId === 'housing:rental:apt-B:rent')).toBe(true);
    expect(runB.events.some((event) => event.definitionId === 'housing:rental:apt-A:rent')).toBe(false);

    // Only the selected timeline's rent is charged (2 inclusive months each).
    expect(runA.state.getAccountBalanceCents('checkingA')).toBe(10_000_000 - 2 * 100_000);
    expect(runB.state.getAccountBalanceCents('checkingA')).toBe(10_000_000 - 2 * 200_000);
  });
});

// ---------------------------------------------------------------------------
// P5.2 / G20-G22 — ordered per-group `HousingEntry.fundingPolicies` consumer
// ---------------------------------------------------------------------------

describe('P5.2/G20-G22 — ordered per-group funding policies', () => {
  /** A one-month standalone rental so only the requested groups are scheduled. */
  const oneMonthRental = (over: Partial<HousingEntry>): HousingEntry =>
    rental({
      id: 'apt-1',
      startYearMonth: '2026-01',
      endYearMonth: '2026-01',
      homeInsuranceYearly: 0,
      paymentSource: undefined,
      ...over
    });

  it('splits a $150 payment group 100+50 across an explicit primary + fallback with no shortfall', () => {
    const scenario = makeScenario({
      accounts: [account('A', 100), account('B', 100)],
      housing: [
        oneMonthRental({
          monthlyRent: 150,
          fundingPolicies: { payment: { primaryAccountId: 'A', fallbackAccountIds: ['B'] } }
        })
      ]
    });

    const run = runHousing(scenario, 1);
    const plan = run.plans.find((candidate) => candidate.request.purpose === HOUSING_PURPOSES.rent)!;

    expect(plan.status).toBe('funded');
    expect(plan.executedCents).toBe(15_000);
    expect(plan.shortfallCents).toBe(0);
    // Primary-first, ordered fallback draws exactly 100 + 50.
    expect(plan.request.primaryAccountId).toBe('A');
    expect(plan.request.fallbackAccountIds).toEqual(['B']);
    expect(plan.allocations.map((allocation) => [allocation.accountId, allocation.netFundedCents])).toEqual([
      ['A', 10_000],
      ['B', 5_000]
    ]);
    expect(run.state.getAccountBalanceCents('A')).toBe(0);
    expect(run.state.getAccountBalanceCents('B')).toBe(5_000);
    // One atomic posting per actual funded group.
    expect(run.state.getPostingsByDefinition('housing:rental:apt-1:rent')).toHaveLength(1);
  });

  it('keeps each group override independent and authoritative over the global default', () => {
    const scenario = makeScenario({
      accounts: [account('A', 1000), account('B', 1000), account('globalAcct', 1000)],
      housing: [
        oneMonthRental({
          monthlyRent: 100,
          propertyTaxYearly: 1200,
          hoaMonthly: 100,
          fundingPolicies: {
            payment: { primaryAccountId: 'A', fallbackAccountIds: [] },
            taxesInsurance: { primaryAccountId: 'B', fallbackAccountIds: [] },
            hoaMaintenance: { primaryAccountId: 'A', fallbackAccountIds: ['B'] }
          }
        })
      ]
    });
    scenario.fundingPolicy = { primaryAccountId: 'globalAcct', fallbackAccountIds: [] };

    const run = runHousing(scenario, 1);

    // Rent + HOA from A ($200), taxes from B ($100); the global default is never used.
    expect(run.state.getAccountBalanceCents('A')).toBe(100_000 - 20_000);
    expect(run.state.getAccountBalanceCents('B')).toBe(100_000 - 10_000);
    expect(run.state.getAccountBalanceCents('globalAcct')).toBe(100_000);
    for (const purpose of [HOUSING_PURPOSES.rent, HOUSING_PURPOSES.taxesInsurance, HOUSING_PURPOSES.hoaMaintenance]) {
      const plan = run.plans.find((candidate) => candidate.request.purpose === purpose)!;
      expect(plan.shortfallCents).toBe(0);
    }
  });

  it('uses each legacy group scalar, then the global default order', () => {
    const scenario = makeScenario({
      accounts: [account('A', 1000), account('B', 1000), account('globalAcct', 1000)],
      housing: [
        oneMonthRental({
          monthlyRent: 100,
          propertyTaxYearly: 1200,
          hoaMonthly: 100,
          // `paymentSource` is absent → rent inherits the global default order.
          taxesInsuranceSource: 'account:B',
          hoaMaintenanceSource: 'account:A'
        })
      ]
    });
    scenario.fundingPolicy = { primaryAccountId: 'globalAcct', fallbackAccountIds: [] };

    const run = runHousing(scenario, 1);

    expect(run.state.getAccountBalanceCents('A')).toBe(90_000); // HOA (legacy scalar)
    expect(run.state.getAccountBalanceCents('B')).toBe(90_000); // taxes+insurance (legacy scalar)
    expect(run.state.getAccountBalanceCents('globalAcct')).toBe(90_000); // rent (global default)
  });

  it('keeps an explicit null-primary + empty-fallback group visibly unresolved (never global)', () => {
    const scenario = makeScenario({
      accounts: [account('globalAcct', 100)],
      housing: [
        oneMonthRental({
          monthlyRent: 100,
          fundingPolicies: { payment: { primaryAccountId: null, fallbackAccountIds: [] } }
        })
      ]
    });
    scenario.fundingPolicy = { primaryAccountId: 'globalAcct', fallbackAccountIds: [] };

    const run = runHousing(scenario, 1);
    const plan = run.plans.find((candidate) => candidate.request.purpose === HOUSING_PURPOSES.rent)!;

    // The explicit empty policy is authoritative: no allocation and no global draw.
    expect(plan.status).toBe('unfunded');
    expect(plan.executedCents).toBe(0);
    expect(plan.allocations).toHaveLength(0);
    expect(plan.eligibleAccountIds).toHaveLength(0);
    expect(run.state.getAccountBalanceCents('globalAcct')).toBe(10_000);
    expect(run.state.getPostings()).toHaveLength(0);
  });

  it('funds a partial ordered fallback and reports the real shortfall', () => {
    const scenario = makeScenario({
      accounts: [account('A', 100), account('B', 30)],
      housing: [
        oneMonthRental({
          monthlyRent: 150,
          fundingPolicies: { payment: { primaryAccountId: 'A', fallbackAccountIds: ['B'] } }
        })
      ]
    });

    const run = runHousing(scenario, 1);
    const plan = run.plans.find((candidate) => candidate.request.purpose === HOUSING_PURPOSES.rent)!;

    expect(plan.status).toBe('partial');
    expect(plan.executedCents).toBe(13_000);
    expect(plan.shortfallCents).toBe(2_000);
    expect(run.state.getAccountBalanceCents('A')).toBe(0);
    expect(run.state.getAccountBalanceCents('B')).toBe(0);
    expect(run.diagnostics.some((message) => message.includes('short by'))).toBe(true);
  });

  it('keeps the gross = net + tax + penalty identity for an explicit taxable source', () => {
    const scenario = makeScenario({
      accounts: [taxableAccount('brokerage', 1000)],
      housing: [
        oneMonthRental({
          monthlyRent: 100,
          fundingPolicies: { payment: { primaryAccountId: 'brokerage', fallbackAccountIds: [] } }
        })
      ]
    });

    const run = runHousing(scenario, 1);
    const plan = run.plans.find((candidate) => candidate.request.purpose === HOUSING_PURPOSES.rent)!;
    const allocation = plan.allocations[0];

    expect(allocation.accountId).toBe('brokerage');
    expect(allocation.netFundedCents).toBe(10_000);
    expect(allocation.withheldTaxCents).toBeGreaterThan(0);
    expect(allocation.grossDebitCents).toBe(
      allocation.netFundedCents + allocation.withheldTaxCents + allocation.penaltyCents
    );
    expect(run.state.getAccountBalanceCents('brokerage')).toBe(100_000 - allocation.grossDebitCents);
  });

  it('isolates each timeline\u2019s per-group policy from the base and the other timeline', () => {
    const scenario = makeScenario({
      accounts: [account('A', 1000), account('B', 1000), account('C', 1000)],
      housing: [
        oneMonthRental({
          id: 'apt-base',
          monthlyRent: 100,
          fundingPolicies: { payment: { primaryAccountId: 'A', fallbackAccountIds: [] } }
        })
      ]
    });
    scenario.timelines = [
      timelineWith('tl-A', [
        oneMonthRental({
          id: 'apt-A',
          monthlyRent: 100,
          fundingPolicies: { payment: { primaryAccountId: 'B', fallbackAccountIds: [] } }
        })
      ]),
      timelineWith('tl-B', [
        oneMonthRental({
          id: 'apt-B',
          monthlyRent: 100,
          fundingPolicies: { payment: { primaryAccountId: 'C', fallbackAccountIds: [] } }
        })
      ])
    ];

    const base = runHousing(scenario, 1, null);
    const a = runHousing(scenario, 1, 'tl-A');
    const b = runHousing(scenario, 1, 'tl-B');

    expect(base.state.getAccountBalanceCents('A')).toBe(90_000);
    expect(base.state.getAccountBalanceCents('B')).toBe(100_000);
    expect(base.state.getAccountBalanceCents('C')).toBe(100_000);

    expect(a.state.getAccountBalanceCents('B')).toBe(90_000);
    expect(a.state.getAccountBalanceCents('A')).toBe(100_000);
    expect(a.state.getAccountBalanceCents('C')).toBe(100_000);

    expect(b.state.getAccountBalanceCents('C')).toBe(90_000);
    expect(b.state.getAccountBalanceCents('A')).toBe(100_000);
    expect(b.state.getAccountBalanceCents('B')).toBe(100_000);
  });

  it('keeps funded-only mortgage principal and PMI gating with explicit group policies', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100), account('checkingB', 0), account('checkingC', 200)],
      properties: [
        property({
          id: 'home-1',
          value: 250000,
          debtLink: 'mort-1',
          requiredDownPayment: 0,
          status: 'owned',
          appreciationRate: 0
        })
      ],
      liabilities: [
        liability({
          id: 'mort-1',
          openingBalance: 240000,
          linkedPropertyId: 'home-1',
          annualInterestRate: 0,
          endYearMonth: '2055-12'
        })
      ],
      housing: [
        housing({
          id: 'home-1',
          purchasePrice: 250000,
          downPayment: 0,
          annualInterestRate: 0,
          loanTermYears: 0,
          pmiMonthly: 150,
          fundingPolicies: {
            payment: { primaryAccountId: 'checkingA', fallbackAccountIds: ['checkingB'] },
            pmi: { primaryAccountId: 'checkingC', fallbackAccountIds: [] }
          }
        })
      ]
    });

    const run = runHousing(scenario, 1);

    const mortgagePlan = run.plans.find((plan) => plan.request.purpose === HOUSING_PURPOSES.mortgagePayment)!;
    expect(mortgagePlan.allocations.map((allocation) => allocation.accountId)).toEqual(['checkingA']);
    expect(mortgagePlan.executedCents).toBe(10_000);
    // Funded-only: the principal drops by exactly what was funded, interest retained.
    const mortgage = run.state.getLiability('mort-1')!;
    expect(mortgage.accruedInterestCents).toBe(0);
    expect(mortgage.principalCents).toBe(24_000_000 - 10_000);

    // PMI gates on actual LTV > 80% and draws its own explicit group source.
    const pmiPlan = run.plans.find((plan) => plan.request.purpose === HOUSING_PURPOSES.pmi)!;
    expect(pmiPlan.allocations.map((allocation) => allocation.accountId)).toEqual(['checkingC']);
    expect(run.state.getAccountBalanceCents('checkingC')).toBe(20_000 - 15_000);
  });

  it('uses an explicit downPayment policy and ignores the per-event legacy accountId', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100), account('checkingB', 100)],
      properties: [
        property({
          id: 'home-1',
          value: 0,
          requiredDownPayment: 100,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 100, accountId: 'checkingA' }]
        })
      ],
      housing: [
        housing({
          id: 'home-1',
          purchasePrice: 100,
          downPayment: 100,
          paymentSource: undefined,
          fundingPolicies: { downPayment: { primaryAccountId: 'checkingB', fallbackAccountIds: [] } }
        })
      ]
    });

    const run = runHousing(scenario, 3);

    // The explicit group order wins: B funds the down payment, the dated event's
    // own `accountId` (A) is not drawn.
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000);
    expect(run.state.getAccountBalanceCents('checkingB')).toBe(0);
    expect(run.state.getProperty('home-1')?.status).toBe('owned');
  });

  it('keeps an explicit null-primary downPayment unresolved and never uses the global default', () => {
    const scenario = makeScenario({
      accounts: [account('checkingA', 100), account('globalAcct', 100)],
      properties: [
        property({
          id: 'home-1',
          value: 0,
          requiredDownPayment: 100,
          status: 'pending',
          acquisitionYearMonth: '2026-01',
          fundingEvents: [{ id: 'f1', date: '2026-01-15', amount: 100, accountId: 'checkingA' }]
        })
      ],
      housing: [
        housing({
          id: 'home-1',
          purchasePrice: 100,
          downPayment: 100,
          paymentSource: undefined,
          fundingPolicies: { downPayment: { primaryAccountId: null, fallbackAccountIds: [] } }
        })
      ]
    });
    scenario.fundingPolicy = { primaryAccountId: 'globalAcct', fallbackAccountIds: [] };

    const run = runHousing(scenario, 3);
    const home = run.state.getProperty('home-1')!;

    expect(home.status).toBe('pending');
    expect(home.acquisitionDepositCents).toBe(0);
    expect(run.state.getAccountBalanceCents('checkingA')).toBe(10_000);
    expect(run.state.getAccountBalanceCents('globalAcct')).toBe(10_000);
  });
});



