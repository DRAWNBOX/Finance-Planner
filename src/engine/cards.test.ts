/**
 * P3D.1 / P3D.2 — focused tests for the headless card processor (CA06).
 *
 * Proves the two card products against the real kernel:
 *
 * - Ordinary expected payments: twelve inclusive months (`end = start + 11`), a
 *   pure expense with no debt/charges/APR.
 * - Permanent-0% payoff: `$100` over three fully funded dates is
 *   `3334/3333/3333`; the next target adapts after a partial funded payment;
 *   an early payoff stops requests; a coincident final installment + payoff is
 *   exactly one remaining-principal request; a later payoff pays only the actual
 *   outstanding principal; an observed opening (including `0`) wins over
 *   `plan.initialBalance`; unpaid principal is retained; and no duplicate
 *   principal is ever charged.
 *
 * The `drive` helper mirrors the `projectScenario` event loop over the real
 * scheduler + `createCardHandlers`, so both the requested targets and the live
 * liability principal can be asserted after execution.
 */

import { describe, expect, it } from 'vitest';

import type { OrdinaryCardSchedule, Scenario, ZeroInterestCardPlan } from '../types';
import {
  createDefaultOrdinaryCardSchedule,
  createDefaultScenario,
  createDefaultZeroInterestCardPlan
} from '../defaultScenario';
import { addTimeline, applyToActiveTimeline } from '../commands';
import { buildCardEventDefinitions, createCardHandlers, CARD_ZERO_INTEREST_PURPOSE } from './cards';
import { compileScenarioContext } from './configuration';
import type { PostingContext } from './journal';
import { projectScenario, type ProjectionHandlerDependencies } from './projection';
import { buildState } from './state';
import { createScheduler, type EventExecutionContext } from './scheduler';

const CHECKING = 'checking-account-default';
const EMERGENCY = 'emergencyFund-account-default';
const ZERO_LIABILITY = 'liab-zero';

/** Explicit posting stamp for direct test-fixture commits (never a production default). */
const CARD_TEST_POSTING: PostingContext = {
  purpose: 'test.cards',
  date: '2026-01-01',
  phase: 'income'
};

const baseScenario = (): Scenario => {
  const scenario = createDefaultScenario(new Date(2026, 0, 1));
  scenario.netWorth.asOfDate = '2026-01-01';
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.liabilities = [];
  scenario.cardPlans = [];
  scenario.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
  return scenario;
};

const setBalance = (scenario: Scenario, accountId: string, dollars: number): void => {
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) =>
    account.id === accountId ? { ...account, openingBalance: dollars } : account
  );
};

const withLiability = (scenario: Scenario, liabilityId: string, dollars: number): void => {
  scenario.liabilities = [{ id: liabilityId, kind: 'zeroInterestCard', openingBalance: dollars }];
};

const zeroPlan = (overrides: Partial<ZeroInterestCardPlan> = {}): ZeroInterestCardPlan =>
  createDefaultZeroInterestCardPlan(new Date(2026, 0, 1), {
    id: 'cp-zero',
    liabilityId: ZERO_LIABILITY,
    initialBalance: 100,
    startYearMonth: '2026-01',
    targetYearMonth: '2026-03',
    paymentDay: 1,
    funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] },
    ...overrides
  });

const ordinaryPlan = (overrides: Partial<OrdinaryCardSchedule> = {}): OrdinaryCardSchedule =>
  createDefaultOrdinaryCardSchedule(new Date(2026, 0, 1), {
    id: 'cp-ordinary',
    amount: 50,
    startYearMonth: '2026-01',
    endYearMonth: '2026-12',
    paymentDay: 1,
    funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] },
    ...overrides
  });

interface Attempt {
  occurrenceId: string;
  definitionId: string;
  yearMonth: string;
  requestedCents: number;
  executedCents: number;
}

interface DriveOptions {
  horizonMonths?: number;
  beforeBatch?: (yearMonth: string, state: ReturnType<typeof buildState>) => void;
}

const drive = (scenario: Scenario, options: DriveOptions = {}) => {
  const horizonMonths = options.horizonMonths ?? 36;
  const context = compileScenarioContext(scenario, { horizonMonths });
  const state = buildState(context.opening);
  const deps: ProjectionHandlerDependencies = {
    state,
    context,
    accounts: scenario.netWorth.accounts,
    dateOfBirth: null,
    funding: context.funding
  };
  const definitions = buildCardEventDefinitions(context);
  const scheduler = createScheduler(context, definitions);
  const handlers = new Map(createCardHandlers(deps).map((handler) => [handler.handlerId, handler]));
  const attempts: Attempt[] = [];

  for (const batch of scheduler.batches()) {
    options.beforeBatch?.(batch.yearMonth, state);
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
        activeCareer: null,
        activePayPlan: null
      };
      const target = handler.resolveTarget
        ? handler.resolveTarget(execution, deps)
        : scheduler.resolveTarget(event);
      if (!Number.isSafeInteger(target) || target <= 0) {
        continue;
      }
      const result = handler.execute({ execution, targetCents: target, deps });
      attempts.push({
        occurrenceId: event.occurrenceId,
        definitionId: event.definitionId,
        yearMonth: event.yearMonth,
        requestedCents: target,
        executedCents: result.plan?.executedCents ?? 0
      });
    }
  }

  return { state, context, deps, attempts };
};

const drain = (state: ReturnType<typeof buildState>, accountId: string): void => {
  const balance = state.getAccountBalanceCents(accountId) ?? 0;
  if (balance > 0) {
    state.commitChanges({
      revision: state.getRevision(),
      accountChanges: [{ accountId, deltaCents: -balance }],
      expectedNetWorthDeltaCents: -balance,
      posting: CARD_TEST_POSTING
    });
  }
};

const deposit = (state: ReturnType<typeof buildState>, accountId: string, cents: number): void => {
  state.commitChanges({
    revision: state.getRevision(),
    accountChanges: [{ accountId, deltaCents: cents }],
    expectedNetWorthDeltaCents: cents,
    posting: CARD_TEST_POSTING
  });
};

describe('cards — ordinary expected payments (P3D.1)', () => {
  it('schedules twelve inclusive monthly expenses and tracks no debt', () => {
    const scenario = baseScenario();
    setBalance(scenario, CHECKING, 10000);
    scenario.cardPlans = [ordinaryPlan()];

    const { attempts, state } = drive(scenario);
    const rows = attempts.filter((attempt) => attempt.definitionId === 'card:cp-ordinary');

    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.requestedCents === 5000)).toBe(true);
    expect(rows.every((row) => row.executedCents === 5000)).toBe(true);
    expect(rows[0].yearMonth).toBe('2026-01');
    expect(rows[11].yearMonth).toBe('2026-12');
    // A pure expense: no liability is created or touched.
    expect(state.getLiabilities()).toHaveLength(0);
  });

  it('defaults to end = start + 11 (twelve payments)', () => {
    const scenario = baseScenario();
    setBalance(scenario, CHECKING, 10000);
    const plan = ordinaryPlan({ startYearMonth: '2026-05', endYearMonth: undefined, amount: 25 });
    expect(plan.endYearMonth).toBe('2027-04');
    scenario.cardPlans = [plan];

    const { attempts } = drive(scenario);
    const rows = attempts.filter((attempt) => attempt.definitionId === 'card:cp-ordinary');
    expect(rows).toHaveLength(12);
    expect(rows[0].yearMonth).toBe('2026-05');
    expect(rows[11].yearMonth).toBe('2027-04');
  });
});

describe('cards — permanent-0% payoff (P3D.2)', () => {
  it('splits $100 over three fully funded dates as 3334/3333/3333', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 500);
    scenario.cardPlans = [zeroPlan()];

    const { attempts, state } = drive(scenario);
    const rows = attempts.filter((attempt) => attempt.definitionId === 'card:cp-zero');

    expect(rows.map((row) => row.requestedCents)).toEqual([3334, 3333, 3333]);
    expect(rows.map((row) => row.executedCents)).toEqual([3334, 3333, 3333]);
    expect(rows.map((row) => row.yearMonth)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(state.getLiability(ZERO_LIABILITY)?.principalCents).toBe(0);
  });

  it('uses the state liability as the sole opening debt (plan.initialBalance never duplicates)', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 500);
    // A wildly different persisted initialBalance must not be added to state debt.
    scenario.cardPlans = [zeroPlan({ initialBalance: 9999 })];

    const { attempts, state } = drive(scenario);
    const rows = attempts.filter((attempt) => attempt.definitionId === 'card:cp-zero');
    expect(rows.map((row) => row.requestedCents)).toEqual([3334, 3333, 3333]);
    expect(state.getLiability(ZERO_LIABILITY)?.principalCents).toBe(0);
  });

  it('recalculates the next target after a partial funded payment and retains unpaid principal', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 20);
    scenario.cardPlans = [zeroPlan()];

    const { attempts, state } = drive(scenario);
    const rows = attempts.filter((attempt) => attempt.definitionId === 'card:cp-zero');

    // $20 funds only part of the first $33.34 target; the remaining principal is
    // re-split over the two remaining dates, then the final date sweeps the rest.
    expect(rows.map((row) => row.requestedCents)).toEqual([3334, 4000, 8000]);
    expect(rows.map((row) => row.executedCents)).toEqual([2000, 0, 0]);
    expect(state.getLiability(ZERO_LIABILITY)?.principalCents).toBe(8000);
  });

  it('stops requesting after an early explicit payoff date', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 500);
    scenario.cardPlans = [zeroPlan({ payoffYearMonth: '2026-02' })];

    const { attempts, state } = drive(scenario);
    const rows = attempts.filter((attempt) => attempt.definitionId.startsWith('card:cp-zero'));

    // Jan installment, Feb payoff clears the rest; Feb/Mar installments no-op.
    expect(rows.map((row) => `${row.definitionId}@${row.yearMonth}`)).toEqual([
      'card:cp-zero@2026-01',
      'card:cp-zero:payoff@2026-02'
    ]);
    expect(rows.map((row) => row.requestedCents)).toEqual([3334, 6666]);
    expect(state.getLiability(ZERO_LIABILITY)?.principalCents).toBe(0);
  });

  it('issues exactly one remaining-principal request when payoff coincides with the final installment', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 500);
    scenario.cardPlans = [zeroPlan({ payoffYearMonth: '2026-03' })];

    const { attempts, state } = drive(scenario);
    const rows = attempts.filter((attempt) => attempt.definitionId.startsWith('card:cp-zero'));

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.requestedCents)).toEqual([3334, 3333, 3333]);
    expect(rows.some((row) => row.definitionId === 'card:cp-zero:payoff')).toBe(false);
    expect(rows.reduce((sum, row) => sum + row.executedCents, 0)).toBe(10000);
    expect(state.getLiability(ZERO_LIABILITY)?.principalCents).toBe(0);
  });

  it('a later payoff collects only the principal still outstanding (retained until funded)', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 10000);
    scenario.cardPlans = [zeroPlan({ payoffYearMonth: '2026-05' })];

    const principalAtPayoff: number[] = [];
    const { attempts, state } = drive(scenario, {
      beforeBatch: (yearMonth, liveState) => {
        if (yearMonth === '2026-03') {
          // Unfund the final scheduled installment so principal is retained.
          drain(liveState, CHECKING);
        }
        if (yearMonth === '2026-05') {
          principalAtPayoff.push(liveState.getLiability(ZERO_LIABILITY)?.principalCents ?? 0);
          deposit(liveState, CHECKING, 5000);
        }
      }
    });
    const rows = attempts.filter((attempt) => attempt.definitionId.startsWith('card:cp-zero'));

    expect(
      rows.map((row) => `${row.definitionId}@${row.yearMonth}:${row.requestedCents}/${row.executedCents}`)
    ).toEqual([
      'card:cp-zero@2026-01:3334/3334',
      'card:cp-zero@2026-02:3333/3333',
      'card:cp-zero@2026-03:3333/0',
      'card:cp-zero:payoff@2026-05:3333/3333'
    ]);
    expect(principalAtPayoff).toEqual([3333]);
    expect(state.getLiability(ZERO_LIABILITY)?.principalCents).toBe(0);
  });

  it('lets an observed zero opening win over plan.initialBalance (no duplicate debt)', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      measurement: 'assetOnly',
      accounts: [],
      liabilities: [{ liabilityId: ZERO_LIABILITY, balance: 0 }]
    };
    setBalance(scenario, CHECKING, 500);
    scenario.cardPlans = [zeroPlan({ initialBalance: 100 })];

    const { attempts, state } = drive(scenario);
    expect(state.getLiability(ZERO_LIABILITY)?.principalCents).toBe(0);
    expect(attempts.filter((attempt) => attempt.definitionId.startsWith('card:cp-zero'))).toHaveLength(0);
  });
});

describe('cards — handler seam', () => {
  it('definitions route to the handlers emitted by createCardHandlers', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 500);
    scenario.cardPlans = [ordinaryPlan(), zeroPlan()];

    const context = compileScenarioContext(scenario, { horizonMonths: 36 });
    const state = buildState(context.opening);
    const deps: ProjectionHandlerDependencies = {
      state,
      context,
      accounts: scenario.netWorth.accounts,
      dateOfBirth: null,
      funding: context.funding
    };
    const handlerIds = new Set(createCardHandlers(deps).map((handler) => handler.handlerId));
    const definitionHandlerIds = buildCardEventDefinitions(context)
      .map((definition) => definition.handlerId)
      .filter((id): id is string => typeof id === 'string');

    expect(definitionHandlerIds.length).toBeGreaterThan(0);
    expect(definitionHandlerIds.every((id) => handlerIds.has(id))).toBe(true);
    expect(handlerIds.has('card:cp-ordinary:expected')).toBe(true);
    expect(handlerIds.has('card:cp-zero:installment')).toBe(true);
    expect(handlerIds.has('card:cp-zero:payoff')).toBe(true);
  });

  it('composes with the projectScenario facade', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 500);
    scenario.cardPlans = [zeroPlan()];

    const context = compileScenarioContext(scenario, { horizonMonths: 6 });
    const run = projectScenario(scenario, {
      horizonMonths: 6,
      events: buildCardEventDefinitions(context),
      handlerFactory: createCardHandlers
    });

    const rows = run.plans.filter((plan) => plan.definitionId === 'card:cp-zero');
    expect(rows.map((plan) => plan.requestedCents)).toEqual([3334, 3333, 3333]);
    expect(rows.map((plan) => plan.executedCents)).toEqual([3334, 3333, 3333]);
    expect(run.totals.executedNetCents).toBe(10000);
  });
});

describe('cards — audit attribution (P4.1 / D15)', () => {
  it('writes exactly one posting per committed 0% installment, tagged from the occurrence', () => {
    const scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 500);
    scenario.cardPlans = [zeroPlan()];

    const { state, attempts } = drive(scenario);
    const rows = attempts.filter((attempt) => attempt.definitionId === 'card:cp-zero');
    expect(rows.map((row) => row.executedCents)).toEqual([3334, 3333, 3333]);

    // Exactly one posting per committed event — never re-stamped, never doubled.
    expect(state.getPostings()).toHaveLength(3);
    for (const row of rows) {
      const byOccurrence = state.getPostingsByOccurrence(row.occurrenceId);
      expect(byOccurrence).toHaveLength(1);
      expect(byOccurrence[0]?.posting.definitionId).toBe('card:cp-zero');
      expect(byOccurrence[0]?.posting.purpose).toBe(CARD_ZERO_INTEREST_PURPOSE);
      expect(byOccurrence[0]?.posting.phase).toBe('mandatory');
      expect(byOccurrence[0]?.posting.date).toBe(`${row.yearMonth}-01`);
    }

    // Stable append-only indexes by definition, touched account and month.
    expect(state.getPostingsByDefinition('card:cp-zero')).toHaveLength(3);
    expect(state.getPostingsByAccount(CHECKING)).toHaveLength(3);
    expect(state.getPostingsByMonth('2026-01')).toHaveLength(1);
    expect(state.getPostingsByMonth('2026-02')).toHaveLength(1);

    // The touched liability delta records the actual (executed) principal reduction.
    const january = state.getPostingsByMonth('2026-01')[0];
    expect(january?.accountChanges).toEqual([{ accountId: CHECKING, deltaCents: -3334 }]);
    expect(january?.liabilityChanges).toEqual([
      { liabilityId: ZERO_LIABILITY, principalDeltaCents: -3334 }
    ]);
  });

  it('keeps the gross = net + tax + penalty funding identity and links the posting to it', () => {
    const scenario = baseScenario();
    setBalance(scenario, CHECKING, 10000);
    scenario.cardPlans = [ordinaryPlan({ amount: 50 })];

    const context = compileScenarioContext(scenario, { horizonMonths: 1 });
    const run = projectScenario(scenario, {
      horizonMonths: 1,
      events: buildCardEventDefinitions(context),
      handlerFactory: createCardHandlers
    });

    const plan = run.plans.find((row) => row.definitionId === 'card:cp-ordinary');
    expect(plan).toBeTruthy();
    const gross = plan?.grossDebitCents ?? 0;
    const net = plan?.executedCents ?? 0;
    const tax = plan?.taxCents ?? 0;
    const penalty = plan?.penaltyCents ?? 0;
    // The funding identity is untouched by audit attribution.
    expect(gross).toBe(net + tax + penalty);

    // ...and the committed plan produced exactly one posting whose debit is its gross.
    const postings = run.postings.filter((record) => record.posting.definitionId === 'card:cp-ordinary');
    expect(postings).toHaveLength(1);
    const debited = (postings[0]?.accountChanges ?? []).reduce((sum, change) => sum + change.deltaCents, 0);
    expect(debited).toBe(-gross);
  });

  it('records no posting for a zero target, a cleared principal, or an unfunded source', () => {
    // Observed zero opening: live principal 0 → no target, no posting.
    const cleared = baseScenario();
    withLiability(cleared, ZERO_LIABILITY, 100);
    cleared.netWorth.openingSnapshot = {
      date: '2026-01-01',
      measurement: 'assetOnly',
      accounts: [],
      liabilities: [{ liabilityId: ZERO_LIABILITY, balance: 0 }]
    };
    setBalance(cleared, CHECKING, 500);
    cleared.cardPlans = [zeroPlan({ initialBalance: 100 })];
    const clearedRun = drive(cleared);
    expect(clearedRun.attempts).toHaveLength(0);
    expect(clearedRun.state.getPostings()).toHaveLength(0);
    expect(clearedRun.state.getRevision()).toBe(0);

    // Nonempty debt but an empty source: every payment is zero-fund → no posting.
    const unfunded = baseScenario();
    withLiability(unfunded, ZERO_LIABILITY, 100);
    setBalance(unfunded, CHECKING, 0);
    unfunded.cardPlans = [zeroPlan()];
    const unfundedRun = drive(unfunded);
    expect(unfundedRun.state.getPostings()).toHaveLength(0);
    expect(unfundedRun.state.getRevision()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D16 — funding outcomes for unfunded card quotes
// ---------------------------------------------------------------------------

describe('cards — D16 funding outcomes (P4.1)', () => {
  const oneMonthCardRun = (scenario: Scenario) => {
    const context = compileScenarioContext(scenario, { horizonMonths: 1 });
    return projectScenario(scenario, {
      horizonMonths: 1,
      events: buildCardEventDefinitions(context),
      handlerFactory: createCardHandlers
    });
  };

  it('records an unfunded/empty-evidence outcome for an accountless positive card (no plan, no posting)', () => {
    const scenario = baseScenario();
    scenario.fundingPolicy = { primaryAccountId: null, fallbackAccountIds: [] };
    scenario.cardPlans = [
      ordinaryPlan({
        amount: 50,
        startYearMonth: '2026-01',
        endYearMonth: '2026-01',
        funding: { primaryAccountId: null, fallbackAccountIds: [] }
      })
    ];

    const run = oneMonthCardRun(scenario);

    // The obligation is recorded as an unfunded quote outcome with no eligible
    // source — never an audit row and never a posting.
    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.totals.executedPlanCount).toBe(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.committed).toBe(false);
    expect(outcome.definitionId).toBe('card:cp-ordinary');
    expect(outcome.plan.request.requestedCents).toBe(5000);
    expect(outcome.plan.executedCents).toBe(0);
    expect(outcome.plan.shortfallCents).toBe(5000);
    expect(outcome.plan.status).toBe('unfunded');
    expect(outcome.eligibleSources).toEqual([]);
    expect(outcome.skippedSources).toEqual([]);
  });

  it('records eligible-source evidence and a zero-balance skip for a zero-fund card', () => {
    const scenario = baseScenario();
    scenario.cardPlans = [
      ordinaryPlan({ amount: 50, startYearMonth: '2026-01', endYearMonth: '2026-01' })
    ];

    const run = oneMonthCardRun(scenario);

    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.committed).toBe(false);
    expect(outcome.plan.shortfallCents).toBe(5000);
    expect(outcome.plan.status).toBe('unfunded');
    // The named source passed policy eligibility (so it is reported), but held
    // no funds: the zero-balance skip is the evidence, not a policy skip.
    expect(outcome.eligibleSources).toEqual([{ accountId: CHECKING, balanceCents: 0 }]);
    expect(outcome.skippedSources.map((skip) => skip.reason)).toContain('zero-balance');
  });

  it('records exactly one partial outcome when a fallback source funds part of a card', () => {
    const scenario = baseScenario();
    setBalance(scenario, EMERGENCY, 20);
    scenario.cardPlans = [
      ordinaryPlan({
        amount: 50,
        startYearMonth: '2026-01',
        endYearMonth: '2026-01',
        funding: { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY] }
      })
    ];

    const run = oneMonthCardRun(scenario);

    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.committed).toBe(true);
    expect(outcome.plan.status).toBe('partial');
    expect(outcome.plan.request.requestedCents).toBe(5000);
    expect(outcome.plan.executedCents).toBe(2000);
    expect(outcome.plan.shortfallCents).toBe(3000);
    expect(outcome.eligibleSources.map((source) => source.accountId)).toEqual([CHECKING, EMERGENCY]);
    expect(run.plans).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// P5 / v4 — card plans are timeline-local (context.domains.cardPlans)
// ---------------------------------------------------------------------------

describe('cards — timeline-local card plans (P5 / v4)', () => {
  it('builds definitions from the selected timeline domains, never the global config', () => {
    let scenario = baseScenario();
    setBalance(scenario, CHECKING, 10000);
    scenario.cardPlans = [ordinaryPlan({ id: 'card-base', startYearMonth: '2026-01', endYearMonth: '2026-12' })];

    scenario = addTimeline(scenario, { id: 'tl-a', label: 'Timeline A' });
    scenario = applyToActiveTimeline(scenario, (data) => ({
      ...data,
      cardPlans: [ordinaryPlan({ id: 'card-tl', startYearMonth: '2026-01', endYearMonth: '2026-12' })]
    }));

    const baseContext = compileScenarioContext(scenario, { timelineId: 'base', horizonMonths: 1 });
    expect(baseContext.domains.cardPlans.map((plan) => plan.id)).toEqual(['card-base']);
    expect(buildCardEventDefinitions(baseContext).map((definition) => definition.definitionId)).toEqual([
      'card:card-base'
    ]);

    const tlContext = compileScenarioContext(scenario, { timelineId: 'tl-a', horizonMonths: 1 });
    expect(tlContext.domains.cardPlans.map((plan) => plan.id)).toEqual(['card-tl']);
    expect(buildCardEventDefinitions(tlContext).map((definition) => definition.definitionId)).toEqual([
      'card:card-tl'
    ]);
  });

  it('switches card plans wholesale so a base 0% plan never touches another timeline', () => {
    let scenario = baseScenario();
    withLiability(scenario, ZERO_LIABILITY, 100);
    setBalance(scenario, CHECKING, 500);
    scenario.cardPlans = [zeroPlan()];

    scenario = addTimeline(scenario, { id: 'tl-b', label: 'Timeline B' });
    scenario = applyToActiveTimeline(scenario, (data) => ({
      ...data,
      // A distinct ordinary plan; the base 0% plan must not leak into timeline B.
      cardPlans: [
        ordinaryPlan({ id: 'card-b', amount: 50, startYearMonth: '2026-01', endYearMonth: '2026-01' })
      ]
    }));

    // Active timeline B: only its own ordinary plan executes.
    const { attempts, state } = drive(scenario, { horizonMonths: 1 });
    expect(attempts.map((attempt) => attempt.definitionId)).toEqual(['card:card-b']);
    expect(attempts[0].executedCents).toBe(5000);
    // The base 0% liability's opening debt is never touched by timeline B
    // (no definition referenced it, so nothing was re-simulated or duplicated).
    expect(state.getLiability(ZERO_LIABILITY)?.principalCents).toBe(10000);

    // Explicitly compiling the base timeline still sees only the base 0% plan.
    const baseContext = compileScenarioContext(scenario, { timelineId: 'base', horizonMonths: 1 });
    expect(buildCardEventDefinitions(baseContext).map((definition) => definition.definitionId)).toEqual([
      'card:cp-zero',
      'card:cp-zero:payoff'
    ]);
  });
});
