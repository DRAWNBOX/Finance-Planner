/**
 * P4.1a (D15) — Immutable posting journal for the sole kernel mutation point.
 *
 * The kernel's `EngineState.commitChanges` is the only balance mutation entry
 * point. P4.1 needs a complete, non-truncated trace of every touched account /
 * liability / property / held-deposit delta, so on a successful commit the state
 * appends one {@link PostingRecord} here. Authority: `refactor/phase4_plan.md`
 * D15, `refactor/frozen_contracts.md` P0.3.1 item 11 (audit rows) and P0.3.2
 * (event/posting phases).
 *
 * Contract:
 *
 * - A record is **deep-frozen** together with its posting context and sparse
 *   delta arrays, so a caller mutating the objects it passed to
 *   `commitChanges` afterwards cannot rewrite the audit. Nested payroll facts
 *   (and their allocation array) are cloned and frozen too — never aliased.
 * - `sequence` is a stable 0-based append index; it never changes after append.
 * - The journal keeps **append-only secondary indexes** by occurrence ID,
 *   definition ID, touched account ID and month (`YYYY-MM`), updated in
 *   `O(touched)` per commit. Queries return frozen copies; no whole-ledger copy
 *   is ever taken.
 * - The opening observation is **not** a posting — reporting reads the opening
 *   snapshot separately. `phase: 'opening'` exists for that reporting-side
 *   context, but `state.commitChanges` never authors it.
 * - Payroll is the one mixed commit whose gross/net/employee/employer legs
 *   cannot be recovered from net account deltas. Its optional
 *   {@link PostingContext.facts} carries the executed payroll breakdown. Facts
 *   are **absent** on funding/accrual postings; a present-but-invalid payload is
 *   rejected as an invalid posting by the kernel.
 *
 * This module holds no financial math: it only records the sparse deltas the
 * state already validated and applied.
 */

import { isValidDateOnly, type DateOnly } from './dates';
import type { AccountChange, LiabilityChange, PropertyChange } from './state';

/** The frozen same-date phases plus the opening/close observation markers. */
export const POSTING_PHASES = [
  'accrual',
  'income',
  'cap',
  'mandatory',
  'discretionary',
  'close',
  'opening'
] as const;

export type PostingPhase = (typeof POSTING_PHASES)[number];

/** One net-pay allocation line: requested vs actually executed (deposited). */
export interface PostingFlowAllocation {
  readonly lineId: string;
  /** Canonical destination account id; `''` = missing destination (unresolved). */
  readonly accountId: string;
  readonly requestedCents: number;
  readonly executedCents: number;
}

/**
 * Executed payroll facts (D15). Carried only on the payroll posting; funding and
 * accrual postings leave `facts` absent. Every amount is a nonnegative safe
 * integer cent value and gross reconciles exactly:
 *
 *   `grossEarnings = netPay + payrollTax + otherDeductions`
 *     `+ (employeeRetirement + employeeHsa) + unresolvedEmployee`
 *
 * Employer retirement/HSA deposits are external money (they add to assets but are
 * **not** part of gross). `unresolvedEmployee` is an employee deduction that was
 * taken out of gross but retained in the remainder account because its configured
 * destination was missing: it is real money still held, and must **never** be
 * relabeled as net pay.
 */
export interface PostingFlowFacts {
  readonly grossEarningsCents: number;
  readonly netPayCents: number;
  readonly payrollTaxCents: number;
  readonly otherDeductionsCents: number;
  /** Employee retirement actually deposited to its account (gross-deducted). */
  readonly employeeRetirementCents: number;
  /** Employee HSA actually deposited to its account (gross-deducted). */
  readonly employeeHsaCents: number;
  /** Employer retirement actually deposited (external; not part of gross). */
  readonly employerRetirementCents: number;
  /** Employer HSA actually deposited (external; not part of gross). */
  readonly employerHsaCents: number;
  /** Employee deduction retained in the remainder (missing destination). */
  readonly unresolvedEmployeeCents: number;
  /** Ordered net-pay allocation lines (requested vs executed). */
  readonly allocations: readonly PostingFlowAllocation[];
}

/**
 * Provenance for one committed transaction. `occurrenceId`/`definitionId` link
 * the posting back to the funding plan / scheduler occurrence; `purpose`, `date`
 * and `phase` place it in the audit and same-date order. `facts` is present only
 * on the payroll posting.
 */
export interface PostingContext {
  readonly occurrenceId?: string;
  readonly definitionId?: string;
  readonly purpose: string;
  readonly date: DateOnly;
  readonly phase: PostingPhase;
  /** Executed payroll breakdown; absent on funding/accrual postings (D15). */
  readonly facts?: PostingFlowFacts;
}

/** One immutable, committed posting; the sparse deltas actually applied. */
export interface PostingRecord {
  /** Revision produced by this commit (`getRevision()` after apply). */
  readonly revision: number;
  /** Stable 0-based append index; never changes after append. */
  readonly sequence: number;
  readonly posting: PostingContext;
  readonly accountChanges: readonly AccountChange[];
  readonly liabilityChanges: readonly LiabilityChange[];
  readonly propertyChanges: readonly PropertyChange[];
  readonly expectedNetWorthDeltaCents: number;
}

/**
 * The pre-append shape the state hands to the journal. `sequence` is assigned by
 * the journal so it can never be supplied out of order.
 */
export interface PostingDraft {
  readonly revision: number;
  readonly posting: PostingContext;
  readonly accountChanges?: readonly AccountChange[];
  readonly liabilityChanges?: readonly LiabilityChange[];
  readonly propertyChanges?: readonly PropertyChange[];
  readonly expectedNetWorthDeltaCents: number;
}

const isNonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPhase = (value: unknown): value is PostingPhase =>
  typeof value === 'string' && (POSTING_PHASES as readonly string[]).includes(value);

/**
 * Describes why a posting context is invalid, or `null` when it is a valid stamp
 * (nonblank `purpose`, `YYYY-MM-DD` `date`, known `phase`; optional IDs, when
 * present, must be nonblank strings).
 */
export const postingContextProblem = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return 'a posting context is required on every nonempty commit';
  }
  if (typeof value !== 'object') {
    return 'the posting context must be an object';
  }
  const context = value as Partial<PostingContext>;
  if (!isNonBlankString(context.purpose)) {
    return 'posting.purpose must be a nonblank string';
  }
  if (typeof context.date !== 'string' || !isValidDateOnly(context.date)) {
    return `posting.date must be a valid YYYY-MM-DD date (received ${String(context.date)})`;
  }
  if (!isPhase(context.phase)) {
    return `posting.phase must be one of ${POSTING_PHASES.join(', ')} (received ${String(context.phase)})`;
  }
  if (context.occurrenceId !== undefined && !isNonBlankString(context.occurrenceId)) {
    return 'posting.occurrenceId must be a nonblank string when present';
  }
  if (context.definitionId !== undefined && !isNonBlankString(context.definitionId)) {
    return 'posting.definitionId must be a nonblank string when present';
  }
  return null;
};

/** Every nonnegative safe-integer cent field of {@link PostingFlowFacts}. */
const FLOW_FACT_FIELDS = [
  'grossEarningsCents',
  'netPayCents',
  'payrollTaxCents',
  'otherDeductionsCents',
  'employeeRetirementCents',
  'employeeHsaCents',
  'employerRetirementCents',
  'employerHsaCents',
  'unresolvedEmployeeCents'
] as const;

type FlowFactField = (typeof FLOW_FACT_FIELDS)[number];

const isNonnegativeSafeCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Describes why payroll `facts` are invalid, or `null` when they are valid or
 * absent. Absent facts (`undefined`/`null`) are always valid: facts are optional
 * and only the payroll posting carries them. When present, every cent field must
 * be a nonnegative safe integer, gross must reconcile
 * (`gross = netPay + payrollTax + otherDeductions + employeeDeposited +
 * unresolvedEmployee`), and the **executed** allocation total must not exceed
 * net pay (requested may oversubscribe; execution is bounded).
 */
export const postingFactsProblem = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'object') {
    return 'posting.facts must be an object when present';
  }
  const facts = value as Partial<Record<FlowFactField, unknown>> & { allocations?: unknown };
  for (const field of FLOW_FACT_FIELDS) {
    if (!isNonnegativeSafeCents(facts[field])) {
      return `posting.facts.${field} must be a nonnegative safe integer cent amount (received ${String(
        facts[field]
      )})`;
    }
  }

  const gross = facts.grossEarningsCents as number;
  const employeeDeposited = (facts.employeeRetirementCents as number) + (facts.employeeHsaCents as number);
  const reconciled =
    (facts.netPayCents as number) +
    (facts.payrollTaxCents as number) +
    (facts.otherDeductionsCents as number) +
    employeeDeposited +
    (facts.unresolvedEmployeeCents as number);
  if (!Number.isSafeInteger(reconciled)) {
    return 'posting.facts gross conservation sum exceeds the safe integer cent range';
  }
  if (reconciled !== gross) {
    return `posting.facts violates gross conservation: grossEarnings ${gross} !== netPay + payrollTax + otherDeductions + employeeDeposited + unresolvedEmployee (${reconciled})`;
  }

  if (!Array.isArray(facts.allocations)) {
    return 'posting.facts.allocations must be an array';
  }
  let executedTotal = 0;
  for (const entry of facts.allocations) {
    if (typeof entry !== 'object' || entry === null) {
      return 'each posting.facts allocation must be an object';
    }
    const allocation = entry as Partial<PostingFlowAllocation>;
    if (!isNonBlankString(allocation.lineId)) {
      return 'each posting.facts allocation requires a nonblank lineId';
    }
    if (typeof allocation.accountId !== 'string') {
      return `posting.facts allocation "${allocation.lineId}" requires an accountId string`;
    }
    if (!isNonnegativeSafeCents(allocation.requestedCents)) {
      return `posting.facts allocation "${allocation.lineId}" requestedCents must be a nonnegative safe integer`;
    }
    if (!isNonnegativeSafeCents(allocation.executedCents)) {
      return `posting.facts allocation "${allocation.lineId}" executedCents must be a nonnegative safe integer`;
    }
    if (allocation.executedCents > allocation.requestedCents) {
      return `posting.facts allocation "${allocation.lineId}" executed ${allocation.executedCents} exceeds requested ${allocation.requestedCents}`;
    }
    const nextExecuted = executedTotal + allocation.executedCents;
    if (!Number.isSafeInteger(nextExecuted)) {
      return 'posting.facts executed allocation total exceeds the safe integer cent range';
    }
    executedTotal = nextExecuted;
  }
  if (executedTotal > (facts.netPayCents as number)) {
    return `posting.facts executed allocation total ${executedTotal} exceeds net pay ${facts.netPayCents}`;
  }
  return null;
};

const freezeList = <T>(items: T[]): readonly T[] => Object.freeze(items);

const cloneAllocation = (allocation: PostingFlowAllocation): PostingFlowAllocation =>
  Object.freeze({
    lineId: allocation.lineId,
    accountId: allocation.accountId,
    requestedCents: allocation.requestedCents,
    executedCents: allocation.executedCents
  });

/** Deep-clones + freezes payroll facts so the caller cannot rewrite the audit. */
const cloneFacts = (facts: PostingFlowFacts): PostingFlowFacts =>
  Object.freeze({
    grossEarningsCents: facts.grossEarningsCents,
    netPayCents: facts.netPayCents,
    payrollTaxCents: facts.payrollTaxCents,
    otherDeductionsCents: facts.otherDeductionsCents,
    employeeRetirementCents: facts.employeeRetirementCents,
    employeeHsaCents: facts.employeeHsaCents,
    employerRetirementCents: facts.employerRetirementCents,
    employerHsaCents: facts.employerHsaCents,
    unresolvedEmployeeCents: facts.unresolvedEmployeeCents,
    allocations: freezeList((facts.allocations ?? []).map(cloneAllocation))
  });

/** Deep-clones + freezes the posting context (including nested facts). */
const clonePostingContext = (posting: PostingContext): PostingContext =>
  Object.freeze({
    purpose: posting.purpose,
    date: posting.date,
    phase: posting.phase,
    ...(posting.occurrenceId !== undefined ? { occurrenceId: posting.occurrenceId } : {}),
    ...(posting.definitionId !== undefined ? { definitionId: posting.definitionId } : {}),
    ...(posting.facts !== undefined ? { facts: cloneFacts(posting.facts) } : {})
  });

/** Month key (`YYYY-MM`) of a validated `YYYY-MM-DD` date. */
export const postingMonth = (date: DateOnly): string => date.slice(0, 7);

/**
 * Append-only posting trace with `O(touched)` indexes. `append` is the only
 * writer and is intended to be called solely by the kernel state owner.
 */
export class PostingJournal {
  #records: PostingRecord[] = [];
  #byOccurrence = new Map<string, PostingRecord[]>();
  #byDefinition = new Map<string, PostingRecord[]>();
  #byAccount = new Map<string, PostingRecord[]>();
  #byMonth = new Map<string, PostingRecord[]>();

  get size(): number {
    return this.#records.length;
  }

  /** Deep-clones and freezes the draft, assigns `sequence`, and indexes it. */
  append(draft: PostingDraft): PostingRecord {
    const record: PostingRecord = Object.freeze({
      revision: draft.revision,
      sequence: this.#records.length,
      posting: clonePostingContext(draft.posting),
      accountChanges: freezeList((draft.accountChanges ?? []).map((change) => Object.freeze({ ...change }))),
      liabilityChanges: freezeList(
        (draft.liabilityChanges ?? []).map((change) => Object.freeze({ ...change }))
      ),
      propertyChanges: freezeList(
        (draft.propertyChanges ?? []).map((change) => Object.freeze({ ...change }))
      ),
      expectedNetWorthDeltaCents: draft.expectedNetWorthDeltaCents
    });
    this.#records.push(record);

    if (record.posting.occurrenceId !== undefined) {
      pushIndex(this.#byOccurrence, record.posting.occurrenceId, record);
    }
    if (record.posting.definitionId !== undefined) {
      pushIndex(this.#byDefinition, record.posting.definitionId, record);
    }
    const touched = new Set<string>();
    for (const change of record.accountChanges) {
      touched.add(change.accountId);
    }
    for (const accountId of touched) {
      pushIndex(this.#byAccount, accountId, record);
    }
    pushIndex(this.#byMonth, postingMonth(record.posting.date), record);

    return record;
  }

  /** The complete trace, oldest first, as a frozen array. */
  getPostings(): readonly PostingRecord[] {
    return freezeList([...this.#records]);
  }

  getByOccurrence(occurrenceId: string): readonly PostingRecord[] {
    return freezeList([...(this.#byOccurrence.get(occurrenceId) ?? [])]);
  }

  getByDefinition(definitionId: string): readonly PostingRecord[] {
    return freezeList([...(this.#byDefinition.get(definitionId) ?? [])]);
  }

  getByAccount(accountId: string): readonly PostingRecord[] {
    return freezeList([...(this.#byAccount.get(accountId) ?? [])]);
  }

  /** Postings whose `posting.date` falls in `yearMonth` (`YYYY-MM`). */
  getByMonth(yearMonth: string): readonly PostingRecord[] {
    return freezeList([...(this.#byMonth.get(yearMonth) ?? [])]);
  }
}

const pushIndex = (
  index: Map<string, PostingRecord[]>,
  key: string,
  record: PostingRecord
): void => {
  const bucket = index.get(key);
  if (bucket === undefined) {
    index.set(key, [record]);
  } else {
    bucket.push(record);
  }
};
