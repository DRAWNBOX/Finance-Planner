/**
 * P2.4 — Ordered partial funding and atomic commit preparation (engine-internal).
 *
 * Authority: `refactor/phase2_plan.md` P2.4 + D5 (corrected partial), and
 * `refactor/frozen_contracts.md` P0.3.1 item 6/11, P0.3.3 (funding/partial
 * policy), P0.3.4 (cents rounding), P0.3.6 / P0.5.4 (bounded gross-net),
 * ADR-007, ADR-014, ADR-021.
 *
 * Owns:
 * 1. Primary-first ordered split over the configured list, deduplicated
 *    preserving first position. Per-obligation override / global defaults /
 *    fully pinned retirement ordered list. No pool/type sweep.
 * 2. Strict eligibility (taxes `evaluateAccountEligibility`); unknown or
 *    ineligible sources are skipped with an explicit diagnostic (never masked).
 *    `allowAutomaticFallback === false` removes *automatic fallback* positions
 *    only; every position named by a fully pinned `retirementOrderedList` is
 *    explicit and therefore always eligible.
 * 3. Sparse overlay: every source is capped by the live state balance, is used
 *    at most once, and is never overdrawn. No implicit sweep/borrowing/retry.
 * 4. Actual full/partial/unfunded outcomes. `executedCents = Σ netFundedCents`,
 *    `shortfallCents = requested − executed`. `feasibleCents` is the sum of each
 *    source's maximum net (never `net(balance)`), capped by its per-source quota.
 * 5. Tax + penalty are withheld from gross exactly once; the allocation keeps
 *    `gross = net + tax + penalty`.
 * 6. Every quote records the ordered `eligibleAccountIds` (policy-eligible
 *    candidates, including a pinned retirement list, quota-capped and
 *    zero-balance sources), the typed `skippedSources` (unknown / ineligible /
 *    automatic-fallback-disabled / invalid-quota / quota-limited / unsupported /
 *    zero-balance — never a silent skip) and an explicit `quotaLimited` flag, at
 *    quote time (D16), so shortfall vs eligible exhaustion is selected from
 *    actual evidence without recomputation. It also records the authoritative
 *    `resolvedSourceOrder` (per-obligation override / global defaults / pinned
 *    retirement list, deduplicated) so reporting names the true primary without
 *    inferring it from raw request provenance or `eligibleAccountIds[0]`.
 * 7. `commitFunding` re-quotes a stale plan (when a `requote` hook is given) or
 *    rejects it with an explicit stale result, assembles ONE sparse
 *    `StateChangeSet` (account gross debits + related liability/property/deposit
 *    changes computed from the executed net), requires the true conservation
 *    delta (`−gross` for an external obligation, adjusted by the related change
 *    preparer), stamps the handler's explicit `posting` context (normalized to
 *    the actually executed occurrence on a re-quote), and calls
 *    `state.commitChanges` exactly once. Zero-fund/invalid plans debit nothing;
 *    a nonzero plan without a posting stamp is rejected by the state with
 *    `missing-posting` (no fabricated default).
 *
 * Handoff: quote/commit shapes below are the interface consumed by P2.6/P2.7.
 * `quoteFunding` never mutates state; `commitFunding` mutates only through
 * `state.commitChanges`.
 */

import type { AccountDefinition } from '../types';
import { isValidDateOnly } from './dates';
import type {
  FundingAllocation,
  FundingPlan,
  FundingRequest,
  FundingStatus,
  SkippedFundingSource
} from './contracts';
import type { PostingContext } from './journal';
import type {
  EngineState,
  LiabilityChange,
  PropertyChange,
  StateChangeSet,
  StateError
} from './state';
import {
  TAXABLE_DEFAULT_ASSUMED_GAIN_PERCENT,
  TAXABLE_DEFAULT_CAPITAL_GAINS_TAX_RATE,
  evaluateAccountEligibility,
  quoteWithdrawal
} from './taxes';
import type {
  GrossNetQuote,
  TaxDiagnostic,
  TaxDiagnosticCode,
  WithdrawalAccountConfig,
  WithholdingContext
} from './taxes';

// --- Public options and result shapes ---------------------------------------

/** Purpose string that pins a request to `retirementOrderedList`. */
export const RETIREMENT_FUNDING_PURPOSE = 'retirement';

/** Ordered account funding: primary first, then ordered fallbacks. */
export interface FundingSourceOrder {
  readonly primaryAccountId: string | null;
  readonly fallbackAccountIds: readonly string[];
}

/** Optional quote configuration beyond the positional request/accounts/DOB. */
export interface QuoteFundingOptions {
  /**
   * Per-obligation override keyed by `request.id` (then `request.occurrenceId`).
   * Replaces the request's own primary/fallback order for that obligation.
   */
  readonly perObligationOverride?:
    | ReadonlyMap<string, FundingSourceOrder>
    | Readonly<Record<string, FundingSourceOrder>>
    | null;
  /** Default order used only when the request/override names no source. */
  readonly globalDefaults?: FundingSourceOrder | null;
  /**
   * Fully pinned ordered account list for a retirement request. When supplied
   * (including an explicit empty list) and `request.purpose === 'retirement'`,
   * it replaces the request order entirely.
   */
  readonly retirementOrderedList?: readonly string[] | null;
  /** Per-source maximum net cents this request may draw from each account. */
  readonly perSourceNetQuotaCents?:
    | ReadonlyMap<string, number>
    | Readonly<Record<string, number>>
    | null;
}

/** Non-fatal quote note; never changes math, only makes a case explicit. */
export type FundingDiagnosticCode =
  | 'invalid-request'
  | 'negative-request'
  | 'unsafe-request'
  | 'invalid-quota'
  | 'empty-source-order'
  | 'unknown-account'
  | 'ineligible-account'
  | 'unsupported-tax-range';

export interface FundingDiagnostic {
  readonly code: FundingDiagnosticCode;
  readonly message: string;
  readonly accountId?: string;
  /** Present when the diagnostic originates in the taxes solver. */
  readonly taxDiagnosticCode?: TaxDiagnosticCode;
}

/**
 * `ok: false` is reserved for a request that cannot be quoted at all (invalid
 * amount/date). Source-level problems are explicit diagnostics on `ok: true`.
 */
export type FundingQuoteResult =
  | {
      readonly ok: true;
      readonly plan: FundingPlan;
      readonly diagnostics: readonly FundingDiagnostic[];
    }
  | { readonly ok: false; readonly diagnostic: FundingDiagnostic };

// --- Related change preparation ---------------------------------------------

/**
 * Related (non-cash) changes produced by executing a funding plan. Computed from
 * the **executed** net — never the desired payment, never a stale quote.
 */
export interface RelatedFundingChanges {
  readonly liabilityChanges?: readonly LiabilityChange[];
  readonly propertyChanges?: readonly PropertyChange[];
  /**
   * Net-worth adjustment contributed by these changes:
   * `ΔheldDeposit + ΔpropertyValue − Δliability`. The full commit delta is
   * `−grossDebit + netWorthAdjustmentCents` (external obligation → `0`).
   */
  readonly netWorthAdjustmentCents: number;
}

export interface RelatedFundingContext {
  readonly request: FundingRequest;
  readonly plan: FundingPlan;
  /** Net cents actually executed (`Σ allocations.netFundedCents`). */
  readonly executedNetCents: number;
  /** Gross cents actually debited (`Σ allocations.grossDebitCents`). */
  readonly grossDebitCents: number;
}

export type RelatedChangePreparer = (context: RelatedFundingContext) => RelatedFundingChanges | null;

/** Options for {@link commitFunding}; a bare function is treated as a preparer. */
export interface CommitFundingOptions {
  readonly prepareRelatedChanges?: RelatedChangePreparer;
  /**
   * Re-quote hook invoked when the supplied plan is stale. It must return a plan
   * quoted against the current state revision. Without it a stale plan is
   * rejected with an explicit stale result.
   */
  readonly requote?: (state: EngineState) => FundingQuoteResult;
  /**
   * Explicit D15 posting provenance from the executing handler (phase +
   * definitionId + purpose + date + occurrenceId). It is attached to the
   * committed {@link StateChangeSet}; on a stale-plan re-quote the occurrence is
   * normalized to the **actually executed** plan occurrence. When omitted, a
   * nonzero plan is rejected by the state with `missing-posting` and no mutation
   * — no default stamp is ever fabricated.
   */
  readonly posting?: PostingContext;
}

export type CommitFundingInput = RelatedChangePreparer | CommitFundingOptions | null | undefined;

export type FundingCommitErrorCode =
  | 'stale-plan'
  | 'zero-fund'
  | 'invalid-plan'
  | 'missing-posting'
  | 'commit-rejected';

export interface FundingCommitError {
  readonly code: FundingCommitErrorCode;
  readonly message: string;
  /** Underlying state rejections, when the commit itself was refused. */
  readonly stateErrors?: readonly StateError[];
}

export interface FundingCommitResult {
  readonly committed: boolean;
  /** Effective plan committed (possibly re-quoted); `null` when none. */
  readonly plan: FundingPlan | null;
  /** True when the supplied plan's revision did not match state. */
  readonly stale: boolean;
  /** State revision after the attempt (unchanged when rejected). */
  readonly revision: number;
  readonly errors: readonly FundingCommitError[];
}

// --- Small helpers -----------------------------------------------------------

const isMap = <T>(value: unknown): value is ReadonlyMap<string, T> =>
  typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function';

const toMap = <T>(
  value: ReadonlyMap<string, T> | Readonly<Record<string, T>> | null | undefined
): Map<string, T> => {
  const map = new Map<string, T>();
  if (value === null || value === undefined) {
    return map;
  }
  if (isMap<T>(value)) {
    for (const [key, entry] of value) {
      map.set(key, entry);
    }
    return map;
  }
  for (const [key, entry] of Object.entries(value as Readonly<Record<string, T>>)) {
    map.set(key, entry);
  }
  return map;
};

const normalizeAccounts = (
  configs: readonly AccountDefinition[] | ReadonlyMap<string, AccountDefinition>
): Map<string, AccountDefinition> => {
  const map = new Map<string, AccountDefinition>();
  if (isMap<AccountDefinition>(configs)) {
    for (const [id, account] of configs) {
      if (!map.has(id)) {
        map.set(id, account);
      }
    }
    return map;
  }
  for (const account of configs as readonly AccountDefinition[]) {
    if (!map.has(account.id)) {
      map.set(account.id, account);
    }
  }
  return map;
};

/** Dedupe account IDs preserving first position; drop null/empty entries. */
const dedupeOrder = (raw: readonly (string | null | undefined)[]): string[] => {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    order.push(id);
  }
  return order;
};

const toWithdrawalAccountConfig = (account: AccountDefinition): WithdrawalAccountConfig => {
  const policy = account.withdrawalPolicy;
  return {
    accountType: account.accountType,
    withdrawalPolicy: policy
      ? {
          withdrawalTaxRate: policy.withdrawalTaxRate,
          penaltyRate: policy.penaltyRate,
          hsa: policy.hsa ?? null
        }
      : null,
    assumedGainPercent: account.assumedGainPercent,
    capitalGainsTaxRate: account.capitalGainsTaxRate
  };
};

const makeAllocation = (
  accountId: string,
  quote: GrossNetQuote,
  account: AccountDefinition
): FundingAllocation => {
  const base: FundingAllocation = {
    accountId,
    grossDebitCents: quote.grossCents,
    netFundedCents: quote.netCents,
    withheldTaxCents: quote.taxCents,
    penaltyCents: quote.penaltyCents
  };
  if (account.accountType === 'taxable') {
    return {
      ...base,
      assumedGainPercent: account.assumedGainPercent ?? TAXABLE_DEFAULT_ASSUMED_GAIN_PERCENT,
      capitalGainsTaxRatePercent: account.capitalGainsTaxRate ?? TAXABLE_DEFAULT_CAPITAL_GAINS_TAX_RATE
    };
  }
  return base;
};

const unsupportedDiagnostic = (diagnostic: TaxDiagnostic, accountId: string): FundingDiagnostic => ({
  code: 'unsupported-tax-range',
  accountId,
  taxDiagnosticCode: diagnostic.code,
  message: `Account "${accountId}" cannot be quoted: ${diagnostic.code} — ${diagnostic.message}`
});

/**
 * Maximum net a single source can supply at `balanceCents`. Requesting the whole
 * balance forces the funded path to fail whenever withholding exists, so the
 * solver returns the true maximum net at the cap (never `net(balance)`).
 */
const maximumNetAtBalance = (
  account: WithdrawalAccountConfig,
  request: Pick<FundingRequest, 'hsaQualifiedMedical'>,
  context: WithholdingContext,
  balanceCents: number
):
  | { readonly ok: true; readonly netCents: number }
  | { readonly ok: false; readonly diagnostic: TaxDiagnostic } => {
  if (balanceCents <= 0) {
    return { ok: true, netCents: 0 };
  }
  const result = quoteWithdrawal({
    account,
    request,
    context,
    requestedNetCents: balanceCents,
    availableBalanceCents: balanceCents
  });
  if (result.status === 'unsupported') {
    return { ok: false, diagnostic: result.diagnostic };
  }
  return { ok: true, netCents: result.netCents };
};

interface ResolvedSourceOrder {
  readonly order: readonly string[];
  /**
   * True when every position in `order` was explicitly pinned (a retirement
   * ordered list). Such positions are never *automatic* fallbacks, so
   * `allowAutomaticFallback === false` must not exclude any of them.
   */
  readonly allExplicit: boolean;
}

const resolveSourceOrder = (
  request: FundingRequest,
  overrides: Map<string, FundingSourceOrder>,
  globalDefaults: FundingSourceOrder | null | undefined,
  retirementOrderedList: readonly string[] | null | undefined,
  diagnostics: FundingDiagnostic[]
): ResolvedSourceOrder => {
  const retirement = request.purpose === RETIREMENT_FUNDING_PURPOSE;
  const override = overrides.get(request.id) ?? overrides.get(request.occurrenceId) ?? null;

  let raw: readonly (string | null | undefined)[];
  let allExplicit = false;
  if (retirement && retirementOrderedList !== null && retirementOrderedList !== undefined) {
    // Retirement is fully pinned by its explicit list (an explicit empty list
    // resolves to no sources rather than the generic request order). Because the
    // caller names every position, none is an automatic fallback.
    raw = retirementOrderedList;
    allExplicit = true;
  } else if (override) {
    raw = [override.primaryAccountId, ...override.fallbackAccountIds];
  } else {
    raw = [request.primaryAccountId, ...request.fallbackAccountIds];
  }

  let order = dedupeOrder(raw);
  if (order.length === 0 && !retirement && globalDefaults) {
    order = dedupeOrder([globalDefaults.primaryAccountId, ...globalDefaults.fallbackAccountIds]);
  }
  if (order.length === 0) {
    diagnostics.push({
      code: 'empty-source-order',
      message: `Request "${request.id}" resolved to no funding source; obligation is visibly unresolved.`
    });
  }
  return { order, allExplicit };
};

// --- Quote -------------------------------------------------------------------

/**
 * Pure quote of a single {@link FundingRequest} against the current state.
 * Stamps `plan.stateRevision` with `state.getRevision()` and never mutates.
 */
export const quoteFunding = (
  state: EngineState,
  request: FundingRequest,
  accountConfigs: readonly AccountDefinition[] | ReadonlyMap<string, AccountDefinition>,
  dateOfBirth: string | null | undefined,
  options: QuoteFundingOptions = {}
): FundingQuoteResult => {
  if (typeof request.requestedCents !== 'number' || !Number.isSafeInteger(request.requestedCents)) {
    return {
      ok: false,
      diagnostic: {
        code: 'unsafe-request',
        message: `Requested net must be a safe integer cent amount; received ${String(request.requestedCents)}.`
      }
    };
  }
  if (request.requestedCents < 0) {
    return {
      ok: false,
      diagnostic: {
        code: 'negative-request',
        message: `Requested net must be nonnegative; received ${request.requestedCents}.`
      }
    };
  }
  if (!isValidDateOnly(request.date)) {
    return {
      ok: false,
      diagnostic: {
        code: 'invalid-request',
        message: `Request "${request.id}" has an invalid date-only posting date "${request.date}".`
      }
    };
  }

  const diagnostics: FundingDiagnostic[] = [];
  const accounts = normalizeAccounts(accountConfigs);
  const overrides = toMap(options.perObligationOverride ?? null);
  const quotas = toMap(options.perSourceNetQuotaCents ?? null);
  const { order, allExplicit } = resolveSourceOrder(
    request,
    overrides,
    options.globalDefaults,
    options.retirementOrderedList,
    diagnostics
  );

  const context: WithholdingContext = { withdrawalDate: request.date, dateOfBirth: dateOfBirth ?? null };
  const requestFlags = { hsaQualifiedMedical: request.hsaQualifiedMedical };

  const allocations: FundingAllocation[] = [];
  const eligibleAccountIds: string[] = [];
  const skippedSources: SkippedFundingSource[] = [];
  let executedCents = 0;
  let feasibleCents = 0;
  let quotaLimited = false;

  const skip = (accountId: string, reason: SkippedFundingSource['reason'], message: string): void => {
    skippedSources.push({ accountId, reason, message });
  };

  for (let index = 0; index < order.length; index += 1) {
    const accountId = order[index];
    const account = accounts.get(accountId);
    if (!account) {
      const message = `Funding source "${accountId}" is not configured; skipped.`;
      diagnostics.push({ code: 'unknown-account', accountId, message });
      skip(accountId, 'unknown-account', message);
      continue;
    }

    const eligibility = evaluateAccountEligibility({ accountType: account.accountType }, requestFlags);
    if (!eligibility.eligible) {
      const message = `Funding source "${accountId}" (${account.accountType}) is not eligible for this request.`;
      diagnostics.push({ code: 'ineligible-account', accountId, message });
      skip(accountId, 'ineligible-account', message);
      continue;
    }
    // Only automatic *fallbacks* honor the flag; an explicit primary — or any
    // position in a fully pinned retirement list — is always eligible.
    if (!allExplicit && index > 0 && account.withdrawalPolicy?.allowAutomaticFallback === false) {
      skip(
        accountId,
        'automatic-fallback-disabled',
        `Funding source "${accountId}" is not allowed as an automatic fallback; skipped.`
      );
      continue;
    }

    const config = toWithdrawalAccountConfig(account);

    let quotaCents: number | null = null;
    if (quotas.has(accountId)) {
      const rawQuota = quotas.get(accountId) as number;
      if (!Number.isSafeInteger(rawQuota) || rawQuota < 0) {
        const message = `Per-source net quota for "${accountId}" must be a nonnegative safe integer; received ${String(rawQuota)}.`;
        diagnostics.push({ code: 'invalid-quota', accountId, message });
        skip(accountId, 'invalid-quota', message);
        continue;
      }
      quotaCents = rawQuota;
    }

    const balanceCents = state.getAccountBalanceCents(accountId) ?? 0;

    // Feasible upper bound: this source's maximum net at its live balance, capped
    // by its quota. Never `net(balance)`. A zero balance is valid (net 0).
    const maximum = maximumNetAtBalance(config, requestFlags, context, balanceCents);
    if (!maximum.ok) {
      const diagnostic = unsupportedDiagnostic(maximum.diagnostic, accountId);
      diagnostics.push(diagnostic);
      skippedSources.push({
        accountId,
        reason: 'unsupported-tax-range',
        message: diagnostic.message,
        taxDiagnosticCode: maximum.diagnostic.code
      });
      continue;
    }

    // Passed funding-policy eligibility and is quoteable: record the ordered
    // eligible source (D16 evidence, incl a pinned retirement list, quota-capped
    // and zero-balance positions).
    eligibleAccountIds.push(accountId);
    feasibleCents += quotaCents === null ? maximum.netCents : Math.min(quotaCents, maximum.netCents);

    if (balanceCents <= 0) {
      skip(
        accountId,
        'zero-balance',
        `Funding source "${accountId}" has no available balance; skipped.`
      );
      continue;
    }

    const remaining = request.requestedCents - executedCents;
    if (remaining <= 0) {
      continue;
    }
    const targetCents = quotaCents === null ? remaining : Math.min(remaining, quotaCents);
    if (targetCents <= 0) {
      // A zero per-source quota caps this eligible source at nothing; that is a
      // policy limit, never eligible exhaustion.
      if (quotaCents !== null && quotaCents === 0) {
        quotaLimited = true;
        skip(
          accountId,
          'quota-limited',
          `Funding source "${accountId}" is capped at a zero per-source quota; skipped.`
        );
      }
      continue;
    }

    const result = quoteWithdrawal({
      account: config,
      request: requestFlags,
      context,
      requestedNetCents: targetCents,
      availableBalanceCents: balanceCents
    });
    if (result.status === 'unsupported') {
      const diagnostic = unsupportedDiagnostic(result.diagnostic, accountId);
      diagnostics.push(diagnostic);
      skippedSources.push({
        accountId,
        reason: 'unsupported-tax-range',
        message: diagnostic.message,
        taxDiagnosticCode: result.diagnostic.code
      });
      continue;
    }
    if (result.status === 'unfunded' || result.netCents <= 0) {
      skip(
        accountId,
        'zero-balance',
        `Funding source "${accountId}" could supply no net at its available balance; skipped.`
      );
      continue;
    }

    // The quota constrained this draw: it needed more than the cap and the
    // source supplied exactly the cap (not its balance). Policy, not exhaustion.
    if (quotaCents !== null && quotaCents < remaining && result.netCents >= quotaCents) {
      quotaLimited = true;
    }

    allocations.push(makeAllocation(accountId, result, account));
    executedCents += result.netCents;
  }

  const shortfallCents = Math.max(0, request.requestedCents - executedCents);
  const status: FundingStatus =
    executedCents >= request.requestedCents ? 'funded' : executedCents > 0 ? 'partial' : 'unfunded';

  const plan: FundingPlan = {
    stateRevision: state.getRevision(),
    request,
    allocations,
    eligibleAccountIds,
    // The authoritative resolved order (override / global defaults / pinned
    // retirement list), captured verbatim so reporting names the true primary
    // rather than inferring it from raw request provenance. `order` is already
    // deduplicated and is never mutated after this point; freeze it so a
    // consumer cannot alter the plan's recorded source order.
    resolvedSourceOrder: Object.freeze([...order]),
    skippedSources,
    quotaLimited,
    feasibleCents,
    executedCents,
    shortfallCents,
    status
  };

  return { ok: true, plan, diagnostics };
};

// --- Commit preparation ------------------------------------------------------

/** Successful plan validation: recomputed gross debit / executed net totals. */
export interface FundingPlanValidation {
  readonly ok: true;
  readonly grossDebitCents: number;
  readonly netExecutedCents: number;
}

export type FundingPlanValidationResult =
  | FundingPlanValidation
  | { readonly ok: false; readonly message: string };

const safeAdd = (a: number, b: number): number | null => {
  const total = a + b;
  return Number.isSafeInteger(total) ? total : null;
};

/**
 * Validates a plan's internal identities before any mutation: unique accounts,
 * nonnegative safe cents, `gross = net + tax + penalty` per allocation, and
 * `executedCents`/`shortfallCents` reconciling with the request.
 */
export const validateFundingPlan = (plan: FundingPlan): FundingPlanValidationResult => {
  const seen = new Set<string>();
  let grossDebitCents = 0;
  let netExecutedCents = 0;

  for (const allocation of plan.allocations) {
    if (seen.has(allocation.accountId)) {
      return { ok: false, message: `Plan allocates account "${allocation.accountId}" more than once.` };
    }
    seen.add(allocation.accountId);
    if (!Number.isSafeInteger(allocation.grossDebitCents) || allocation.grossDebitCents < 0) {
      return { ok: false, message: `Allocation for "${allocation.accountId}" has an invalid gross debit.` };
    }
    if (!Number.isSafeInteger(allocation.netFundedCents) || allocation.netFundedCents < 0) {
      return { ok: false, message: `Allocation for "${allocation.accountId}" has an invalid net funded amount.` };
    }
    if (!Number.isSafeInteger(allocation.withheldTaxCents) || allocation.withheldTaxCents < 0) {
      return { ok: false, message: `Allocation for "${allocation.accountId}" has an invalid tax amount.` };
    }
    if (!Number.isSafeInteger(allocation.penaltyCents) || allocation.penaltyCents < 0) {
      return { ok: false, message: `Allocation for "${allocation.accountId}" has an invalid penalty amount.` };
    }
    if (
      allocation.grossDebitCents !==
      allocation.netFundedCents + allocation.withheldTaxCents + allocation.penaltyCents
    ) {
      return {
        ok: false,
        message: `Allocation for "${allocation.accountId}" violates gross = net + tax + penalty.`
      };
    }
    const nextGross = safeAdd(grossDebitCents, allocation.grossDebitCents);
    const nextNet = safeAdd(netExecutedCents, allocation.netFundedCents);
    if (nextGross === null || nextNet === null) {
      return { ok: false, message: 'Plan allocations overflow the safe integer cent range.' };
    }
    grossDebitCents = nextGross;
    netExecutedCents = nextNet;
  }

  if (netExecutedCents !== plan.executedCents) {
    return {
      ok: false,
      message: `plan.executedCents ${plan.executedCents} does not equal Σ netFundedCents ${netExecutedCents}.`
    };
  }
  const expectedShortfall = Math.max(0, plan.request.requestedCents - netExecutedCents);
  if (plan.shortfallCents !== expectedShortfall) {
    return {
      ok: false,
      message: `plan.shortfallCents ${plan.shortfallCents} does not equal requested − executed ${expectedShortfall}.`
    };
  }

  return { ok: true, grossDebitCents, netExecutedCents };
};

/**
 * Assembles the **single sparse** change set for a plan: one account gross debit
 * per allocation plus any related liability/property/deposit changes, and the
 * true conservation delta (`−grossDebit + relatedNetWorthAdjustment`).
 *
 * When `posting` is supplied it is attached verbatim (D15) so the state journals
 * the commit under that provenance; when it is omitted the change set carries no
 * stamp and the state rejects a meaningful commit with `missing-posting` — no
 * default stamp is fabricated.
 */
export const buildFundingChangeSet = (
  plan: FundingPlan,
  related?: RelatedFundingChanges | null,
  posting?: PostingContext
): StateChangeSet => {
  const accountChanges = plan.allocations.map((allocation) => ({
    accountId: allocation.accountId,
    deltaCents: -allocation.grossDebitCents
  }));
  let grossDebitCents = 0;
  for (const allocation of plan.allocations) {
    grossDebitCents += allocation.grossDebitCents;
  }

  return {
    revision: plan.stateRevision,
    ...(posting === undefined ? {} : { posting }),
    ...(accountChanges.length > 0 ? { accountChanges } : {}),
    ...(related?.liabilityChanges && related.liabilityChanges.length > 0
      ? { liabilityChanges: related.liabilityChanges }
      : {}),
    ...(related?.propertyChanges && related.propertyChanges.length > 0
      ? { propertyChanges: related.propertyChanges }
      : {}),
    expectedNetWorthDeltaCents: -grossDebitCents + (related?.netWorthAdjustmentCents ?? 0)
  };
};

const normalizeCommitInput = (input: CommitFundingInput): CommitFundingOptions => {
  if (!input) {
    return {};
  }
  if (typeof input === 'function') {
    return { prepareRelatedChanges: input };
  }
  return input;
};

/**
 * Commits a funding plan atomically.
 *
 * - A stale plan (revision mismatch) is re-quoted via `options.requote` or
 *   rejected with an explicit `stale-plan` result. A re-quoted plan is stamped
 *   with the **actually executed** occurrence (`effectivePlan.request.occurrenceId`),
 *   not the stale one.
 * - A zero-fund or invalid plan debits nothing.
 * - Otherwise one sparse {@link StateChangeSet} is built (account gross debits +
 *   related liability/property/deposit changes from the *executed* net) and
 *   `state.commitChanges` is called exactly once. The related preparer declares
 *   the net-worth adjustment; the conservation declaration is
 *   `−grossDebit + adjustment`.
 * - A nonzero plan without `options.posting` is rejected by the state with
 *   `missing-posting` (no mutation, no fabricated default), surfaced here as a
 *   `missing-posting` error carrying the state rejection.
 */
export const commitFunding = (
  state: EngineState,
  plan: FundingPlan,
  input?: CommitFundingInput
): FundingCommitResult => {
  const options = normalizeCommitInput(input);
  const currentRevision = state.getRevision();
  let effectivePlan = plan;
  let stale = false;

  if (plan.stateRevision !== currentRevision) {
    stale = true;
    if (!options.requote) {
      return {
        committed: false,
        plan,
        stale: true,
        revision: currentRevision,
        errors: [
          {
            code: 'stale-plan',
            message: `Plan was quoted at revision ${plan.stateRevision} but state is at revision ${currentRevision}.`
          }
        ]
      };
    }
    const requoted = options.requote(state);
    if (!requoted.ok) {
      return {
        committed: false,
        plan: null,
        stale: true,
        revision: currentRevision,
        errors: [
          {
            code: 'invalid-plan',
            message: `Stale-plan re-quote failed: ${requoted.diagnostic.message}`
          }
        ]
      };
    }
    effectivePlan = requoted.plan;
    if (effectivePlan.stateRevision !== currentRevision) {
      return {
        committed: false,
        plan: effectivePlan,
        stale: true,
        revision: currentRevision,
        errors: [
          {
            code: 'stale-plan',
            message: `Re-quoted plan is still stale (revision ${effectivePlan.stateRevision} vs ${currentRevision}).`
          }
        ]
      };
    }
  }

  const validation = validateFundingPlan(effectivePlan);
  if (!validation.ok) {
    return {
      committed: false,
      plan: effectivePlan,
      stale,
      revision: currentRevision,
      errors: [{ code: 'invalid-plan', message: validation.message }]
    };
  }

  if (effectivePlan.executedCents <= 0 || effectivePlan.allocations.length === 0) {
    // P0.3.3 item 5: zero-fund debits nothing and stays visibly unfunded.
    return {
      committed: false,
      plan: effectivePlan,
      stale,
      revision: currentRevision,
      errors: [{ code: 'zero-fund', message: 'Plan executed no net funds; nothing was debited.' }]
    };
  }

  const related = options.prepareRelatedChanges
    ? options.prepareRelatedChanges({
        request: effectivePlan.request,
        plan: effectivePlan,
        executedNetCents: validation.netExecutedCents,
        grossDebitCents: validation.grossDebitCents
      })
    : null;

  // Stamp the executed occurrence. `options.posting` is the handler's explicit
  // provenance; its occurrence is normalized to the actually executed plan
  // occurrence so a re-quoted plan still journals against the real execution.
  // With no supplied stamp the change set is unstamped and the state rejects a
  // nonzero commit with `missing-posting` — no default is fabricated.
  const effectivePosting: PostingContext | undefined =
    options.posting === undefined
      ? undefined
      : { ...options.posting, occurrenceId: effectivePlan.request.occurrenceId };

  const changeSet = buildFundingChangeSet(effectivePlan, related, effectivePosting);
  const result = state.commitChanges(changeSet);
  if (!result.committed) {
    const missingPosting = result.errors.some((error) => error.code === 'missing-posting');
    return {
      committed: false,
      plan: effectivePlan,
      stale,
      revision: result.revision,
      errors: [
        missingPosting
          ? {
              code: 'missing-posting',
              message:
                'A posting context is required to commit a nonzero funding plan; no mutation was applied.',
              stateErrors: result.errors
            }
          : {
              code: 'commit-rejected',
              message: 'State rejected the funding change set; no mutation was applied.',
              stateErrors: result.errors
            }
      ]
    };
  }

  return { committed: true, plan: effectivePlan, stale, revision: result.revision, errors: [] };
};
