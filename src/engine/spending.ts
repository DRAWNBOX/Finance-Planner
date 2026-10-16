/**
 * P3S.1 — Headless spending stream (owner: O).
 *
 * Authority: `refactor/phase3_plan.md` P3S.1 + D10, `refactor/phase2_handoff.md`
 * §3 (kernel API), `refactor/frozen_contracts.md` P0.3.2 (event phases /
 * same-date order), P0.3.3 (funding / partial policy), P0.3.4 (cents rounding),
 * P0.3.5 (safe limits), and the settled P2.4 funding / P2.6 scheduler / P2.7
 * facade lanes.
 *
 * This module owns **only** the spending obligations that are not already owned
 * by the planner (`P3S.3`), card (`P3D`), loan (`P3D.3`) or housing (`P3H`)
 * streams:
 *
 * 1. one-off **large purchases** (phase `discretionary`),
 * 2. recurring **long-term monthly purchases** (phase `mandatory`; inclusive
 *    start/end months, day-31 target clamps to the last valid day),
 * 3. **career monthly-withdrawal expenses by account** — account-funded
 *    (`CareerSourceLine.monthlyWithdrawal`), active-career/plan scoped, optional
 *    `increaseWithdrawalWithPaycheck` scaling (phase `mandatory`), and
 * 4. generic **cashflow / life-event outflows** (recurring → `mandatory`,
 *    one-off → `discretionary`). Inflows are owned exclusively by the income
 *    stream (P3I.5) and are never scheduled here. An outflow with no explicit
 *    `startYearMonth`/`endYearMonth` (and no resolved marker) is dated from its
 *    `startAge`/`endAge` via the explicit {@link SpendingDateAnchor} — never the
 *    wall clock; when no anchor is usable it stays unresolved with a diagnostic
 *    instead of receiving an arbitrary date.
 *
 * Contract:
 *
 * - `buildSpendingEventDefinitions(context)` returns the recurring
 *   `EventDefinition`s (namespace `spending:purchase` / `spending:longterm` /
 *   `spending:career` / `spending:cashflow` / `spending:life`).
 * - `createSpendingHandlers(deps)` returns the `ProjectionEventHandler`s that
 *   execute them. Each occurrence resolves its **actual integer-cent target
 *   exactly once**, quotes through `quoteFunding` and commits through
 *   `commitFunding` (the state owner's sole `commitChanges` route). A
 *   zero/unfunded target never fabricates a plan row.
 * - Funding is primary-first over the **explicit ordered account list** (purchase
 *   `sourceLines` amounts / `fundingSource`, the career line's own account, or a
 *   cashflow/life-event `accountId`) with per-source `quoteFunding` quotas. The
 *   configured **global** funding policy is used only when an obligation names no
 *   account at all.
 * - **No income reservoir, no implicit borrow/retry/arrears.** A legacy
 *   `fundingSource === 'income'` with no account funding configured stays
 *   visibly unresolved (no invented money).
 * - Partial/unpaid outcomes are surfaced as a diagnostic; only a committed plan
 *   with executed net > 0 becomes audit.
 *
 * This module is pure: it reads the immutable compiled context and never mutates
 * the caller's `Scenario`, the context, or the scheduler. All mutation happens
 * through `commitFunding` → `state.commitChanges`.
 */

import type { CareerEntry, CareerSourceLine, LargePurchase, LifeEvent, LongTermPurchase, SourceLine } from '../types';
import type { CompiledScenarioContext, CompiledCareer } from './configuration';
import {
  addMonths,
  endOfMonthDate,
  formatYearMonth,
  isValidDateOnly,
  isValidYearMonth,
  parseDateOnly,
  parseYearMonth,
  toMonthOrdinal
} from './dates';
import { dollarsToCents, roundHalfAwayFromZero } from './money';
import type { FundingRequest } from './contracts';
import type { PostingContext } from './journal';
import { commitFunding, quoteFunding } from './funding';
import type {
  EventActivePredicate,
  EventDefinition,
  EventExecutionContext,
  EventPhase,
  RecurrenceSpec
} from './scheduler';
import type {
  ProjectionEventHandler,
  ProjectionHandlerDependencies,
  ProjectionExecutionResult,
  ProjectionHandlerInvocation
} from './projection';

/** Definition-ID namespace prefix for the spending stream. */
export const SPENDING_DEFINITION_PREFIX = 'spending';

/** Handler ids, one per spending namespace. */
export const SPENDING_HANDLER_IDS = {
  purchase: 'spending.purchase',
  longterm: 'spending.longterm',
  career: 'spending.career',
  cashflow: 'spending.cashflow',
  life: 'spending.life'
} as const;

export type SpendingKind = keyof typeof SPENDING_HANDLER_IDS;

/** Life-event types that are generic spending outflows (never housing/career). */
const SPENDING_LIFE_EVENT_TYPES: ReadonlySet<LifeEvent['type']> = new Set(['large_expense', 'custom_expense']);

// ---------------------------------------------------------------------------
// Internal descriptor (shared by the definition and handler builders)
// ---------------------------------------------------------------------------

interface SpendingSourcePlan {
  readonly primaryAccountId: string | null;
  readonly fallbackAccountIds: readonly string[];
  readonly perSourceQuotaCents: Readonly<Record<string, number>> | null;
  readonly useGlobalDefaults: boolean;
}

interface SpendingDescriptor extends SpendingSourcePlan {
  readonly kind: SpendingKind;
  readonly definitionId: string;
  readonly phase: EventPhase;
  readonly purpose: string;
  readonly recurrence: RecurrenceSpec;
  readonly isActive?: EventActivePredicate;
  /** Resolves the occurrence's requested net target, in integer cents. */
  readonly resolveRequestedCents: (execution: EventExecutionContext) => number;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Non-negative integer cents from a persisted dollar amount; `0` when invalid. */
const centsFromDollars = (dollars: number): number => {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars <= 0) {
    return 0;
  }
  return dollarsToCents(dollars);
};

const compareOrdinals = (a: string, b: string): number => toMonthOrdinal(a) - toMonthOrdinal(b);

/** Narrowing guard for a possibly-absent `YYYY-MM` value. */
const isValidYearMonthValue = (value: unknown): value is string =>
  typeof value === 'string' && isValidYearMonth(value);

/**
 * Explicit, non-clock anchor for age-only obligations — cashflow add-ons and
 * generic life-event outflows that carry only `startAge`/`endAge` and no
 * `startYearMonth`. A valid `dateOfBirth` is the primary derivation input and is
 * anchored to the birth month; when it is unusable, a finite `currentAge`
 * together with an explicit `referenceYearMonth` (the resolved opening
 * observation month) is the fallback. Neither path reads the wall clock, and an
 * item with no usable anchor is left unresolved rather than given a date.
 */
export interface SpendingDateAnchor {
  /** Configured date of birth (`YYYY-MM-DD`), or `null`/absent when unknown. */
  readonly dateOfBirth?: string | null;
  /** Configured current age at the opening reference, or `null`/absent. */
  readonly currentAge?: number | null;
  /** Explicit opening reference month (`YYYY-MM`); defaults to the context start. */
  readonly referenceYearMonth?: string | null;
}

interface ResolvedSpendingAnchor {
  readonly dateOfBirth: string;
  readonly currentAge: number | null;
  readonly referenceYearMonth: string;
}

/** Resolves an anchor against the context, dropping invalid inputs (no clock). */
const resolveAnchor = (
  context: CompiledScenarioContext,
  anchor: SpendingDateAnchor | undefined
): ResolvedSpendingAnchor => {
  const rawDateOfBirth = anchor?.dateOfBirth;
  const dateOfBirth = typeof rawDateOfBirth === 'string' && isValidDateOnly(rawDateOfBirth) ? rawDateOfBirth : '';
  const currentAge =
    typeof anchor?.currentAge === 'number' && Number.isFinite(anchor.currentAge)
      ? Math.floor(anchor.currentAge)
      : null;
  const rawReference = anchor?.referenceYearMonth;
  const referenceCandidate =
    typeof rawReference === 'string' && isValidYearMonth(rawReference)
      ? rawReference
      : context.metadata.startYearMonth;
  const referenceYearMonth = isValidYearMonth(referenceCandidate) ? referenceCandidate : '';
  return { dateOfBirth, currentAge, referenceYearMonth };
};

/**
 * Deterministic `YYYY-MM` for a whole age, mirroring `configuration.ts`'s private
 * `yearMonthFromAge`: the explicit birth month plus `age` when a valid DOB is
 * configured, else the explicit opening month plus `(age − currentAge)`. Returns
 * `''` (unresolved) when no authoritative anchor is available — never a clock.
 */
const yearMonthFromAge = (age: number, anchor: ResolvedSpendingAnchor): string => {
  if (typeof age !== 'number' || !Number.isFinite(age)) {
    return '';
  }
  if (anchor.dateOfBirth.length > 0) {
    const birth = parseDateOnly(anchor.dateOfBirth);
    if (birth) {
      return formatYearMonth({ year: birth.year + Math.floor(age), month: birth.month });
    }
  }
  if (anchor.currentAge !== null && anchor.referenceYearMonth.length > 0) {
    const reference = parseYearMonth(anchor.referenceYearMonth);
    if (reference) {
      return formatYearMonth({ year: reference.year + Math.floor(age - anchor.currentAge), month: reference.month });
    }
  }
  return '';
};

/** Explicit account ID of a purchase `SourceLine` (canonical then legacy). */
const accountIdOfSourceLine = (line: SourceLine): string => {
  if (typeof line.accountId === 'string' && line.accountId.length > 0) {
    return line.accountId;
  }
  if (line.sourceType === 'account' && typeof line.sourceId === 'string') {
    return line.sourceId;
  }
  return '';
};

/** Per-source net quota for a purchase `SourceLine` (`amount` or `4%` of opening). */
const quotaForSourceLine = (context: CompiledScenarioContext, line: SourceLine): number => {
  if (line.mode === 'four_percent') {
    const accountId = accountIdOfSourceLine(line);
    const opening = accountId.length > 0 ? context.getAccount(accountId)?.openingBalance ?? 0 : 0;
    return roundHalfAwayFromZero(centsFromDollars(opening) * 0.04);
  }
  return centsFromDollars(line.amount);
};

/**
 * Resolves the ordered account funding (and quotas) for a purchase-class
 * obligation. Precedence: explicit `sourceLines` → explicit `fundingSource`
 * account → configured global policy (only when nothing is named) → unresolved.
 */
const resolvePurchaseSourcePlan = (
  context: CompiledScenarioContext,
  sourceLines: readonly SourceLine[] | undefined,
  fundingSource: LargePurchase['fundingSource'] | LongTermPurchase['fundingSource']
): SpendingSourcePlan => {
  const enabledLines = (sourceLines ?? []).filter((line) => line.enabled !== false);
  if (enabledLines.length > 0) {
    const order: string[] = [];
    const quotas: Record<string, number> = {};
    for (const line of enabledLines) {
      const accountId = accountIdOfSourceLine(line);
      if (accountId.length === 0 || order.includes(accountId)) {
        continue;
      }
      order.push(accountId);
      quotas[accountId] = quotaForSourceLine(context, line);
    }
    if (order.length > 0) {
      return {
        primaryAccountId: order[0],
        fallbackAccountIds: order.slice(1),
        perSourceQuotaCents: quotas,
        useGlobalDefaults: false
      };
    }
  }

  if (typeof fundingSource === 'string' && fundingSource.startsWith('account:')) {
    const accountId = fundingSource.slice('account:'.length);
    if (accountId.length > 0) {
      return {
        primaryAccountId: accountId,
        fallbackAccountIds: [],
        perSourceQuotaCents: null,
        useGlobalDefaults: false
      };
    }
  }

  if (fundingSource === undefined || fundingSource === null) {
    // No source named: the configured global funding policy funds the obligation
    // (P0.3.3 item 2). This is explicit configuration, never invented money.
    return { primaryAccountId: null, fallbackAccountIds: [], perSourceQuotaCents: null, useGlobalDefaults: true };
  }

  // `fundingSource === 'income'` (or a malformed account target): no account
  // funding configured → left visibly unresolved rather than fabricating income.
  return { primaryAccountId: null, fallbackAccountIds: [], perSourceQuotaCents: null, useGlobalDefaults: false };
};

/** Ordered account source for cashflow/life-event outflows. */
const resolveExternalSourcePlan = (accountId: string | null | undefined): SpendingSourcePlan => {
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (id.length > 0) {
    return { primaryAccountId: id, fallbackAccountIds: [], perSourceQuotaCents: null, useGlobalDefaults: false };
  }
  return { primaryAccountId: null, fallbackAccountIds: [], perSourceQuotaCents: null, useGlobalDefaults: true };
};

/** Inclusive end year-month of a long-term purchase (duration or explicit end). */
const resolveLongTermEndYearMonth = (purchase: LongTermPurchase): string => {
  const start = purchase.startYearMonth;
  let end = start;
  if (purchase.endMode === 'endDate' && isValidYearMonth(purchase.endYearMonth)) {
    end = purchase.endYearMonth;
  } else if (purchase.endMode === 'duration') {
    const months = Number.isFinite(purchase.durationMonths)
      ? Math.max(1, Math.floor(purchase.durationMonths))
      : 1;
    end = addMonths(start, months - 1);
  }
  if (compareOrdinals(end, start) < 0) {
    end = start;
  }
  return end;
};

/**
 * Recurrence window for a cashflow/life-event outflow. An explicit
 * `startYearMonth` (which markers are resolved into by the compiler) wins and
 * keeps the prior end behavior — explicit `endYearMonth`, else the horizon end.
 * An **age-only** item (no `startYearMonth`) is dated from its `startAge`/
 * `endAge` via the anchor: a one-time item fires once at its resolved start
 * month, a recurring item runs monthly through the **inclusive** end (explicit
 * `endYearMonth` still wins; otherwise the derived `endAge` month, else the
 * horizon end). An item with no explicit month and no usable anchor is left
 * unresolved (no arbitrary date) and reported through `diagnostics`.
 */
const externalRecurrence = (
  kind: 'cashflow' | 'life',
  label: string,
  cadence: 'one_time' | 'recurring',
  startAge: number,
  endAge: number,
  startYearMonth: string | undefined,
  endYearMonth: string | undefined,
  horizonEndYearMonth: string,
  anchor: ResolvedSpendingAnchor,
  diagnostics: string[]
): RecurrenceSpec | null => {
  const explicitStart = isValidYearMonthValue(startYearMonth) ? startYearMonth : '';
  const start = explicitStart.length > 0 ? explicitStart : yearMonthFromAge(startAge, anchor);
  if (!isValidYearMonth(start)) {
    const described = kind === 'life' ? 'Life-event' : 'Cashflow';
    diagnostics.push(
      `${described} outflow "${label}" has no explicit year-month and no authoritative age anchor ` +
        `(valid date of birth, or current age with an explicit opening month); left unresolved.`
    );
    return null;
  }
  if (cadence === 'one_time') {
    return { frequency: 'oneTime', startDate: `${start}-01` };
  }
  // Explicitly dated items keep the prior default (horizon end); age-only items
  // derive the end from `endAge` when no explicit end is set.
  const fallbackEnd = explicitStart.length > 0 ? horizonEndYearMonth : yearMonthFromAge(endAge, anchor);
  let end = isValidYearMonthValue(endYearMonth) ? endYearMonth : fallbackEnd;
  if (!isValidYearMonth(end)) {
    end = isValidYearMonth(horizonEndYearMonth) ? horizonEndYearMonth : start;
  }
  if (compareOrdinals(end, start) < 0) {
    end = start;
  }
  return {
    frequency: 'monthly',
    startDate: `${start}-01`,
    endDate: endOfMonthDate(end),
    dayOfMonth: 1
  };
};

// ---------------------------------------------------------------------------
// Career monthly withdrawals
// ---------------------------------------------------------------------------

/** Ordered unique accounts with a positive monthly withdrawal anywhere in a career. */
const careerWithdrawalAccounts = (entry: Readonly<CareerEntry>): string[] => {
  const accounts: string[] = [];
  const collect = (lines: readonly CareerSourceLine[] | undefined): void => {
    for (const line of lines ?? []) {
      if (!line.enabled || !(line.monthlyWithdrawal > 0)) {
        continue;
      }
      const accountId = line.sourceId;
      if (typeof accountId === 'string' && accountId.length > 0 && !accounts.includes(accountId)) {
        accounts.push(accountId);
      }
    }
  };
  collect(entry.sourceLines);
  for (const plan of entry.payPlans ?? []) {
    collect(plan.sourceLines);
  }
  return accounts;
};

/**
 * Requested net for one career/account in a month. Reads the **active** pay plan
 * for that month (initial plan → `entry.sourceLines`), sums the matching enabled
 * lines, and scales only the lines whose `increaseWithdrawalWithPaycheck` is set
 * by `(1 + raiseRate)^(months since plan start / 12)`.
 */
const careerWithdrawalTarget = (
  execution: EventExecutionContext,
  career: CompiledCareer,
  accountId: string
): number => {
  const active = execution.context.getActiveCareer(execution.yearMonth);
  if (!active || active.careerId !== career.careerId) {
    return 0;
  }

  const planId = execution.activePayPlan?.planId ?? null;
  const plan =
    planId === null ? null : (career.entry.payPlans ?? []).find((candidate) => candidate.id === planId) ?? null;
  const lines = plan ? plan.sourceLines : career.entry.sourceLines ?? [];
  if (lines.length === 0) {
    return 0;
  }

  const raiseRate = (execution.activePayPlan?.annualRaiseRate ?? career.entry.annualRaiseRate ?? 0) / 100;
  const planStart =
    execution.activePayPlan && isValidYearMonth(execution.activePayPlan.startYearMonth)
      ? execution.activePayPlan.startYearMonth
      : career.startYearMonth;
  const months = toMonthOrdinal(execution.yearMonth) - toMonthOrdinal(planStart);

  let total = 0;
  for (const line of lines) {
    if (!line.enabled || line.sourceId !== accountId || !(line.monthlyWithdrawal > 0)) {
      continue;
    }
    if (line.increaseWithdrawalWithPaycheck && months > 0 && Number.isFinite(raiseRate)) {
      total += line.monthlyWithdrawal * Math.pow(1 + raiseRate, months / 12);
    } else {
      total += line.monthlyWithdrawal;
    }
  }
  return centsFromDollars(total);
};

// ---------------------------------------------------------------------------
// Descriptor collection
// ---------------------------------------------------------------------------

const buildPurchaseDescriptors = (
  context: CompiledScenarioContext,
  out: SpendingDescriptor[]
): void => {
  for (const purchase of context.domains.purchases) {
    if (purchase.enabled === false || !isValidYearMonth(purchase.yearMonth)) {
      continue;
    }
    const requested = centsFromDollars(purchase.amount);
    if (requested <= 0) {
      continue;
    }
    out.push({
      kind: 'purchase',
      definitionId: `${SPENDING_DEFINITION_PREFIX}:purchase:${purchase.id}`,
      phase: 'discretionary',
      purpose: 'purchase',
      recurrence: { frequency: 'oneTime', startDate: `${purchase.yearMonth}-01` },
      resolveRequestedCents: () => requested,
      ...resolvePurchaseSourcePlan(context, purchase.sourceLines, purchase.fundingSource)
    });
  }
};

const buildLongTermDescriptors = (
  context: CompiledScenarioContext,
  out: SpendingDescriptor[]
): void => {
  for (const purchase of context.domains.longTermPurchases) {
    if (purchase.enabled === false || !isValidYearMonth(purchase.startYearMonth)) {
      continue;
    }
    const requested = centsFromDollars(purchase.monthlyAmount);
    if (requested <= 0) {
      continue;
    }
    const endYearMonth = resolveLongTermEndYearMonth(purchase);
    out.push({
      kind: 'longterm',
      definitionId: `${SPENDING_DEFINITION_PREFIX}:longterm:${purchase.id}`,
      phase: 'mandatory',
      purpose: 'longTermPurchase',
      recurrence: {
        frequency: 'monthly',
        startDate: `${purchase.startYearMonth}-01`,
        endDate: endOfMonthDate(endYearMonth),
        dayOfMonth: 31
      },
      resolveRequestedCents: () => requested,
      ...resolvePurchaseSourcePlan(context, purchase.sourceLines, purchase.fundingSource)
    });
  }
};

const buildCareerDescriptors = (
  context: CompiledScenarioContext,
  out: SpendingDescriptor[]
): void => {
  for (const career of context.careers) {
    if (!career.enabled) {
      continue;
    }
    if (!isValidYearMonth(career.startYearMonth) || !isValidYearMonth(career.endYearMonth)) {
      continue;
    }
    for (const accountId of careerWithdrawalAccounts(career.entry)) {
      out.push({
        kind: 'career',
        definitionId: `${SPENDING_DEFINITION_PREFIX}:career:${career.careerId}:${accountId}`,
        phase: 'mandatory',
        purpose: 'careerExpense',
        recurrence: {
          frequency: 'monthly',
          startDate: `${career.startYearMonth}-01`,
          endDate: endOfMonthDate(career.endYearMonth),
          dayOfMonth: 1
        },
        // Only the active career fires; explicit date gaps schedule nothing.
        isActive: (execution) => {
          const active = execution.context.getActiveCareer(execution.yearMonth);
          return active !== null && active.careerId === career.careerId;
        },
        resolveRequestedCents: (execution) => careerWithdrawalTarget(execution, career, accountId),
        primaryAccountId: accountId,
        fallbackAccountIds: [],
        perSourceQuotaCents: null,
        useGlobalDefaults: false
      });
    }
  }
};

const buildCashflowDescriptors = (
  context: CompiledScenarioContext,
  anchor: ResolvedSpendingAnchor,
  diagnostics: string[],
  out: SpendingDescriptor[]
): void => {
  for (const item of context.global.cashflowItems) {
    if (item.enabled === false || item.direction !== 'outflow') {
      continue;
    }
    const requested = centsFromDollars(item.amount);
    if (requested <= 0) {
      continue;
    }
    const recurrence = externalRecurrence(
      'cashflow',
      item.label,
      item.cadence,
      item.startAge,
      item.endAge,
      item.startYearMonth,
      item.endYearMonth,
      context.metadata.endYearMonth,
      anchor,
      diagnostics
    );
    if (!recurrence) {
      continue;
    }
    out.push({
      kind: 'cashflow',
      definitionId: `${SPENDING_DEFINITION_PREFIX}:cashflow:${item.id}`,
      phase: item.cadence === 'recurring' ? 'mandatory' : 'discretionary',
      purpose: 'cashflowOutflow',
      recurrence,
      resolveRequestedCents: () => requested,
      ...resolveExternalSourcePlan(item.accountId)
    });
  }
};

const buildLifeEventDescriptors = (
  context: CompiledScenarioContext,
  anchor: ResolvedSpendingAnchor,
  diagnostics: string[],
  out: SpendingDescriptor[]
): void => {
  for (const event of context.global.lifeEvents) {
    if (event.enabled === false || event.direction !== 'outflow') {
      continue;
    }
    // Housing/career life events belong to P3H/P3I; only generic expense
    // outflows are owned by this stream.
    if (!SPENDING_LIFE_EVENT_TYPES.has(event.type)) {
      continue;
    }
    const requested = centsFromDollars(event.amount);
    if (requested <= 0) {
      continue;
    }
    const recurrence = externalRecurrence(
      'life',
      event.label,
      event.cadence,
      event.startAge,
      event.endAge,
      event.startYearMonth,
      event.endYearMonth,
      context.metadata.endYearMonth,
      anchor,
      diagnostics
    );
    if (!recurrence) {
      continue;
    }
    out.push({
      kind: 'life',
      definitionId: `${SPENDING_DEFINITION_PREFIX}:life:${event.id}`,
      phase: event.cadence === 'recurring' ? 'mandatory' : 'discretionary',
      purpose: 'lifeEventOutflow',
      recurrence,
      resolveRequestedCents: () => requested,
      ...resolveExternalSourcePlan(event.accountId)
    });
  }
};

/** Deterministic list of every spending obligation in a compiled context. */
const buildSpendingDescriptors = (
  context: CompiledScenarioContext,
  anchor: ResolvedSpendingAnchor,
  diagnostics: string[]
): SpendingDescriptor[] => {
  const descriptors: SpendingDescriptor[] = [];
  buildPurchaseDescriptors(context, descriptors);
  buildLongTermDescriptors(context, descriptors);
  buildCareerDescriptors(context, descriptors);
  buildCashflowDescriptors(context, anchor, diagnostics, descriptors);
  buildLifeEventDescriptors(context, anchor, diagnostics, descriptors);
  return descriptors.sort((a, b) => (a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0));
};

// ---------------------------------------------------------------------------
// Public: event definitions
// ---------------------------------------------------------------------------

/**
 * Builds the recurring `EventDefinition`s for the spending stream. Pure: the
 * context is never mutated. Age-only cashflow/life-event outflows are dated from
 * the supplied `anchor` (explicit year-month/marker still wins); an item with no
 * explicit month and no usable anchor is omitted rather than given an invented
 * date, and a diagnostic describing it is appended to `diagnostics` when one is
 * supplied.
 */
export const buildSpendingEventDefinitions = (
  context: CompiledScenarioContext,
  anchor?: SpendingDateAnchor,
  diagnostics: string[] = []
): EventDefinition[] =>
  buildSpendingDescriptors(context, resolveAnchor(context, anchor), diagnostics).map((descriptor) => ({
    definitionId: descriptor.definitionId,
    phase: descriptor.phase,
    purpose: descriptor.purpose,
    priority: 0,
    recurrence: descriptor.recurrence,
    handlerId: SPENDING_HANDLER_IDS[descriptor.kind],
    ...(descriptor.isActive ? { isActive: descriptor.isActive } : {}),
    resolveTarget: (execution) => descriptor.resolveRequestedCents(execution)
  }));

// ---------------------------------------------------------------------------
// Public: handlers
// ---------------------------------------------------------------------------

/**
 * D15 posting provenance for one spending occurrence, taken explicitly from the
 * executing event (never a wall clock or fabricated default). A zero/unfunded/
 * rejected occurrence never reaches `commitFunding`'s commit, so it never
 * fabricates a stamp; only an actually committed plan journals one row.
 */
const spendingPosting = (execution: EventExecutionContext): PostingContext => ({
  occurrenceId: execution.event.occurrenceId,
  definitionId: execution.event.definitionId,
  purpose: execution.event.purpose,
  date: execution.date,
  phase: execution.event.phase
});

const executeDescriptor = (
  descriptor: SpendingDescriptor,
  invocation: ProjectionHandlerInvocation,
  deps: ProjectionHandlerDependencies
): ProjectionExecutionResult => {
  const { execution, targetCents } = invocation;
  if (!Number.isSafeInteger(targetCents) || targetCents <= 0) {
    return { committed: false, plan: null };
  }

  const request: FundingRequest = {
    id: descriptor.definitionId,
    occurrenceId: execution.event.occurrenceId,
    date: execution.date,
    requestedCents: targetCents,
    primaryAccountId: descriptor.primaryAccountId,
    fallbackAccountIds: [...descriptor.fallbackAccountIds],
    purpose: descriptor.purpose
  };

  const quote = quoteFunding(deps.state, request, deps.accounts, deps.dateOfBirth, {
    globalDefaults: descriptor.useGlobalDefaults
      ? {
          primaryAccountId: deps.funding.global.primaryAccountId,
          fallbackAccountIds: [...deps.funding.global.fallbackAccountIds]
        }
      : null,
    perSourceNetQuotaCents: descriptor.perSourceQuotaCents
  });

  if (!quote.ok) {
    return {
      committed: false,
      plan: null,
      quote,
      diagnostics: [`Occurrence "${execution.event.occurrenceId}" is unresolved: ${quote.diagnostic.message}`]
    };
  }

  const plan = quote.plan;
  const quoteDiagnostics = quote.diagnostics.map((diagnostic) => diagnostic.message);
  if (plan.executedCents <= 0 || plan.allocations.length === 0) {
    return {
      committed: false,
      plan,
      quote,
      diagnostics: [
        ...quoteDiagnostics,
        `Occurrence "${execution.event.occurrenceId}" could not be funded: requested ${targetCents}¢, unpaid ${plan.shortfallCents}¢ (no arrears/retry).`
      ]
    };
  }

  const result = commitFunding(deps.state, plan, { posting: spendingPosting(execution) });
  if (!result.committed) {
    return {
      committed: false,
      plan: result.plan ?? plan,
      quote,
      diagnostics: [
        ...quoteDiagnostics,
        `Occurrence "${execution.event.occurrenceId}" funding commit was rejected: ${result.errors
          .map((error) => error.message)
          .join('; ')}`
      ]
    };
  }

  const diagnostics: string[] = [...quoteDiagnostics];
  if (plan.status === 'partial') {
    diagnostics.push(
      `Occurrence "${execution.event.occurrenceId}" partially funded: paid ${plan.executedCents}¢ of ${targetCents}¢ (unpaid ${plan.shortfallCents}¢).`
    );
  }
  return { committed: true, plan: result.plan ?? plan, quote, diagnostics };
};

/**
 * Returns one handler per spending namespace. Each occurrence quotes and commits
 * exactly once through the shared funding kernel; zero/unfunded targets never
 * fabricate a plan row.
 *
 * The age anchor **must match** the one passed to `buildSpendingEventDefinitions`
 * for the same run, so a scheduled age-only occurrence resolves to the same
 * descriptor it was scheduled from. When omitted, it defaults to the dependency
 * date of birth with the context's opening month — never the wall clock.
 */
export const createSpendingHandlers = (
  deps: ProjectionHandlerDependencies,
  anchor?: SpendingDateAnchor
): readonly ProjectionEventHandler[] => {
  const resolvedAnchor = resolveAnchor(
    deps.context,
    anchor ?? { dateOfBirth: deps.dateOfBirth, referenceYearMonth: deps.context.metadata.startYearMonth }
  );
  const byDefinitionId = new Map(
    buildSpendingDescriptors(deps.context, resolvedAnchor, []).map((descriptor) => [descriptor.definitionId, descriptor])
  );
  const kinds: SpendingKind[] = ['purchase', 'longterm', 'career', 'cashflow', 'life'];

  return kinds.map((kind) => ({
    handlerId: SPENDING_HANDLER_IDS[kind],
    execute(invocation: ProjectionHandlerInvocation): ProjectionExecutionResult {
      const descriptor = byDefinitionId.get(invocation.execution.event.definitionId);
      if (!descriptor) {
        return {
          committed: false,
          plan: null,
          diagnostics: [
            `No spending obligation matches "${invocation.execution.event.definitionId}"; skipped.`
          ]
        };
      }
      return executeDescriptor(descriptor, invocation, deps);
    }
  }));
};
