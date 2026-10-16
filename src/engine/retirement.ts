/**
 * P3S.2 — Headless retirement-withdrawal stream (owner: O).
 *
 * Authority: `refactor/phase3_plan.md` P3S.2 + D8/D10, `refactor/phase2_handoff.md`
 * §3 (kernel API), `refactor/frozen_contracts.md` P0.3.2 (event phases / same-date
 * order), P0.3.3 (funding / partial policy), P0.3.4 (cents rounding),
 * P0.5.1/P0.5.4 (withdrawal basis, HSA purpose/age), ADR-021, and the settled
 * P2.4 funding / P2.6 scheduler / P2.7 facade lanes.
 *
 * This module owns **only** the retirement withdrawal source rows
 * (`WithdrawalPlan.sourceLines`, `RetirementWithdrawalSourceLine`). It is a pure
 * stream in the D10 handler-seam pattern:
 *
 * - `buildRetirementEventDefinitions(context)` returns the recurring
 *   `EventDefinition`s (namespace `retirement:<sourceId>`), phase `mandatory`,
 *   purpose `retirement`, monthly on the source's `paymentDay` (day-31 clamps).
 * - `createRetirementHandlers(deps)` returns the `ProjectionEventHandler`s that
 *   execute them. Each occurrence resolves its **actual integer-cent target** from
 *   the then-current world and quotes/commits through the shared funding kernel
 *   (`quoteFunding`/`commitFunding` → the state owner's sole `commitChanges`). A
 *   zero/unfunded target never fabricates a plan row.
 *
 * ### Target semantics
 *
 * - `mode: 'amount'` — a fixed annual net spending amount.
 * - `mode: 'percentOfInitialBalance'` — `initialWithdrawalRatePercent`
 *   (default 4, explicit 0 valid) applied to the account's **authoritative
 *   observed balance at the source's valuation date**, which defaults to that
 *   source's own `firstWithdrawalDate` (including later-start sources) and can be
 *   set explicitly via `initialWithdrawalValuationDate`.
 * - The initial annual target is **frozen** once observed, then escalated by the
 *   configured inflation rate and clamped to the configured yearly min/max. The
 *   monthly request uses the P0.3.4 cumulative-cent schedule: occurrence `k` of a
 *   period requests `shareAt(target, k)`, so the twelve shares of an annual target
 *   reconcile exactly and the schedule resets whenever the annual target changes
 *   (a new plan/period or an inflation step).
 *
 * ### Basis observation (no invented balance)
 *
 * The kernel holds exactly two authoritative account observations: the opening
 * snapshot (`context.opening`, at `metadata.startYearMonth`) and the live state
 * balance at the moment an occurrence executes. A percentage basis is therefore
 * resolved only when the valuation month is the source's **first execution month**
 * (live balance) or the **opening month** (opening balance). Any other basis date
 * (an invented past/future balance) is reported as a **diagnostic** and no
 * withdrawal is fabricated — never approximated.
 *
 * ### Funding (D8)
 *
 * A retirement request is `purpose: 'retirement'` and is funded from the
 * **fully pinned, explicit ordered list**: the source's own account, its
 * per-source `fallbackAccountIds`, then the global retirement
 * `withdrawal.fallbackAccountIds`. Because the list is explicit, a pinned
 * fallback with `allowAutomaticFallback === false` still funds (D8). The ordinary
 * global funding policy is **never** consulted for retirement.
 *
 * ### Interpretation
 *
 * Retirement withdrawals are **net additional living spending**: the executed net
 * is posted only through gross account debits with separately rounded
 * tax/penalty (`quoteFunding`); this stream never deposits or transfers income.
 * Partial/unpaid outcomes are surfaced as diagnostics distinct from ledger
 * depletion, and nothing is retried.
 *
 * This module is pure with respect to the caller's `Scenario` and the compiled
 * context; the only mutation is through `commitFunding` → `state.commitChanges`.
 */

import type { RetirementWithdrawalMode, RetirementWithdrawalSourceLine } from '../types';
import type { CompiledScenarioContext } from './configuration';
import {
  diffMonths,
  isValidDateOnly,
  isValidYearMonth,
  parseDateOnly,
  type DateOnly,
  type YearMonth
} from './dates';
import {
  createCumulativeShareSchedule,
  dollarsToCents,
  roundHalfAwayFromZero,
  shareAt,
  type Cents
} from './money';
import { exactRateFromPercent, roundRationalHalfAwayFromZero } from './taxes';
import type { FundingRequest } from './contracts';
import type { PostingContext } from './journal';
import { commitFunding, quoteFunding, RETIREMENT_FUNDING_PURPOSE } from './funding';
import type { EventDefinition, EventExecutionContext, EventPhase, RecurrenceSpec } from './scheduler';
import type {
  ProjectionEventHandler,
  ProjectionHandlerDependencies,
  ProjectionExecutionResult,
  ProjectionHandlerInvocation
} from './projection';

/** Definition-ID namespace prefix for the retirement stream. */
export const RETIREMENT_DEFINITION_PREFIX = 'retirement';

/** The single retirement handler id (one namespace; descriptors keyed by id). */
export const RETIREMENT_HANDLER_ID = 'retirement.withdrawal';

/** Same-date phase for retirement spending (P0.3.2 `mandatory`). */
export const RETIREMENT_PHASE: EventPhase = 'mandatory';

/** Contractual new-item default for a percentage source (explicit 0 is valid). */
export const DEFAULT_INITIAL_WITHDRAWAL_RATE_PERCENT = 4;

/** Stable definition id for one retirement source row. */
export const retirementDefinitionId = (sourceId: string): string =>
  `${RETIREMENT_DEFINITION_PREFIX}:${sourceId}`;

/**
 * Optional, non-persisted processor inputs. The persisted
 * `RetirementWithdrawalSourceLine` intentionally carries no per-row inflation or
 * cap; these come from the global withdrawal plan and the (non-timeline) manual
 * returns, which are supplied here so the stream stays self-contained.
 */
export interface RetirementProcessorOptions {
  /** Annual inflation (%) applied to a source's frozen annual target. Default 0. */
  readonly inflationRatePercent?: number;
  /** Overrides the withdrawal plan's yearly minimum (cents). */
  readonly minimumYearlyWithdrawalCents?: number;
  /** Overrides the withdrawal plan's yearly maximum (cents). `<= 0` means no cap. */
  readonly maximumYearlyWithdrawalCents?: number;
  /**
   * Explicit HSA medical qualification per source id. Qualification is **never**
   * inferred from an account type, category, label or restriction note
   * (P0.5.4); absent/`false` means non-qualified.
   */
  readonly hsaQualifiedMedicalBySourceId?: Readonly<Record<string, boolean>>;
}

// ---------------------------------------------------------------------------
// Internal descriptor (shared by definition and handler builders)
// ---------------------------------------------------------------------------

interface RetirementTargetContext {
  readonly sourceStartYearMonth: YearMonth;
  readonly horizonEndYearMonth: YearMonth;
  readonly inflationRatePercent: number;
  /** Annual floor in cents (>= 0). */
  readonly minimumAnnualCents: number;
  /** Annual cap in cents, or `null` for no cap. */
  readonly maximumAnnualCents: number | null;
}

interface RetirementDescriptor {
  readonly sourceId: string;
  readonly definitionId: string;
  readonly accountId: string;
  readonly mode: RetirementWithdrawalMode;
  readonly amountCents: Cents;
  readonly ratePercent: number;
  readonly firstWithdrawalDate: DateOnly;
  readonly valuationDate: DateOnly;
  readonly paymentDay: number;
  /** Explicit ordered account list (D8): own account → per-source → global retirement. */
  readonly orderedAccountIds: readonly string[];
  readonly hsaQualifiedMedical: boolean;
  readonly recurrence: RecurrenceSpec;
  readonly targetContext: RetirementTargetContext;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

/** Non-negative integer cents from a persisted dollar amount; `0` when invalid. */
const centsFromDollars = (dollars: number): Cents => {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars <= 0) {
    return 0;
  }
  return dollarsToCents(dollars);
};

const finiteNonNegative = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * A finite, non-negative rate, else `fallback`. Unlike {@link finiteNonNegative},
 * a valid explicit `0` is preserved (0% is intentional, CA07/P0.5.1) and a missing
 * or non-finite value takes the contractual default. Negative values clamp to 0 to
 * mirror the persisted-codec normalization.
 */
const finiteNonNegativeOrDefault = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value >= 0 ? value : 0;
};

const dedupe = (values: readonly (string | null | undefined)[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
};

const clampPaymentDay = (day: number | null | undefined, fallback: number): number => {
  const resolved = typeof day === 'number' && Number.isFinite(day) ? Math.floor(day) : fallback;
  return clamp(resolved, 1, 31);
};

/** Month of a date-only string, or `null` when absent/invalid. */
const yearMonthOf = (date: DateOnly | null | undefined): YearMonth | null => {
  if (typeof date !== 'string' || !isValidDateOnly(date)) {
    return null;
  }
  return date.slice(0, 7);
};

// ---------------------------------------------------------------------------
// Descriptor collection
// ---------------------------------------------------------------------------

const normalizedOptions = (
  options: RetirementProcessorOptions | undefined
): {
  readonly inflationRatePercent: number;
  readonly minimumAnnualCents: Cents | null;
  readonly maximumAnnualCents: Cents | null;
  readonly hsaBySourceId: Readonly<Record<string, boolean>>;
} => ({
  inflationRatePercent: finiteNonNegative(options?.inflationRatePercent),
  minimumAnnualCents:
    options?.minimumYearlyWithdrawalCents === undefined
      ? null
      : finiteNonNegative(options.minimumYearlyWithdrawalCents),
  maximumAnnualCents:
    options?.maximumYearlyWithdrawalCents === undefined
      ? null
      : finiteNonNegative(options.maximumYearlyWithdrawalCents),
  hsaBySourceId: options?.hsaQualifiedMedicalBySourceId ?? {}
});

/** Resolves the ordered, deduplicated retirement fallback list for one source (D8). */
const resolveOrderedAccountIds = (
  context: CompiledScenarioContext,
  line: RetirementWithdrawalSourceLine
): string[] => {
  const compiled = context.funding.retirement.sources.find((source) => source.sourceId === line.id);
  const perSource = compiled ? compiled.fallbackAccountIds : line.fallbackAccountIds ?? [];
  return dedupe([
    line.accountId,
    ...perSource,
    ...context.funding.retirement.fallbackAccountIds
  ]);
};

/**
 * Start month of a source: the explicit `startMarkerId` when the marker exists in
 * this context, else the `firstWithdrawalDate` month. A dangling marker never
 * invents a date — the configured first withdrawal date is used.
 */
const resolveStartYearMonth = (
  context: CompiledScenarioContext,
  line: RetirementWithdrawalSourceLine
): YearMonth | null => {
  const markerId = typeof line.startMarkerId === 'string' ? line.startMarkerId : '';
  if (markerId.length > 0) {
    const marker = context.markers.find((candidate) => candidate.id === markerId);
    const markerMonth = marker ? yearMonthOf(marker.date) : null;
    if (markerMonth !== null) {
      return markerMonth;
    }
  }
  return yearMonthOf(line.firstWithdrawalDate);
};

const buildDescriptor = (
  context: CompiledScenarioContext,
  line: RetirementWithdrawalSourceLine,
  options: ReturnType<typeof normalizedOptions>
): RetirementDescriptor | null => {
  if (line.enabled === false) {
    return null;
  }
  if (typeof line.accountId !== 'string' || line.accountId.length === 0) {
    return null;
  }
  if (!isValidDateOnly(line.firstWithdrawalDate)) {
    return null;
  }
  const sourceStartYearMonth = resolveStartYearMonth(context, line);
  if (sourceStartYearMonth === null || !isValidYearMonth(sourceStartYearMonth)) {
    return null;
  }

  const valuationDate =
    typeof line.initialWithdrawalValuationDate === 'string' &&
    isValidDateOnly(line.initialWithdrawalValuationDate)
      ? line.initialWithdrawalValuationDate
      : line.firstWithdrawalDate;

  const startParts = parseDateOnly(line.firstWithdrawalDate);
  const paymentDay = clampPaymentDay(line.paymentDay, startParts ? startParts.day : 1);

  const horizonEndYearMonth = context.metadata.endYearMonth;
  if (diffMonths(sourceStartYearMonth, horizonEndYearMonth) < 0) {
    // The source starts after the horizon: nothing to schedule.
    return null;
  }

  const mode: RetirementWithdrawalMode =
    line.mode === 'percentOfInitialBalance' ? 'percentOfInitialBalance' : 'amount';

  const withdrawal = context.global.withdrawal;
  const minimumAnnualCents =
    options.minimumAnnualCents ?? centsFromDollars(withdrawal?.minimumYearlyWithdrawal ?? 0);
  const resolvedMaximum = options.maximumAnnualCents;
  const configuredMaximum = centsFromDollars(withdrawal?.maximumYearlyWithdrawal ?? 0);
  const maximumAnnualCents =
    resolvedMaximum !== null
      ? resolvedMaximum > 0
        ? resolvedMaximum
        : null
      : configuredMaximum > 0
        ? configuredMaximum
        : null;

  return {
    sourceId: line.id,
    definitionId: retirementDefinitionId(line.id),
    accountId: line.accountId,
    mode,
    amountCents: centsFromDollars(line.amount),
    // Absent rate takes the contractual new-item default (4%); an explicit 0 is
    // preserved as a zero withdrawal (CA07/P0.5.1).
    ratePercent: finiteNonNegativeOrDefault(
      line.initialWithdrawalRatePercent,
      DEFAULT_INITIAL_WITHDRAWAL_RATE_PERCENT
    ),
    firstWithdrawalDate: line.firstWithdrawalDate,
    valuationDate,
    paymentDay,
    orderedAccountIds: resolveOrderedAccountIds(context, line),
    hsaQualifiedMedical: options.hsaBySourceId[line.id] === true,
    recurrence: {
      frequency: 'monthly',
      startDate: `${sourceStartYearMonth}-01`,
      endDate: context.metadata.endDate,
      dayOfMonth: paymentDay
    },
    targetContext: {
      sourceStartYearMonth,
      horizonEndYearMonth,
      inflationRatePercent: options.inflationRatePercent,
      minimumAnnualCents,
      maximumAnnualCents
    }
  };
};

/** Deterministic descriptors for every schedulable retirement source. */
const buildDescriptors = (
  context: CompiledScenarioContext,
  options?: RetirementProcessorOptions
): RetirementDescriptor[] => {
  const normalized = normalizedOptions(options);
  const lines = context.global.withdrawal?.sourceLines ?? [];
  const descriptors: RetirementDescriptor[] = [];
  for (const line of lines) {
    const descriptor = buildDescriptor(context, line, normalized);
    if (descriptor) {
      descriptors.push(descriptor);
    }
  }
  return descriptors.sort((a, b) => (a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0));
};

// ---------------------------------------------------------------------------
// Target scheduling (P0.3.4 cumulative cents)
// ---------------------------------------------------------------------------

/** Number of scheduled occurrences in the 12-month period `yearIndex`. */
const occurrenceCountForYear = (yearIndex: number, target: RetirementTargetContext): number => {
  const totalMonths =
    diffMonths(target.sourceStartYearMonth, target.horizonEndYearMonth) + 1;
  const remaining = totalMonths - yearIndex * 12;
  return clamp(remaining, 1, 12);
};

/**
 * The frozen annual target escalated by inflation and clamped to the configured
 * yearly min/max. `baseCents` is the frozen initial target (before caps).
 */
export const annualRetirementTargetCents = (
  baseCents: Cents,
  yearIndex: number,
  context: RetirementTargetContext
): Cents => {
  if (!Number.isSafeInteger(baseCents) || baseCents <= 0) {
    return 0;
  }
  const years = Number.isSafeInteger(yearIndex) && yearIndex > 0 ? yearIndex : 0;
  const inflated =
    years > 0 && context.inflationRatePercent > 0
      ? roundHalfAwayFromZero(baseCents * Math.pow(1 + context.inflationRatePercent / 100, years))
      : baseCents;
  const maximum = context.maximumAnnualCents ?? Number.MAX_SAFE_INTEGER;
  return clamp(Math.max(0, inflated), context.minimumAnnualCents, maximum);
};

/**
 * Requested net cents for one occurrence, given a frozen basis (or `null` when
 * the percentage basis could not be observed). The `occurrenceIndex` is 1-based
 * and continuous across the source's monthly recurrence; period `yearIndex`
 * contains occurrences `12·yearIndex + 1 … 12·yearIndex + 12` (the final period
 * may be partial and is prorated to its actual count).
 */
export const requestedRetirementTargetCents = (
  descriptor: Pick<RetirementDescriptor, 'mode' | 'amountCents' | 'targetContext'>,
  occurrenceIndex: number,
  baseCents: Cents | null
): Cents => {
  const base = descriptor.mode === 'amount' ? descriptor.amountCents : baseCents;
  if (base === null || !Number.isSafeInteger(base) || base <= 0) {
    return 0;
  }
  if (!Number.isSafeInteger(occurrenceIndex) || occurrenceIndex < 1) {
    return 0;
  }
  const yearIndex = Math.floor((occurrenceIndex - 1) / 12);
  const monthIndex = ((occurrenceIndex - 1) % 12) + 1;
  const annual = annualRetirementTargetCents(base, yearIndex, descriptor.targetContext);
  if (annual <= 0) {
    return 0;
  }
  const count = occurrenceCountForYear(yearIndex, descriptor.targetContext);
  const schedule = createCumulativeShareSchedule(annual, count);
  return shareAt(schedule, Math.min(monthIndex, count));
};

// ---------------------------------------------------------------------------
// Basis observation
// ---------------------------------------------------------------------------

type BasisObservation =
  | { readonly ok: true; readonly cents: Cents }
  | { readonly ok: false; readonly message: string };

/**
 * Observes the source account's authoritative balance at its valuation date.
 *
 * Only two observations exist: the live state balance in the source's first
 * execution month, and the opening snapshot in the opening month. Every other
 * valuation month has no authoritative per-account observation and is reported,
 * never approximated.
 */
const observeBasisBalanceCents = (
  descriptor: RetirementDescriptor,
  execution: EventExecutionContext,
  deps: ProjectionHandlerDependencies
): BasisObservation => {
  const basisMonth = yearMonthOf(descriptor.valuationDate);
  if (basisMonth === null) {
    return {
      ok: false,
      message: `Retirement source "${descriptor.sourceId}" has an invalid valuation date "${descriptor.valuationDate}".`
    };
  }

  if (basisMonth === execution.yearMonth) {
    const cents = deps.state.getAccountBalanceCents(descriptor.accountId);
    if (cents === undefined) {
      return {
        ok: false,
        message: `Retirement source "${descriptor.sourceId}" references account "${descriptor.accountId}" which is not in the projection state.`
      };
    }
    return { ok: true, cents };
  }

  if (basisMonth === deps.context.metadata.startYearMonth) {
    const account = deps.context.getAccount(descriptor.accountId);
    if (!account) {
      return {
        ok: false,
        message: `Retirement source "${descriptor.sourceId}" references account "${descriptor.accountId}" which is not configured.`
      };
    }
    return { ok: true, cents: centsFromDollars(account.openingBalance) };
  }

  return {
    ok: false,
    message:
      `Retirement source "${descriptor.sourceId}" has valuation date ${descriptor.valuationDate} (${basisMonth}), ` +
      `which is neither its first withdrawal month (${execution.yearMonth}) nor the opening month ` +
      `(${deps.context.metadata.startYearMonth}); no authoritative balance observation exists, so the ` +
      `initial percentage target is unresolved rather than approximated.`
  };
};

/** Percentage initial target: observed balance × rate, exact rational rounding. */
const initialPercentTargetCents = (balanceCents: Cents, ratePercent: number): Cents => {
  if (!Number.isSafeInteger(balanceCents) || balanceCents <= 0 || ratePercent <= 0) {
    return 0;
  }
  const rate = exactRateFromPercent(ratePercent);
  const numerator = BigInt(balanceCents) * rate.numerator;
  const rounded = roundRationalHalfAwayFromZero(numerator, rate.denominator);
  const cents = Number(rounded);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : 0;
};

// ---------------------------------------------------------------------------
// Public: event definitions
// ---------------------------------------------------------------------------

/**
 * Builds the recurring `EventDefinition`s for the retirement stream. Pure: the
 * compiled context is never mutated and invalid/undated sources are omitted
 * rather than given an invented date. The scheduler-only resolver reports
 * amount-mode targets; percentage mode requires the state-aware handler (P2.7),
 * so it resolves to `0` there.
 */
export const buildRetirementEventDefinitions = (
  context: CompiledScenarioContext,
  options?: RetirementProcessorOptions
): EventDefinition[] =>
  buildDescriptors(context, options).map((descriptor) => ({
    definitionId: descriptor.definitionId,
    phase: RETIREMENT_PHASE,
    purpose: RETIREMENT_FUNDING_PURPOSE,
    priority: 0,
    recurrence: descriptor.recurrence,
    handlerId: RETIREMENT_HANDLER_ID,
    resolveTarget: (execution) =>
      requestedRetirementTargetCents(descriptor, execution.occurrenceIndex, null)
  }));

// ---------------------------------------------------------------------------
// Public: handlers
// ---------------------------------------------------------------------------

const sumOrderedBalances = (deps: ProjectionHandlerDependencies, accountIds: readonly string[]): Cents => {
  let total = 0;
  for (const accountId of accountIds) {
    const balance = deps.state.getAccountBalanceCents(accountId);
    if (typeof balance === 'number' && Number.isFinite(balance) && balance > 0) {
      total += balance;
    }
  }
  return total;
};

/**
 * D15 posting provenance for one retirement occurrence, taken explicitly from
 * the executing event (never a wall clock or fabricated default). A zero/
 * unfunded/rejected occurrence never commits, so it never fabricates a stamp;
 * only an actually committed withdrawal journals exactly one indexed row.
 */
const retirementPosting = (execution: EventExecutionContext): PostingContext => ({
  occurrenceId: execution.event.occurrenceId,
  definitionId: execution.event.definitionId,
  purpose: execution.event.purpose,
  date: execution.date,
  phase: execution.event.phase
});

const executeDescriptor = (
  descriptor: RetirementDescriptor,
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
    primaryAccountId: descriptor.accountId,
    fallbackAccountIds: descriptor.orderedAccountIds.filter((id) => id !== descriptor.accountId),
    purpose: RETIREMENT_FUNDING_PURPOSE,
    hsaQualifiedMedical: descriptor.hsaQualifiedMedical
  };

  // D8: the fully pinned retirement list is supplied explicitly; the ordinary
  // global funding policy is never consulted and no automatic-fallback gate
  // removes an explicitly chosen position.
  const quote = quoteFunding(deps.state, request, deps.accounts, deps.dateOfBirth, {
    retirementOrderedList: descriptor.orderedAccountIds
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
    const availableCents = sumOrderedBalances(deps, descriptor.orderedAccountIds);
    const reason =
      availableCents <= 0
        ? 'every listed account is depleted (0 available)'
        : 'the listed accounts could not supply the requested net';
    return {
      committed: false,
      plan,
      quote,
      diagnostics: [
        ...quoteDiagnostics,
        `Retirement source "${descriptor.sourceId}" was ${availableCents <= 0 ? 'depleted' : 'unfunded'} on ${execution.date}: requested ${targetCents}¢, paid 0¢ (${reason}; no automatic retry).`
      ]
    };
  }

  const result = commitFunding(deps.state, plan, { posting: retirementPosting(execution) });
  if (!result.committed) {
    return {
      committed: false,
      plan: result.plan ?? plan,
      quote,
      diagnostics: [
        ...quoteDiagnostics,
        `Retirement source "${descriptor.sourceId}" funding commit was rejected on ${execution.date}: ${result.errors
          .map((error) => error.message)
          .join('; ')}`
      ]
    };
  }

  const diagnostics: string[] = [...quoteDiagnostics];
  if (plan.status === 'partial') {
    diagnostics.push(
      `Retirement source "${descriptor.sourceId}" partially funded on ${execution.date}: paid ${plan.executedCents}¢ of ${targetCents}¢ (unpaid ${plan.shortfallCents}¢; no automatic retry).`
    );
  }
  return { committed: true, plan: result.plan ?? plan, quote, diagnostics };
};

/**
 * Returns the retirement handler(s) for one run. Each occurrence resolves its
 * actual target (observing the percentage basis lazily on first execution) and
 * quotes/commits exactly once through the shared funding kernel; zero/unfunded
 * targets never fabricate a plan row.
 */
export const createRetirementHandlers = (
  deps: ProjectionHandlerDependencies,
  options?: RetirementProcessorOptions
): readonly ProjectionEventHandler[] => {
  const descriptors = buildDescriptors(deps.context, options);
  const byDefinitionId = new Map(descriptors.map((descriptor) => [descriptor.definitionId, descriptor]));

  // Frozen percentage bases, keyed by source id. A source whose basis cannot be
  // observed is frozen to `null` (target 0 forever) and its diagnostic is emitted
  // exactly once — later occurrences are silent no-ops, never repeated throws.
  //
  // Emission seam limitation (report, do not fabricate): `resolveTarget` may only
  // return cents, and the facade short-circuits a zero target *before* `execute`,
  // which is the sole handler channel for `diagnostics`. There is therefore no way
  // to surface a structured diagnostic from the resolver within this module: the
  // single typed `RangeError` below is caught by the facade (`projectScenario`
  // records `Occurrence "<id>" target could not be resolved: <message>`) and is the
  // only in-seam emission path. It fires once per source, never per month.
  const frozenBasis = new Map<string, Cents | null>();
  const failedBasis = new Set<string>();

  const resolveBasis = (descriptor: RetirementDescriptor, execution: EventExecutionContext): Cents | null => {
    if (frozenBasis.has(descriptor.sourceId)) {
      return frozenBasis.get(descriptor.sourceId) ?? null;
    }
    const observation = observeBasisBalanceCents(descriptor, execution, deps);
    if (!observation.ok) {
      frozenBasis.set(descriptor.sourceId, null);
      if (!failedBasis.has(descriptor.sourceId)) {
        failedBasis.add(descriptor.sourceId);
        throw new RangeError(observation.message);
      }
      return null;
    }
    const frozen = initialPercentTargetCents(observation.cents, descriptor.ratePercent);
    frozenBasis.set(descriptor.sourceId, frozen);
    return frozen;
  };

  const handler: ProjectionEventHandler = {
    handlerId: RETIREMENT_HANDLER_ID,
    resolveTarget(execution, runDeps): Cents {
      const descriptor = byDefinitionId.get(execution.event.definitionId);
      if (!descriptor) {
        return 0;
      }
      const base = descriptor.mode === 'amount' ? null : resolveBasis(descriptor, execution);
      return requestedRetirementTargetCents(descriptor, execution.occurrenceIndex, base);
    },
    execute(invocation): ProjectionExecutionResult {
      const descriptor = byDefinitionId.get(invocation.execution.event.definitionId);
      if (!descriptor) {
        return {
          committed: false,
          plan: null,
          diagnostics: [
            `No retirement source matches "${invocation.execution.event.definitionId}"; skipped.`
          ]
        };
      }
      return executeDescriptor(descriptor, invocation, deps);
    }
  };

  return [handler];
};

/** The retirement stream's `ProjectionHandlerFactory` (compose into the run seam). */
export const createRetirementHandlerFactory =
  (options?: RetirementProcessorOptions) =>
  (deps: ProjectionHandlerDependencies): readonly ProjectionEventHandler[] =>
    createRetirementHandlers(deps, options);
