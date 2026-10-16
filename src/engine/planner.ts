/**
 * P3S.3 — Manual planner and recurrence adapters (S + O, engine-internal, pure).
 *
 * The manual expense planner is a *scheduling adapter*, not a second ledger. This
 * module turns the canonical `context.global.expenses` configuration into (a) the
 * recurring {@link EventDefinition}s the kernel scheduler drives and (b) the
 * {@link ProjectionEventHandler} that executes them through the P2.4 funding
 * seam. It owns **no balances, no income reservoir and no retry**.
 *
 * ### Occurrence identity (ADR-004 / RV22, architecture §9)
 *
 * Stable, namespaced execution keys are derived from the scheduler's
 * `${definitionId}:${date}` rule:
 *
 * - a manual one-time `ExpenseEntry` → `planner:<entryId>:<date>`;
 * - a `RecurringExpenseEvent` occurrence → `recurrence:<eventId>:<date>`.
 *
 * A recurrence is scheduled **only** as its dated occurrences; the parent event is
 * never emitted as an additional obligation, so a parent and its occurrences can
 * never double-charge. Distinct configured records execute distinctly — no
 * implicit label/amount matching, and no general transaction tracker.
 *
 * ### One-time vs recurrence (ADR-004, architecture §9)
 *
 * A one-time entry fires exactly once at `startDate`; its `endDate` is a **display
 * span only** and never causes repeats. Weekly/monthly recurrences are inclusive of
 * `endDate`; a monthly day-31 (or Feb-29) target **clamps** to the last valid day
 * of a short month instead of disappearing. `first_monday_after` resolves to the
 * first Monday on/after `max(month start, anchor)` for each month.
 *
 * ### Occurred imports are permanently view-only (ADR-004 / RV22)
 *
 * An imported record — `provenance`/`originType` `imported`, or an explicitly
 * `planningStatus: 'occurred'` record — is **never** scheduled, regardless of its
 * display `startDate`, `sourceDate`, `asOf` anchor or any moved date. Status is
 * never promoted from a date: an imported record without an explicit
 * `planningStatus: 'planned'` stays occurred. This mirrors the codec's
 * provenance-derived default and is re-enforced at execution time so a definition
 * built elsewhere can never debit an occurred observation.
 *
 * ### Funding seam (P2.4)
 *
 * Every occurrence quotes then commits **only** the record's own account order
 * (`fundingSource` account first, then the record's account / payment account).
 * The real requested/paid/unpaid amounts come from the returned `FundingPlan`; a
 * shortfall is left visibly unfunded with no fabricated income, no negative
 * balance, no borrowing and no cross-month retry. Mutation happens only through
 * the state owner's sole `commitChanges` (via `commitFunding`).
 *
 * Authority: `refactor/phase3_plan.md` P3S.3 / CA10, ADR-004, RV22,
 * `refactor/architecture_specification.md` §9, and the settled P1.4 `commands.ts`
 * marker resolver, P2.4 `funding.ts`, P2.5 `configuration.ts` and P2.6
 * `scheduler.ts`.
 */

import type {
  ExpenseEntry,
  ExpensesConfig,
  PlannerProvenanceFields,
  PlanningStatus,
  RecurringExpenseEvent
} from '../types';
import type { CompiledScenarioContext } from './configuration';
import type { FundingRequest } from './contracts';
import type { PostingContext } from './journal';
import {
  compareDateOnly,
  formatYearMonth,
  fromDayOrdinal,
  isValidDateOnly,
  parseDateOnly,
  toDayOrdinal,
  type DateOnly
} from './dates';
import { commitFunding, quoteFunding } from './funding';
import { tryDollarsToCents, type Cents } from './money';
import type { EventDefinition, EventExecutionContext, EventActivePredicate, RecurrenceSpec } from './scheduler';
import type {
  ProjectionEventHandler,
  ProjectionExecutionResult,
  ProjectionHandlerDependencies
} from './projection';

// ---------------------------------------------------------------------------
// Public identity constants
// ---------------------------------------------------------------------------

/** Handler id shared by every planner occurrence (matches `handlerId`). */
export const PLANNER_HANDLER_ID = 'planner-obligations';

/** Definition-id namespace for a manual one-time entry. */
export const PLANNER_DEFINITION_PREFIX = 'planner:';

/** Definition-id namespace for a recurring event's occurrences. */
export const RECURRENCE_DEFINITION_PREFIX = 'recurrence:';

/** Funding purpose recorded on every planner request. */
export const PLANNER_FUNDING_PURPOSE = 'planner';

const ACCOUNT_FUNDING_PREFIX = 'account:';
const WEEKDAY_MONDAY = 1;
const WEEKDAY_FRIDAY = 5;
const MAX_DAY_OF_MONTH = 31;

/** A planner record that can schedule obligations (one-time or recurring). */
export type PlannerRecord = ExpenseEntry | RecurringExpenseEvent;

// ---------------------------------------------------------------------------
// Occurrence status — occurred records are permanently view-only
// ---------------------------------------------------------------------------

/**
 * Effective occurrence status, mirroring the codec's provenance-derived default:
 * an explicit valid `planningStatus` wins; otherwise an imported record is
 * `occurred` and any other record is `planned`. Date, anchor and display date are
 * never consulted, so a moved/old date can never promote an occurred import.
 */
const effectivePlannerStatus = (
  record: PlannerProvenanceFields & { originType?: unknown }
): PlanningStatus => {
  if (record.planningStatus === 'planned' || record.planningStatus === 'occurred') {
    return record.planningStatus;
  }
  const imported = record.originType === 'imported' || record.provenance === 'imported';
  return imported ? 'occurred' : 'planned';
};

/** `true` when the record must stay a view-only historical observation. */
const isOccurredRecord = (record: PlannerProvenanceFields & { originType?: unknown }): boolean =>
  effectivePlannerStatus(record) === 'occurred';

// ---------------------------------------------------------------------------
// Amounts and accounts
// ---------------------------------------------------------------------------

/** Dollars → cents, or `null` when the amount is not a postable value. */
const amountCents = (amount: number): Cents | null => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const outcome = tryDollarsToCents(amount);
  return outcome.ok ? outcome.value : null;
};

const isRecurringRecord = (record: PlannerRecord): record is RecurringExpenseEvent =>
  typeof (record as RecurringExpenseEvent).cadence === 'string' && !('originType' in record);

/** The explicit account named by a `fundingSource`, or `null` for `income`/absent. */
const accountIdFromFundingSource = (fundingSource: string | null | undefined): string | null => {
  if (typeof fundingSource !== 'string' || !fundingSource.startsWith(ACCOUNT_FUNDING_PREFIX)) {
    return null;
  }
  const id = fundingSource.slice(ACCOUNT_FUNDING_PREFIX.length);
  return id.length > 0 ? id : null;
};

/** Ordered, deduplicated non-empty account ids (primary first). */
const dedupeAccountIds = (values: readonly (string | null | undefined)[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
};

/**
 * The record's own ordered account sources. An explicit `account:` fundingSource
 * is primary; the record's account / payment account follows. An `income`
 * fundingSource does **not** invent a reservoir — it simply falls through to the
 * record's account. With no account the request resolves to no source and stays
 * visibly unfunded.
 */
const resolveAccountOrder = (
  record: PlannerRecord
): { primaryAccountId: string | null; fallbackAccountIds: string[] } => {
  const explicit = accountIdFromFundingSource(record.fundingSource);
  const recordAccounts = isRecurringRecord(record)
    ? [record.paymentAccountId, record.accountId]
    : [record.accountId];
  const ordered = dedupeAccountIds([explicit, ...recordAccounts]);
  return { primaryAccountId: ordered[0] ?? null, fallbackAccountIds: ordered.slice(1) };
};

// ---------------------------------------------------------------------------
// Recurrence pattern construction
// ---------------------------------------------------------------------------

/** First Monday on/after `date` (inclusive); `null` for an invalid date. */
const firstMondayOnOrAfter = (date: DateOnly): DateOnly | null => {
  if (!isValidDateOnly(date)) {
    return null;
  }
  const ordinal = toDayOrdinal(date);
  const weekday = (((ordinal + 4) % 7) + 7) % 7; // 0 = Sunday … 6 = Saturday
  const delta = (WEEKDAY_MONDAY - weekday + 7) % 7;
  return fromDayOrdinal(ordinal + delta);
};

/**
 * The occurrence-1 of `anchor` within the month of `candidate`: the first Monday
 * on/after `max(month start, anchor)`. Later months therefore use their first
 * Monday while the anchor's own month starts no earlier than the anchor.
 */
const firstMondayForMonth = (anchor: DateOnly, candidate: DateOnly): DateOnly | null => {
  const parsed = parseDateOnly(candidate);
  if (!parsed || !isValidDateOnly(anchor)) {
    return null;
  }
  const monthStart = `${formatYearMonth(parsed)}-01`;
  const lower = compareDateOnly(anchor, monthStart) > 0 ? anchor : monthStart;
  return firstMondayOnOrAfter(lower);
};

interface RecurringPattern {
  readonly recurrence: RecurrenceSpec;
  readonly isActive?: EventActivePredicate;
}

/** Maps a recurring event's cadence/rule to a scheduler recurrence (+ gate). */
const buildRecurringPattern = (event: RecurringExpenseEvent): RecurringPattern | null => {
  if (!isValidDateOnly(event.startDate)) {
    return null;
  }
  const endDate =
    isValidDateOnly(event.endDate) && compareDateOnly(event.endDate, event.startDate) >= 0
      ? event.endDate
      : null;
  const bounds = endDate === null ? { startDate: event.startDate } : { startDate: event.startDate, endDate };

  if (event.rule === 'every_friday') {
    return { recurrence: { frequency: 'weekly', weekday: WEEKDAY_FRIDAY, ...bounds } };
  }

  if (event.rule === 'first_monday_after') {
    const anchor =
      typeof event.anchorDate === 'string' && isValidDateOnly(event.anchorDate)
        ? event.anchorDate
        : event.startDate;
    return {
      recurrence: { frequency: 'weekly', weekday: WEEKDAY_MONDAY, ...bounds },
      isActive: (execution: EventExecutionContext) => {
        const expected = firstMondayForMonth(anchor, execution.date);
        return expected !== null && execution.date === expected;
      }
    };
  }

  // Rule 'on_date'.
  if (event.cadence === 'monthly') {
    const fallbackDay = parseDateOnly(event.startDate)?.day ?? 1;
    const day =
      typeof event.dayOfMonth === 'number' &&
      Number.isSafeInteger(event.dayOfMonth) &&
      event.dayOfMonth >= 1 &&
      event.dayOfMonth <= MAX_DAY_OF_MONTH
        ? event.dayOfMonth
        : fallbackDay;
    return { recurrence: { frequency: 'monthly', dayOfMonth: day, ...bounds } };
  }

  return { recurrence: { frequency: 'weekly', ...bounds } };
};

// ---------------------------------------------------------------------------
// Definition construction
// ---------------------------------------------------------------------------

const buildEntryDefinition = (entry: ExpenseEntry): EventDefinition | null => {
  if (!isValidDateOnly(entry.startDate)) {
    return null;
  }
  const target = amountCents(entry.amount);
  if (target === null || target <= 0) {
    return null;
  }
  // One-time: `endDate` is a display span only and is never a recurrence bound.
  return {
    definitionId: `${PLANNER_DEFINITION_PREFIX}${entry.id}`,
    phase: 'mandatory',
    purpose: PLANNER_FUNDING_PURPOSE,
    recurrence: { frequency: 'oneTime', startDate: entry.startDate },
    handlerId: PLANNER_HANDLER_ID,
    resolveTarget: () => target
  };
};

const buildRecurrenceDefinition = (event: RecurringExpenseEvent): EventDefinition | null => {
  const pattern = buildRecurringPattern(event);
  if (!pattern) {
    return null;
  }
  const target = amountCents(event.amount);
  if (target === null || target <= 0) {
    return null;
  }
  return {
    definitionId: `${RECURRENCE_DEFINITION_PREFIX}${event.id}`,
    phase: 'mandatory',
    purpose: PLANNER_FUNDING_PURPOSE,
    recurrence: pattern.recurrence,
    ...(pattern.isActive ? { isActive: pattern.isActive } : {}),
    handlerId: PLANNER_HANDLER_ID,
    resolveTarget: () => target
  };
};

/**
 * Builds the recurring `EventDefinition`s for every **planned** manual entry and
 * recurring event in `context.global.expenses`. Occurred imports are excluded, a
 * recurrence is never scheduled as an extra parent obligation, and the result is
 * a frozen list — the caller's configuration is never mutated.
 */
export const buildPlannerEventDefinitions = (
  context: CompiledScenarioContext
): readonly EventDefinition[] => {
  const definitions: EventDefinition[] = [];
  const expenses: Readonly<ExpensesConfig> | undefined = context.global?.expenses;
  if (!expenses) {
    return Object.freeze(definitions);
  }

  for (const entry of expenses.entries ?? []) {
    if (isOccurredRecord(entry)) {
      continue;
    }
    const definition = buildEntryDefinition(entry);
    if (definition) {
      definitions.push(definition);
    }
  }

  for (const event of expenses.recurringEvents ?? []) {
    if (!event.enabled || isOccurredRecord(event)) {
      continue;
    }
    const definition = buildRecurrenceDefinition(event);
    if (definition) {
      definitions.push(definition);
    }
  }

  return Object.freeze(definitions);
};

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

const buildPlannerRecordIndex = (context: CompiledScenarioContext): Map<string, PlannerRecord> => {
  const index = new Map<string, PlannerRecord>();
  const expenses: Readonly<ExpensesConfig> | undefined = context.global?.expenses;
  if (!expenses) {
    return index;
  }
  for (const entry of expenses.entries ?? []) {
    index.set(`${PLANNER_DEFINITION_PREFIX}${entry.id}`, entry);
  }
  for (const event of expenses.recurringEvents ?? []) {
    index.set(`${RECURRENCE_DEFINITION_PREFIX}${event.id}`, event);
  }
  return index;
};

/**
 * D15 posting provenance for one planner occurrence, taken explicitly from the
 * executing event (never a wall clock or fabricated default). A zero/unfunded/
 * rejected occurrence never commits, so it never fabricates a stamp; only an
 * actually committed plan journals exactly one indexed row.
 */
const plannerPosting = (execution: EventExecutionContext): PostingContext => ({
  occurrenceId: execution.event.occurrenceId,
  definitionId: execution.event.definitionId,
  purpose: execution.event.purpose,
  date: execution.date,
  phase: execution.event.phase
});

/**
 * Creates the single planner {@link ProjectionEventHandler}. It executes each
 * scheduled occurrence through `quoteFunding`/`commitFunding`, posts **only** the
 * requested/paid/unpaid account amounts, and never fabricates income or retries.
 * Occurred records are refused at execution time as a second line of defence.
 */
export const createPlannerHandlers = (
  deps: ProjectionHandlerDependencies
): readonly ProjectionEventHandler[] => {
  const recordIndex = buildPlannerRecordIndex(deps.context);

  const handler: ProjectionEventHandler = {
    handlerId: PLANNER_HANDLER_ID,
    resolveTarget(execution: EventExecutionContext): Cents {
      const record = recordIndex.get(execution.event.definitionId);
      if (!record || isOccurredRecord(record)) {
        return 0;
      }
      return amountCents(record.amount) ?? 0;
    },
    execute({ execution, targetCents, deps: runDeps }): ProjectionExecutionResult {
      const record = recordIndex.get(execution.event.definitionId);
      if (!record) {
        return {
          committed: false,
          plan: null,
          diagnostics: [
            `Planner record "${execution.event.definitionId}" was not found; occurrence skipped.`
          ]
        };
      }
      if (isOccurredRecord(record)) {
        return {
          committed: false,
          plan: null,
          diagnostics: [
            `Planner record "${execution.event.definitionId}" is an occurred observation and stays view-only.`
          ]
        };
      }

      const { primaryAccountId, fallbackAccountIds } = resolveAccountOrder(record);
      const request: FundingRequest = {
        id: execution.event.definitionId,
        occurrenceId: execution.event.occurrenceId,
        date: execution.date,
        requestedCents: targetCents,
        primaryAccountId,
        fallbackAccountIds,
        purpose: PLANNER_FUNDING_PURPOSE
      };

      const quoted = quoteFunding(runDeps.state, request, runDeps.accounts, runDeps.dateOfBirth);
      if (!quoted.ok) {
        return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
      }

      // No `requote` hook: quote and commit are adjacent, and an unfunded/partial
      // plan is recorded as-is — never retried across months. A zero-fund plan is
      // rejected inside `commitFunding` before any commit, so it journals nothing.
      const committed = commitFunding(runDeps.state, quoted.plan, { posting: plannerPosting(execution) });
      return {
        committed: committed.committed,
        plan: committed.plan,
        quote: quoted,
        diagnostics: committed.errors.map((error) => error.message)
      };
    }
  };

  return Object.freeze([handler]);
};
