/**
 * P3D.3 — Headless loan/mortgage accrual and installment processor (O).
 *
 * Authority: `refactor/phase3_plan.md` Stream D (P3D.3), decision **D13**
 * (confirmed): debt accrues monthly at the **nominal** `APR / 12` via
 * `valuation.quoteDebtMonthlyAccrual`; the required installment for amortizing
 * debt is `max(standard amortized payment over the remaining term, configured
 * minimumMonthlyPayment)`, capped at the outstanding debt, with **no
 * undocumented lower-rate clamp**; a funded payment is allocated **interest
 * first, then principal**; unpaid interest/principal is retained and reported;
 * no fabricated fees/proceeds. CA05 (and the loan half of CA06) are the
 * acceptance fixtures.
 *
 * This module owns **only** the loan/mortgage feature processor. It:
 *
 * 1. Reads the timeline's canonical observed liabilities from
 *    `context.liabilities` / `context.getLiability()` — never the legacy
 *    `Loan.currentBalance` scalar. `state.getLiability(id)` is the runtime
 *    authority for the live debt (principal + accrued interest), so an observed
 *    opening debt (including an observed `0`) always wins.
 * 2. Emits {@link EventDefinition}s in the frozen phases: `accrual` (contractual
 *    interest, before income) → `mandatory` (required installment) →
 *    `discretionary` (extra payment). A one-time, account-funded down payment
 *    request is separate and fires at most once.
 * 3. Executes only through `state.commitChanges` (accrual) or
 *    `quoteFunding`/`commitFunding` (payments), namespaced `loan:<id>`.
 *
 * ### Liability linkage (`sourceConfigId`)
 *
 * The canonical link from a legacy `Loan` config to a `LiabilityDefinition` is
 * `LiabilityDefinition.sourceConfigId` (`src/types.ts:459`). The compiled context
 * threads that field onto {@link CompiledLiability} and
 * `getLiability(loan.id)` resolves **identity first, then a unique
 * `sourceConfigId` link** (`configuration.ts`), so a liability whose own id
 * differs from the loan id is still found. {@link resolveLoanLiabilityId}
 * therefore returns the resolved `CompiledLiability.liabilityId` — never the
 * raw `loan.id` — so the runtime `state.getLiability(id)` lookup always hits the
 * actual debt. A `sourceConfigId` shared by two liabilities is an ambiguous link
 * and stays **unresolved** (the context does not index it), so no money moves;
 * the context reports the duplicate and this module surfaces an
 * `unknown-liability` skip. An explicit
 * {@link LoanProcessorOptions.liabilityIdForLoan} override remains available.
 *
 * ### Single ownership (no mortgage double-count)
 *
 * Only liabilities reachable from `context.domains.loans` are processed. A
 * liability linked to a property (`linkedPropertyId !== null`) is owned by the
 * housing/property stream (P3H) and is skipped here, so a mortgage is never
 * accrued/paid twice.
 *
 * This module mutates nothing directly, reads no wall clock, and holds no state.
 */

import type { Loan } from '../types';
import type { CompiledLiability, CompiledScenarioContext } from './configuration';
import type { FundingPurpose, FundingRequest } from './contracts';
import { commitFunding, quoteFunding, type CommitFundingOptions } from './funding';
import type { PostingContext } from './journal';
import { dollarsToCents, roundHalfAwayFromZero, type Cents } from './money';
import {
  compareDateOnly,
  daysInMonth,
  endOfMonthDate,
  isValidYearMonth,
  parseYearMonth,
  toMonthOrdinal,
  type DateOnly,
  type YearMonth
} from './dates';
import type { EventDefinition, EventExecutionContext } from './scheduler';
import type {
  ProjectionEventHandler,
  ProjectionExecutionResult,
  ProjectionHandlerDependencies,
  ProjectionHandlerFactory
} from './projection';
import { monthFractionForDates, quoteDebtMonthlyAccrual } from './valuation';

// ---------------------------------------------------------------------------
// Public identity / namespace
// ---------------------------------------------------------------------------

/** Handler ids consumed by the `projection.ts` facade (`event.handlerId`). */
export const LOAN_ACCRUAL_HANDLER_ID = 'loanAccrual';
export const LOAN_INSTALLMENT_HANDLER_ID = 'loanInstallment';
export const LOAN_EXTRA_HANDLER_ID = 'loanExtra';
export const LOAN_DOWN_PAYMENT_HANDLER_ID = 'loanDownPayment';

/** Stable funding/audit purposes (never a legacy pool string). */
export const LOAN_ACCRUAL_PURPOSE = 'debtInterestAccrual';
export const LOAN_INSTALLMENT_PURPOSE = 'loanInstallment';
export const LOAN_EXTRA_PURPOSE = 'loanExtraPayment';
export const LOAN_DOWN_PAYMENT_PURPOSE = 'loanDownPayment';

/** The four loan occurrences. */
export type LoanEventKind = 'accrual' | 'installment' | 'extra' | 'downPayment';

/** All loan occurrence kinds, in declaration order. */
export const LOAN_EVENT_KINDS: readonly LoanEventKind[] = Object.freeze([
  'accrual',
  'installment',
  'extra',
  'downPayment'
]);

/** Namespaced stable occurrence definition id: `loan:<loanId>:<kind>`. */
export const loanDefinitionId = (loanId: string, kind: LoanEventKind): string => `loan:${loanId}:${kind}`;

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type LoanProcessorDiagnosticCode =
  | 'invalid-terms'
  | 'unknown-liability'
  | 'housing-owned'
  | 'missed-payment'
  | 'unapplied-excess';

/** A non-fatal loan-processor note. Never changes the payment math. */
export interface LoanProcessorDiagnostic {
  readonly code: LoanProcessorDiagnosticCode;
  /** Present for loan-specific notes; absent for a pure quote validation failure. */
  readonly loanId?: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Amortized installment quote (independently testable PMT)
// ---------------------------------------------------------------------------

/** Inputs for the standard amortized installment over the remaining term. */
export interface LoanInstallmentTerms {
  /** Outstanding principal, integer cents (`>= 0`). */
  readonly principalCents: number;
  /** Accrued-but-unpaid interest, integer cents (`>= 0`). Default `0`. */
  readonly accruedInterestCents?: number;
  /** Accrued fees, integer cents (`>= 0`). Default `0`. */
  readonly feesCents?: number;
  /** Nominal annual rate as a fraction (`0.065` for `6.5%`). */
  readonly annualRate: number;
  /**
   * Remaining scheduled payments, inclusive of the current month (`>= 1`), or
   * `null` when the loan has no configured end month. With `null` there is no
   * amortization term, so the standard amortized payment is `0` and the
   * configured minimum governs (documented; never a hidden rate clamp).
   */
  readonly remainingMonths: number | null;
  /** Configured minimum monthly payment, integer cents (`>= 0`). Default `0`. */
  readonly minimumPaymentCents?: number;
}

export interface LoanInstallmentQuote {
  /** `principal + accrued interest + fees`. */
  readonly outstandingCents: number;
  /** Nominal monthly rate `annualRate / 12` (not compounded). */
  readonly monthlyRate: number;
  readonly remainingMonths: number | null;
  /** Independently computable standard amortized payment, integer cents. */
  readonly standardPaymentCents: number;
  readonly minimumPaymentCents: number;
  /** `min(max(standardPaymentCents, minimumPaymentCents), outstandingCents)`. */
  readonly requiredCents: number;
}

export type LoanInstallmentResult =
  | { readonly ok: true; readonly quote: LoanInstallmentQuote }
  | { readonly ok: false; readonly diagnostic: LoanProcessorDiagnostic };

const loanFail = (message: string): LoanInstallmentResult => ({
  ok: false,
  diagnostic: { code: 'invalid-terms', message }
});

const isNonNegativeSafeCents = (value: number): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Quotes the required installment for an amortizing liability.
 *
 * - Standard amortized payment: `P·r / (1 − (1+r)^−n)` with `r = APR/12` and
 *   `n` the remaining inclusive payments; `P/n` when `r === 0`.
 * - Required: `max(standard, minimum)` **capped at the outstanding debt**.
 *
 * Pure: no mutation, no wall clock, single half-away-from-zero rounding.
 */
export const quoteLoanInstallment = (terms: LoanInstallmentTerms): LoanInstallmentResult => {
  const principalCents = terms.principalCents;
  const accruedInterestCents = terms.accruedInterestCents ?? 0;
  const feesCents = terms.feesCents ?? 0;
  const minimumPaymentCents = terms.minimumPaymentCents ?? 0;

  if (
    !isNonNegativeSafeCents(principalCents) ||
    !isNonNegativeSafeCents(accruedInterestCents) ||
    !isNonNegativeSafeCents(feesCents) ||
    !isNonNegativeSafeCents(minimumPaymentCents)
  ) {
    return loanFail('Loan installment terms must be nonnegative safe integer cent amounts.');
  }
  if (typeof terms.annualRate !== 'number' || !Number.isFinite(terms.annualRate) || terms.annualRate < 0) {
    return loanFail(`Loan APR must be finite and >= 0% (nominal); received ${String(terms.annualRate)}.`);
  }

  const outstandingCents = principalCents + accruedInterestCents + feesCents;
  if (!Number.isSafeInteger(outstandingCents)) {
    return loanFail('Loan outstanding debt exceeds the safe integer cent range.');
  }

  const monthlyRate = terms.annualRate / 12;
  let standard = 0;
  if (terms.remainingMonths !== null) {
    if (!Number.isSafeInteger(terms.remainingMonths) || terms.remainingMonths < 1) {
      return loanFail(`Loan remaining months must be a positive integer; received ${String(terms.remainingMonths)}.`);
    }
    const n = terms.remainingMonths;
    standard =
      monthlyRate === 0 ? principalCents / n : (principalCents * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));
  }

  const standardPaymentCents = roundHalfAwayFromZero(standard);
  if (!Number.isSafeInteger(standardPaymentCents) || standardPaymentCents < 0) {
    return loanFail('Loan standard amortized payment is outside the safe integer cent range.');
  }

  const requiredCents = Math.min(Math.max(standardPaymentCents, minimumPaymentCents), outstandingCents);
  return {
    ok: true,
    quote: {
      outstandingCents,
      monthlyRate,
      remainingMonths: terms.remainingMonths,
      standardPaymentCents,
      minimumPaymentCents,
      requiredCents
    }
  };
};

/**
 * Remaining scheduled installments from `yearMonth` through `endYearMonth`
 * inclusive (`1` in the final month), or `null` when the loan has no valid end
 * month or the end month is already in the past.
 */
export const remainingTermMonths = (
  endYearMonth: string | null | undefined,
  yearMonth: YearMonth
): number | null => {
  if (!endYearMonth || !isValidYearMonth(endYearMonth) || !isValidYearMonth(yearMonth)) {
    return null;
  }
  const diff = toMonthOrdinal(endYearMonth) - toMonthOrdinal(yearMonth);
  return diff < 0 ? null : diff + 1;
};

// ---------------------------------------------------------------------------
// Liability linkage
// ---------------------------------------------------------------------------

/** One resolved `Loan` config ↔ canonical liability link. */
export interface LoanLiabilityLink {
  readonly loan: Loan;
  readonly liabilityId: string;
  readonly liability: CompiledLiability;
}

/** Plan produced by {@link collectLoanLinks}: resolved links + skip diagnostics. */
export interface LoanProcessorPlan {
  readonly links: readonly LoanLiabilityLink[];
  readonly diagnostics: readonly LoanProcessorDiagnostic[];
}

/** Options for the loan processor (all optional). */
export interface LoanProcessorOptions {
  /**
   * Explicit `Loan` → liability id resolver. Return the liability's own id to
   * link, or `null` to skip the loan. When omitted the default link resolves
   * `loan.id` against `context.getLiability` (identity, then a unique
   * `sourceConfigId`) and returns the resolved liability id.
   */
  readonly liabilityIdForLoan?: (loan: Loan, context: CompiledScenarioContext) => string | null;
}

/**
 * Default `Loan` → liability link.
 *
 * `context.getLiability(loan.id)` resolves the liability's own id first, then a
 * **unique** `sourceConfigId === loan.id` link. The resolved
 * `CompiledLiability.liabilityId` is returned (never `loan.id`) so the runtime
 * `state.getLiability` lookup finds the actual linked debt. An ambiguous
 * duplicate `sourceConfigId` is not indexed by the context, so this returns
 * `null` and the loan is skipped.
 */
export const resolveLoanLiabilityId = (
  loan: Loan,
  context: CompiledScenarioContext,
  options: LoanProcessorOptions = {}
): string | null => {
  const override = options.liabilityIdForLoan?.(loan, context);
  if (override !== undefined) {
    return override;
  }
  return context.getLiability(loan.id)?.liabilityId ?? null;
};

/**
 * Resolves the enabled loan links for a compiled context. A loan with no linked
 * liability, or one owned by the housing stream (`linkedPropertyId !== null`), is
 * skipped with an explicit diagnostic and never accrues or pays.
 */
export const collectLoanLinks = (
  context: CompiledScenarioContext,
  options: LoanProcessorOptions = {}
): LoanProcessorPlan => {
  const links: LoanLiabilityLink[] = [];
  const diagnostics: LoanProcessorDiagnostic[] = [];

  for (const loan of context.domains.loans ?? []) {
    if (!loan.enabled) {
      continue;
    }
    const liabilityId = resolveLoanLiabilityId(loan, context, options);
    if (!liabilityId) {
      diagnostics.push({
        code: 'unknown-liability',
        loanId: loan.id,
        message: `Loan "${loan.id}" has no linked liability (no matching liability id); skipped.`
      });
      continue;
    }
    const liability = context.getLiability(liabilityId);
    if (!liability) {
      diagnostics.push({
        code: 'unknown-liability',
        loanId: loan.id,
        message: `Loan "${loan.id}" links liability "${liabilityId}" which is not compiled; skipped.`
      });
      continue;
    }
    if (liability.linkedPropertyId !== null) {
      diagnostics.push({
        code: 'housing-owned',
        loanId: loan.id,
        message: `Loan "${loan.id}" is owned by the housing/property stream (linked property "${liability.linkedPropertyId}"); skipped to avoid double-counting.`
      });
      continue;
    }
    links.push({ loan, liabilityId, liability });
  }

  return { links, diagnostics };
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const dedupe = (values: readonly (string | null | undefined)[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
};

const toNonNegativeCents = (dollars: number): number => {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars <= 0) {
    return 0;
  }
  try {
    return dollarsToCents(dollars);
  } catch {
    return 0;
  }
};

const clampPaymentDay = (day: number | null | undefined): number =>
  Number.isSafeInteger(day) && (day as number) >= 1 && (day as number) <= 31 ? (day as number) : 1;

const dateInYearMonth = (yearMonth: YearMonth, day: number): DateOnly | null => {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) {
    return null;
  }
  const clamped = Math.min(Math.max(1, Math.floor(day)), daysInMonth(parsed.year, parsed.month));
  return `${yearMonth}-${String(clamped).padStart(2, '0')}`;
};

const laterYearMonth = (a: string, b: string): string => {
  if (!isValidYearMonth(a)) {
    return b;
  }
  if (!isValidYearMonth(b)) {
    return a;
  }
  return toMonthOrdinal(a) >= toMonthOrdinal(b) ? a : b;
};

const accountIdFromSource = (source: string | null | undefined): string | null => {
  if (typeof source !== 'string' || source.length === 0 || source === 'income') {
    return null;
  }
  return source.startsWith('account:') ? source.slice('account:'.length) : source;
};

/** The configured month-close fraction for a `yearMonth` (mirrors the facade). */
const loanMonthFraction = (context: CompiledScenarioContext, yearMonth: YearMonth): number => {
  if (!isValidYearMonth(yearMonth)) {
    return 1;
  }
  const monthStart: DateOnly = `${yearMonth}-01`;
  const monthEnd = endOfMonthDate(yearMonth);
  const closeStart =
    compareDateOnly(monthStart, context.metadata.startDate) >= 0 ? monthStart : context.metadata.startDate;
  const closeEnd = compareDateOnly(monthEnd, context.metadata.endDate) <= 0 ? monthEnd : context.metadata.endDate;
  const fraction = monthFractionForDates(yearMonth, closeStart, closeEnd);
  return fraction === null ? 1 : fraction;
};

// ---------------------------------------------------------------------------
// Resolved terms and funding order
// ---------------------------------------------------------------------------

interface ResolvedLoanTerms {
  /** Nominal APR as a percentage (`6.5` for `6.5%`). */
  readonly aprPercent: number;
  readonly minimumPaymentCents: number;
  readonly extraPaymentCents: number;
  readonly endYearMonth: string | null;
  readonly paymentDay: number;
}

const resolveLoanTerms = (loan: Loan, liability: CompiledLiability): ResolvedLoanTerms => {
  const apr = liability.annualInterestRate ?? loan.annualInterestRate ?? 0;
  const minimumDollars = liability.minimumMonthlyPayment ?? loan.minimumMonthlyPayment ?? 0;
  const extraDollars = liability.extraMonthlyPayment ?? loan.extraMonthlyPayment ?? 0;
  return {
    aprPercent: typeof apr === 'number' && Number.isFinite(apr) ? apr : 0,
    minimumPaymentCents: toNonNegativeCents(minimumDollars),
    extraPaymentCents: toNonNegativeCents(extraDollars),
    endYearMonth:
      typeof liability.endYearMonth === 'string' && liability.endYearMonth.length > 0
        ? liability.endYearMonth
        : null,
    paymentDay: clampPaymentDay(liability.paymentDay)
  };
};

interface ResolvedFundingOrder {
  readonly primaryAccountId: string | null;
  readonly fallbackAccountIds: readonly string[];
}

/**
 * Ordered funding for a loan obligation: the compiled per-obligation source
 * order when it names accounts, else the configured income fallbacks followed by
 * the global funding policy (deduped). Income is never fabricated into a plan.
 */
const resolveLoanFundingOrder = (context: CompiledScenarioContext, loan: Loan): ResolvedFundingOrder => {
  const compiled = context.getObligationSourceOrder(loan.id);
  const ordered = dedupe(compiled?.orderedAccountIds ?? []);
  if (ordered.length > 0) {
    return { primaryAccountId: ordered[0], fallbackAccountIds: ordered.slice(1) };
  }
  const combined = dedupe([
    ...context.funding.global.incomeFallbackAccountIds,
    ...context.funding.global.orderedAccountIds
  ]);
  return { primaryAccountId: combined[0] ?? null, fallbackAccountIds: combined.slice(1) };
};

/** Down-payment funding: the loan's explicit down-payment account, else the loan order. */
const resolveDownPaymentFundingOrder = (
  context: CompiledScenarioContext,
  loan: Loan
): ResolvedFundingOrder => {
  const sourceId = accountIdFromSource(loan.downPaymentSource);
  if (sourceId === null) {
    return resolveLoanFundingOrder(context, loan);
  }
  const compiled = context.getObligationSourceOrder(loan.id);
  const fallbacks = dedupe(compiled?.orderedAccountIds ?? []).filter((id) => id !== sourceId);
  return { primaryAccountId: sourceId, fallbackAccountIds: fallbacks };
};

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------

export interface LoanProcessorBuild {
  readonly definitions: readonly EventDefinition[];
  readonly diagnostics: readonly LoanProcessorDiagnostic[];
}

/** Static (context-only) accrual target: the scheduler's fallback resolver. */
const staticAccrualTarget = (
  context: CompiledScenarioContext,
  link: LoanLiabilityLink,
  terms: ResolvedLoanTerms,
  yearMonth: YearMonth
): Cents => {
  if (terms.aprPercent <= 0) {
    return 0;
  }
  const openingCents = toNonNegativeCents(link.liability.openingBalance);
  if (openingCents <= 0) {
    return 0;
  }
  const quoted = quoteDebtMonthlyAccrual(
    openingCents,
    terms.aprPercent / 100,
    loanMonthFraction(context, yearMonth)
  );
  return quoted.ok ? quoted.accrual.accrualCents : 0;
};

/** Static (context-only) installment target: the scheduler's fallback resolver. */
const staticInstallmentTarget = (link: LoanLiabilityLink, terms: ResolvedLoanTerms, yearMonth: YearMonth): Cents => {
  const quoted = quoteLoanInstallment({
    principalCents: toNonNegativeCents(link.liability.openingBalance),
    annualRate: terms.aprPercent / 100,
    remainingMonths: remainingTermMonths(terms.endYearMonth, yearMonth),
    minimumPaymentCents: terms.minimumPaymentCents
  });
  return quoted.ok ? quoted.quote.requiredCents : 0;
};

/**
 * Builds the loan stream's `EventDefinition`s: an `accrual` (D13) and a
 * `mandatory` installment per linked loan, a `discretionary` extra when
 * configured, and a one-time account-funded down payment when the loan terms
 * require one. The definition resolvers are context-only fallbacks; the
 * handlers' state-aware resolvers are authoritative.
 */
export const buildLoanEventDefinitions = (
  context: CompiledScenarioContext,
  options: LoanProcessorOptions = {}
): LoanProcessorBuild => {
  const { links, diagnostics: linkDiagnostics } = collectLoanLinks(context, options);
  const diagnostics: LoanProcessorDiagnostic[] = [...linkDiagnostics];
  const definitions: EventDefinition[] = [];

  for (const link of links) {
    const terms = resolveLoanTerms(link.loan, link.liability);
    const startYearMonth = laterYearMonth(link.loan.startYearMonth, context.metadata.startYearMonth);
    const startDate = dateInYearMonth(startYearMonth, terms.paymentDay);
    if (startDate === null) {
      diagnostics.push({
        code: 'invalid-terms',
        loanId: link.loan.id,
        message: `Loan "${link.loan.id}" has an invalid start month "${String(link.loan.startYearMonth)}"; skipped.`
      });
      continue;
    }
    const endDate =
      terms.endYearMonth !== null && isValidYearMonth(terms.endYearMonth)
        ? endOfMonthDate(terms.endYearMonth)
        : null;
    if (endDate !== null && compareDateOnly(endDate, startDate) < 0) {
      diagnostics.push({
        code: 'invalid-terms',
        loanId: link.loan.id,
        message: `Loan "${link.loan.id}" ends (${terms.endYearMonth}) before it starts (${startYearMonth}); skipped.`
      });
      continue;
    }
    const monthly = {
      frequency: 'monthly' as const,
      startDate,
      endDate,
      dayOfMonth: terms.paymentDay
    };

    definitions.push({
      definitionId: loanDefinitionId(link.loan.id, 'accrual'),
      phase: 'accrual',
      purpose: LOAN_ACCRUAL_PURPOSE,
      priority: 0,
      recurrence: monthly,
      handlerId: LOAN_ACCRUAL_HANDLER_ID,
      resolveTarget: (execution) => staticAccrualTarget(context, link, terms, execution.yearMonth)
    });
    definitions.push({
      definitionId: loanDefinitionId(link.loan.id, 'installment'),
      phase: 'mandatory',
      purpose: LOAN_INSTALLMENT_PURPOSE,
      priority: 10,
      recurrence: monthly,
      handlerId: LOAN_INSTALLMENT_HANDLER_ID,
      resolveTarget: (execution) => staticInstallmentTarget(link, terms, execution.yearMonth)
    });
    if (terms.extraPaymentCents > 0) {
      definitions.push({
        definitionId: loanDefinitionId(link.loan.id, 'extra'),
        phase: 'discretionary',
        purpose: LOAN_EXTRA_PURPOSE,
        priority: 20,
        recurrence: monthly,
        handlerId: LOAN_EXTRA_HANDLER_ID,
        resolveTarget: () => terms.extraPaymentCents
      });
    }
    if (link.loan.downPayment > 0) {
      definitions.push({
        definitionId: loanDefinitionId(link.loan.id, 'downPayment'),
        phase: 'mandatory',
        purpose: LOAN_DOWN_PAYMENT_PURPOSE,
        priority: 5,
        recurrence: { frequency: 'oneTime', startDate },
        handlerId: LOAN_DOWN_PAYMENT_HANDLER_ID,
        resolveTarget: () => toNonNegativeCents(link.loan.downPayment)
      });
    }
  }

  return { definitions, diagnostics };
};

// ---------------------------------------------------------------------------
// Handler execution
// ---------------------------------------------------------------------------

const fundingRequest = (
  context: CompiledScenarioContext,
  link: LoanLiabilityLink,
  execution: EventExecutionContext,
  requestedCents: Cents,
  purpose: FundingPurpose
): FundingRequest => {
  const order = resolveLoanFundingOrder(context, link.loan);
  return {
    id: `loan:${link.loan.id}`,
    occurrenceId: execution.event.occurrenceId,
    date: execution.date,
    requestedCents,
    primaryAccountId: order.primaryAccountId,
    fallbackAccountIds: [...order.fallbackAccountIds],
    purpose
  };
};

const globalDefaultsFor = (deps: ProjectionHandlerDependencies) => ({
  primaryAccountId: deps.funding.global.primaryAccountId,
  fallbackAccountIds: [...deps.funding.global.fallbackAccountIds]
});

/**
 * D15 posting provenance for a loan commit, taken verbatim from the executing
 * occurrence — never a default or fabricated stamp.
 */
const loanPostingContext = (
  execution: EventExecutionContext,
  purpose: FundingPurpose
): PostingContext => ({
  occurrenceId: execution.event.occurrenceId,
  definitionId: execution.event.definitionId,
  purpose,
  date: execution.date,
  phase: execution.event.phase
});

/** Commit options carrying the explicit posting stamp the funding bridge forwards. */
type LoanCommitOptions = CommitFundingOptions & { posting: PostingContext };

/**
 * Funds a loan payment and reduces the liability **interest first, then
 * principal**, by the amount actually funded. Principal is reduced only by the
 * actual paid amount; unpaid interest/principal is retained. Any excess over the
 * outstanding debt is capped. Never fabricates fees/proceeds.
 */
const executeLoanPayment = (
  deps: ProjectionHandlerDependencies,
  link: LoanLiabilityLink,
  execution: EventExecutionContext,
  targetCents: Cents,
  purpose: FundingPurpose
): ProjectionExecutionResult => {
  const diagnostics: string[] = [];
  const liability = deps.state.getLiability(link.liabilityId);
  if (!liability) {
    return {
      committed: false,
      plan: null,
      diagnostics: [`Loan "${link.loan.id}" liability "${link.liabilityId}" is missing from state.`]
    };
  }

  const outstanding = liability.principalCents + liability.accruedInterestCents + liability.feesCents;
  const requested = Math.min(targetCents, outstanding);
  if (requested <= 0) {
    return { committed: false, plan: null };
  }

  const quoted = quoteFunding(
    deps.state,
    fundingRequest(deps.context, link, execution, requested, purpose),
    deps.accounts,
    deps.dateOfBirth,
    { globalDefaults: globalDefaultsFor(deps) }
  );
  if (!quoted.ok) {
    // The rejected quote's diagnostic stays separate; the quote is returned so
    // it travels with the handler outcome.
    return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
  }

  let interestPaid = 0;
  let principalPaid = 0;
  const commitOptions: LoanCommitOptions = {
    posting: loanPostingContext(execution, purpose),
    prepareRelatedChanges: ({ executedNetCents }) => {
      const applied = Math.min(executedNetCents, outstanding);
      interestPaid = Math.min(applied, liability.accruedInterestCents);
      principalPaid = Math.min(applied - interestPaid, liability.principalCents);
      return {
        liabilityChanges: [
          {
            liabilityId: link.liabilityId,
            accruedInterestDeltaCents: -interestPaid,
            principalDeltaCents: -principalPaid
          }
        ],
        netWorthAdjustmentCents: interestPaid + principalPaid
      };
    }
  };
  const commit = commitFunding(deps.state, quoted.plan, commitOptions);

  if (!commit.committed) {
    for (const error of commit.errors) {
      diagnostics.push(error.message);
    }
    if (quoted.plan.executedCents <= 0) {
      diagnostics.push(
        `Loan "${link.loan.id}" missed its ${requested}-cent ${purpose} payment on ${execution.date}; unpaid interest/principal retained.`
      );
    }
    // D16: the unfunded quote is returned (not only the failed commit plan) so the
    // facade records a funding outcome from actual quote evidence.
    return { committed: false, plan: commit.plan, quote: quoted, diagnostics };
  }

  const executed = commit.plan?.executedCents ?? quoted.plan.executedCents;
  if (executed < requested) {
    diagnostics.push(
      `Loan "${link.loan.id}" paid ${executed} of ${requested} cents on ${execution.date} (shortfall ${requested - executed}); unpaid interest/principal retained.`
    );
  }
  const appliedTotal = interestPaid + principalPaid;
  if (executed > appliedTotal) {
    diagnostics.push(
      `Loan "${link.loan.id}" capped its debt reduction at the outstanding ${appliedTotal} cents; ${executed - appliedTotal} cents were not applied to debt.`
    );
  }
  // D16: carry the committed quote so the facade records the outcome from the
  // quote's eligible-source evidence (paid plan audit remains `plan`).
  return { committed: true, plan: commit.plan, quote: quoted, diagnostics };
};

/** Funds the one-time down payment as a plain external expense (no related change). */
const executeLoanDownPayment = (
  deps: ProjectionHandlerDependencies,
  link: LoanLiabilityLink,
  execution: EventExecutionContext,
  targetCents: Cents
): ProjectionExecutionResult => {
  const diagnostics: string[] = [];
  if (targetCents <= 0) {
    return { committed: false, plan: null };
  }
  const order = resolveDownPaymentFundingOrder(deps.context, link.loan);
  const request: FundingRequest = {
    id: `loan:${link.loan.id}`,
    occurrenceId: execution.event.occurrenceId,
    date: execution.date,
    requestedCents: targetCents,
    primaryAccountId: order.primaryAccountId,
    fallbackAccountIds: [...order.fallbackAccountIds],
    purpose: LOAN_DOWN_PAYMENT_PURPOSE
  };
  const quoted = quoteFunding(deps.state, request, deps.accounts, deps.dateOfBirth, {
    globalDefaults: globalDefaultsFor(deps)
  });
  if (!quoted.ok) {
    // The rejected quote's diagnostic stays separate; the quote is returned so
    // it travels with the handler outcome.
    return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
  }
  const commitOptions: LoanCommitOptions = {
    posting: loanPostingContext(execution, LOAN_DOWN_PAYMENT_PURPOSE)
  };
  const commit = commitFunding(deps.state, quoted.plan, commitOptions);
  if (!commit.committed) {
    for (const error of commit.errors) {
      diagnostics.push(error.message);
    }
    diagnostics.push(
      `Loan "${link.loan.id}" down payment of ${targetCents} cents on ${execution.date} was not fully funded.`
    );
    // D16: return the unfunded down-payment quote for outcome evidence.
    return { committed: false, plan: commit.plan, quote: quoted, diagnostics };
  }
  if (quoted.plan.shortfallCents > 0) {
    diagnostics.push(
      `Loan "${link.loan.id}" down payment short by ${quoted.plan.shortfallCents} cents on ${execution.date}.`
    );
  }
  // D16: carry the committed quote for outcome evidence.
  return { committed: true, plan: commit.plan, quote: quoted, diagnostics };
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Required installment from the live liability (state-aware). */
const requiredInstallmentCents = (
  deps: ProjectionHandlerDependencies,
  link: LoanLiabilityLink,
  terms: ResolvedLoanTerms,
  yearMonth: YearMonth
): Cents => {
  const liability = deps.state.getLiability(link.liabilityId);
  if (!liability) {
    return 0;
  }
  const quoted = quoteLoanInstallment({
    principalCents: liability.principalCents,
    accruedInterestCents: liability.accruedInterestCents,
    feesCents: liability.feesCents,
    annualRate: terms.aprPercent / 100,
    remainingMonths: remainingTermMonths(terms.endYearMonth, yearMonth),
    minimumPaymentCents: terms.minimumPaymentCents
  });
  return quoted.ok ? quoted.quote.requiredCents : 0;
};

interface LoanHandlerEntry {
  readonly link: LoanLiabilityLink;
  readonly terms: ResolvedLoanTerms;
}

/**
 * Creates the loan stream's handlers for one run. Each handler resolves a
 * state-aware target just before execution and posts only through
 * `state.commitChanges` / `quoteFunding`+`commitFunding`.
 */
export const createLoanHandlers = (
  deps: ProjectionHandlerDependencies,
  options: LoanProcessorOptions = {}
): ProjectionEventHandler[] => {
  const { links } = collectLoanLinks(deps.context, options);
  const index = new Map<string, LoanHandlerEntry>();
  for (const link of links) {
    const entry: LoanHandlerEntry = { link, terms: resolveLoanTerms(link.loan, link.liability) };
    for (const kind of LOAN_EVENT_KINDS) {
      index.set(loanDefinitionId(link.loan.id, kind), entry);
    }
  }
  const entryFor = (execution: EventExecutionContext): LoanHandlerEntry | undefined =>
    index.get(execution.event.definitionId);

  const accrual: ProjectionEventHandler = {
    handlerId: LOAN_ACCRUAL_HANDLER_ID,
    resolveTarget(execution) {
      const entry = entryFor(execution);
      if (!entry || entry.terms.aprPercent <= 0) {
        return 0;
      }
      const liability = deps.state.getLiability(entry.link.liabilityId);
      if (!liability || liability.principalCents <= 0) {
        return 0;
      }
      const quoted = quoteDebtMonthlyAccrual(
        liability.principalCents,
        entry.terms.aprPercent / 100,
        loanMonthFraction(deps.context, execution.yearMonth)
      );
      return quoted.ok ? quoted.accrual.accrualCents : 0;
    },
    execute({ execution, targetCents }) {
      const entry = entryFor(execution);
      if (!entry || targetCents <= 0) {
        return { committed: false, plan: null };
      }
      // D15: the direct interest-accrual commit (no funding plan) stamps the full
      // posting context; phase is the contractual accrual phase.
      const commit = deps.state.commitChanges({
        revision: deps.state.getRevision(),
        liabilityChanges: [
          { liabilityId: entry.link.liabilityId, accruedInterestDeltaCents: targetCents }
        ],
        expectedNetWorthDeltaCents: -targetCents,
        posting: {
          occurrenceId: execution.event.occurrenceId,
          definitionId: execution.event.definitionId,
          purpose: LOAN_ACCRUAL_PURPOSE,
          date: execution.date,
          phase: 'accrual'
        }
      });
      if (!commit.committed) {
        return { committed: false, plan: null, diagnostics: commit.errors.map((error) => error.message) };
      }
      return {
        committed: true,
        plan: null,
        diagnostics: []
      };
    }
  };

  const installment: ProjectionEventHandler = {
    handlerId: LOAN_INSTALLMENT_HANDLER_ID,
    resolveTarget(execution) {
      const entry = entryFor(execution);
      return entry ? requiredInstallmentCents(deps, entry.link, entry.terms, execution.yearMonth) : 0;
    },
    execute({ execution, targetCents }) {
      const entry = entryFor(execution);
      if (!entry) {
        return { committed: false, plan: null };
      }
      return executeLoanPayment(deps, entry.link, execution, targetCents, LOAN_INSTALLMENT_PURPOSE);
    }
  };

  const extra: ProjectionEventHandler = {
    handlerId: LOAN_EXTRA_HANDLER_ID,
    resolveTarget(execution) {
      const entry = entryFor(execution);
      if (!entry || entry.terms.extraPaymentCents <= 0) {
        return 0;
      }
      const liability = deps.state.getLiability(entry.link.liabilityId);
      if (!liability) {
        return 0;
      }
      const outstanding =
        liability.principalCents + liability.accruedInterestCents + liability.feesCents;
      return Math.min(entry.terms.extraPaymentCents, outstanding);
    },
    execute({ execution, targetCents }) {
      const entry = entryFor(execution);
      if (!entry) {
        return { committed: false, plan: null };
      }
      return executeLoanPayment(deps, entry.link, execution, targetCents, LOAN_EXTRA_PURPOSE);
    }
  };

  const downPayment: ProjectionEventHandler = {
    handlerId: LOAN_DOWN_PAYMENT_HANDLER_ID,
    resolveTarget(execution) {
      const entry = entryFor(execution);
      if (!entry || entry.link.loan.downPayment <= 0) {
        return 0;
      }
      return toNonNegativeCents(entry.link.loan.downPayment);
    },
    execute({ execution, targetCents }) {
      const entry = entryFor(execution);
      if (!entry) {
        return { committed: false, plan: null };
      }
      return executeLoanDownPayment(deps, entry.link, execution, targetCents);
    }
  };

  return [accrual, installment, extra, downPayment];
};

/** The loan stream's `ProjectionHandlerFactory` (compose into the run seam). */
export const createLoanHandlerFactory = (options: LoanProcessorOptions = {}): ProjectionHandlerFactory => (
  deps
) => createLoanHandlers(deps, options);

