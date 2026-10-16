/**
 * K+O — Phase 3 feature-handler composition (D10, integration owner).
 *
 * This module is the single composition seam that turns the four financial
 * feature streams into one coherent `ProjectionHandlerFactory` + `EventDefinition`
 * set for the P2.7 facade (`projectScenario`). It owns **no** financial rules: it
 * selects exactly one named timeline, compiles one canonical
 * `CompiledScenarioContext`, then assembles the streams' *settled* exported
 * `build*EventDefinitions` / `create*Handlers` pairs:
 *
 * - **I** income/payroll (`income.ts`),
 * - **S** spending / planner / retirement (`spending.ts`, `planner.ts`, `retirement.ts`),
 * - **D** cards / loans (`cards.ts`, `loans.ts`),
 * - **H** housing (`housing.ts`).
 *
 * ### Phase / same-date order (P0.3.2 / D10)
 *
 * The scheduler already fixes the phase rank (`accrual → income → cap →
 * mandatory → discretionary → close`). Within the `mandatory` phase the streams
 * author their own priorities, but those are stream-local: planner/spending/
 * retirement default to `0`, which would sort **before** loans/housing/cards.
 * This composer therefore bands the mandatory definitions into the frozen
 * canonical order the plan pins:
 *
 *   loan/mortgage → housing → cards → planner/living → retirement
 *
 * Relative order *inside* a band is preserved (`band + authoredPriority`), so a
 * loan's down payment still precedes its installment, a housing mortgage still
 * precedes its taxes/HOA/PMI groups, and a 0% card payoff still precedes its
 * installment. Non-mandatory definitions are passed through untouched.
 *
 * ### Scope and de-duplication
 *
 * Global (cashflow, life events, expenses, withdrawal) vs timeline-local
 * (purchases, long-term purchases, loans, credit cards, **card plans**, careers,
 * housing) scope is decided by `compileScenarioContext`; the streams read
 * `context.global` / `context.domains` respectively, so composing their
 * definitions preserves the split without re-deriving it here. Card plans are
 * timeline-local: `cards.ts` reads `context.domains.cardPlans` (the base
 * `Scenario.cardPlans` is the implicit base timeline), so the selected timeline's
 * plans — and only those — are assembled.
 *
 * Stable definition ids are de-duplicated deterministically. A repeated id is
 * kept once (the first occurrence wins) and a diagnostic is recorded naming both
 * purposes, so a genuine id collision between two *different* obligations is
 * surfaced rather than silently dropped. Distinct obligations always keep
 * distinct ids.
 *
 * ### Truthful coverage (D23)
 *
 * This wrapper owns the **call-site-scoped** coverage claim: it composes all
 * four streams and builds exactly one Phase-4 report from the run, so it asserts
 * `processors: true` / `reporting: true` / no deferred domains. The `P2.7`
 * facade still owns the honest {@link ProjectionRun} decision — `complete` is
 * `true` only when that claim holds over the **full** requested horizon and no
 * scheduled occurrence was blocked for lack of a handler. A partial
 * `scheduleWindow` or a dropped handler leaves the run honestly incomplete
 * (`complete: false`, non-empty `deferred`). Only **actually executed** funding
 * plans are recorded; feature-layer build diagnostics (missing loan links,
 * undated age-only obligations, id collisions) are merged into `run.diagnostics`,
 * and a scheduled occurrence with no registered handler is still reported by the
 * facade.
 *
 * Authority: `refactor/phase3_plan.md` D10 (handler-seam contract) + Stream
 * I/S/D/H, `refactor/frozen_contracts.md` P0.3.2 (phases/same-date order),
 * `refactor/phase2_handoff.md` §3 (facade / `ProjectionHandlerFactory`).
 */

import type { Scenario } from '../types';
import {
  BASE_TIMELINE_ID,
  compileScenarioContext,
  type AccountRatePhase,
  type CompiledScenarioContext
} from './configuration';
import { buildCardEventDefinitions, createCardHandlers } from './cards';
import { buildHousingContext, buildHousingEventDefinitions, createHousingHandlers } from './housing';
import { buildIncomeEventDefinitions, createIncomeHandlers } from './income';
import { buildLoanEventDefinitions, createLoanHandlers } from './loans';
import { buildPlannerEventDefinitions, createPlannerHandlers } from './planner';
import {
  projectScenario,
  type ProjectionEventHandler,
  type ProjectionHandlerDependencies,
  type ProjectionHandlerFactory,
  type ProjectionRun
} from './projection';
import { buildRetirementEventDefinitions, createRetirementHandlers } from './retirement';
import { buildProjectionReport, type ProjectionReport } from './reporting';
import type { EventDefinition, ScheduleWindow } from './scheduler';
import {
  buildSpendingEventDefinitions,
  createSpendingHandlers,
  type SpendingDateAnchor
} from './spending';

// ---------------------------------------------------------------------------
// Canonical mandatory ordering bands (D10)
// ---------------------------------------------------------------------------

/**
 * `mandatory`-phase bands, low → high. A stream's authored priority is added to
 * its band so intra-stream order survives, while the cross-stream order is the
 * frozen `loan/mortgage → housing → cards → planner/living → retirement`.
 */
export const FEATURE_MANDATORY_BANDS = Object.freeze({
  loan: 1_000,
  housing: 2_000,
  card: 3_000,
  plannerLiving: 4_000,
  retirement: 5_000
} as const);

type FeatureMandatoryBand = (typeof FEATURE_MANDATORY_BANDS)[keyof typeof FEATURE_MANDATORY_BANDS];

/** Applies a mandatory band to a definition, preserving its intra-stream order. */
const bandMandatory = (definition: EventDefinition, band: FeatureMandatoryBand): EventDefinition =>
  definition.phase === 'mandatory'
    ? { ...definition, priority: band + (definition.priority ?? 0) }
    : definition;

// ---------------------------------------------------------------------------
// Canonical context / anchor selection
// ---------------------------------------------------------------------------

/**
 * Resolves the single named timeline for a feature run: an explicit id (or
 * `null` for base) wins; otherwise the scenario's `activeTimelineId`; otherwise
 * base. It never returns `undefined`, so exactly one timeline is always selected.
 */
const resolveTimelineId = (scenario: Scenario, requested: string | null | undefined): string =>
  requested === undefined ? scenario.activeTimelineId ?? BASE_TIMELINE_ID : requested ?? BASE_TIMELINE_ID;

/**
 * The explicit, non-clock age anchor shared by the spending definitions **and**
 * handlers. Using one canonical anchor guarantees a scheduled age-only
 * occurrence resolves to the descriptor it was scheduled from (never a wall
 * clock, never silently skipped).
 */
const buildSpendingAnchor = (
  scenario: Scenario | undefined,
  context: CompiledScenarioContext,
  fallbackDateOfBirth: string | null
): SpendingDateAnchor => ({
  dateOfBirth: scenario?.options?.dateOfBirth ?? fallbackDateOfBirth,
  currentAge: scenario?.profile?.currentAge ?? null,
  referenceYearMonth: context.metadata.startYearMonth
});

// ---------------------------------------------------------------------------
// Event-definition assembly
// ---------------------------------------------------------------------------

interface StreamDefinitions {
  readonly label: string;
  readonly definitions: readonly EventDefinition[];
  /** Mandatory band for this stream, or `null` when it authors all phases itself. */
  readonly band: FeatureMandatoryBand | null;
}

/**
 * Merges stream definition groups in a stable order, applies mandatory bands,
 * and de-duplicates by stable `definitionId` (first wins) while recording a
 * diagnostic for every collision so a different obligation is never silently
 * dropped.
 */
const assembleDefinitions = (groups: readonly StreamDefinitions[], diagnostics: string[]): EventDefinition[] => {
  const seen = new Map<string, { readonly purpose: string; readonly label: string }>();
  const assembled: EventDefinition[] = [];

  for (const group of groups) {
    for (const raw of group.definitions) {
      const definition = group.band === null ? raw : bandMandatory(raw, group.band);
      const existing = seen.get(definition.definitionId);
      if (existing) {
        diagnostics.push(
          `Feature definition id "${definition.definitionId}" is produced more than once ` +
            `(${existing.label}/${existing.purpose} vs ${group.label}/${definition.purpose}); the first is kept ` +
            `and the duplicate is not double-posted.`
        );
        continue;
      }
      seen.set(definition.definitionId, { purpose: definition.purpose, label: group.label });
      assembled.push(definition);
    }
  }

  // Stable output regardless of stream registration order.
  return assembled.sort((a, b) => (a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0));
};

/**
 * Builds every feature stream's recurring `EventDefinition`s against one
 * canonical compiled context. Pure: `scenario`/`context` are never mutated.
 *
 * Diagnostics from the streams (skipped loan links, undated age-only spending)
 * and from de-duplication are appended to `diagnostics` when supplied. Housing is
 * given a `HousingContext` built from the scenario's **original canonical
 * properties** plus the **selected timeline's** housing entries, so dated
 * acquisition funding events are scheduled without fabricating pool/income.
 */
export const createFeatureEventDefinitions = (
  scenario: Scenario,
  context: CompiledScenarioContext,
  diagnostics: string[] = []
): EventDefinition[] => {
  const anchor = buildSpendingAnchor(scenario, context, null);

  const loanBuild = buildLoanEventDefinitions(context);
  for (const diagnostic of loanBuild.diagnostics) {
    diagnostics.push(diagnostic.message);
  }

  // Housing receives the scenario's original canonical properties + the selected
  // timeline's housing entries, plus the compiled liabilities so a scheduled
  // mortgage window uses the actual contractual end month (never a fabricated
  // pool/income or legacy term fallback). The scope routes funding events
  // through the selected timeline (RV04/F23): base reads the global property
  // list, a named timeline reads only its linked housing entries' events and
  // never the global list — so an inactive timeline is never simulated and a
  // future acquisition is not duplicated across timelines.
  const housingContext = buildHousingContext(scenario, context.domains.housing, context.liabilities, {
    timelineId: context.timelineId
  });

  const groups: readonly StreamDefinitions[] = [
    {
      label: 'income',
      definitions: buildIncomeEventDefinitions(context, { dateOfBirth: scenario.options?.dateOfBirth ?? null }),
      band: null
    },
    {
      label: 'spending',
      definitions: buildSpendingEventDefinitions(context, anchor, diagnostics),
      band: FEATURE_MANDATORY_BANDS.plannerLiving
    },
    {
      label: 'planner',
      definitions: buildPlannerEventDefinitions(context),
      band: FEATURE_MANDATORY_BANDS.plannerLiving
    },
    {
      label: 'loans',
      definitions: loanBuild.definitions,
      band: FEATURE_MANDATORY_BANDS.loan
    },
    {
      label: 'cards',
      definitions: buildCardEventDefinitions(context),
      band: FEATURE_MANDATORY_BANDS.card
    },
    {
      label: 'retirement',
      definitions: buildRetirementEventDefinitions(context),
      band: FEATURE_MANDATORY_BANDS.retirement
    },
    {
      label: 'housing',
      definitions: buildHousingEventDefinitions(housingContext),
      band: FEATURE_MANDATORY_BANDS.housing
    }
  ];

  return assembleDefinitions(groups, diagnostics);
};

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

/**
 * Composes the four streams' `create*Handlers` into one
 * {@link ProjectionHandlerFactory}. The optional `scenario` supplies the
 * canonical spending age anchor and must be the **same** scenario the run was
 * compiled from, so a scheduled age-only occurrence resolves to the same
 * descriptor (see {@link createFeatureEventDefinitions}).
 *
 * The composed handlers post only through `state.commitChanges` (via each
 * stream's `quoteFunding`/`commitFunding`); this factory never mutates state.
 */
export const createFeatureHandlerFactory = (scenario?: Scenario): ProjectionHandlerFactory => (
  deps: ProjectionHandlerDependencies
): ProjectionEventHandler[] => {
  const anchor = buildSpendingAnchor(scenario, deps.context, deps.dateOfBirth);
  return [
    ...createIncomeHandlers(deps),
    ...createSpendingHandlers(deps, anchor),
    ...createPlannerHandlers(deps),
    ...createLoanHandlers(deps),
    ...createCardHandlers(deps),
    ...createRetirementHandlers(deps),
    ...createHousingHandlers(deps)
  ];
};

// ---------------------------------------------------------------------------
// Wrapper over the facade
// ---------------------------------------------------------------------------

/** Options accepted by {@link projectFeatureScenario} (subset of `ProjectionOptions`). */
export interface FeatureScenarioOptions {
  /** `'base'`/`null` = base fields; an id = that timeline; omitted = the active timeline. */
  readonly timelineId?: string | null;
  readonly startDate?: string;
  readonly horizonMonths?: number;
  readonly ratePhase?: AccountRatePhase;
  readonly scheduleWindow?: ScheduleWindow;
}

/**
 * D23 result of the composed feature projection: the truthful
 * {@link ProjectionRun} **plus** the single immutable Phase-4
 * {@link ProjectionReport} built from it. It is a superset of `ProjectionRun`,
 * so existing call sites keep working unchanged while the integrated candidate
 * exposes the report alongside the run.
 */
export interface FeatureProjectionRun extends ProjectionRun {
  /** The one report built from this run (never a second projection). */
  readonly report: ProjectionReport;
}

/**
 * Runs the composed feature projection: selects exactly one named timeline,
 * compiles one canonical context, assembles all four streams' definitions and
 * handlers, and delegates to the facade with an explicit **call-site coverage
 * claim** (D23). The facade then marks `featureCoverage.processors`/`reporting`
 * true and `complete` true only when the run covers the full requested horizon
 * and nothing was blocked; a partial `scheduleWindow` or a dropped handler
 * leaves the run honestly incomplete.
 *
 * Exactly one immutable {@link ProjectionReport} is built from the returned run
 * via `buildProjectionReport(run)` and attached — reporting is never re-run and
 * the run is never recomputed. Feature-layer diagnostics are merged into the
 * returned run; only actually executed postings appear as plans.
 */
export const projectFeatureScenario = (
  scenario: Scenario,
  options: FeatureScenarioOptions = {}
): FeatureProjectionRun => {
  const timelineId = resolveTimelineId(scenario, options.timelineId);
  const selection = {
    timelineId,
    ...(options.startDate === undefined ? {} : { startDate: options.startDate }),
    ...(options.horizonMonths === undefined ? {} : { horizonMonths: options.horizonMonths })
  };

  const context = compileScenarioContext(scenario, selection);

  const featureDiagnostics: string[] = [];
  const events = createFeatureEventDefinitions(scenario, context, featureDiagnostics);

  const composed = projectScenario(scenario, {
    timelineId,
    ...(options.startDate === undefined ? {} : { startDate: options.startDate }),
    ...(options.horizonMonths === undefined ? {} : { horizonMonths: options.horizonMonths }),
    ...(options.scheduleWindow === undefined ? {} : { scheduleWindow: options.scheduleWindow }),
    ...(options.ratePhase === undefined ? {} : { ratePhase: options.ratePhase }),
    events,
    handlerFactory: createFeatureHandlerFactory(scenario),
    // Call-site-scoped D23 claim: this wrapper wired every Phase-3 stream and
    // builds exactly one Phase-4 report below. The facade still owns the honest
    // `complete` decision (full horizon + nothing blocked).
    coverage: { processors: true, reporting: true, deferred: [] }
  });

  let run: ProjectionRun = composed;
  if (featureDiagnostics.length > 0) {
    const seen = new Set(composed.diagnostics);
    const merged = [...composed.diagnostics];
    for (const diagnostic of featureDiagnostics) {
      if (!seen.has(diagnostic)) {
        seen.add(diagnostic);
        merged.push(diagnostic);
      }
    }
    run = Object.freeze({ ...composed, diagnostics: Object.freeze(merged) });
  }

  const report = buildProjectionReport(run);
  return Object.freeze({ ...run, report });
};
