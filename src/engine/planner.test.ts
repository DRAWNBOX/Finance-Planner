/**
 * P3S.3 — focused tests for the manual planner / recurrence adapter.
 *
 * Covers CA10: a planned one-time entry fires exactly once (its `endDate` is a
 * display span), weekly/monthly recurrences are inclusive with an inclusive
 * day-31 clamp, stable occurrence ids are namespaced, a parent recurrence never
 * double-charges its occurrences, partial funding records requested/paid/unpaid
 * with no retry, and occurred imports (older anchor or moved display date) stay
 * view-only with their original provenance untouched.
 */

import { describe, expect, it } from 'vitest';

import type { ExpenseEntry, RecurringExpenseEvent, Scenario } from '../types';
import { createDefaultScenario } from '../defaultScenario';
import { compileScenarioContext, type CompiledScenarioContext } from './configuration';
import type { EventDefinition } from './scheduler';
import { createScheduler } from './scheduler';
import { projectScenario } from './projection';
import {
  PLANNER_DEFINITION_PREFIX,
  PLANNER_HANDLER_ID,
  RECURRENCE_DEFINITION_PREFIX,
  buildPlannerEventDefinitions,
  createPlannerHandlers
} from './planner';

const CHECKING = 'checking-account-default';

/** Fresh independent default scenario anchored to an explicit observation date. */
const scenario = (): Scenario => {
  const value = createDefaultScenario(new Date(2026, 0, 1));
  value.netWorth.asOfDate = '2026-01-01';
  value.netWorth.accounts = value.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  value.careerPlan = { enabled: false, entries: [] };
  return value;
};

/** Opening balance is persisted dollars; runtime postings/assertions are cents. */
const setBalance = (target: Scenario, accountId: string, dollars: number): void => {
  target.netWorth.accounts = target.netWorth.accounts.map((account) =>
    account.id === accountId ? { ...account, openingBalance: dollars } : account
  );
};

const makeEntry = (over: Partial<ExpenseEntry> & { id: string }): ExpenseEntry => ({
  label: over.id,
  amount: 10,
  startDate: '2026-02-10',
  endDate: '2026-02-10',
  accountId: CHECKING,
  notes: '',
  originType: 'manual',
  importSourceId: null,
  importBatchId: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  provenance: 'planner',
  planningStatus: 'planned',
  ...over
});

const makeRecurring = (over: Partial<RecurringExpenseEvent> & { id: string }): RecurringExpenseEvent => ({
  label: over.id,
  amount: 10,
  accountId: CHECKING,
  paymentAccountId: CHECKING,
  categoryId: null,
  cadence: 'monthly',
  rule: 'on_date',
  startDate: '2026-01-15',
  endDate: '2026-04-30',
  enabled: true,
  provenance: 'recurrence',
  planningStatus: 'planned',
  ...over
});

const contextFor = (target: Scenario): CompiledScenarioContext =>
  compileScenarioContext(target, { timelineId: 'base' });

const occurrences = (context: CompiledScenarioContext, definitions: readonly EventDefinition[]) => {
  const scheduler = createScheduler(context, definitions);
  return scheduler
    .collect()
    .flatMap((batch) => batch.events.map((event) => ({ id: event.occurrenceId, date: event.date })));
};

const definitionIds = (definitions: readonly EventDefinition[]): string[] =>
  definitions.map((definition) => definition.definitionId);

describe('buildPlannerEventDefinitions — one-time entries', () => {
  it('fires a planned one-time entry exactly once; endDate is a display span', () => {
    const s = scenario();
    s.expenses.entries = [makeEntry({ id: 'e1', amount: 40, startDate: '2026-03-10', endDate: '2026-04-30' })];
    const context = contextFor(s);
    const definitions = buildPlannerEventDefinitions(context);

    expect(definitions).toHaveLength(1);
    expect(definitions[0].definitionId).toBe(`${PLANNER_DEFINITION_PREFIX}e1`);
    expect(definitions[0].handlerId).toBe(PLANNER_HANDLER_ID);
    expect(definitions[0].phase).toBe('mandatory');

    // Exactly one occurrence despite the wide endDate span.
    expect(occurrences(context, definitions).map((o) => o.id)).toEqual(['planner:e1:2026-03-10']);
  });

  it('omits a zero-amount or invalid-date entry', () => {
    const s = scenario();
    s.expenses.entries = [
      makeEntry({ id: 'zero', amount: 0 }),
      makeEntry({ id: 'bad-date', startDate: 'not-a-date' })
    ];
    expect(buildPlannerEventDefinitions(contextFor(s))).toHaveLength(0);
  });
});

describe('buildPlannerEventDefinitions — recurrence dates and inclusive clamp', () => {
  it('emits weekly on-date occurrences inclusive of endDate with stable ids', () => {
    const s = scenario();
    s.expenses.recurringEvents = [
      makeRecurring({ id: 'r-weekly', cadence: 'weekly', rule: 'on_date', startDate: '2026-01-02', endDate: '2026-01-23' })
    ];
    const context = contextFor(s);
    const definitions = buildPlannerEventDefinitions(context);

    expect(definitionIds(definitions)).toEqual([`${RECURRENCE_DEFINITION_PREFIX}r-weekly`]);
    expect(occurrences(context, definitions).map((o) => o.id)).toEqual([
      'recurrence:r-weekly:2026-01-02',
      'recurrence:r-weekly:2026-01-09',
      'recurrence:r-weekly:2026-01-16',
      'recurrence:r-weekly:2026-01-23'
    ]);
  });

  it('anchors every_friday to the first Friday on/after startDate', () => {
    const s = scenario();
    s.expenses.recurringEvents = [
      makeRecurring({ id: 'r-fri', cadence: 'weekly', rule: 'every_friday', startDate: '2026-01-01', endDate: '2026-01-31' })
    ];
    const context = contextFor(s);
    const definitions = buildPlannerEventDefinitions(context);
    expect(occurrences(context, definitions).map((o) => o.date)).toEqual([
      '2026-01-02',
      '2026-01-09',
      '2026-01-16',
      '2026-01-23',
      '2026-01-30'
    ]);
  });

  it('clamps a monthly day-31 target to the last valid day and stays inclusive', () => {
    const s = scenario();
    s.expenses.recurringEvents = [
      makeRecurring({
        id: 'r-31',
        cadence: 'monthly',
        rule: 'on_date',
        startDate: '2026-01-15',
        endDate: '2026-04-30',
        dayOfMonth: 31
      })
    ];
    const context = contextFor(s);
    const definitions = buildPlannerEventDefinitions(context);
    expect(occurrences(context, definitions).map((o) => o.id)).toEqual([
      'recurrence:r-31:2026-01-31',
      'recurrence:r-31:2026-02-28',
      'recurrence:r-31:2026-03-31',
      'recurrence:r-31:2026-04-30'
    ]);
  });

  it('resolves first_monday_after to the first Monday on/after the anchor each month', () => {
    const s = scenario();
    s.expenses.recurringEvents = [
      makeRecurring({
        id: 'r-mon',
        cadence: 'monthly',
        rule: 'first_monday_after',
        startDate: '2026-01-01',
        endDate: '2026-03-31'
      })
    ];
    const context = contextFor(s);
    const definitions = buildPlannerEventDefinitions(context);
    expect(occurrences(context, definitions).map((o) => o.date)).toEqual([
      '2026-01-05',
      '2026-02-02',
      '2026-03-02'
    ]);
  });

  it('never emits the recurrence parent as a second obligation (no double-charge)', () => {
    const s = scenario();
    s.expenses.recurringEvents = [
      makeRecurring({ id: 'r-dedup', cadence: 'weekly', rule: 'on_date', startDate: '2026-01-02', endDate: '2026-01-16' })
    ];
    const context = contextFor(s);
    const definitions = buildPlannerEventDefinitions(context);

    // Exactly one definition for the recurrence; no bare `recurrence:r-dedup` event.
    expect(definitions).toHaveLength(1);
    const ids = occurrences(context, definitions).map((o) => o.id);
    expect(ids).toEqual([
      'recurrence:r-dedup:2026-01-02',
      'recurrence:r-dedup:2026-01-09',
      'recurrence:r-dedup:2026-01-16'
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('omits a disabled recurring event', () => {
    const s = scenario();
    s.expenses.recurringEvents = [makeRecurring({ id: 'r-off', enabled: false })];
    expect(buildPlannerEventDefinitions(contextFor(s))).toHaveLength(0);
  });
});

describe('buildPlannerEventDefinitions — occurred imports are view-only', () => {
  it('excludes occurred imports and provenance-defaulted imports; keeps explicit planned', () => {
    const s = scenario();
    s.expenses.entries = [
      makeEntry({
        id: 'imp-occurred',
        originType: 'imported',
        provenance: 'imported',
        planningStatus: 'occurred',
        startDate: '2026-06-01',
        sourceDate: '2020-01-01',
        asOf: '2019-12-01T00:00:00.000Z'
      }),
      makeEntry({
        id: 'imp-no-status',
        originType: 'imported',
        provenance: 'imported',
        planningStatus: undefined,
        startDate: '2026-06-01'
      }),
      makeEntry({ id: 'imp-planned', originType: 'imported', provenance: 'imported', planningStatus: 'planned', startDate: '2026-06-01' }),
      makeEntry({ id: 'manual', originType: 'manual', startDate: '2026-06-01' })
    ];

    expect(definitionIds(buildPlannerEventDefinitions(contextFor(s)))).toEqual([
      'planner:imp-planned',
      'planner:manual'
    ]);
  });

  it('ignores an occurred import with an older anchor or a moved display date (no debit)', () => {
    const s = scenario();
    setBalance(s, CHECKING, 100);
    s.expenses.entries = [
      makeEntry({
        id: 'imp-old',
        originType: 'imported',
        provenance: 'imported',
        planningStatus: 'occurred',
        startDate: '2026-02-10',
        sourceDate: '2020-01-01',
        sourceSign: 'debit',
        asOf: '2019-12-01T00:00:00.000Z'
      })
    ];

    const context = contextFor(s);
    const definitions = buildPlannerEventDefinitions(context);
    expect(definitions).toHaveLength(0);

    const run = projectScenario(s, { events: definitions, handlerFactory: createPlannerHandlers });
    expect(run.plans).toHaveLength(0);
    expect(run.totals.closingCashCents).toBe(10000);
  });

  it('refuses an occurred record at execution time even if a definition leaks in', () => {
    const s = scenario();
    setBalance(s, CHECKING, 100);
    s.expenses.entries = [
      makeEntry({
        id: 'imp',
        originType: 'imported',
        provenance: 'imported',
        planningStatus: 'occurred',
        startDate: '2026-02-10'
      })
    ];

    const leaked: EventDefinition = {
      definitionId: 'planner:imp',
      phase: 'mandatory',
      purpose: 'planner',
      recurrence: { frequency: 'oneTime', startDate: '2026-02-10' },
      handlerId: PLANNER_HANDLER_ID,
      resolveTarget: () => 10000
    };

    const run = projectScenario(s, { events: [leaked], handlerFactory: createPlannerHandlers });
    expect(run.plans).toHaveLength(0);
    expect(run.totals.closingCashCents).toBe(10000);
  });
});

describe('createPlannerHandlers — funding, partial shortage and no retry', () => {
  it('debits a planned one-time entry once and records the occurrence id', () => {
    const s = scenario();
    setBalance(s, CHECKING, 100);
    s.expenses.entries = [makeEntry({ id: 'e1', amount: 40, startDate: '2026-02-10', endDate: '2026-04-30' })];

    const definitions = buildPlannerEventDefinitions(contextFor(s));
    const run = projectScenario(s, { events: definitions, handlerFactory: createPlannerHandlers });

    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].occurrenceId).toBe('planner:e1:2026-02-10');
    expect(run.plans[0].requestedCents).toBe(4000);
    expect(run.plans[0].executedCents).toBe(4000);
    expect(run.plans[0].status).toBe('funded');
    expect(run.totals.closingCashCents).toBe(6000);
  });

  it('records requested/paid/unpaid for a partial shortage without retrying', () => {
    const s = scenario();
    setBalance(s, CHECKING, 30);
    s.expenses.entries = [makeEntry({ id: 'e-big', amount: 100, startDate: '2026-02-10' })];

    const definitions = buildPlannerEventDefinitions(contextFor(s));
    const run = projectScenario(s, { events: definitions, handlerFactory: createPlannerHandlers });

    expect(run.plans).toHaveLength(1);
    const plan = run.plans[0].plan;
    expect(plan.request.requestedCents).toBe(10000);
    expect(plan.executedCents).toBe(3000);
    expect(plan.shortfallCents).toBe(7000);
    expect(plan.status).toBe('partial');
    expect(plan.allocations.map((allocation) => allocation.accountId)).toEqual([CHECKING]);
    // No arrears/retry: exactly one plan and the account is emptied once.
    expect(run.totals.closingCashCents).toBe(0);
    expect(run.monthlyCloses.filter((month) => month.executedOccurrenceIds.length > 0)).toHaveLength(1);
  });

  it('funds an income-labelled record from its own account (no income reservoir)', () => {
    const s = scenario();
    setBalance(s, CHECKING, 100);
    s.expenses.entries = [
      makeEntry({ id: 'e-income', amount: 25, fundingSource: 'income', accountId: CHECKING, startDate: '2026-02-10' })
    ];

    const definitions = buildPlannerEventDefinitions(contextFor(s));
    expect(definitions).toHaveLength(1);
    const run = projectScenario(s, { events: definitions, handlerFactory: createPlannerHandlers });

    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].executedCents).toBe(2500);
    expect(run.totals.closingCashCents).toBe(7500);
  });

  it('leaves an accountless record visibly unfunded without inventing money', () => {
    const s = scenario();
    setBalance(s, CHECKING, 100);
    s.expenses.entries = [
      makeEntry({ id: 'e-noacct', amount: 25, fundingSource: 'income', accountId: null, startDate: '2026-02-10' })
    ];

    const definitions = buildPlannerEventDefinitions(contextFor(s));
    expect(definitions).toHaveLength(1);
    const run = projectScenario(s, { events: definitions, handlerFactory: createPlannerHandlers });

    expect(run.plans).toHaveLength(0);
    expect(run.totals.closingCashCents).toBe(10000);
  });

  it('never mutates the caller scenario and preserves original provenance', () => {
    const s = scenario();
    setBalance(s, CHECKING, 100);
    s.expenses.entries = [
      makeEntry({
        id: 'imp-planned',
        originType: 'imported',
        provenance: 'imported',
        planningStatus: 'planned',
        amount: 40,
        startDate: '2026-02-10',
        sourceDate: '2021-05-05',
        sourceSign: 'debit',
        asOf: '2021-05-06T00:00:00.000Z'
      })
    ];

    const before = JSON.stringify(s);
    const context = contextFor(s);
    const definitions = buildPlannerEventDefinitions(context);
    projectScenario(s, { events: definitions, handlerFactory: createPlannerHandlers });

    expect(JSON.stringify(s)).toBe(before);
    const record = context.global.expenses.entries[0];
    expect(record.sourceDate).toBe('2021-05-05');
    expect(record.sourceSign).toBe('debit');
    expect(record.asOf).toBe('2021-05-06T00:00:00.000Z');
    expect(record.planningStatus).toBe('planned');
    expect(record.startDate).toBe('2026-02-10');
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D15 — posting journal attribution
// ---------------------------------------------------------------------------

describe('P4.1/D15 — planner posting journal attribution', () => {
  it('journals exactly one indexed posting for a committed entry, none when unfunded', () => {
    const funded = scenario();
    setBalance(funded, CHECKING, 100);
    funded.expenses.entries = [makeEntry({ id: 'e1', amount: 40, startDate: '2026-02-10' })];
    const fundedRun = projectScenario(funded, {
      events: buildPlannerEventDefinitions(contextFor(funded)),
      handlerFactory: createPlannerHandlers
    });

    expect(fundedRun.plans).toHaveLength(1);
    const rows = fundedRun.postings.filter(
      (record) => record.posting.occurrenceId === 'planner:e1:2026-02-10'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.posting.definitionId).toBe('planner:e1');
    expect(rows[0]?.posting.purpose).toBe('planner');
    expect(rows[0]?.posting.phase).toBe('mandatory');
    expect(rows[0]?.posting.date).toBe('2026-02-10');
    expect(rows[0]?.accountChanges).toEqual([{ accountId: CHECKING, deltaCents: -4000 }]);

    // An accountless positive request never commits, so it never journals.
    const unfunded = scenario();
    setBalance(unfunded, CHECKING, 100);
    unfunded.expenses.entries = [
      makeEntry({ id: 'e-noacct', amount: 25, fundingSource: 'income', accountId: null, startDate: '2026-02-10' })
    ];
    const unfundedRun = projectScenario(unfunded, {
      events: buildPlannerEventDefinitions(contextFor(unfunded)),
      handlerFactory: createPlannerHandlers
    });
    expect(unfundedRun.plans).toHaveLength(0);
    expect(unfundedRun.postings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D16 — funding outcomes for unfunded / skipped quotes
// ---------------------------------------------------------------------------

describe('P4.1/D16 — planner funding outcomes', () => {
  it('records an unfunded outcome for an accountless positive request (no plan)', () => {
    const s = scenario();
    setBalance(s, CHECKING, 100);
    s.expenses.entries = [
      makeEntry({ id: 'e-noacct', amount: 25, fundingSource: 'income', accountId: null, startDate: '2026-02-10' })
    ];
    const run = projectScenario(s, {
      events: buildPlannerEventDefinitions(contextFor(s)),
      handlerFactory: createPlannerHandlers
    });

    expect(run.plans).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.occurrenceId).toBe('planner:e-noacct:2026-02-10');
    expect(outcome.committed).toBe(false);
    expect(outcome.plan.request.requestedCents).toBe(2500);
    expect(outcome.plan.executedCents).toBe(0);
    expect(outcome.plan.status).toBe('unfunded');
  });

  it('records a committed outcome for a funded entry (real plan audit preserved)', () => {
    const s = scenario();
    setBalance(s, CHECKING, 100);
    s.expenses.entries = [makeEntry({ id: 'e1', amount: 40, startDate: '2026-02-10' })];
    const run = projectScenario(s, {
      events: buildPlannerEventDefinitions(contextFor(s)),
      handlerFactory: createPlannerHandlers
    });

    expect(run.plans).toHaveLength(1);
    expect(run.fundingOutcomes).toHaveLength(1);
    expect(run.fundingOutcomes[0]?.committed).toBe(true);
    expect(run.fundingOutcomes[0]?.plan.status).toBe('funded');
    expect(run.fundingOutcomes[0]?.plan.executedCents).toBe(4000);
  });

  it('records no outcome for an occurred record refused before quoting', () => {
    const s = scenario();
    setBalance(s, CHECKING, 100);
    s.expenses.entries = [
      makeEntry({ id: 'imp', originType: 'imported', provenance: 'imported', planningStatus: 'occurred', startDate: '2026-02-10' })
    ];
    const leaked: EventDefinition = {
      definitionId: 'planner:imp',
      phase: 'mandatory',
      purpose: 'planner',
      recurrence: { frequency: 'oneTime', startDate: '2026-02-10' },
      handlerId: PLANNER_HANDLER_ID,
      resolveTarget: () => 10000
    };
    const run = projectScenario(s, { events: [leaked], handlerFactory: createPlannerHandlers });

    expect(run.plans).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
  });
});
