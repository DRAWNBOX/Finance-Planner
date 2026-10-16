/**
 * P4.1 / P4.2 (R) — Read-only projection reporting.
 *
 * Phase-4 owner: **R**. Scope (`refactor/phase4_plan.md` D15/D17, P4.1/P4.2):
 * build **one** immutable, cents-only report from a frozen
 * {@link ProjectionRun} — the complete posting audit, the funding-plan join,
 * stable indexes, monthly/annual closes, and per-entity reconciliation. This
 * module owns **no** financial rules and never re-runs the projection: it only
 * reads the run's already-committed facts.
 *
 * ## Completeness / no fabrication (D15)
 *
 * - The audit is built by scanning `run.postings` exactly once. Every committed
 *   posting appears exactly once; a rejected commit has no posting; the opening
 *   observation is never a posting.
 * - A committed {@link ExecutedPlanAudit} (`run.plans`) is joined to its posting
 *   by `occurrenceId`: one committed funding plan ↔ one {@link ReportAuditRow}.
 *   A direct no-plan commit (income/cap/accrual/appreciation/sale/valuation) is a
 *   separate `kind: 'direct'` row and owns no plan.
 * - An **uncommitted** funding quote produces **no** audit row. The quote is
 *   recorded independently in `run.fundingOutcomes` and surfaced here as a
 *   {@link ReportOutcomeRow} (requested spending, shortfall, eligible-source
 *   balances, skipped reasons) so unfunded demand is never lost or fabricated
 *   into a posting.
 *
 * ## Indexes / queries (P4.1)
 *
 * All secondary indexes are built in the **one** scan (`O(postings + touched)`),
 * frozen once, and returned by reference from the query methods — a query never
 * clones the global posting list. Indexes are by occurrence, definition/`source`
 * purpose, touched account, funding-source account, month, and date window.
 *
 * ## Reconciliation (P4.2)
 *
 * For every month close the report replays the sparse committed deltas onto the
 * opening observation and requires
 * `closing = opening + Σ committed deltas` for each account, liability
 * (principal/accrued interest/fees), property value and held acquisition
 * deposit. Aggregate totals are recomputed from the closing snapshot as
 * `assets = accounts + property values + held deposits` and
 * `netWorth = assets − liabilities` (signed, so an underwater balance stays
 * negative). A mismatch is **reported as a diagnostic** — never silently
 * clamped, rounded, or "fixed".
 *
 * ## Monthly / annual flows (P4.2)
 *
 * Monthly flow facts come from the **actual stamped** posting data:
 *
 * - payroll `grossEarnings / netPay / payrollTax / otherDeductions /
 *   employee{Retirement,Hsa} / employer{Retirement,Hsa} / unresolvedEmployee /
 *   allocations` are read from the payroll posting's
 *   {@link PostingFlowFacts}; a funding/accrual/valuation posting has none.
 * - withdrawal `taxesPaid / penaltiesPaid` come **only** from the committed
 *   {@link FundingAllocation} of a committed plan (never from payroll tax), so
 *   payroll withholding is never double-counted as a withdrawal tax.
 * - requested spending is summed from `run.fundingOutcomes` (including a
 *   zero-fund quote); executed expense is summed from the committed
 *   {@link ExecutedPlanAudit} only — a quote and its plan are never both counted.
 * - debt principal / interest come from committed liability deltas, classified
 *   by the posting's phase/purpose; appreciation comes from committed property
 *   value deltas; account growth from the month-close valuation deltas.
 *
 * Annual groups are the **actual** calendar-year months: flow fields are the
 * safe-cent sum of the months, stock fields are the first opening / last closing
 * observation (never a sum). Optional age grouping is emitted **only** when a
 * reliable `dateOfBirth` anchor is supplied, and is labeled separately.
 */

import type { DateOnly, YearMonth } from './dates';
import {
  compareDateOnly,
  fromMonthOrdinal,
  isValidDateOnly,
  parseDateOnly,
  parseYearMonth,
  toMonthOrdinal
} from './dates';
import type {
  PostingFlowAllocation,
  PostingFlowFacts,
  PostingPhase,
  PostingRecord
} from './journal';
import type {
  AccountChange,
  LiabilityChange,
  PropertyChange,
  RuntimeLiabilityKind,
  StateSnapshot,
  StateTotals
} from './state';
import type {
  ExecutedPlanAudit,
  FundingOutcomeSourceBalance,
  MonthlyClose,
  ProjectionFundingOutcome,
  ProjectionRun,
  ProjectionRunMetadata
} from './projection';
import type { EventPhase } from './scheduler';
import type { FundingAllocation, FundingPlan, SkippedFundingSource } from './contracts';

/** Report shape version; bump when a consumer-visible report field changes. */
export const REPORTING_SCHEMA_VERSION = 1;

/**
 * `src/engine/reporting.ts` never opens its own month bucket for a purpose it
 * does not own: the purpose strings here mirror the owning streams exactly and
 * are read from committed postings, not re-derived.
 */
const VALUATION_PURPOSE = 'valuation';
const PROPERTY_APPRECIATION_PURPOSE = 'housingPropertyAppreciation';
const ACCRUAL_PURPOSES: readonly string[] = ['debtInterestAccrual', 'housingMortgageAccrual'];

// ---------------------------------------------------------------------------
// Public report types
// ---------------------------------------------------------------------------

/** Payroll facts are surfaced verbatim from the journal (already deep-frozen). */
export type ReportPayrollFacts = PostingFlowFacts;
export type ReportPayrollAllocation = PostingFlowAllocation;

/** Compact, self-describing run metadata (no live state, no wall clock). */
export interface ReportMetadata {
  readonly engineRevision: string;
  readonly contextSchemaVersion: number;
  readonly contextId: string;
  readonly timelineId: string | null;
  readonly timelineLabel: string;
  readonly startDate: DateOnly;
  readonly endDate: DateOnly;
  readonly startYearMonth: YearMonth;
  readonly endYearMonth: YearMonth;
  readonly horizonMonths: number;
}

/** The opening observation the report replays from (read-only run snapshot). */
export interface ReportOpening {
  readonly date: DateOnly;
  readonly totals: StateTotals;
  readonly snapshot: StateSnapshot;
  readonly diagnostics: readonly string[];
}

/** One committed posting, joined to its plan/outcome when it has one. */
export interface ReportAuditRow {
  /** Stable append index of the posting; deterministic and unique. */
  readonly sequence: number;
  readonly revision: number;
  readonly occurrenceId: string | null;
  readonly definitionId: string | null;
  readonly purpose: string;
  readonly phase: PostingPhase;
  readonly date: DateOnly;
  readonly yearMonth: YearMonth;
  /** `'funding'` when a committed funding plan is joined; `'direct'` otherwise. */
  readonly kind: 'funding' | 'direct';
  /** The joined committed plan (funding rows only), else `null`. */
  readonly plan: ExecutedPlanAudit | null;
  /** The observed quote outcome for this occurrence, when one was recorded. */
  readonly outcome: ProjectionFundingOutcome | null;
  readonly accountChanges: readonly AccountChange[];
  readonly liabilityChanges: readonly LiabilityChange[];
  readonly propertyChanges: readonly PropertyChange[];
  readonly expectedNetWorthDeltaCents: number;
  /** Actual stamped payroll facts (payroll posting only); else `null`. */
  readonly facts: ReportPayrollFacts | null;
  /**
   * Withdrawal withholding sourced **only** from the committed
   * {@link FundingAllocation} of a committed plan — never payroll tax. Zero for
   * a direct posting.
   */
  readonly withdrawalTaxCents: number;
  readonly withdrawalPenaltyCents: number;
}

/** One funding quote outcome, committed or not (never a fabricated posting). */
export interface ReportOutcomeRow {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly handlerId: string | null;
  readonly yearMonth: YearMonth;
  readonly date: DateOnly;
  readonly phase: EventPhase;
  readonly purpose: string;
  readonly committed: boolean;
  readonly requestedCents: number;
  readonly executedCents: number;
  readonly shortfallCents: number;
  readonly status: string;
  readonly quotaLimited: boolean;
  readonly eligibleSources: readonly FundingOutcomeSourceBalance[];
  readonly skippedSources: readonly SkippedFundingSource[];
  readonly plan: FundingPlan;
  /** The committed audit row for this occurrence when it committed; else `null`. */
  readonly row: ReportAuditRow | null;
}

/** Per-account monthly close reconciliation. */
export interface ReportAccountClose {
  readonly accountId: string;
  /** Balance in the run opening observation. */
  readonly openingCents: number;
  /** Σ committed account deltas through this month. */
  readonly deltaCents: number;
  /** Balance captured in the month-close snapshot. */
  readonly closingCents: number;
  /** `openingCents + deltaCents === closingCents`. */
  readonly reconciled: boolean;
}

/** Per-liability monthly close reconciliation. */
export interface ReportLiabilityClose {
  readonly liabilityId: string;
  readonly kind: RuntimeLiabilityKind;
  readonly openingPrincipalCents: number;
  readonly openingInterestCents: number;
  readonly openingFeesCents: number;
  readonly principalDeltaCents: number;
  readonly interestDeltaCents: number;
  readonly feesDeltaCents: number;
  readonly closingPrincipalCents: number;
  readonly closingInterestCents: number;
  readonly closingFeesCents: number;
  readonly reconciled: boolean;
}

/** Per-property (incl. held acquisition deposit) monthly close reconciliation. */
export interface ReportPropertyClose {
  readonly propertyId: string;
  readonly openingValueCents: number;
  readonly openingDepositCents: number;
  readonly valueDeltaCents: number;
  readonly depositDeltaCents: number;
  readonly closingValueCents: number;
  readonly closingDepositCents: number;
  readonly reconciled: boolean;
}

/** Signed aggregate stock totals; `assets = account + property + deposit`. */
export interface ReportStockTotals {
  readonly accountCents: number;
  readonly propertyValueCents: number;
  readonly heldDepositCents: number;
  readonly assetsCents: number;
  readonly liabilityCents: number;
  readonly netWorthCents: number;
}

/** Flow fields for one month (and, summed, one year/age group). */
export interface ReportFlow {
  /** Actual stamped payroll figures (zero when there were no payroll facts). */
  readonly grossEarningsCents: number;
  readonly netPayCents: number;
  readonly payrollTaxCents: number;
  readonly otherDeductionsCents: number;
  readonly employeeRetirementCents: number;
  readonly employeeHsaCents: number;
  readonly employerRetirementCents: number;
  readonly employerHsaCents: number;
  readonly unresolvedEmployeeCents: number;
  readonly payrollAllocations: readonly ReportPayrollAllocation[];
  /** Withdrawal withholding, only from committed FundingAllocation. */
  readonly withdrawalTaxCents: number;
  readonly withdrawalPenaltyCents: number;
  /** Requested spend from funding outcomes (incl. zero-fund quotes). */
  readonly requestedSpendingCents: number;
  /** Executed spend from committed plans (the quote is never re-counted). */
  readonly executedSpendingCents: number;
  readonly shortfallCents: number;
  readonly debtPrincipalPaidCents: number;
  readonly debtInterestPaidCents: number;
  readonly debtInterestAccruedCents: number;
  readonly debtBorrowedCents: number;
  readonly propertyAppreciationCents: number;
  readonly accountGrowthCents: number;
  readonly netWorthDeltaCents: number;
  readonly postingCount: number;
}

/** One inclusive month close: reconciled stocks + actual flow + totals check. */
export interface ReportMonthClose {
  readonly index: number;
  readonly yearMonth: YearMonth;
  readonly closingDate: DateOnly;
  readonly partial: boolean;
  readonly monthFraction: number;
  readonly openingCashCents: number;
  readonly closingCashCents: number;
  readonly growthCents: number;
  readonly opening: ReportStockTotals;
  readonly closing: ReportStockTotals;
  readonly accounts: readonly ReportAccountClose[];
  readonly liabilities: readonly ReportLiabilityClose[];
  readonly properties: readonly ReportPropertyClose[];
  /** Recomputed totals equal the run's provided month-close totals. */
  readonly totalsReconciled: boolean;
  /** Every entity and the aggregate totals reconciled for this month. */
  readonly reconciled: boolean;
  readonly flow: ReportFlow;
}

/** One calendar-year (or age) group over the actual months. */
export interface ReportYear {
  readonly kind: 'calendarYear';
  readonly label: string;
  readonly year: number;
  readonly monthCount: number;
  /** The group covers fewer than a full year of months. */
  readonly partial: boolean;
  readonly firstYearMonth: YearMonth;
  readonly lastYearMonth: YearMonth;
  readonly opening: ReportStockTotals;
  readonly closing: ReportStockTotals;
  readonly flow: ReportFlow;
}

/** Optional, separately labeled age group (only with a reliable anchor). */
export interface ReportAgeGroup {
  readonly kind: 'age';
  readonly label: string;
  readonly age: number;
  readonly monthCount: number;
  readonly partial: boolean;
  readonly firstYearMonth: YearMonth;
  readonly lastYearMonth: YearMonth;
  readonly opening: ReportStockTotals;
  readonly closing: ReportStockTotals;
  readonly flow: ReportFlow;
}

/** Run-level totals reconciliation (opening/closing aggregates). */
export interface ReportRunTotals {
  readonly monthCount: number;
  readonly opening: ReportStockTotals;
  readonly closing: ReportStockTotals;
  /** Computed and provided opening totals agree. */
  readonly openingReconciled: boolean;
  /** Computed and provided closing totals agree. */
  readonly closingReconciled: boolean;
  readonly reconciled: boolean;
}

// ---------------------------------------------------------------------------
// P4.3 — Outcome / warning / funding selectors (pure selection, no math)
// ---------------------------------------------------------------------------

/**
 * The obligation cadence. `monthly`/`yearly` are derived from the **observed**
 * request cadence across the horizon (the run does not carry the scheduler's
 * `RecurrenceSpec`); `oneTime` is a single observed request whose cadence is
 * unknowable; `unknown` is an irregular or ambiguous cadence that must not be
 * presented as a reliable budget kind.
 */
export type ReportPeriodKind = 'monthly' | 'yearly' | 'oneTime' | 'unknown';

/** Completeness shortfall (D16): the first short month and its exact warning. */
export interface ReportShortfall {
  readonly firstShortfallMonth: YearMonth | null;
  readonly firstShortfallDate: DateOnly | null;
  /** Exact P5 language, or `null` when nothing was short. */
  readonly warning: string | null;
  readonly months: readonly YearMonth[];
  readonly totalShortfallCents: number;
  readonly occurrenceCount: number;
}

/** Eligible-funding exhaustion (D16): distinct from a policy/quota shortfall. */
export interface ReportExhaustion {
  readonly exhausted: boolean;
  readonly firstExhaustedMonth: YearMonth | null;
  readonly months: readonly YearMonth[];
  /** Exact phrase, or `null` when no month met the evidence test. */
  readonly warning: string | null;
}

/** One occurrence that drew from a source beyond its configured primary. */
export interface ReportFallbackOccurrence {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly purpose: string;
  readonly yearMonth: YearMonth;
  readonly date: DateOnly;
  readonly committed: boolean;
  /**
   * The true primary: the first position of the plan's quote-time
   * `resolvedSourceOrder` (falling back to raw request provenance only when the
   * resolved order is empty). Never inferred from `eligibleAccountIds[0]`, which
   * excludes an invalid configured primary.
   */
  readonly primaryAccountId: string | null;
  /** The non-primary sources actually drawn from. */
  readonly fallbackAccountIds: readonly string[];
  readonly requestedCents: number;
  readonly executedCents: number;
}

/** Fallback usage (lower severity than shortfall, independent of it). */
export interface ReportFallback {
  readonly used: boolean;
  readonly severity: 'none' | 'low';
  readonly warning: string | null;
  readonly months: readonly YearMonth[];
  readonly occurrences: readonly ReportFallbackOccurrence[];
}

/** Requested-vs-executed budget aggregated by derived period kind. */
export interface ReportBudgetGroup {
  readonly periodKind: ReportPeriodKind;
  readonly definitionCount: number;
  readonly occurrenceCount: number;
  readonly requestedCents: number;
  readonly executedCents: number;
  readonly shortfallCents: number;
}

/** Requested-vs-executed budget for one obligation definition. */
export interface ReportBudgetLine {
  readonly definitionId: string;
  readonly purpose: string;
  readonly periodKind: ReportPeriodKind;
  readonly periodKindReliable: boolean;
  readonly occurrenceCount: number;
  readonly firstYearMonth: YearMonth;
  readonly lastYearMonth: YearMonth;
  readonly months: readonly YearMonth[];
  readonly requestedCents: number;
  readonly executedCents: number;
  readonly shortfallCents: number;
}

/** Requested-vs-executed budgets, by derived period kind and by definition. */
export interface ReportBudgets {
  readonly byPeriodKind: readonly ReportBudgetGroup[];
  readonly lines: readonly ReportBudgetLine[];
}

/** Scheduled-vs-executed occurrence counts for one month. */
export interface ReportOccurrenceMonth {
  readonly yearMonth: YearMonth;
  readonly scheduled: number;
  readonly executed: number;
  readonly unexecuted: number;
}

/** Scheduled-vs-executed occurrence counts (the run carries counts, not ids). */
export interface ReportOccurrenceCounts {
  readonly scheduledTotal: number;
  readonly executedTotal: number;
  readonly unexecutedTotal: number;
  readonly months: readonly ReportOccurrenceMonth[];
}

/** One career observed from its actual payroll postings. */
export interface ReportCareerBoundary {
  readonly careerId: string;
  readonly definitionId: string;
  readonly firstYearMonth: YearMonth;
  readonly lastYearMonth: YearMonth;
  readonly postingCount: number;
  /**
   * Configured pay-plan boundaries are not carried by the run, so observed
   * cadence is the only evidence; the source is recorded explicitly.
   */
  readonly source: 'observed-income-posting';
}

/** Retirement withdrawals attributed to one funding source account. */
export interface ReportRetirementAccount {
  readonly accountId: string;
  readonly executedCents: number;
  readonly grossDebitCents: number;
  readonly taxCents: number;
  readonly penaltyCents: number;
  readonly occurrenceCount: number;
  readonly months: readonly YearMonth[];
}

/** Retirement withdrawals: totals plus a per-source-account breakdown. */
export interface ReportRetirement {
  readonly totalRequestedCents: number;
  readonly totalExecutedCents: number;
  readonly totalShortfallCents: number;
  readonly byAccount: readonly ReportRetirementAccount[];
}

/** Coarse obligation family, read from the posting/request purpose. */
export type ReportObligationKind = 'card' | 'loan' | 'housing' | 'planner' | 'retirement' | 'purchase' | 'other';

/** An obligation schedule selected from actually-paid/posted evidence. */
export interface ReportSchedule {
  readonly definitionId: string;
  readonly purpose: string;
  readonly kind: ReportObligationKind;
  readonly periodKind: ReportPeriodKind;
  readonly periodKindReliable: boolean;
  readonly firstYearMonth: YearMonth;
  readonly lastYearMonth: YearMonth;
  readonly occurrenceCount: number;
  readonly months: readonly YearMonth[];
  readonly requestedCents: number;
  readonly executedCents: number;
  readonly shortfallCents: number;
  readonly statuses: readonly string[];
  readonly committedCount: number;
  readonly unfundedCount: number;
  /** Liability ids this obligation actually touched (empty for a pure expense). */
  readonly liabilityIds: readonly string[];
  /** First month all touched liabilities reached a zero total, else `null`. */
  readonly payoffYearMonth: YearMonth | null;
}

/** The frozen context key a preview was built from (revision/date keyed). */
export interface ReportPreviewContext {
  readonly engineRevision: string;
  readonly contextSchemaVersion: number;
  readonly contextId: string;
  readonly timelineId: string | null;
  readonly startDate: DateOnly;
  readonly endDate: DateOnly;
  /** Final committed revision of the run (0 when nothing committed). */
  readonly revision: number;
  /** Run observation end date (the report's as-of date). */
  readonly date: DateOnly;
}

export type ReportMeasurementKind = 'netWorth' | 'accountAssets';

export interface ReportMeasurementPoint {
  readonly yearMonth: YearMonth;
  readonly valueCents: number;
}

/** One named measurement over the run's month closes. */
export interface ReportMeasurement {
  readonly measurement: ReportMeasurementKind;
  readonly label: string;
  /** Signed series (can go negative) vs an asset-only magnitude. */
  readonly signed: boolean;
  /** The default measurement a consumer should render first. */
  readonly isDefault: boolean;
  readonly context: ReportPreviewContext;
  /** Actual-funded (closing) values; never requested or projected. */
  readonly points: readonly ReportMeasurementPoint[];
}

/** CA12 reporting subset: named-context preview selectors. */
export interface ReportPreviews {
  readonly context: ReportPreviewContext;
  /** Signed net worth (default) and optional account-assets measurements. */
  readonly measurements: readonly ReportMeasurement[];
}

/** Options accepted by {@link buildProjectionReport}. */
export interface BuildProjectionReportOptions {
  /**
   * Optional reliable age anchor (`YYYY-MM-DD`). Age grouping is emitted only
   * when this is a valid date; it is never inferred from a wall clock.
   */
  readonly dateOfBirth?: string;
}

/** The immutable read-only report. */
export interface ProjectionReport {
  readonly schemaVersion: number;
  readonly metadata: ReportMetadata;
  readonly opening: ReportOpening;
  readonly postingCount: number;
  /** Postings that fell inside a month close (equals `postingCount` when clean). */
  readonly reconciledPostingCount: number;
  readonly planCount: number;
  readonly outcomeCount: number;
  /** Every committed posting, in sequence order (funding + direct). */
  readonly audit: readonly ReportAuditRow[];
  readonly fundingRows: readonly ReportAuditRow[];
  readonly directRows: readonly ReportAuditRow[];
  /** Every funding quote outcome (committed or not). */
  readonly outcomes: readonly ReportOutcomeRow[];
  readonly months: readonly ReportMonthClose[];
  readonly years: readonly ReportYear[];
  /** Present only when a valid `dateOfBirth` anchor was supplied. */
  readonly ageGroups?: readonly ReportAgeGroup[];
  readonly totals: ReportRunTotals;
  readonly diagnostics: readonly string[];
  /** Fields the frozen run cannot supply (reported, never invented). */
  readonly unverifiable: readonly string[];

  // --- P4.3 selectors (pure selection over the frozen run) ------------------
  readonly shortfall: ReportShortfall;
  readonly exhaustion: ReportExhaustion;
  readonly fallback: ReportFallback;
  readonly budgets: ReportBudgets;
  readonly occurrences: ReportOccurrenceCounts;
  readonly careers: readonly ReportCareerBoundary[];
  readonly retirement: ReportRetirement;
  readonly schedules: readonly ReportSchedule[];
  readonly previews: ReportPreviews;

  byOccurrence(occurrenceId: string): readonly ReportAuditRow[];
  byDefinition(definitionId: string): readonly ReportAuditRow[];
  /** By "source" purpose label (e.g. `housingRent`, `income`, `valuation`). */
  byPurpose(purpose: string): readonly ReportAuditRow[];
  /** By any account touched by the posting's account deltas. */
  byAccount(accountId: string): readonly ReportAuditRow[];
  /** By funding-source account debited by a committed plan (not destinations). */
  byFundingSource(accountId: string): readonly ReportAuditRow[];
  byMonth(yearMonth: YearMonth): readonly ReportAuditRow[];
  byDateWindow(from: DateOnly, to: DateOnly): readonly ReportAuditRow[];
  accountCloses(accountId: string): readonly ReportAccountClose[];
  liabilityCloses(liabilityId: string): readonly ReportLiabilityClose[];
  propertyCloses(propertyId: string): readonly ReportPropertyClose[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const freezeList = <T>(items: T[]): readonly T[] => Object.freeze(items);
const EMPTY_ROWS: readonly ReportAuditRow[] = freezeList<ReportAuditRow>([]);
const EMPTY_ACCOUNT_CLOSES: readonly ReportAccountClose[] = freezeList<ReportAccountClose>([]);
const EMPTY_LIABILITY_CLOSES: readonly ReportLiabilityClose[] = freezeList<ReportLiabilityClose>([]);
const EMPTY_PROPERTY_CLOSES: readonly ReportPropertyClose[] = freezeList<ReportPropertyClose>([]);

const pushIndex = <T>(index: Map<string, T[]>, key: string, value: T): void => {
  const bucket = index.get(key);
  if (bucket === undefined) {
    index.set(key, [value]);
  } else {
    bucket.push(value);
  }
};

const pushIndexNumber = <T>(index: Map<number, T[]>, key: number, value: T): void => {
  const bucket = index.get(key);
  if (bucket === undefined) {
    index.set(key, [value]);
  } else {
    bucket.push(value);
  }
};

/** Freezes every bucket in an index so a query never returns a mutable array. */
const freezeIndex = <T>(index: Map<string, T[]>): void => {
  for (const bucket of index.values()) {
    Object.freeze(bucket);
  }
};

const monthOf = (date: DateOnly): YearMonth => date.slice(0, 7);

const sumAllocationTax = (allocations: readonly FundingAllocation[]): number => {
  let total = 0;
  for (const allocation of allocations) {
    total += allocation.withheldTaxCents;
  }
  return total;
};

const sumAllocationPenalty = (allocations: readonly FundingAllocation[]): number => {
  let total = 0;
  for (const allocation of allocations) {
    total += allocation.penaltyCents;
  }
  return total;
};

interface RunningLiability {
  kind: RuntimeLiabilityKind;
  principalCents: number;
  accruedInterestCents: number;
  feesCents: number;
}

interface RunningProperty {
  valueCents: number;
  acquisitionDepositCents: number;
  mortgageId: string | null;
  status: string;
  completedDate: string | null;
}

interface RunningState {
  readonly accounts: Map<string, number>;
  readonly liabilities: Map<string, RunningLiability>;
  readonly properties: Map<string, RunningProperty>;
}

const seedRunningState = (snapshot: StateSnapshot): RunningState => {
  const accounts = new Map<string, number>();
  for (const account of snapshot.accounts) {
    accounts.set(account.accountId, account.balanceCents);
  }
  const liabilities = new Map<string, RunningLiability>();
  for (const liability of snapshot.liabilities) {
    liabilities.set(liability.liabilityId, {
      kind: liability.kind,
      principalCents: liability.principalCents,
      accruedInterestCents: liability.accruedInterestCents,
      feesCents: liability.feesCents
    });
  }
  const properties = new Map<string, RunningProperty>();
  for (const property of snapshot.properties) {
    properties.set(property.propertyId, {
      valueCents: property.valueCents,
      acquisitionDepositCents: property.acquisitionDepositCents,
      mortgageId: property.mortgageId,
      status: property.status,
      completedDate: property.completedDate
    });
  }
  return { accounts, liabilities, properties };
};

/** Applies one committed posting's sparse deltas to the running replay maps. */
const applyPosting = (running: RunningState, row: ReportAuditRow): void => {
  for (const change of row.accountChanges) {
    running.accounts.set(change.accountId, (running.accounts.get(change.accountId) ?? 0) + change.deltaCents);
  }
  for (const change of row.liabilityChanges) {
    const previous = running.liabilities.get(change.liabilityId);
    running.liabilities.set(change.liabilityId, {
      kind: change.kind ?? previous?.kind ?? 'unknown',
      principalCents: (previous?.principalCents ?? 0) + (change.principalDeltaCents ?? 0),
      accruedInterestCents: (previous?.accruedInterestCents ?? 0) + (change.accruedInterestDeltaCents ?? 0),
      feesCents: (previous?.feesCents ?? 0) + (change.feesDeltaCents ?? 0)
    });
  }
  for (const change of row.propertyChanges) {
    const previous = running.properties.get(change.propertyId);
    running.properties.set(change.propertyId, {
      valueCents: (previous?.valueCents ?? 0) + (change.valueDeltaCents ?? 0),
      acquisitionDepositCents:
        (previous?.acquisitionDepositCents ?? 0) + (change.acquisitionDepositDeltaCents ?? 0),
      mortgageId: change.mortgageId === undefined ? previous?.mortgageId ?? null : change.mortgageId,
      status: change.status ?? previous?.status ?? 'pending',
      completedDate: change.completedDate === undefined ? previous?.completedDate ?? null : change.completedDate
    });
  }
};

const totalsFromRunning = (running: RunningState): ReportStockTotals => {
  let accountCents = 0;
  for (const balance of running.accounts.values()) {
    accountCents += balance;
  }
  let propertyValueCents = 0;
  let heldDepositCents = 0;
  for (const property of running.properties.values()) {
    propertyValueCents += property.valueCents;
    heldDepositCents += property.acquisitionDepositCents;
  }
  let liabilityCents = 0;
  for (const liability of running.liabilities.values()) {
    liabilityCents += liability.principalCents + liability.accruedInterestCents + liability.feesCents;
  }
  const assetsCents = accountCents + propertyValueCents + heldDepositCents;
  return freeze({
    accountCents,
    propertyValueCents,
    heldDepositCents,
    assetsCents,
    liabilityCents,
    netWorthCents: assetsCents - liabilityCents
  });
};

const totalsFromSnapshot = (snapshot: StateSnapshot): ReportStockTotals => {
  let accountCents = 0;
  for (const account of snapshot.accounts) {
    accountCents += account.balanceCents;
  }
  let propertyValueCents = 0;
  let heldDepositCents = 0;
  for (const property of snapshot.properties) {
    propertyValueCents += property.valueCents;
    heldDepositCents += property.acquisitionDepositCents;
  }
  let liabilityCents = 0;
  for (const liability of snapshot.liabilities) {
    liabilityCents += liability.principalCents + liability.accruedInterestCents + liability.feesCents;
  }
  const assetsCents = accountCents + propertyValueCents + heldDepositCents;
  return freeze({
    accountCents,
    propertyValueCents,
    heldDepositCents,
    assetsCents,
    liabilityCents,
    netWorthCents: assetsCents - liabilityCents
  });
};

const sameTotals = (a: StateTotals, b: ReportStockTotals): boolean =>
  a.accountCents === b.accountCents &&
  a.propertyValueCents === b.propertyValueCents &&
  a.heldDepositCents === b.heldDepositCents &&
  a.assetsCents === b.assetsCents &&
  a.liabilityCents === b.liabilityCents &&
  a.netWorthCents === b.netWorthCents;

// ---------------------------------------------------------------------------
// Flow accumulation
// ---------------------------------------------------------------------------

interface MutableFlow {
  grossEarningsCents: number;
  netPayCents: number;
  payrollTaxCents: number;
  otherDeductionsCents: number;
  employeeRetirementCents: number;
  employeeHsaCents: number;
  employerRetirementCents: number;
  employerHsaCents: number;
  unresolvedEmployeeCents: number;
  payrollAllocations: ReportPayrollAllocation[];
  withdrawalTaxCents: number;
  withdrawalPenaltyCents: number;
  requestedSpendingCents: number;
  executedSpendingCents: number;
  shortfallCents: number;
  debtPrincipalPaidCents: number;
  debtInterestPaidCents: number;
  debtInterestAccruedCents: number;
  debtBorrowedCents: number;
  propertyAppreciationCents: number;
  accountGrowthCents: number;
  netWorthDeltaCents: number;
  postingCount: number;
}

const emptyMutableFlow = (): MutableFlow => ({
  grossEarningsCents: 0,
  netPayCents: 0,
  payrollTaxCents: 0,
  otherDeductionsCents: 0,
  employeeRetirementCents: 0,
  employeeHsaCents: 0,
  employerRetirementCents: 0,
  employerHsaCents: 0,
  unresolvedEmployeeCents: 0,
  payrollAllocations: [],
  withdrawalTaxCents: 0,
  withdrawalPenaltyCents: 0,
  requestedSpendingCents: 0,
  executedSpendingCents: 0,
  shortfallCents: 0,
  debtPrincipalPaidCents: 0,
  debtInterestPaidCents: 0,
  debtInterestAccruedCents: 0,
  debtBorrowedCents: 0,
  propertyAppreciationCents: 0,
  accountGrowthCents: 0,
  netWorthDeltaCents: 0,
  postingCount: 0
});

/** The actual stamped payroll facts contribute their leg amounts verbatim. */
const accumulateFacts = (flow: MutableFlow, facts: ReportPayrollFacts): void => {
  flow.grossEarningsCents += facts.grossEarningsCents;
  flow.netPayCents += facts.netPayCents;
  flow.payrollTaxCents += facts.payrollTaxCents;
  flow.otherDeductionsCents += facts.otherDeductionsCents;
  flow.employeeRetirementCents += facts.employeeRetirementCents;
  flow.employeeHsaCents += facts.employeeHsaCents;
  flow.employerRetirementCents += facts.employerRetirementCents;
  flow.employerHsaCents += facts.employerHsaCents;
  flow.unresolvedEmployeeCents += facts.unresolvedEmployeeCents;
  for (const allocation of facts.allocations) {
    flow.payrollAllocations.push(allocation);
  }
};

/**
 * Debt deltas are classified by **purpose** for a contractual interest accrual
 * and by **delta sign** for principal.
 *
 * The posting's phase is deliberately **not** consulted: a housing sale
 * (`housingDisposition`), acquisition completion (`housingAcquisitionCompletion`)
 * and acquisition-deposit funding (`housingAcquisitionDeposit`) all run in the
 * `accrual` phase but move principal (borrowed / retired) or pay interest; they
 * are not interest accruals. Only the recognized accrual purposes
 * ({@link ACCRUAL_PURPOSES}) contribute to accrued interest. Principal is
 * sign-classified: a completion/mortgage creation increases debt (borrowed),
 * while a sale/payment retires it (paid). A positive interest delta on any other
 * purpose is still a debt increase and is recorded as accrued rather than
 * dropped — the engine only produces positive interest from an accrual purpose.
 */
const accumulateDebt = (flow: MutableFlow, row: ReportAuditRow, diagnostics: string[]): void => {
  const accrualPurpose = ACCRUAL_PURPOSES.includes(row.purpose);
  for (const change of row.liabilityChanges) {
    const principal = change.principalDeltaCents ?? 0;
    const interest = change.accruedInterestDeltaCents ?? 0;
    if (principal < 0) {
      flow.debtPrincipalPaidCents += -principal;
    } else if (principal > 0) {
      flow.debtBorrowedCents += principal;
    }
    if (interest < 0) {
      flow.debtInterestPaidCents += -interest;
    } else if (interest > 0 && accrualPurpose) {
      flow.debtInterestAccruedCents += interest;
    } else if (interest > 0) {
      // Not expected: only the recognized accrual purposes raise interest. It is
      // still real debt movement, so it is recorded as accrued — and surfaced so
      // a same-phase non-accrual posting can never pass silently.
      diagnostics.push(
        `Liability "${change.liabilityId}" increased accrued interest by ${interest} on purpose "${row.purpose}" (not a recognized accrual purpose) at ${row.date}; recorded as accrued.`
      );
      flow.debtInterestAccruedCents += interest;
    }
  }
};

const accumulateRow = (flow: MutableFlow, row: ReportAuditRow, diagnostics: string[]): void => {
  flow.postingCount += 1;
  if (row.facts !== null) {
    accumulateFacts(flow, row.facts);
  }
  if (row.kind === 'funding' && row.plan !== null) {
    flow.executedSpendingCents += row.plan.executedCents;
  }
  flow.withdrawalTaxCents += row.withdrawalTaxCents;
  flow.withdrawalPenaltyCents += row.withdrawalPenaltyCents;
  accumulateDebt(flow, row, diagnostics);
  if (row.purpose === PROPERTY_APPRECIATION_PURPOSE) {
    for (const change of row.propertyChanges) {
      const delta = change.valueDeltaCents ?? 0;
      if (delta > 0) {
        flow.propertyAppreciationCents += delta;
      }
    }
  }
  if (row.purpose === VALUATION_PURPOSE) {
    for (const change of row.accountChanges) {
      flow.accountGrowthCents += change.deltaCents;
    }
  }
  flow.netWorthDeltaCents += row.expectedNetWorthDeltaCents;
};

const addFlow = (target: MutableFlow, source: ReportFlow): void => {
  target.grossEarningsCents += source.grossEarningsCents;
  target.netPayCents += source.netPayCents;
  target.payrollTaxCents += source.payrollTaxCents;
  target.otherDeductionsCents += source.otherDeductionsCents;
  target.employeeRetirementCents += source.employeeRetirementCents;
  target.employeeHsaCents += source.employeeHsaCents;
  target.employerRetirementCents += source.employerRetirementCents;
  target.employerHsaCents += source.employerHsaCents;
  target.unresolvedEmployeeCents += source.unresolvedEmployeeCents;
  for (const allocation of source.payrollAllocations) {
    target.payrollAllocations.push(allocation);
  }
  target.withdrawalTaxCents += source.withdrawalTaxCents;
  target.withdrawalPenaltyCents += source.withdrawalPenaltyCents;
  target.requestedSpendingCents += source.requestedSpendingCents;
  target.executedSpendingCents += source.executedSpendingCents;
  target.shortfallCents += source.shortfallCents;
  target.debtPrincipalPaidCents += source.debtPrincipalPaidCents;
  target.debtInterestPaidCents += source.debtInterestPaidCents;
  target.debtInterestAccruedCents += source.debtInterestAccruedCents;
  target.debtBorrowedCents += source.debtBorrowedCents;
  target.propertyAppreciationCents += source.propertyAppreciationCents;
  target.accountGrowthCents += source.accountGrowthCents;
  target.netWorthDeltaCents += source.netWorthDeltaCents;
  target.postingCount += source.postingCount;
};

const finalizeFlow = (flow: MutableFlow): ReportFlow =>
  freeze({
    grossEarningsCents: flow.grossEarningsCents,
    netPayCents: flow.netPayCents,
    payrollTaxCents: flow.payrollTaxCents,
    otherDeductionsCents: flow.otherDeductionsCents,
    employeeRetirementCents: flow.employeeRetirementCents,
    employeeHsaCents: flow.employeeHsaCents,
    employerRetirementCents: flow.employerRetirementCents,
    employerHsaCents: flow.employerHsaCents,
    unresolvedEmployeeCents: flow.unresolvedEmployeeCents,
    payrollAllocations: freezeList(flow.payrollAllocations),
    withdrawalTaxCents: flow.withdrawalTaxCents,
    withdrawalPenaltyCents: flow.withdrawalPenaltyCents,
    requestedSpendingCents: flow.requestedSpendingCents,
    executedSpendingCents: flow.executedSpendingCents,
    shortfallCents: flow.shortfallCents,
    debtPrincipalPaidCents: flow.debtPrincipalPaidCents,
    debtInterestPaidCents: flow.debtInterestPaidCents,
    debtInterestAccruedCents: flow.debtInterestAccruedCents,
    debtBorrowedCents: flow.debtBorrowedCents,
    propertyAppreciationCents: flow.propertyAppreciationCents,
    accountGrowthCents: flow.accountGrowthCents,
    netWorthDeltaCents: flow.netWorthDeltaCents,
    postingCount: flow.postingCount
  });

// ---------------------------------------------------------------------------
// P4.3 — Outcome / warning / funding selectors (pure selection only)
// ---------------------------------------------------------------------------

const SHORTFALL_WARNING_PREFIX = 'Some scheduled payments could not be fully funded, beginning in ';
const EXHAUSTION_WARNING = 'eligible funding accounts exhausted';
const FALLBACK_WARNING = 'funding fell back to a secondary source';
const PERIOD_KIND_ORDER: readonly ReportPeriodKind[] = ['monthly', 'yearly', 'oneTime', 'unknown'];

interface BudgetAccumulator {
  definitionCount: number;
  occurrenceCount: number;
  requestedCents: number;
  executedCents: number;
  shortfallCents: number;
}

interface RetirementAccountAccumulator {
  executedCents: number;
  grossDebitCents: number;
  taxCents: number;
  penaltyCents: number;
  occurrenceCount: number;
  months: YearMonth[];
}

const distinctSortedMonths = (months: readonly YearMonth[]): YearMonth[] => {
  const seen = new Set<string>();
  const sorted = months.filter((month) => (seen.has(month) ? false : (seen.add(month), true)));
  return sorted.sort((a, b) => toMonthOrdinal(a) - toMonthOrdinal(b));
};

/**
 * Derives an obligation's period kind from the **observed** request cadence
 * (the run does not carry the scheduler's `RecurrenceSpec`). An ambiguous
 * cadence is `unknown` and `reliable: false` — never guessed.
 */
const derivePeriodKind = (months: readonly YearMonth[]): { kind: ReportPeriodKind; reliable: boolean } => {
  const sorted = distinctSortedMonths(months);
  if (sorted.length <= 1) {
    return { kind: sorted.length === 1 ? 'oneTime' : 'unknown', reliable: false };
  }
  let everyMonth = true;
  let everyYear = true;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = toMonthOrdinal(sorted[index]) - toMonthOrdinal(sorted[index - 1]);
    if (gap !== 1) {
      everyMonth = false;
    }
    if (gap < 12) {
      everyYear = false;
    }
  }
  if (everyMonth) {
    return { kind: 'monthly', reliable: true };
  }
  if (everyYear) {
    return { kind: 'yearly', reliable: true };
  }
  return { kind: 'unknown', reliable: false };
};

const obligationKindOf = (purpose: string): ReportObligationKind => {
  if (purpose.startsWith('card')) {
    return 'card';
  }
  if (purpose.startsWith('loan') || purpose === 'debtInterestAccrual') {
    return 'loan';
  }
  if (purpose.startsWith('housing')) {
    return 'housing';
  }
  if (purpose === 'planner') {
    return 'planner';
  }
  if (purpose === 'retirement') {
    return 'retirement';
  }
  if (purpose === 'purchase' || purpose === 'longTermPurchase') {
    return 'purchase';
  }
  return 'other';
};

/** Completeness shortfall (D16): first short month + exact warning. */
const buildShortfall = (outcomes: readonly ReportOutcomeRow[]): ReportShortfall => {
  const short = outcomes.filter((outcome) => outcome.shortfallCents > 0);
  const months = distinctSortedMonths(short.map((outcome) => outcome.yearMonth));
  let total = 0;
  let first: ReportOutcomeRow | null = null;
  for (const outcome of short) {
    total += outcome.shortfallCents;
    if (first === null || outcome.date < first.date) {
      first = outcome;
    }
  }
  const firstMonth = months.length > 0 ? months[0] : null;
  return freeze({
    firstShortfallMonth: firstMonth,
    firstShortfallDate: first === null ? null : first.date,
    warning: firstMonth === null ? null : `${SHORTFALL_WARNING_PREFIX}${firstMonth}.`,
    months: freezeList(months),
    totalShortfallCents: total,
    occurrenceCount: short.length
  });
};

/**
 * Pure-exhaustion evidence (D16): a short request is explained by exhaustion
 * only when it is not quota-limited, it has at least one eligible source, every
 * eligible source was observed at balance 0, and the only skip reason is
 * `zero-balance`. Accountless / ineligible / restricted / unsupported / quota
 * shortfalls are policy, never exhaustion.
 */
const isPureExhaustion = (outcome: ReportOutcomeRow): boolean => {
  if (outcome.quotaLimited) {
    return false;
  }
  if (outcome.eligibleSources.length === 0) {
    return false;
  }
  if (!outcome.eligibleSources.every((source) => source.balanceCents === 0)) {
    return false;
  }
  return outcome.skippedSources.every((source) => source.reason === 'zero-balance');
};

/**
 * Eligible-funding exhaustion (D16): only when every short request is pure.
 *
 * Conservative by construction: a month is exhausted only when **all** of its
 * short requests are pure exhaustion. If a policy/quota/restricted shortfall
 * shares the month with a pure one, the month is not reported as exhaustion —
 * "a shortfall caused by policy is not exhaustion" (D16). This is intentional
 * and does not change any funding policy.
 */
const buildExhaustion = (outcomes: readonly ReportOutcomeRow[]): ReportExhaustion => {
  const byMonth = new Map<string, ReportOutcomeRow[]>();
  for (const outcome of outcomes) {
    pushIndex(byMonth, outcome.yearMonth, outcome);
  }
  const months: YearMonth[] = [];
  for (const month of distinctSortedMonths([...byMonth.keys()])) {
    const short = (byMonth.get(month) ?? []).filter((outcome) => outcome.shortfallCents > 0);
    if (short.length > 0 && short.every(isPureExhaustion)) {
      months.push(month);
    }
  }
  return freeze({
    exhausted: months.length > 0,
    firstExhaustedMonth: months[0] ?? null,
    months: freezeList(months),
    warning: months.length > 0 ? EXHAUSTION_WARNING : null
  });
};

/** Fallback usage (lower severity, independent of shortfall). */
const buildFallback = (outcomes: readonly ReportOutcomeRow[]): ReportFallback => {
  const occurrences: ReportFallbackOccurrence[] = [];
  for (const outcome of outcomes) {
    // Only an actually-committed execution with real allocations can be a
    // fallback draw: an uncommitted quote (or a zero-allocation plan) debited
    // nothing, so it is never reported as a fallback occurrence.
    const allocations = outcome.plan.allocations;
    if (!outcome.committed || allocations.length === 0) {
      continue;
    }
    // The quote-time resolved order is authoritative: the true primary is its
    // first position, which names the source even when
    // `request.primaryAccountId` is null because the request deferred to the
    // global policy. Never infer the primary from `eligibleAccountIds[0]`: it
    // excludes an invalid configured primary and would mislabel every drawn
    // account as a fallback. Use the raw request provenance only when the
    // resolved order is empty (a legacy/synthetic plan).
    const primary = outcome.plan.resolvedSourceOrder[0] ?? outcome.plan.request.primaryAccountId;
    const fallbackIds: string[] = [];
    for (const allocation of allocations) {
      if (allocation.accountId !== primary && !fallbackIds.includes(allocation.accountId)) {
        fallbackIds.push(allocation.accountId);
      }
    }
    if (fallbackIds.length === 0) {
      continue;
    }
    occurrences.push(
      freeze({
        occurrenceId: outcome.occurrenceId,
        definitionId: outcome.definitionId,
        purpose: outcome.purpose,
        yearMonth: outcome.yearMonth,
        date: outcome.date,
        committed: outcome.committed,
        primaryAccountId: primary,
        fallbackAccountIds: freezeList(fallbackIds),
        requestedCents: outcome.requestedCents,
        executedCents: outcome.executedCents
      })
    );
  }
  const months = distinctSortedMonths(occurrences.map((entry) => entry.yearMonth));
  return freeze({
    used: occurrences.length > 0,
    severity: occurrences.length > 0 ? 'low' : 'none',
    warning: occurrences.length > 0 ? FALLBACK_WARNING : null,
    months: freezeList(months),
    occurrences: freezeList(occurrences)
  });
};

/** Requested-vs-executed budgets by observed period kind and by definition. */
const buildBudgets = (outcomes: readonly ReportOutcomeRow[]): ReportBudgets => {
  const byDefinition = new Map<string, ReportOutcomeRow[]>();
  for (const outcome of outcomes) {
    pushIndex(byDefinition, outcome.definitionId, outcome);
  }
  const lines: ReportBudgetLine[] = [];
  const groups = new Map<ReportPeriodKind, BudgetAccumulator>();
  for (const definitionId of [...byDefinition.keys()].sort()) {
    const list = byDefinition.get(definitionId) as ReportOutcomeRow[];
    const months = distinctSortedMonths(list.map((outcome) => outcome.yearMonth));
    const { kind, reliable } = derivePeriodKind(months);
    let requestedCents = 0;
    let executedCents = 0;
    let shortfallCents = 0;
    for (const outcome of list) {
      requestedCents += outcome.requestedCents;
      executedCents += outcome.executedCents;
      shortfallCents += outcome.shortfallCents;
    }
    lines.push(
      freeze({
        definitionId,
        purpose: list[0].purpose,
        periodKind: kind,
        periodKindReliable: reliable,
        occurrenceCount: list.length,
        firstYearMonth: months[0],
        lastYearMonth: months[months.length - 1],
        months: freezeList(months),
        requestedCents,
        executedCents,
        shortfallCents
      })
    );
    const group = groups.get(kind) ?? {
      definitionCount: 0,
      occurrenceCount: 0,
      requestedCents: 0,
      executedCents: 0,
      shortfallCents: 0
    };
    group.definitionCount += 1;
    group.occurrenceCount += list.length;
    group.requestedCents += requestedCents;
    group.executedCents += executedCents;
    group.shortfallCents += shortfallCents;
    groups.set(kind, group);
  }
  const byPeriodKind: ReportBudgetGroup[] = [];
  for (const kind of PERIOD_KIND_ORDER) {
    const group = groups.get(kind);
    if (group === undefined) {
      continue;
    }
    byPeriodKind.push(
      freeze({
        periodKind: kind,
        definitionCount: group.definitionCount,
        occurrenceCount: group.occurrenceCount,
        requestedCents: group.requestedCents,
        executedCents: group.executedCents,
        shortfallCents: group.shortfallCents
      })
    );
  }
  return freeze({ byPeriodKind: freezeList(byPeriodKind), lines: freezeList(lines) });
};

/** Scheduled-vs-executed occurrence counts (ids are not carried by the run). */
const buildOccurrences = (closes: readonly MonthlyClose[]): ReportOccurrenceCounts => {
  const months: ReportOccurrenceMonth[] = [];
  let scheduledTotal = 0;
  let executedTotal = 0;
  for (const close of closes) {
    const scheduled = close.scheduledEventCount;
    const executed = close.executedEventCount;
    scheduledTotal += scheduled;
    executedTotal += executed;
    months.push(
      freeze({
        yearMonth: close.yearMonth,
        scheduled,
        executed,
        unexecuted: Math.max(0, scheduled - executed)
      })
    );
  }
  return freeze({
    scheduledTotal,
    executedTotal,
    unexecutedTotal: Math.max(0, scheduledTotal - executedTotal),
    months: freezeList(months)
  });
};

/** Career boundaries observed from actual payroll (`income:*`) postings. */
const buildCareers = (audit: readonly ReportAuditRow[]): readonly ReportCareerBoundary[] => {
  const byDefinition = new Map<string, ReportAuditRow[]>();
  for (const row of audit) {
    if (row.purpose !== 'income' || row.definitionId === null) {
      continue;
    }
    pushIndex(byDefinition, row.definitionId, row);
  }
  const careers: ReportCareerBoundary[] = [];
  for (const definitionId of [...byDefinition.keys()].sort()) {
    const rows = byDefinition.get(definitionId) as ReportAuditRow[];
    const months = distinctSortedMonths(rows.map((row) => row.yearMonth));
    careers.push(
      freeze({
        careerId: definitionId.startsWith('income:') ? definitionId.slice('income:'.length) : definitionId,
        definitionId,
        firstYearMonth: months[0],
        lastYearMonth: months[months.length - 1],
        postingCount: rows.length,
        source: 'observed-income-posting' as const
      })
    );
  }
  return freezeList(careers);
};

/** Retirement withdrawals, totalled and attributed per funding source account. */
const buildRetirement = (outcomes: readonly ReportOutcomeRow[]): ReportRetirement => {
  const retirement = outcomes.filter((outcome) => outcome.purpose === 'retirement');
  let totalRequestedCents = 0;
  let totalExecutedCents = 0;
  let totalShortfallCents = 0;
  const accounts = new Map<string, RetirementAccountAccumulator>();
  for (const outcome of retirement) {
    totalRequestedCents += outcome.requestedCents;
    totalExecutedCents += outcome.executedCents;
    totalShortfallCents += outcome.shortfallCents;
    for (const allocation of outcome.plan.allocations) {
      const entry = accounts.get(allocation.accountId) ?? {
        executedCents: 0,
        grossDebitCents: 0,
        taxCents: 0,
        penaltyCents: 0,
        occurrenceCount: 0,
        months: []
      };
      entry.executedCents += allocation.netFundedCents;
      entry.grossDebitCents += allocation.grossDebitCents;
      entry.taxCents += allocation.withheldTaxCents;
      entry.penaltyCents += allocation.penaltyCents;
      entry.occurrenceCount += 1;
      entry.months.push(outcome.yearMonth);
      accounts.set(allocation.accountId, entry);
    }
  }
  const byAccount: ReportRetirementAccount[] = [...accounts.keys()].sort().map((accountId) => {
    const entry = accounts.get(accountId) as RetirementAccountAccumulator;
    return freeze({
      accountId,
      executedCents: entry.executedCents,
      grossDebitCents: entry.grossDebitCents,
      taxCents: entry.taxCents,
      penaltyCents: entry.penaltyCents,
      occurrenceCount: entry.occurrenceCount,
      months: freezeList(distinctSortedMonths(entry.months))
    });
  });
  return freeze({
    totalRequestedCents,
    totalExecutedCents,
    totalShortfallCents,
    byAccount: freezeList(byAccount)
  });
};

/**
 * Per-obligation schedules selected from actually-paid/posted evidence, with a
 * payoff month derived from the reconciled liability closes (never re-amortized).
 */
const buildSchedules = (
  outcomes: readonly ReportOutcomeRow[],
  audit: readonly ReportAuditRow[],
  closes: readonly ReportMonthClose[]
): readonly ReportSchedule[] => {
  const auditByDefinition = new Map<string, ReportAuditRow[]>();
  for (const row of audit) {
    if (row.definitionId !== null) {
      pushIndex(auditByDefinition, row.definitionId, row);
    }
  }
  const byDefinition = new Map<string, ReportOutcomeRow[]>();
  for (const outcome of outcomes) {
    pushIndex(byDefinition, outcome.definitionId, outcome);
  }
  const liabilityTotalAt = (close: ReportMonthClose, liabilityId: string): number => {
    const entry = close.liabilities.find((liability) => liability.liabilityId === liabilityId);
    if (entry === undefined) {
      return 0;
    }
    return entry.closingPrincipalCents + entry.closingInterestCents + entry.closingFeesCents;
  };

  const schedules: ReportSchedule[] = [];
  for (const definitionId of [...byDefinition.keys()].sort()) {
    const list = byDefinition.get(definitionId) as ReportOutcomeRow[];
    const monthKeys = distinctSortedMonths(list.map((outcome) => outcome.yearMonth));
    const { kind, reliable } = derivePeriodKind(monthKeys);
    let requestedCents = 0;
    let executedCents = 0;
    let shortfallCents = 0;
    let committedCount = 0;
    let unfundedCount = 0;
    const statuses = new Set<string>();
    for (const outcome of list) {
      requestedCents += outcome.requestedCents;
      executedCents += outcome.executedCents;
      shortfallCents += outcome.shortfallCents;
      statuses.add(outcome.status);
      if (outcome.committed) {
        committedCount += 1;
      } else {
        unfundedCount += 1;
      }
    }
    const rows = auditByDefinition.get(definitionId) ?? [];
    const liabilityIds = [
      ...new Set(rows.flatMap((row) => row.liabilityChanges.map((change) => change.liabilityId)))
    ].sort();

    let payoffYearMonth: YearMonth | null = null;
    if (liabilityIds.length > 0) {
      let lastNonZero = -1;
      for (let index = 0; index < closes.length; index += 1) {
        if (liabilityIds.some((liabilityId) => liabilityTotalAt(closes[index], liabilityId) > 0)) {
          lastNonZero = index;
        }
      }
      if (lastNonZero >= 0 && lastNonZero + 1 < closes.length) {
        const next = closes[lastNonZero + 1];
        if (liabilityIds.every((liabilityId) => liabilityTotalAt(next, liabilityId) === 0)) {
          payoffYearMonth = next.yearMonth;
        }
      }
    }

    schedules.push(
      freeze({
        definitionId,
        purpose: list[0].purpose,
        kind: obligationKindOf(list[0].purpose),
        periodKind: kind,
        periodKindReliable: reliable,
        firstYearMonth: monthKeys[0],
        lastYearMonth: monthKeys[monthKeys.length - 1],
        occurrenceCount: list.length,
        months: freezeList(monthKeys),
        requestedCents,
        executedCents,
        shortfallCents,
        statuses: freezeList([...statuses].sort()),
        committedCount,
        unfundedCount,
        liabilityIds: freezeList(liabilityIds),
        payoffYearMonth
      })
    );
  }
  return freezeList(schedules);
};

/** CA12 reporting subset: named-context, revision/date-keyed preview selectors. */
const buildPreviews = (
  metadata: ProjectionRunMetadata,
  months: readonly ReportMonthClose[],
  revision: number
): ReportPreviews => {
  const context = freeze<ReportPreviewContext>({
    engineRevision: metadata.engineRevision,
    contextSchemaVersion: metadata.contextSchemaVersion,
    contextId: metadata.contextId,
    timelineId: metadata.timelineId,
    startDate: metadata.startDate,
    endDate: metadata.endDate,
    revision,
    date: metadata.endDate
  });
  const netWorthPoints = months.map((month) =>
    freeze({ yearMonth: month.yearMonth, valueCents: month.closing.netWorthCents })
  );
  const accountAssetPoints = months.map((month) =>
    freeze({ yearMonth: month.yearMonth, valueCents: month.closing.accountCents })
  );
  return freeze({
    context,
    measurements: freezeList<ReportMeasurement>([
      freeze({
        measurement: 'netWorth' as const,
        label: 'Net worth',
        signed: true,
        isDefault: true,
        context,
        points: freezeList(netWorthPoints)
      }),
      freeze({
        measurement: 'accountAssets' as const,
        label: 'Account assets',
        signed: false,
        isDefault: false,
        context,
        points: freezeList(accountAssetPoints)
      })
    ])
  });
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const metadataOf = (metadata: ProjectionRunMetadata): ReportMetadata =>
  freeze({
    engineRevision: metadata.engineRevision,
    contextSchemaVersion: metadata.contextSchemaVersion,
    contextId: metadata.contextId,
    timelineId: metadata.timelineId,
    timelineLabel: metadata.timelineLabel,
    startDate: metadata.startDate,
    endDate: metadata.endDate,
    startYearMonth: metadata.startYearMonth,
    endYearMonth: metadata.endYearMonth,
    horizonMonths: metadata.horizonMonths
  });

/** Builds one committed audit row + its plan/outcome join, from a posting. */
const buildRow = (
  record: PostingRecord,
  plan: ExecutedPlanAudit | null,
  outcome: ProjectionFundingOutcome | null
): ReportAuditRow => {
  const occurrenceId = record.posting.occurrenceId ?? null;
  const allocations = plan === null ? [] : plan.plan.allocations;
  return freeze({
    sequence: record.sequence,
    revision: record.revision,
    occurrenceId,
    definitionId: record.posting.definitionId ?? null,
    purpose: record.posting.purpose,
    phase: record.posting.phase,
    date: record.posting.date,
    yearMonth: monthOf(record.posting.date),
    kind: plan === null ? 'direct' : 'funding',
    plan,
    outcome,
    accountChanges: record.accountChanges,
    liabilityChanges: record.liabilityChanges,
    propertyChanges: record.propertyChanges,
    expectedNetWorthDeltaCents: record.expectedNetWorthDeltaCents,
    facts: record.posting.facts ?? null,
    withdrawalTaxCents: plan === null ? 0 : sumAllocationTax(allocations),
    withdrawalPenaltyCents: plan === null ? 0 : sumAllocationPenalty(allocations)
  });
};

/** Age in whole years at a `YYYY-MM` month, from a parsed `YYYY-MM-DD` anchor. */
const ageAtMonth = (dateOfBirth: { year: number; month: number }, yearMonth: YearMonth): number => {
  const parsed = parseYearMonth(yearMonth);
  if (parsed === null) {
    return 0;
  }
  return parsed.year - dateOfBirth.year - (parsed.month < dateOfBirth.month ? 1 : 0);
};

/**
 * Builds the immutable report for a frozen run. Pure and side-effect free: it
 * reads the run only and never mutates it or re-runs finance.
 */
export const buildProjectionReport = (
  run: ProjectionRun,
  options: BuildProjectionReportOptions = {}
): ProjectionReport => {
  const diagnostics: string[] = [];

  // --- Plan / outcome join maps (one pass over plans + outcomes) ------------
  const plansByOccurrence = new Map<string, ExecutedPlanAudit[]>();
  for (const plan of run.plans) {
    pushIndex(plansByOccurrence, plan.occurrenceId, plan);
  }
  const outcomesByOccurrence = new Map<string, ProjectionFundingOutcome[]>();
  for (const outcome of run.fundingOutcomes) {
    pushIndex(outcomesByOccurrence, outcome.occurrenceId, outcome);
  }

  // --- One scan of the posting journal: rows + indexes ----------------------
  const audit: ReportAuditRow[] = [];
  const byOccurrence = new Map<string, ReportAuditRow[]>();
  const byDefinition = new Map<string, ReportAuditRow[]>();
  const byPurpose = new Map<string, ReportAuditRow[]>();
  const byAccount = new Map<string, ReportAuditRow[]>();
  const byFundingSource = new Map<string, ReportAuditRow[]>();
  const byMonth = new Map<string, ReportAuditRow[]>();
  const joinedPlans = new Set<ExecutedPlanAudit>();

  const rowForOccurrence = new Map<string, ReportAuditRow>();

  for (const record of run.postings) {
    const occurrenceId = record.posting.occurrenceId ?? null;
    let plan: ExecutedPlanAudit | null = null;
    if (occurrenceId !== null) {
      const candidates = plansByOccurrence.get(occurrenceId);
      if (candidates !== undefined) {
        for (const candidate of candidates) {
          if (!joinedPlans.has(candidate)) {
            plan = candidate;
            joinedPlans.add(candidate);
            break;
          }
        }
        if (plan === null) {
          diagnostics.push(
            `Occurrence "${occurrenceId}" has more postings than committed plans; an extra posting was left unjoined.`
          );
        }
      }
    }
    const outcomeList = occurrenceId === null ? undefined : outcomesByOccurrence.get(occurrenceId);
    const outcome = outcomeList === undefined || outcomeList.length === 0 ? null : outcomeList[0];
    const row = buildRow(record, plan, outcome);
    audit.push(row);

    if (occurrenceId !== null) {
      pushIndex(byOccurrence, occurrenceId, row);
      if (row.kind === 'funding') {
        rowForOccurrence.set(occurrenceId, row);
      }
    }
    if (row.definitionId !== null) {
      pushIndex(byDefinition, row.definitionId, row);
    }
    pushIndex(byPurpose, row.purpose, row);
    pushIndex(byMonth, row.yearMonth, row);
    const touched = new Set<string>();
    for (const change of row.accountChanges) {
      touched.add(change.accountId);
    }
    for (const accountId of touched) {
      pushIndex(byAccount, accountId, row);
    }
    if (plan !== null) {
      const sources = new Set<string>();
      for (const allocation of plan.plan.allocations) {
        sources.add(allocation.accountId);
      }
      for (const accountId of sources) {
        pushIndex(byFundingSource, accountId, row);
      }
    }
  }

  // --- Join integrity diagnostics ------------------------------------------
  freezeIndex(byOccurrence);
  freezeIndex(byDefinition);
  freezeIndex(byPurpose);
  freezeIndex(byAccount);
  freezeIndex(byFundingSource);
  freezeIndex(byMonth);
  for (const plan of run.plans) {
    if (!joinedPlans.has(plan)) {
      diagnostics.push(
        `Committed funding plan for occurrence "${plan.occurrenceId}" has no journaled posting (audit would be incomplete).`
      );
    }
  }
  for (const outcome of run.fundingOutcomes) {
    const row = rowForOccurrence.get(outcome.occurrenceId);
    if (outcome.committed && row === undefined) {
      diagnostics.push(
        `Funding outcome for occurrence "${outcome.occurrenceId}" is committed but has no journaled posting.`
      );
    }
    if (!outcome.committed && row !== undefined) {
      diagnostics.push(
        `Occurrence "${outcome.occurrenceId}" has a posting but its funding outcome was not committed.`
      );
    }
  }

  // --- Outcome rows (committed + unfunded) ---------------------------------
  const outcomeRows = run.fundingOutcomes.map((outcome) =>
    freeze({
      occurrenceId: outcome.occurrenceId,
      definitionId: outcome.definitionId,
      handlerId: outcome.handlerId,
      yearMonth: outcome.yearMonth,
      date: outcome.date,
      phase: outcome.phase,
      purpose: outcome.plan.request.purpose,
      committed: outcome.committed,
      requestedCents: outcome.plan.request.requestedCents,
      executedCents: outcome.plan.executedCents,
      shortfallCents: outcome.plan.shortfallCents,
      status: outcome.plan.status,
      quotaLimited: outcome.quotaLimited,
      eligibleSources: outcome.eligibleSources,
      skippedSources: outcome.skippedSources,
      plan: outcome.plan,
      row: rowForOccurrence.get(outcome.occurrenceId) ?? null
    }) satisfies ReportOutcomeRow
  );

  const outcomesByMonth = new Map<string, ReportOutcomeRow[]>();
  for (const outcome of outcomeRows) {
    pushIndex(outcomesByMonth, outcome.yearMonth, outcome);
  }

  // --- Monthly closes + reconciliation -------------------------------------
  const running = seedRunningState(run.opening.snapshot);
  const openingRunTotals = totalsFromRunning(running);

  const months: ReportMonthClose[] = [];
  const accountCloseIndex = new Map<string, ReportAccountClose[]>();
  const liabilityCloseIndex = new Map<string, ReportLiabilityClose[]>();
  const propertyCloseIndex = new Map<string, ReportPropertyClose[]>();
  let reconciledPostingCount = 0;

  for (const close of run.monthlyCloses) {
    const opening = totalsFromRunning(running);
    const rows = byMonth.get(close.yearMonth) ?? EMPTY_ROWS;
    for (const row of rows) {
      applyPosting(running, row);
      reconciledPostingCount += 1;
    }

    const snapshot = close.snapshot;
    const closing = totalsFromSnapshot(snapshot);

    // Per-account reconciliation against the opening observation + deltas.
    const accountIds = new Set<string>(running.accounts.keys());
    for (const account of snapshot.accounts) {
      accountIds.add(account.accountId);
    }
    const snapshotAccounts = new Map(snapshot.accounts.map((account) => [account.accountId, account.balanceCents]));
    const openingAccounts = new Map(
      run.opening.snapshot.accounts.map((account) => [account.accountId, account.balanceCents])
    );
    const accounts: ReportAccountClose[] = [];
    for (const accountId of [...accountIds].sort()) {
      const openingCents = openingAccounts.get(accountId) ?? 0;
      const replayed = running.accounts.get(accountId) ?? 0;
      const closingCents = snapshotAccounts.get(accountId) ?? 0;
      const reconciled = replayed === closingCents;
      if (!reconciled) {
        diagnostics.push(
          `Account "${accountId}" does not reconcile at ${close.yearMonth}: opening ${openingCents} + deltas ${
            replayed - openingCents
          } = ${replayed} but the close snapshot is ${closingCents}.`
        );
      }
      const entry = freeze({
        accountId,
        openingCents,
        deltaCents: replayed - openingCents,
        closingCents,
        reconciled
      });
      accounts.push(entry);
      pushIndex(accountCloseIndex, accountId, entry);
    }

    // Per-liability reconciliation.
    const liabilityIds = new Set<string>(running.liabilities.keys());
    for (const liability of snapshot.liabilities) {
      liabilityIds.add(liability.liabilityId);
    }
    const snapshotLiabilities = new Map(snapshot.liabilities.map((liability) => [liability.liabilityId, liability]));
    const openingLiabilities = new Map(
      run.opening.snapshot.liabilities.map((liability) => [liability.liabilityId, liability])
    );
    const liabilities: ReportLiabilityClose[] = [];
    for (const liabilityId of [...liabilityIds].sort()) {
      const openingLiability = openingLiabilities.get(liabilityId);
      const replayed = running.liabilities.get(liabilityId);
      const actual = snapshotLiabilities.get(liabilityId);
      const openingPrincipalCents = openingLiability?.principalCents ?? 0;
      const openingInterestCents = openingLiability?.accruedInterestCents ?? 0;
      const openingFeesCents = openingLiability?.feesCents ?? 0;
      const replayedPrincipal = replayed?.principalCents ?? 0;
      const replayedInterest = replayed?.accruedInterestCents ?? 0;
      const replayedFees = replayed?.feesCents ?? 0;
      const closingPrincipalCents = actual?.principalCents ?? 0;
      const closingInterestCents = actual?.accruedInterestCents ?? 0;
      const closingFeesCents = actual?.feesCents ?? 0;
      const reconciled =
        replayedPrincipal === closingPrincipalCents &&
        replayedInterest === closingInterestCents &&
        replayedFees === closingFeesCents;
      if (!reconciled) {
        diagnostics.push(
          `Liability "${liabilityId}" does not reconcile at ${close.yearMonth}: replayed (${replayedPrincipal}, ${replayedInterest}, ${replayedFees}) vs close (${closingPrincipalCents}, ${closingInterestCents}, ${closingFeesCents}).`
        );
      }
      const entry = freeze<ReportLiabilityClose>({
        liabilityId,
        kind: replayed?.kind ?? actual?.kind ?? openingLiability?.kind ?? 'unknown',
        openingPrincipalCents,
        openingInterestCents,
        openingFeesCents,
        principalDeltaCents: replayedPrincipal - openingPrincipalCents,
        interestDeltaCents: replayedInterest - openingInterestCents,
        feesDeltaCents: replayedFees - openingFeesCents,
        closingPrincipalCents,
        closingInterestCents,
        closingFeesCents,
        reconciled
      });
      liabilities.push(entry);
      pushIndex(liabilityCloseIndex, liabilityId, entry);
    }

    // Per-property reconciliation (value + held acquisition deposit).
    const propertyIds = new Set<string>(running.properties.keys());
    for (const property of snapshot.properties) {
      propertyIds.add(property.propertyId);
    }
    const snapshotProperties = new Map(snapshot.properties.map((property) => [property.propertyId, property]));
    const openingProperties = new Map(
      run.opening.snapshot.properties.map((property) => [property.propertyId, property])
    );
    const properties: ReportPropertyClose[] = [];
    for (const propertyId of [...propertyIds].sort()) {
      const openingProperty = openingProperties.get(propertyId);
      const replayed = running.properties.get(propertyId);
      const actual = snapshotProperties.get(propertyId);
      const openingValueCents = openingProperty?.valueCents ?? 0;
      const openingDepositCents = openingProperty?.acquisitionDepositCents ?? 0;
      const replayedValue = replayed?.valueCents ?? 0;
      const replayedDeposit = replayed?.acquisitionDepositCents ?? 0;
      const closingValueCents = actual?.valueCents ?? 0;
      const closingDepositCents = actual?.acquisitionDepositCents ?? 0;
      const reconciled = replayedValue === closingValueCents && replayedDeposit === closingDepositCents;
      if (!reconciled) {
        diagnostics.push(
          `Property "${propertyId}" does not reconcile at ${close.yearMonth}: replayed (value ${replayedValue}, deposit ${replayedDeposit}) vs close (value ${closingValueCents}, deposit ${closingDepositCents}).`
        );
      }
      const entry = freeze({
        propertyId,
        openingValueCents,
        openingDepositCents,
        valueDeltaCents: replayedValue - openingValueCents,
        depositDeltaCents: replayedDeposit - openingDepositCents,
        closingValueCents,
        closingDepositCents,
        reconciled
      });
      properties.push(entry);
      pushIndex(propertyCloseIndex, propertyId, entry);
    }

    // Aggregate totals: `assets = account + property + deposit`, signed net worth.
    const totalsReconciled = sameTotals(close.totals, closing);
    if (!totalsReconciled) {
      diagnostics.push(
        `Month "${close.yearMonth}" totals do not reconcile: computed assets ${closing.assetsCents} / liabilities ${closing.liabilityCents} / net worth ${closing.netWorthCents} vs provided assets ${close.totals.assetsCents} / liabilities ${close.totals.liabilityCents} / net worth ${close.totals.netWorthCents}.`
      );
    }
    const assetsCheck = closing.assetsCents === closing.accountCents + closing.propertyValueCents + closing.heldDepositCents;
    const netWorthCheck = closing.netWorthCents === closing.assetsCents - closing.liabilityCents;
    if (!assetsCheck || !netWorthCheck) {
      diagnostics.push(
        `Month "${close.yearMonth}" aggregate identity failed: assets ${closing.assetsCents} vs account+property+deposit ${closing.accountCents + closing.propertyValueCents + closing.heldDepositCents}; net worth ${closing.netWorthCents} vs assets−liabilities ${closing.assetsCents - closing.liabilityCents}.`
      );
    }

    // Flows: actual stamped payroll facts, committed allocations, committed
    // plans and funding outcomes. Requested and executed are counted from
    // separate sources so a quote and its plan are never double counted.
    const flow = emptyMutableFlow();
    for (const row of rows) {
      accumulateRow(flow, row, diagnostics);
    }
    for (const outcome of outcomesByMonth.get(close.yearMonth) ?? []) {
      flow.requestedSpendingCents += outcome.requestedCents;
      flow.shortfallCents += outcome.shortfallCents;
    }
    if (!Number.isSafeInteger(flow.requestedSpendingCents) || !Number.isSafeInteger(flow.shortfallCents)) {
      diagnostics.push(`Month "${close.yearMonth}" requested spending exceeds the safe integer cent range.`);
    }

    const reconciled =
      accounts.every((account) => account.reconciled) &&
      liabilities.every((liability) => liability.reconciled) &&
      properties.every((property) => property.reconciled) &&
      totalsReconciled;

    months.push(
      freeze({
        index: close.index,
        yearMonth: close.yearMonth,
        closingDate: close.closingDate,
        partial: close.partial,
        monthFraction: close.monthFraction,
        openingCashCents: close.openingCashCents,
        closingCashCents: close.closingCashCents,
        growthCents: close.growthCents,
        opening,
        closing,
        accounts: freezeList(accounts),
        liabilities: freezeList(liabilities),
        properties: freezeList(properties),
        totalsReconciled,
        reconciled,
        flow: finalizeFlow(flow)
      })
    );
  }

  if (reconciledPostingCount !== run.postings.length) {
    diagnostics.push(
      `Only ${reconciledPostingCount} of ${run.postings.length} committed postings fell inside a month close; the audit and the replay disagree on the horizon.`
    );
  }

  // --- Annual grouping by actual calendar-year months ----------------------
  const years: ReportYear[] = [];
  const yearBuckets = new Map<string, ReportMonthClose[]>();
  for (const month of months) {
    pushIndex(yearBuckets, month.yearMonth.slice(0, 4), month);
  }
  for (const yearLabel of [...yearBuckets.keys()].sort()) {
    const bucket = yearBuckets.get(yearLabel) as ReportMonthClose[];
    const flow = emptyMutableFlow();
    for (const month of bucket) {
      addFlow(flow, month.flow);
    }
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    years.push(
      freeze({
        kind: 'calendarYear' as const,
        label: yearLabel,
        year: Number(yearLabel),
        monthCount: bucket.length,
        partial: bucket.length < 12,
        firstYearMonth: first.yearMonth,
        lastYearMonth: last.yearMonth,
        opening: first.opening,
        closing: last.closing,
        flow: finalizeFlow(flow)
      })
    );
  }

  // --- Optional, separately labeled age grouping ----------------------------
  let ageGroups: ReportAgeGroup[] | undefined;
  if (options.dateOfBirth !== undefined) {
    const parsedDob = parseDateOnly(options.dateOfBirth);
    if (parsedDob === null) {
      diagnostics.push(
        `Age grouping requested but dateOfBirth "${options.dateOfBirth}" is not a valid YYYY-MM-DD date; age groups were omitted.`
      );
    } else {
      const ageBuckets = new Map<number, ReportMonthClose[]>();
      for (const month of months) {
        pushIndexNumber(ageBuckets, ageAtMonth(parsedDob, month.yearMonth), month);
      }
      ageGroups = [];
      for (const age of [...ageBuckets.keys()].sort((a, b) => a - b)) {
        const bucket = ageBuckets.get(age) as ReportMonthClose[];
        const flow = emptyMutableFlow();
        for (const month of bucket) {
          addFlow(flow, month.flow);
        }
        const first = bucket[0];
        const last = bucket[bucket.length - 1];
        ageGroups.push(
          freeze({
            kind: 'age' as const,
            label: `Age ${age}`,
            age,
            monthCount: bucket.length,
            partial: bucket.length < 12,
            firstYearMonth: first.yearMonth,
            lastYearMonth: last.yearMonth,
            opening: first.opening,
            closing: last.closing,
            flow: finalizeFlow(flow)
          })
        );
      }
    }
  }

  // --- Run-level totals reconciliation -------------------------------------
  const closingRunTotals = months.length === 0 ? openingRunTotals : months[months.length - 1].closing;
  const openingReconciled = sameTotals(run.opening.totals, openingRunTotals);
  const closingMatchesNetWorth = closingRunTotals.netWorthCents === run.totals.closingNetWorthCents;
  const closingMatchesCash = closingRunTotals.accountCents === run.totals.closingCashCents;
  const closingReconciled = closingMatchesNetWorth && closingMatchesCash;
  if (!openingReconciled) {
    diagnostics.push('Opening totals do not reconcile with the opening snapshot.');
  }
  if (!closingReconciled) {
    diagnostics.push(
      `Closing totals do not reconcile: computed cash ${closingRunTotals.accountCents} / net worth ${closingRunTotals.netWorthCents} vs run cash ${run.totals.closingCashCents} / net worth ${run.totals.closingNetWorthCents}.`
    );
  }

  // The per-posting conservation declarations must sum to the reconciled stock
  // change: `Σ monthly net-worth deltas === closing − opening net worth`. Entity
  // reconciliation already covers each account/liability/property; this is the
  // aggregate cross-check that a declared delta can never drift from the stocks.
  const netWorthFromFlow = months.reduce((total, month) => total + month.flow.netWorthDeltaCents, 0);
  const netWorthFromStocks = closingRunTotals.netWorthCents - openingRunTotals.netWorthCents;
  if (netWorthFromFlow !== netWorthFromStocks) {
    diagnostics.push(
      `Summed monthly net-worth deltas (${netWorthFromFlow}) do not equal the closing − opening net worth (${netWorthFromStocks}); the committed conservation declarations and the reconciled stocks disagree.`
    );
  }

  const fundingRows = audit.filter((row) => row.kind === 'funding');
  const directRows = audit.filter((row) => row.kind === 'direct');

  const frozenDiagnostics = freezeList(diagnostics);
  const frozenAudit = freezeList(audit);
  const frozenOutcomes = freezeList(outcomeRows);
  const frozenMonths = freezeList(months);
  const frozenYears = freezeList(years);

  // --- P4.3 pure selectors over the frozen structures ----------------------
  const shortfall = buildShortfall(outcomeRows);
  const exhaustion = buildExhaustion(outcomeRows);
  const fallback = buildFallback(outcomeRows);
  const budgets = buildBudgets(outcomeRows);
  const occurrences = buildOccurrences(run.monthlyCloses);
  const careers = buildCareers(audit);
  const retirement = buildRetirement(outcomeRows);
  const schedules = buildSchedules(outcomeRows, audit, months);
  const finalRevision =
    run.monthlyCloses.length === 0 ? 0 : run.monthlyCloses[run.monthlyCloses.length - 1].snapshot.revision;
  const previews = buildPreviews(run.metadata, months, finalRevision);
  const unverifiable = freezeList([
    'Obligation recurrence specs are not carried by the run; periodKind is derived from observed request cadence and marked unreliable when ambiguous.',
    'Scheduled occurrence ids are not carried by the run; only per-month scheduled/executed counts are available.',
    'Configured career/pay-plan boundaries and dates are not carried by the run; only boundaries observed from actual payroll postings are available.'
  ]);

  const report: ProjectionReport = {
    schemaVersion: REPORTING_SCHEMA_VERSION,
    metadata: metadataOf(run.metadata),
    opening: freeze({
      date: run.opening.date,
      totals: run.opening.totals,
      snapshot: run.opening.snapshot,
      diagnostics: run.opening.diagnostics
    }),
    postingCount: run.postings.length,
    reconciledPostingCount,
    planCount: run.plans.length,
    outcomeCount: run.fundingOutcomes.length,
    audit: frozenAudit,
    fundingRows: freezeList(fundingRows),
    directRows: freezeList(directRows),
    outcomes: frozenOutcomes,
    months: frozenMonths,
    years: frozenYears,
    ...(ageGroups === undefined ? {} : { ageGroups: freezeList(ageGroups) }),
    totals: freeze({
      monthCount: months.length,
      opening: openingRunTotals,
      closing: closingRunTotals,
      openingReconciled,
      closingReconciled,
      reconciled: openingReconciled && closingReconciled
    }),
    diagnostics: frozenDiagnostics,
    unverifiable,
    shortfall,
    exhaustion,
    fallback,
    budgets,
    occurrences,
    careers,
    retirement,
    schedules,
    previews,
    byOccurrence: (occurrenceId) => byOccurrence.get(occurrenceId) ?? EMPTY_ROWS,
    byDefinition: (definitionId) => byDefinition.get(definitionId) ?? EMPTY_ROWS,
    byPurpose: (purpose) => byPurpose.get(purpose) ?? EMPTY_ROWS,
    byAccount: (accountId) => byAccount.get(accountId) ?? EMPTY_ROWS,
    byFundingSource: (accountId) => byFundingSource.get(accountId) ?? EMPTY_ROWS,
    byMonth: (yearMonth) => byMonth.get(yearMonth) ?? EMPTY_ROWS,
    byDateWindow: (from, to) => {
      // A window query must never silently return an empty list for malformed
      // or reversed bounds: both are caller errors, surfaced explicitly.
      if (!isValidDateOnly(from) || !isValidDateOnly(to)) {
        throw new RangeError(
          `byDateWindow requires valid YYYY-MM-DD bounds; received "${String(from)}".."${String(to)}".`
        );
      }
      if (compareDateOnly(from, to) > 0) {
        throw new RangeError(
          `byDateWindow requires an ordered window (from <= to); received "${from}".."${to}".`
        );
      }
      const out: ReportAuditRow[] = [];
      const fromOrdinal = toMonthOrdinal(monthOf(from));
      const toOrdinal = toMonthOrdinal(monthOf(to));
      for (let ordinal = fromOrdinal; ordinal <= toOrdinal; ordinal += 1) {
        const bucket = byMonth.get(fromMonthOrdinal(ordinal));
        if (bucket === undefined) {
          continue;
        }
        for (const row of bucket) {
          if (row.date >= from && row.date <= to) {
            out.push(row);
          }
        }
      }
      return freezeList(out);
    },
    accountCloses: (accountId) => accountCloseIndex.get(accountId) ?? EMPTY_ACCOUNT_CLOSES,
    liabilityCloses: (liabilityId) => liabilityCloseIndex.get(liabilityId) ?? EMPTY_LIABILITY_CLOSES,
    propertyCloses: (propertyId) => propertyCloseIndex.get(propertyId) ?? EMPTY_PROPERTY_CLOSES
  };

  return Object.freeze(report);
};
