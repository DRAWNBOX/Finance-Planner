/**
 * P3D.1 / P3D.2 — Headless card processor (O, engine-internal).
 *
 * The **single owner** of the two canonical card products:
 *
 * 1. `OrdinaryCardSchedule` (`kind: 'expectedPayment'`) — an ordinary expected
 *    expense once per inclusive month from `startYearMonth` through
 *    `endYearMonth` (the factory default is `end = start + 11`, i.e. twelve
 *    payments). It is a pure scheduled expense: **no charges, no APR, no balance
 *    and no debt tracking**, so it executes even with no card debt at all.
 *
 * 2. `ZeroInterestCardPlan` (`kind: 'zeroInterestPayoff'`) — a permanent-0%
 *    liability identified by `liabilityId`. Its opening debt is read **only from
 *    kernel state**; `plan.initialBalance` is never re-injected, so a recorded
 *    observation (including an observed `0`) always wins and opening debt is
 *    never duplicated. Each scheduled month requests
 *    `ceil(remaining principal cents / remaining scheduled payment count)`,
 *    capped at the outstanding principal and recomputed after **actual funded**
 *    payments (early stop when the debt clears). A residual lump-sum payoff date
 *    defaults to the target date and its source to the plan's regular policy;
 *    when it coincides with the final installment exactly one remaining-principal
 *    request is issued, and a later payoff requests only the principal still
 *    outstanding (unfunded residual debt is retained with no retry).
 *
 * ### Handler seam (D10)
 *
 * {@link buildCardEventDefinitions} emits the recurring `EventDefinition`s and
 * {@link createCardHandlers} emits the matching `ProjectionEventHandler`s. A
 * handler resolves its net target **at execution time** from live state
 * (`resolveTarget(execution, deps)`) and posts strictly through
 * `quoteFunding`/`commitFunding`; a 0% funded payment reduces the related
 * liability principal by the **net actually funded** (never the desired
 * payment), and no path can drive cash negative (the funding/state owners
 * enforce it). A zero/unfunded target never fabricates a plan row.
 *
 * IDs are namespaced under `card:<planId>` with a mandatory phase and a stable
 * priority; only the relevant dates are scheduled (an ordinary plan's inclusive
 * month window, a 0% plan's installment window plus one residual payoff date).
 *
 * Authority: `refactor/phase3_plan.md` P3D.1/P3D.2 + D10/D13, `frozen_contracts.md`
 * P0.5.2, `architecture_specification.md` "Ordinary card and permanent-0%
 * mechanics", ADR-021, and the settled P2.1/P2.2/P2.4/P2.6 kernel lanes.
 */

import type { FundingPolicy, OrdinaryCardSchedule, ZeroInterestCardPlan } from '../types';
import type { CompiledScenarioContext } from './configuration';
import {
  endOfMonthDate,
  formatDateOnly,
  isValidYearMonth,
  lastDayOfMonth,
  parseYearMonth,
  toMonthOrdinal,
  type DateOnly,
  type YearMonth
} from './dates';
import { dollarsToCents, type Cents } from './money';
import type { FundingRequest } from './contracts';
import {
  commitFunding,
  quoteFunding,
  type CommitFundingOptions,
  type RelatedFundingContext
} from './funding';
import type { PostingContext } from './journal';
import type { EventDefinition, EventExecutionContext, EventPhase } from './scheduler';
import type {
  ProjectionEventHandler,
  ProjectionHandlerDependencies,
  ProjectionExecutionResult
} from './projection';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Event id / handler id namespace for every card product. */
export const CARD_ID_NAMESPACE = 'card:';

/** Every card occurrence is a mandatory obligation (P0.3.2). */
export const CARD_PHASE: EventPhase = 'mandatory';

/** Purpose string for an ordinary expected-payment occurrence. */
export const CARD_EXPECTED_PAYMENT_PURPOSE = 'card.expectedPayment';

/** Purpose string for a permanent-0% installment or residual payoff occurrence. */
export const CARD_ZERO_INTEREST_PURPOSE = 'card.zeroInterestPayoff';

/**
 * Stable same-date priorities. The residual payoff (100) executes before the
 * installment (101) so an early payoff clears the debt before that month's
 * installment, while a coincident payoff no-ops and lets the final installment
 * issue the single remaining-principal request.
 */
export const CARD_PAYOFF_PRIORITY = 100;
export const CARD_INSTALLMENT_PRIORITY = 101;
/** Ordinary expected payments share the payoff priority; plans never collide by date+id. */
export const CARD_EXPECTED_PAYMENT_PRIORITY = 100;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const clampPaymentDay = (day: number): number =>
  Number.isFinite(day) ? Math.min(31, Math.max(1, Math.floor(day))) : 1;

/** A valid day-31-clamped date inside `yearMonth`, or `null` when malformed. */
const dateInYearMonth = (yearMonth: YearMonth, day: number): DateOnly | null => {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) {
    return null;
  }
  const clamped = Math.min(clampPaymentDay(day), lastDayOfMonth(yearMonth));
  return formatDateOnly({ year: parsed.year, month: parsed.month, day: clamped });
};

/** Stable definition id for an ordinary schedule or a 0% installment. */
export const cardDefinitionId = (plan: OrdinaryCardSchedule | ZeroInterestCardPlan): string =>
  `${CARD_ID_NAMESPACE}${plan.id}`;

/** Stable definition id for a 0% residual payoff occurrence. */
export const cardPayoffDefinitionId = (plan: ZeroInterestCardPlan): string =>
  `${CARD_ID_NAMESPACE}${plan.id}:payoff`;

/** Stable handler id for an ordinary expected-payment schedule. */
export const cardExpectedPaymentHandlerId = (plan: OrdinaryCardSchedule): string =>
  `${CARD_ID_NAMESPACE}${plan.id}:expected`;

/** Stable handler id for the 0% adaptive installments. */
export const cardInstallmentHandlerId = (plan: ZeroInterestCardPlan): string =>
  `${CARD_ID_NAMESPACE}${plan.id}:installment`;

/** Stable handler id for the 0% residual payoff. */
export const cardPayoffHandlerId = (plan: ZeroInterestCardPlan): string =>
  `${CARD_ID_NAMESPACE}${plan.id}:payoff`;

/** Ordinary expected payment target in cents (persisted dollars → cents once). */
export const ordinaryCardTargetCents = (plan: OrdinaryCardSchedule): Cents => {
  if (typeof plan.amount !== 'number' || !Number.isFinite(plan.amount) || plan.amount <= 0) {
    return 0;
  }
  try {
    const cents = dollarsToCents(plan.amount);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : 0;
  } catch {
    return 0;
  }
};

/** The residual payoff month: explicit valid date, else the inclusive target. */
export const resolvePayoffYearMonth = (plan: ZeroInterestCardPlan): YearMonth =>
  typeof plan.payoffYearMonth === 'string' && isValidYearMonth(plan.payoffYearMonth)
    ? plan.payoffYearMonth
    : plan.targetYearMonth;

/**
 * Count of scheduled installments from `currentYearMonth` through
 * `targetYearMonth` inclusive (always `>= 1`). At the target month this is `1`,
 * so the final adaptive installment already equals the remaining principal.
 */
export const remainingScheduledInstallments = (
  targetYearMonth: YearMonth,
  currentYearMonth: YearMonth
): number => {
  if (!isValidYearMonth(targetYearMonth) || !isValidYearMonth(currentYearMonth)) {
    return 1;
  }
  const count = toMonthOrdinal(targetYearMonth) - toMonthOrdinal(currentYearMonth) + 1;
  return count > 0 ? count : 1;
};

/**
 * Adaptive ceiling-cent target: `ceil(remaining / remainingCount)` capped at the
 * outstanding principal. `remaining === 0` yields `0` (a no-op, never a plan).
 */
export const zeroInterestInstallmentTargetCents = (
  plan: ZeroInterestCardPlan,
  currentYearMonth: YearMonth,
  remainingPrincipalCents: number
): Cents => {
  if (!Number.isSafeInteger(remainingPrincipalCents) || remainingPrincipalCents <= 0) {
    return 0;
  }
  const count = remainingScheduledInstallments(plan.targetYearMonth, currentYearMonth);
  const target = Math.ceil(remainingPrincipalCents / count);
  return target > remainingPrincipalCents ? remainingPrincipalCents : target;
};

/**
 * Live principal of the 0% liability read from kernel state. The plan's
 * `initialBalance` is intentionally never consulted, so an observed opening
 * (including `0`) wins and opening debt is never duplicated.
 */
const remainingZeroInterestPrincipalCents = (
  deps: ProjectionHandlerDependencies,
  liabilityId: string
): number => {
  if (typeof liabilityId !== 'string' || liabilityId.length === 0) {
    return 0;
  }
  const liability = deps.state.getLiability(liabilityId);
  return liability ? liability.principalCents : 0;
};

const isOrdinaryPlanSchedulable = (plan: OrdinaryCardSchedule): boolean => {
  if (!isValidYearMonth(plan.startYearMonth) || !isValidYearMonth(plan.endYearMonth)) {
    return false;
  }
  return toMonthOrdinal(plan.endYearMonth) >= toMonthOrdinal(plan.startYearMonth);
};

const isZeroInterestPlanSchedulable = (plan: ZeroInterestCardPlan): boolean => {
  if (typeof plan.liabilityId !== 'string' || plan.liabilityId.length === 0) {
    return false;
  }
  if (!isValidYearMonth(plan.startYearMonth) || !isValidYearMonth(plan.targetYearMonth)) {
    return false;
  }
  return toMonthOrdinal(plan.targetYearMonth) >= toMonthOrdinal(plan.startYearMonth);
};

/** Ordered, deduped account ids from a funding policy (`'account:'`-stripped, no income). */
const normalizeFundingAccountOrder = (
  policy: FundingPolicy | null | undefined
): { primaryAccountId: string | null; fallbackAccountIds: string[] } => {
  const ids: string[] = [];
  const add = (raw: string | null | undefined): void => {
    if (typeof raw !== 'string') {
      return;
    }
    const stripped = raw.startsWith('account:') ? raw.slice('account:'.length) : raw;
    if (stripped.length === 0 || stripped === 'income') {
      return;
    }
    if (!ids.includes(stripped)) {
      ids.push(stripped);
    }
  };
  if (policy) {
    add(policy.primaryAccountId);
    for (const fallback of policy.fallbackAccountIds ?? []) {
      add(fallback);
    }
  }
  return { primaryAccountId: ids[0] ?? null, fallbackAccountIds: ids.slice(1) };
};

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------

const buildExpectedPaymentDefinition = (plan: OrdinaryCardSchedule): EventDefinition | null => {
  if (!isOrdinaryPlanSchedulable(plan)) {
    return null;
  }
  const startDate = dateInYearMonth(plan.startYearMonth, plan.paymentDay);
  if (!startDate) {
    return null;
  }
  return {
    definitionId: cardDefinitionId(plan),
    phase: CARD_PHASE,
    purpose: CARD_EXPECTED_PAYMENT_PURPOSE,
    priority: CARD_EXPECTED_PAYMENT_PRIORITY,
    handlerId: cardExpectedPaymentHandlerId(plan),
    recurrence: {
      frequency: 'monthly',
      startDate,
      endDate: endOfMonthDate(plan.endYearMonth),
      dayOfMonth: clampPaymentDay(plan.paymentDay)
    },
    // A pure constant expense: no state, no debt. The handler resolves it as well.
    resolveTarget: () => ordinaryCardTargetCents(plan)
  };
};

const buildInstallmentDefinition = (plan: ZeroInterestCardPlan): EventDefinition | null => {
  if (!isZeroInterestPlanSchedulable(plan)) {
    return null;
  }
  const startDate = dateInYearMonth(plan.startYearMonth, plan.paymentDay);
  if (!startDate) {
    return null;
  }
  return {
    definitionId: cardDefinitionId(plan),
    phase: CARD_PHASE,
    purpose: CARD_ZERO_INTEREST_PURPOSE,
    priority: CARD_INSTALLMENT_PRIORITY,
    handlerId: cardInstallmentHandlerId(plan),
    recurrence: {
      frequency: 'monthly',
      startDate,
      endDate: endOfMonthDate(plan.targetYearMonth),
      dayOfMonth: clampPaymentDay(plan.paymentDay)
    },
    // State-aware (live principal); zero when executed without the handler resolver.
    resolveTarget: () => 0
  };
};

const buildPayoffDefinition = (plan: ZeroInterestCardPlan): EventDefinition | null => {
  if (!isZeroInterestPlanSchedulable(plan)) {
    return null;
  }
  const payoffYearMonth = resolvePayoffYearMonth(plan);
  const date = dateInYearMonth(payoffYearMonth, plan.paymentDay);
  if (!date) {
    return null;
  }
  return {
    definitionId: cardPayoffDefinitionId(plan),
    phase: CARD_PHASE,
    purpose: CARD_ZERO_INTEREST_PURPOSE,
    priority: CARD_PAYOFF_PRIORITY,
    handlerId: cardPayoffHandlerId(plan),
    recurrence: { frequency: 'oneTime', startDate: date },
    // State-aware (live principal); zero when executed without the handler resolver.
    resolveTarget: () => 0
  };
};

/**
 * Recurring definitions for every enabled card plan in the **selected timeline's
 * local domains** (`context.domains.cardPlans`, never the global config):
 * inclusive monthly ordinary expenses, inclusive monthly 0% installments and one
 * 0% residual payoff date. Pure; no state is read. Card plans are timeline-local,
 * so a timeline switch swaps the plans wholesale (the base `Scenario.cardPlans`
 * is the implicit base timeline).
 */
export const buildCardEventDefinitions = (context: CompiledScenarioContext): EventDefinition[] => {
  const definitions: EventDefinition[] = [];
  for (const plan of context.domains.cardPlans) {
    if (!plan.enabled) {
      continue;
    }
    if (plan.kind === 'expectedPayment') {
      const definition = buildExpectedPaymentDefinition(plan);
      if (definition) {
        definitions.push(definition);
      }
      continue;
    }
    if (!isZeroInterestPlanSchedulable(plan)) {
      continue;
    }
    const installment = buildInstallmentDefinition(plan);
    if (installment) {
      definitions.push(installment);
    }
    const payoff = buildPayoffDefinition(plan);
    if (payoff) {
      definitions.push(payoff);
    }
  }
  return definitions;
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

interface CardFundingSpec {
  readonly purpose: string;
  readonly primaryAccountId: string | null;
  readonly fallbackAccountIds: readonly string[];
  /** When set, the funded net reduces this liability's principal (0% payoff). */
  readonly liabilityId: string | null;
}

/**
 * Quotes and commits one card funding request. A 0% liability's principal is
 * reduced by the **net actually funded** (capped at the live principal), and the
 * commit declares the matching conservation delta. A zero/unfunded target debits
 * nothing and yields no fabricated plan row.
 */
const postCardFunding = (
  deps: ProjectionHandlerDependencies,
  execution: EventExecutionContext,
  targetCents: Cents,
  spec: CardFundingSpec
): ProjectionExecutionResult => {
  if (!Number.isSafeInteger(targetCents) || targetCents <= 0) {
    return { committed: false, plan: null };
  }

  const request: FundingRequest = {
    id: execution.event.definitionId,
    occurrenceId: execution.event.occurrenceId,
    date: execution.date,
    requestedCents: targetCents,
    primaryAccountId: spec.primaryAccountId,
    fallbackAccountIds: [...spec.fallbackAccountIds],
    purpose: spec.purpose
  };

  const quoted = quoteFunding(deps.state, request, deps.accounts, deps.dateOfBirth, {
    globalDefaults: {
      primaryAccountId: deps.funding.global.primaryAccountId,
      fallbackAccountIds: [...deps.funding.global.fallbackAccountIds]
    }
  });
  if (!quoted.ok) {
    // A rejected quote still carries its own diagnostic (kept in `diagnostics`);
    // the quote is returned so the diagnostic travels with the handler outcome.
    return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
  }

  const liabilityId = spec.liabilityId;
  const prepareRelatedChanges = liabilityId
    ? (context: RelatedFundingContext) => {
        const liability = deps.state.getLiability(liabilityId);
        if (!liability) {
          return null;
        }
        const reduction = Math.min(context.executedNetCents, liability.principalCents);
        if (reduction <= 0) {
          return null;
        }
        return {
          liabilityChanges: [{ liabilityId, principalDeltaCents: -reduction }],
          netWorthAdjustmentCents: reduction
        };
      }
    : undefined;

  // D15: every funding commit carries explicit provenance taken from the
  // executing occurrence — never a default or fabricated stamp.
  const posting: PostingContext = {
    occurrenceId: execution.event.occurrenceId,
    definitionId: execution.event.definitionId,
    purpose: spec.purpose,
    date: execution.date,
    phase: execution.event.phase
  };
  const commitOptions: CommitFundingOptions & { posting: PostingContext } = {
    posting,
    ...(prepareRelatedChanges ? { prepareRelatedChanges } : {})
  };

  const result = commitFunding(deps.state, quoted.plan, commitOptions);
  // D16: return the full quote (funded or unfunded) so the facade records a
  // funding outcome from actual quote evidence, never only the committed plan.
  return {
    committed: result.committed,
    plan: result.plan,
    quote: quoted,
    diagnostics: result.errors.length > 0 ? result.errors.map((error) => error.message) : undefined
  };
};

const createExpectedPaymentHandler = (plan: OrdinaryCardSchedule): ProjectionEventHandler => {
  const order = normalizeFundingAccountOrder(plan.funding);
  return {
    handlerId: cardExpectedPaymentHandlerId(plan),
    resolveTarget: () => ordinaryCardTargetCents(plan),
    execute: ({ execution, targetCents, deps }) =>
      postCardFunding(deps, execution, targetCents, {
        purpose: CARD_EXPECTED_PAYMENT_PURPOSE,
        primaryAccountId: order.primaryAccountId,
        fallbackAccountIds: order.fallbackAccountIds,
        liabilityId: null
      })
  };
};

const createInstallmentHandler = (plan: ZeroInterestCardPlan): ProjectionEventHandler => {
  const order = normalizeFundingAccountOrder(plan.funding);
  return {
    handlerId: cardInstallmentHandlerId(plan),
    resolveTarget: (execution, deps) =>
      zeroInterestInstallmentTargetCents(
        plan,
        execution.yearMonth,
        remainingZeroInterestPrincipalCents(deps, plan.liabilityId)
      ),
    execute: ({ execution, targetCents, deps }) =>
      postCardFunding(deps, execution, targetCents, {
        purpose: CARD_ZERO_INTEREST_PURPOSE,
        primaryAccountId: order.primaryAccountId,
        fallbackAccountIds: order.fallbackAccountIds,
        liabilityId: plan.liabilityId
      })
  };
};

const createPayoffHandler = (plan: ZeroInterestCardPlan): ProjectionEventHandler => {
  const order = normalizeFundingAccountOrder(plan.payoffFunding ?? plan.funding);
  const coincidentWithFinalInstallment = resolvePayoffYearMonth(plan) === plan.targetYearMonth;
  return {
    handlerId: cardPayoffHandlerId(plan),
    resolveTarget: (_execution, deps) => {
      // The final adaptive installment already requests the full remaining
      // principal when one month remains; a coincident payoff must never emit a
      // second duplicate principal request.
      if (coincidentWithFinalInstallment) {
        return 0;
      }
      return remainingZeroInterestPrincipalCents(deps, plan.liabilityId);
    },
    execute: ({ execution, targetCents, deps }) =>
      postCardFunding(deps, execution, targetCents, {
        purpose: CARD_ZERO_INTEREST_PURPOSE,
        primaryAccountId: order.primaryAccountId,
        fallbackAccountIds: order.fallbackAccountIds,
        liabilityId: plan.liabilityId
      })
  };
};

/**
 * Phase-3 processors for every enabled card plan in the **selected timeline's
 * local domains** (`deps.context.domains.cardPlans`). Each handler resolves its
 * target from live state at execution time and posts through
 * `quoteFunding`/`commitFunding`; mutation happens only through
 * `state.commitChanges`.
 */
export const createCardHandlers = (deps: ProjectionHandlerDependencies): ProjectionEventHandler[] => {
  const handlers: ProjectionEventHandler[] = [];
  for (const plan of deps.context.domains.cardPlans) {
    if (!plan.enabled) {
      continue;
    }
    if (plan.kind === 'expectedPayment') {
      if (isOrdinaryPlanSchedulable(plan)) {
        handlers.push(createExpectedPaymentHandler(plan));
      }
      continue;
    }
    if (!isZeroInterestPlanSchedulable(plan)) {
      continue;
    }
    handlers.push(createInstallmentHandler(plan));
    handlers.push(createPayoffHandler(plan));
  }
  return handlers;
};
