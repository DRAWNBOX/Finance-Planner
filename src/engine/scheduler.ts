/**
 * P2.6 — Month-batched scheduler and handler interfaces (K, engine-internal, pure).
 *
 * The scheduler turns immutable configuration + dated recurrence rules into a
 * **lazy, chronological stream of month batches** whose events are already in the
 * frozen same-date execution order. It is a *scheduling* owner only:
 *
 * - It **never mutates state** and never touches a ledger. Balances change only
 *   through the state owner's sole `commitChanges` route (P2.2); the scheduler
 *   merely emits dated event descriptors and execution-time target resolvers.
 * - It does **not eagerly expand the whole horizon**. `batches()` is a generator
 *   that materializes exactly one month at a time, and `batchFor(yearMonth)` can
 *   seek directly to a sparse far-future month in O(1) recurrence math instead of
 *   walking 960 months.
 * - It does **not clone the ledger per event** (it holds no ledger at all), and
 *   it never speculatively funds a date with money that arrives later.
 *
 * ### Event phases and same-date order (P0.3.2 / RV23)
 *
 * Events sort by **date → phase → configured priority → stable occurrence ID**:
 *
 * 1. `accrual` — contractual debt-interest accrual + acquisition/disposition prep.
 * 2. `income` — payroll/other direct income.
 * 3. `cap` — explicit cap policy.
 * 4. `mandatory` — loan/mortgage, rent/housing groups, cards, recurring living,
 *    retirement spending.
 * 5. `discretionary` — planned purchases / extra debt payment.
 * 6. `close` — month-close valuation, then closing snapshot.
 *
 * Because date precedes phase, an income posting dated *after* a payment in the
 * same month sorts *after* it, so no future deposit can fund an earlier request.
 *
 * ### Dates, clipping and day-31 (P2.1)
 *
 * Everything here is date-only (no wall clock, no `Date`). A schedule window is
 * an **inclusive** date range; month batches are clipped to it, so the first and
 * last batches may be partial. A monthly/annual day-31 target **clamps** to the
 * last valid day of a short month (it does not disappear, and it is not skipped).
 *
 * ### Recurrence cursors
 *
 * {@link createRecurrenceCursor} drives one-time / monthly / weekly / annual
 * patterns. `seek(from)` positions at the first occurrence on/after a date using
 * bounded arithmetic; `advance()` steps to the next. Occurrence `k` (1-based) is
 * derived arithmetically, so a far-future month is reachable directly.
 *
 * ### Handler interfaces (Phase 3)
 *
 * {@link SchedulerEventHandler} is the processor contract consumed by Phase 3:
 * it resolves a **dynamic, execution-time** net target in integer cents (never a
 * value cached during scheduling) and optionally executes by posting through the
 * state owner. {@link EventTargetResolver} is the same idea on the definition.
 *
 * Authority: `refactor/phase2_plan.md` P2.6, `refactor/frozen_contracts.md`
 * P0.3.2 (phases/same-date order), P0.3.4 (cents), P0.3.5 (safe limits),
 * P0.7.1 (960 full months), `refactor/architecture_specification.md` §7
 * (scheduling order, day-31 clamp, no future funding), and the settled P2.1
 * `src/engine/dates.ts` + P2.5 `src/engine/configuration.ts`.
 */

import type { CompiledCareerInterval, CompiledPayPlanInterval, CompiledScenarioContext } from './configuration';
import type { Cents } from './money';
import {
  addDays,
  addMonths,
  addMonthsToDate,
  compareDateOnly,
  diffDays,
  diffMonths,
  endOfMonthDate,
  formatDateOnly,
  formatYearMonth,
  fromDayOrdinal,
  fromMonthOrdinal,
  isValidDateOnly,
  isValidYearMonth,
  parseDateOnly,
  parseYearMonth,
  toDayOrdinal,
  toMonthOrdinal,
  daysInMonth,
  type DateOnly,
  type MonthOrdinal,
  type YearMonth
} from './dates';

// ---------------------------------------------------------------------------
// Event phases
// ---------------------------------------------------------------------------

/** The six frozen same-date execution phases, in contractual order (P0.3.2). */
export const EVENT_PHASES = ['accrual', 'income', 'cap', 'mandatory', 'discretionary', 'close'] as const;

export type EventPhase = (typeof EVENT_PHASES)[number];

/** Numeric rank for a phase; lower runs earlier on the same date. */
export const EVENT_PHASE_RANK: Readonly<Record<EventPhase, number>> = Object.freeze(
  EVENT_PHASES.reduce<Record<EventPhase, number>>((acc, phase, index) => {
    acc[phase] = index;
    return acc;
  }, {} as Record<EventPhase, number>)
);

const isEventPhase = (value: unknown): value is EventPhase =>
  typeof value === 'string' && (EVENT_PHASES as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

/** Supported recurrence frequencies. */
export const RECURRENCE_FREQUENCIES = ['oneTime', 'monthly', 'weekly', 'annual'] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/**
 * A dated recurrence rule. `startDate` is the first occurrence anchor; `interval`
 * steps the pattern (weeks for `weekly`, months for `monthly`, years for
 * `annual`); `endDate` is an **inclusive** last date. For `monthly`/`annual`,
 * `dayOfMonth`/`monthOfYear` override the day/month taken from `startDate`. For
 * `weekly`, `weekday` (0 = Sunday … 6 = Saturday) anchors occurrences to that day.
 *
 * Day-31 (and Feb-29) targets clamp to the last valid day of a short month.
 */
export interface RecurrenceSpec {
  readonly frequency: RecurrenceFrequency;
  readonly startDate: DateOnly;
  readonly endDate?: DateOnly | null;
  readonly dayOfMonth?: number | null;
  readonly monthOfYear?: number | null;
  readonly weekday?: number | null;
  readonly interval?: number | null;
  readonly maxOccurrences?: number | null;
}

// ---------------------------------------------------------------------------
// Execution-time context and handler interfaces
// ---------------------------------------------------------------------------

/** Pure scheduling metadata for one occurrence. Contains no resolved target. */
export interface ScheduledEvent {
  /** Stable identity: `${definitionId}:${date}`, the dedup/execution key. */
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly date: DateOnly;
  readonly yearMonth: YearMonth;
  readonly phase: EventPhase;
  readonly priority: number;
  readonly purpose: string;
  /** 1-based occurrence index within its recurrence (resets on a new plan). */
  readonly occurrenceIndex: number;
  readonly handlerId?: string;
}

/**
 * Context handed to a target resolver **at execution time**. The target is a
 * function of the then-current world (state, debt, balances), so it is computed
 * when the event executes — never cached while scheduling.
 */
export interface EventExecutionContext {
  readonly context: CompiledScenarioContext;
  readonly event: ScheduledEvent;
  readonly yearMonth: YearMonth;
  readonly date: DateOnly;
  readonly occurrenceIndex: number;
  /** Active career interval for the event's month (context getter), else `null`. */
  readonly activeCareer: CompiledCareerInterval | null;
  /** Active pay-plan interval for the active career/month, else `null`. */
  readonly activePayPlan: CompiledPayPlanInterval | null;
}

/** Resolves the requested net target for an occurrence, in integer cents. */
export type EventTargetResolver = (execution: EventExecutionContext) => Cents;

/** Optional gate evaluated over the execution context; `false` suppresses an event. */
export type EventActivePredicate = (execution: EventExecutionContext) => boolean;

/**
 * Phase-3 processor contract. A handler owns one phase and, per event, resolves a
 * **dynamic execution-time** target. `execute` (optional) posts through the state
 * owner; the scheduler never calls it and never mutates state itself.
 */
export interface SchedulerEventHandler {
  readonly handlerId: string;
  readonly phase: EventPhase;
  /** Dynamic net target in integer cents; recomputed for every execution. */
  resolveTarget(execution: EventExecutionContext): Cents;
  /**
   * Optional Phase-3 execution hook. Implementations MUST post through the state
   * owner's sole `commitChanges`; they must never mutate scheduler input.
   */
  execute?(execution: EventExecutionContext, targetCents: Cents): void;
}

/**
 * A schedulable event source. `resolveTarget` is execution-time dynamic (see
 * {@link EventTargetResolver}); `isActive` (optional) gates months using the
 * active career/pay-plan boundaries exposed by the compiled context.
 */
export interface EventDefinition {
  readonly definitionId: string;
  readonly phase: EventPhase;
  readonly purpose: string;
  readonly priority?: number;
  readonly recurrence: RecurrenceSpec;
  /** Execution-time target resolver (dynamic; never evaluated while scheduling). */
  readonly resolveTarget: EventTargetResolver;
  /** Optional active-boundary gate (career/pay-plan/marker awareness). */
  readonly isActive?: EventActivePredicate;
  /** Link to the Phase-3 handler that consumes this definition's events. */
  readonly handlerId?: string;
}

// ---------------------------------------------------------------------------
// Month batches and windows
// ---------------------------------------------------------------------------

/** Inclusive date-only schedule window. Omitted bounds fall back to the context. */
export interface ScheduleWindow {
  readonly startDate?: DateOnly;
  readonly endDate?: DateOnly | null;
}

/** A resolved (clipped) schedule window with month ordinals. */
export interface ResolvedScheduleWindow {
  readonly startDate: DateOnly;
  readonly endDate: DateOnly;
  readonly startYearMonth: YearMonth;
  readonly endYearMonth: YearMonth;
  readonly startOrdinal: MonthOrdinal;
  readonly endOrdinal: MonthOrdinal;
}

/** One lazily-materialized month of ordered events. */
export interface MonthBatch {
  /** 0-based index within the batched window. */
  readonly index: number;
  readonly yearMonth: YearMonth;
  readonly ordinal: MonthOrdinal;
  /** Clipped batch start (== month start unless the window clips it). */
  readonly startDate: DateOnly;
  /** Clipped batch end (== month end unless the window clips it). */
  readonly endDate: DateOnly;
  /** `true` when the batch is partial at a window edge. */
  readonly partial: boolean;
  readonly activeCareer: CompiledCareerInterval | null;
  readonly activePayPlan: CompiledPayPlanInterval | null;
  readonly events: readonly ScheduledEvent[];
}

// ---------------------------------------------------------------------------
// Occurrence math
// ---------------------------------------------------------------------------

const MAX_ADJUST_STEPS = 4096;
const MAX_OCCURRENCES_PER_SCAN = 1_000_000;
const DEFAULT_INTERVAL = 1;
const DEFAULT_PRIORITY = 0;

const parseYearMonthOrThrow = (value: string): { year: number; month: number } => {
  const parsed = parseYearMonth(value);
  if (!parsed) {
    throw new RangeError(`Scheduler expected a valid YYYY-MM value; received "${value}".`);
  }
  return parsed;
};

/** Clamps `day` into `yearMonth`, returning a valid date-only value. */
const clampToMonth = (yearMonth: YearMonth, day: number): DateOnly => {
  const parsed = parseYearMonthOrThrow(yearMonth);
  const clamped = Math.min(Math.max(1, Math.floor(day)), daysInMonth(parsed.year, parsed.month));
  return formatDateOnly({ year: parsed.year, month: parsed.month, day: clamped });
};

/** Weekday for a day ordinal (0 = Sunday … 6 = Saturday); 1970-01-01 was Thursday. */
const weekdayOfOrdinal = (ordinal: number): number => ((ordinal + 4) % 7 + 7) % 7;

const weeklyAnchor = (
  spec: RecurrenceSpec,
  startOrdinal: number
): DateOnly => {
  if (spec.weekday === undefined || spec.weekday === null) {
    return spec.startDate;
  }
  const delta = (spec.weekday - weekdayOfOrdinal(startOrdinal) + 7) % 7;
  return fromDayOrdinal(startOrdinal + delta);
};

/** A computed occurrence: its date-only value plus 1-based recurrence index. */
export interface RecurrenceOccurrence {
  readonly date: DateOnly;
  readonly index: number;
}

/**
 * The date of occurrence `index` (1-based) for `spec`, ignoring end/max bounds.
 * Returns `null` for a non-positive index or a one-time pattern beyond its single
 * occurrence. Day-31/Feb-29 targets clamp via {@link addMonthsToDate}.
 */
export const nthOccurrence = (spec: RecurrenceSpec, index: number): DateOnly | null => {
  if (!Number.isSafeInteger(index) || index < 1) {
    return null;
  }
  const start = parseDateOnly(spec.startDate);
  if (!start) {
    return null;
  }
  const interval = spec.interval ?? DEFAULT_INTERVAL;
  switch (spec.frequency) {
    case 'oneTime':
      return index === 1 ? spec.startDate : null;
    case 'weekly': {
      const anchor = weeklyAnchor(spec, toDayOrdinal(spec.startDate));
      return addDays(anchor, (index - 1) * 7 * interval);
    }
    case 'monthly': {
      const baseYearMonth = formatYearMonth(start);
      const targetYearMonth = addMonths(baseYearMonth, (index - 1) * interval);
      return clampToMonth(targetYearMonth, spec.dayOfMonth ?? start.day);
    }
    case 'annual': {
      const years = (index - 1) * interval;
      if (spec.monthOfYear !== undefined && spec.monthOfYear !== null) {
        const year = start.year + years;
        return clampToMonth(formatYearMonth({ year, month: spec.monthOfYear }), spec.dayOfMonth ?? start.day);
      }
      return addMonthsToDate(spec.startDate, years * 12);
    }
    default:
      return null;
  }
};

/** `true` when occurrence `index` at `date` satisfies the end/max bound. */
const withinPatternEnd = (spec: RecurrenceSpec, index: number, date: DateOnly): boolean => {
  if (spec.maxOccurrences !== undefined && spec.maxOccurrences !== null && index > spec.maxOccurrences) {
    return false;
  }
  if (spec.endDate !== undefined && spec.endDate !== null && compareDateOnly(date, spec.endDate) > 0) {
    return false;
  }
  return true;
};

/**
 * The 1-based index of the first occurrence on/after `from`, or `null` when none
 * exists within the pattern's end bound. Uses a bounded estimate plus a small
 * linear correction, so a far-future `from` is reached without walking history.
 */
export const firstIndexOnOrAfter = (spec: RecurrenceSpec, from: DateOnly): number | null => {
  const start = parseDateOnly(spec.startDate);
  const fromParsed = parseDateOnly(from);
  if (!start || !fromParsed) {
    return null;
  }
  if (spec.frequency === 'oneTime') {
    const index = compareDateOnly(spec.startDate, from) >= 0 ? 1 : null;
    if (index === null) {
      return null;
    }
    return withinPatternEnd(spec, index, spec.startDate) ? index : null;
  }

  const interval = spec.interval ?? DEFAULT_INTERVAL;
  let index: number;
  switch (spec.frequency) {
    case 'weekly': {
      const anchor = weeklyAnchor(spec, toDayOrdinal(spec.startDate));
      const days = diffDays(anchor, from);
      index = days <= 0 ? 1 : Math.floor(days / (7 * interval)) + 1;
      break;
    }
    case 'monthly': {
      const monthDiff = diffMonths(formatYearMonth(start), formatYearMonth(fromParsed));
      index = monthDiff <= 0 ? 1 : Math.floor(monthDiff / interval) + 1;
      break;
    }
    case 'annual': {
      const monthDiff = diffMonths(formatYearMonth(start), formatYearMonth(fromParsed));
      index = monthDiff <= 0 ? 1 : Math.floor(monthDiff / (12 * interval)) + 1;
      break;
    }
    default:
      return null;
  }

  index = Math.max(1, index);

  // Walk forward to the first occurrence on/after `from`.
  let steps = 0;
  let candidate = nthOccurrence(spec, index);
  while (candidate !== null && compareDateOnly(candidate, from) < 0) {
    index += 1;
    if (++steps > MAX_ADJUST_STEPS) {
      return null;
    }
    candidate = nthOccurrence(spec, index);
  }
  if (candidate === null) {
    return null;
  }

  // Pull back if a previous occurrence also satisfies the bound (clamp edge).
  steps = 0;
  while (index > 1) {
    const previous = nthOccurrence(spec, index - 1);
    if (previous === null || compareDateOnly(previous, from) < 0) {
      break;
    }
    index -= 1;
    if (++steps > MAX_ADJUST_STEPS) {
      break;
    }
  }

  const date = nthOccurrence(spec, index);
  if (date === null || !withinPatternEnd(spec, index, date)) {
    return null;
  }
  return index;
};

/** All occurrences of `spec` whose date-only value lies in `[from, to]`. */
export const occurrencesInWindow = (spec: RecurrenceSpec, from: DateOnly, to: DateOnly): RecurrenceOccurrence[] => {
  const out: RecurrenceOccurrence[] = [];
  if (compareDateOnly(from, to) > 0) {
    return out;
  }
  const cursor = createRecurrenceCursor(spec);
  let date = cursor.seek(from);
  let guard = 0;
  while (date !== null && compareDateOnly(date, to) <= 0) {
    out.push({ date, index: cursor.index() });
    if (++guard > MAX_OCCURRENCES_PER_SCAN) {
      break;
    }
    date = cursor.advance();
  }
  return out;
};

// ---------------------------------------------------------------------------
// Recurrence cursor
// ---------------------------------------------------------------------------

/** A stateful, seekable cursor over one recurrence pattern. */
export interface RecurrenceCursor {
  readonly frequency: RecurrenceFrequency;
  readonly spec: RecurrenceSpec;
  /** Index of the current occurrence (0 when not positioned/exhausted). */
  index(): number;
  /** Current occurrence date, or `null` when not positioned/exhausted. */
  current(): DateOnly | null;
  /** Position at the first occurrence on/after `from`; returns it or `null`. */
  seek(from: DateOnly): DateOnly | null;
  /** Position at the next occurrence after the current one; returns it or `null`. */
  advance(): DateOnly | null;
  /** `true` when no occurrence is currently positioned. */
  done(): boolean;
}

/** Creates a seekable cursor for `spec` (see {@link RecurrenceCursor}). */
export const createRecurrenceCursor = (spec: RecurrenceSpec): RecurrenceCursor => {
  let cursorIndex = 0;
  let currentDate: DateOnly | null = null;

  const set = (index: number, date: DateOnly | null): DateOnly | null => {
    cursorIndex = date === null ? 0 : index;
    currentDate = date;
    return date;
  };

  const seek = (from: DateOnly): DateOnly | null => {
    const index = firstIndexOnOrAfter(spec, from);
    if (index === null) {
      return set(0, null);
    }
    const date = nthOccurrence(spec, index);
    if (date === null || !withinPatternEnd(spec, index, date) || compareDateOnly(date, from) < 0) {
      return set(0, null);
    }
    return set(index, date);
  };

  return {
    frequency: spec.frequency,
    spec,
    index: () => cursorIndex,
    current: () => currentDate,
    done: () => currentDate === null,
    seek,
    advance() {
      const startingFrom = currentDate ?? spec.startDate;
      return seek(addDays(startingFrom, 1));
    }
  };
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const validateRecurrence = (definitionId: string, spec: RecurrenceSpec): string[] => {
  const diagnostics: string[] = [];
  if (!(RECURRENCE_FREQUENCIES as readonly string[]).includes(spec.frequency)) {
    diagnostics.push(`Definition "${definitionId}" has an unknown frequency "${String(spec.frequency)}"; skipped.`);
    return diagnostics;
  }
  if (!isValidDateOnly(spec.startDate)) {
    diagnostics.push(`Definition "${definitionId}" has an invalid start date "${String(spec.startDate)}"; skipped.`);
    return diagnostics;
  }
  if (spec.endDate !== undefined && spec.endDate !== null) {
    if (!isValidDateOnly(spec.endDate)) {
      diagnostics.push(`Definition "${definitionId}" has an invalid end date "${String(spec.endDate)}"; skipped.`);
    } else if (compareDateOnly(spec.endDate, spec.startDate) < 0) {
      diagnostics.push(`Definition "${definitionId}" ends before it starts; skipped.`);
    }
  }
  if (spec.interval !== undefined && spec.interval !== null) {
    if (!Number.isSafeInteger(spec.interval) || spec.interval < 1) {
      diagnostics.push(`Definition "${definitionId}" has an invalid interval "${String(spec.interval)}"; skipped.`);
    }
  }
  if (spec.dayOfMonth !== undefined && spec.dayOfMonth !== null) {
    if (!Number.isSafeInteger(spec.dayOfMonth) || spec.dayOfMonth < 1 || spec.dayOfMonth > 31) {
      diagnostics.push(`Definition "${definitionId}" has an invalid day-of-month "${String(spec.dayOfMonth)}"; skipped.`);
    }
  }
  if (spec.monthOfYear !== undefined && spec.monthOfYear !== null) {
    if (!Number.isSafeInteger(spec.monthOfYear) || spec.monthOfYear < 1 || spec.monthOfYear > 12) {
      diagnostics.push(`Definition "${definitionId}" has an invalid month-of-year "${String(spec.monthOfYear)}"; skipped.`);
    }
  }
  if (spec.weekday !== undefined && spec.weekday !== null) {
    if (!Number.isSafeInteger(spec.weekday) || spec.weekday < 0 || spec.weekday > 6) {
      diagnostics.push(`Definition "${definitionId}" has an invalid weekday "${String(spec.weekday)}"; skipped.`);
    }
  }
  if (spec.maxOccurrences !== undefined && spec.maxOccurrences !== null) {
    if (!Number.isSafeInteger(spec.maxOccurrences) || spec.maxOccurrences < 1) {
      diagnostics.push(`Definition "${definitionId}" has an invalid max-occurrences "${String(spec.maxOccurrences)}"; skipped.`);
    }
  }
  return diagnostics;
};

const validateDefinition = (definition: EventDefinition, seenIds: Set<string>): string[] => {
  const diagnostics: string[] = [];
  if (typeof definition.definitionId !== 'string' || definition.definitionId.length === 0) {
    diagnostics.push('A definition has an empty id; skipped.');
    return diagnostics;
  }
  if (seenIds.has(definition.definitionId)) {
    diagnostics.push(`Definition "${definition.definitionId}" is registered more than once; occurrences are deduplicated by id.`);
  }
  seenIds.add(definition.definitionId);
  if (!isEventPhase(definition.phase)) {
    diagnostics.push(`Definition "${definition.definitionId}" has an unknown phase; skipped.`);
    return diagnostics;
  }
  if (definition.priority !== undefined && !Number.isFinite(definition.priority)) {
    diagnostics.push(`Definition "${definition.definitionId}" has a non-finite priority; skipped.`);
  }
  if (typeof definition.resolveTarget !== 'function') {
    diagnostics.push(`Definition "${definition.definitionId}" has no target resolver; skipped.`);
  }
  diagnostics.push(...validateRecurrence(definition.definitionId, definition.recurrence));
  return diagnostics;
};

// ---------------------------------------------------------------------------
// Ordering + dedupe
// ---------------------------------------------------------------------------

const compareEvents = (a: ScheduledEvent, b: ScheduledEvent): number => {
  const byDate = compareDateOnly(a.date, b.date);
  if (byDate !== 0) {
    return byDate;
  }
  const byPhase = EVENT_PHASE_RANK[a.phase] - EVENT_PHASE_RANK[b.phase];
  if (byPhase !== 0) {
    return byPhase;
  }
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  if (a.occurrenceId === b.occurrenceId) {
    return 0;
  }
  return a.occurrenceId < b.occurrenceId ? -1 : 1;
};

/** Sorts by date/phase/priority/occurrenceId and drops duplicate occurrence ids (first wins). */
const orderEvents = (events: ScheduledEvent[]): ScheduledEvent[] => {
  const sorted = [...events].sort(compareEvents);
  const seen = new Set<string>();
  const out: ScheduledEvent[] = [];
  for (const event of sorted) {
    if (seen.has(event.occurrenceId)) {
      continue;
    }
    seen.add(event.occurrenceId);
    out.push(Object.freeze(event));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export type ActiveBoundaries = {
  readonly activeCareer: CompiledCareerInterval | null;
  readonly activePayPlan: CompiledPayPlanInterval | null;
};

/** The public scheduler handle returned by {@link createScheduler}. */
export interface Scheduler {
  readonly context: CompiledScenarioContext;
  readonly window: ResolvedScheduleWindow;
  /** Validated, schedulable definitions (invalid definitions are excluded). */
  readonly definitions: readonly EventDefinition[];
  readonly diagnostics: readonly string[];
  /** Lazy chronological month batches; materializes one month at a time. */
  batches(): Generator<MonthBatch, void, void>;
  /** Direct O(1)-seek to one month; `null` when outside the batched window. */
  batchFor(yearMonth: YearMonth): MonthBatch | null;
  /** Convenience: eagerly collects every batch in the window (caller's choice). */
  collect(): MonthBatch[];
  /** Resolves a definition's dynamic target at execution time. */
  resolveTarget(event: ScheduledEvent): Cents;
  getDefinition(definitionId: string): EventDefinition | undefined;
  /** Active career/pay-plan boundaries for a month (context getters). */
  getActiveBoundaries(yearMonth: YearMonth): ActiveBoundaries;
}

const monthStartOf = (yearMonth: YearMonth): DateOnly => `${yearMonth}-01`;

const buildExecutionContext = (
  context: CompiledScenarioContext,
  event: ScheduledEvent,
  activeCareer: CompiledCareerInterval | null
): EventExecutionContext => ({
  context,
  event,
  yearMonth: event.yearMonth,
  date: event.date,
  occurrenceIndex: event.occurrenceIndex,
  activeCareer,
  activePayPlan:
    activeCareer === null ? null : context.getActivePayPlan(activeCareer.careerId, event.yearMonth)
});

const resolveWindow = (
  context: CompiledScenarioContext,
  options: ScheduleWindow | undefined
): ResolvedScheduleWindow => {
  const contextStart = context.metadata.startDate;
  const contextEnd = context.metadata.endDate;
  let startDate = options?.startDate ?? contextStart;
  let endDate = options?.endDate ?? contextEnd;

  if (!isValidDateOnly(startDate)) {
    throw new RangeError(`Schedule window start "${String(startDate)}" is not a valid YYYY-MM-DD date.`);
  }
  if (endDate === undefined || endDate === null) {
    endDate = contextEnd;
  }
  if (!isValidDateOnly(endDate)) {
    throw new RangeError(`Schedule window end "${String(endDate)}" is not a valid YYYY-MM-DD date.`);
  }

  // Clip into the compiled context so the scheduler never invents a month outside it.
  if (compareDateOnly(startDate, contextStart) < 0) {
    startDate = contextStart;
  }
  if (compareDateOnly(endDate, contextEnd) > 0) {
    endDate = contextEnd;
  }
  if (compareDateOnly(startDate, endDate) > 0) {
    throw new RangeError(
      `Schedule window [${startDate}, ${endDate}] is empty after clipping to the context horizon.`
    );
  }

  const startParts = parseDateOnly(startDate);
  const endParts = parseDateOnly(endDate);
  if (!startParts || !endParts) {
    throw new RangeError('Schedule window could not be parsed after validation.');
  }
  const startYearMonth = formatYearMonth(startParts);
  const endYearMonth = formatYearMonth(endParts);
  return {
    startDate,
    endDate,
    startYearMonth,
    endYearMonth,
    startOrdinal: toMonthOrdinal(startYearMonth),
    endOrdinal: toMonthOrdinal(endYearMonth)
  };
};

/**
 * Creates a pure, side-effect-free month-batched scheduler over one compiled
 * context. Invalid definitions are reported in {@link Scheduler.diagnostics} and
 * excluded; they never emit speculative occurrences.
 */
export const createScheduler = (
  context: CompiledScenarioContext,
  definitions: readonly EventDefinition[],
  options?: ScheduleWindow
): Scheduler => {
  const diagnostics: string[] = [];
  const seenIds = new Set<string>();
  const activeDefinitions: EventDefinition[] = [];
  for (const definition of definitions ?? []) {
    const problems = validateDefinition(definition, seenIds);
    if (problems.length > 0) {
      diagnostics.push(...problems);
    }
    const invalid = problems.some((message) => message.includes('skipped'));
    if (!invalid) {
      activeDefinitions.push(definition);
    }
  }
  const frozenDefinitions = Object.freeze([...activeDefinitions]);
  const window = resolveWindow(context, options);

  const getActiveBoundaries = (yearMonth: YearMonth): ActiveBoundaries => {
    if (!isValidYearMonth(yearMonth)) {
      return { activeCareer: null, activePayPlan: null };
    }
    const activeCareer = context.getActiveCareer(yearMonth);
    return {
      activeCareer,
      activePayPlan: activeCareer === null ? null : context.getActivePayPlan(activeCareer.careerId, yearMonth)
    };
  };

  const buildBatch = (ordinal: MonthOrdinal, index: number): MonthBatch => {
    const yearMonth = fromMonthOrdinal(ordinal);
    const monthStart = monthStartOf(yearMonth);
    const monthEnd = endOfMonthDate(yearMonth);
    const batchStart = compareDateOnly(monthStart, window.startDate) > 0 ? monthStart : window.startDate;
    const batchEnd = compareDateOnly(monthEnd, window.endDate) < 0 ? monthEnd : window.endDate;
    const { activeCareer, activePayPlan } = getActiveBoundaries(yearMonth);

    const collected: ScheduledEvent[] = [];
    for (const definition of frozenDefinitions) {
      const occurrences = occurrencesInWindow(definition.recurrence, batchStart, batchEnd);
      for (const occurrence of occurrences) {
        const event: ScheduledEvent = {
          occurrenceId: `${definition.definitionId}:${occurrence.date}`,
          definitionId: definition.definitionId,
          date: occurrence.date,
          yearMonth,
          phase: definition.phase,
          priority: definition.priority ?? DEFAULT_PRIORITY,
          purpose: definition.purpose,
          occurrenceIndex: occurrence.index,
          handlerId: definition.handlerId
        };
        if (definition.isActive && !definition.isActive(buildExecutionContext(context, event, activeCareer))) {
          continue;
        }
        collected.push(event);
      }
    }

    return Object.freeze({
      index,
      yearMonth,
      ordinal,
      startDate: batchStart,
      endDate: batchEnd,
      partial: batchStart !== monthStart || batchEnd !== monthEnd,
      activeCareer,
      activePayPlan,
      events: Object.freeze(orderEvents(collected))
    });
  };

  const batchFor = (yearMonth: YearMonth): MonthBatch | null => {
    if (!isValidYearMonth(yearMonth)) {
      return null;
    }
    const ordinal = toMonthOrdinal(yearMonth);
    if (ordinal < window.startOrdinal || ordinal > window.endOrdinal) {
      return null;
    }
    return buildBatch(ordinal, ordinal - window.startOrdinal);
  };

  function* batches(): Generator<MonthBatch, void, void> {
    let index = 0;
    for (let ordinal = window.startOrdinal; ordinal <= window.endOrdinal; ordinal += 1) {
      yield buildBatch(ordinal, index);
      index += 1;
    }
  }

  const definitionIndex = new Map(frozenDefinitions.map((definition) => [definition.definitionId, definition]));

  return Object.freeze({
    context,
    window: Object.freeze({ ...window }),
    definitions: frozenDefinitions,
    diagnostics: Object.freeze([...diagnostics]),
    batches,
    batchFor,
    collect: () => {
      const result: MonthBatch[] = [];
      for (const batch of batches()) {
        result.push(batch);
      }
      return result;
    },
    resolveTarget: (event: ScheduledEvent): Cents => {
      const definition = definitionIndex.get(event.definitionId);
      if (!definition) {
        throw new RangeError(`No event definition matches "${event.definitionId}".`);
      }
      const { activeCareer } = getActiveBoundaries(event.yearMonth);
      return definition.resolveTarget(buildExecutionContext(context, event, activeCareer));
    },
    getDefinition: (definitionId: string) => definitionIndex.get(definitionId),
    getActiveBoundaries
  });
};
