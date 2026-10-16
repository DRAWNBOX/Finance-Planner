/**
 * P2.7 — `projectScenario` facade over the deterministic kernel (K + Q).
 *
 * This module is the public orchestration entry point approved by D6: it
 * **replaces** the removed pool-era engine. It is a thin facade —
 *
 *   compileContext (P2.5) → buildState (P2.2)
 *     → createScheduler (P2.6) → post events through handlers (P2.2/P2.4)
 *     → account month-close APY valuation (this module, via `valuation.ts`)
 *     → read-only report assembly
 *
 * — and it owns **no financial rules of its own**. Income, payroll, cards,
 * loans, housing, purchases, retirement withdrawals and reporting are Phase 3/4;
 * this facade is intentionally *kernel-only* and says so explicitly.
 *
 * ### Truthful output contract
 *
 * `projectScenario` returns a **cents-only `ProjectionRun`** (never the legacy
 * `ProjectionResult`):
 *
 * - `complete` (the kernel-only default is `false`) plus `featureCoverage` state
 *   exactly what is and is not modelled. There are **no fabricated income
 *   reservoirs, no fake pool maps and no wall clock**. With no injected events
 *   the run performs only account month-close APY valuation.
 * - `metadata` carries measurement, start/end, the compiled-context schema
 *   version and the engine revision; `opening` carries the observed opening
 *   snapshot in cents.
 * - `monthlyCloses` is an eager, inclusive, full-horizon close per month
 *   (960 by default — never silently shortened). Each close carries a full
 *   account/liability/property (+held-deposit) `snapshot` and aggregate `totals`
 *   captured **once** at that close (P4.2). Events are scheduled lazily by
 *   the P2.6 scheduler; only **actually executed** funding plans are recorded as
 *   audit (`plans`), never a fabricated per-event row. A committed direct
 *   `state.commitChanges` posting with no plan (income/cap/other deposit, debt
 *   accrual, appreciation, sale) is counted in that month's `executedEventCount`
 *   / `executedOccurrenceIds` but **never** fabricates a funding plan or audit
 *   row and emits no warning (D10).
 * - `postings` is the complete, non-truncated D15 journal (`state.getPostings()`),
 *   copied once at run end: one deep-frozen record per committed change. The
 *   month-close APY commit is stamped `{ purpose: 'valuation', phase: 'close',
 *   date: closeEnd }`. Rejected commits leave no row.
 * - `fundingOutcomes` records **every positive funding quote** a handler returned
 *   (committed or not, including an unfunded/zero-allocation quote), with the
 *   eligible-source balances sampled at outcome time (D16 evidence). It is
 *   separate from the committed-only `plans` audit.
 * - `totals` are integer cents; `diagnostics` are deterministic.
 *
 * ### Start date and horizon
 *
 * The default start is the **authoritative opening observation date**
 * (`compileScenarioContext`); an absent/invalid observation is an explicit
 * {@link ProjectionError} rather than a fabricated `today`. The horizon defaults
 * to `FULL_HORIZON_MONTHS` (960) and is only shortened when the caller passes an
 * explicit `horizonMonths`.
 *
 * ### Account APY
 *
 * Accounts grow by the exact effective annual percentage yield, using
 * `(1 + annualRate)^(1/12) − 1` (`valuation.ts`), the selected retirement rate
 * override when `ratePhase === 'retirement'`, and a clipped partial-month
 * exponent for the first month when the start date is mid-month. The final
 * posting is converted to safe integer cents **exactly once** and committed
 * through `state.commitChanges` with `expectedNetWorthDeltaCents`. Property
 * appreciation and debt-interest accrual are deferred to P3H/P3D and are **not**
 * duplicated here.
 *
 * ### Handler seam
 *
 * Phase-3 processors are injected as {@link ProjectionEventHandler}s produced by
 * a {@link ProjectionHandlerFactory}. The facade drives the real scheduler for
 * batching/ordering and target resolution; the injected handler performs the
 * real `quoteFunding` / `commitFunding` and therefore exercises CA03/CA04 against
 * the actual state owner. Mutation happens only through `state.commitChanges`.
 *
 * A handler may optionally expose `resolveTarget(execution, deps)`; the facade
 * calls it just before execution (after earlier same-date commits) so cards/loans/
 * PMI can compute a state-aware target. Handlers without it fall back to the
 * scheduler's definition resolver. When no `handlerFactory` is supplied the
 * default composition seam ({@link createDefaultHandlerFactory}) yields no
 * processors and `featureCoverage.processors` stays `false`.
 *
 * Authority: `refactor/phase2_plan.md` D6/P2.7, `refactor/frozen_contracts.md`
 * P0.3.1 item 11 / P0.3.2 / P0.3.3 / P0.3.5, ADR-020/021/022, and the settled
 * P2.1–P2.6 kernel lanes (`dates.ts`, `money.ts`, `state.ts`, `taxes.ts`,
 * `funding.ts`, `configuration.ts`, `scheduler.ts`).
 */

import type { AccountDefinition, MeasurementBasis, OpeningMeasurement, Scenario } from '../types';
import {
  compileScenarioContext,
  ContextValidationError,
  type AccountRatePhase,
  type CompiledFundingSources,
  type CompiledScenarioContext
} from './configuration';
import { compareDateOnly, endOfMonthDate, fromMonthOrdinal, type DateOnly, type YearMonth } from './dates';
import type { Cents } from './money';
import type { FundingPlan, FundingStatus, SkippedFundingSource } from './contracts';
import {
  buildState,
  type AccountChange,
  type EngineState,
  type StateSnapshot,
  type StateTotals
} from './state';
import {
  createScheduler,
  type EventDefinition,
  type EventExecutionContext,
  type EventPhase,
  type ScheduleWindow,
  type ScheduledEvent
} from './scheduler';
import type { FundingQuoteResult } from './funding';
import type { PostingRecord } from './journal';
import { monthFractionForDates, quoteAccountMonthClose, type AccountMonthClose } from './valuation';

// ---------------------------------------------------------------------------
// Engine identity + explicit feature coverage
// ---------------------------------------------------------------------------

/** Engine revision stamped on every run; bump when the facade output changes. */
export const PROJECTION_ENGINE_REVISION = 'p2.7-kernel-1';

/**
 * Measurement basis of every run's money values (D20). A canonical projection's
 * annual points are signed net worth (`netWorthCents = accountAssets −
 * liabilities`, possibly negative), so {@link ProjectionRunMetadata.measurement}
 * is always this label. The **observed opening** keeps its own legacy basis
 * (`assetOnly` when no opening snapshot exists) on
 * {@link ProjectionOpening.measurement}; the two are never conflated.
 */
export const CANONICAL_RUN_MEASUREMENT: MeasurementBasis = 'assetsMinusLiabilities';

/**
 * Feature domains intentionally deferred to Phase 3 (processors) / Phase 4
 * (reporting). Listed so a consumer can never mistake a kernel-only run for a
 * complete projection.
 */
export const DEFERRED_FEATURE_DOMAINS: readonly string[] = Object.freeze([
  'payroll',
  'otherIncome',
  'creditCards',
  'loans',
  'housing',
  'largePurchases',
  'longTermPurchases',
  'retirementWithdrawals',
  'planner',
  'propertyAppreciation',
  'debtInterestAccrual',
  'reporting'
]);

/**
 * Feature coverage flags. The raw facade reports `processors`/`reporting` as
 * `false`; a composed call site that actually wired every Phase-3 stream and
 * will build a Phase-4 report asserts the truth through
 * {@link ProjectionCoverageClaim} and the facade honours it honestly (D23).
 */
export interface ProjectionFeatureCoverage {
  /** The deterministic kernel (dates/money/state/taxes/funding/configuration/scheduler) is present. */
  readonly kernel: true;
  /** Phase-3 feature processors are present for this run. */
  readonly processors: boolean;
  /** Phase-4 reporting is present for this run. */
  readonly reporting: boolean;
  /** Account month-close APY valuation is present. */
  readonly accountValuation: true;
  /** Domains not modelled by this run. */
  readonly deferred: readonly string[];
}

/**
 * D23 call-site coverage claim. The **kernel-only** facade never invents one: a
 * claim is only supplied by a composed wrapper (`featureHandlers.ts`) that has
 * actually assembled every Phase-3 stream's handlers and will build exactly one
 * Phase-4 report from the returned run. The facade treats the claim as
 * *scoped to this call site* and still decides {@link ProjectionRun.complete}
 * honestly — a claim is honoured only when the run covers the full requested
 * horizon and no scheduled occurrence was blocked for lack of a handler.
 */
export interface ProjectionCoverageClaim {
  /** The caller asserts every Phase-3 processor domain is wired for this run. */
  readonly processors: boolean;
  /** The caller asserts a Phase-4 report is (or will be) built from this run. */
  readonly reporting: boolean;
  /**
   * Any domains the caller still defers. When omitted the kernel default list
   * ({@link DEFERRED_FEATURE_DOMAINS}) is used; a complete claim should pass `[]`.
   */
  readonly deferred?: readonly string[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ProjectionErrorCode = 'context' | 'state' | 'options';

/** Thrown when a run cannot be assembled without inventing input. */
export class ProjectionError extends Error {
  readonly code: ProjectionErrorCode;

  constructor(code: ProjectionErrorCode, message: string) {
    super(message);
    this.name = 'ProjectionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Handler seam (Phase-3 processors)
// ---------------------------------------------------------------------------

/** Live dependencies handed to a handler factory exactly once, before iteration. */
export interface ProjectionHandlerDependencies {
  /** The sole mutable state owner; handlers must post through `commitChanges`. */
  readonly state: EngineState;
  readonly context: CompiledScenarioContext;
  /** Configured account definitions (for `quoteFunding` eligibility/policy/rates). */
  readonly accounts: readonly AccountDefinition[];
  /** Configured date of birth, or `null` — never inferred. */
  readonly dateOfBirth: string | null;
  /** Compiled ordered funding sources (global, retirement, per-obligation). */
  readonly funding: CompiledFundingSources;
}

/** One handler invocation: the scheduled occurrence, its target and live deps. */
export interface ProjectionHandlerInvocation {
  readonly execution: EventExecutionContext;
  /** Dynamic execution-time net target in integer cents. */
  readonly targetCents: Cents;
  readonly deps: ProjectionHandlerDependencies;
}

/** A handler's outcome for one occurrence. Only committed plans become audit. */
export interface ProjectionExecutionResult {
  readonly committed: boolean;
  /** The committed plan (required when `committed` and something was executed). */
  readonly plan?: FundingPlan | null;
  /**
   * OPTIONAL full quote the handler produced, funded or not (P4.1/D16). When
   * present the facade records a {@link ProjectionFundingOutcome} even for a
   * non-committed / unfunded quote with zero allocations, so reporting selects
   * shortfall/exhaustion from actual evidence rather than re-running funding.
   * A handler that only returns `plan` still gets an outcome from that plan.
   */
  readonly quote?: FundingQuoteResult | null;
  /** Non-fatal notes; never changes math. */
  readonly diagnostics?: readonly string[];
}

/** Phase-3 processor contract consumed by the facade. */
export interface ProjectionEventHandler {
  readonly handlerId: string;
  /**
   * OPTIONAL state-aware target resolver. When present, the facade calls it
   * **just before execution** (after any earlier same-date occurrence has already
   * committed), so a card/loan/PMI handler can compute its net target from the
   * then-current balance/debt rather than a value cached at scheduling time.
   *
   * When absent the facade falls back to the scheduler's definition resolver
   * (`definition.resolveTarget`) for backward compatibility with existing
   * handlers. A resolved `0` is always a no-op; the handler is never invoked and
   * no plan is fabricated. The resolver must be pure with respect to the caller's
   * `Scenario` and must never mutate state directly.
   */
  resolveTarget?(execution: EventExecutionContext, deps: ProjectionHandlerDependencies): Cents;
  execute(invocation: ProjectionHandlerInvocation): ProjectionExecutionResult;
}

/** Produces the handlers for a run from the live state/context. */
export type ProjectionHandlerFactory = (
  deps: ProjectionHandlerDependencies
) => readonly ProjectionEventHandler[];

/**
 * Composes zero or more handler factories into a single factory (left to right).
 *
 * This is the **default handler-composition seam** the integration owner wires in
 * `featureHandlers.ts` at P5. It composes no feature processors yet, so until it
 * is replaced the run stays kernel-only and `featureCoverage.processors` remains
 * `false`.
 */
export const composeHandlerFactories = (
  ...factories: readonly ProjectionHandlerFactory[]
): ProjectionHandlerFactory => (deps) => {
  const composed: ProjectionEventHandler[] = [];
  for (const factory of factories) {
    for (const handler of factory(deps)) {
      composed.push(handler);
    }
  }
  return composed;
};

/**
 * The default factory used when `ProjectionOptions.handlerFactory` is omitted.
 * It currently composes **no** processors (Phase 3 not wired); `featureHandlers.ts`
 * replaces this seam with {@link composeHandlerFactories} of the stream handlers.
 */
export const createDefaultHandlerFactory: ProjectionHandlerFactory = () => Object.freeze([]);

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Public `projectScenario` options.
 *
 * - `timelineId` / `startDate` / `horizonMonths` are forwarded to the P2.5
 *   compiler (the `timelineId` defaults to the active timeline; the start date
 *   defaults to the authoritative opening observation).
 * - `events` are synthetic/Phase-3 `EventDefinition`s driven by the real
 *   scheduler. An empty list means **no fabricated income or spending** — only
 *   account month-close APY valuation runs.
 * - `scheduleWindow` clips which months emit events (inclusive); monthly closes
 *   still cover the full, never-shortened horizon.
 * - `handlerFactory` is the execution seam; without it, scheduled events are
 *   reported as unexecuted diagnostics.
 * - `ratePhase` selects the accumulation or retirement account rate override.
 * - `coverage` is the **call-site-scoped** D23 claim (see
 *   {@link ProjectionCoverageClaim}); omitted means kernel-only.
 */
export interface ProjectionOptions {
  readonly timelineId?: string | null;
  readonly startDate?: string;
  readonly horizonMonths?: number;
  readonly events?: readonly EventDefinition[];
  readonly scheduleWindow?: ScheduleWindow;
  readonly handlerFactory?: ProjectionHandlerFactory;
  readonly ratePhase?: AccountRatePhase;
  readonly coverage?: ProjectionCoverageClaim;
}

// ---------------------------------------------------------------------------
// Result shapes (cents only)
// ---------------------------------------------------------------------------

/** Measurement/context metadata for a run. */
export interface ProjectionRunMetadata {
  readonly engineRevision: string;
  readonly contextSchemaVersion: number;
  readonly contextId: string;
  readonly timelineId: string | null;
  readonly timelineLabel: string;
  /**
   * Measurement basis of the run's money values. A canonical signed projection
   * is always {@link CANONICAL_RUN_MEASUREMENT} (`'assetsMinusLiabilities'`),
   * even when the observed opening had no snapshot and was `assetOnly`. The
   * opening's own basis stays on {@link ProjectionOpening.measurement}.
   */
  readonly measurement: MeasurementBasis;
  readonly startDate: DateOnly;
  readonly endDate: DateOnly;
  readonly startYearMonth: YearMonth;
  readonly endYearMonth: YearMonth;
  readonly horizonMonths: number;
  readonly hasOpeningSnapshot: boolean;
  readonly sourceSnapshotId: string | null;
}

/** Truthful opening observation (cents) the run started from. */
export interface ProjectionOpening {
  readonly date: DateOnly;
  readonly measurement: OpeningMeasurement;
  readonly hasSnapshot: boolean;
  readonly sourceSnapshotId: string | null;
  readonly totals: StateTotals;
  readonly snapshot: StateSnapshot;
  readonly diagnostics: readonly string[];
}

/** One account's month-close APY posting. */
export interface AccountMonthCloseRecord {
  readonly accountId: string;
  /** Annual rate as a fraction (e.g. `0.065`). */
  readonly annualRate: number;
  readonly monthFraction: number;
  readonly growthFactor: number;
  /** Balance before growth (after that month's executed events). */
  readonly openingBalanceCents: number;
  readonly growthCents: number;
  readonly closingBalanceCents: number;
}

/** One inclusive month close. */
export interface MonthlyClose {
  readonly index: number;
  readonly yearMonth: YearMonth;
  readonly ordinal: number;
  readonly closingDate: DateOnly;
  readonly monthFraction: number;
  readonly partial: boolean;
  readonly accountCloses: readonly AccountMonthCloseRecord[];
  readonly openingCashCents: number;
  readonly closingCashCents: number;
  readonly growthCents: number;
  /**
   * Full account/liability/property (+held-deposit) snapshot captured **once**
   * at this month's close (P4.2). Never aliases the live state; the closing
   * balances here reconcile with `opening + Σ postings`.
   */
  readonly snapshot: StateSnapshot;
  /** Aggregate cents totals (assets / liabilities / signed net worth) at close. */
  readonly totals: StateTotals;
  /** Scheduled events in the batch (executed or not). */
  readonly scheduledEventCount: number;
  /** Number of occurrences that actually committed this month (funded or direct). */
  readonly executedEventCount: number;
  /**
   * Occurrence ids that actually committed this month. Includes both funded
   * plans and direct no-plan `state.commitChanges` postings (income/cap/other
   * direct deposits, debt accrual, appreciation, sale).
   */
  readonly executedOccurrenceIds: readonly string[];
}

/** Audit row for one **actually executed** funding plan. */
export interface ExecutedPlanAudit {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly handlerId: string | null;
  readonly yearMonth: YearMonth;
  readonly date: DateOnly;
  readonly phase: EventPhase;
  readonly requestedCents: number;
  readonly executedCents: number;
  readonly shortfallCents: number;
  readonly grossDebitCents: number;
  readonly taxCents: number;
  readonly penaltyCents: number;
  readonly status: FundingStatus;
  readonly plan: FundingPlan;
}

/** One eligible source account's balance, sampled at funding-outcome time. */
export interface FundingOutcomeSourceBalance {
  readonly accountId: string;
  /** Live balance at the moment the quote outcome was observed (cents, >= 0). */
  readonly balanceCents: number;
}

/**
 * P4.1/P4.2 — one funding **quote outcome** observed for an occurrence, whether
 * or not it committed. Records the plan, the committed flag, and the
 * eligible-source balances read from state at outcome time (D16 evidence), so
 * reporting can distinguish a completeness shortfall, an eligible exhaustion and
 * a fallback **without recomputing eligibility** or inferring it from
 * allocations. `run.plans` remains the separate committed-only audit.
 */
export interface ProjectionFundingOutcome {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly handlerId: string | null;
  readonly yearMonth: YearMonth;
  readonly date: DateOnly;
  readonly phase: EventPhase;
  /** The handler's committed flag for this occurrence. */
  readonly committed: boolean;
  /** The quoted plan (funded / partial / unfunded); never fabricated. */
  readonly plan: FundingPlan;
  /** Ordered eligible sources with the balance observed at outcome time. */
  readonly eligibleSources: readonly FundingOutcomeSourceBalance[];
  /** True when a per-source quota actually constrained the quote (D16 policy). */
  readonly quotaLimited: boolean;
  /** Every candidate the funder skipped, with its typed reason (from the plan). */
  readonly skippedSources: readonly SkippedFundingSource[];
}

/** Cent totals for a run. */
export interface ProjectionRunTotals {
  readonly monthCount: number;
  readonly openingNetWorthCents: number;
  readonly closingNetWorthCents: number;
  readonly openingCashCents: number;
  readonly closingCashCents: number;
  readonly growthCents: number;
  readonly executedNetCents: number;
  readonly executedGrossCents: number;
  readonly executedTaxCents: number;
  readonly executedPenaltyCents: number;
  readonly executedPlanCount: number;
}

/** The public result: a truthful, cents-only projection run. */
export interface ProjectionRun {
  /**
   * `true` only when this run is fully covered (D23): the call site claimed
   * every Phase-3 processor domain, reporting is present, the full requested
   * horizon was simulated, and no scheduled occurrence was blocked. The
   * kernel-only facade always returns `false`.
   */
  readonly complete: boolean;
  readonly featureCoverage: ProjectionFeatureCoverage;
  readonly metadata: ProjectionRunMetadata;
  readonly opening: ProjectionOpening;
  /** Inclusive full-horizon month closes (960 by default). */
  readonly monthlyCloses: readonly MonthlyClose[];
  readonly totals: ProjectionRunTotals;
  /** Only actually executed funding plans, in execution order. */
  readonly plans: readonly ExecutedPlanAudit[];
  /**
   * The complete, non-truncated posting journal (D15): one deep-frozen record
   * per committed `state.commitChanges`, copied **once** at run end. Rejected
   * commits leave no row; the opening observation is never a posting.
   */
  readonly postings: readonly PostingRecord[];
  /**
   * Every positive funding quote the handlers returned (committed or not),
   * separate from the committed-only {@link plans} audit. Carries the eligible
   * source balances observed at outcome time (P4.1/D16).
   */
  readonly fundingOutcomes: readonly ProjectionFundingOutcome[];
  readonly diagnostics: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

const dedupe = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
};

const sumAccountBalances = (state: EngineState): number => {
  let total = 0;
  for (const account of state.getAccounts()) {
    total += account.balanceCents;
  }
  return total;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const buildExecution = (
  context: CompiledScenarioContext,
  scheduler: { getActiveBoundaries(yearMonth: YearMonth): { activeCareer: EventExecutionContext['activeCareer'] } },
  event: ScheduledEvent
): EventExecutionContext => {
  const { activeCareer } = scheduler.getActiveBoundaries(event.yearMonth);
  return {
    context,
    event,
    yearMonth: event.yearMonth,
    date: event.date,
    occurrenceIndex: event.occurrenceIndex,
    activeCareer,
    activePayPlan:
      activeCareer === null ? null : context.getActivePayPlan(activeCareer.careerId, event.yearMonth)
  };
};

/**
 * P4.1 evidence the funding lane records on every plan: the ordered eligible
 * account ids and the skipped/quota-limited reasons observed at quote time.
 * Read through an optional view so a synthetic/legacy plan without them still
 * gets an outcome; in that case the facade falls back to the request's declared
 * order and empty reason lists rather than re-running eligibility itself.
 */
interface PlanOutcomeMetadata {
  readonly eligibleAccountIds?: readonly string[];
  readonly quotaLimited?: boolean;
  readonly skippedSources?: readonly SkippedFundingSource[];
}

/** Deduplicated declared source order (`primary` then fallbacks); never null. */
const declaredSourceOrder = (plan: FundingPlan): readonly string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of [plan.request.primaryAccountId, ...plan.request.fallbackAccountIds]) {
    if (typeof raw !== 'string' || raw.length === 0 || seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    ids.push(raw);
  }
  return ids;
};

/**
 * Builds one D16 outcome from the handler's quote: records the plan/committed
 * flag and samples each eligible source's balance **now**, so later same-month
 * events cannot rewrite the exhaustion evidence. Never recomputes eligibility.
 */
const buildFundingOutcome = (
  state: EngineState,
  event: ScheduledEvent,
  handlerId: string | null,
  committed: boolean,
  plan: FundingPlan
): ProjectionFundingOutcome => {
  const meta = plan as FundingPlan & PlanOutcomeMetadata;
  const eligibleIds =
    Array.isArray(meta.eligibleAccountIds) && meta.eligibleAccountIds.length > 0
      ? meta.eligibleAccountIds
      : declaredSourceOrder(plan);
  const eligibleSources = eligibleIds.map((accountId) =>
    freeze({ accountId, balanceCents: state.getAccountBalanceCents(accountId) ?? 0 })
  );
  const skippedSources = Array.isArray(meta.skippedSources) ? [...meta.skippedSources] : [];
  return freeze({
    occurrenceId: event.occurrenceId,
    definitionId: event.definitionId,
    handlerId,
    yearMonth: event.yearMonth,
    date: event.date,
    phase: event.phase,
    committed,
    plan,
    eligibleSources: freeze(eligibleSources),
    quotaLimited: meta.quotaLimited === true,
    skippedSources: freeze(skippedSources)
  });
};

// ---------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------

/**
 * Runs the kernel-only projection facade. Deterministic: with identical inputs
 * the returned `ProjectionRun` is byte-identical. The caller's `Scenario` is
 * never mutated; the only mutation is through `state.commitChanges`.
 */
export const projectScenario = (scenario: Scenario, options: ProjectionOptions = {}): ProjectionRun => {
  // --- Compile the named context (never invents a start date) --------------
  let context: CompiledScenarioContext;
  try {
    context = compileScenarioContext(scenario, {
      timelineId: options.timelineId,
      startDate: options.startDate,
      horizonMonths: options.horizonMonths
    });
  } catch (error) {
    if (error instanceof ContextValidationError) {
      throw new ProjectionError('context', error.message);
    }
    throw error;
  }

  // --- Build the private cents state ---------------------------------------
  let state: EngineState;
  try {
    state = buildState(context.opening);
  } catch (error) {
    throw new ProjectionError('state', `Opening state could not be represented as safe cents: ${errorText(error)}`);
  }

  const accountConfigs: readonly AccountDefinition[] = scenario.netWorth?.accounts ?? [];
  const dateOfBirth =
    typeof scenario.options?.dateOfBirth === 'string' ? scenario.options.dateOfBirth : null;

  // --- Schedule (lazy, ordered) --------------------------------------------
  const scheduler = createScheduler(context, options.events ?? [], options.scheduleWindow);

  const diagnostics: string[] = [...context.diagnostics, ...scheduler.diagnostics];

  // --- Handler seam ---------------------------------------------------------
  const deps: ProjectionHandlerDependencies = {
    state,
    context,
    accounts: accountConfigs,
    dateOfBirth,
    funding: context.funding
  };

  const handlerFactory = options.handlerFactory ?? createDefaultHandlerFactory;
  const handlers: ProjectionEventHandler[] = [];
  // A scheduled occurrence the run could not execute for lack of a handler is a
  // "dropped audit" — it can never be reported as a covered run (D23).
  let executionBlocked = false;
  try {
    for (const handler of handlerFactory(deps)) {
      handlers.push(handler);
    }
  } catch (error) {
    executionBlocked = true;
    diagnostics.push(`Handler factory failed; no events were executed: ${errorText(error)}`);
  }
  const handlerIndex = new Map<string, ProjectionEventHandler>();
  for (const handler of handlers) {
    if (handlerIndex.has(handler.handlerId)) {
      diagnostics.push(`Duplicate handler id "${handler.handlerId}"; the first registration wins.`);
      continue;
    }
    handlerIndex.set(handler.handlerId, handler);
  }
  if ((options.events?.length ?? 0) > 0 && handlers.length === 0) {
    executionBlocked = true;
    diagnostics.push('No projection handlers were provided; scheduled events were not executed (kernel-only run).');
  }

  const ratePhase: AccountRatePhase = options.ratePhase ?? 'accumulation';

  const openingSnapshot = state.toSnapshot();
  const openingTotals = state.getTotals();

  const monthlyCloses: MonthlyClose[] = [];
  const plans: ExecutedPlanAudit[] = [];
  const fundingOutcomes: ProjectionFundingOutcome[] = [];
  let growthCentsTotal = 0;
  let executedNetCents = 0;
  let executedGrossCents = 0;
  let executedTaxCents = 0;
  let executedPenaltyCents = 0;

  const accountIds = state.getAccounts().map((account) => account.accountId);

  for (let ordinal = context.metadata.startOrdinal; ordinal <= context.metadata.endOrdinal; ordinal += 1) {
    const yearMonth = fromMonthOrdinal(ordinal);
    const monthStart: DateOnly = `${yearMonth}-01`;
    const monthEnd = endOfMonthDate(yearMonth);
    const closeStart = compareDateOnly(monthStart, context.metadata.startDate) >= 0 ? monthStart : context.metadata.startDate;
    const closeEnd = compareDateOnly(monthEnd, context.metadata.endDate) <= 0 ? monthEnd : context.metadata.endDate;
    const fraction = monthFractionForDates(yearMonth, closeStart, closeEnd);
    const monthFraction = fraction === null ? 1 : fraction;
    const openingCashCents = sumAccountBalances(state);

    // --- Execute this month's scheduled events (in stable order) ----------
    const batch = scheduler.batchFor(yearMonth);
    const executedOccurrenceIds: string[] = [];
    const scheduledEventCount = batch?.events.length ?? 0;
    if (batch) {
      for (const event of batch.events) {
        const definition = scheduler.getDefinition(event.definitionId);
        const handlerId = event.handlerId ?? definition?.handlerId ?? null;
        const handler = handlerId === null ? undefined : handlerIndex.get(handlerId);
        if (!handler) {
          executionBlocked = true;
          diagnostics.push(
            `No handler "${String(handlerId)}" registered for occurrence "${event.occurrenceId}"; skipped.`
          );
          continue;
        }

        // Execution context is built just before the target is resolved, so a
        // state-aware handler target reflects every earlier same-date commit.
        const execution = buildExecution(context, scheduler, event);

        let targetCents: Cents;
        try {
          targetCents = handler.resolveTarget
            ? handler.resolveTarget(execution, deps)
            : scheduler.resolveTarget(event);
        } catch (error) {
          diagnostics.push(`Occurrence "${event.occurrenceId}" target could not be resolved: ${errorText(error)}`);
          continue;
        }
        if (!Number.isSafeInteger(targetCents) || targetCents < 0) {
          diagnostics.push(
            `Occurrence "${event.occurrenceId}" resolved an invalid target (${String(targetCents)}); skipped.`
          );
          continue;
        }
        // A zero target must never fabricate a funding plan.
        if (targetCents === 0) {
          continue;
        }

        let result: ProjectionExecutionResult;
        try {
          result = handler.execute({ execution, targetCents, deps });
        } catch (error) {
          diagnostics.push(`Occurrence "${event.occurrenceId}" handler threw: ${errorText(error)}`);
          continue;
        }
        if (result.diagnostics && result.diagnostics.length > 0) {
          for (const note of result.diagnostics) {
            diagnostics.push(note);
          }
        }

        // D16 evidence: record every positive funding quote the handler returned
        // (committed or not, including an unfunded quote with zero allocations)
        // and sample the eligible-source balances now — before any later
        // same-month event can move them. Reporting selects shortfall/exhaustion
        // from this evidence without recomputing eligibility.
        const quotedPlan = result.quote && result.quote.ok ? result.quote.plan : result.plan ?? null;
        if (quotedPlan && quotedPlan.request.requestedCents > 0) {
          fundingOutcomes.push(buildFundingOutcome(state, event, handlerId, result.committed, quotedPlan));
        }

        if (!result.committed) {
          continue;
        }
        if (!result.plan) {
          // A direct `state.commitChanges` posting owns no funding plan: an
          // income / cap / other direct deposit, a contractual debt accrual, a
          // property appreciation, or a sale settlement. There is no cash debit
          // to audit, so no plan, gross/net budget or audit row is fabricated
          // (the richer Phase-4 posting audit is deferred). It is still a real
          // executed occurrence and is counted for the month. Zero/unfunded
          // targets remain strict no-ops earlier and never reach this branch.
          executedOccurrenceIds.push(event.occurrenceId);
          continue;
        }
        // A plan reported with nothing actually executed (e.g. an explicitly
        // zero-executed sentinel) is a strict no-op: never audited, never
        // counted as an executed occurrence, and no cash is booked.
        if (result.plan.executedCents <= 0) {
          continue;
        }

        let grossDebitCents = 0;
        let taxCents = 0;
        let penaltyCents = 0;
        for (const allocation of result.plan.allocations) {
          grossDebitCents += allocation.grossDebitCents;
          taxCents += allocation.withheldTaxCents;
          penaltyCents += allocation.penaltyCents;
        }

        const audit: ExecutedPlanAudit = freeze({
          occurrenceId: event.occurrenceId,
          definitionId: event.definitionId,
          handlerId,
          yearMonth: event.yearMonth,
          date: event.date,
          phase: event.phase,
          requestedCents: result.plan.request.requestedCents,
          executedCents: result.plan.executedCents,
          shortfallCents: result.plan.shortfallCents,
          grossDebitCents,
          taxCents,
          penaltyCents,
          status: result.plan.status,
          plan: result.plan
        });
        plans.push(audit);
        executedOccurrenceIds.push(event.occurrenceId);
        executedNetCents += result.plan.executedCents;
        executedGrossCents += grossDebitCents;
        executedTaxCents += taxCents;
        executedPenaltyCents += penaltyCents;
      }
    }

    // --- Account month-close APY valuation (the only owned financial math) --
    const quotedCloses: AccountMonthClose[] = [];
    const accountChanges: AccountChange[] = [];
    let monthGrowthCents = 0;
    let monthGrowthSafe = true;
    for (const accountId of accountIds) {
      const balanceBeforeCents = state.getAccountBalanceCents(accountId) ?? 0;
      const ratePercent = context.getAccountRate(accountId, ratePhase) ?? 0;
      const quoted = quoteAccountMonthClose({
        accountId,
        balanceCents: balanceBeforeCents,
        annualRate: ratePercent / 100,
        monthFraction
      });
      if (!quoted.ok) {
        diagnostics.push(`Account "${accountId}" month close skipped: ${quoted.diagnostic.message}`);
        continue;
      }
      quotedCloses.push(quoted.close);
      if (quoted.close.growthCents !== 0) {
        accountChanges.push({ accountId, deltaCents: quoted.close.growthCents });
        const next = monthGrowthCents + quoted.close.growthCents;
        if (!Number.isSafeInteger(next)) {
          monthGrowthSafe = false;
          break;
        }
        monthGrowthCents = next;
      }
    }

    let accountCloses: AccountMonthCloseRecord[] = quotedCloses.map((close) => ({
      accountId: close.accountId,
      annualRate: close.annualRate,
      monthFraction: close.monthFraction,
      growthFactor: close.growthFactor,
      openingBalanceCents: close.closingBalanceCents - close.growthCents,
      growthCents: close.growthCents,
      closingBalanceCents: close.closingBalanceCents
    }));

    if (monthGrowthSafe && accountChanges.length > 0) {
      const commit = state.commitChanges({
        revision: state.getRevision(),
        accountChanges,
        expectedNetWorthDeltaCents: monthGrowthCents,
        // Stable month-close valuation stamp (P4.1/D15): the account APY posting
        // is always `{ purpose: 'valuation', phase: 'close', date: closeEnd }`.
        posting: {
          definitionId: 'account-apy-valuation',
          purpose: 'valuation',
          phase: 'close',
          date: closeEnd
        }
      });
      if (!commit.committed) {
        diagnostics.push(
          `Month ${yearMonth} valuation commit rejected: ${commit.errors.map((entry) => entry.message).join('; ')}`
        );
        monthGrowthCents = 0;
        accountCloses = accountCloses.map((close) => ({
          ...close,
          growthCents: 0,
          closingBalanceCents: close.openingBalanceCents
        }));
      } else {
        growthCentsTotal += monthGrowthCents;
        accountCloses = accountCloses.map((close) => ({
          ...close,
          closingBalanceCents: state.getAccountBalanceCents(close.accountId) ?? close.closingBalanceCents
        }));
      }
    } else if (!monthGrowthSafe) {
      diagnostics.push(`Month ${yearMonth} valuation growth exceeded the safe integer cent range; no growth was posted.`);
      monthGrowthCents = 0;
      accountCloses = accountCloses.map((close) => ({
        ...close,
        growthCents: 0,
        closingBalanceCents: close.openingBalanceCents
      }));
    }

    const closingCashCents = sumAccountBalances(state);
    // Capture the full entity snapshot + aggregate totals exactly once at this
    // month's close (P4.2 reconciliation: opening + Σ postings = closing).
    const closingSnapshot = state.toSnapshot();
    const closingTotals = freeze(state.getTotals());
    monthlyCloses.push(
      freeze({
        index: monthlyCloses.length,
        yearMonth,
        ordinal,
        closingDate: closeEnd,
        monthFraction,
        partial: monthFraction < 1,
        accountCloses: freeze(accountCloses),
        openingCashCents,
        closingCashCents,
        growthCents: monthGrowthCents,
        snapshot: closingSnapshot,
        totals: closingTotals,
        scheduledEventCount,
        executedEventCount: executedOccurrenceIds.length,
        executedOccurrenceIds: freeze(executedOccurrenceIds)
      })
    );
  }

  const runClosingTotals = state.getTotals();
  const postings = state.getPostings();

  const metadata: ProjectionRunMetadata = freeze({
    engineRevision: PROJECTION_ENGINE_REVISION,
    contextSchemaVersion: context.metadata.schemaVersion,
    contextId: context.metadata.contextId,
    timelineId: context.metadata.timelineId,
    timelineLabel: context.metadata.timelineLabel,
    // The run's result values are canonical signed net worth; the observed
    // opening's own (possibly legacy `assetOnly`) basis is preserved separately.
    measurement: CANONICAL_RUN_MEASUREMENT,
    startDate: context.metadata.startDate,
    endDate: context.metadata.endDate,
    startYearMonth: context.metadata.startYearMonth,
    endYearMonth: context.metadata.endYearMonth,
    horizonMonths: context.metadata.horizonMonths,
    hasOpeningSnapshot: context.metadata.hasOpeningSnapshot,
    sourceSnapshotId: context.metadata.sourceSnapshotId
  });

  const opening: ProjectionOpening = freeze({
    date: context.opening.date,
    measurement: context.opening.measurement,
    hasSnapshot: context.opening.hasSnapshot,
    sourceSnapshotId: context.opening.sourceSnapshotId,
    totals: openingTotals,
    snapshot: openingSnapshot,
    diagnostics: freeze([...context.opening.diagnostics])
  });

  const totals: ProjectionRunTotals = freeze({
    monthCount: monthlyCloses.length,
    openingNetWorthCents: openingTotals.netWorthCents,
    closingNetWorthCents: runClosingTotals.netWorthCents,
    openingCashCents: openingTotals.accountCents,
    closingCashCents: runClosingTotals.accountCents,
    growthCents: growthCentsTotal,
    executedNetCents,
    executedGrossCents,
    executedTaxCents,
    executedPenaltyCents,
    executedPlanCount: plans.length
  });

  // --- Truthful coverage (D23, call-site-scoped) ---------------------------
  // The facade never invents coverage. A call-site claim is honoured only when
  // the run actually covers the full requested horizon and nothing was blocked;
  // a partial schedule window or a dropped handler keeps the run honest rather
  // than claiming a dropped audit as satisfied.
  const claim = options.coverage;
  const processorsPresent = claim?.processors === true && !executionBlocked;
  const reportingPresent = claim?.reporting === true;
  const partialWindow = options.scheduleWindow !== undefined;

  const incompleteReasons: string[] = [];
  if (claim !== undefined) {
    if (!processorsPresent) {
      incompleteReasons.push(executionBlocked ? 'blockedExecution' : 'featureProcessors');
    }
    if (!reportingPresent) {
      incompleteReasons.push('reporting');
    }
    if (partialWindow) {
      incompleteReasons.push('partialScheduleWindow');
    }
  }

  const claimDeferred = claim?.deferred ?? [];
  const complete =
    claim !== undefined &&
    processorsPresent &&
    reportingPresent &&
    !partialWindow &&
    claimDeferred.length === 0;

  const deferred: readonly string[] =
    claim === undefined
      ? DEFERRED_FEATURE_DOMAINS
      : complete
        ? freeze([...claimDeferred])
        : freeze(dedupe([...claimDeferred, ...incompleteReasons]));

  const featureCoverage: ProjectionFeatureCoverage = freeze({
    kernel: true,
    processors: processorsPresent,
    reporting: reportingPresent,
    accountValuation: true,
    deferred
  });

  return freeze({
    complete,
    featureCoverage,
    metadata,
    opening,
    monthlyCloses: freeze(monthlyCloses),
    totals,
    plans: freeze(plans),
    postings,
    fundingOutcomes: freeze(fundingOutcomes),
    diagnostics: freeze(dedupe(diagnostics))
  });
};

// ---------------------------------------------------------------------------
// Display helpers (Phase-4 reporting owns richer formatting; these are kept for
// the existing chart/table components).
// ---------------------------------------------------------------------------

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
