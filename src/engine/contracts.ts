/**
 * Runtime funding contracts (engine-internal).
 *
 * Unit rule (RV28 / ADR-010): persisted configuration is dollars; every runtime
 * posting, balance, request and allocation here is an **integer cent** amount.
 * Dollars are converted once at the posting boundary, rounding half away from
 * zero. Rate math uses high-precision/rational intermediates and rounds only at
 * the final posting boundary (ADR-020/ADR-021).
 *
 * Contract authority: P0.3.1 item 11 (funding request/allocation/plan) and
 * ADR-021 (separately rounded gross-based tax/penalty; bounded minimal-gross
 * quote; explicit unsupported-range diagnostics).
 *
 * These are runtime result/audit shapes, not persisted config. The corresponding
 * persisted dollar shapes live in `src/types.ts`.
 */

/** Where a request came from (e.g. 'creditCard', 'housing', 'loan', 'purchase'). */
export type FundingPurpose = string;

/** Outcome of a funding plan: all, some, or none of the requested net was funded. */
export type FundingStatus = 'funded' | 'partial' | 'unfunded';

/**
 * One obligation/occurrence asking for funds in a single month. Ordered funding
 * is primary-first then deduplicated fallbacks. `requestedCents` is the net
 * spending target, before any tax gross-up.
 */
export interface FundingRequest {
  id: string;
  /** Stable occurrence identity (one execution per obligation/occurrence). */
  occurrenceId: string;
  /** Date-only posting date. */
  date: string;
  /** Requested net spending in integer cents. */
  requestedCents: number;
  primaryAccountId: string | null;
  /** Ordered, deduplicated fallback account IDs. */
  fallbackAccountIds: string[];
  purpose: FundingPurpose;
  /**
   * Explicit qualification flag for HSA medical spending. `true` means this
   * request is qualified medical spending and any HSA debit is tax/penalty-free
   * (P0.5.4). This is a first-class field on the request: qualification is
   * **never** inferred from `purpose`, an expense category label, or an account
   * restriction note. Absent/`false` means non-qualified for HSA purposes.
   */
  hsaQualifiedMedical?: boolean;
}

/**
 * Actual funds posted from one account. `grossDebitCents` is the amount pulled
 * from the account; `netFundedCents` is what the obligation received after
 * separately rounded withholding; tax and penalty reduce gross exactly once and
 * are never charged again. Identity: gross = net + tax + penalty.
 */
export interface FundingAllocation {
  accountId: string;
  /** Amount debited from the account, integer cents. */
  grossDebitCents: number;
  /** Net amount applied to the obligation, integer cents. */
  netFundedCents: number;
  /** Income-tax assumption withheld from gross, integer cents (rounded once). */
  withheldTaxCents: number;
  /** Extra penalty withheld from gross, integer cents (rounded once, separate from tax). */
  penaltyCents: number;
  /** Assumed taxable gain share of gross (%) used for this allocation, when applicable. */
  assumedGainPercent?: number;
  /** Editable LTCG rate (%) applied to the assumed gain, when applicable. */
  capitalGainsTaxRatePercent?: number;
}

/**
 * Why a candidate source was not drawn from, captured at quote time. Reporting
 * selects shortfall vs eligible exhaustion (D16) from these recorded reasons
 * instead of re-running eligibility or inferring it from allocations. A policy
 * skip (`unknown-account` / `ineligible-account` / `automatic-fallback-disabled`
 * / `invalid-quota` / `unsupported-tax-range` / `quota-limited`) is **not**
 * exhaustion; `zero-balance` on an otherwise eligible source is the evidence of
 * exhaustion.
 */
export type FundingSkipReason =
  | 'unknown-account'
  | 'ineligible-account'
  | 'automatic-fallback-disabled'
  | 'invalid-quota'
  | 'quota-limited'
  | 'unsupported-tax-range'
  | 'zero-balance';

/**
 * One candidate source the quote did not draw from, with its typed reason. Every
 * unresolved candidate is recorded here (or as an allocation) — a source is
 * never silently skipped.
 */
export interface SkippedFundingSource {
  readonly accountId: string;
  readonly reason: FundingSkipReason;
  readonly message: string;
  /** Tax solver diagnostic code when `reason === 'unsupported-tax-range'`. */
  readonly taxDiagnosticCode?: string;
}

/**
 * Resolved funding plan for one request against one state revision. Aggregate
 * identity: `executedCents = Σ allocations.netFundedCents`; a plan is atomic and
 * committed only through the owner's `commitChanges`; zero-fund/invalid requests
 * debit nothing and remain visibly unfunded.
 */
export interface FundingPlan {
  /** State revision this plan was quoted against; a stale plan is recomputed. */
  stateRevision: number;
  request: FundingRequest;
  allocations: FundingAllocation[];
  /**
   * Ordered, deduplicated candidate account IDs that passed funding-policy
   * eligibility for this request — including a fully pinned retirement list, a
   * quota-capped source and a zero-balance source. Captured at quote time
   * (D16) so eligible exhaustion is selected from actual evidence rather than
   * recomputed from balances later.
   */
  eligibleAccountIds: readonly string[];
  /**
   * The **authoritative** ordered source list the quote actually resolved for
   * this request: the per-obligation override, the global defaults (when the
   * request names no source) or a fully pinned retirement list, deduplicated
   * preserving first position. Captured at quote time (D16) as a first-class
   * runtime field so reporting can name the true primary
   * (`resolvedSourceOrder[0]`) even when `request.primaryAccountId` is `null`
   * because the request deferred to the global policy — without recomputing the
   * order or inferring a primary from `eligibleAccountIds`. Unlike
   * `eligibleAccountIds` this includes positions that were unknown/ineligible
   * policy skips, so the primary identity is never silently reassigned.
   */
  resolvedSourceOrder: readonly string[];
  /** Every candidate not drawn from, with its typed reason (never a silent skip). */
  skippedSources: readonly SkippedFundingSource[];
  /**
   * True when a per-source quota (including a zero quota) actually constrained
   * this quote. A shortfall on a quota-limited plan is a **policy** shortfall,
   * never eligible exhaustion (D16).
   */
  quotaLimited: boolean;
  /** Net cents the configured eligible order could supply (upper bound). */
  feasibleCents: number;
  /** Net cents actually executed. */
  executedCents: number;
  /** Requested minus executed; `requestedCents − executedCents`. */
  shortfallCents: number;
  status: FundingStatus;
}
