/**
 * P3H.1/P3H.2/P3H.3/P3H.4 — Housing / property stream (O, engine-internal).
 *
 * This module is the headless housing processor: it exports the recurring
 * {@link EventDefinition}s it schedules (`buildHousingEventDefinitions`) and the
 * Phase-3 {@link ProjectionEventHandler}s that execute them
 * (`createHousingHandlers`). It owns **only** these responsibilities (D12):
 *
 * - **P3H.1 — owned property appreciation.** A `close`-phase, per-property,
 *   monthly event posts property appreciation through
 *   {@link quotePropertyAppreciation} (the D11 single valuation owner). A
 *   `pending` acquisition holds a non-appreciating deposit and never gains value;
 *   a `sold` property is disposed. There is no duplicated appreciation formula.
 * - **P3H.2 — held-deposit acquisition.** Each explicitly dated
 *   {@link PropertyFundingEvent} funds a non-liquid acquisition deposit. A
 *   pending acquisition never gains a full home value, a mortgage, or ownership
 *   costs; when the funded deposit reaches the required down payment the
 *   acquisition completes **atomically in the same commit as the funding** —
 *   the previously held deposit is released and the new cash becomes home
 *   equity. Partial/zero funding keeps the held net and completes nothing; only
 *   an explicitly scheduled later funding event may retry. Zero-down completion
 *   is a separate event and needs no funding.
 * - **P3H.3 — grouped housing payments and rental income.** A linked mortgage
 *   accrues monthly at the nominal `APR/12` via
 *   {@link quoteDebtMonthlyAccrual} (never re-implemented; `loans.ts` skips a
 *   liability linked to a property, so there is no double accrual) and pays a
 *   `mandatory` PI+extra installment computed with loans.ts
 *   {@link quoteLoanInstallment} (standard amortized payment), funded-only and
 *   interest-first. Ancillary tax+insurance, HOA+maintenance, and actual-LTV PMI
 *   groups, plus rent, are independent ordered account-funded groups. Each group
 *   honors an explicit per-group `HousingEntry.fundingPolicies` override
 *   (`payment` = PI+extra / rent; plus `taxesInsurance`, `hoaMaintenance`, `pmi`
 *   and the dated-acquisition `downPayment`) whose primary + ordered fallbacks
 *   are used verbatim; an explicit `null` primary with no fallbacks stays visibly
 *   unresolved rather than inheriting the global default. Without an override the
 *   legacy `*Source` scalar falls back to `paymentSource`, then the configured
 *   global default order. Ancillary costs persist after mortgage payoff
 *   until the housing end/sale, PMI applies only while actual principal `> 0`
 *   and actual LTV `> 80%`, and rental income is a housing-owned `income`-phase
 *   deposit (never salary).
 * - **P3H.4 — atomic sale/disposition.** Current property value and actual linked
 *   debt only: selling costs are charged once; linked debt is settled from sale
 *   value; net surplus is deposited into the configured proceeds account; an
 *   underwater shortfall is retained once as a runtime `saleDeficiency`
 *   liability. No fabricated historic proceeds/amortization.
 *
 * ### CA09 (ADR-020 / frozen P0.5.3) exact sequence
 *
 * `$30k` held toward a `$60k` down payment:
 * 1. funding event 1: cash `−$30k`, property deposit `+$30k` (status pending,
 *    value 0, no mortgage).
 * 2. funding event 2: cash `−$30k`, then the acquisition completes in the same
 *    commit with deposit **delta `−$30k`** (the previously held `$30k` is
 *    released and the new `$30k` becomes equity — state only ever held `$30k`,
 *    so `−$60k` is exactly the double-count bug), property value `+$300k`,
 *    mortgage liability `+$240k` → net-worth delta `0` and **no second
 *    down-payment expense**.
 *
 * A scheduled event's amount is a **ceiling**: the handler caps the requested
 * net at the down payment still outstanding (`required − held`), so
 * `held $55k + event $10k` toward a `$60k` down payment debits only the `$5k`
 * remaining and never overfunds. A met (or zero) requirement debits nothing and
 * completes nothing — no silent overfund, no fabricated refund, and no
 * incomplete property is ever created.
 *
 * ### Handler seam contract (D10)
 *
 * Handlers post only through `state.commitChanges` (directly, or via
 * `quoteFunding` + `commitFunding` for cash-funded obligations). A zero/unfunded
 * target never fabricates a plan row. Cash-funded postings (acquisition deposit
 * funding, mortgage PI+extra, taxes/insurance, HOA/maintenance, PMI, rent) return
 * the real {@link FundingPlan}; the direct non-cash postings (property
 * appreciation, zero-down completion, sale, mortgage interest accrual, rental
 * income) return `{ committed: true, plan: null }` — the D10 facade now accepts a
 * legitimate direct commit without a plan, so no fabricated funding plan is ever
 * produced.
 *
 * Every `quoteFunding` path additionally returns its actual quote as `quote` on
 * the result (P4.1/D16) — committed, partial, zero-executed or invalid-commit —
 * so the facade records a {@link ProjectionFundingOutcome} (with eligible-source
 * balances and typed skip reasons) even when nothing was paid. Zero/no-obligation
 * paths (invalid terms, no liability, already-met requirement, non-positive
 * target) and the direct non-cash postings return no quote — the outcome is never
 * fabricated.
 *
 * ### Same-date ordering
 *
 * Everything acquisition/disposition related uses the `accrual` phase with an
 * **explicit priority**: sale (`10`) → funding (`20`) → completion (`30`), so a
 * same-date sale's proceeds settle before a later acquisition funds, and a
 * same-date funding event is held before the acquisition completes.
 *
 * ### Context / linkage (S + integration note)
 *
 * `context.properties` (canonical identity/status/required down payment/
 * appreciation/sale rates) and `context.domains.housing` (the legacy
 * {@link HousingEntry} config: acquisition price, sale date, proceeds account,
 * funding groups) are linked through the property's `sourceConfigId`, falling
 * back to a matching `propertyId`/`id`. A `pending` property's compiled `value`
 * is `0` (opening.ts), so its acquisition price comes from the linked housing
 * entry's `purchasePrice`.
 *
 * The compiled context exposes only `fundingEventAccountIds`, not the dated
 * `fundingEvents`, so {@link buildHousingContext} maps the persisted
 * `PropertyDefinition.fundingEvents` onto the structural
 * {@link HousingContext} used to schedule events. Handlers do **not** need the
 * funding-event list (the amount arrives as the execution target and completion
 * is driven by live state), so `createHousingHandlers(deps)` works directly
 * against the compiled context; only event scheduling needs the richer context.
 */

import type {
  FundingPolicy,
  HousingEntry,
  HousingFundingGroup,
  HousingType,
  PropertyDefinition,
  PropertyFundingEvent,
  PropertyStatus,
  Scenario
} from '../types';
import type { CompiledLiability } from './configuration';
import { addMonths, compareDateOnly, endOfMonthDate, isValidDateOnly, isValidYearMonth } from './dates';
import { commitFunding, quoteFunding } from './funding';
import type { CommitFundingOptions, FundingCommitResult, RelatedChangePreparer } from './funding';
import { quoteLoanInstallment, remainingTermMonths } from './loans';
import { dollarsToCents, roundHalfAwayFromZero, type Cents } from './money';
import type { FundingPlan, FundingRequest } from './contracts';
import type { PostingContext } from './journal';
import type { ProjectionExecutionResult, ProjectionEventHandler, ProjectionHandlerDependencies } from './projection';
import type { EventDefinition, EventExecutionContext } from './scheduler';
import type { AccountChange, EngineState, LiabilityChange, PropertyChange } from './state';
import { monthFractionForDates, quoteDebtMonthlyAccrual, quotePropertyAppreciation } from './valuation';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Stable handler ids; the facade routes `event.handlerId` → handler. */
export const HOUSING_HANDLER_IDS = Object.freeze({
  funding: 'housing.funding',
  completion: 'housing.completion',
  appreciation: 'housing.appreciation',
  sale: 'housing.sale',
  accrual: 'housing.accrual',
  mortgage: 'housing.mortgage',
  taxesInsurance: 'housing.taxesInsurance',
  hoaMaintenance: 'housing.hoaMaintenance',
  pmi: 'housing.pmi',
  rent: 'housing.rent',
  rentalIncome: 'housing.rentalIncome'
} as const);

export type HousingHandlerId = (typeof HOUSING_HANDLER_IDS)[keyof typeof HOUSING_HANDLER_IDS];

/** Definition-id namespace: `housing:<propertyId>:<kind>[...]`. */
export const HOUSING_DEFINITION_NAMESPACE = 'housing:';

/**
 * Plan-id namespace for a **property-free standalone rental** (P5.1/F17): a
 * rental {@link HousingEntry} that is not linked to any configured
 * `PropertyDefinition`. The plan id is `rental:<housingId>`, so its scheduled
 * definition ids are `housing:rental:<housingId>:<kind>` and can never collide
 * with a real property's plan id (`housing:<propertyId>:<kind>`).
 */
export const STANDALONE_RENTAL_NAMESPACE = 'rental:';

/** Stable property-free standalone rental plan id: `rental:<housingId>`. */
export const standaloneRentalPlanId = (housingId: string): string =>
  `${STANDALONE_RENTAL_NAMESPACE}${housingId}`;

/**
 * Same-date priority within a phase (lower runs earlier). `accrual`-phase order
 * is mortgage interest (`accrual`, 5) → sale (10) → acquisition funding (20) →
 * acquisition completion (30), so interest accrues before a same-date
 * settlement/funding. `mandatory`-phase order is mortgage PI+extra / rent (10) →
 * taxes+insurance (20) → HOA+maintenance (30) → PMI (40). Priorities only matter
 * within one phase.
 */
export const HOUSING_PRIORITY = Object.freeze({
  accrual: 5,
  sale: 10,
  funding: 20,
  completion: 30,
  mortgage: 10,
  rent: 10,
  taxesInsurance: 20,
  hoaMaintenance: 30,
  pmi: 40
} as const);

/**
 * Non-monetary execution sentinel. A state-dependent lifecycle posting (sale,
 * zero-down completion, appreciation gate) resolves to this non-zero target so
 * the facade invokes `execute`; the handler posts only real deltas and returns
 * `committed: false` (no fabricated plan) when nothing applies. The facade skips
 * a `0` target entirely, so `1` is the smallest activation value.
 */
export const HOUSING_EXECUTION_SENTINEL_CENTS = 1;

/** Purpose labels for the scheduled occurrences (audit/reporting friendly). */
export const HOUSING_PURPOSES = Object.freeze({
  funding: 'housingAcquisitionDeposit',
  completion: 'housingAcquisitionCompletion',
  appreciation: 'housingPropertyAppreciation',
  sale: 'housingDisposition',
  mortgageAccrual: 'housingMortgageAccrual',
  mortgagePayment: 'housingMortgagePayment',
  taxesInsurance: 'housingTaxesInsurance',
  hoaMaintenance: 'housingHoaMaintenance',
  pmi: 'housingPmi',
  rent: 'housingRent',
  rentalIncome: 'housingRentalIncome'
} as const);

// ---------------------------------------------------------------------------
// Context shapes (structural so `CompiledScenarioContext` is accepted)
// ---------------------------------------------------------------------------

/**
 * The subset of a canonical property the housing stream needs. `CompiledProperty`
 * (and, via {@link buildHousingContext}, a persisted `PropertyDefinition`)
 * satisfies this structurally. `sourceConfigId`/`fundingEvents` are optional
 * because the compiled shape does not yet carry them.
 */
export interface HousingPropertyConfig {
  readonly propertyId: string;
  readonly label?: string;
  readonly status: PropertyStatus;
  /** Persisted dollars; opening observed value (`0` for an unobserved pending property). */
  readonly value: number;
  /** Persisted dollars; required down payment. */
  readonly requiredDownPayment: number;
  /** Linked mortgage liability id, or `null`. */
  readonly debtLink: string | null;
  readonly acquisitionYearMonth?: string | null;
  /** Property appreciation rate (%). */
  readonly appreciationRate?: number;
  /** Selling cost rate (%). */
  readonly sellingCostsRate?: number;
  /** Links back to the legacy config (`HousingEntry.id`). */
  readonly sourceConfigId?: string | null;
  /** Dated acquisition-deposit funding events (persisted on `PropertyDefinition`). */
  readonly fundingEvents?: readonly PropertyFundingEvent[];
}

/** Metadata the appreciation recurrence needs (satisfied by `CompiledContextMetadata`). */
export interface HousingContextMetadata {
  readonly startDate: string;
  readonly endDate?: string | null;
}

/**
 * The structural housing context. A `CompiledScenarioContext` is assignable;
 * {@link buildHousingContext} additionally carries the persisted
 * `fundingEvents`. `liabilities` is optional because only the P3H.3 mortgage
 * terms need it (HousingEntry terms are the fallback).
 */
export interface HousingContext {
  readonly properties: readonly HousingPropertyConfig[];
  readonly domains: { readonly housing: readonly HousingEntry[] };
  readonly liabilities?: readonly CompiledLiability[];
  readonly metadata?: HousingContextMetadata;
}

/** P3H.3 grouped payment sources (PI+extra/rent, tax+insurance, HOA+maintenance, PMI). */
export type HousingPaymentGroup = 'mortgage' | 'rent' | 'taxesInsurance' | 'hoaMaintenance' | 'pmi';

/**
 * One resolved housing payment group: configured monthly outflow + ordered
 * funding source (G20/G22).
 *
 * The order is either an explicit per-group `FundingPolicy` (primary + ordered
 * fallbacks used verbatim) or the legacy scalar group source falling back to
 * `paymentSource`. `inheritsGlobalDefaults` distinguishes the two: legacy/no
 * override inherits the configured global default order when its own order is
 * empty, while an explicit policy with a `null` primary + empty fallbacks stays
 * **visibly unresolved** and never silently uses the global default.
 */
export interface HousingGroupPlan {
  readonly group: HousingPaymentGroup;
  /** Configured monthly outflow in cents (`0` disables the group). */
  readonly monthlyCents: number;
  /** Normalized configured primary account id, or `null`. */
  readonly source: string | null;
  /** Ordered normalized fallback account ids (explicit policy only, else empty). */
  readonly fallbackAccountIds: readonly string[];
  /**
   * `true` → an empty resolved order may fall back to the configured global
   * default policy (legacy inheritance). `false` → an explicit per-group policy
   * is authoritative; an empty order remains unresolved.
   */
  readonly inheritsGlobalDefaults: boolean;
}

/**
 * Resolved ordered source for the acquisition down-payment group (`downPayment`).
 * `explicit` is `true` when the order comes from `fundingPolicies.downPayment`:
 * the per-event `accountId` legacy scalar is then ignored and an empty order is
 * never redirected to the global default.
 */
export interface HousingDownPaymentPlan {
  readonly source: string | null;
  readonly fallbackAccountIds: readonly string[];
  readonly inheritsGlobalDefaults: boolean;
  readonly explicit: boolean;
}

/** Contractual mortgage terms (nominal APR; standard-PMT installment). */
export interface HousingMortgageTerms {
  /** Nominal APR as a percentage (`6.5` for `6.5%`). */
  readonly aprPercent: number;
  readonly minimumPaymentCents: number;
  readonly extraPaymentCents: number;
  /** Inclusive final scheduled month (`YYYY-MM`), or `null` (open term). */
  readonly endYearMonth: string | null;
  readonly paymentDay: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * P4.1/D15 posting stamp derived from the executing occurrence (D15). Every
 * committed housing transaction carries one; `purpose` defaults to the scheduled
 * occurrence's purpose, and the phase is the occurrence phase (`accrual`,
 * `mandatory`, `income` or `close`).
 */
const housingPosting = (execution: EventExecutionContext, purpose?: string): PostingContext => ({
  occurrenceId: execution.event.occurrenceId,
  definitionId: execution.event.definitionId,
  purpose: purpose ?? execution.event.purpose,
  date: execution.date,
  phase: execution.event.phase
});

/**
 * Commits a housing funding plan with the D15 posting stamp. The P4.1 kernel
 * funding owner threads `options.posting` into the plan's single atomic
 * `state.commitChanges`; this typed helper keeps the stamp independent of the
 * option's shape so the housing stream never fabricates a second commit.
 */
const commitHousingFunding = (
  state: EngineState,
  plan: FundingPlan,
  posting: PostingContext,
  prepareRelatedChanges?: RelatedChangePreparer
): FundingCommitResult => {
  const options: CommitFundingOptions & { readonly posting: PostingContext } = prepareRelatedChanges
    ? { posting, prepareRelatedChanges }
    : { posting };
  return commitFunding(state, plan, options);
};

const toCents = (dollars: number | undefined | null): number => {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars < 0) {
    return 0;
  }
  try {
    return dollarsToCents(dollars);
  } catch {
    return 0;
  }
};

const normalizeAccountRef = (source: string | null | undefined): string | null => {
  if (typeof source !== 'string' || source.length === 0 || source === 'income') {
    return null;
  }
  return source.startsWith('account:') ? source.slice('account:'.length) : source;
};

const validYearMonthOrNull = (value: string | null | undefined): string | null =>
  typeof value === 'string' && isValidYearMonth(value) ? value : null;

/** Normalizes an ordered list of account refs, dropping null/empty/duplicates. */
const normalizeAccountRefs = (refs: readonly (string | null | undefined)[] | undefined): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs ?? []) {
    const id = normalizeAccountRef(ref);
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
};

/** One group's ordered funding source plus its inheritance semantics. */
interface ResolvedGroupSource {
  readonly primary: string | null;
  readonly fallbackAccountIds: readonly string[];
  readonly inheritsGlobalDefaults: boolean;
  readonly explicit: boolean;
}

/**
 * Resolves one housing group's ordered funding source (G20/G22).
 *
 * 1. An explicit `entry.fundingPolicies[group]` is authoritative: its primary +
 *    ordered fallbacks are used **exactly** (deduped primary-first by the quote),
 *    and an empty order stays visibly unresolved (never redirected to global).
 * 2. Otherwise the legacy scalar group source is normalized, falling back to
 *    `paymentSource`; an empty order may then inherit the configured global
 *    default order.
 *
 * `group` is the persisted {@link HousingFundingGroup} key (`payment` covers both
 * a mortgage installment and rental rent).
 */
const resolveGroupSource = (
  entry: HousingEntry | undefined,
  group: HousingFundingGroup,
  legacyScalar: string | null | undefined,
  paymentSource: string | null
): ResolvedGroupSource => {
  const policy: FundingPolicy | undefined = entry?.fundingPolicies?.[group];
  if (policy !== undefined) {
    return {
      primary: normalizeAccountRef(policy.primaryAccountId),
      fallbackAccountIds: normalizeAccountRefs(policy.fallbackAccountIds),
      inheritsGlobalDefaults: false,
      explicit: true
    };
  }
  return {
    primary: normalizeAccountRef(legacyScalar) ?? paymentSource,
    fallbackAccountIds: [],
    inheritsGlobalDefaults: true,
    explicit: false
  };
};

const housingGroupPlan = (
  group: HousingPaymentGroup,
  monthlyCents: number,
  source: ResolvedGroupSource
): HousingGroupPlan => ({
  group,
  monthlyCents,
  source: source.primary,
  fallbackAccountIds: source.fallbackAccountIds,
  inheritsGlobalDefaults: source.inheritsGlobalDefaults
});

const housingDownPaymentPlan = (source: ResolvedGroupSource): HousingDownPaymentPlan => ({
  source: source.primary,
  fallbackAccountIds: source.fallbackAccountIds,
  inheritsGlobalDefaults: source.inheritsGlobalDefaults,
  explicit: source.explicit
});

/** One property's fully resolved acquisition / appreciation / sale plan (cents). */
export interface HousingPropertyPlan {
  readonly propertyId: string;
  readonly status: PropertyStatus;
  readonly priceCents: number;
  readonly requiredDownPaymentCents: number;
  readonly mortgageId: string | null;
  readonly appreciationRate: number;
  readonly sellingCostsRate: number;
  readonly saleProceedsAccountId: string | null;
  readonly saleDate: string | null;
  readonly completionDate: string | null;
  readonly fundingEvents: readonly {
    readonly id: string;
    readonly date: string;
    readonly amountCents: number;
    readonly accountId: string | null;
  }[];
  /** Legacy housing type (`mortgage`/`rental`), or `null` for a canonical-only property. */
  readonly housingType: HousingType | null;
  /** First-of-month housing start date (`YYYY-MM-DD`), or `null`. */
  readonly startDate: string | null;
  /** Inclusive rental end date (`YYYY-MM-DD`), or `null` when open-ended. */
  readonly endDate: string | null;
  /** Contractual mortgage terms for a linked debt, or `null`. */
  readonly mortgage: HousingMortgageTerms | null;
  /** Grouped monthly outflow plans keyed by group. */
  readonly groups: Readonly<Record<HousingPaymentGroup, HousingGroupPlan>>;
  /**
   * Ordered source for the dated acquisition down-payment group, or `null` for a
   * property-free standalone rental (which has no acquisition). The per-event
   * `PropertyFundingEvent.accountId` remains the legacy primary when the group
   * has no explicit `fundingPolicies.downPayment`.
   */
  readonly downPayment: HousingDownPaymentPlan | null;
  /** Configured rental income inflow, or `null`. */
  readonly rentalIncome: { readonly monthlyCents: number; readonly accountId: string | null } | null;
  /**
   * `true` for a property-free standalone rental (P5.1/F17): a rental
   * {@link HousingEntry} not linked to any configured property. It schedules
   * rent/ancillary obligations and optional rental income against accounts only,
   * and never creates an {@link EngineState} property, mortgage, debt,
   * appreciation or sale.
   */
  readonly propertyFree: boolean;
}

const indexHousing = (context: HousingContext): Map<string, HousingEntry> => {
  const map = new Map<string, HousingEntry>();
  for (const entry of context.domains.housing) {
    map.set(entry.id, entry);
  }
  return map;
};

const linkedHousing = (
  property: HousingPropertyConfig,
  housingById: Map<string, HousingEntry>
): HousingEntry | undefined => {
  const viaSource = property.sourceConfigId ? housingById.get(property.sourceConfigId) : undefined;
  return viaSource ?? housingById.get(property.propertyId);
};

const readFundingEvents = (
  property: HousingPropertyConfig,
  housing: HousingEntry | undefined
): readonly PropertyFundingEvent[] => {
  if (property.fundingEvents && property.fundingEvents.length > 0) {
    return property.fundingEvents;
  }
  // Integration-forward-compatible: a housing entry may later carry funding
  // events directly. The canonical home remains `PropertyDefinition.fundingEvents`.
  const fromHousing = (housing as (HousingEntry & { fundingEvents?: readonly PropertyFundingEvent[] }) | undefined)
    ?.fundingEvents;
  return fromHousing ?? [];
};

/**
 * P5.1/F17 — resolves a **property-free standalone rental** `HousingEntry` into
 * a pure obligation descriptor. It carries only the recurring rent/ancillary
 * outflows and optional rental income (property-backed semantics are omitted),
 * so no {@link EngineState} property, mortgage, debt, appreciation or sale is
 * ever fabricated: `priceCents`/`requiredDownPaymentCents` are `0`, `mortgage`/
 * `saleDate`/`completionDate`/`fundingEvents` are empty, and `propertyFree` is
 * `true`.
 */
const standaloneRentalPlan = (entry: HousingEntry): HousingPropertyPlan => {
  const paymentSource = normalizeAccountRef(entry.paymentSource);
  const paymentGroup = resolveGroupSource(entry, 'payment', entry.paymentSource, paymentSource);

  // Renters insurance (`homeInsuranceYearly`) and taxes share the escrow group;
  // HOA + maintenance share the HOA group. No PMI (there is no mortgage).
  const yearlyInsuranceCents = toCents(entry.propertyTaxYearly) + toCents(entry.homeInsuranceYearly);
  const groups: Record<HousingPaymentGroup, HousingGroupPlan> = {
    mortgage: housingGroupPlan('mortgage', 0, paymentGroup),
    rent: housingGroupPlan('rent', toCents(entry.monthlyRent), paymentGroup),
    taxesInsurance: housingGroupPlan(
      'taxesInsurance',
      roundHalfAwayFromZero(yearlyInsuranceCents / 12),
      resolveGroupSource(entry, 'taxesInsurance', entry.taxesInsuranceSource, paymentSource)
    ),
    hoaMaintenance: housingGroupPlan(
      'hoaMaintenance',
      toCents(entry.hoaMonthly) + toCents(entry.maintenanceMonthly),
      resolveGroupSource(entry, 'hoaMaintenance', entry.hoaMaintenanceSource, paymentSource)
    ),
    pmi: housingGroupPlan('pmi', 0, resolveGroupSource(entry, 'pmi', entry.pmiSource, paymentSource))
  };

  const startYM = validYearMonthOrNull(entry.startYearMonth);
  const endYM = validYearMonthOrNull(entry.endYearMonth);
  const rentalIncomeMonthly = toCents(entry.rentalIncomeMonthly);
  const rentalIncome =
    rentalIncomeMonthly > 0
      ? { monthlyCents: rentalIncomeMonthly, accountId: normalizeAccountRef(entry.rentalIncomeAccountId) }
      : null;

  return {
    propertyId: standaloneRentalPlanId(entry.id),
    // Nominal active status only; no runtime property is ever created for it.
    status: 'owned',
    priceCents: 0,
    requiredDownPaymentCents: 0,
    mortgageId: null,
    appreciationRate: 0,
    sellingCostsRate: 0,
    saleProceedsAccountId: null,
    saleDate: null,
    completionDate: null,
    fundingEvents: [],
    housingType: 'rental',
    startDate: startYM === null ? null : `${startYM}-01`,
    endDate: endYM === null ? null : endOfMonthDate(endYM),
    mortgage: null,
    groups,
    downPayment: null,
    rentalIncome,
    propertyFree: true
  };
};

/**
 * Resolves every property in the context into a deterministic {@link HousingPropertyPlan},
 * followed by every **property-free standalone rental** (P5.1/F17): a rental
 * `HousingEntry` not linked to any configured property. The selected timeline's
 * `domains.housing` is the only source, so a rental never leaks across
 * timelines. Pure: reads only, converts dollars→cents once at this boundary,
 * never mutates.
 */
export const resolveHousingPlans = (context: HousingContext): HousingPropertyPlan[] => {
  const housingById = indexHousing(context);
  const linkedHousingIds = new Set<string>();
  const propertyPlans = context.properties.map((property) => {
    const housing = linkedHousing(property, housingById);
    if (housing) {
      linkedHousingIds.add(housing.id);
    }

    // A pending property's compiled value is 0 (opening.ts); its acquisition
    // price is the linked housing entry's `purchasePrice`.
    const priceDollars = property.value > 0 ? property.value : housing?.purchasePrice ?? 0;
    const priceCents = toCents(priceDollars);
    const requiredDownPaymentCents = toCents(property.requiredDownPayment);

    const fundingEvents = readFundingEvents(property, housing)
      .filter((event) => isValidDateOnly(event.date))
      .map((event) => ({
        id: event.id,
        date: event.date,
        amountCents: toCents(event.amount),
        accountId: normalizeAccountRef(event.accountId)
      }))
      .sort((a, b) => compareDateOnly(a.date, b.date) || a.id.localeCompare(b.id));

    const acquisitionYM = validYearMonthOrNull(property.acquisitionYearMonth);
    const housingStartYM = validYearMonthOrNull(housing?.startYearMonth);
    const completionDate =
      acquisitionYM !== null
        ? `${acquisitionYM}-01`
        : housingStartYM !== null
          ? `${housingStartYM}-01`
          : fundingEvents.length > 0
            ? fundingEvents[fundingEvents.length - 1].date
            : null;

    const sellYM = validYearMonthOrNull(housing?.sellYearMonth);

    const housingType = housing?.housingType ?? null;
    const startYM = housingStartYM ?? acquisitionYM;
    const startDate = startYM === null ? null : `${startYM}-01`;

    // --- P3H.3 grouped payment sources (G20/G22) ---------------------------
    // PI+extra/rent share the `payment` group; each ancillary group has its own
    // source. An explicit per-group `FundingPolicy` is authoritative (primary +
    // ordered fallbacks exactly); otherwise the legacy scalar falls back to
    // `paymentSource`, then the global defaults.
    const paymentSource = normalizeAccountRef(housing?.paymentSource);
    const paymentGroup = resolveGroupSource(housing, 'payment', housing?.paymentSource, paymentSource);

    const yearlyEscrowCents = toCents(housing?.propertyTaxYearly) + toCents(housing?.homeInsuranceYearly);
    const groups: Record<HousingPaymentGroup, HousingGroupPlan> = {
      mortgage: housingGroupPlan('mortgage', 0, paymentGroup),
      rent: housingGroupPlan('rent', toCents(housing?.monthlyRent), paymentGroup),
      taxesInsurance: housingGroupPlan(
        'taxesInsurance',
        roundHalfAwayFromZero(yearlyEscrowCents / 12),
        resolveGroupSource(housing, 'taxesInsurance', housing?.taxesInsuranceSource, paymentSource)
      ),
      hoaMaintenance: housingGroupPlan(
        'hoaMaintenance',
        toCents(housing?.hoaMonthly) + toCents(housing?.maintenanceMonthly),
        resolveGroupSource(housing, 'hoaMaintenance', housing?.hoaMaintenanceSource, paymentSource)
      ),
      pmi: housingGroupPlan(
        'pmi',
        toCents(housing?.pmiMonthly),
        resolveGroupSource(housing, 'pmi', housing?.pmiSource, paymentSource)
      )
    };

    // The down-payment group's legacy scalar is `downPaymentSource` (then
    // `paymentSource`); the dated per-event `accountId` remains the primary when
    // no explicit policy exists (applied in the funding handler).
    const downPayment = housingDownPaymentPlan(
      resolveGroupSource(
        housing,
        'downPayment',
        housing?.downPaymentSource ?? housing?.paymentSource,
        paymentSource
      )
    );

    const liability =
      property.debtLink === null
        ? undefined
        : context.liabilities?.find((entry) => entry.liabilityId === property.debtLink);

    const loanTermYears =
      typeof housing?.loanTermYears === 'number' && Number.isFinite(housing.loanTermYears)
        ? Math.max(0, Math.round(housing.loanTermYears))
        : 0;
    const derivedEndYM = startYM !== null && loanTermYears > 0 ? addMonths(startYM, loanTermYears * 12 - 1) : null;
    const mortgage: HousingMortgageTerms | null =
      property.debtLink === null
        ? null
        : {
            aprPercent:
              liability?.annualInterestRate ?? housing?.annualInterestRate ?? 0,
            minimumPaymentCents: toCents(liability?.minimumMonthlyPayment ?? 0),
            extraPaymentCents: toCents(housing?.extraMonthlyPayment ?? liability?.extraMonthlyPayment ?? 0),
            endYearMonth: validYearMonthOrNull(liability?.endYearMonth) ?? derivedEndYM,
            paymentDay:
              typeof liability?.paymentDay === 'number' && liability.paymentDay >= 1 && liability.paymentDay <= 31
                ? liability.paymentDay
                : 1
          };

    const rentalEndYM = housingType === 'rental' ? validYearMonthOrNull(housing?.endYearMonth) : null;
    const rentalIncomeMonthly = toCents(housing?.rentalIncomeMonthly);
    const rentalIncome =
      housingType === 'rental' && rentalIncomeMonthly > 0
        ? { monthlyCents: rentalIncomeMonthly, accountId: normalizeAccountRef(housing?.rentalIncomeAccountId) }
        : null;

    return {
      propertyId: property.propertyId,
      status: property.status,
      priceCents,
      requiredDownPaymentCents,
      mortgageId: property.debtLink,
      appreciationRate: property.appreciationRate ?? housing?.appreciationRate ?? 0,
      sellingCostsRate: property.sellingCostsRate ?? housing?.sellingCostsRate ?? 0,
      saleProceedsAccountId: normalizeAccountRef(housing?.saleProceedsAccountId),
      saleDate: sellYM === null ? null : `${sellYM}-01`,
      completionDate,
      fundingEvents,
      housingType,
      startDate,
      endDate: rentalEndYM === null ? null : endOfMonthDate(rentalEndYM),
      mortgage,
      groups,
      downPayment,
      rentalIncome,
      propertyFree: false
    };
  });

  // P5.1/F17 — property-free standalone rentals: rental entries the selected
  // timeline exposes that no configured property links to (`sourceConfigId`
  // else id). They are pure obligation descriptors with no runtime property.
  const standaloneRentals = context.domains.housing
    .filter((entry) => entry.housingType === 'rental' && !linkedHousingIds.has(entry.id))
    .map((entry) => standaloneRentalPlan(entry));

  return [...propertyPlans, ...standaloneRentals];
};

interface AcquisitionTerms {
  readonly ok: boolean;
  readonly mortgageCents: number;
  readonly message?: string;
}

/**
 * Validates acquisition terms before any posting: a positive price, a
 * non-negative required down payment that does not exceed the price, and
 * balanced terms when there is no mortgage link (a fully-cash purchase).
 */
export const validateAcquisitionTerms = (plan: HousingPropertyPlan): AcquisitionTerms => {
  if (!Number.isSafeInteger(plan.priceCents) || plan.priceCents <= 0) {
    return { ok: false, mortgageCents: 0, message: `Property "${plan.propertyId}" has no valid acquisition price.` };
  }
  if (!Number.isSafeInteger(plan.requiredDownPaymentCents) || plan.requiredDownPaymentCents < 0) {
    return { ok: false, mortgageCents: 0, message: `Property "${plan.propertyId}" has an invalid required down payment.` };
  }
  if (plan.requiredDownPaymentCents > plan.priceCents) {
    return {
      ok: false,
      mortgageCents: 0,
      message: `Property "${plan.propertyId}" required down payment exceeds its acquisition price.`
    };
  }
  const mortgageCents = plan.priceCents - plan.requiredDownPaymentCents;
  if (plan.mortgageId === null && mortgageCents !== 0) {
    return {
      ok: false,
      mortgageCents,
      message: `Property "${plan.propertyId}" has no mortgage link but a non-zero financed balance.`
    };
  }
  return { ok: true, mortgageCents };
};

// ---------------------------------------------------------------------------
// Definition-id parsing
// ---------------------------------------------------------------------------

export type HousingEventKind =
  | 'funding'
  | 'completion'
  | 'appreciation'
  | 'sale'
  | 'mortgageAccrual'
  | 'mortgage'
  | 'taxesInsurance'
  | 'hoaMaintenance'
  | 'pmi'
  | 'rent'
  | 'rentalIncome';

/** A parsed housing occurrence identity. */
export interface ParsedHousingDefinition {
  readonly propertyId: string;
  readonly kind: HousingEventKind;
  /** Funding-event id (unique suffix), when `kind === 'funding'`. */
  readonly fundingEventId?: string;
  /**
   * Persisted funding source account id carried in the definition id, or `null`
   * for an unconfigured source (resolved through the global defaults). The
   * compiled context exposes only `fundingEventAccountIds`, not the dated
   * events, so the source is carried in the stable id rather than re-read.
   */
  readonly fundingAccountId?: string | null;
}

/** Group definitions, ordered so no suffix is a prefix of another. */
const HOUSING_KIND_SUFFIXES: readonly (readonly [string, HousingEventKind])[] = [
  [':appreciate', 'appreciation'],
  [':complete', 'completion'],
  [':sale', 'sale'],
  [':accrual', 'mortgageAccrual'],
  [':mortgage', 'mortgage'],
  [':taxesInsurance', 'taxesInsurance'],
  [':hoaMaintenance', 'hoaMaintenance'],
  [':pmi', 'pmi'],
  [':rentalIncome', 'rentalIncome'],
  [':rent', 'rent']
];

/**
 * Parses a `housing:<propertyId>:<kind>[...]` definition id, or `null`.
 *
 * Funding ids are `housing:<propertyId>:funding:<accountId>:<eventId>` (an empty
 * `accountId` segment means "no configured source"). Account/event ids are not
 * expected to contain `:`.
 */
export const parseHousingDefinitionId = (definitionId: string): ParsedHousingDefinition | null => {
  if (typeof definitionId !== 'string' || !definitionId.startsWith(HOUSING_DEFINITION_NAMESPACE)) {
    return null;
  }
  const rest = definitionId.slice(HOUSING_DEFINITION_NAMESPACE.length);
  for (const [suffix, kind] of HOUSING_KIND_SUFFIXES) {
    if (rest.endsWith(suffix)) {
      return { propertyId: rest.slice(0, -suffix.length), kind };
    }
  }
  const markerIndex = rest.indexOf(':funding:');
  if (markerIndex >= 0) {
    const after = rest.slice(markerIndex + ':funding:'.length);
    const separator = after.indexOf(':');
    const accountSegment = separator >= 0 ? after.slice(0, separator) : after;
    const eventId = separator >= 0 ? after.slice(separator + 1) : '';
    return {
      propertyId: rest.slice(0, markerIndex),
      kind: 'funding',
      fundingAccountId: accountSegment.length > 0 ? accountSegment : null,
      fundingEventId: eventId
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Event definitions (P3H.1/P3H.2/P3H.4)
// ---------------------------------------------------------------------------

const fundingDefinitionId = (propertyId: string, accountId: string | null, fundingEventId: string): string =>
  `${HOUSING_DEFINITION_NAMESPACE}${propertyId}:funding:${accountId ?? ''}:${fundingEventId}`;

const completionDefinitionId = (propertyId: string): string =>
  `${HOUSING_DEFINITION_NAMESPACE}${propertyId}:complete`;

const appreciationDefinitionId = (propertyId: string): string =>
  `${HOUSING_DEFINITION_NAMESPACE}${propertyId}:appreciate`;

const saleDefinitionId = (propertyId: string): string =>
  `${HOUSING_DEFINITION_NAMESPACE}${propertyId}:sale`;

/** Grouped-payment definition id: `housing:<propertyId>:<kind>`. */
const groupDefinitionId = (propertyId: string, kind: string): string =>
  `${HOUSING_DEFINITION_NAMESPACE}${propertyId}:${kind}`;

/**
 * Builds every recurring housing {@link EventDefinition} for one context.
 *
 * - one dated `accrual` funding event per pending `PropertyFundingEvent`;
 * - a single `accrual` completion event for a zero-down (required `0`) pending
 *   property that has a resolvable completion date (a required > 0 acquisition
 *   completes atomically inside its funding event, so it needs no separate
 *   event);
 * - one `accrual` sale event per non-sold property with a valid sale date;
 * - one monthly `close` appreciation event per non-sold property;
 * - for a **property-free standalone rental** (P5.1/F17) only the monthly
 *   `mandatory` rent/ancillary groups and the optional `income` rental-income
 *   deposit are scheduled — never funding, completion, sale or appreciation.
 *
 * Pure: no state, no wall clock, no mutation.
 */
export const buildHousingEventDefinitions = (context: HousingContext): EventDefinition[] => {
  const plans = resolveHousingPlans(context);
  const definitions: EventDefinition[] = [];

  const startDate = context.metadata?.startDate;
  const startYearMonth =
    typeof startDate === 'string' && isValidDateOnly(startDate) ? startDate.slice(0, 7) : null;

  for (const plan of plans) {
    if (plan.status !== 'sold') {
      // P5.1/F17: a property-free standalone rental owns no acquisition,
      // mortgage, appreciation or sale event — only the grouped/income block
      // below. An owned property-backed rental keeps its full lifecycle.
      if (!plan.propertyFree) {
        for (const fundingEvent of plan.fundingEvents) {
          definitions.push({
            definitionId: fundingDefinitionId(plan.propertyId, fundingEvent.accountId, fundingEvent.id),
            phase: 'accrual',
            purpose: HOUSING_PURPOSES.funding,
            priority: HOUSING_PRIORITY.funding,
            recurrence: { frequency: 'oneTime', startDate: fundingEvent.date },
            handlerId: HOUSING_HANDLER_IDS.funding,
            resolveTarget: () => fundingEvent.amountCents
          });
        }

        if (plan.status === 'pending' && plan.requiredDownPaymentCents === 0 && plan.completionDate !== null) {
          definitions.push({
            definitionId: completionDefinitionId(plan.propertyId),
            phase: 'accrual',
            purpose: HOUSING_PURPOSES.completion,
            priority: HOUSING_PRIORITY.completion,
            recurrence: { frequency: 'oneTime', startDate: plan.completionDate },
            handlerId: HOUSING_HANDLER_IDS.completion,
            resolveTarget: () => HOUSING_EXECUTION_SENTINEL_CENTS
          });
        }

        if (plan.saleDate !== null) {
          definitions.push({
            definitionId: saleDefinitionId(plan.propertyId),
            phase: 'accrual',
            purpose: HOUSING_PURPOSES.sale,
            priority: HOUSING_PRIORITY.sale,
            recurrence: { frequency: 'oneTime', startDate: plan.saleDate },
            handlerId: HOUSING_HANDLER_IDS.sale,
            resolveTarget: () => HOUSING_EXECUTION_SENTINEL_CENTS
          });
        }

        if (startYearMonth !== null) {
          definitions.push({
            definitionId: appreciationDefinitionId(plan.propertyId),
            phase: 'close',
            purpose: HOUSING_PURPOSES.appreciation,
            recurrence: { frequency: 'monthly', startDate: `${startYearMonth}-01`, dayOfMonth: 1 },
            handlerId: HOUSING_HANDLER_IDS.appreciation,
            resolveTarget: () => HOUSING_EXECUTION_SENTINEL_CENTS
          });
        }
      }

      // --- P3H.3 grouped payments / rental income ------------------------
      if (plan.startDate !== null) {
        const monthlyRecurrence = (endDate: string | null): EventDefinition['recurrence'] => ({
          frequency: 'monthly',
          startDate: plan.startDate as string,
          dayOfMonth: 1,
          ...(endDate === null ? {} : { endDate })
        });
        const saleEnd = plan.saleDate === null ? null : endOfMonthDate(plan.saleDate.slice(0, 7));
        // Ancillary costs persist after mortgage payoff, but stop at sale.
        const ancillaryEnd = saleEnd ?? plan.endDate;

        if (plan.mortgage !== null) {
          const termEnd = plan.mortgage.endYearMonth === null ? null : endOfMonthDate(plan.mortgage.endYearMonth);
          definitions.push({
            definitionId: groupDefinitionId(plan.propertyId, 'accrual'),
            phase: 'accrual',
            purpose: HOUSING_PURPOSES.mortgageAccrual,
            priority: HOUSING_PRIORITY.accrual,
            recurrence: monthlyRecurrence(termEnd),
            handlerId: HOUSING_HANDLER_IDS.accrual,
            resolveTarget: () => 0
          });
          definitions.push({
            definitionId: groupDefinitionId(plan.propertyId, 'mortgage'),
            phase: 'mandatory',
            purpose: HOUSING_PURPOSES.mortgagePayment,
            priority: HOUSING_PRIORITY.mortgage,
            recurrence: monthlyRecurrence(termEnd),
            handlerId: HOUSING_HANDLER_IDS.mortgage,
            resolveTarget: () => 0
          });
        }

        const ancillary: readonly (readonly [HousingPaymentGroup, string, string])[] = [
          ['taxesInsurance', 'taxesInsurance', HOUSING_PURPOSES.taxesInsurance],
          ['hoaMaintenance', 'hoaMaintenance', HOUSING_PURPOSES.hoaMaintenance],
          ['pmi', 'pmi', HOUSING_PURPOSES.pmi]
        ];
        for (const [group, kind, purpose] of ancillary) {
          const config = plan.groups[group];
          if (config.monthlyCents <= 0) {
            continue;
          }
          definitions.push({
            definitionId: groupDefinitionId(plan.propertyId, kind),
            phase: 'mandatory',
            purpose,
            priority: HOUSING_PRIORITY[group],
            recurrence: monthlyRecurrence(ancillaryEnd),
            handlerId: HOUSING_HANDLER_IDS[group],
            resolveTarget: () => config.monthlyCents
          });
        }

        if (plan.groups.rent.monthlyCents > 0) {
          definitions.push({
            definitionId: groupDefinitionId(plan.propertyId, 'rent'),
            phase: 'mandatory',
            purpose: HOUSING_PURPOSES.rent,
            priority: HOUSING_PRIORITY.rent,
            recurrence: monthlyRecurrence(plan.endDate),
            handlerId: HOUSING_HANDLER_IDS.rent,
            resolveTarget: () => plan.groups.rent.monthlyCents
          });
        }

        if (plan.rentalIncome !== null && plan.rentalIncome.accountId !== null) {
          definitions.push({
            definitionId: groupDefinitionId(plan.propertyId, 'rentalIncome'),
            phase: 'income',
            purpose: HOUSING_PURPOSES.rentalIncome,
            recurrence: monthlyRecurrence(plan.endDate),
            handlerId: HOUSING_HANDLER_IDS.rentalIncome,
            resolveTarget: () => (plan.rentalIncome as { monthlyCents: number }).monthlyCents
          });
        }
      }
    }
  }

  return definitions;
};

// ---------------------------------------------------------------------------
// Context builder (reads persisted funding events)
// ---------------------------------------------------------------------------

const toHousingPropertyConfig = (property: PropertyDefinition): HousingPropertyConfig => ({
  propertyId: property.id,
  label: property.label,
  status: property.status,
  value: property.value,
  requiredDownPayment: property.requiredDownPayment,
  debtLink: property.debtLink ?? null,
  acquisitionYearMonth: property.acquisitionYearMonth ?? null,
  appreciationRate: property.appreciationRate ?? 0,
  sellingCostsRate: property.sellingCostsRate ?? 0,
  sourceConfigId: property.sourceConfigId ?? null,
  fundingEvents: property.fundingEvents ?? []
});

/**
 * Optional timeline scope for {@link buildHousingContext} (RV04/F23). A property's
 * observed opening identity (`value`/`status`/`debtLink`/`requiredDownPayment`)
 * is global and shared across timelines, but its dated **future** funding events
 * are timeline-local:
 *
 * - `timelineId: null` (base) reads each property's global
 *   `PropertyDefinition.fundingEvents`;
 * - a named timeline reads **only** the linked selected
 *   `HousingEntry.fundingEvents` (matched by `sourceConfigId`, else `id`), and an
 *   absent list is `[]` — the global property list is never implicitly inherited.
 *
 * An omitted scope behaves as base (`timelineId: null`).
 */
export interface HousingContextScope {
  readonly timelineId: string | null;
}

/**
 * Builds the structural housing context from persisted configuration. This is
 * the bridge that supplies the dated `fundingEvents` the compiled context does
 * not expose; the integration owner schedules events from this and executes them
 * with the compiled context. Pass the compiled `liabilities` (when available) so
 * the scheduled mortgage window uses the actual contractual end month rather
 * than the legacy `loanTermYears` fallback. The optional `scope` selects the
 * timeline whose future funding events are scheduled (see
 * {@link HousingContextScope}); `scenario.properties` always supplies the global
 * observed identity. Pure: no mutation.
 */
export const buildHousingContext = (
  scenario: Pick<Scenario, 'properties' | 'netWorth'>,
  housing: readonly HousingEntry[],
  liabilities?: readonly CompiledLiability[],
  scope?: HousingContextScope
): HousingContext => {
  const startDate = scenario.netWorth?.openingSnapshot?.date || scenario.netWorth?.asOfDate || '';
  const timelineScoped = scope !== undefined && scope.timelineId !== null;

  const housingById = new Map<string, HousingEntry>();
  for (const entry of housing) {
    housingById.set(entry.id, entry);
  }

  const properties = (scenario.properties ?? []).map((property) => {
    const config = toHousingPropertyConfig(property);
    if (!timelineScoped) {
      return config;
    }
    // Named timeline: the observed identity above stays global, but the dated
    // future funding events come exclusively from the linked selected housing
    // entry (`sourceConfigId` first, then property id) — an absent list is `[]`
    // and the global `PropertyDefinition.fundingEvents` is never inherited.
    const linked = linkedHousing(config, housingById);
    return { ...config, fundingEvents: linked?.fundingEvents ?? [] };
  });

  return {
    properties,
    domains: { housing },
    liabilities,
    metadata: { startDate }
  };
};

// ---------------------------------------------------------------------------
// Handlers (P3H.1/P3H.2/P3H.4)
// ---------------------------------------------------------------------------

const monthFractionFor = (yearMonth: string, metadata: HousingContextMetadata | undefined): number => {
  const monthStart = `${yearMonth}-01`;
  const monthEnd = endOfMonthDate(yearMonth);
  const start =
    metadata && isValidDateOnly(metadata.startDate) && compareDateOnly(monthStart, metadata.startDate) < 0
      ? metadata.startDate
      : monthStart;
  const end =
    metadata && typeof metadata.endDate === 'string' && isValidDateOnly(metadata.endDate)
      && compareDateOnly(monthEnd, metadata.endDate) > 0
      ? metadata.endDate
      : monthEnd;
  const fraction = monthFractionForDates(yearMonth, start, end);
  return fraction === null ? 1 : fraction;
};

const planFor = (deps: ProjectionHandlerDependencies, propertyId: string): HousingPropertyPlan | undefined =>
  resolveHousingPlans(deps.context).find((plan) => plan.propertyId === propertyId);

/**
 * P5.1/F17 — an occurrence date is inside a plan's inclusive `[startDate,
 * endDate]` window (`null` end = open). Used to route a property-free rental's
 * account-funded groups and income purely from the plan (no runtime property).
 */
const withinPlanRange = (plan: HousingPropertyPlan, date: string): boolean => {
  if (plan.startDate !== null && compareDateOnly(date, plan.startDate) < 0) {
    return false;
  }
  if (plan.endDate !== null && compareDateOnly(date, plan.endDate) > 0) {
    return false;
  }
  return true;
};

/** Resolved order for one obligation: primary + ordered fallbacks + inheritance. */
interface HousingSourceOrder {
  readonly primaryAccountId: string | null;
  readonly fallbackAccountIds: readonly string[];
  readonly inheritsGlobalDefaults: boolean;
}

const sourceOrderFromGroup = (group: HousingGroupPlan): HousingSourceOrder => ({
  primaryAccountId: group.source,
  fallbackAccountIds: group.fallbackAccountIds,
  inheritsGlobalDefaults: group.inheritsGlobalDefaults
});

const sourceOrderRequest = (
  executionDefinitionId: string,
  occurrenceId: string,
  date: string,
  requestedCents: number,
  order: HousingSourceOrder,
  purpose: string
): FundingRequest => ({
  id: executionDefinitionId,
  occurrenceId,
  date,
  requestedCents,
  primaryAccountId: order.primaryAccountId,
  fallbackAccountIds: [...order.fallbackAccountIds],
  purpose
});

// ---------------------------------------------------------------------------
// P3H.3 grouped-payment funding helpers
// ---------------------------------------------------------------------------

const globalDefaultsFor = (deps: ProjectionHandlerDependencies) => ({
  primaryAccountId: deps.funding.global.primaryAccountId,
  fallbackAccountIds: [...deps.funding.global.fallbackAccountIds]
});

/**
 * Quotes one group's ordered account funding (no income reservoir).
 *
 * An explicit per-group policy (`inheritsGlobalDefaults: false`) passes no global
 * default, so an empty resolved order — an explicit `null` primary with no
 * fallbacks — stays visibly unresolved instead of silently drawing the global
 * order. A legacy/absent group may still inherit the global default when its own
 * order is empty.
 */
const quoteGroupFunding = (
  deps: ProjectionHandlerDependencies,
  execution: EventExecutionContext,
  requestedCents: number,
  order: HousingSourceOrder,
  purpose: string
) => {
  const request = sourceOrderRequest(
    execution.event.definitionId,
    execution.event.occurrenceId,
    execution.date,
    requestedCents,
    order,
    purpose
  );
  return quoteFunding(
    deps.state,
    request,
    deps.accounts,
    deps.dateOfBirth,
    order.inheritsGlobalDefaults ? { globalDefaults: globalDefaultsFor(deps) } : {}
  );
};

/** Funds an external expense group (taxes/insurance, HOA/maintenance, PMI, rent). */
const executeGroupExpense = (
  deps: ProjectionHandlerDependencies,
  execution: EventExecutionContext,
  requestedCents: Cents,
  order: HousingSourceOrder,
  purpose: string
): ProjectionExecutionResult => {
  if (!Number.isSafeInteger(requestedCents) || requestedCents <= 0) {
    return { committed: false, plan: null };
  }
  const quoted = quoteGroupFunding(deps, execution, requestedCents, order, purpose);
  if (!quoted.ok) {
    return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
  }
  if (quoted.plan.executedCents <= 0) {
    // D16: a positive request that funds nothing is still real evidence of a
    // shortfall — return the actual quote so the facade records an outcome.
    return {
      committed: false,
      plan: quoted.plan,
      quote: quoted,
      diagnostics: [`Housing ${purpose} of ${requestedCents} cents on ${execution.date} was not funded; shortfall retained.`]
    };
  }
  const commit = commitHousingFunding(deps.state, quoted.plan, housingPosting(execution, purpose));
  const diagnostics: string[] = commit.errors.map((error) => error.message);
  if (commit.committed && quoted.plan.shortfallCents > 0) {
    diagnostics.push(`Housing ${purpose} short by ${quoted.plan.shortfallCents} cents on ${execution.date}.`);
  }
  return { committed: commit.committed, plan: commit.plan, quote: quoted, diagnostics };
};

/**
 * Funds a mortgage installment and reduces the linked liability **interest
 * first, then principal**, by the amount actually funded (funded-only
 * reduction). Unpaid interest/principal is retained; no fabricated fees.
 */
const executeMortgagePayment = (
  deps: ProjectionHandlerDependencies,
  execution: EventExecutionContext,
  liabilityId: string,
  requestedCents: Cents,
  order: HousingSourceOrder
): ProjectionExecutionResult => {
  const liability = deps.state.getLiability(liabilityId);
  if (!liability) {
    return {
      committed: false,
      plan: null,
      diagnostics: [`Mortgage liability "${liabilityId}" is missing from state.`]
    };
  }
  const outstanding = liability.principalCents + liability.accruedInterestCents + liability.feesCents;
  const requested = Math.min(requestedCents, outstanding);
  if (requested <= 0) {
    return { committed: false, plan: null };
  }
  const quoted = quoteGroupFunding(
    deps,
    execution,
    requested,
    order,
    HOUSING_PURPOSES.mortgagePayment
  );
  if (!quoted.ok) {
    return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
  }

  let interestPaid = 0;
  let principalPaid = 0;
  const commit = commitHousingFunding(
    deps.state,
    quoted.plan,
    housingPosting(execution, HOUSING_PURPOSES.mortgagePayment),
    ({ executedNetCents }) => {
      const applied = Math.min(executedNetCents, outstanding);
      interestPaid = Math.min(applied, liability.accruedInterestCents);
      principalPaid = Math.min(applied - interestPaid, liability.principalCents);
      return {
        liabilityChanges: [
          {
            liabilityId,
            accruedInterestDeltaCents: -interestPaid,
            principalDeltaCents: -principalPaid
          }
        ],
        netWorthAdjustmentCents: interestPaid + principalPaid
      };
    }
  );

  const diagnostics: string[] = commit.errors.map((error) => error.message);
  if (!commit.committed) {
    // D16: retain the actual quote on a zero/invalid commit so an unfunded or
    // partial mortgage payment still yields a funding outcome.
    return { committed: false, plan: commit.plan, quote: quoted, diagnostics };
  }
  const executed = commit.plan?.executedCents ?? quoted.plan.executedCents;
  if (executed < requested) {
    diagnostics.push(
      `Mortgage paid ${executed} of ${requested} cents on ${execution.date} (shortfall ${requested - executed}); unpaid interest/principal retained.`
    );
  }
  return { committed: true, plan: commit.plan, quote: quoted, diagnostics };
};

/**
 * Creates the housing handlers for a run. Each handler owns one event kind and
 * posts only through `state.commitChanges` / `commitFunding`.
 */
export const createHousingHandlers = (
  deps: ProjectionHandlerDependencies
): readonly ProjectionEventHandler[] => {
  const fundingHandler: ProjectionEventHandler = {
    handlerId: HOUSING_HANDLER_IDS.funding,
    // No `resolveTarget`: the scheduled definition's resolver carries the dated
    // funding amount (the facade falls back to `scheduler.resolveTarget`).
    execute({ execution, targetCents }): ProjectionExecutionResult {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'funding') {
        return { committed: false };
      }
      const runtime = deps.state.getProperty(parsed.propertyId);
      if (!runtime) {
        return { committed: false, diagnostics: [`Funding event targets unknown property "${parsed.propertyId}".`] };
      }
      if (runtime.status !== 'pending') {
        // Already owned/sold: a later scheduled funding event never double-counts.
        return { committed: false };
      }
      const plan = planFor(deps, parsed.propertyId);
      if (!plan) {
        return { committed: false, diagnostics: [`No housing plan for property "${parsed.propertyId}".`] };
      }
      const terms = validateAcquisitionTerms(plan);
      if (!terms.ok) {
        return { committed: false, diagnostics: [terms.message ?? 'Invalid acquisition terms.'] };
      }
      if (!Number.isSafeInteger(targetCents) || targetCents <= 0) {
        return { committed: false };
      }

      const fundingEvent = plan.fundingEvents.find((event) => event.id === parsed.fundingEventId);
      const perEventAccountId = parsed.fundingAccountId ?? fundingEvent?.accountId ?? null;

      // G20/G22 down-payment group (S + K). An explicit
      // `fundingPolicies.downPayment` order is used **exactly** — its primary +
      // ordered fallbacks, ignoring the legacy per-event `accountId`, with no
      // global-default fallback (a `null` primary + empty list stays unresolved).
      // Otherwise the legacy per-event `accountId` remains the primary and falls
      // back to the housing `downPaymentSource`/`paymentSource`, then the
      // configured global default order.
      const downPayment = plan.downPayment;
      let downPaymentOrder: HousingSourceOrder;
      if (downPayment?.explicit) {
        downPaymentOrder = {
          primaryAccountId: downPayment.source,
          fallbackAccountIds: downPayment.fallbackAccountIds,
          inheritsGlobalDefaults: false
        };
      } else {
        downPaymentOrder = {
          primaryAccountId: perEventAccountId ?? downPayment?.source ?? null,
          fallbackAccountIds: [],
          inheritsGlobalDefaults: downPayment?.inheritsGlobalDefaults ?? true
        };
      }

      // CA09: the scheduled event amount is a ceiling, never a mandate. Cap the
      // requested net at the down payment still outstanding (`required − held`).
      // Over-funding would debit cash the atomic completion never converts to
      // equity (the deposit delta is `-heldBefore`), silently losing the excess.
      // A requirement already met — or a zero-down property — debits nothing and
      // completes nothing; only a valid, fully-funded remaining amount completes.
      const outstandingNetCents = Math.max(0, plan.requiredDownPaymentCents - runtime.acquisitionDepositCents);
      if (outstandingNetCents === 0) {
        return {
          committed: false,
          diagnostics: [
            `Funding event "${execution.event.definitionId}" skipped: the down payment requirement is already met.`
          ]
        };
      }
      const requestedNetCents = Math.min(targetCents, outstandingNetCents);

      const quoted = quoteFunding(
        deps.state,
        sourceOrderRequest(
          execution.event.definitionId,
          execution.event.occurrenceId,
          execution.date,
          requestedNetCents,
          downPaymentOrder,
          HOUSING_PURPOSES.funding
        ),
        deps.accounts,
        deps.dateOfBirth,
        downPaymentOrder.inheritsGlobalDefaults ? { globalDefaults: globalDefaultsFor(deps) } : {}
      );
      if (!quoted.ok) {
        return { committed: false, quote: quoted, diagnostics: [quoted.diagnostic.message] };
      }
      if (quoted.plan.executedCents <= 0) {
        // Zero/partial funding debits nothing and keeps the held net. D16: return
        // the actual quote so a fully-unfunded pending down payment still yields
        // a shortfall outcome (with eligible sources/skip reasons) and no plan.
        return {
          committed: false,
          quote: quoted,
          diagnostics: [`Funding event "${execution.event.definitionId}" executed no net funds.`]
        };
      }

      const result = commitHousingFunding(
        deps.state,
        quoted.plan,
        housingPosting(execution),
        ({ executedNetCents }) => {
          const current = deps.state.getProperty(parsed.propertyId);
          const heldBefore = current?.acquisitionDepositCents ?? 0;
          const completes =
            current?.status === 'pending' && heldBefore + executedNetCents >= plan.requiredDownPaymentCents;

          if (completes) {
            // Atomic exchange: release the previously held deposit only (the new
            // net becomes equity), create the property value/mortgage. The state
            // deposit delta is `-heldBefore`, never `-(heldBefore + executedNet)`.
            const mortgageCents = terms.mortgageCents;
            const propertyChanges: PropertyChange[] = [
              {
                propertyId: parsed.propertyId,
                acquisitionDepositDeltaCents: -heldBefore,
                valueDeltaCents: plan.priceCents,
                status: 'owned',
                mortgageId: plan.mortgageId,
                completedDate: execution.date
              }
            ];
            const liabilityChanges: LiabilityChange[] =
              plan.mortgageId === null
                ? []
                : [
                    {
                      liabilityId: plan.mortgageId,
                      create: true,
                      kind: 'mortgage',
                      principalDeltaCents: mortgageCents
                    }
                  ];
            return {
              propertyChanges,
              liabilityChanges,
              netWorthAdjustmentCents: -heldBefore + plan.priceCents - mortgageCents
            };
          }

          const propertyChanges: PropertyChange[] = [
            {
              propertyId: parsed.propertyId,
              acquisitionDepositDeltaCents: executedNetCents
            }
          ];
          return { propertyChanges, netWorthAdjustmentCents: executedNetCents };
        }
      );

      if (!result.committed) {
        return {
          committed: false,
          plan: result.plan,
          quote: quoted,
          diagnostics: result.errors.map((error) => error.message)
        };
      }
      return { committed: true, plan: result.plan, quote: quoted };
    }
  };

  const completionHandler: ProjectionEventHandler = {
    handlerId: HOUSING_HANDLER_IDS.completion,
    resolveTarget(execution, handlerDeps): number {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'completion') {
        return 0;
      }
      const runtime = handlerDeps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'pending') {
        return 0;
      }
      return HOUSING_EXECUTION_SENTINEL_CENTS;
    },
    execute({ execution }): ProjectionExecutionResult {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'completion') {
        return { committed: false };
      }
      const runtime = deps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'pending') {
        return { committed: false };
      }
      const plan = planFor(deps, parsed.propertyId);
      if (!plan) {
        return { committed: false, diagnostics: [`No housing plan for property "${parsed.propertyId}".`] };
      }
      // The dedicated completion event is only for zero-down acquisitions; a
      // required > 0 acquisition completes atomically inside its funding event.
      if (plan.requiredDownPaymentCents !== 0) {
        return { committed: false };
      }
      if (runtime.acquisitionDepositCents !== 0) {
        return {
          committed: false,
          diagnostics: [`Property "${parsed.propertyId}" holds a deposit; completion must run through its funding event.`]
        };
      }
      const terms = validateAcquisitionTerms(plan);
      if (!terms.ok || plan.mortgageId === null) {
        return {
          committed: false,
          diagnostics: [terms.message ?? `Property "${parsed.propertyId}" has no valid zero-down financing.`]
        };
      }

      const propertyChanges: PropertyChange[] = [
        {
          propertyId: parsed.propertyId,
          valueDeltaCents: plan.priceCents,
          status: 'owned',
          mortgageId: plan.mortgageId,
          completedDate: execution.date
        }
      ];
      const liabilityChanges: LiabilityChange[] = [
        {
          liabilityId: plan.mortgageId,
          create: true,
          kind: 'mortgage',
          principalDeltaCents: terms.mortgageCents
        }
      ];

      const commit = deps.state.commitChanges({
        revision: deps.state.getRevision(),
        posting: housingPosting(execution, HOUSING_PURPOSES.completion),
        propertyChanges,
        liabilityChanges,
        expectedNetWorthDeltaCents: plan.priceCents - terms.mortgageCents
      });
      return {
        committed: commit.committed,
        plan: null,
        diagnostics: commit.errors.map((error) => error.message)
      };
    }
  };

  const appreciationHandler: ProjectionEventHandler = {
    handlerId: HOUSING_HANDLER_IDS.appreciation,
    resolveTarget(execution, handlerDeps): number {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'appreciation') {
        return 0;
      }
      const runtime = handlerDeps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'owned' || runtime.valueCents <= 0) {
        return 0;
      }
      return HOUSING_EXECUTION_SENTINEL_CENTS;
    },
    execute({ execution, deps: invocationDeps }): ProjectionExecutionResult {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'appreciation') {
        return { committed: false };
      }
      const runtime = invocationDeps.state.getProperty(parsed.propertyId);
      // A pending acquisition (deposit only) and a sold property never appreciate.
      if (!runtime || runtime.status !== 'owned') {
        return { committed: false };
      }
      const plan = planFor(invocationDeps, parsed.propertyId);
      if (!plan) {
        return { committed: false };
      }
      const fraction = monthFractionFor(execution.yearMonth, invocationDeps.context.metadata);
      const quoted = quotePropertyAppreciation(
        runtime.valueCents,
        plan.appreciationRate / 100,
        fraction,
        'owned'
      );
      if (!quoted.ok) {
        return { committed: false, diagnostics: [quoted.diagnostic.message] };
      }
      if (quoted.appreciation.appreciationCents === 0) {
        return { committed: false };
      }
      const commit = invocationDeps.state.commitChanges({
        revision: invocationDeps.state.getRevision(),
        posting: housingPosting(execution, HOUSING_PURPOSES.appreciation),
        propertyChanges: [
          { propertyId: parsed.propertyId, valueDeltaCents: quoted.appreciation.appreciationCents }
        ],
        expectedNetWorthDeltaCents: quoted.appreciation.appreciationCents
      });
      return {
        committed: commit.committed,
        plan: null,
        diagnostics: commit.errors.map((error) => error.message)
      };
    }
  };

  const saleHandler: ProjectionEventHandler = {
    handlerId: HOUSING_HANDLER_IDS.sale,
    resolveTarget(execution, handlerDeps): number {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'sale') {
        return 0;
      }
      const runtime = handlerDeps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'owned') {
        return 0;
      }
      return HOUSING_EXECUTION_SENTINEL_CENTS;
    },
    execute({ execution }): ProjectionExecutionResult {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'sale') {
        return { committed: false };
      }
      const runtime = deps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'owned') {
        return { committed: false };
      }
      const plan = planFor(deps, parsed.propertyId);
      if (!plan) {
        return { committed: false, diagnostics: [`No housing plan for property "${parsed.propertyId}".`] };
      }

      // Current value and actual linked debt only — no reconstructed amortization.
      const valueCents = runtime.valueCents;
      const mortgageId = runtime.mortgageId;
      const liability = mortgageId === null ? undefined : deps.state.getLiability(mortgageId);
      const debtCents = liability
        ? liability.principalCents + liability.accruedInterestCents + liability.feesCents
        : 0;
      const sellingCostsCents = roundHalfAwayFromZero(valueCents * (plan.sellingCostsRate / 100));
      const netProceedsCents = valueCents - sellingCostsCents - debtCents;

      const accountChanges: AccountChange[] = [];
      const liabilityChanges: LiabilityChange[] = [];
      const propertyChanges: PropertyChange[] = [
        { propertyId: parsed.propertyId, valueDeltaCents: -valueCents, status: 'sold', mortgageId: null }
      ];

      if (liability && debtCents > 0) {
        liabilityChanges.push({
          liabilityId: liability.liabilityId,
          principalDeltaCents: -liability.principalCents,
          accruedInterestDeltaCents: -liability.accruedInterestCents,
          feesDeltaCents: -liability.feesCents
        });
      }

      if (netProceedsCents > 0) {
        const destination = plan.saleProceedsAccountId;
        if (destination === null || deps.state.getAccountBalanceCents(destination) === undefined) {
          return {
            committed: false,
            diagnostics: [
              `Property "${parsed.propertyId}" sale has surplus proceeds but no valid configured proceeds account; no disposition was posted.`
            ]
          };
        }
        accountChanges.push({ accountId: destination, deltaCents: netProceedsCents });
      } else if (netProceedsCents < 0) {
        // Underwater: retain the shortfall once as a runtime `saleDeficiency`
        // liability. The persisted configuration is never mutated.
        const deficiencyId = `${HOUSING_DEFINITION_NAMESPACE}${parsed.propertyId}:saleDeficiency`;
        if (deps.state.getLiability(deficiencyId)) {
          return {
            committed: false,
            diagnostics: [`Property "${parsed.propertyId}" sale deficiency was already retained.`]
          };
        }
        liabilityChanges.push({
          liabilityId: deficiencyId,
          create: true,
          kind: 'saleDeficiency',
          principalDeltaCents: -netProceedsCents
        });
      }

      // Net-worth delta is exactly the real selling cost: proceeds replace the
      // disposed value, and retained debt is either settled or swapped for an
      // equal deficiency.
      const commit = deps.state.commitChanges({
        revision: deps.state.getRevision(),
        posting: housingPosting(execution, HOUSING_PURPOSES.sale),
        accountChanges,
        liabilityChanges,
        propertyChanges,
        expectedNetWorthDeltaCents: -sellingCostsCents
      });
      return {
        committed: commit.committed,
        plan: null,
        diagnostics: commit.errors.map((error) => error.message)
      };
    }
  };

  // --- P3H.3: mortgage accrual + grouped payments + rental income --------
  const accrualHandler: ProjectionEventHandler = {
    handlerId: HOUSING_HANDLER_IDS.accrual,
    resolveTarget(execution, handlerDeps): number {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'mortgageAccrual') {
        return 0;
      }
      const runtime = handlerDeps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'owned' || runtime.mortgageId === null) {
        return 0;
      }
      const plan = planFor(handlerDeps, parsed.propertyId);
      if (!plan || plan.mortgage === null || plan.mortgage.aprPercent <= 0) {
        return 0;
      }
      const liability = handlerDeps.state.getLiability(runtime.mortgageId);
      if (!liability || liability.principalCents <= 0) {
        return 0;
      }
      const quoted = quoteDebtMonthlyAccrual(
        liability.principalCents,
        plan.mortgage.aprPercent / 100,
        monthFractionFor(execution.yearMonth, handlerDeps.context.metadata)
      );
      return quoted.ok ? quoted.accrual.accrualCents : 0;
    },
    execute({ execution, targetCents }): ProjectionExecutionResult {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'mortgageAccrual') {
        return { committed: false };
      }
      const runtime = deps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'owned' || runtime.mortgageId === null) {
        return { committed: false };
      }
      if (!Number.isSafeInteger(targetCents) || targetCents <= 0) {
        return { committed: false };
      }
      const commit = deps.state.commitChanges({
        revision: deps.state.getRevision(),
        posting: housingPosting(execution, HOUSING_PURPOSES.mortgageAccrual),
        liabilityChanges: [{ liabilityId: runtime.mortgageId, accruedInterestDeltaCents: targetCents }],
        expectedNetWorthDeltaCents: -targetCents
      });
      return {
        committed: commit.committed,
        plan: null,
        diagnostics: commit.errors.map((error) => error.message)
      };
    }
  };

  const mortgageHandler: ProjectionEventHandler = {
    handlerId: HOUSING_HANDLER_IDS.mortgage,
    resolveTarget(execution, handlerDeps): number {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'mortgage') {
        return 0;
      }
      const runtime = handlerDeps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'owned' || runtime.mortgageId === null) {
        return 0;
      }
      const plan = planFor(handlerDeps, parsed.propertyId);
      if (!plan || plan.mortgage === null) {
        return 0;
      }
      const liability = handlerDeps.state.getLiability(runtime.mortgageId);
      if (!liability || liability.principalCents <= 0) {
        return 0;
      }
      const quoted = quoteLoanInstallment({
        principalCents: liability.principalCents,
        accruedInterestCents: liability.accruedInterestCents,
        feesCents: liability.feesCents,
        annualRate: plan.mortgage.aprPercent / 100,
        remainingMonths: remainingTermMonths(plan.mortgage.endYearMonth, execution.yearMonth),
        minimumPaymentCents: plan.mortgage.minimumPaymentCents
      });
      if (!quoted.ok) {
        return 0;
      }
      // PI+extra, capped at the outstanding debt (funded-only reduction).
      return Math.min(quoted.quote.requiredCents + plan.mortgage.extraPaymentCents, quoted.quote.outstandingCents);
    },
    execute({ execution, targetCents }): ProjectionExecutionResult {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'mortgage') {
        return { committed: false };
      }
      const runtime = deps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'owned' || runtime.mortgageId === null) {
        return { committed: false };
      }
      const plan = planFor(deps, parsed.propertyId);
      if (!plan) {
        return { committed: false, diagnostics: [`No housing plan for property "${parsed.propertyId}".`] };
      }
      return executeMortgagePayment(
        deps,
        execution,
        runtime.mortgageId,
        targetCents,
        sourceOrderFromGroup(plan.groups.mortgage)
      );
    }
  };

  const groupExpenseHandler = (
    group: 'taxesInsurance' | 'hoaMaintenance' | 'pmi' | 'rent',
    kind: HousingEventKind,
    purpose: string
  ): ProjectionEventHandler => ({
    handlerId: HOUSING_HANDLER_IDS[group],
    resolveTarget(execution, handlerDeps): number {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== kind) {
        return 0;
      }
      const plan = planFor(handlerDeps, parsed.propertyId);
      if (!plan) {
        return 0;
      }
      // P5.1/F17: a property-free standalone rental routes purely by its plan
      // (rental housing type + inclusive start/end range); it has no runtime
      // property, so `state.getProperty` is never consulted for it.
      if (plan.propertyFree) {
        if (plan.housingType !== 'rental' || !withinPlanRange(plan, execution.date)) {
          return 0;
        }
        const config = plan.groups[group];
        return config.monthlyCents > 0 ? config.monthlyCents : 0;
      }
      const runtime = handlerDeps.state.getProperty(parsed.propertyId);
      // Pending acquisitions have no ownership costs; a sold property has none.
      if (!runtime || runtime.status !== 'owned') {
        return 0;
      }
      const config = plan.groups[group];
      if (config.monthlyCents <= 0) {
        return 0;
      }
      if (group === 'pmi') {
        const mortgageId = runtime.mortgageId ?? plan.mortgageId;
        const liability = mortgageId === null ? undefined : handlerDeps.state.getLiability(mortgageId);
        if (!liability || liability.principalCents <= 0 || runtime.valueCents <= 0) {
          return 0;
        }
        // Actual LTV > 80% ⇔ principal / value > 4/5 ⇔ 5·principal > 4·value.
        if (!(liability.principalCents * 5 > runtime.valueCents * 4)) {
          return 0;
        }
      }
      return config.monthlyCents;
    },
    execute({ execution, targetCents }): ProjectionExecutionResult {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== kind) {
        return { committed: false };
      }
      const plan = planFor(deps, parsed.propertyId);
      if (!plan) {
        return { committed: false };
      }
      if (plan.propertyFree) {
        if (plan.housingType !== 'rental' || !withinPlanRange(plan, execution.date)) {
          return { committed: false };
        }
        return executeGroupExpense(deps, execution, targetCents, sourceOrderFromGroup(plan.groups[group]), purpose);
      }
      const runtime = deps.state.getProperty(parsed.propertyId);
      if (!runtime || runtime.status !== 'owned') {
        return { committed: false };
      }
      return executeGroupExpense(deps, execution, targetCents, sourceOrderFromGroup(plan.groups[group]), purpose);
    }
  });

  const taxesInsuranceHandler = groupExpenseHandler(
    'taxesInsurance',
    'taxesInsurance',
    HOUSING_PURPOSES.taxesInsurance
  );
  const hoaMaintenanceHandler = groupExpenseHandler(
    'hoaMaintenance',
    'hoaMaintenance',
    HOUSING_PURPOSES.hoaMaintenance
  );
  const pmiHandler = groupExpenseHandler('pmi', 'pmi', HOUSING_PURPOSES.pmi);
  const rentHandler = groupExpenseHandler('rent', 'rent', HOUSING_PURPOSES.rent);

  const rentalIncomeHandler: ProjectionEventHandler = {
    handlerId: HOUSING_HANDLER_IDS.rentalIncome,
    resolveTarget(execution, handlerDeps): number {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'rentalIncome') {
        return 0;
      }
      const plan = planFor(handlerDeps, parsed.propertyId);
      if (!plan || plan.rentalIncome === null || plan.rentalIncome.monthlyCents <= 0) {
        return 0;
      }
      if (plan.propertyFree) {
        // P5.1/F17: route a property-free rental by plan/date, no runtime property.
        if (plan.housingType !== 'rental' || !withinPlanRange(plan, execution.date)) {
          return 0;
        }
      } else {
        const runtime = handlerDeps.state.getProperty(parsed.propertyId);
        if (!runtime || runtime.status !== 'owned') {
          return 0;
        }
      }
      const destination = plan.rentalIncome.accountId;
      if (destination === null || handlerDeps.state.getAccountBalanceCents(destination) === undefined) {
        return 0;
      }
      return plan.rentalIncome.monthlyCents;
    },
    execute({ execution, targetCents }): ProjectionExecutionResult {
      const parsed = parseHousingDefinitionId(execution.event.definitionId);
      if (!parsed || parsed.kind !== 'rentalIncome') {
        return { committed: false };
      }
      const plan = planFor(deps, parsed.propertyId);
      if (!plan || plan.rentalIncome === null) {
        return { committed: false };
      }
      if (plan.propertyFree) {
        if (plan.housingType !== 'rental' || !withinPlanRange(plan, execution.date)) {
          return { committed: false };
        }
      } else {
        const runtime = deps.state.getProperty(parsed.propertyId);
        if (!runtime || runtime.status !== 'owned') {
          return { committed: false };
        }
      }
      const destination = plan.rentalIncome.accountId;
      if (destination === null || deps.state.getAccountBalanceCents(destination) === undefined) {
        return { committed: false };
      }
      if (!Number.isSafeInteger(targetCents) || targetCents <= 0) {
        return { committed: false };
      }
      // Rental income is housing-owned external income (never salary; not modelled
      // by income.ts), deposited directly into the configured account.
      const commit = deps.state.commitChanges({
        revision: deps.state.getRevision(),
        posting: housingPosting(execution, HOUSING_PURPOSES.rentalIncome),
        accountChanges: [{ accountId: destination, deltaCents: targetCents }],
        expectedNetWorthDeltaCents: targetCents
      });
      return {
        committed: commit.committed,
        plan: null,
        diagnostics: commit.errors.map((error) => error.message)
      };
    }
  };

  return [
    fundingHandler,
    completionHandler,
    appreciationHandler,
    saleHandler,
    accrualHandler,
    mortgageHandler,
    taxesInsuranceHandler,
    hoaMaintenanceHandler,
    pmiHandler,
    rentHandler,
    rentalIncomeHandler
  ];
};
