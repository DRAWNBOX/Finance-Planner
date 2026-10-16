/**
 * P2.5 — Named-context compiler (S + K, engine-internal, pure).
 *
 * `compileScenarioContext` is the **bridge from canonical configuration to the
 * kernel**. It consumes an already-hydrated `Scenario`, the P1.5
 * `resolveOpening` observation and the `commands.ts` resolvers (markers,
 * career/housing chains) and returns an **immutable, indexed** compiled context
 * for exactly one named context (the base timeline or one selected timeline).
 *
 * Contract (`refactor/phase2_plan.md` P2.5, `frozen_contracts.md` P0.3.1 /
 * P0.7.1, `architecture_specification.md` §4):
 *
 * - **One context only.** The selected timeline's seven local domains
 *   (`purchases`, `longTermPurchases`, `loans`, `creditCards`, `cardPlans`,
 *   `careerPlan`, `housing`) are compiled; other (inactive) timelines are
 *   validated only and are never eagerly simulated or expanded. `cardPlans` is
 *   timeline-local: the base `Scenario.cardPlans` is the implicit base timeline,
 *   and a selected named timeline contributes its own independent `cardPlans`.
 * - **Opening provenance is preserved.** Account/liability/property indexes are
 *   built from `resolveOpening`, so observed-vs-configured provenance, the
 *   observed-zero liability rule, and the property-debt-once rule flow through
 *   unchanged.
 * - **Start date comes from the opening observation — never the wall clock.**
 *   The default `startDate` is the resolved opening date; the caller may pass an
 *   explicit `startDate`, but an invalid/absent observation is an explicit
 *   error rather than a fabricated `today`.
 * - **960 full months are first-class.** The horizon defaults to
 *   `FULL_HORIZON_MONTHS` (960) and exact `MonthHorizon` metadata (ordinals,
 *   inclusive end, month count) is emitted. No silent horizon shortening.
 * - **Immutable reads, no leaked maps.** Everything returned is a deep clone and
 *   deep-frozen; lookups are closure methods over private `Map`s, so no mutable
 *   `Map`/`Set` escapes and no returned value aliases the caller's `Scenario`.
 * - **No financial calculation, no `storage.ts`.** This module only selects,
 *   indexes, normalizes dates and copies configuration. It never computes
 *   balances, growth, tax or funding.
 * - **No missing income inferred.** Undefined fields stay `null`/empty; a
 *   dangling reference is reported as a diagnostic and left unresolved, never
 *   silently redirected.
 *
 * Authority: `refactor/phase2_plan.md` P2.5 (bridge to the P2.6 scheduler),
 * `refactor/frozen_contracts.md` P0.3.1 (config interfaces), P0.5.5 (career
 * boundaries), P0.7.1 (960 months), `refactor/architecture_specification.md`
 * §4, and the settled P1.4 `src/commands.ts` / P1.5 `src/engine/opening.ts`.
 */

import type {
  AccountWithdrawalPolicy,
  CardPlan,
  CareerEntry,
  CareerPlan,
  CashflowItem,
  CreditCard,
  DateMarker,
  ExpensesConfig,
  HousingEntry,
  LargePurchase,
  LifeEvent,
  Loan,
  LongTermPurchase,
  PropertyKind,
  PropertyStatus,
  Scenario,
  WithdrawalPlan
} from '../types';
import {
  FULL_HORIZON_MONTHS,
  addMonths,
  createMonthHorizon,
  endOfMonthDate,
  formatYearMonth,
  fromMonthOrdinal,
  isValidDateOnly,
  isValidYearMonth,
  parseDateOnly,
  parseYearMonth,
  toMonthOrdinal,
  type DateOnly,
  type MonthHorizon,
  type YearMonth
} from './dates';
import {
  deepClone,
  deepFreeze,
  getTimelineDomains,
  resolveCareerChain,
  resolveHousingChain,
  resolveMarkerReferences,
  scanMarkerReferences
} from '../commands';
import {
  resolveOpening,
  type OpeningAccountType,
  type OpeningDebtObservation,
  type OpeningLiabilityKind,
  type OpeningValueSource,
  type ResolvedOpening
} from './opening';

// ---------------------------------------------------------------------------
// Version + selection
// ---------------------------------------------------------------------------

/**
 * Compiled-context shape version (bump when the compiled shape changes).
 *
 * v3: `CompiledLiability` carries `sourceConfigId` and the context adds the
 * unique source-config lookup (`getLiabilityBySourceConfigId`, plus the
 * identity-first fallback in `getLiability`).
 *
 * v4: `CardPlan[]` moved from the global (non-timeline) config into the
 * timeline-local `CompiledTimelineDomains.cardPlans`; `Context.global` no longer
 * carries card plans, and `funding.cardPlans` is derived from the selected
 * timeline's domains (base `Scenario.cardPlans` for the base timeline, the
 * selected timeline's own `cardPlans` otherwise).
 */
export const CONTEXT_SCHEMA_VERSION = 4;

/** Sentinel accepted by `ScenarioContextSelection.timelineId` for the base timeline. */
export const BASE_TIMELINE_ID = 'base';

/**
 * Which named context to compile and over what window.
 *
 * - `timelineId`: `'base'`/`null` = the base scenario fields; any other string =
 *   that timeline id; omitted = the active timeline (falling back to base, with
 *   a diagnostic, when `activeTimelineId` is dangling).
 * - `startDate`: explicit date-only start; defaults to the resolved opening
 *   observation date (never the wall clock).
 * - `horizonMonths`: full-month count; defaults to `FULL_HORIZON_MONTHS` (960).
 */
export interface ScenarioContextSelection {
  readonly timelineId?: string | null;
  readonly startDate?: string;
  readonly horizonMonths?: number;
}

/** Thrown when a context cannot be compiled without inventing input. */
export class ContextValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextValidationError';
  }
}

// ---------------------------------------------------------------------------
// Compiled shapes
// ---------------------------------------------------------------------------

/** Exact horizon + provenance metadata frozen with the context. */
export interface CompiledContextMetadata {
  readonly contextId: string;
  readonly schemaVersion: number;
  readonly timelineId: string | null;
  readonly timelineLabel: string;
  /**
   * `measurement` deliberately lives only on {@link CompiledScenarioContext.opening}
   * (the observed opening's own basis). It is **not** aliased here: a context does
   * not carry a result measurement, and removing the alias prevents a legacy
   * `assetOnly` opening from being mistaken for a canonical signed result.
   */
  readonly startDate: DateOnly;
  readonly endDate: DateOnly;
  readonly startYearMonth: YearMonth;
  readonly endYearMonth: YearMonth;
  readonly startOrdinal: number;
  readonly endOrdinal: number;
  readonly horizonMonths: number;
  readonly hasOpeningSnapshot: boolean;
  readonly sourceSnapshotId: string | null;
}

/** Phase used to select an account's effective return rate. */
export type AccountRatePhase = 'accumulation' | 'retirement';

/** Indexed account: observed/configured opening, rate and rate override. */
export interface CompiledAccount {
  readonly accountId: string;
  readonly label: string;
  readonly accountType: OpeningAccountType;
  readonly openingBalance: number;
  readonly openingSource: OpeningValueSource;
  readonly annualReturnRate: number;
  readonly retirementAnnualReturnRate: number | null;
  /** Accumulation-phase rate; the retirement override is exposed separately. */
  readonly effectiveAnnualReturnRate: number;
  readonly withdrawalPolicy: Readonly<AccountWithdrawalPolicy>;
  readonly allowAutomaticFallback: boolean;
  readonly displayOrder: number;
  readonly color?: string;
  readonly assumedGainPercent?: number;
  readonly capitalGainsTaxRate?: number;
}

/** Indexed liability: observed/configured opening plus contractual terms. */
export interface CompiledLiability {
  readonly liabilityId: string;
  /**
   * The source config this liability derives from (`LiabilityDefinition.sourceConfigId`):
   * a legacy `Loan`/housing/card config id, when configured. `null` for an
   * observed-only or synthesized (`property:<id>`) liability. This is the link
   * that lets a feature processor resolve a loan by its own id even when the
   * liability id differs — see {@link CompiledScenarioContext.getLiabilityBySourceConfigId}.
   */
  readonly sourceConfigId: string | null;
  readonly kind: OpeningLiabilityKind;
  readonly label?: string;
  readonly openingBalance: number;
  readonly openingSource: OpeningValueSource;
  readonly observedFrom?: OpeningDebtObservation;
  readonly linkedPropertyId: string | null;
  readonly annualInterestRate: number | null;
  readonly minimumMonthlyPayment: number | null;
  readonly extraMonthlyPayment: number | null;
  readonly endYearMonth: string | null;
  readonly paymentDay: number | null;
}

/** Indexed property: observed/configured opening plus lifecycle metadata. */
export interface CompiledProperty {
  readonly propertyId: string;
  readonly label?: string;
  readonly kind: PropertyKind | null;
  readonly value: number;
  readonly debtLink: string | null;
  readonly status: PropertyStatus;
  readonly requiredDownPayment: number;
  readonly openingSource: OpeningValueSource;
  readonly linkedDebtBalance?: number;
  readonly fundingEventAccountIds: readonly string[];
  readonly appreciationRate: number;
  readonly sellingCostsRate: number;
}

/** The selected timeline's seven local domains, marker/chain resolved. */
export interface CompiledTimelineDomains {
  readonly purchases: readonly LargePurchase[];
  readonly longTermPurchases: readonly LongTermPurchase[];
  readonly loans: readonly Loan[];
  readonly creditCards: readonly CreditCard[];
  /**
   * The selected timeline's own card plans. Timeline-local: the base
   * `Scenario.cardPlans` is the implicit base timeline; a named timeline never
   * inherits the base plans (a legacy timeline absent `cardPlans` normalizes to
   * `[]` in `codec.ts`, so no base debt is duplicated into it).
   */
  readonly cardPlans: readonly CardPlan[];
  readonly careerPlan: Readonly<CareerPlan>;
  readonly housing: readonly HousingEntry[];
}

/**
 * The **global** (non-timeline) canonical configuration exposed to feature
 * processors on {@link CompiledScenarioContext.global}.
 *
 * Per D10 the Phase-3 handlers need the global plan/expense/withdrawal inputs
 * that are *not* owned by a timeline. These are compiled **once** from the base
 * scenario (`cashflowItems`, `lifeEvents`, `expenses`, `withdrawal`); inactive
 * timelines are validated only and are never expanded or simulated here. Card
 * plans are **timeline-local** and live on {@link CompiledTimelineDomains.cardPlans},
 * not here. Every field is a deep clone and deep-frozen, so a handler can read it
 * but can never alias or mutate the caller's `Scenario`.
 */
export interface CompiledGlobalConfig {
  readonly cashflowItems: readonly CashflowItem[];
  readonly lifeEvents: readonly LifeEvent[];
  readonly expenses: Readonly<ExpensesConfig>;
  readonly withdrawal: Readonly<WithdrawalPlan>;
}

/** One resolved, enabled career with its inclusive active month window. */
export interface CompiledCareer {
  readonly careerId: string;
  readonly label: string;
  /** `careerPlan.enabled && entry.enabled`. */
  readonly enabled: boolean;
  readonly startYearMonth: YearMonth;
  readonly endYearMonth: YearMonth;
  readonly startOrdinal: number;
  readonly endOrdinal: number;
  /** The deep-frozen, chain/marker-resolved entry (paycheck, pay plans, …). */
  readonly entry: Readonly<CareerEntry>;
}

/** One contiguous interval over which a single pay plan is active for a career. */
export interface CompiledPayPlanInterval {
  readonly careerId: string;
  /** `null` = the career's Initial plan. */
  readonly planId: string | null;
  readonly startYearMonth: YearMonth;
  readonly endYearMonth: YearMonth;
  readonly startOrdinal: number;
  readonly endOrdinal: number;
  readonly annualRaiseRate: number | null;
}

/** One contiguous interval over which a single career is active. */
export interface CompiledCareerInterval {
  readonly careerId: string;
  readonly startYearMonth: YearMonth;
  readonly endYearMonth: YearMonth;
  readonly startOrdinal: number;
  readonly endOrdinal: number;
  readonly payPlanIntervals: readonly CompiledPayPlanInterval[];
}

/** Ordered global obligation funding (primary first, deduped fallbacks). */
export interface CompiledGlobalFunding {
  readonly primaryAccountId: string | null;
  readonly fallbackAccountIds: readonly string[];
  /** `incomeFallbackAccountId` + `incomeFallbackAccountId2` (deduped, non-null). */
  readonly incomeFallbackAccountIds: readonly string[];
  /** Primary then ordered, deduplicated fallbacks. */
  readonly orderedAccountIds: readonly string[];
}

/** One retirement withdrawal source's ordered accounts. */
export interface CompiledRetirementSource {
  readonly sourceId: string;
  readonly accountId: string;
  readonly fallbackAccountIds: readonly string[];
  readonly orderedAccountIds: readonly string[];
}

/** Ordered retirement withdrawal funding (global list + per-source lists). */
export interface CompiledRetirementFunding {
  readonly fallbackAccountIds: readonly string[];
  readonly sources: readonly CompiledRetirementSource[];
}

/** Ordered account sources for one obligation/record (primary first). */
export interface CompiledObligationSourceOrder {
  readonly obligationId: string;
  readonly domain: string;
  readonly primaryAccountId: string | null;
  readonly fallbackAccountIds: readonly string[];
  readonly orderedAccountIds: readonly string[];
  readonly usesIncome: boolean;
}

/** Ordered funding sources: global, retirement and per-obligation overrides. */
export interface CompiledFundingSources {
  readonly global: CompiledGlobalFunding;
  readonly retirement: CompiledRetirementFunding;
  readonly obligations: readonly CompiledObligationSourceOrder[];
  /**
   * Selected-timeline card-plan (`OrdinaryCardSchedule`/`ZeroInterestCardPlan`)
   * orders, derived from `domains.cardPlans` (timeline-local).
   */
  readonly cardPlans: readonly CompiledObligationSourceOrder[];
}

/**
 * Immutable compiled context. Data fields are deep-frozen deep clones; the
 * lookup methods close over private `Map`s that never escape.
 */
export interface CompiledScenarioContext {
  readonly metadata: CompiledContextMetadata;
  readonly timelineId: string | null;
  readonly timelineLabel: string;
  readonly opening: ResolvedOpening;
  readonly accounts: readonly CompiledAccount[];
  readonly liabilities: readonly CompiledLiability[];
  readonly properties: readonly CompiledProperty[];
  readonly domains: CompiledTimelineDomains;
  /** Global (non-timeline) canonical configuration for feature processors. */
  readonly global: CompiledGlobalConfig;
  readonly markers: readonly DateMarker[];
  readonly careers: readonly CompiledCareer[];
  readonly careerIntervals: readonly CompiledCareerInterval[];
  readonly funding: CompiledFundingSources;
  readonly diagnostics: readonly string[];
  getAccount(accountId: string): CompiledAccount | undefined;
  /**
   * Liability by its own id; falls back to the unique `sourceConfigId` link so a
   * `Loan` config id that differs from the `LiabilityDefinition.id` still
   * resolves. `undefined` when neither matches, or when the source-config id is
   * ambiguous (shared by several liabilities).
   */
  getLiability(liabilityId: string): CompiledLiability | undefined;
  /**
   * Liability whose `sourceConfigId` equals `sourceConfigId` (the canonical
   * `Loan`/housing/card → liability link). Returns `undefined` when nothing
   * references it or when the reference is ambiguous; never an arbitrary one.
   */
  getLiabilityBySourceConfigId(sourceConfigId: string): CompiledLiability | undefined;
  getProperty(propertyId: string): CompiledProperty | undefined;
  getCareer(careerId: string): CompiledCareer | undefined;
  getObligationSourceOrder(obligationId: string): CompiledObligationSourceOrder | undefined;
  /** Active career interval for a `YYYY-MM` month, or `null` in a gap. */
  getActiveCareer(yearMonth: string): CompiledCareerInterval | null;
  /** Active pay-plan interval for a career/month, or `null` when not active. */
  getActivePayPlan(careerId: string, yearMonth: string): CompiledPayPlanInterval | null;
  /** Effective account rate for a phase, or `null` for an unknown account. */
  getAccountRate(accountId: string, phase: AccountRatePhase): number | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const notEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const dedupe = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (notEmpty(value) && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
};

/**
 * Year-month for an age, anchored to the birth month when a valid date of birth
 * is configured (mirrors `formatYearMonthFromAge` without reading a clock).
 * With no valid DOB, falls back to the observation month + `(age − currentAge)`.
 */
const yearMonthFromAge = (
  age: number,
  dateOfBirth: string,
  currentAge: number,
  referenceYearMonth: YearMonth
): YearMonth => {
  if (!Number.isFinite(age)) {
    return '';
  }
  if (isValidDateOnly(dateOfBirth)) {
    const birth = parseDateOnly(dateOfBirth);
    if (birth) {
      return formatYearMonth({ year: birth.year + Math.floor(age), month: birth.month });
    }
  }
  const reference = parseYearMonth(referenceYearMonth);
  if (!reference) {
    return '';
  }
  return formatYearMonth({ year: reference.year + Math.floor(age - currentAge), month: reference.month });
};

/** Deterministic local-noon Date for the command chain context (no wall clock). */
const referenceDateFor = (startDate: DateOnly): Date => {
  const parsed = parseDateOnly(startDate);
  if (!parsed) {
    throw new ContextValidationError(`Cannot build a reference date from invalid start date "${startDate}".`);
  }
  // Local noon cannot roll to an adjacent calendar month in any time zone.
  return new Date(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0);
};

const careerStartMonth = (entry: CareerEntry, dob: string, currentAge: number, refYM: YearMonth): YearMonth => {
  if (typeof entry.startYearMonth === 'string' && isValidYearMonth(entry.startYearMonth)) {
    return entry.startYearMonth;
  }
  return yearMonthFromAge(entry.startAge, dob, currentAge, refYM);
};

const careerEndMonth = (entry: CareerEntry, dob: string, currentAge: number, refYM: YearMonth): YearMonth => {
  if (typeof entry.endYearMonth === 'string' && isValidYearMonth(entry.endYearMonth)) {
    return entry.endYearMonth;
  }
  const ageMonth = yearMonthFromAge(entry.endAge, dob, currentAge, refYM);
  return ageMonth ? addMonths(ageMonth, 11) : '';
};

/** Splits `sources` into an ordered, deduped account-id list + income flag. */
const extractAccountOrder = (
  sources: ReadonlyArray<string | null | undefined>
): { orderedAccountIds: string[]; usesIncome: boolean } => {
  const accountIds: string[] = [];
  let usesIncome = false;
  for (const source of sources) {
    if (!notEmpty(source)) {
      continue;
    }
    if (source === 'income') {
      usesIncome = true;
      continue;
    }
    const id = source.startsWith('account:') ? source.slice('account:'.length) : source;
    if (notEmpty(id) && !accountIds.includes(id)) {
      accountIds.push(id);
    }
  }
  return { orderedAccountIds: accountIds, usesIncome };
};

const obligationOrder = (
  obligationId: string,
  domain: string,
  sources: ReadonlyArray<string | null | undefined>
): CompiledObligationSourceOrder => {
  const { orderedAccountIds, usesIncome } = extractAccountOrder(sources);
  return {
    obligationId,
    domain,
    primaryAccountId: orderedAccountIds[0] ?? null,
    fallbackAccountIds: orderedAccountIds.slice(1),
    orderedAccountIds,
    usesIncome
  };
};

/** Binary search over a sorted, non-overlapping interval list. */
const findInterval = <T extends { readonly startOrdinal: number; readonly endOrdinal: number }>(
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

/**
 * Groups compiled liabilities by their non-empty `sourceConfigId`. Liability ids
 * within a group are sorted ascending so the duplicate diagnostic (and any
 * refusal to pick a winner) is deterministic regardless of input order.
 */
const groupBySourceConfigId = (
  liabilities: readonly CompiledLiability[]
): Map<string, CompiledLiability[]> => {
  const groups = new Map<string, CompiledLiability[]>();
  liabilities.forEach((liability) => {
    const { sourceConfigId } = liability;
    if (!notEmpty(sourceConfigId)) {
      return;
    }
    const group = groups.get(sourceConfigId);
    if (group) {
      group.push(liability);
    } else {
      groups.set(sourceConfigId, [liability]);
    }
  });
  groups.forEach((group) =>
    group.sort((a, b) => (a.liabilityId < b.liabilityId ? -1 : a.liabilityId > b.liabilityId ? 1 : 0))
  );
  return groups;
};

// ---------------------------------------------------------------------------
// Career / pay-plan intervals
// ---------------------------------------------------------------------------

interface ResolvedCareerWindow {
  career: CompiledCareer;
  startOrdinal: number;
  endOrdinal: number;
  index: number;
}

const buildPayPlanIntervals = (
  careerId: string,
  entry: Readonly<CareerEntry>,
  startOrdinal: number,
  endOrdinal: number
): CompiledPayPlanInterval[] => {
  const plans = entry.payPlans ?? [];
  const planPoints = new Map<number, { planId: string; annualRaiseRate: number | null }>();
  plans.forEach((plan) => {
    if (!isValidYearMonth(plan.effectiveYearMonth)) {
      return;
    }
    const ordinal = toMonthOrdinal(plan.effectiveYearMonth);
    if (ordinal > endOrdinal) {
      return;
    }
    // A later plan in array order wins an equal effective month (legacy `>=`).
    planPoints.set(ordinal, { planId: plan.id, annualRaiseRate: plan.annualRaiseRate ?? null });
  });

  const boundaries = new Set<number>([startOrdinal, endOrdinal + 1]);
  planPoints.forEach((_value, ordinal) => {
    if (ordinal >= startOrdinal) {
      boundaries.add(ordinal);
    }
  });
  const sorted = [...boundaries].sort((a, b) => a - b);

  const intervals: CompiledPayPlanInterval[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const segmentStart = sorted[i];
    const segmentEnd = sorted[i + 1] - 1;
    if (segmentEnd < startOrdinal || segmentStart > endOrdinal) {
      continue;
    }
    let activePlanId: string | null = null;
    let activeRaise: number | null = null;
    let activeOrdinal = Number.NEGATIVE_INFINITY;
    planPoints.forEach((value, ordinal) => {
      if (ordinal <= segmentStart && ordinal >= activeOrdinal) {
        activeOrdinal = ordinal;
        activePlanId = value.planId;
        activeRaise = value.annualRaiseRate;
      }
    });

    const last = intervals[intervals.length - 1];
    if (last && last.planId === activePlanId && last.endOrdinal + 1 === segmentStart) {
      intervals[intervals.length - 1] = {
        ...last,
        endYearMonth: fromMonthOrdinal(segmentEnd),
        endOrdinal: segmentEnd
      };
      continue;
    }
    intervals.push({
      careerId,
      planId: activePlanId,
      startYearMonth: fromMonthOrdinal(segmentStart),
      endYearMonth: fromMonthOrdinal(segmentEnd),
      startOrdinal: segmentStart,
      endOrdinal: segmentEnd,
      annualRaiseRate: activeRaise
    });
  }
  return intervals;
};

const buildCareerIntervals = (
  careers: readonly CompiledCareer[],
  horizon: MonthHorizon
): CompiledCareerInterval[] => {
  const windows: ResolvedCareerWindow[] = [];
  careers.forEach((career, index) => {
    if (!career.enabled || !Number.isFinite(career.startOrdinal) || !Number.isFinite(career.endOrdinal)) {
      return;
    }
    windows.push({
      career,
      startOrdinal: Math.max(career.startOrdinal, horizon.startOrdinal),
      endOrdinal: Math.min(career.endOrdinal, horizon.endOrdinal),
      index
    });
  });

  const boundaries = new Set<number>([horizon.startOrdinal, horizon.endOrdinal + 1]);
  windows.forEach((window) => {
    if (window.startOrdinal <= window.endOrdinal) {
      boundaries.add(window.startOrdinal);
      boundaries.add(window.endOrdinal + 1);
    }
  });
  const sorted = [...boundaries].sort((a, b) => a - b);

  interface Segment {
    careerId: string | null;
    start: number;
    end: number;
  }
  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const segmentStart = sorted[i];
    const segmentEnd = sorted[i + 1] - 1;
    if (segmentEnd < horizon.startOrdinal || segmentStart > horizon.endOrdinal) {
      continue;
    }
    let activeIndex = -1;
    windows.forEach((window, index) => {
      if (window.startOrdinal <= segmentStart && window.endOrdinal >= segmentStart) {
        if (activeIndex < 0 || window.startOrdinal >= windows[activeIndex].startOrdinal) {
          // Most recently started wins; equal start prefers the later entry.
          activeIndex = index;
        }
      }
    });
    segments.push({
      careerId: activeIndex >= 0 ? windows[activeIndex].career.careerId : null,
      start: segmentStart,
      end: segmentEnd
    });
  }

  const intervals: CompiledCareerInterval[] = [];
  segments.forEach((segment) => {
    if (segment.careerId === null) {
      return;
    }
    const career = careers.find((candidate) => candidate.careerId === segment.careerId);
    if (!career) {
      return;
    }
    const last = intervals[intervals.length - 1];
    if (last && last.careerId === segment.careerId && last.endOrdinal + 1 === segment.start) {
      const merged: CompiledCareerInterval = {
        ...last,
        endYearMonth: fromMonthOrdinal(segment.end),
        endOrdinal: segment.end,
        payPlanIntervals: buildPayPlanIntervals(
          career.careerId,
          career.entry,
          last.startOrdinal,
          segment.end
        )
      };
      intervals[intervals.length - 1] = merged;
      return;
    }
    intervals.push({
      careerId: career.careerId,
      startYearMonth: fromMonthOrdinal(segment.start),
      endYearMonth: fromMonthOrdinal(segment.end),
      startOrdinal: segment.start,
      endOrdinal: segment.end,
      payPlanIntervals: buildPayPlanIntervals(career.careerId, career.entry, segment.start, segment.end)
    });
  });
  return intervals;
};

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

interface TimelineSelection {
  timelineId: string | null;
  timelineLabel: string;
  rawDomains: CompiledTimelineDomains;
  diagnostics: string[];
}

const baseDomains = (scenario: Scenario): CompiledTimelineDomains => ({
  purchases: scenario.largePurchases ?? [],
  longTermPurchases: scenario.longTermPurchases ?? [],
  loans: scenario.loans ?? [],
  creditCards: scenario.creditCards ?? [],
  cardPlans: scenario.cardPlans ?? [],
  careerPlan: scenario.careerPlan,
  housing: scenario.housing ?? []
});

const selectTimeline = (scenario: Scenario, selection: ScenarioContextSelection): TimelineSelection => {
  const diagnostics: string[] = [];
  const requested = selection.timelineId;
  let timelineId: string | null;

  if (requested === undefined) {
    const activeId = scenario.activeTimelineId ?? null;
    const exists = activeId !== null && (scenario.timelines ?? []).some((timeline) => timeline.id === activeId);
    if (activeId !== null && !exists) {
      diagnostics.push(`Active timeline "${activeId}" was not found; compiled the base timeline instead.`);
      timelineId = null;
    } else {
      timelineId = activeId;
    }
  } else if (requested === null || requested === BASE_TIMELINE_ID) {
    timelineId = null;
  } else {
    const exists = (scenario.timelines ?? []).some((timeline) => timeline.id === requested);
    if (!exists) {
      throw new ContextValidationError(`Unknown timeline "${requested}"; cannot compile a context for it.`);
    }
    timelineId = requested;
  }

  if (timelineId === null) {
    return { timelineId, timelineLabel: 'Base', rawDomains: baseDomains(scenario), diagnostics };
  }
  const timeline = (scenario.timelines ?? []).find((entry) => entry.id === timelineId);
  if (!timeline) {
    // Unreachable given the existence check, but keep the compiler total.
    return { timelineId: null, timelineLabel: 'Base', rawDomains: baseDomains(scenario), diagnostics };
  }
  return {
    timelineId,
    timelineLabel: timeline.label,
    rawDomains: getTimelineDomains(timeline),
    diagnostics
  };
};

const collectMarkerDiagnostics = (scenario: Scenario, diagnostics: string[]): void => {
  const valid = new Set((scenario.dateMarkers ?? []).map((marker) => marker.id));
  scanMarkerReferences(scenario).forEach((reference) => {
    if (!valid.has(reference.markerId)) {
      const scope = reference.timelineId ? `timeline ${reference.timelineId}` : 'base';
      diagnostics.push(
        `Marker "${reference.markerId}" referenced by ${reference.domain} "${reference.recordId}.${reference.field}" (${scope}) does not exist; reference cleared.`
      );
    }
  });
};

/**
 * Compiles one immutable named context from a hydrated `Scenario`. Pure: the
 * input is never mutated and no returned value aliases it.
 */
export const compileScenarioContext = (
  scenario: Scenario,
  selection: ScenarioContextSelection = {}
): CompiledScenarioContext => {
  const diagnostics: string[] = [];

  const opening = resolveOpening(scenario);

  const requestedStart = selection.startDate;
  if (requestedStart !== undefined && !isValidDateOnly(requestedStart)) {
    throw new ContextValidationError(`Invalid startDate "${requestedStart}"; expected a YYYY-MM-DD date.`);
  }
  const startDate = requestedStart ?? opening.date;
  if (!notEmpty(startDate)) {
    throw new ContextValidationError(
      'No start date is available: provide selection.startDate or an opening observation date (openingSnapshot.date / netWorth.asOfDate); the compiler never reads the wall clock.'
    );
  }

  const horizonMonths = selection.horizonMonths ?? FULL_HORIZON_MONTHS;
  if (!Number.isSafeInteger(horizonMonths) || horizonMonths < 1) {
    throw new ContextValidationError(`horizonMonths must be a positive integer; received ${String(horizonMonths)}.`);
  }

  const startParts = parseDateOnly(startDate);
  if (!startParts) {
    throw new ContextValidationError(`Start date "${startDate}" is not a valid YYYY-MM-DD date.`);
  }
  const startYearMonth: YearMonth = formatYearMonth(startParts);
  const horizon = createMonthHorizon(startYearMonth, horizonMonths);
  const referenceDate = referenceDateFor(startDate);
  const dateOfBirth = scenario.options?.dateOfBirth ?? '';
  const currentAge = scenario.profile?.currentAge ?? 0;

  // --- Timeline selection + marker/chain resolution ----------------------
  const selected = selectTimeline(scenario, selection);
  diagnostics.push(...selected.diagnostics);

  const contextId = [
    `ctx-v${CONTEXT_SCHEMA_VERSION}`,
    selected.timelineId ?? BASE_TIMELINE_ID,
    startDate,
    String(horizonMonths),
    opening.measurement,
    opening.sourceSnapshotId ?? 'no-snapshot'
  ].join('|');

  const resolvedScenario = resolveMarkerReferences(scenario, { dateOfBirth, currentAge });
  const resolvedTimeline =
    selected.timelineId === null
      ? null
      : (resolvedScenario.timelines ?? []).find((timeline) => timeline.id === selected.timelineId) ?? null;

  const resolvedRaw: CompiledTimelineDomains =
    resolvedTimeline === null
      ? {
          purchases: resolvedScenario.largePurchases ?? [],
          longTermPurchases: resolvedScenario.longTermPurchases ?? [],
          loans: resolvedScenario.loans ?? [],
          creditCards: resolvedScenario.creditCards ?? [],
          // The base `Scenario.cardPlans` is the implicit base timeline; a
          // selected named timeline instead contributes its own plans below.
          cardPlans: resolvedScenario.cardPlans ?? [],
          careerPlan: resolvedScenario.careerPlan,
          housing: resolvedScenario.housing ?? []
        }
      : getTimelineDomains(resolvedTimeline);

  const chainContext = { dateOfBirth, currentAge, referenceDate };
  const resolvedCareers: CareerEntry[] = resolveCareerChain(
    deepClone(resolvedRaw.careerPlan?.entries ?? []),
    chainContext
  );
  const housingInput: HousingEntry[] = resolvedRaw.housing ? [...resolvedRaw.housing] : [];
  const resolvedHousing: HousingEntry[] = resolveHousingChain(
    deepClone(housingInput),
    resolvedCareers,
    chainContext
  );

  const domains: CompiledTimelineDomains = deepFreeze({
    purchases: deepClone(resolvedRaw.purchases ?? []),
    longTermPurchases: deepClone(resolvedRaw.longTermPurchases ?? []),
    loans: deepClone(resolvedRaw.loans ?? []),
    creditCards: deepClone(resolvedRaw.creditCards ?? []),
    // Timeline-local: the selected timeline's own (marker-resolved) card plans.
    cardPlans: deepClone(resolvedRaw.cardPlans ?? []),
    careerPlan: {
      enabled: resolvedRaw.careerPlan?.enabled ?? false,
      entries: resolvedCareers
    },
    housing: resolvedHousing
  });

  // --- Global (non-timeline) configuration for feature processors ---------
  // Compiled once from the base scenario; the selected timeline never changes
  // these, and inactive timelines are never expanded or simulated here. Card
  // plans are timeline-local and are NOT part of this global config.
  const globalConfig: CompiledGlobalConfig = deepFreeze<CompiledGlobalConfig>({
    cashflowItems: deepClone(resolvedScenario.cashflowItems ?? []),
    lifeEvents: deepClone(resolvedScenario.lifeEvents ?? []),
    expenses: deepClone(resolvedScenario.expenses),
    withdrawal: deepClone(resolvedScenario.withdrawal)
  });

  // --- Indexed accounts / liabilities / properties -----------------------
  const configuredAccounts = new Map((scenario.netWorth?.accounts ?? []).map((account) => [account.id, account]));
  const accounts: CompiledAccount[] = opening.accounts.map((state) => {
    const configured = configuredAccounts.get(state.accountId);
    return {
      accountId: state.accountId,
      label: state.label,
      accountType: state.accountType,
      openingBalance: state.openingBalance,
      openingSource: state.source,
      annualReturnRate: state.annualReturnRate,
      retirementAnnualReturnRate: state.retirementAnnualReturnRate,
      effectiveAnnualReturnRate: state.annualReturnRate,
      withdrawalPolicy: { ...state.withdrawalPolicy },
      allowAutomaticFallback: state.withdrawalPolicy.allowAutomaticFallback,
      displayOrder: state.displayOrder,
      color: state.color,
      assumedGainPercent: configured?.assumedGainPercent,
      capitalGainsTaxRate: configured?.capitalGainsTaxRate
    };
  });

  const configuredLiabilities = new Map((scenario.liabilities ?? []).map((liability) => [liability.id, liability]));
  const liabilities: CompiledLiability[] = opening.liabilities.map((state) => {
    const configured = configuredLiabilities.get(state.liabilityId);
    const sourceConfigId = configured?.sourceConfigId ?? null;
    return {
      liabilityId: state.liabilityId,
      sourceConfigId: notEmpty(sourceConfigId) ? sourceConfigId : null,
      kind: state.kind,
      label: state.label,
      openingBalance: state.openingBalance,
      openingSource: state.source,
      observedFrom: state.observedFrom,
      linkedPropertyId: state.linkedPropertyId ?? null,
      annualInterestRate: state.annualInterestRate ?? configured?.annualInterestRate ?? null,
      minimumMonthlyPayment: configured?.minimumMonthlyPayment ?? null,
      extraMonthlyPayment: configured?.extraMonthlyPayment ?? null,
      endYearMonth: configured?.endYearMonth ?? null,
      paymentDay: configured?.paymentDay ?? null
    };
  });

  // A `sourceConfigId` shared by two liabilities is an ambiguous link. Report it
  // deterministically (sorted liability ids) and never silently pick a winner:
  // the source-config lookup below leaves the id unresolved.
  const sourceConfigGroups = groupBySourceConfigId(liabilities);
  sourceConfigGroups.forEach((group, sourceConfigId) => {
    if (group.length > 1) {
      diagnostics.push(
        `sourceConfigId "${sourceConfigId}" is referenced by multiple liabilities (${group
          .map((liability) => liability.liabilityId)
          .join(', ')}); the loan/liability link is ambiguous and left unresolved.`
      );
    }
  });

  const configuredProperties = new Map((scenario.properties ?? []).map((property) => [property.id, property]));
  const properties: CompiledProperty[] = opening.properties.map((state) => {
    const configured = configuredProperties.get(state.propertyId);
    return {
      propertyId: state.propertyId,
      label: state.label,
      kind: configured?.kind ?? null,
      value: state.value,
      debtLink: state.debtLink ?? null,
      status: state.status,
      requiredDownPayment: state.requiredDownPayment,
      openingSource: state.source,
      linkedDebtBalance: state.linkedDebtBalance,
      fundingEventAccountIds: [...state.fundingEventAccountIds],
      appreciationRate: configured?.appreciationRate ?? 0,
      sellingCostsRate: configured?.sellingCostsRate ?? 0
    };
  });

  // --- Careers + intervals ----------------------------------------------
  const planEnabled = domains.careerPlan.enabled;
  const careers: CompiledCareer[] = [];
  (domains.careerPlan.entries ?? []).forEach((entry) => {
    const startYM = careerStartMonth(entry, dateOfBirth, currentAge, startYearMonth);
    let endYM = careerEndMonth(entry, dateOfBirth, currentAge, startYearMonth);
    if (notEmpty(startYM) && notEmpty(endYM) && toMonthOrdinal(endYM) < toMonthOrdinal(startYM)) {
      diagnostics.push(`Career "${entry.id}" ends before it starts; end clamped to its start month.`);
      endYM = startYM;
    }
    if (!notEmpty(startYM)) {
      diagnostics.push(`Career "${entry.id}" has no resolvable start month.`);
    }
    if (!notEmpty(endYM)) {
      diagnostics.push(`Career "${entry.id}" has no resolvable end month.`);
    }
    careers.push({
      careerId: entry.id,
      label: entry.label,
      enabled: planEnabled && entry.enabled,
      startYearMonth: startYM,
      endYearMonth: endYM,
      startOrdinal: notEmpty(startYM) ? toMonthOrdinal(startYM) : Number.NaN,
      endOrdinal: notEmpty(endYM) ? toMonthOrdinal(endYM) : Number.NaN,
      entry: deepFreeze(entry)
    });
  });

  const careerIds = new Set(careers.map((career) => career.careerId));
  resolvedHousing.forEach((home) => {
    if (notEmpty(home.linkedCareerStartId) && !careerIds.has(home.linkedCareerStartId)) {
      diagnostics.push(
        `Housing "${home.id}" links career "${home.linkedCareerStartId}" for its start, which does not exist in this context.`
      );
    }
    if (notEmpty(home.linkedCareerEndId) && !careerIds.has(home.linkedCareerEndId)) {
      diagnostics.push(
        `Housing "${home.id}" links career "${home.linkedCareerEndId}" for its end, which does not exist in this context.`
      );
    }
  });

  const careerIntervals = buildCareerIntervals(careers, horizon);

  // --- Ordered funding sources ------------------------------------------
  const globalPolicy = scenario.fundingPolicy;
  const policyPrimary = globalPolicy?.primaryAccountId;
  const globalPrimary = notEmpty(policyPrimary) ? policyPrimary : null;
  const globalFallbacks = (globalPolicy?.fallbackAccountIds ?? []).filter(notEmpty);
  const incomeFallbackAccountIds = dedupe([
    scenario.incomeFallbackAccountId ?? '',
    scenario.incomeFallbackAccountId2 ?? ''
  ]);
  const global = deepFreeze<CompiledGlobalFunding>({
    primaryAccountId: globalPrimary,
    fallbackAccountIds: [...globalFallbacks],
    incomeFallbackAccountIds,
    orderedAccountIds: dedupe([globalPrimary ?? '', ...globalFallbacks])
  });

  const withdrawal = scenario.withdrawal;
  const retirementFallbacks = (withdrawal?.fallbackAccountIds ?? []).filter(notEmpty);
  const retirementSources: CompiledRetirementSource[] = (withdrawal?.sourceLines ?? []).map((line) => {
    const fallbacks = (line.fallbackAccountIds ?? []).filter(notEmpty);
    return {
      sourceId: line.id,
      accountId: line.accountId,
      fallbackAccountIds: [...fallbacks],
      orderedAccountIds: dedupe([line.accountId, ...fallbacks])
    };
  });
  const retirement = deepFreeze<CompiledRetirementFunding>({
    fallbackAccountIds: [...retirementFallbacks],
    sources: retirementSources
  });

  const obligations: CompiledObligationSourceOrder[] = [];
  (domains.purchases ?? []).forEach((purchase) =>
    obligations.push(obligationOrder(purchase.id, 'purchase', [purchase.fundingSource]))
  );
  (domains.longTermPurchases ?? []).forEach((purchase) =>
    obligations.push(obligationOrder(purchase.id, 'longTermPurchase', [purchase.fundingSource]))
  );
  (domains.loans ?? []).forEach((loan) =>
    obligations.push(
      obligationOrder(loan.id, 'loan', [loan.paymentSource, loan.paymentSourceAccount, loan.downPaymentSource])
    )
  );
  (domains.creditCards ?? []).forEach((card) =>
    obligations.push(obligationOrder(card.id, 'creditCard', [card.paymentSource, card.lumpSumPaymentSource]))
  );
  (domains.housing ?? []).forEach((home) =>
    obligations.push(
      obligationOrder(home.id, 'housing', [
        home.paymentSource,
        home.taxesInsuranceSource,
        home.hoaMaintenanceSource,
        home.pmiSource,
        home.downPaymentSource
      ])
    )
  );

  // Card-plan funding derives from the selected timeline's domains (the base
  // `Scenario.cardPlans` for the base timeline, the selected timeline's own
  // plans otherwise) — never from the global config.
  const cardPlans: CompiledObligationSourceOrder[] = (resolvedRaw.cardPlans ?? []).map((plan) => {
    if (plan.kind === 'expectedPayment') {
      return obligationOrder(plan.id, 'cardPlan.expectedPayment', [plan.funding?.primaryAccountId, ...(plan.funding?.fallbackAccountIds ?? [])]);
    }
    return obligationOrder(plan.id, 'cardPlan.zeroInterestPayoff', [plan.funding?.primaryAccountId, ...(plan.funding?.fallbackAccountIds ?? [])]);
  });

  const funding = deepFreeze<CompiledFundingSources>({
    global,
    retirement,
    obligations,
    cardPlans
  });

  // --- Cross-cutting validation diagnostics -----------------------------
  diagnostics.push(...opening.diagnostics);
  collectMarkerDiagnostics(scenario, diagnostics);

  const uniqueDiagnostics = dedupe(diagnostics);

  // --- Freeze prepared data ---------------------------------------------
  const frozenAccounts = deepFreeze(accounts);
  const frozenLiabilities = deepFreeze(liabilities);
  const frozenProperties = deepFreeze(properties);
  const frozenCareers = deepFreeze(careers);
  const frozenIntervals = deepFreeze(careerIntervals);
  const frozenMarkers = deepFreeze(resolvedScenario.dateMarkers ?? []);
  const frozenOpening = deepFreeze(opening);
  const frozenDiagnostics = deepFreeze(uniqueDiagnostics);

  const metadata = deepFreeze<CompiledContextMetadata>({
    contextId,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    timelineId: selected.timelineId,
    timelineLabel: selected.timelineLabel,
    startDate,
    endDate: endOfMonthDate(horizon.endYearMonth),
    startYearMonth: horizon.startYearMonth,
    endYearMonth: horizon.endYearMonth,
    startOrdinal: horizon.startOrdinal,
    endOrdinal: horizon.endOrdinal,
    horizonMonths: horizon.monthCount,
    hasOpeningSnapshot: opening.hasSnapshot,
    sourceSnapshotId: opening.sourceSnapshotId
  });

  // --- Private lookup indexes (never exposed) ---------------------------
  const accountIndex = new Map(frozenAccounts.map((account) => [account.accountId, account]));
  const liabilityIndex = new Map(frozenLiabilities.map((liability) => [liability.liabilityId, liability]));
  // Only unambiguous source-config links are indexed: a `sourceConfigId` shared
  // by several liabilities stays out, so no arbitrary liability is chosen.
  const liabilityBySourceConfigId = new Map<string, CompiledLiability>();
  groupBySourceConfigId(frozenLiabilities).forEach((group, sourceConfigId) => {
    if (group.length === 1) {
      liabilityBySourceConfigId.set(sourceConfigId, group[0]);
    }
  });
  const propertyIndex = new Map(frozenProperties.map((property) => [property.propertyId, property]));
  const careerIndex = new Map(frozenCareers.map((career) => [career.careerId, career]));
  const obligationIndex = new Map(obligations.map((order) => [order.obligationId, order]));

  const context: CompiledScenarioContext = {
    metadata,
    timelineId: selected.timelineId,
    timelineLabel: selected.timelineLabel,
    opening: frozenOpening,
    accounts: frozenAccounts,
    liabilities: frozenLiabilities,
    properties: frozenProperties,
    domains,
    global: globalConfig,
    markers: frozenMarkers,
    careers: frozenCareers,
    careerIntervals: frozenIntervals,
    funding,
    diagnostics: frozenDiagnostics,
    getAccount: (accountId) => accountIndex.get(accountId),
    getLiability: (liabilityId) => liabilityIndex.get(liabilityId) ?? liabilityBySourceConfigId.get(liabilityId),
    getLiabilityBySourceConfigId: (sourceConfigId) => liabilityBySourceConfigId.get(sourceConfigId),
    getProperty: (propertyId) => propertyIndex.get(propertyId),
    getCareer: (careerId) => careerIndex.get(careerId),
    getObligationSourceOrder: (obligationId) => obligationIndex.get(obligationId),
    getActiveCareer: (yearMonth) => {
      if (!isValidYearMonth(yearMonth)) {
        return null;
      }
      return findInterval(frozenIntervals, toMonthOrdinal(yearMonth));
    },
    getActivePayPlan: (careerId, yearMonth) => {
      if (!isValidYearMonth(yearMonth)) {
        return null;
      }
      const interval = findInterval(frozenIntervals, toMonthOrdinal(yearMonth));
      if (!interval || interval.careerId !== careerId) {
        return null;
      }
      return findInterval(interval.payPlanIntervals, toMonthOrdinal(yearMonth));
    },
    getAccountRate: (accountId, phase) => {
      const account = accountIndex.get(accountId);
      if (!account) {
        return null;
      }
      if (phase === 'retirement' && account.retirementAnnualReturnRate !== null) {
        return account.retirementAnnualReturnRate;
      }
      return account.annualReturnRate;
    }
  };

  return Object.freeze(context);
};
