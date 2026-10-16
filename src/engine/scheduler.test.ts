import { describe, expect, it, vi } from 'vitest';

import {
  EVENT_PHASES,
  createRecurrenceCursor,
  createScheduler,
  firstIndexOnOrAfter,
  nthOccurrence,
  occurrencesInWindow,
  type EventDefinition,
  type EventExecutionContext,
  type EventPhase,
  type RecurrenceSpec,
  type ScheduledEvent
} from './scheduler';
import type { CompiledCareerInterval, CompiledContextMetadata, CompiledScenarioContext } from './configuration';
import { addMonths, endOfMonthDate, formatYearMonth, parseDateOnly, toMonthOrdinal } from './dates';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const findInterval = <T extends { startOrdinal: number; endOrdinal: number }>(
  intervals: readonly T[],
  ordinal: number
): T | null => {
  let low = 0;
  let high = intervals.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const interval = intervals[mid];
    if (ordinal < interval.startOrdinal) {
      high = mid - 1;
    } else if (ordinal > interval.endOrdinal) {
      low = mid + 1;
    } else {
      return interval;
    }
  }
  return null;
};

const makeContext = (options?: {
  startDate?: string;
  endDate?: string;
  careerIntervals?: readonly CompiledCareerInterval[];
}): CompiledScenarioContext => {
  const startDate = options?.startDate ?? '2026-01-01';
  const endDate = options?.endDate ?? '2026-12-31';
  const intervals = options?.careerIntervals ?? [];
  const startYearMonth = formatYearMonth(parseDateOnly(startDate)!);
  const endYearMonth = formatYearMonth(parseDateOnly(endDate)!);
  const metadata = {
    contextId: 'test-context',
    schemaVersion: 1,
    timelineId: null,
    timelineLabel: 'Test',
    measurement: 'assetOnly',
    startDate,
    endDate,
    startYearMonth,
    endYearMonth,
    startOrdinal: toMonthOrdinal(startYearMonth),
    endOrdinal: toMonthOrdinal(endYearMonth),
    horizonMonths: toMonthOrdinal(endYearMonth) - toMonthOrdinal(startYearMonth) + 1,
    hasOpeningSnapshot: false,
    sourceSnapshotId: null
  } as CompiledContextMetadata;

  const context = {
    metadata,
    timelineId: null,
    timelineLabel: 'Test',
    opening: {},
    accounts: [],
    liabilities: [],
    properties: [],
    domains: {
      purchases: [],
      longTermPurchases: [],
      loans: [],
      creditCards: [],
      careerPlan: { enabled: false, entries: [] },
      housing: []
    },
    markers: [],
    careers: [],
    careerIntervals: intervals,
    funding: {
      global: { primaryAccountId: null, fallbackAccountIds: [], incomeFallbackAccountIds: [], orderedAccountIds: [] },
      retirement: { fallbackAccountIds: [], sources: [] },
      obligations: [],
      cardPlans: []
    },
    diagnostics: [],
    getAccount: () => undefined,
    getLiability: () => undefined,
    getProperty: () => undefined,
    getCareer: () => undefined,
    getObligationSourceOrder: () => undefined,
    getActiveCareer: (yearMonth: string) => {
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        return null;
      }
      return findInterval(intervals, toMonthOrdinal(yearMonth));
    },
    getActivePayPlan: (careerId: string, yearMonth: string) => {
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        return null;
      }
      const interval = findInterval(intervals, toMonthOrdinal(yearMonth));
      if (!interval || interval.careerId !== careerId) {
        return null;
      }
      return findInterval(interval.payPlanIntervals, toMonthOrdinal(yearMonth));
    },
    getAccountRate: () => null
  };

  return Object.freeze(context) as unknown as CompiledScenarioContext;
};

const oneTime = (startDate: string): RecurrenceSpec => ({ frequency: 'oneTime', startDate });

const makeDefinition = (
  definition: Partial<EventDefinition> & { definitionId: string; phase: EventPhase; recurrence: RecurrenceSpec }
): EventDefinition => ({
  purpose: definition.definitionId,
  priority: 0,
  resolveTarget: () => 100,
  ...definition
});

const projectEvent = (event: ScheduledEvent) => ({
  occurrenceId: event.occurrenceId,
  definitionId: event.definitionId,
  date: event.date,
  phase: event.phase,
  priority: event.priority,
  purpose: event.purpose,
  occurrenceIndex: event.occurrenceIndex
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('scheduler — stable ordering', () => {
  it('exposes the frozen phase order', () => {
    expect(EVENT_PHASES).toEqual(['accrual', 'income', 'cap', 'mandatory', 'discretionary', 'close']);
  });

  it('sorts unsorted inputs by date then phase', () => {
    const context = makeContext();
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'z-mandatory', phase: 'mandatory', recurrence: oneTime('2026-01-05') }),
      makeDefinition({ definitionId: 'a-income', phase: 'income', recurrence: oneTime('2026-01-05') }),
      makeDefinition({ definitionId: 'm-accrual', phase: 'accrual', recurrence: oneTime('2026-01-04') })
    ]);
    const events = scheduler.collect().flatMap((batch) => batch.events);
    expect(events.map((event) => `${event.date}|${event.phase}`)).toEqual([
      '2026-01-04|accrual',
      '2026-01-05|income',
      '2026-01-05|mandatory'
    ]);
  });

  it('orders equal-day events by phase, then priority, then occurrence id', () => {
    const context = makeContext();
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'b', phase: 'mandatory', priority: 5, recurrence: oneTime('2026-02-10') }),
      makeDefinition({ definitionId: 'a', phase: 'mandatory', priority: 5, recurrence: oneTime('2026-02-10') }),
      makeDefinition({ definitionId: 'early', phase: 'mandatory', priority: 1, recurrence: oneTime('2026-02-10') }),
      makeDefinition({ definitionId: 'cap', phase: 'cap', recurrence: oneTime('2026-02-10') })
    ]);
    const events = scheduler.collect().flatMap((batch) => batch.events);
    expect(events.map((event) => event.definitionId)).toEqual(['cap', 'early', 'a', 'b']);
  });

  it('deduplicates identical occurrence ids, keeping the first in sorted order', () => {
    const context = makeContext();
    const spec = oneTime('2026-03-15');
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'dup', phase: 'mandatory', recurrence: spec }),
      makeDefinition({ definitionId: 'dup', phase: 'mandatory', recurrence: spec })
    ]);
    const events = scheduler.collect().flatMap((batch) => batch.events);
    expect(events).toHaveLength(1);
    expect(events[0].occurrenceId).toBe('dup:2026-03-15');
    expect(scheduler.diagnostics.some((message) => message.includes('registered more than once'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Recurrence primitives + cursors
// ---------------------------------------------------------------------------

describe('scheduler — recurrence cursors', () => {
  it('derives monthly day-31 occurrences with inclusive clamping', () => {
    const monthly: RecurrenceSpec = { frequency: 'monthly', startDate: '2026-01-31' };
    expect(nthOccurrence(monthly, 1)).toBe('2026-01-31');
    expect(nthOccurrence(monthly, 2)).toBe('2026-02-28');
    expect(nthOccurrence(monthly, 3)).toBe('2026-03-31');
    expect(firstIndexOnOrAfter(monthly, '2026-02-01')).toBe(2);
    expect(occurrencesInWindow(monthly, '2026-02-01', '2026-03-31').map((o) => o.date)).toEqual([
      '2026-02-28',
      '2026-03-31'
    ]);
  });

  it('anchors weekly patterns on the requested weekday and steps by index', () => {
    const weekly: RecurrenceSpec = { frequency: 'weekly', startDate: '2026-01-01', weekday: 1 };
    expect(nthOccurrence(weekly, 1)).toBe('2026-01-05');
    const cursor = createRecurrenceCursor(weekly);
    expect(cursor.seek('2026-01-20')).toBe('2026-01-26');
    expect(cursor.index()).toBe(4);
    expect(cursor.advance()).toBe('2026-02-02');
    expect(cursor.advance()).toBe('2026-02-09');
    expect(cursor.index()).toBe(6);
  });

  it('handles annual and one-time patterns, including exhaustion', () => {
    const annual: RecurrenceSpec = { frequency: 'annual', startDate: '2026-02-15' };
    expect(nthOccurrence(annual, 2)).toBe('2027-02-15');
    expect(firstIndexOnOrAfter(annual, '2028-01-01')).toBe(3);

    const single = oneTime('2026-01-01');
    expect(nthOccurrence(single, 2)).toBeNull();
    expect(firstIndexOnOrAfter(single, '2026-02-01')).toBeNull();
    const cursor = createRecurrenceCursor(single);
    expect(cursor.seek('2026-01-01')).toBe('2026-01-01');
    expect(cursor.advance()).toBeNull();
    expect(cursor.done()).toBe(true);
  });

  it('honors inclusive end dates and max-occurrence caps', () => {
    const limited: RecurrenceSpec = { frequency: 'monthly', startDate: '2026-01-01', endDate: '2026-03-01' };
    expect(occurrencesInWindow(limited, '2026-01-01', '2026-12-31').map((o) => o.date)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01'
    ]);
    const capped: RecurrenceSpec = { frequency: 'monthly', startDate: '2026-01-01', maxOccurrences: 2 };
    expect(occurrencesInWindow(capped, '2026-01-01', '2026-12-31')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Month batches, clipping, weekly crossing
// ---------------------------------------------------------------------------

describe('scheduler — month batches and clipping', () => {
  it('emits weekly occurrences across month and year boundaries exactly once', () => {
    const context = makeContext({ startDate: '2026-01-01', endDate: '2026-02-28' });
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'wk', phase: 'discretionary', recurrence: { frequency: 'weekly', startDate: '2026-01-05' } })
    ]);
    const byMonth = scheduler.collect().map((batch) => [batch.yearMonth, batch.events.map((event) => event.date)]);
    expect(byMonth).toEqual([
      ['2026-01', ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']],
      ['2026-02', ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23']]
    ]);

    const yearCross = createScheduler(makeContext({ startDate: '2026-12-01', endDate: '2027-01-31' }), [
      makeDefinition({ definitionId: 'y', phase: 'discretionary', recurrence: { frequency: 'weekly', startDate: '2026-12-28' } })
    ]);
    expect(yearCross.collect().flatMap((batch) => batch.events.map((event) => event.date))).toEqual([
      '2026-12-28',
      '2027-01-04',
      '2027-01-11',
      '2027-01-18',
      '2027-01-25'
    ]);
  });

  it('clips inclusively and marks partial first/last batches', () => {
    const context = makeContext({ startDate: '2026-01-15', endDate: '2026-03-31' });
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'm31', phase: 'mandatory', recurrence: { frequency: 'monthly', startDate: '2026-01-31' } }),
      makeDefinition({ definitionId: 'edge', phase: 'mandatory', recurrence: oneTime('2026-03-31') }),
      makeDefinition({ definitionId: 'after', phase: 'mandatory', recurrence: oneTime('2026-04-01') })
    ]);
    const events = scheduler.collect().flatMap((batch) => batch.events);
    expect(events.filter((event) => event.definitionId === 'm31').map((event) => event.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31'
    ]);
    expect(events.some((event) => event.definitionId === 'edge')).toBe(true);
    expect(events.some((event) => event.definitionId === 'after')).toBe(false);

    const batches = scheduler.collect();
    expect(batches[0].partial).toBe(true);
    expect(batches[0].startDate).toBe('2026-01-15');
    expect(batches[0].endDate).toBe('2026-01-31');
  });

  it('supports a 960-month horizon with a date-only window', () => {
    const endYearMonth = addMonths('2026-01', 959); // 2105-12
    const context = makeContext({ startDate: '2026-01-01', endDate: endOfMonthDate(endYearMonth) });
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'm', phase: 'mandatory', recurrence: { frequency: 'monthly', startDate: '2026-01-15' } })
    ]);
    expect(scheduler.window.startYearMonth).toBe('2026-01');
    expect(scheduler.window.endYearMonth).toBe('2105-12');
    expect(scheduler.collect()).toHaveLength(960);
  });
});

// ---------------------------------------------------------------------------
// Invalid specs and no future funding
// ---------------------------------------------------------------------------

describe('scheduler — invalid specs and future funding', () => {
  it('skips invalid specs with diagnostics and emits nothing speculative', () => {
    const context = makeContext();
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'bad-date', phase: 'mandatory', recurrence: oneTime('not-a-date') }),
      makeDefinition({
        definitionId: 'bad-range',
        phase: 'mandatory',
        recurrence: { frequency: 'monthly', startDate: '2026-05-01', endDate: '2026-01-01' }
      }),
      makeDefinition({ definitionId: 'bad-interval', phase: 'discretionary', recurrence: { frequency: 'weekly', startDate: '2026-05-01', interval: 0 } }),
      makeDefinition({ definitionId: 'bad-phase', phase: 'nonsense' as EventPhase, recurrence: oneTime('2026-05-01') })
    ]);
    expect(scheduler.collect().flatMap((batch) => batch.events)).toHaveLength(0);
    expect(scheduler.diagnostics.length).toBeGreaterThanOrEqual(4);
  });

  it('never lets a later-dated income fund an earlier payment (date precedes phase)', () => {
    const context = makeContext();
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'card', phase: 'mandatory', recurrence: oneTime('2026-01-10') }),
      makeDefinition({ definitionId: 'payroll', phase: 'income', recurrence: oneTime('2026-01-20') })
    ]);
    const events = scheduler.collect().flatMap((batch) => batch.events);
    expect(events.map((event) => event.definitionId)).toEqual(['card', 'payroll']);

    // On the same date, income still sorts before the payment.
    const sameDay = createScheduler(context, [
      makeDefinition({ definitionId: 'card', phase: 'mandatory', recurrence: oneTime('2026-01-10') }),
      makeDefinition({ definitionId: 'payroll', phase: 'income', recurrence: oneTime('2026-01-10') })
    ]);
    expect(sameDay.collect().flatMap((batch) => batch.events).map((event) => event.definitionId)).toEqual([
      'payroll',
      'card'
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sparse seek, dynamic targets, boundaries, determinism
// ---------------------------------------------------------------------------

describe('scheduler — seek, handlers and determinism', () => {
  it('seeks a sparse far-future month directly and stays lazy', () => {
    const endYearMonth = addMonths('2026-01', 959); // 2105-12
    const context = makeContext({ startDate: '2026-01-01', endDate: endOfMonthDate(endYearMonth) });
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'm', phase: 'mandatory', recurrence: { frequency: 'monthly', startDate: '2026-01-15' } })
    ]);

    const far = scheduler.batchFor('2100-06');
    expect(far).not.toBeNull();
    expect(far!.yearMonth).toBe('2100-06');
    expect(far!.events.map((event) => event.date)).toEqual(['2100-06-15']);
    expect(scheduler.batchFor('2200-01')).toBeNull();
    expect(scheduler.batchFor('not-a-month')).toBeNull();

    const generator = scheduler.batches();
    const first = generator.next();
    expect(first.done).toBe(false);
    if (first.done) {
      throw new Error('expected a first batch');
    }
    expect(first.value.yearMonth).toBe('2026-01');
    const second = generator.next();
    expect(second.done).toBe(false);
    if (second.done) {
      throw new Error('expected a second batch');
    }
    expect(second.value.yearMonth).toBe('2026-02');
  });

  it('resolves dynamic targets at execution time, not while scheduling', () => {
    const context = makeContext();
    const resolve = vi.fn((_execution: EventExecutionContext) => 4242);
    const scheduler = createScheduler(context, [
      makeDefinition({ definitionId: 'dyn', phase: 'mandatory', recurrence: oneTime('2026-04-01'), resolveTarget: resolve })
    ]);
    const event = scheduler
      .collect()
      .flatMap((batch) => batch.events)
      .find((candidate) => candidate.definitionId === 'dyn');
    expect(event).toBeDefined();
    if (!event) {
      throw new Error('expected the dynamic event');
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(scheduler.resolveTarget(event)).toBe(4242);
    expect(resolve).toHaveBeenCalledTimes(1);
    const execution = resolve.mock.calls[0][0];
    expect(execution.date).toBe('2026-04-01');
    expect(execution.occurrenceIndex).toBe(1);
    expect(scheduler.getDefinition('dyn')).toBeDefined();
    expect(scheduler.getDefinition('missing')).toBeUndefined();
  });

  it('gates events on active career/pay-plan boundaries from context getters', () => {
    const careerIntervals: CompiledCareerInterval[] = [
      {
        careerId: 'c1',
        startYearMonth: '2026-03',
        endYearMonth: '2026-05',
        startOrdinal: toMonthOrdinal('2026-03'),
        endOrdinal: toMonthOrdinal('2026-05'),
        payPlanIntervals: [
          {
            careerId: 'c1',
            planId: null,
            startYearMonth: '2026-03',
            endYearMonth: '2026-05',
            startOrdinal: toMonthOrdinal('2026-03'),
            endOrdinal: toMonthOrdinal('2026-05'),
            annualRaiseRate: null
          }
        ]
      }
    ];
    const context = makeContext({ careerIntervals });
    const scheduler = createScheduler(context, [
      makeDefinition({
        definitionId: 'salary',
        phase: 'income',
        recurrence: { frequency: 'monthly', startDate: '2026-01-01' },
        isActive: (execution) => execution.activeCareer?.careerId === 'c1' && execution.activePayPlan !== null
      })
    ]);
    expect(scheduler.collect().flatMap((batch) => batch.events).map((event) => event.yearMonth)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05'
    ]);
    expect(scheduler.getActiveBoundaries('2026-04').activeCareer?.careerId).toBe('c1');
    expect(scheduler.getActiveBoundaries('2026-01').activeCareer).toBeNull();
  });

  it('produces deterministic output and never mutates the context', () => {
    const context = makeContext();
    const definitions = [
      makeDefinition({ definitionId: 'a', phase: 'mandatory', recurrence: { frequency: 'monthly', startDate: '2026-01-10' } }),
      makeDefinition({ definitionId: 'b', phase: 'discretionary', recurrence: { frequency: 'weekly', startDate: '2026-01-01', weekday: 5 } }),
      makeDefinition({ definitionId: 'c', phase: 'mandatory', recurrence: { frequency: 'annual', startDate: '2026-06-15' } })
    ];

    const before = JSON.stringify({ metadata: context.metadata, funding: context.funding });
    const run1 = createScheduler(context, definitions)
      .collect()
      .flatMap((batch) => batch.events)
      .map(projectEvent);
    const run2 = createScheduler(context, definitions)
      .collect()
      .flatMap((batch) => batch.events)
      .map(projectEvent);
    const after = JSON.stringify({ metadata: context.metadata, funding: context.funding });

    expect(run1).toEqual(run2);
    expect(run1.length).toBeGreaterThan(0);
    expect(after).toBe(before);
    expect(Object.isFrozen(context)).toBe(true);
  });
});
