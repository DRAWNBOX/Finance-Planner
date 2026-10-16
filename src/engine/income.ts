/**
 * Phase 3 Stream I — payroll / career income processor (I, engine-internal).
 *
 * Owns P3I.1–P3I.3 headless:
 *
 * 1. **P3I.1 Month-scoped career/pay-plan selection.** The active career and pay
 *    plan are resolved per month from the compiled context (`getActiveCareer` /
 *    `getActivePayPlan`), which the P2.5 compiler already resolves by explicit
 *    `startYearMonth`/`endYearMonth` (most-recently-started wins, month-precision
 *    gaps/overlaps). No age-only fallback through an explicit date gap: a month
 *    with no active career interval posts no income.
 * 2. **P3I.2 Payroll compilation and posting.** The granular `CareerEntry.paycheck`
 *    is the **sole engine authority** (D9): `paycheckInfo` is never read. Each
 *    employee/employer retirement/HSA line is posted separately to its own
 *    destination account; net pay = gross − taxes − health − other post-tax −
 *    employee retirement − employee HSA, floored at `$0`, with an explicit
 *    diagnostic when deductions exceed gross. Employer match/deposit is posted
 *    separately and never deducted from net pay.
 * 3. **P3I.3 Ordered net allocations and remainder.** The active plan's
 *    `CareerDepositPlan` allocations run in configured order as %-of-actual-net
 *    or fixed-per-pay-period (with `raiseFactor` scaling for
 *    `increaseWithPaycheck`), bounded by remaining net pay, with an explicit
 *    `remainderAccountId`. Unmet allocations stay visibly unresolved and are
 *    never reallocated into another (possibly restricted) account.
 * 4. **P3I.4 Incoming cap policy.** A `CareerSourceLine` with `maxBalance > 0`
 *    (`0` = off) caps an account. **Incoming** overflow is routed directly to its
 *    explicit `overflowFallbackAccountId` while the deposit posts; **existing
 *    excess** (a balance already above the cap) is rerouted only when the cap is
 *    explicitly configured, in a separate `cap`-phase pass with its own audit.
 *    Missing/self/cycle fallbacks leave the money in place and warn; rerouting
 *    *out of* a restricted account is rejected (no restriction bypass). There is
 *    no general transfer editor.
 * 5. **P3I.5 Other income.** Dated `context.global` cashflow / life-event
 *    **inflows** deposit directly to their configured account: one-time items at
 *    their exact month, recurring items monthly (annual amount split with the
 *    same cumulative-share rounding). Outflows are owned by stream S, and
 *    rent/property-sale flows by stream H (excluded here). Age-only dates are
 *    derived deterministically from a valid date of birth or reported with an
 *    explicit diagnostic — never silently skipped.
 *
 * Design constraints:
 *
 * - **One commit per posting.** Each handler assembles sparse account deltas and
 *   posts them through the state owner's sole `commitChanges`, declaring the
 *   exact net-worth delta (the sum of its account deltas, since every touched
 *   entity is an account). No invented deposits, no income reservoir, no double
 *   count.
 * - **Date-based raises.** `raiseFactor = (1 + raiseRate)^(monthsElapsed / 12)`
 *   measured from the active plan's effective month — never from an age.
 * - **Cumulative per-line cents (P0.3.4).** Each annualized line target is split
 *   over twelve occurrences with the exact cumulative-share rounding from
 *   `money.ts`. Payroll occurrences are counted from the **active plan's
 *   effective month**, so a plan that starts midyear resets to share `#1` and
 *   its twelve monthly shares reconcile to the annual target. A partial plan
 *   year naturally prorates by its actual scheduled occurrences.
 * - The scheduler drives the month batches; this module only emits the recurring
 *   `EventDefinition`s (namespaced `income:*`) and the handlers that execute them.
 *   Nothing here mutates state except through `commitChanges`.
 */

import type {
  CareerSourceLine,
  Paycheck,
  PaycheckDepositBucket,
  PaycheckLineKind
} from '../types';
import { compilePaycheckLineAmounts, getPeriodsPerYear } from '../paycheck';
import type { CompiledScenarioContext } from './configuration';
import {
  addMonths,
  endOfMonthDate,
  formatYearMonth,
  isValidDateOnly,
  isValidYearMonth,
  parseDateOnly,
  parseYearMonth,
  toMonthOrdinal,
  type YearMonth
} from './dates';
import {
  createCumulativeShareSchedule,
  dollarsToCents,
  roundHalfAwayFromZero,
  shareAt,
  type Cents
} from './money';
import type { EventDefinition, EventExecutionContext } from './scheduler';
import type { PostingContext, PostingFlowAllocation, PostingFlowFacts } from './journal';
import type {
  ProjectionEventHandler,
  ProjectionExecutionResult,
  ProjectionHandlerDependencies,
  ProjectionHandlerInvocation
} from './projection';

/** Single payroll handler id shared by every `income:<careerId>` definition. */
export const INCOME_HANDLER_ID = 'income';

/** Handler id for the separate cap-phase existing-excess pass (P3I.4). */
export const INCOME_CAP_HANDLER_ID = 'income-cap';

/** Handler id for dated other-income inflows (P3I.5). */
export const INCOME_OTHER_HANDLER_ID = 'income-other';

/** Event purpose string for payroll occurrences. */
export const INCOME_EVENT_PURPOSE = 'income';

/** Event purpose string for the cap-phase existing-excess occurrence. */
export const INCOME_CAP_EVENT_PURPOSE = 'incomeCap';

/** Event purpose string for dated other-income inflows. */
export const INCOME_OTHER_EVENT_PURPOSE = 'otherIncome';

const MONTHS_PER_YEAR = 12;

// ---------------------------------------------------------------------------
// Month-scoped career / pay-plan resolution (P3I.1)
// ---------------------------------------------------------------------------

/** The active plan for one month: paycheck authority + ordered deposit plan. */
export interface ResolvedIncomeMonth {
  readonly careerId: string;
  /** `null` = the career's Initial plan (career-level paycheck/depositPlan). */
  readonly planId: string | null;
  readonly paycheck: Paycheck;
  readonly allocations: readonly CareerSourceLine[];
  readonly remainderAccountId: string | null;
  readonly raiseRatePercent: number;
  readonly planStartYearMonth: YearMonth;
}

/**
 * Resolves the active career + pay plan + paycheck + deposit plan for a month.
 * Returns `null` when no enabled career covers the month (an explicit gap) or
 * when the active plan has no granular `paycheck` (D9: `paycheckInfo` is never
 * read, so a flat-only entry posts no income).
 */
export const resolveIncomeMonth = (
  context: CompiledScenarioContext,
  yearMonth: YearMonth
): ResolvedIncomeMonth | null => {
  const interval = context.getActiveCareer(yearMonth);
  if (!interval) {
    return null;
  }
  const career = context.getCareer(interval.careerId);
  if (!career || !career.enabled) {
    return null;
  }
  const entry = career.entry;
  const planInterval = context.getActivePayPlan(interval.careerId, yearMonth);
  const plan =
    planInterval?.planId != null
      ? (entry.payPlans ?? []).find((candidate) => candidate.id === planInterval.planId) ?? null
      : null;

  const paycheck = plan?.paycheck ?? entry.paycheck;
  if (!paycheck) {
    return null;
  }

  const depositPlan = plan?.depositPlan ?? entry.depositPlan ?? null;
  const allocations = depositPlan?.allocations ?? plan?.sourceLines ?? entry.sourceLines ?? [];

  return {
    careerId: interval.careerId,
    planId: planInterval?.planId ?? null,
    paycheck,
    allocations,
    remainderAccountId: depositPlan?.remainderAccountId ?? null,
    raiseRatePercent: planInterval?.annualRaiseRate ?? entry.annualRaiseRate ?? 0,
    planStartYearMonth: planInterval?.startYearMonth ?? interval.startYearMonth
  };
};

/**
 * `raiseFactor = (1 + raiseRate)^(months since the active plan's effective
 * month / 12)`. Date-based (P3I.2/D14): no age is read. Floored at the plan start
 * so a same-month plan never scales down.
 */
export const incomeRaiseFactor = (resolved: ResolvedIncomeMonth, yearMonth: YearMonth): number => {
  const monthsElapsed = toMonthOrdinal(yearMonth) - toMonthOrdinal(resolved.planStartYearMonth);
  if (monthsElapsed <= 0 || resolved.raiseRatePercent === 0) {
    return 1;
  }
  return Math.pow(1 + resolved.raiseRatePercent / 100, monthsElapsed / MONTHS_PER_YEAR);
};

// ---------------------------------------------------------------------------
// Monthly payroll compilation (P3I.2 / P3I.3)
// ---------------------------------------------------------------------------

/** One compiled paycheck line with its resolved monthly cent amount + destination. */
export interface IncomePosting {
  readonly lineId: string;
  readonly label: string;
  readonly kind: PaycheckLineKind;
  readonly bucket: PaycheckDepositBucket | null;
  readonly accountId: string | null;
  readonly cents: Cents;
}

/** One ordered net-pay allocation request (destination + requested cents). */
export interface IncomeAllocationRequest {
  readonly lineId: string;
  /** Canonical destination account id; `''` = missing destination (unresolved). */
  readonly accountId: string;
  readonly requestedCents: Cents;
}

/**
 * One explicitly configured account cap derived from a source line. `maxBalance`
 * `0` means "off", so a target only exists when a positive cap and a source
 * account are configured. `overflowAccountId` may be `''` (unresolved) — the
 * incoming deposit then stays in the source account with a diagnostic.
 */
export interface CapTarget {
  readonly accountId: string;
  readonly maxBalanceCents: Cents;
  readonly overflowAccountId: string;
}

/** One resolved dated other-income inflow (cashflow item or life event). */
export interface ResolvedInflow {
  /** Stable namespaced id, e.g. `cashflow:<id>` / `life:<id>`. */
  readonly id: string;
  readonly source: 'cashflow' | 'lifeEvent';
  readonly label: string;
  /** Destination account id; `''` = missing (unresolved, no deposit). */
  readonly accountId: string;
  /** One-time: full dollars. Recurring: annual dollars (split monthly). */
  readonly amountDollars: number;
  readonly startYearMonth: YearMonth;
  /** `null` for a one-time item or an open-ended recurring item. */
  readonly endYearMonth: YearMonth | null;
  readonly oneTime: boolean;
}

/** Resolved inflows plus explicit date-resolution diagnostics (P3I.5). */
export interface OtherIncomeResolution {
  readonly inflows: readonly ResolvedInflow[];
  readonly diagnostics: readonly string[];
}

/** A single month's compiled payroll: gross, net, per-line postings + allocations. */
export interface MonthlyIncomePlan {
  readonly careerId: string;
  readonly planId: string | null;
  readonly yearMonth: YearMonth;
  readonly raiseFactor: number;
  readonly grossCents: Cents;
  readonly netPayCents: Cents;
  readonly earnings: readonly IncomePosting[];
  readonly taxes: readonly IncomePosting[];
  readonly healthBenefits: readonly IncomePosting[];
  readonly otherBenefits: readonly IncomePosting[];
  readonly employeeRetirement: readonly IncomePosting[];
  readonly employeeHsa: readonly IncomePosting[];
  readonly employerRetirement: readonly IncomePosting[];
  readonly employerHsa: readonly IncomePosting[];
  readonly allocations: readonly IncomeAllocationRequest[];
  /** Explicit account caps for the active plan's source lines (P3I.4). */
  readonly capTargets: readonly CapTarget[];
  readonly remainderAccountId: string | null;
  readonly diagnostics: readonly string[];
}

/**
 * Monthly cents for an annualized dollar target, using cumulative per-line
 * rounding over twelve occurrences (P0.3.4). `occurrenceIndex` is 1–12 and is
 * caller-supplied: payroll uses the active plan's 1-based occurrence month
 * (see {@link planOccurrenceIndex}) so a new plan resets to share `#1`, while
 * calendar-anchored recurring inflows use the calendar month. An explicitly
 * zero (or non-finite/negative) target is valid and resolves to `0`.
 */
const monthlyCentsFromAnnualDollars = (annualDollars: number, occurrenceIndex: number): Cents => {
  if (!Number.isFinite(annualDollars) || annualDollars <= 0) {
    return 0;
  }
  const annualCents = dollarsToCents(annualDollars);
  if (annualCents <= 0) {
    return 0;
  }
  return shareAt(createCumulativeShareSchedule(annualCents, MONTHS_PER_YEAR), occurrenceIndex);
};

/**
 * 1-based occurrence of `yearMonth` within the active plan's twelve-month
 * cumulative-share cycle, counted from the plan's **effective month** (not the
 * calendar month). A new pay plan starting midyear therefore resets each line's
 * cumulative target to share `#1`, and each twelve monthly occurrences
 * reconcile exactly to the annual target. Months before the plan start wrap
 * deterministically rather than reading an invalid index.
 */
const planOccurrenceIndex = (planStartYearMonth: YearMonth, yearMonth: YearMonth): number => {
  const monthsElapsed = toMonthOrdinal(yearMonth) - toMonthOrdinal(planStartYearMonth);
  return (((monthsElapsed % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR) + 1;
};

const sumPostings = (postings: readonly IncomePosting[]): Cents =>
  postings.reduce((total, posting) => total + posting.cents, 0);

/**
 * Extracts the explicitly configured caps from a plan's ordered allocations. A
 * cap is `maxBalance > 0` on an enabled line with a source account; `0` is "off".
 * Duplicate accounts keep the first configured cap deterministically.
 */
export const buildCapTargets = (allocations: readonly CareerSourceLine[]): CapTarget[] => {
  const targets: CapTarget[] = [];
  const seen = new Set<string>();
  for (const line of allocations) {
    if (!line.enabled) {
      continue;
    }
    const maxBalance = Math.max(0, line.maxBalance ?? 0);
    if (maxBalance <= 0) {
      continue;
    }
    const accountId = typeof line.sourceId === 'string' ? line.sourceId.trim() : '';
    if (!accountId || seen.has(accountId)) {
      continue;
    }
    seen.add(accountId);
    targets.push({
      accountId,
      maxBalanceCents: dollarsToCents(maxBalance),
      overflowAccountId:
        typeof line.overflowFallbackAccountId === 'string' ? line.overflowFallbackAccountId.trim() : ''
    });
  }
  return targets;
};

/**
 * Compiles one month of payroll from the granular paycheck alone. Deterministic,
 * side-effect free and pure with respect to the compiled context.
 */
export const compileMonthlyIncome = (
  context: CompiledScenarioContext,
  yearMonth: YearMonth
): MonthlyIncomePlan | null => {
  const resolved = resolveIncomeMonth(context, yearMonth);
  if (!resolved) {
    return null;
  }

  const occurrenceIndex = planOccurrenceIndex(resolved.planStartYearMonth, yearMonth);
  const periods = getPeriodsPerYear(resolved.paycheck);
  const raiseFactor = incomeRaiseFactor(resolved, yearMonth);
  const diagnostics: string[] = [];

  const earnings: IncomePosting[] = [];
  const taxes: IncomePosting[] = [];
  const healthBenefits: IncomePosting[] = [];
  const otherBenefits: IncomePosting[] = [];
  const employeeRetirement: IncomePosting[] = [];
  const employeeHsa: IncomePosting[] = [];
  const employerRetirement: IncomePosting[] = [];
  const employerHsa: IncomePosting[] = [];

  for (const line of compilePaycheckLineAmounts(resolved.paycheck)) {
    const cents = monthlyCentsFromAnnualDollars(line.annualAmount * raiseFactor, occurrenceIndex);
    const posting: IncomePosting = {
      lineId: line.id,
      label: line.label,
      kind: line.kind,
      bucket: line.bucket,
      accountId: line.accountId,
      cents
    };
    switch (line.kind) {
      case 'earning':
        earnings.push(posting);
        break;
      case 'tax':
        taxes.push(posting);
        break;
      case 'posttax':
        otherBenefits.push(posting);
        break;
      case 'employer':
        if (line.bucket === 'retirement') {
          employerRetirement.push(posting);
        } else if (line.bucket === 'hsa') {
          employerHsa.push(posting);
        } else {
          diagnostics.push(`Employer line "${line.label}" has no retirement/HSA bucket; it was not deposited.`);
        }
        break;
      case 'pretax':
        if (line.bucket === 'retirement') {
          employeeRetirement.push(posting);
        } else if (line.bucket === 'hsa') {
          employeeHsa.push(posting);
        } else {
          healthBenefits.push(posting);
        }
        break;
    }
  }

  const grossCents = sumPostings(earnings);
  const totalDeductions =
    sumPostings(taxes) +
    sumPostings(healthBenefits) +
    sumPostings(otherBenefits) +
    sumPostings(employeeRetirement) +
    sumPostings(employeeHsa);
  const netPayCents = Math.max(0, grossCents - totalDeductions);
  if (totalDeductions > grossCents) {
    diagnostics.push('Paycheck deductions exceed gross pay; net pay is floored at $0.');
  }

  const allocations: IncomeAllocationRequest[] = [];
  for (const line of resolved.allocations) {
    if (!line.enabled) {
      continue;
    }
    const accountId = typeof line.sourceId === 'string' ? line.sourceId.trim() : '';
    let requestedCents: Cents;
    if (line.mode === 'fixedAmount') {
      const factor = line.increaseWithPaycheck ? raiseFactor : 1;
      requestedCents = monthlyCentsFromAnnualDollars(
        Math.max(0, line.fixedAmount ?? 0) * periods * factor,
        occurrenceIndex
      );
    } else {
      requestedCents = roundHalfAwayFromZero(netPayCents * (Math.max(0, line.contributionRate) / 100));
    }
    allocations.push({ lineId: line.id, accountId, requestedCents });
  }

  return {
    careerId: resolved.careerId,
    planId: resolved.planId,
    yearMonth,
    raiseFactor,
    grossCents,
    netPayCents,
    earnings,
    taxes,
    healthBenefits,
    otherBenefits,
    employeeRetirement,
    employeeHsa,
    employerRetirement,
    employerHsa,
    allocations,
    capTargets: buildCapTargets(resolved.allocations),
    remainderAccountId: resolved.remainderAccountId,
    diagnostics
  };
};

/** Gross monthly payroll cents for a month, `0` when no career/paycheck applies. */
export const resolveMonthlyGrossCents = (
  context: CompiledScenarioContext,
  yearMonth: YearMonth
): Cents => {
  const plan = compileMonthlyIncome(context, yearMonth);
  return plan ? plan.grossCents : 0;
};

// ---------------------------------------------------------------------------
// Dated other-income inflows (P3I.5)
// ---------------------------------------------------------------------------

/** Year-month for an age anchored to a valid DOB's birth month, else `null`. */
const yearMonthFromAge = (age: number, dateOfBirth: string | null | undefined): YearMonth | null => {
  if (!Number.isFinite(age) || !dateOfBirth || !isValidDateOnly(dateOfBirth)) {
    return null;
  }
  const birth = parseDateOnly(dateOfBirth);
  if (!birth) {
    return null;
  }
  return formatYearMonth({ year: birth.year + Math.floor(age), month: birth.month });
};

interface InflowWindow {
  startYearMonth: YearMonth;
  endYearMonth: YearMonth | null;
}

/**
 * Resolves an inflow's inclusive month window. An explicit `startYearMonth`
 * wins; otherwise the month is derived from `startAge` + a valid DOB. A
 * recurring item's end defaults to the end-age year's final month. An age-only
 * item with no valid DOB is **not** silently skipped: it emits a diagnostic.
 */
const resolveInflowWindow = (
  item: { startYearMonth?: string; endYearMonth?: string; startAge?: number; endAge?: number; cadence: string },
  kindLabel: string,
  id: string,
  dateOfBirth: string | null | undefined,
  diagnostics: string[]
): InflowWindow | null => {
  let start =
    typeof item.startYearMonth === 'string' && isValidYearMonth(item.startYearMonth) ? item.startYearMonth : '';
  if (!start) {
    const derived = yearMonthFromAge(item.startAge ?? NaN, dateOfBirth);
    if (!derived) {
      diagnostics.push(
        `${kindLabel} "${id}" has only an age start and no valid date of birth; its income month cannot be resolved.`
      );
      return null;
    }
    start = derived;
  }

  let end =
    typeof item.endYearMonth === 'string' && isValidYearMonth(item.endYearMonth) ? item.endYearMonth : '';
  if (item.cadence === 'recurring' && !end) {
    const derivedEnd = yearMonthFromAge(item.endAge ?? NaN, dateOfBirth);
    if (derivedEnd) {
      end = addMonths(derivedEnd, 11);
    }
  }
  return { startYearMonth: start, endYearMonth: end || null };
};

/**
 * Resolves the `context.global` cashflow / life-event **inflows** into dated,
 * destination-bearing postings. Only `direction === 'inflow'` items are handled
 * (stream S owns outflows); property sale/proceeds are excluded (stream H owns
 * them, along with rental income). Returns the resolution plus explicit
 * diagnostics for age-only items whose DOB is invalid.
 */
export const resolveOtherIncomeInflows = (
  context: CompiledScenarioContext,
  dateOfBirth: string | null | undefined
): OtherIncomeResolution => {
  const inflows: ResolvedInflow[] = [];
  const diagnostics: string[] = [];

  for (const item of context.global.cashflowItems) {
    if (!item.enabled || item.direction !== 'inflow') {
      continue;
    }
    // Property sale/proceeds are asset disposition (stream H), not ordinary income.
    if (item.category === 'home_real_estate') {
      continue;
    }
    const window = resolveInflowWindow(item, 'Cashflow item', item.id, dateOfBirth, diagnostics);
    if (!window) {
      continue;
    }
    inflows.push({
      id: `cashflow:${item.id}`,
      source: 'cashflow',
      label: item.label,
      accountId: typeof item.accountId === 'string' ? item.accountId.trim() : '',
      amountDollars: Math.max(0, item.amount),
      startYearMonth: window.startYearMonth,
      endYearMonth: item.cadence === 'recurring' ? window.endYearMonth : null,
      oneTime: item.cadence !== 'recurring'
    });
  }

  for (const event of context.global.lifeEvents) {
    if (!event.enabled || event.direction !== 'inflow') {
      continue;
    }
    // Only generic income events; housing/career/spending events are owned elsewhere.
    if (event.type !== 'custom_income') {
      continue;
    }
    const window = resolveInflowWindow(event, 'Life event', event.id, dateOfBirth, diagnostics);
    if (!window) {
      continue;
    }
    inflows.push({
      id: `life:${event.id}`,
      source: 'lifeEvent',
      label: event.label,
      accountId: typeof event.accountId === 'string' ? event.accountId.trim() : '',
      amountDollars: Math.max(0, event.amount),
      startYearMonth: window.startYearMonth,
      endYearMonth: event.cadence === 'recurring' ? window.endYearMonth : null,
      oneTime: event.cadence !== 'recurring'
    });
  }

  return { inflows, diagnostics };
};

/** Cents due from the resolved inflows in `yearMonth` (`0` when none are due). */
export const resolveOtherIncomeCentsForMonth = (
  resolution: OtherIncomeResolution,
  yearMonth: YearMonth
): Cents => {
  const parsed = parseYearMonth(yearMonth);
  const monthOfYear = parsed ? parsed.month : 1;
  const ordinal = toMonthOrdinal(yearMonth);
  let total = 0;
  for (const inflow of resolution.inflows) {
    const startOrdinal = toMonthOrdinal(inflow.startYearMonth);
    if (ordinal < startOrdinal) {
      continue;
    }
    if (inflow.oneTime) {
      if (ordinal === startOrdinal) {
        total += dollarsToCents(inflow.amountDollars);
      }
      continue;
    }
    if (inflow.endYearMonth !== null && ordinal > toMonthOrdinal(inflow.endYearMonth)) {
      continue;
    }
    total += monthlyCentsFromAnnualDollars(inflow.amountDollars, monthOfYear);
  }
  return total;
};

// ---------------------------------------------------------------------------
// Scheduled definitions (P3I.1)
// ---------------------------------------------------------------------------

interface CareerWindow {
  startYearMonth: YearMonth;
  endYearMonth: YearMonth;
}

/** `true` when any career/plan source line explicitly configures a positive cap. */
const hasConfiguredCaps = (context: CompiledScenarioContext): boolean => {
  const lineHasCap = (line: CareerSourceLine): boolean =>
    line.enabled &&
    Math.max(0, line.maxBalance ?? 0) > 0 &&
    typeof line.sourceId === 'string' &&
    line.sourceId.trim().length > 0;
  for (const career of context.careers) {
    const entry = career.entry;
    if ((entry.depositPlan?.allocations ?? []).some(lineHasCap)) {
      return true;
    }
    if ((entry.sourceLines ?? []).some(lineHasCap)) {
      return true;
    }
    for (const plan of entry.payPlans ?? []) {
      if ((plan.depositPlan?.allocations ?? []).some(lineHasCap) || (plan.sourceLines ?? []).some(lineHasCap)) {
        return true;
      }
    }
  }
  return false;
};

/** `true` when any `context.global` inflow is configured (valid or age-only). */
const hasConfiguredInflows = (context: CompiledScenarioContext): boolean =>
  context.global.cashflowItems.some(
    (item) => item.enabled && item.direction === 'inflow' && item.category !== 'home_real_estate'
  ) ||
  context.global.lifeEvents.some(
    (event) => event.enabled && event.direction === 'inflow' && event.type === 'custom_income'
  );

/**
 * Emits the stream-I recurring `EventDefinition`s: one monthly `income` definition
 * per active career (namespaced `income:<careerId>`), a `cap`-phase definition
 * when any source line explicitly configures a cap (`income:cap`), and one
 * `income`-phase definition for dated other-income inflows when any are
 * configured (`income:other`). Payroll and inflow definitions share the income
 * phase; the cap definition sorts into the later `cap` phase, so incoming
 * deposits always precede existing-excess rerouting.
 *
 * `options.dateOfBirth` is required to schedule age-only inflows; it must match
 * the `dateOfBirth` later handed to {@link createIncomeHandlers}.
 */
export const buildIncomeEventDefinitions = (
  context: CompiledScenarioContext,
  options?: { dateOfBirth?: string | null }
): EventDefinition[] => {
  const windows = new Map<string, CareerWindow>();
  for (const interval of context.careerIntervals) {
    const existing = windows.get(interval.careerId);
    if (!existing) {
      windows.set(interval.careerId, {
        startYearMonth: interval.startYearMonth,
        endYearMonth: interval.endYearMonth
      });
      continue;
    }
    if (toMonthOrdinal(interval.startYearMonth) < toMonthOrdinal(existing.startYearMonth)) {
      existing.startYearMonth = interval.startYearMonth;
    }
    if (toMonthOrdinal(interval.endYearMonth) > toMonthOrdinal(existing.endYearMonth)) {
      existing.endYearMonth = interval.endYearMonth;
    }
  }

  const definitions: EventDefinition[] = [];
  for (const [careerId, window] of windows) {
    definitions.push({
      definitionId: `income:${careerId}`,
      phase: 'income',
      purpose: INCOME_EVENT_PURPOSE,
      priority: 0,
      recurrence: {
        frequency: 'monthly',
        startDate: `${window.startYearMonth}-01`,
        endDate: endOfMonthDate(window.endYearMonth),
        dayOfMonth: 1
      },
      resolveTarget: (execution: EventExecutionContext): Cents => {
        if (execution.context.getActiveCareer(execution.yearMonth)?.careerId !== careerId) {
          return 0;
        }
        return resolveMonthlyGrossCents(execution.context, execution.yearMonth);
      },
      isActive: (execution: EventExecutionContext): boolean =>
        execution.context.getActiveCareer(execution.yearMonth)?.careerId === careerId,
      handlerId: INCOME_HANDLER_ID
    });
  }

  const horizonStart = `${context.metadata.startYearMonth}-01`;
  const horizonEnd = context.metadata.endDate;

  if (hasConfiguredCaps(context)) {
    definitions.push({
      definitionId: 'income:cap',
      phase: 'cap',
      purpose: INCOME_CAP_EVENT_PURPOSE,
      priority: 0,
      recurrence: { frequency: 'monthly', startDate: horizonStart, endDate: horizonEnd, dayOfMonth: 1 },
      // The cap handler resolves its state-aware excess per month; a definition
      // target of 0 keeps the scheduler resolver side-effect free.
      resolveTarget: (): Cents => 0,
      handlerId: INCOME_CAP_HANDLER_ID
    });
  }

  if (hasConfiguredInflows(context)) {
    const resolution = resolveOtherIncomeInflows(context, options?.dateOfBirth ?? null);
    definitions.push({
      definitionId: 'income:other',
      phase: 'income',
      purpose: INCOME_OTHER_EVENT_PURPOSE,
      priority: 1,
      recurrence: { frequency: 'monthly', startDate: horizonStart, endDate: horizonEnd, dayOfMonth: 1 },
      resolveTarget: (execution: EventExecutionContext): Cents =>
        resolveOtherIncomeCentsForMonth(resolution, execution.yearMonth),
      handlerId: INCOME_OTHER_HANDLER_ID
    });
  }

  return definitions;
};

// ---------------------------------------------------------------------------
// Handler (P3I.2 / P3I.3 / P3I.4 / P3I.5)
// ---------------------------------------------------------------------------

type OverflowVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** A restricted account may not have money rerouted *out of* it (no bypass). */
const isRestrictedAccount = (deps: ProjectionHandlerDependencies, accountId: string): boolean => {
  const note = deps.context.getAccount(accountId)?.withdrawalPolicy?.restrictionNote;
  return typeof note === 'string' && note.trim().length > 0;
};

/**
 * Validates one configured overflow edge. Missing/self destinations and cycles
 * are always rejected; rerouting out of a restricted source is rejected only for
 * the existing-excess pass (`checkSourceRestriction`), never for an incoming
 * deposit (the money was already destined for the account).
 */
const validateOverflowEdge = (
  sourceAccountId: string,
  overflowAccountId: string,
  capByAccount: ReadonlyMap<string, CapTarget>,
  deps: ProjectionHandlerDependencies,
  checkSourceRestriction: boolean
): OverflowVerdict => {
  if (!overflowAccountId) {
    return { ok: false, reason: 'no overflow destination is configured' };
  }
  if (overflowAccountId === sourceAccountId) {
    return { ok: false, reason: 'the overflow destination is the source account' };
  }
  if (!deps.state.getAccount(overflowAccountId)) {
    return { ok: false, reason: `overflow destination "${overflowAccountId}" is not an account` };
  }
  if (checkSourceRestriction && isRestrictedAccount(deps, sourceAccountId)) {
    return { ok: false, reason: `source account "${sourceAccountId}" is restricted` };
  }
  const seen = new Set<string>([sourceAccountId]);
  let cursor = overflowAccountId;
  let steps = 0;
  while (capByAccount.has(cursor)) {
    if (seen.has(cursor)) {
      return { ok: false, reason: 'the configured overflow path forms a cycle' };
    }
    seen.add(cursor);
    const next = capByAccount.get(cursor)?.overflowAccountId ?? '';
    if (!next) {
      break;
    }
    cursor = next;
    if ((steps += 1) > 64) {
      break;
    }
  }
  if (seen.has(cursor)) {
    return { ok: false, reason: 'the configured overflow path forms a cycle' };
  }
  return { ok: true };
};

/**
 * The D15 posting stamp for one income occurrence (P4.1a). Provenance is taken
 * **explicitly** from the executing event — never the wall clock or a fabricated
 * default: `occurrenceId`/`definitionId` link the journal row back to the
 * scheduler occurrence, `purpose` keeps payroll (`income`) distinct from the
 * cap pass (`incomeCap`) and dated inflows (`otherIncome`) — and therefore from
 * every withdrawal-withholding purpose (`retirement`, `planner`, …) so payroll
 * deductions are never aggregated as withdrawal taxes — and `date`/`phase`
 * place the row in the same-date audit order. `facts` is supplied **only** by the
 * payroll posting (the cap transfer and dated-inflow postings leave it absent);
 * it carries the executed gross/net/deduction/allocation breakdown.
 */
const incomePostingContext = (
  execution: EventExecutionContext,
  facts?: PostingFlowFacts
): PostingContext => ({
  occurrenceId: execution.event.occurrenceId,
  definitionId: execution.event.definitionId,
  purpose: execution.event.purpose,
  date: execution.date,
  phase: execution.event.phase,
  ...(facts !== undefined ? { facts } : {})
});

/**
 * Posts one month of payroll from the compiled plan, then returns the outcome.
 * Every touched entity is an account, so the declared conservation delta is the
 * exact sum of the assembled account deltas. A missing remainder destination
 * posts nothing (a schedule is never fabricated into another account). Incoming
 * cap overflow is applied while each allocation deposit posts (P3I.4). The
 * posting carries the executed {@link PostingFlowFacts} breakdown (D15): actual
 * taken tax/benefits/employee deposits, external employer deposits, employee
 * deductions retained in the remainder due to a missing destination, and the
 * per-allocation requested/executed net.
 */
const executeIncomePosting = (
  invocation: ProjectionHandlerInvocation,
  deps: ProjectionHandlerDependencies
): ProjectionExecutionResult => {
  const yearMonth = invocation.execution.yearMonth;
  const state = deps.state;
  const plan = compileMonthlyIncome(invocation.execution.context, yearMonth);
  if (!plan) {
    return {
      committed: false,
      diagnostics: [`No active career/paycheck for ${yearMonth}; no payroll was posted.`]
    };
  }
  if (plan.grossCents <= 0) {
    return { committed: false, diagnostics: plan.diagnostics.slice() };
  }

  const remainderId = plan.remainderAccountId;
  if (!remainderId || !state.getAccount(remainderId)) {
    return {
      committed: false,
      diagnostics: [
        ...plan.diagnostics,
        `Income remainder destination "${String(remainderId)}" is missing; no payroll was posted for ${yearMonth}.`
      ]
    };
  }

  const diagnostics: string[] = [...plan.diagnostics];
  const deltas = new Map<string, number>();
  const add = (accountId: string, cents: number): void => {
    if (cents === 0) {
      return;
    }
    deltas.set(accountId, (deltas.get(accountId) ?? 0) + cents);
  };

  // Gross pay is credited once, then deductions/allocations leave it.
  add(remainderId, plan.grossCents);

  // Executed payroll facts (D15): the actual taken amounts, not the plan's
  // desired amounts, so truncation/oversubscription is reflected in the audit.
  let payrollTaxCents = 0;
  let otherDeductionsCents = 0;
  let employeeRetirementCents = 0;
  let employeeHsaCents = 0;
  let unresolvedEmployeeCents = 0;

  let budget = plan.grossCents;
  const withhold = (postings: readonly IncomePosting[], category: string): void => {
    for (const posting of postings) {
      if (posting.cents <= 0) {
        continue;
      }
      const taken = Math.min(budget, posting.cents);
      budget -= taken;
      if (taken < posting.cents) {
        diagnostics.push(
          `${category} "${posting.label}" was truncated to ${taken} cents for ${yearMonth} because gross pay was exhausted.`
        );
      }
      if (taken <= 0) {
        continue;
      }
      // Employee retirement/HSA transfers an internal deposit to its own
      // account; taxes, health and other post-tax deductions leave the system.
      if (posting.kind === 'pretax' && posting.bucket) {
        if (posting.accountId && state.getAccount(posting.accountId)) {
          add(remainderId, -taken);
          add(posting.accountId, taken);
          if (posting.bucket === 'retirement') {
            employeeRetirementCents += taken;
          } else {
            employeeHsaCents += taken;
          }
        } else {
          // Unresolved internal destination: the taken cents stay in the
          // remainder account. They are never destroyed and never reallocated
          // (the plan.netPayCents allocation budget is unchanged), so the
          // money cannot become an invented extra allocation. It is real money
          // still held and is recorded as `unresolvedEmployeeCents` — never
          // relabeled as net pay.
          unresolvedEmployeeCents += taken;
          diagnostics.push(
            `${category} "${posting.label}" has no resolvable destination account; ${taken} cents remains in the remainder account for ${yearMonth}.`
          );
        }
      } else {
        add(remainderId, -taken);
        if (posting.kind === 'tax') {
          payrollTaxCents += taken;
        } else {
          otherDeductionsCents += taken;
        }
      }
    }
  };

  withhold(plan.taxes, 'Tax');
  withhold(plan.healthBenefits, 'Benefit');
  withhold(plan.otherBenefits, 'Post-tax deduction');
  withhold(plan.employeeRetirement, 'Retirement contribution');
  withhold(plan.employeeHsa, 'HSA contribution');

  // Employer match/deposit is separate external money, never deducted from net
  // and never part of gross conservation.
  let employerRetirementCents = 0;
  let employerHsaCents = 0;
  for (const posting of [...plan.employerRetirement, ...plan.employerHsa]) {
    if (posting.cents <= 0) {
      continue;
    }
    if (posting.accountId && state.getAccount(posting.accountId)) {
      add(posting.accountId, posting.cents);
      if (posting.bucket === 'retirement') {
        employerRetirementCents += posting.cents;
      } else {
        employerHsaCents += posting.cents;
      }
    } else {
      diagnostics.push(
        `Employer contribution "${posting.label}" has no resolvable destination account; ${posting.cents} cents was not deposited.`
      );
    }
  }

  let remainingNet = plan.netPayCents;
  const capByAccount = new Map(plan.capTargets.map((target) => [target.accountId, target]));
  const runningBalance = (accountId: string): number =>
    (state.getAccountBalanceCents(accountId) ?? 0) + (deltas.get(accountId) ?? 0);
  // Per-allocation audit: requested vs actually executed net deducted. Cap
  // overflow is internal routing of the same executed net, so it is not counted
  // again here.
  const allocationFacts: PostingFlowAllocation[] = [];

  for (const allocation of plan.allocations) {
    const requested = allocation.requestedCents;
    if (requested <= 0) {
      continue;
    }
    if (remainingNet <= 0) {
      allocationFacts.push({
        lineId: allocation.lineId,
        accountId: allocation.accountId,
        requestedCents: requested,
        executedCents: 0
      });
      diagnostics.push(
        `Allocation "${allocation.lineId}" of ${requested} cents is unmet for ${yearMonth}: net pay exhausted.`
      );
      continue;
    }
    if (!allocation.accountId || !state.getAccount(allocation.accountId)) {
      allocationFacts.push({
        lineId: allocation.lineId,
        accountId: allocation.accountId,
        requestedCents: requested,
        executedCents: 0
      });
      diagnostics.push(
        `Allocation "${allocation.lineId}" has no resolvable destination account; ${requested} cents remains in the remainder account.`
      );
      continue;
    }
    const deposited = Math.min(requested, remainingNet);
    add(remainderId, -deposited);
    remainingNet -= deposited;
    allocationFacts.push({
      lineId: allocation.lineId,
      accountId: allocation.accountId,
      requestedCents: requested,
      executedCents: deposited
    });

    const cap = capByAccount.get(allocation.accountId);
    if (!cap) {
      add(allocation.accountId, deposited);
    } else {
      const headroom = Math.max(0, cap.maxBalanceCents - runningBalance(allocation.accountId));
      const within = Math.min(deposited, headroom);
      const overflow = deposited - within;
      add(allocation.accountId, within);
      if (overflow > 0) {
        const verdict = validateOverflowEdge(allocation.accountId, cap.overflowAccountId, capByAccount, deps, false);
        if (verdict.ok) {
          add(cap.overflowAccountId, overflow);
          diagnostics.push(
            `[cap] incoming overflow ${overflow} cents routed from "${allocation.accountId}" to "${cap.overflowAccountId}" for ${yearMonth}.`
          );
        } else {
          // Missing/self/cycle: leave the money in the source account and warn.
          add(allocation.accountId, overflow);
          diagnostics.push(
            `[cap] incoming overflow ${overflow} cents for "${allocation.accountId}" was left in the account: ${verdict.reason}.`
          );
        }
      }
    }

    if (deposited < requested) {
      diagnostics.push(
        `Allocation "${allocation.lineId}" is unmet by ${requested - deposited} cents for ${yearMonth}: net pay exhausted.`
      );
    }
  }

  const accountChanges = [...deltas.entries()]
    .filter(([, deltaCents]) => deltaCents !== 0)
    .map(([accountId, deltaCents]) => ({ accountId, deltaCents }));

  if (accountChanges.length === 0) {
    return { committed: false, diagnostics };
  }

  // Executed payroll breakdown (D15). Gross reconciles exactly:
  //   gross = netPay + payrollTax + otherDeductions
  //         + (employeeRetirement + employeeHsa actually deposited)
  //         + unresolvedEmployee (retained in the remainder).
  // Employer deposits are external and excluded from gross.
  const facts: PostingFlowFacts = {
    grossEarningsCents: plan.grossCents,
    netPayCents: plan.netPayCents,
    payrollTaxCents,
    otherDeductionsCents,
    employeeRetirementCents,
    employeeHsaCents,
    employerRetirementCents,
    employerHsaCents,
    unresolvedEmployeeCents,
    allocations: allocationFacts
  };

  const expectedNetWorthDeltaCents = accountChanges.reduce((total, change) => total + change.deltaCents, 0);
  const result = state.commitChanges({
    revision: state.getRevision(),
    accountChanges,
    expectedNetWorthDeltaCents,
    posting: incomePostingContext(invocation.execution, facts)
  });
  if (!result.committed) {
    return {
      committed: false,
      diagnostics: [...diagnostics, ...result.errors.map((error) => error.message)]
    };
  }
  return { committed: true, plan: null, diagnostics };
};

/** Total existing-excess cents across the active plan's configured caps. */
const resolveCapExcessCents = (
  context: CompiledScenarioContext,
  yearMonth: YearMonth,
  deps: ProjectionHandlerDependencies
): Cents => {
  const resolved = resolveIncomeMonth(context, yearMonth);
  if (!resolved) {
    return 0;
  }
  let total = 0;
  for (const cap of buildCapTargets(resolved.allocations)) {
    const balance = deps.state.getAccountBalanceCents(cap.accountId);
    if (typeof balance === 'number' && balance > cap.maxBalanceCents) {
      total += balance - cap.maxBalanceCents;
    }
  }
  return total;
};

/**
 * Cap-phase existing-excess pass (P3I.4). It runs only for explicitly configured
 * caps (`maxBalance > 0`), moves an account's balance above the cap to its
 * validated overflow destination as one internal transfer (net-worth delta 0),
 * and records a separate `[cap]` audit line. Invalid destinations leave the
 * excess in place with a warning — never a general transfer.
 */
const executeCapPosting = (
  invocation: ProjectionHandlerInvocation,
  deps: ProjectionHandlerDependencies
): ProjectionExecutionResult => {
  const yearMonth = invocation.execution.yearMonth;
  const state = deps.state;
  const resolved = resolveIncomeMonth(invocation.execution.context, yearMonth);
  if (!resolved) {
    return { committed: false, diagnostics: [] };
  }
  const capTargets = buildCapTargets(resolved.allocations);
  if (capTargets.length === 0) {
    return { committed: false, diagnostics: [] };
  }

  const capByAccount = new Map(capTargets.map((target) => [target.accountId, target]));
  const diagnostics: string[] = [];
  const deltas = new Map<string, number>();
  const add = (accountId: string, cents: number): void => {
    if (cents !== 0) {
      deltas.set(accountId, (deltas.get(accountId) ?? 0) + cents);
    }
  };

  for (const cap of capTargets) {
    const balance = state.getAccountBalanceCents(cap.accountId);
    if (typeof balance !== 'number' || balance <= cap.maxBalanceCents) {
      continue;
    }
    const excess = balance - cap.maxBalanceCents;
    const verdict = validateOverflowEdge(cap.accountId, cap.overflowAccountId, capByAccount, deps, true);
    if (!verdict.ok) {
      diagnostics.push(
        `[cap] existing excess ${excess} cents for "${cap.accountId}" was not moved: ${verdict.reason}.`
      );
      continue;
    }
    add(cap.accountId, -excess);
    add(cap.overflowAccountId, excess);
    diagnostics.push(
      `[cap] existing excess ${excess} cents moved from "${cap.accountId}" to "${cap.overflowAccountId}" for ${yearMonth}.`
    );
  }

  const accountChanges = [...deltas.entries()]
    .filter(([, deltaCents]) => deltaCents !== 0)
    .map(([accountId, deltaCents]) => ({ accountId, deltaCents }));
  if (accountChanges.length === 0) {
    return { committed: false, diagnostics };
  }
  const expectedNetWorthDeltaCents = accountChanges.reduce((total, change) => total + change.deltaCents, 0);
  const result = state.commitChanges({
    revision: state.getRevision(),
    accountChanges,
    expectedNetWorthDeltaCents,
    posting: incomePostingContext(invocation.execution)
  });
  if (!result.committed) {
    return { committed: false, diagnostics: [...diagnostics, ...result.errors.map((error) => error.message)] };
  }
  return { committed: true, plan: null, diagnostics };
};

/**
 * Posts the month's dated other-income inflows (P3I.5) as positive deposits to
 * their configured accounts — one commit, true net-worth delta, no reservoir.
 * Each inflow is one-time (full amount at its month) or recurring (annual amount
 * split monthly). A missing/unknown destination is reported, never invented.
 */
const executeOtherIncomePosting = (
  invocation: ProjectionHandlerInvocation,
  deps: ProjectionHandlerDependencies
): ProjectionExecutionResult => {
  const yearMonth = invocation.execution.yearMonth;
  const state = deps.state;
  const resolution = resolveOtherIncomeInflows(invocation.execution.context, deps.dateOfBirth);
  const diagnostics: string[] = [...resolution.diagnostics];

  const parsed = parseYearMonth(yearMonth);
  const monthOfYear = parsed ? parsed.month : 1;
  const ordinal = toMonthOrdinal(yearMonth);
  const deltas = new Map<string, number>();
  let expectedNetWorthDeltaCents = 0;

  for (const inflow of resolution.inflows) {
    const startOrdinal = toMonthOrdinal(inflow.startYearMonth);
    if (ordinal < startOrdinal) {
      continue;
    }
    let cents: Cents;
    if (inflow.oneTime) {
      if (ordinal !== startOrdinal) {
        continue;
      }
      cents = dollarsToCents(inflow.amountDollars);
    } else {
      if (inflow.endYearMonth !== null && ordinal > toMonthOrdinal(inflow.endYearMonth)) {
        continue;
      }
      cents = monthlyCentsFromAnnualDollars(inflow.amountDollars, monthOfYear);
    }
    if (cents <= 0) {
      continue;
    }
    if (!inflow.accountId || !state.getAccount(inflow.accountId)) {
      diagnostics.push(
        `[other income] "${inflow.label}" has no resolvable destination account; ${cents} cents was not deposited.`
      );
      continue;
    }
    deltas.set(inflow.accountId, (deltas.get(inflow.accountId) ?? 0) + cents);
    expectedNetWorthDeltaCents += cents;
  }

  const accountChanges = [...deltas.entries()]
    .filter(([, deltaCents]) => deltaCents !== 0)
    .map(([accountId, deltaCents]) => ({ accountId, deltaCents }));
  if (accountChanges.length === 0) {
    return { committed: false, diagnostics };
  }
  const result = state.commitChanges({
    revision: state.getRevision(),
    accountChanges,
    expectedNetWorthDeltaCents,
    posting: incomePostingContext(invocation.execution)
  });
  if (!result.committed) {
    return { committed: false, diagnostics: [...diagnostics, ...result.errors.map((error) => error.message)] };
  }
  return { committed: true, plan: null, diagnostics };
};

/**
 * Builds the stream-I handlers: payroll (`income`), the cap-phase existing-excess
 * pass (`income-cap`), and dated other-income inflows (`income-other`). Each
 * recomputes its month's work at execution time and posts through
 * `commitChanges` exactly once.
 */
export const createIncomeHandlers = (
  deps: ProjectionHandlerDependencies
): ProjectionEventHandler[] => [
  {
    handlerId: INCOME_HANDLER_ID,
    resolveTarget: (execution) => resolveMonthlyGrossCents(execution.context, execution.yearMonth),
    execute: (invocation) => executeIncomePosting(invocation, deps)
  },
  {
    handlerId: INCOME_CAP_HANDLER_ID,
    resolveTarget: (execution) => resolveCapExcessCents(execution.context, execution.yearMonth, deps),
    execute: (invocation) => executeCapPosting(invocation, deps)
  },
  {
    handlerId: INCOME_OTHER_HANDLER_ID,
    resolveTarget: (execution) =>
      resolveOtherIncomeCentsForMonth(
        resolveOtherIncomeInflows(execution.context, deps.dateOfBirth),
        execution.yearMonth
      ),
    execute: (invocation) => executeOtherIncomePosting(invocation, deps)
  }
];
