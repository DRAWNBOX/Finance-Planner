/**
 * P1.4 — Shared configuration commands and reference registry.
 *
 * This module is the single canonical write/read surface for scenario
 * configuration. It is intentionally:
 *
 * - **Pure**: every command returns a new scenario and never mutates its input.
 *   Nested graphs are deep-cloned before any edit, so callers cannot accidentally
 *   alias source state (or shared factory references) into the result.
 * - **Deterministic**: stable IDs are either supplied by the caller or generated
 *   from a monotonic module counter (no `Date.now()` / `Math.random()`), so
 *   reference cleanup and cloning produce stable output.
 * - **Scope-aware**: global configuration (accounts, rates, the retirement
 *   planner, manual returns, markers, funding policy, opening liabilities and
 *   properties) is distinct from the seven timeline-local domains
 *   (`purchases`, `longTermPurchases`, `loans`, `creditCards`, `cardPlans`,
 *   `careerPlan`, `housing`). Editing routes through `applyToActiveTimeline`;
 *   the base scenario fields are the implicit "base timeline".
 *
 * It does not perform any financial math, does not read the wall clock, and does
 * not depend on `storage.ts` / `App.tsx`. The App integration seam is
 * `createConfigurationCommands` (see the bottom of this file): a single object
 * that the integration owner can bind into App state.
 */

import type {
  CareerEntry,
  CareerPayPlan,
  CareerPlan,
  CardPlan,
  CreditCard,
  DateMarker,
  FundingPolicy,
  HousingEntry,
  LargePurchase,
  Loan,
  LongTermPurchase,
  OrdinaryCardSchedule,
  PropertyDefinition,
  PropertyFundingEvent,
  Scenario,
  Timeline,
  ZeroInterestCardPlan
} from './types';
import { addMonthsToYearMonth, ageFromYearMonth, formatYearMonthFromAge } from './utils/ageDate';
import { isYearMonth, resolveDateMarkers } from './utils/dateMarkers';

// ---------------------------------------------------------------------------
// Deep clone / freeze
// ---------------------------------------------------------------------------

/**
 * Structural deep clone for JSON-shaped configuration. Returns a fully
 * independent object graph; primitives and `undefined` pass through unchanged.
 * The source is never mutated.
 */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  const source = value as Record<string, unknown>;
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    clone[key] = deepClone(source[key]);
  }
  return clone as T;
}

/**
 * Deep-freezes an independent clone of `value` and returns it. The caller's
 * input is never frozen or otherwise mutated, so frozen results/snapshots can
 * never alias live configuration.
 */
export function deepFreeze<T>(value: T): Readonly<T> {
  const clone = deepClone(value);
  const freeze = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || Object.isFrozen(node)) {
      return;
    }
    Object.freeze(node);
    for (const key of Object.keys(node as Record<string, unknown>)) {
      freeze((node as Record<string, unknown>)[key]);
    }
  };
  freeze(clone);
  return clone as Readonly<T>;
}

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

let commandIdSeed = 0;

/** Monotonic, wall-clock-free ID source for newly created command records. */
export const createCommandId = (prefix: string): string => `${prefix}-${(commandIdSeed += 1)}`;

// ---------------------------------------------------------------------------
// Domain boundaries
// ---------------------------------------------------------------------------

/** The seven domains that are copied/owned per timeline. */
export const TIMELINE_LOCAL_DOMAINS = [
  'purchases',
  'longTermPurchases',
  'loans',
  'creditCards',
  'cardPlans',
  'careerPlan',
  'housing'
] as const;

export type TimelineLocalDomain = (typeof TIMELINE_LOCAL_DOMAINS)[number];

/** The timeline-local domain payload handed to `applyToActiveTimeline` transforms. */
export interface TimelineDomainData {
  purchases: LargePurchase[];
  longTermPurchases: LongTermPurchase[];
  loans: Loan[];
  creditCards: CreditCard[];
  cardPlans: CardPlan[];
  careerPlan: CareerPlan;
  housing: HousingEntry[];
}

/**
 * Top-level `Scenario` keys that hold global configuration (shared across every
 * timeline). A global write (`applyGlobal`) may change these; it must not
 * implicitly rewrite the active/base timeline-local domains or the timeline
 * registry, which are owned by `applyToActiveTimeline` and the timeline CRUD
 * commands. Kept as a runtime list so tests/consumers can enforce the
 * global-vs-local split without re-deriving it.
 */
export const GLOBAL_SCENARIO_KEYS = [
  'profile',
  'options',
  'portfolio',
  'futureRetirement',
  'withdrawal',
  'manualReturns',
  'purchaseCategories',
  'dateMarkers',
  'trajectorySnapshots',
  'cashflowItems',
  'lifeEvents',
  'expenses',
  'netWorth',
  'incomeFallbackAccountId',
  'incomeFallbackAccountId2',
  'fundingPolicy',
  'liabilities',
  'properties'
] as const;

export type GlobalScenarioKey = (typeof GLOBAL_SCENARIO_KEYS)[number];

/**
 * Top-level `Scenario` keys owned by the active/base timeline (or the timeline
 * registry). A global write leaves these for `applyToActiveTimeline` / the
 * timeline CRUD commands, so an unrelated global edit cannot silently rewrite a
 * timeline's local domains.
 */
export const TIMELINE_SCOPE_SCENARIO_KEYS = [
  'largePurchases',
  'longTermPurchases',
  'loans',
  'creditCards',
  'cardPlans',
  'careerPlan',
  'housing',
  'timelines',
  'activeTimelineId'
] as const;

export type TimelineScopeScenarioKey = (typeof TIMELINE_SCOPE_SCENARIO_KEYS)[number];

const GLOBAL_SCENARIO_KEY_SET: ReadonlySet<string> = new Set(GLOBAL_SCENARIO_KEYS);
const TIMELINE_SCOPE_SCENARIO_KEY_SET: ReadonlySet<string> = new Set(TIMELINE_SCOPE_SCENARIO_KEYS);

/** True when `key` is a global-configuration top-level `Scenario` key. */
export const isGlobalScenarioKey = (key: string): key is GlobalScenarioKey => GLOBAL_SCENARIO_KEY_SET.has(key);

/** True when `key` is owned by the active/base timeline or the timeline registry. */
export const isTimelineScopeScenarioKey = (key: string): key is TimelineScopeScenarioKey =>
  TIMELINE_SCOPE_SCENARIO_KEY_SET.has(key);

// ---------------------------------------------------------------------------
// Active-timeline selectors
// ---------------------------------------------------------------------------

export const getActiveTimelineId = (scenario: Scenario): string | null => scenario.activeTimelineId ?? null;

export const getActiveTimeline = (scenario: Scenario): Timeline | null => {
  const id = getActiveTimelineId(scenario);
  if (!id) {
    return null;
  }
  return (scenario.timelines ?? []).find((timeline) => timeline.id === id) ?? null;
};

/** Resolves the active timeline's seven local domains, falling back to base fields. */
export const getActiveTimelineData = (scenario: Scenario): TimelineDomainData => {
  const timeline = getActiveTimeline(scenario);
  return {
    purchases: timeline ? timeline.purchases : (scenario.largePurchases ?? []),
    longTermPurchases: timeline ? timeline.longTermPurchases : (scenario.longTermPurchases ?? []),
    loans: timeline ? timeline.loans : (scenario.loans ?? []),
    creditCards: timeline ? timeline.creditCards : (scenario.creditCards ?? []),
    cardPlans: timeline ? (timeline.cardPlans ?? []) : (scenario.cardPlans ?? []),
    careerPlan: timeline ? timeline.careerPlan : scenario.careerPlan,
    housing: timeline ? timeline.housing : (scenario.housing ?? [])
  };
};

/** Extracts the seven local domains held by a specific timeline. */
export const getTimelineDomains = (timeline: Timeline): TimelineDomainData => ({
  purchases: timeline.purchases,
  longTermPurchases: timeline.longTermPurchases,
  loans: timeline.loans,
  creditCards: timeline.creditCards,
  cardPlans: timeline.cardPlans ?? [],
  careerPlan: timeline.careerPlan,
  housing: timeline.housing
});

// ---------------------------------------------------------------------------
// Active-timeline writes
// ---------------------------------------------------------------------------

/**
 * Applies a transform to the six active timeline-local domains. When no
 * timeline is active the base `scenario.*` fields are written; otherwise the
 * matching `scenario.timelines[]` entry is written and base fields stay
 * untouched. The whole scenario is deep-cloned first, so neither the source nor
 * unrelated/inactive timelines are mutated or aliased.
 */
export const applyToActiveTimeline = (
  scenario: Scenario,
  transform: (data: TimelineDomainData) => TimelineDomainData
): Scenario => {
  const next = deepClone(scenario);
  const updated = transform(getActiveTimelineData(next));
  const activeId = next.activeTimelineId ?? null;

  const writeBase = (): void => {
    next.largePurchases = updated.purchases;
    next.longTermPurchases = updated.longTermPurchases;
    next.loans = updated.loans;
    next.creditCards = updated.creditCards;
    next.cardPlans = updated.cardPlans;
    next.careerPlan = updated.careerPlan;
    next.housing = updated.housing;
  };

  if (!activeId) {
    writeBase();
    return next;
  }

  const timeline = (next.timelines ?? []).find((entry) => entry.id === activeId);
  if (timeline) {
    timeline.purchases = updated.purchases;
    timeline.longTermPurchases = updated.longTermPurchases;
    timeline.loans = updated.loans;
    timeline.creditCards = updated.creditCards;
    timeline.cardPlans = updated.cardPlans;
    timeline.careerPlan = updated.careerPlan;
    timeline.housing = updated.housing;
    return next;
  }

  // Dangling `activeTimelineId` (no matching timeline). Selectors already fall
  // back to base, so make the write agree with them instead of silently
  // dropping it, and clear the stale ID so future writes are consistent.
  writeBase();
  next.activeTimelineId = null;
  return next;
};

const updateActiveCareerPlan = (scenario: Scenario, transform: (plan: CareerPlan) => CareerPlan): Scenario =>
  applyToActiveTimeline(scenario, (data) => ({ ...data, careerPlan: transform(data.careerPlan) }));

// ---------------------------------------------------------------------------
// Global writes
// ---------------------------------------------------------------------------

/**
 * Pure global-configuration write (the global counterpart of
 * `applyToActiveTimeline`).
 *
 * The **entire** scenario is deep-cloned before `transform` runs, so the source
 * is never mutated or shallow-aliased. Because the clone is structural:
 *
 * - valid `[]` / `0` / `false` / `null` / `undefined` values and any new nested
 *   fields produced by `transform` are preserved exactly (never defaulted,
 *   dropped or rewritten with a factory value);
 * - the base timeline-local fields and every inactive timeline are deep-copied
 *   even when untouched, so mutating the returned scenario cannot leak into the
 *   source or into a timeline the transform never named;
 * - no funding account is silently reassigned and no pool map is invented - the
 *   result is precisely what `transform` produced over the clone.
 *
 * `transform` is expected to edit only global keys (see `isGlobalScenarioKey`).
 * An unrelated global edit therefore leaves the active timeline's local domains
 * unchanged; use `applyToActiveTimeline` (or the timeline CRUD commands) for any
 * timeline-local change. Marker/date-reference and career/housing chain
 * consistency is owned by the existing canonical commands
 * (`resolveMarkerReferences`, `clearDanglingMarkerReferences`,
 * `resolveCareerAndHousingChains`); compose those around a global write instead
 * of rebuilding references locally.
 */
export const applyGlobal = (
  scenario: Scenario,
  transform: (draft: Scenario) => Scenario
): Scenario => {
  const draft = deepClone(scenario);
  return transform(draft);
};

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aRecord = a as AnyRecord;
  const bRecord = b as AnyRecord;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]));
};

/**
 * Lists the top-level `Scenario` keys whose values structurally differ between
 * `before` and `after`. Lets a caller (or a test) confirm that a global write
 * only touched global keys - every returned key should satisfy
 * `isGlobalScenarioKey`.
 */
export const changedScenarioKeys = (before: Scenario, after: Scenario): string[] => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !deepEqual((before as AnyRecord)[key], (after as AnyRecord)[key]));
};

// ---------------------------------------------------------------------------
// Timeline CRUD
// ---------------------------------------------------------------------------

export interface IdLabelOptions {
  id?: string;
  label?: string;
}

/**
 * Timeline-local funding events for a base housing entry: the matching base
 * property's dated future `fundingEvents`. Matched by the property's
 * `sourceConfigId` (the canonical link back to the housing/config id), else by a
 * matching property `id`. Returns `undefined` when no property matches, so a
 * base entry with no linked property stays event-free.
 */
const baseFundingEventsForHousing = (
  housingId: string,
  properties: readonly PropertyDefinition[]
): PropertyFundingEvent[] | undefined => {
  const bySource = properties.find((property) => property.sourceConfigId === housingId);
  const matched = bySource ?? properties.find((property) => property.id === housingId);
  return matched?.fundingEvents;
};

/**
 * RV04/F23: when a timeline is cloned from the **base** set, each cloned housing
 * entry adopts its matching base property's dated future funding events so the
 * new timeline owns an independent, editable list. Events are copied verbatim
 * (ids/dates/amounts/account refs) and the global property definitions are never
 * touched, so the base opening identity is unchanged and no double scheduling is
 * introduced. Cloning a **named** timeline keeps that timeline's own local list.
 */
const seedHousingFundingEvents = (
  housing: readonly HousingEntry[],
  properties: readonly PropertyDefinition[]
): HousingEntry[] =>
  housing.map((entry) => {
    const source = baseFundingEventsForHousing(entry.id, properties);
    if (source === undefined) {
      return deepClone(entry);
    }
    return { ...deepClone(entry), fundingEvents: deepClone(source) };
  });

/** Creates a new timeline as a deep copy of the currently active set and activates it. */
export const addTimeline = (scenario: Scenario, options: IdLabelOptions = {}): Scenario => {
  const next = deepClone(scenario);
  const active = getActiveTimelineData(scenario);
  // Consistent with `getActiveTimelineData`: a dangling `activeTimelineId` falls
  // back to the base set, so it is treated as a base clone here too.
  const cloningBase = getActiveTimeline(scenario) === null;
  const id = options.id ?? createCommandId('timeline');
  const timeline: Timeline = {
    id,
    label: options.label ?? `Timeline ${(scenario.timelines ?? []).length + 1}`,
    purchases: deepClone(active.purchases),
    longTermPurchases: deepClone(active.longTermPurchases),
    loans: deepClone(active.loans),
    creditCards: deepClone(active.creditCards),
    cardPlans: deepClone(active.cardPlans),
    careerPlan: deepClone(active.careerPlan),
    housing: cloningBase
      ? seedHousingFundingEvents(active.housing, next.properties ?? [])
      : deepClone(active.housing)
  };
  next.timelines = [...(next.timelines ?? []), timeline];
  next.activeTimelineId = id;
  return next;
};

export const switchTimeline = (scenario: Scenario, timelineId: string | null): Scenario => {
  const next = deepClone(scenario);
  const exists = !timelineId || (next.timelines ?? []).some((timeline) => timeline.id === timelineId);
  next.activeTimelineId = exists ? timelineId : null;
  return next;
};

export const renameTimeline = (scenario: Scenario, timelineId: string, label: string): Scenario => {
  const next = deepClone(scenario);
  next.timelines = (next.timelines ?? []).map((timeline) =>
    timeline.id === timelineId ? { ...timeline, label } : timeline
  );
  return next;
};

export const deleteTimeline = (scenario: Scenario, timelineId: string): Scenario => {
  const next = deepClone(scenario);
  next.timelines = (next.timelines ?? []).filter((timeline) => timeline.id !== timelineId);
  if (next.activeTimelineId === timelineId) {
    next.activeTimelineId = null;
  }
  return next;
};

/** Deep-copies one timeline; the copy is not activated (matches App behavior). */
export const duplicateTimeline = (scenario: Scenario, timelineId: string, options: IdLabelOptions = {}): Scenario => {
  const next = deepClone(scenario);
  const source = (next.timelines ?? []).find((timeline) => timeline.id === timelineId);
  if (!source) {
    return next;
  }
  const copy: Timeline = {
    ...deepClone(source),
    id: options.id ?? createCommandId('timeline'),
    label: options.label ?? `${source.label} (copy)`
  };
  next.timelines = [...(next.timelines ?? []), copy];
  return next;
};

// ---------------------------------------------------------------------------
// Career CRUD
// ---------------------------------------------------------------------------

/** Deep clone of a career entry preserving every nested paycheck/plan field. */
export const cloneCareerEntry = (career: CareerEntry, options: IdLabelOptions = {}): CareerEntry => ({
  ...deepClone(career),
  id: options.id ?? createCommandId('career'),
  label: options.label ?? `${career.label} Copy`
});

export const updateCareer = (scenario: Scenario, career: CareerEntry): Scenario =>
  updateActiveCareerPlan(scenario, (plan) => ({
    ...plan,
    entries: plan.entries.map((entry) => (entry.id === career.id ? deepClone(career) : entry))
  }));

export const addCareer = (scenario: Scenario, entry: CareerEntry): Scenario =>
  updateActiveCareerPlan(scenario, (plan) => ({ ...plan, entries: [...plan.entries, deepClone(entry)] }));

/**
 * Removes a career and clears only the housing links that referenced it in the
 * same (active) timeline. All other housing configuration is preserved.
 */
export const removeCareer = (scenario: Scenario, careerId: string): Scenario =>
  applyToActiveTimeline(scenario, (data) => ({
    ...data,
    careerPlan: {
      ...data.careerPlan,
      entries: data.careerPlan.entries.filter((entry) => entry.id !== careerId)
    },
    housing: data.housing.map((entry) => ({
      ...entry,
      linkedCareerStartId: entry.linkedCareerStartId === careerId ? null : entry.linkedCareerStartId,
      linkedCareerEndId: entry.linkedCareerEndId === careerId ? null : entry.linkedCareerEndId
    }))
  }));

export const duplicateCareer = (scenario: Scenario, careerId: string, options: IdLabelOptions = {}): Scenario =>
  updateActiveCareerPlan(scenario, (plan) => {
    const sourceIndex = plan.entries.findIndex((entry) => entry.id === careerId);
    if (sourceIndex < 0) {
      return plan;
    }
    const copy = cloneCareerEntry(plan.entries[sourceIndex], options);
    const entries = [...plan.entries];
    entries.splice(sourceIndex + 1, 0, copy);
    return { ...plan, entries };
  });

export const reorderCareers = (scenario: Scenario, fromCareerId: string, toCareerId: string): Scenario =>
  updateActiveCareerPlan(scenario, (plan) => {
    if (fromCareerId === toCareerId) {
      return plan;
    }
    const fromIndex = plan.entries.findIndex((entry) => entry.id === fromCareerId);
    const toIndex = plan.entries.findIndex((entry) => entry.id === toCareerId);
    if (fromIndex < 0 || toIndex < 0) {
      return plan;
    }
    const entries = [...plan.entries];
    const [moving] = entries.splice(fromIndex, 1);
    entries.splice(toIndex, 0, moving);
    return { ...plan, entries };
  });

// ---------------------------------------------------------------------------
// Selected pay-plan CRUD / clone
// ---------------------------------------------------------------------------

/** Deep clone of a pay plan; every nested paycheck line / source line is independent. */
export const cloneCareerPayPlan = (plan: CareerPayPlan, options: IdLabelOptions = {}): CareerPayPlan => ({
  ...deepClone(plan),
  id: options.id ?? createCommandId('pay-plan'),
  label: options.label ?? `${plan.label} Copy`
});

/** Resolves the selected plan id for a career, or `undefined` for the Initial plan. */
export const getCareerPayPlan = (career: CareerEntry, planId: string | null | undefined): CareerPayPlan | undefined =>
  planId ? (career.payPlans ?? []).find((plan) => plan.id === planId) : undefined;

const updateActiveCareer = (
  scenario: Scenario,
  careerId: string,
  transform: (career: CareerEntry) => CareerEntry
): Scenario =>
  updateActiveCareerPlan(scenario, (plan) => ({
    ...plan,
    entries: plan.entries.map((entry) => (entry.id === careerId ? transform(entry) : entry))
  }));

export const addCareerPayPlan = (scenario: Scenario, careerId: string, plan: CareerPayPlan): Scenario =>
  updateActiveCareer(scenario, careerId, (career) => ({
    ...career,
    payPlans: [...(career.payPlans ?? []), deepClone(plan)]
  }));

export const updateCareerPayPlan = (scenario: Scenario, careerId: string, plan: CareerPayPlan): Scenario =>
  updateActiveCareer(scenario, careerId, (career) => ({
    ...career,
    payPlans: (career.payPlans ?? []).map((existing) => (existing.id === plan.id ? deepClone(plan) : existing))
  }));

export const removeCareerPayPlan = (scenario: Scenario, careerId: string, planId: string): Scenario =>
  updateActiveCareer(scenario, careerId, (career) => ({
    ...career,
    payPlans: (career.payPlans ?? []).filter((plan) => plan.id !== planId)
  }));

// ---------------------------------------------------------------------------
// Account CRUD (global scope)
// ---------------------------------------------------------------------------

export const addAccount = (scenario: Scenario, account: Scenario['netWorth']['accounts'][number]): Scenario => {
  const next = deepClone(scenario);
  next.netWorth.accounts = [...(next.netWorth.accounts ?? []), deepClone(account)];
  return next;
};

export const updateAccount = (
  scenario: Scenario,
  account: Scenario['netWorth']['accounts'][number]
): Scenario => {
  const next = deepClone(scenario);
  next.netWorth.accounts = (next.netWorth.accounts ?? []).map((existing) =>
    existing.id === account.id ? deepClone(account) : existing
  );
  return next;
};

type AnyRecord = Record<string, any>;

const isAccountFunding = (value: unknown, accountId: string): boolean => value === `account:${accountId}`;

const clearSourceLineAccount = (line: AnyRecord | undefined, accountId: string): void => {
  if (!line) {
    return;
  }
  if (line.accountId === accountId) {
    line.accountId = undefined;
  }
  if (line.sourceId === accountId) {
    // `sourceId` is required by the type; '' is the canonical unresolved sentinel.
    line.sourceId = '';
  }
  if (line.overflowFallbackAccountId === accountId) {
    line.overflowFallbackAccountId = null;
  }
};

const clearPaycheckAccount = (paycheck: AnyRecord | undefined, accountId: string): void => {
  if (!paycheck || !Array.isArray(paycheck.categories)) {
    return;
  }
  paycheck.categories.forEach((category: AnyRecord) => {
    (category?.lines ?? []).forEach((line: AnyRecord) => {
      if (line?.accountId === accountId) {
        line.accountId = null;
      }
    });
  });
};

const clearCareerAccount = (career: AnyRecord, accountId: string): void => {
  (career.sourceLines ?? []).forEach((line: AnyRecord) => clearSourceLineAccount(line, accountId));
  const depositPlan = career.depositPlan as AnyRecord | undefined;
  if (depositPlan) {
    (depositPlan.allocations ?? []).forEach((line: AnyRecord) => clearSourceLineAccount(line, accountId));
    if (depositPlan.remainderAccountId === accountId) {
      depositPlan.remainderAccountId = null;
    }
  }
  (career.payPlans ?? []).forEach((plan: AnyRecord) => {
    (plan.sourceLines ?? []).forEach((line: AnyRecord) => clearSourceLineAccount(line, accountId));
    const planDeposit = plan.depositPlan as AnyRecord | undefined;
    if (planDeposit) {
      (planDeposit.allocations ?? []).forEach((line: AnyRecord) => clearSourceLineAccount(line, accountId));
      if (planDeposit.remainderAccountId === accountId) {
        planDeposit.remainderAccountId = null;
      }
    }
    clearPaycheckAccount(plan.paycheck, accountId);
  });
  if (career.paycheckInfo?.retirementAccountId === accountId) {
    career.paycheckInfo.retirementAccountId = undefined;
  }
  if (career.paycheckInfo?.hsaAccountId === accountId) {
    career.paycheckInfo.hsaAccountId = undefined;
  }
  clearPaycheckAccount(career.paycheck, accountId);
};

const clearPurchaseAccount = (purchase: AnyRecord, accountId: string): void => {
  (purchase.sourceLines ?? []).forEach((line: AnyRecord) => clearSourceLineAccount(line, accountId));
  if (isAccountFunding(purchase.fundingSource, accountId)) {
    purchase.fundingSource = undefined;
  }
};

const clearLoanAccount = (loan: AnyRecord, accountId: string): void => {
  if (loan.paymentSourceAccount === accountId) {
    loan.paymentSourceAccount = '';
  }
  if (isAccountFunding(loan.paymentSource, accountId)) {
    loan.paymentSource = undefined;
  }
  if (isAccountFunding(loan.downPaymentSource, accountId)) {
    loan.downPaymentSource = undefined;
  }
};

const clearCreditCardAccount = (card: AnyRecord, accountId: string): void => {
  // Legacy required-union fields fall back to the income pool (their configured
  // default) rather than pointing at a deleted account.
  if (isAccountFunding(card.paymentSource, accountId)) {
    card.paymentSource = 'income';
  }
  if (isAccountFunding(card.lumpSumPaymentSource, accountId)) {
    card.lumpSumPaymentSource = 'income';
  }
};

const clearHousingAccount = (entry: AnyRecord, accountId: string): void => {
  const sourceKeys = ['downPaymentSource', 'paymentSource', 'taxesInsuranceSource', 'hoaMaintenanceSource', 'pmiSource'];
  sourceKeys.forEach((key) => {
    if (isAccountFunding(entry[key], accountId)) {
      entry[key] = undefined;
    }
  });
  // G20/G22 ordered per-group policies: clear the exact account id from every
  // group (primary becomes `null`, fallbacks filter the id out). The primary is
  // never redirected to the first fallback, and unrelated groups are untouched.
  const fundingPolicies = entry.fundingPolicies as Record<string, FundingPolicy> | undefined;
  if (fundingPolicies && typeof fundingPolicies === 'object') {
    Object.values(fundingPolicies).forEach((policy) => clearFundingPolicyAccount(policy, accountId));
  }
  if (entry.rentalIncomeAccountId === accountId) {
    entry.rentalIncomeAccountId = undefined;
  }
  if (entry.saleProceedsAccountId === accountId) {
    entry.saleProceedsAccountId = undefined;
  }
  // Timeline-local funding events (RV04/F23): clear the deleted account from the
  // base entries and every inactive timeline's local list.
  (entry.fundingEvents ?? []).forEach((event: AnyRecord) => {
    if (event.accountId === accountId) {
      event.accountId = null;
    }
  });
};

const clearFundingPolicyAccount = (policy: FundingPolicy | undefined, accountId: string): void => {
  if (!policy) {
    return;
  }
  if (policy.primaryAccountId === accountId) {
    policy.primaryAccountId = null;
  }
  policy.fallbackAccountIds = (policy.fallbackAccountIds ?? []).filter((id) => id !== accountId);
};

const clearCardPlanAccount = (plan: AnyRecord, accountId: string): void => {
  clearFundingPolicyAccount(plan.funding, accountId);
  clearFundingPolicyAccount(plan.payoffFunding, accountId);
};

const clearTimelineLocalAccountRefs = (
  purchases: AnyRecord[],
  longTermPurchases: AnyRecord[],
  loans: AnyRecord[],
  creditCards: AnyRecord[],
  cardPlans: AnyRecord[],
  careerPlan: AnyRecord,
  housing: AnyRecord[],
  accountId: string
): void => {
  purchases.forEach((purchase) => clearPurchaseAccount(purchase, accountId));
  longTermPurchases.forEach((purchase) => clearPurchaseAccount(purchase, accountId));
  loans.forEach((loan) => clearLoanAccount(loan, accountId));
  creditCards.forEach((card) => clearCreditCardAccount(card, accountId));
  cardPlans.forEach((plan) => clearCardPlanAccount(plan, accountId));
  (careerPlan?.entries ?? []).forEach((career: AnyRecord) => clearCareerAccount(career, accountId));
  housing.forEach((entry) => clearHousingAccount(entry, accountId));
};

/**
 * Clears every reference to a deleted account across global config and all
 * timelines (base + inactive). Unrelated configuration fields are preserved.
 */
const clearAccountReferences = (scenario: Scenario, accountId: string): void => {
  scenario.netWorth.accounts = (scenario.netWorth.accounts ?? []).filter((account) => account.id !== accountId);

  const snapshot = scenario.netWorth.openingSnapshot;
  if (snapshot) {
    snapshot.accounts = (snapshot.accounts ?? []).filter((value) => value.accountId !== accountId);
  }

  if (scenario.incomeFallbackAccountId === accountId) {
    scenario.incomeFallbackAccountId = null;
  }
  if (scenario.incomeFallbackAccountId2 === accountId) {
    scenario.incomeFallbackAccountId2 = null;
  }

  clearFundingPolicyAccount(scenario.fundingPolicy, accountId);

  scenario.withdrawal.fallbackAccountIds = (scenario.withdrawal.fallbackAccountIds ?? []).filter(
    (id) => id !== accountId
  );
  (scenario.withdrawal.sourceLines ?? []).forEach((line) => {
    if (line.accountId === accountId) {
      line.accountId = '';
    }
    line.fallbackAccountIds = (line.fallbackAccountIds ?? []).filter((id) => id !== accountId);
  });

  (scenario.cashflowItems ?? []).forEach((item) => {
    if (item.accountId === accountId) {
      item.accountId = null;
    }
  });
  (scenario.lifeEvents ?? []).forEach((event) => {
    if (event.accountId === accountId) {
      event.accountId = null;
    }
  });

  (scenario.properties ?? []).forEach((property: AnyRecord) => {
    (property.fundingEvents ?? []).forEach((event: AnyRecord) => {
      if (event.accountId === accountId) {
        event.accountId = null;
      }
    });
  });

  const expenses = scenario.expenses;
  if (expenses) {
    (expenses.entries ?? []).forEach((entry) => {
      const record = entry as unknown as AnyRecord;
      if (record.accountId === accountId) {
        record.accountId = null;
      }
      if (isAccountFunding(record.fundingSource, accountId)) {
        record.fundingSource = undefined;
      }
    });
    (expenses.recurringEvents ?? []).forEach((event) => {
      const record = event as unknown as AnyRecord;
      if (record.accountId === accountId) {
        record.accountId = '';
      }
      if (record.paymentAccountId === accountId) {
        record.paymentAccountId = null;
      }
      if (isAccountFunding(record.fundingSource, accountId)) {
        record.fundingSource = undefined;
      }
    });
    if (expenses.activePlanningAccountId === accountId) {
      expenses.activePlanningAccountId = null;
    }
    delete expenses.categoriesByAccountId?.[accountId];
    delete expenses.weeklyBalanceByAccountId?.[accountId];
    delete expenses.maxBalanceByAccountId?.[accountId];
    if (expenses.ui) {
      expenses.ui.selectedAccountIds = (expenses.ui.selectedAccountIds ?? []).filter((id) => id !== accountId);
      expenses.ui.trackerVisibleAccountIds = (expenses.ui.trackerVisibleAccountIds ?? []).filter(
        (id) => id !== accountId
      );
    }
  }

  // Base timeline-local domains.
  clearTimelineLocalAccountRefs(
    (scenario.largePurchases ?? []) as AnyRecord[],
    (scenario.longTermPurchases ?? []) as AnyRecord[],
    (scenario.loans ?? []) as AnyRecord[],
    (scenario.creditCards ?? []) as AnyRecord[],
    (scenario.cardPlans ?? []) as AnyRecord[],
    scenario.careerPlan as unknown as AnyRecord,
    (scenario.housing ?? []) as AnyRecord[],
    accountId
  );

  // Every inactive/extra timeline.
  (scenario.timelines ?? []).forEach((timeline) => {
    clearTimelineLocalAccountRefs(
      (timeline.purchases ?? []) as AnyRecord[],
      (timeline.longTermPurchases ?? []) as AnyRecord[],
      (timeline.loans ?? []) as AnyRecord[],
      (timeline.creditCards ?? []) as AnyRecord[],
      (timeline.cardPlans ?? []) as AnyRecord[],
      timeline.careerPlan as unknown as AnyRecord,
      (timeline.housing ?? []) as AnyRecord[],
      accountId
    );
  });
};

/** Removes an account and every reference to it, preserving unrelated config. */
export const removeAccount = (scenario: Scenario, accountId: string): Scenario => {
  const next = deepClone(scenario);
  clearAccountReferences(next, accountId);
  return next;
};

// ---------------------------------------------------------------------------
// Marker / date-reference registry
// ---------------------------------------------------------------------------

export type MarkerReferenceScope = 'base' | 'timeline';
/** Month-precision links resolve to a `*YearMonth` field; date links to a date field. */
export type MarkerReferencePrecision = 'month' | 'date';

export interface MarkerReference {
  markerId: string;
  scope: MarkerReferenceScope;
  timelineId: string | null;
  domain: string;
  recordId: string;
  field: string;
  precision: MarkerReferencePrecision;
}

interface MarkerField {
  field: string;
  precision: MarkerReferencePrecision;
}

const CAREER_MARKER_FIELDS: MarkerField[] = [
  { field: 'startMarkerId', precision: 'month' },
  { field: 'endMarkerId', precision: 'month' }
];
const PAY_PLAN_MARKER_FIELDS: MarkerField[] = [{ field: 'effectiveMarkerId', precision: 'month' }];
const PURCHASE_MARKER_FIELDS: MarkerField[] = [{ field: 'yearMonthMarkerId', precision: 'month' }];
const LONG_TERM_MARKER_FIELDS: MarkerField[] = [
  { field: 'startMarkerId', precision: 'month' },
  { field: 'endMarkerId', precision: 'month' }
];
const LOAN_MARKER_FIELDS: MarkerField[] = [{ field: 'startMarkerId', precision: 'month' }];
const CARD_MARKER_FIELDS: MarkerField[] = [
  { field: 'introEndMarkerId', precision: 'month' },
  { field: 'autopayEndMarkerId', precision: 'month' }
];
const CARD_PLAN_MARKER_FIELDS: MarkerField[] = [
  { field: 'startMarkerId', precision: 'month' },
  { field: 'endMarkerId', precision: 'month' }
];
const HOUSING_MARKER_FIELDS: MarkerField[] = [
  { field: 'startMarkerId', precision: 'month' },
  { field: 'sellMarkerId', precision: 'month' },
  { field: 'endMarkerId', precision: 'month' }
];
const AGED_MARKER_FIELDS: MarkerField[] = [
  { field: 'startMarkerId', precision: 'month' },
  { field: 'endMarkerId', precision: 'month' }
];
const RETIREMENT_SOURCE_MARKER_FIELDS: MarkerField[] = [{ field: 'startMarkerId', precision: 'month' }];
const EXPENSE_MARKER_FIELDS: MarkerField[] = [
  { field: 'startMarkerId', precision: 'date' },
  { field: 'endMarkerId', precision: 'date' }
];

const collectMarkerRefs = (
  out: MarkerReference[],
  records: readonly AnyRecord[] | undefined,
  fields: MarkerField[],
  meta: { scope: MarkerReferenceScope; timelineId: string | null; domain: string }
): void => {
  (records ?? []).forEach((record) => {
    const recordId = typeof record?.id === 'string' ? record.id : '';
    fields.forEach(({ field, precision }) => {
      const value = record?.[field];
      if (typeof value === 'string' && value.length > 0) {
        out.push({ markerId: value, ...meta, recordId, field, precision });
      }
    });
  });
};

const collectTimelineLocalMarkerRefs = (
  out: MarkerReference[],
  data: {
    purchases?: readonly AnyRecord[];
    longTermPurchases?: readonly AnyRecord[];
    loans?: readonly AnyRecord[];
    creditCards?: readonly AnyRecord[];
    careerPlan?: AnyRecord;
    housing?: readonly AnyRecord[];
  },
  scope: MarkerReferenceScope,
  timelineId: string | null
): void => {
  collectMarkerRefs(out, data.purchases, PURCHASE_MARKER_FIELDS, { scope, timelineId, domain: 'purchase' });
  collectMarkerRefs(out, data.longTermPurchases, LONG_TERM_MARKER_FIELDS, {
    scope,
    timelineId,
    domain: 'longTermPurchase'
  });
  collectMarkerRefs(out, data.loans, LOAN_MARKER_FIELDS, { scope, timelineId, domain: 'loan' });
  collectMarkerRefs(out, data.creditCards, CARD_MARKER_FIELDS, { scope, timelineId, domain: 'creditCard' });
  collectMarkerRefs(out, data.careerPlan?.entries, CAREER_MARKER_FIELDS, { scope, timelineId, domain: 'career' });
  (data.careerPlan?.entries ?? []).forEach((career: AnyRecord) => {
    collectMarkerRefs(out, career?.payPlans, PAY_PLAN_MARKER_FIELDS, {
      scope,
      timelineId,
      domain: 'careerPayPlan'
    });
  });
  collectMarkerRefs(out, data.housing, HOUSING_MARKER_FIELDS, { scope, timelineId, domain: 'housing' });
};

/**
 * Enumerates every marker reference across the base scenario, all timelines and
 * all pay plans (including the ordinary/0% card-plan links). Deterministic order.
 */
export const scanMarkerReferences = (scenario: Scenario): MarkerReference[] => {
  const refs: MarkerReference[] = [];
  collectTimelineLocalMarkerRefs(
    refs,
    {
      purchases: scenario.largePurchases as unknown as AnyRecord[],
      longTermPurchases: scenario.longTermPurchases as unknown as AnyRecord[],
      loans: scenario.loans as unknown as AnyRecord[],
      creditCards: scenario.creditCards as unknown as AnyRecord[],
      careerPlan: scenario.careerPlan as unknown as AnyRecord,
      housing: scenario.housing as unknown as AnyRecord[]
    },
    'base',
    null
  );
  collectMarkerRefs(refs, scenario.cashflowItems as unknown as AnyRecord[], AGED_MARKER_FIELDS, {
    scope: 'base',
    timelineId: null,
    domain: 'cashflowItem'
  });
  collectMarkerRefs(refs, scenario.lifeEvents as unknown as AnyRecord[], AGED_MARKER_FIELDS, {
    scope: 'base',
    timelineId: null,
    domain: 'lifeEvent'
  });
  collectMarkerRefs(refs, scenario.withdrawal.sourceLines as unknown as AnyRecord[], RETIREMENT_SOURCE_MARKER_FIELDS, {
    scope: 'base',
    timelineId: null,
    domain: 'retirementSource'
  });
  collectMarkerRefs(refs, scenario.expenses?.entries as unknown as AnyRecord[], EXPENSE_MARKER_FIELDS, {
    scope: 'base',
    timelineId: null,
    domain: 'expense'
  });
  collectMarkerRefs(refs, scenario.expenses?.recurringEvents as unknown as AnyRecord[], EXPENSE_MARKER_FIELDS, {
    scope: 'base',
    timelineId: null,
    domain: 'recurringExpense'
  });
  collectMarkerRefs(refs, scenario.cardPlans as unknown as AnyRecord[], CARD_PLAN_MARKER_FIELDS, {
    scope: 'base',
    timelineId: null,
    domain: 'cardPlan'
  });
  (scenario.timelines ?? []).forEach((timeline) => {
    collectTimelineLocalMarkerRefs(
      refs,
      {
        purchases: timeline.purchases as unknown as AnyRecord[],
        longTermPurchases: timeline.longTermPurchases as unknown as AnyRecord[],
        loans: timeline.loans as unknown as AnyRecord[],
        creditCards: timeline.creditCards as unknown as AnyRecord[],
        careerPlan: timeline.careerPlan as unknown as AnyRecord,
        housing: timeline.housing as unknown as AnyRecord[]
      },
      'timeline',
      timeline.id
    );
    collectMarkerRefs(refs, timeline.cardPlans as unknown as AnyRecord[], CARD_PLAN_MARKER_FIELDS, {
      scope: 'timeline',
      timelineId: timeline.id,
      domain: 'cardPlan'
    });
  });
  return refs;
};

const clearFieldsInRecords = (
  records: AnyRecord[] | undefined,
  fields: MarkerField[],
  ids: Set<string>
): void => {
  (records ?? []).forEach((record) => {
    fields.forEach(({ field }) => {
      if (typeof record?.[field] === 'string' && ids.has(record[field])) {
        record[field] = null;
      }
    });
  });
};

/** Clears every reference to any of the given marker ids, across all scopes. */
const clearMarkerReferenceIds = (scenario: Scenario, ids: Set<string>): void => {
  if (ids.size === 0) {
    return;
  }
  clearFieldsInRecords(scenario.largePurchases as unknown as AnyRecord[], PURCHASE_MARKER_FIELDS, ids);
  clearFieldsInRecords(scenario.longTermPurchases as unknown as AnyRecord[], LONG_TERM_MARKER_FIELDS, ids);
  clearFieldsInRecords(scenario.loans as unknown as AnyRecord[], LOAN_MARKER_FIELDS, ids);
  clearFieldsInRecords(scenario.creditCards as unknown as AnyRecord[], CARD_MARKER_FIELDS, ids);
  clearFieldsInRecords(scenario.careerPlan?.entries as unknown as AnyRecord[], CAREER_MARKER_FIELDS, ids);
  (scenario.careerPlan?.entries ?? []).forEach((career) => {
    clearFieldsInRecords(career?.payPlans as unknown as AnyRecord[], PAY_PLAN_MARKER_FIELDS, ids);
  });
  clearFieldsInRecords(scenario.housing as unknown as AnyRecord[], HOUSING_MARKER_FIELDS, ids);
  clearFieldsInRecords(scenario.cashflowItems as unknown as AnyRecord[], AGED_MARKER_FIELDS, ids);
  clearFieldsInRecords(scenario.lifeEvents as unknown as AnyRecord[], AGED_MARKER_FIELDS, ids);
  clearFieldsInRecords(
    scenario.withdrawal.sourceLines as unknown as AnyRecord[],
    RETIREMENT_SOURCE_MARKER_FIELDS,
    ids
  );
  clearFieldsInRecords(scenario.expenses?.entries as unknown as AnyRecord[], EXPENSE_MARKER_FIELDS, ids);
  clearFieldsInRecords(scenario.expenses?.recurringEvents as unknown as AnyRecord[], EXPENSE_MARKER_FIELDS, ids);
  clearFieldsInRecords(scenario.cardPlans as unknown as AnyRecord[], CARD_PLAN_MARKER_FIELDS, ids);
  (scenario.timelines ?? []).forEach((timeline) => {
    clearFieldsInRecords(timeline.purchases as unknown as AnyRecord[], PURCHASE_MARKER_FIELDS, ids);
    clearFieldsInRecords(timeline.longTermPurchases as unknown as AnyRecord[], LONG_TERM_MARKER_FIELDS, ids);
    clearFieldsInRecords(timeline.loans as unknown as AnyRecord[], LOAN_MARKER_FIELDS, ids);
    clearFieldsInRecords(timeline.creditCards as unknown as AnyRecord[], CARD_MARKER_FIELDS, ids);
    clearFieldsInRecords(timeline.careerPlan?.entries as unknown as AnyRecord[], CAREER_MARKER_FIELDS, ids);
    (timeline.careerPlan?.entries ?? []).forEach((career) => {
      clearFieldsInRecords(career?.payPlans as unknown as AnyRecord[], PAY_PLAN_MARKER_FIELDS, ids);
    });
    clearFieldsInRecords(timeline.housing as unknown as AnyRecord[], HOUSING_MARKER_FIELDS, ids);
    clearFieldsInRecords(timeline.cardPlans as unknown as AnyRecord[], CARD_PLAN_MARKER_FIELDS, ids);
  });
};

/** Clears references to markers that no longer exist. Pure + deterministic. */
export const clearDanglingMarkerReferences = (scenario: Scenario): Scenario => {
  const valid = new Set((scenario.dateMarkers ?? []).map((marker) => marker.id));
  const dangling = new Set(
    scanMarkerReferences(scenario)
      .map((ref) => ref.markerId)
      .filter((markerId) => !valid.has(markerId))
  );
  if (dangling.size === 0) {
    return scenario;
  }
  const next = deepClone(scenario);
  clearMarkerReferenceIds(next, dangling);
  return next;
};

/** Deletes a marker and clears every reference to it across all scopes. */
export const removeDateMarker = (scenario: Scenario, markerId: string): Scenario => {
  const next = deepClone(scenario);
  next.dateMarkers = (next.dateMarkers ?? []).filter((marker) => marker.id !== markerId);
  clearMarkerReferenceIds(next, new Set([markerId]));
  return next;
};

const resolveCardPlanMarkers = (plan: CardPlan, lookup: Map<string, DateMarker>): CardPlan => {
  const resolveMonth = (value: string | null | undefined, apply: (yearMonth: string) => void, clear: () => void): void => {
    if (typeof value !== 'string' || value.length === 0) {
      return;
    }
    const marker = lookup.get(value);
    if (!marker) {
      clear();
      return;
    }
    apply(marker.date.slice(0, 7));
  };

  if (plan.kind === 'expectedPayment') {
    const next: OrdinaryCardSchedule = { ...plan };
    resolveMonth(plan.startMarkerId, (ym) => { next.startYearMonth = ym; }, () => { next.startMarkerId = null; });
    resolveMonth(plan.endMarkerId, (ym) => { next.endYearMonth = ym; }, () => { next.endMarkerId = null; });
    return next;
  }

  const next: ZeroInterestCardPlan = { ...plan };
  resolveMonth(plan.startMarkerId, (ym) => { next.startYearMonth = ym; }, () => { next.startMarkerId = null; });
  resolveMonth(plan.endMarkerId, (ym) => { next.targetYearMonth = ym; }, () => { next.endMarkerId = null; });
  return next;
};

/**
 * Resolves marker references (base + timelines + pay plans + card plans) into
 * concrete dates/year-months, clearing dangling references. Pure; the input is
 * cloned before resolution.
 */
export const resolveMarkerReferences = (
  scenario: Scenario,
  context?: { dateOfBirth?: string; currentAge?: number }
): Scenario => {
  const resolvedContext = {
    dateOfBirth: context?.dateOfBirth ?? scenario.options?.dateOfBirth ?? '',
    currentAge: context?.currentAge ?? scenario.profile?.currentAge ?? 0
  };
  const resolved = resolveDateMarkers(deepClone(scenario), resolvedContext);
  const lookup = new Map((resolved.dateMarkers ?? []).map((marker) => [marker.id, marker]));
  return {
    ...resolved,
    cardPlans: (resolved.cardPlans ?? []).map((plan) => resolveCardPlanMarkers(plan, lookup)),
    timelines: (resolved.timelines ?? []).map((timeline) => ({
      ...timeline,
      cardPlans: (timeline.cardPlans ?? []).map((plan) => resolveCardPlanMarkers(plan, lookup))
    }))
  };
};

// ---------------------------------------------------------------------------
// Career / housing chain resolution
// ---------------------------------------------------------------------------

export interface ChainContext {
  dateOfBirth: string;
  currentAge: number;
  /** Age used for `useBirthdayBasedStartAge` entries (falls back to `currentAge`). */
  birthdayBasedCareerStartAge?: number;
  referenceDate?: Date;
}

const normalizeYearMonthValue = (value: unknown): string => (isYearMonth(value) ? value : '');

const ensureUniqueCareerIds = (entries: CareerEntry[]): CareerEntry[] => {
  const seen = new Set<string>();
  return entries.map((entry) => {
    let id = entry.id;
    if (!id || seen.has(id)) {
      const baseId = id || 'career';
      let suffix = 1;
      let candidate = `${baseId}-${suffix}`;
      while (seen.has(candidate)) {
        suffix += 1;
        candidate = `${baseId}-${suffix}`;
      }
      id = candidate;
    }
    seen.add(id);
    return id === entry.id ? entry : { ...entry, id };
  });
};

/**
 * Resolves `usePreviousCareerStartAge` / `useBirthdayBasedStartAge` into concrete
 * start ages/months. Explicit marker links take precedence and are left for
 * marker resolution. Valid unrelated fields are preserved.
 */
export const resolveCareerChain = (entries: CareerEntry[], context: ChainContext): CareerEntry[] => {
  const { dateOfBirth, currentAge } = context;
  const birthdayAge = context.birthdayBasedCareerStartAge ?? currentAge;
  const normalized: CareerEntry[] = [];

  entries.forEach((entry, index) => {
    const previous = normalized[index - 1];
    const startAge = Math.min(entry.startAge ?? currentAge, entry.endAge ?? currentAge);

    if (!entry.startMarkerId && entry.useBirthdayBasedStartAge) {
      normalized.push({
        ...entry,
        usePreviousCareerStartAge: false,
        startAge: birthdayAge,
        endAge: Math.max(entry.endAge ?? birthdayAge, birthdayAge),
        startYearMonth: formatYearMonthFromAge(birthdayAge, dateOfBirth, currentAge, context.referenceDate),
        endYearMonth: normalizeYearMonthValue(entry.endYearMonth)
      });
      return;
    }

    if (!entry.startMarkerId && entry.usePreviousCareerStartAge && previous) {
      const previousEndYearMonth =
        normalizeYearMonthValue(previous.endYearMonth) ||
        formatYearMonthFromAge(previous.endAge, dateOfBirth, currentAge, context.referenceDate);
      const startYearMonth = addMonthsToYearMonth(previousEndYearMonth, 1);
      const derivedStartAge =
        ageFromYearMonth(startYearMonth, dateOfBirth, currentAge, 18, 110, context.referenceDate) ?? previous.endAge;

      normalized.push({
        ...entry,
        useBirthdayBasedStartAge: false,
        startAge: derivedStartAge,
        endAge: Math.max(entry.endAge ?? derivedStartAge, derivedStartAge),
        startYearMonth,
        endYearMonth: normalizeYearMonthValue(entry.endYearMonth)
      });
      return;
    }

    normalized.push({ ...entry, startAge, endYearMonth: normalizeYearMonthValue(entry.endYearMonth) });
  });

  return ensureUniqueCareerIds(normalized);
};

export interface HousingChainContext extends ChainContext {}

/**
 * Resolves housing chains:
 * - `linkedCareerStartId` → `startYearMonth` (career start month);
 * - `linkedCareerEndId` → `sellYearMonth` (mortgage) / `endYearMonth` (rental);
 * - `usePreviousEndAsStart` → month after the previous entry's end.
 * Explicit marker links take precedence. All other fields are preserved.
 */
export const resolveHousingChain = (
  entries: HousingEntry[],
  careers: CareerEntry[],
  context: HousingChainContext
): HousingEntry[] => {
  const { dateOfBirth, currentAge } = context;
  const careerById = new Map(careers.map((career) => [career.id, career]));
  const careerStartYearMonth = (career: CareerEntry): string =>
    normalizeYearMonthValue(career.startYearMonth) ||
    formatYearMonthFromAge(career.startAge, dateOfBirth, currentAge, context.referenceDate);
  const careerEndYearMonth = (career: CareerEntry): string =>
    normalizeYearMonthValue(career.endYearMonth) ||
    formatYearMonthFromAge(career.endAge, dateOfBirth, currentAge, context.referenceDate);

  const result: HousingEntry[] = [];
  entries.forEach((entry) => {
    const previous = result[result.length - 1];
    let next = entry;

    const startCareer =
      !entry.startMarkerId && entry.linkedCareerStartId ? careerById.get(entry.linkedCareerStartId) : undefined;
    if (startCareer) {
      next = { ...next, startYearMonth: careerStartYearMonth(startCareer) };
    } else if (!entry.startMarkerId && entry.usePreviousEndAsStart && previous) {
      const prevEnd = normalizeYearMonthValue(
        previous.housingType === 'mortgage' ? previous.sellYearMonth : previous.endYearMonth
      );
      if (prevEnd) {
        next = { ...next, startYearMonth: addMonthsToYearMonth(prevEnd, 1) };
      }
    }

    const endLinkedByMarker = Boolean(entry.sellMarkerId || entry.endMarkerId);
    const endCareer =
      !endLinkedByMarker && entry.linkedCareerEndId ? careerById.get(entry.linkedCareerEndId) : undefined;
    if (endCareer) {
      const linkedEnd = careerEndYearMonth(endCareer);
      next =
        next.housingType === 'mortgage'
          ? { ...next, sellYearMonth: linkedEnd }
          : { ...next, endYearMonth: linkedEnd };
    }

    result.push(next);
  });

  return result;
};

/** Resolves career + housing chains for the base scenario and every timeline. */
export const resolveCareerAndHousingChains = (scenario: Scenario, context: ChainContext): Scenario => {
  const next = deepClone(scenario);
  const baseCareers = resolveCareerChain(next.careerPlan.entries ?? [], context);
  next.careerPlan = { ...next.careerPlan, entries: baseCareers };
  next.housing = resolveHousingChain(next.housing ?? [], baseCareers, context);

  next.timelines = (next.timelines ?? []).map((timeline) => {
    const careers = resolveCareerChain(timeline.careerPlan.entries ?? [], context);
    return {
      ...timeline,
      careerPlan: { ...timeline.careerPlan, entries: careers },
      housing: resolveHousingChain(timeline.housing ?? [], careers, context)
    };
  });

  return next;
};

// ---------------------------------------------------------------------------
// App integration seam (no App wiring here)
// ---------------------------------------------------------------------------

/**
 * Single object the integration owner can bind into App state. Every method is
 * pure: it takes the current `Scenario` and returns a new `Scenario`.
 */
export interface ConfigurationCommands {
  getActiveTimeline: (scenario: Scenario) => Timeline | null;
  getActiveTimelineData: (scenario: Scenario) => TimelineDomainData;
  applyToActiveTimeline: (
    scenario: Scenario,
    transform: (data: TimelineDomainData) => TimelineDomainData
  ) => Scenario;
  applyGlobal: (scenario: Scenario, transform: (draft: Scenario) => Scenario) => Scenario;
  changedScenarioKeys: (before: Scenario, after: Scenario) => string[];
  isGlobalScenarioKey: (key: string) => key is GlobalScenarioKey;
  isTimelineScopeScenarioKey: (key: string) => key is TimelineScopeScenarioKey;
  addTimeline: (scenario: Scenario, options?: IdLabelOptions) => Scenario;
  switchTimeline: (scenario: Scenario, timelineId: string | null) => Scenario;
  renameTimeline: (scenario: Scenario, timelineId: string, label: string) => Scenario;
  deleteTimeline: (scenario: Scenario, timelineId: string) => Scenario;
  duplicateTimeline: (scenario: Scenario, timelineId: string, options?: IdLabelOptions) => Scenario;
  updateCareer: (scenario: Scenario, career: CareerEntry) => Scenario;
  addCareer: (scenario: Scenario, entry: CareerEntry) => Scenario;
  removeCareer: (scenario: Scenario, careerId: string) => Scenario;
  duplicateCareer: (scenario: Scenario, careerId: string, options?: IdLabelOptions) => Scenario;
  reorderCareers: (scenario: Scenario, fromCareerId: string, toCareerId: string) => Scenario;
  addCareerPayPlan: (scenario: Scenario, careerId: string, plan: CareerPayPlan) => Scenario;
  updateCareerPayPlan: (scenario: Scenario, careerId: string, plan: CareerPayPlan) => Scenario;
  removeCareerPayPlan: (scenario: Scenario, careerId: string, planId: string) => Scenario;
  addAccount: (scenario: Scenario, account: Scenario['netWorth']['accounts'][number]) => Scenario;
  updateAccount: (scenario: Scenario, account: Scenario['netWorth']['accounts'][number]) => Scenario;
  removeAccount: (scenario: Scenario, accountId: string) => Scenario;
  resolveMarkerReferences: (
    scenario: Scenario,
    context?: { dateOfBirth?: string; currentAge?: number }
  ) => Scenario;
  clearDanglingMarkerReferences: (scenario: Scenario) => Scenario;
  removeDateMarker: (scenario: Scenario, markerId: string) => Scenario;
  resolveCareerAndHousingChains: (scenario: Scenario, context: ChainContext) => Scenario;
  deepClone: <T>(value: T) => T;
  deepFreeze: <T>(value: T) => Readonly<T>;
}

export const createConfigurationCommands = (): ConfigurationCommands => ({
  getActiveTimeline,
  getActiveTimelineData,
  applyToActiveTimeline,
  applyGlobal,
  changedScenarioKeys,
  isGlobalScenarioKey,
  isTimelineScopeScenarioKey,
  addTimeline,
  switchTimeline,
  renameTimeline,
  deleteTimeline,
  duplicateTimeline,
  updateCareer,
  addCareer,
  removeCareer,
  duplicateCareer,
  reorderCareers,
  addCareerPayPlan,
  updateCareerPayPlan,
  removeCareerPayPlan,
  addAccount,
  updateAccount,
  removeAccount,
  resolveMarkerReferences,
  clearDanglingMarkerReferences,
  removeDateMarker,
  resolveCareerAndHousingChains,
  deepClone,
  deepFreeze
});
