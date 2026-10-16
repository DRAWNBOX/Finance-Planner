/**
 * P2.2 — Private kernel state and the sole atomic mutation route.
 *
 * Scope (phase2_plan.md P2.2, frozen_contracts.md P0.3.1/§P0.3.3 item 4,
 * architecture_specification.md §4 "Runtime state"):
 *
 * - Builds an **indexed, private, immutable-by-default** cents ledger for
 *   accounts, liabilities, properties and held acquisition deposits from the
 *   pure `resolveOpening` output (`src/engine/opening.ts`). Persisted config is
 *   dollars; runtime state is integer cents (RV28/ADR-010). Dollars are
 *   converted once at this posting boundary via `dollarsToCents` from the
 *   P2.1 money lane (`src/engine/money.ts`) — this module is **not** a rounding
 *   owner and must never re-implement half-away-from-zero conversion.
 *   `dollarsToCents` throws on non-finite/unsafe input, which `buildState`
 *   surfaces as a `StateValidationError`.
 *
 * - Exposes indexed read access (`getRevision`, `getAccount(s)`, …,
 *   `getTotals`, `toSnapshot`) that never leaks a mutable map or setter.
 *
 * - `commitChanges(changeSet)` is the **sole** mutation entry. It validates the
 *   state revision, entity ownership, link integrity, nonnegative cash/debt/
 *   deposit/value and safe integer cents, then applies a **sparse** change set
 *   in place. A rejected change set (stale revision, unknown entity, negative
 *   result, unsafe cents, duplicate target, dangling mortgage link, an owned
 *   property retaining a deposit, a missing/unsafe conservation declaration, or
 *   a declared-vs-actual net-worth mismatch) makes **no mutation** and leaves
 *   the revision unchanged. Related account, liability and property/held-deposit
 *   effects commit **all or none** so an acquisition exchange cannot half-apply.
 *
 * - **Every meaningful (nonempty) commit must be stamped with a valid
 *   `posting` context** (P4.1a / D15). A commit missing/invalid stamp is rejected
 *   with `missing-posting` and no mutation. On success the state appends exactly
 *   one deep-frozen {@link PostingRecord} to its posting journal (see
 *   `./journal`) and exposes the complete trace via `getPostings()` plus
 *   append-only indexes by occurrence/definition/account/month. Empty or
 *   all-zero-delta change sets are **no-ops**: no revision bump, no journal row,
 *   and no posting required. The opening observation is never a posting.
 *
 * - **Every nonempty commit must declare `expectedNetWorthDeltaCents`** (external
 *   income/expense passes the true delta; an internal transfer passes `0`). The
 *   commit verifies `actual net-worth delta === declared` before applying, so an
 *   internal exchange cannot silently create or destroy net worth. Build-time and
 *   post-commit aggregate totals (including net worth) are checked as safe
 *   integers.
 *
 * - No per-event whole-ledger cloning: only entities named in the change set
 *   are replaced.
 *
 * Handoff contract to the funding (P2.4) and compiler (P2.5) lanes:
 *
 *   import { buildState, type EngineState, type StateChangeSet } from './engine/state';
 *   const state = buildState(compiledOpening);          // ResolvedOpening
 *   const result = state.commitChanges({
 *     revision: state.getRevision(),
 *     accountChanges: [...],
 *     expectedNetWorthDeltaCents: -grossDebitCents  // true delta; 0 for internal transfer
 *   });
 *   // result.committed === false → no mutation; result.errors explains why.
 *
 * `buildState` consumes the P2.1 `dollarsToCents(dollars) => integer cents`
 * export from `./money` (it throws on non-finite/unsafe input; the state layer
 * maps that to `StateValidationError`).
 */

import type { LiabilityKind, PropertyStatus } from '../types';
import type {
  OpeningAccountState,
  OpeningLiabilityState,
  OpeningPropertyState,
  ResolvedOpening
} from './opening';
import { dollarsToCents } from './money';
import { PostingJournal, postingContextProblem, postingFactsProblem } from './journal';
import type { PostingContext, PostingRecord } from './journal';

/** A liability kind as observed at runtime; snapshot-only debts stay `'unknown'`. */
export type RuntimeLiabilityKind = LiabilityKind | 'unknown';

/** Immutable account balance (integer cents, >= 0). */
export interface AccountState {
  readonly accountId: string;
  readonly balanceCents: number;
}

/** Immutable debt state (integer cents; every component >= 0, positive = debt). */
export interface LiabilityState {
  readonly liabilityId: string;
  readonly kind: RuntimeLiabilityKind;
  readonly principalCents: number;
  readonly accruedInterestCents: number;
  readonly feesCents: number;
}

/** Immutable property state, including the held acquisition deposit (integer cents). */
export interface PropertyState {
  readonly propertyId: string;
  readonly valueCents: number;
  readonly mortgageId: string | null;
  readonly status: PropertyStatus;
  /** Non-liquid acquisition deposit held toward this property; counted once in assets. */
  readonly acquisitionDepositCents: number;
  readonly completedDate: string | null;
}

/** Aggregate cents view for asset/liability reconciliation. */
export interface StateTotals {
  /** Accounts + property values + held acquisition deposits. */
  readonly assetsCents: number;
  readonly accountCents: number;
  readonly propertyValueCents: number;
  readonly heldDepositCents: number;
  /** Principal + accrued interest + fees. */
  readonly liabilityCents: number;
  /** `assetsCents − liabilityCents`. */
  readonly netWorthCents: number;
}

/** Deep-frozen plain snapshot; never aliases the live state. */
export interface StateSnapshot {
  readonly revision: number;
  readonly accounts: readonly AccountState[];
  readonly liabilities: readonly LiabilityState[];
  readonly properties: readonly PropertyState[];
}

/** Sparse account delta: replaces only this account's balance. */
export interface AccountChange {
  readonly accountId: string;
  /** Signed integer-cent delta applied to the current balance. */
  readonly deltaCents: number;
}

/** Sparse liability delta (or creation with `create: true`). */
export interface LiabilityChange {
  readonly liabilityId: string;
  /** Create the liability; requires `kind`. Initial deltas must be nonnegative. */
  readonly create?: boolean;
  /** Required when `create` is true. */
  readonly kind?: LiabilityKind;
  readonly principalDeltaCents?: number;
  readonly accruedInterestDeltaCents?: number;
  readonly feesDeltaCents?: number;
}

/** Sparse property/deposit delta (or creation with `create: true`). */
export interface PropertyChange {
  readonly propertyId: string;
  /** Create the property if absent (default status `'pending'`). */
  readonly create?: boolean;
  /** Lifecycle status for a created property. */
  readonly status?: PropertyStatus;
  readonly valueDeltaCents?: number;
  readonly acquisitionDepositDeltaCents?: number;
  /** Replaces the linked mortgage liability; `null` clears it. */
  readonly mortgageId?: string | null;
  readonly completedDate?: string | null;
}

/**
 * One atomic transaction. Every array is sparse — only named entities change.
 * The set applies in full or not at all against `revision`.
 */
export interface StateChangeSet {
  /** Revision the change set was prepared against; a stale set is rejected. */
  readonly revision: number;
  readonly accountChanges?: readonly AccountChange[];
  readonly liabilityChanges?: readonly LiabilityChange[];
  readonly propertyChanges?: readonly PropertyChange[];
  /**
   * Required on every **nonempty** commit: the exact net-worth delta of this
   * commit (`Δcash + ΔheldDeposit + ΔpropertyValue − Δliability`). External
   * income/expense declares its true delta; an internal exchange (deposit
   * funding, acquisition completion) declares `0`. Commits that change nothing
   * may omit it. A missing or non-safe declaration is rejected without mutation,
   * and the declared value must equal the actual delta.
   */
  readonly expectedNetWorthDeltaCents?: number;
  /**
   * Required on every **meaningful** (nonempty) commit (P4.1a / D15): provenance
   * for the posting journal. Optional at the type level so an empty/all-zero
   * no-op commit can omit it; a meaningful commit without a valid context is
   * rejected with `missing-posting` and no mutation. Use phase `'opening'` only
   * for a reporting-side opening observation, which is never committed here.
   */
  readonly posting?: PostingContext;
}

export type StateErrorCode =
  | 'stale-revision'
  | 'unknown-entity'
  | 'entity-exists'
  | 'missing-creation-data'
  | 'duplicate-change'
  | 'nonfinite-amount'
  | 'unsafe-amount'
  | 'unsafe-total'
  | 'negative-balance'
  | 'unknown-mortgage-link'
  | 'deposit-with-owned-property'
  | 'missing-conservation-declaration'
  | 'conservation-mismatch'
  | 'missing-posting'
  | 'invalid-posting';

export type StateEntityKind = 'state' | 'account' | 'liability' | 'property';

/** A single rejected-change reason. Presentation/ordering is deterministic. */
export interface StateError {
  readonly code: StateErrorCode;
  readonly entity: StateEntityKind;
  readonly id?: string;
  readonly message: string;
}

/** Result of a `commitChanges` attempt. Rejected attempts never mutate. */
export interface CommitResult {
  readonly committed: boolean;
  /** Revision after the attempt (unchanged when rejected or a no-op). */
  readonly revision: number;
  /** Populated only when `committed === false`. */
  readonly errors: readonly StateError[];
  /**
   * True when the change set was empty or all of its deltas were zero: it was
   * accepted but changed nothing, so no revision bump and no posting row.
   */
  readonly noop: boolean;
}

/** Read-only kernel state handle. No public mutable map or setter is exposed. */
export interface EngineState {
  getRevision(): number;
  getAccount(accountId: string): AccountState | undefined;
  getAccountBalanceCents(accountId: string): number | undefined;
  getAccounts(): readonly AccountState[];
  getLiability(liabilityId: string): LiabilityState | undefined;
  getLiabilities(): readonly LiabilityState[];
  getProperty(propertyId: string): PropertyState | undefined;
  getProperties(): readonly PropertyState[];
  getTotals(): StateTotals;
  toSnapshot(): StateSnapshot;
  /** Build-time diagnostics (dangling links, unconfigured observations). */
  getDiagnostics(): readonly string[];
  /** The complete, immutable posting trace, oldest first (D15). */
  getPostings(): readonly PostingRecord[];
  /** Postings linked to a stable funding/occurrence id (append-only index). */
  getPostingsByOccurrence(occurrenceId: string): readonly PostingRecord[];
  /** Postings linked to a scheduler definition id (append-only index). */
  getPostingsByDefinition(definitionId: string): readonly PostingRecord[];
  /** Postings that touched an account (append-only index). */
  getPostingsByAccount(accountId: string): readonly PostingRecord[];
  /** Postings dated within `yearMonth` (`YYYY-MM`; append-only index). */
  getPostingsByMonth(yearMonth: string): readonly PostingRecord[];
  /** The sole mutation entry point. */
  commitChanges(changeSet: StateChangeSet): CommitResult;
}

/** Thrown by `buildState` when opening config cannot be represented as safe cents. */
export class StateValidationError extends Error {
  readonly code: StateErrorCode;
  readonly entity: StateEntityKind;
  readonly id?: string;

  constructor(code: StateErrorCode, entity: StateEntityKind, id: string | undefined, message: string) {
    super(message);
    this.name = 'StateValidationError';
    this.code = code;
    this.entity = entity;
    this.id = id;
  }
}

const isSafeCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

/**
 * A change set is **meaningful** when at least one leg would actually alter
 * state: a nonzero account delta, a liability creation or nonzero component, or
 * a property creation/delta/link/status/completion change. Empty or all-zero
 * sets are no-ops (D15): no revision bump, no journal row, no posting required.
 */
const isMeaningfulChangeSet = (
  accountChanges: readonly AccountChange[],
  liabilityChanges: readonly LiabilityChange[],
  propertyChanges: readonly PropertyChange[]
): boolean => {
  for (const change of accountChanges) {
    if (change.deltaCents !== 0) {
      return true;
    }
  }
  for (const change of liabilityChanges) {
    if (
      change.create === true ||
      (change.principalDeltaCents ?? 0) !== 0 ||
      (change.accruedInterestDeltaCents ?? 0) !== 0 ||
      (change.feesDeltaCents ?? 0) !== 0
    ) {
      return true;
    }
  }
  for (const change of propertyChanges) {
    if (
      change.create === true ||
      (change.valueDeltaCents ?? 0) !== 0 ||
      (change.acquisitionDepositDeltaCents ?? 0) !== 0 ||
      change.mortgageId !== undefined ||
      change.status !== undefined ||
      change.completedDate !== undefined
    ) {
      return true;
    }
  }
  return false;
};

const freezeAccount = (account: AccountState): AccountState => Object.freeze(account);

const freezeLiability = (liability: LiabilityState): LiabilityState => Object.freeze(liability);

const freezeProperty = (property: PropertyState): PropertyState => Object.freeze(property);

const freezeList = <T>(items: T[]): readonly T[] => Object.freeze(items);

const byId = <T>(key: keyof T): ((a: T, b: T) => number) => (a, b) =>
  String(a[key]).localeCompare(String(b[key]));

/** Aggregate cents view over an account/liability/property collection. */
const sumTotals = (
  accounts: Iterable<AccountState>,
  liabilities: Iterable<LiabilityState>,
  properties: Iterable<PropertyState>
): StateTotals => {
  let accountCents = 0;
  for (const account of accounts) {
    accountCents += account.balanceCents;
  }
  let propertyValueCents = 0;
  let heldDepositCents = 0;
  for (const property of properties) {
    propertyValueCents += property.valueCents;
    heldDepositCents += property.acquisitionDepositCents;
  }
  let liabilityCents = 0;
  for (const liability of liabilities) {
    liabilityCents += liability.principalCents + liability.accruedInterestCents + liability.feesCents;
  }
  const assetsCents = accountCents + propertyValueCents + heldDepositCents;
  return {
    assetsCents,
    accountCents,
    propertyValueCents,
    heldDepositCents,
    liabilityCents,
    netWorthCents: assetsCents - liabilityCents
  };
};

/** Every aggregate component (including net worth) must remain a safe integer. */
const totalsAreSafe = (totals: StateTotals): boolean =>
  isSafeCents(totals.accountCents) &&
  isSafeCents(totals.propertyValueCents) &&
  isSafeCents(totals.heldDepositCents) &&
  isSafeCents(totals.assetsCents) &&
  isSafeCents(totals.liabilityCents) &&
  isSafeCents(totals.netWorthCents);

/** Converts a persisted dollar amount to safe nonnegative integer cents. */
const openingCents = (dollars: number, entity: StateEntityKind, id: string): number => {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars)) {
    throw new StateValidationError(
      'nonfinite-amount',
      entity,
      id,
      `Opening ${entity} "${id}" has a non-finite dollar amount (${String(dollars)}).`
    );
  }
  let cents: number;
  try {
    cents = dollarsToCents(dollars);
  } catch (error) {
    // `dollarsToCents` throws on non-finite/unsafe amounts; surface it as a
    // state-opening failure rather than a raw RangeError.
    throw new StateValidationError(
      'unsafe-amount',
      entity,
      id,
      `Opening ${entity} "${id}" (${dollars} dollars) is not representable as safe integer cents: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!isSafeCents(cents)) {
    throw new StateValidationError(
      'unsafe-amount',
      entity,
      id,
      `Opening ${entity} "${id}" converts to an unsafe cent amount (${String(cents)}).`
    );
  }
  if (cents < 0) {
    throw new StateValidationError(
      'negative-balance',
      entity,
      id,
      `Opening ${entity} "${id}" is negative (${cents} cents); negative balances are never debt.`
    );
  }
  return cents;
};

const validateOpeningAccounts = (accounts: readonly OpeningAccountState[]): Map<string, AccountState> => {
  const map = new Map<string, AccountState>();
  for (const account of accounts) {
    if (map.has(account.accountId)) {
      continue; // Duplicate opening IDs: keep the first deterministically.
    }
    map.set(
      account.accountId,
      freezeAccount({
        accountId: account.accountId,
        balanceCents: openingCents(account.openingBalance, 'account', account.accountId)
      })
    );
  }
  return map;
};

const validateOpeningLiabilities = (
  liabilities: readonly OpeningLiabilityState[]
): Map<string, LiabilityState> => {
  const map = new Map<string, LiabilityState>();
  for (const liability of liabilities) {
    if (map.has(liability.liabilityId)) {
      continue;
    }
    map.set(
      liability.liabilityId,
      freezeLiability({
        liabilityId: liability.liabilityId,
        kind: liability.kind,
        principalCents: openingCents(liability.openingBalance, 'liability', liability.liabilityId),
        accruedInterestCents: 0,
        feesCents: 0
      })
    );
  }
  return map;
};

const validateOpeningProperties = (
  properties: readonly OpeningPropertyState[],
  liabilities: Map<string, LiabilityState>,
  diagnostics: string[]
): Map<string, PropertyState> => {
  const map = new Map<string, PropertyState>();
  for (const property of properties) {
    if (map.has(property.propertyId)) {
      continue;
    }
    let mortgageId = property.debtLink ?? null;
    if (mortgageId !== null && !liabilities.has(mortgageId)) {
      diagnostics.push(
        `Property "${property.propertyId}" links mortgage "${mortgageId}" with no matching liability; link cleared.`
      );
      mortgageId = null;
    }
    map.set(
      property.propertyId,
      freezeProperty({
        propertyId: property.propertyId,
        valueCents: openingCents(property.value, 'property', property.propertyId),
        mortgageId,
        status: property.status,
        // Held acquisition deposits are runtime state, created by commits only.
        acquisitionDepositCents: 0,
        completedDate: null
      })
    );
  }
  return map;
};

class EngineStateImpl implements EngineState {
  #revision: number;
  #accounts: Map<string, AccountState>;
  #liabilities: Map<string, LiabilityState>;
  #properties: Map<string, PropertyState>;
  #diagnostics: readonly string[];
  #journal: PostingJournal;

  constructor(
    accounts: Map<string, AccountState>,
    liabilities: Map<string, LiabilityState>,
    properties: Map<string, PropertyState>,
    diagnostics: readonly string[]
  ) {
    this.#revision = 0;
    this.#accounts = accounts;
    this.#liabilities = liabilities;
    this.#properties = properties;
    this.#diagnostics = freezeList([...diagnostics]);
    this.#journal = new PostingJournal();
  }

  getRevision(): number {
    return this.#revision;
  }

  getAccount(accountId: string): AccountState | undefined {
    return this.#accounts.get(accountId);
  }

  getAccountBalanceCents(accountId: string): number | undefined {
    return this.#accounts.get(accountId)?.balanceCents;
  }

  getAccounts(): readonly AccountState[] {
    return freezeList([...this.#accounts.values()].sort(byId<AccountState>('accountId')));
  }

  getLiability(liabilityId: string): LiabilityState | undefined {
    return this.#liabilities.get(liabilityId);
  }

  getLiabilities(): readonly LiabilityState[] {
    return freezeList([...this.#liabilities.values()].sort(byId<LiabilityState>('liabilityId')));
  }

  getProperty(propertyId: string): PropertyState | undefined {
    return this.#properties.get(propertyId);
  }

  getProperties(): readonly PropertyState[] {
    return freezeList([...this.#properties.values()].sort(byId<PropertyState>('propertyId')));
  }

  getDiagnostics(): readonly string[] {
    return this.#diagnostics;
  }

  getTotals(): StateTotals {
    return sumTotals(this.#accounts.values(), this.#liabilities.values(), this.#properties.values());
  }

  toSnapshot(): StateSnapshot {
    return Object.freeze({
      revision: this.#revision,
      accounts: this.getAccounts(),
      liabilities: this.getLiabilities(),
      properties: this.getProperties()
    });
  }

  getPostings(): readonly PostingRecord[] {
    return this.#journal.getPostings();
  }

  getPostingsByOccurrence(occurrenceId: string): readonly PostingRecord[] {
    return this.#journal.getByOccurrence(occurrenceId);
  }

  getPostingsByDefinition(definitionId: string): readonly PostingRecord[] {
    return this.#journal.getByDefinition(definitionId);
  }

  getPostingsByAccount(accountId: string): readonly PostingRecord[] {
    return this.#journal.getByAccount(accountId);
  }

  getPostingsByMonth(yearMonth: string): readonly PostingRecord[] {
    return this.#journal.getByMonth(yearMonth);
  }

  commitChanges(changeSet: StateChangeSet): CommitResult {
    const revision = this.#revision;

    if (!isSafeCents(changeSet.revision) || changeSet.revision !== revision) {
      return {
        committed: false,
        noop: false,
        revision,
        errors: freezeList([
          {
            code: 'stale-revision',
            entity: 'state',
            message: `Change set revision ${String(changeSet.revision)} does not match state revision ${revision}.`
          }
        ])
      };
    }

    const accountChanges = changeSet.accountChanges ?? [];
    const liabilityChanges = changeSet.liabilityChanges ?? [];
    const propertyChanges = changeSet.propertyChanges ?? [];

    // Empty / all-zero-delta sets are no-ops: they never advance the revision,
    // never journal a row, and do not require a posting stamp (D15).
    if (!isMeaningfulChangeSet(accountChanges, liabilityChanges, propertyChanges)) {
      return { committed: true, noop: true, revision, errors: freezeList([]) };
    }

    const errors: StateError[] = [];

    // Every meaningful commit must be stamped with a valid posting context
    // before any ledger math; a missing/invalid stamp is a locked no-op (D15).
    const postingProblem = postingContextProblem(changeSet.posting);
    if (postingProblem !== null) {
      errors.push({ code: 'missing-posting', entity: 'state', message: postingProblem });
    } else {
      // Optional payroll facts (D15): when present they must reconcile; a
      // present-but-invalid payload is an invalid posting (no mutation).
      const factsProblem = postingFactsProblem((changeSet.posting as PostingContext).facts);
      if (factsProblem !== null) {
        errors.push({ code: 'invalid-posting', entity: 'state', message: factsProblem });
      }
    }

    // Duplicate targets within one set are ambiguous; reject before any math.
    this.#detectDuplicates(accountChanges, (change) => change.accountId, 'account', errors);
    this.#detectDuplicates(liabilityChanges, (change) => change.liabilityId, 'liability', errors);
    this.#detectDuplicates(propertyChanges, (change) => change.propertyId, 'property', errors);

    // Every meaningful commit must declare its exact net-worth delta: external
    // income/expense declares the true delta; internal transfers declare 0.
    const declaredDelta = changeSet.expectedNetWorthDeltaCents;
    if (declaredDelta === undefined) {
      errors.push({
        code: 'missing-conservation-declaration',
        entity: 'state',
        message:
          'A nonempty change set must declare expectedNetWorthDeltaCents (external income/expense = true delta; internal transfer = 0).'
      });
    } else if (!isSafeCents(declaredDelta)) {
      errors.push({
        code: 'unsafe-amount',
        entity: 'state',
        message: 'expectedNetWorthDeltaCents must be a safe integer cent amount.'
      });
    }

    const nextAccounts = this.#planAccounts(accountChanges, errors);
    const nextLiabilities = this.#planLiabilities(liabilityChanges, errors);
    const nextProperties = this.#planProperties(propertyChanges, errors);

    // Ownership of mortgage links across the prospective liability set.
    const liabilityIdsAfter = new Set(this.#liabilities.keys());
    for (const id of nextLiabilities.keys()) {
      liabilityIdsAfter.add(id);
    }
    for (const change of propertyChanges) {
      if (change.mortgageId !== undefined && change.mortgageId !== null && !liabilityIdsAfter.has(change.mortgageId)) {
        errors.push({
          code: 'unknown-mortgage-link',
          entity: 'property',
          id: change.propertyId,
          message: `Property "${change.propertyId}" links mortgage "${change.mortgageId}" which is not owned by the state.`
        });
      }
    }

    // A held acquisition deposit exists only while the property is pending; an
    // owned/sold property exchanges its deposit into value/debt atomically.
    for (const [id, property] of nextProperties) {
      if (property.status !== 'pending' && property.acquisitionDepositCents > 0) {
        errors.push({
          code: 'deposit-with-owned-property',
          entity: 'property',
          id,
          message: `Property "${id}" is ${property.status} but still holds a ${property.acquisitionDepositCents}-cent acquisition deposit.`
        });
      }
    }

    if (errors.length === 0) {
      // Safe-total validation after aggregation (P0.3.5), all totals incl net worth.
      const totals = this.#prospectiveTotals(nextAccounts, nextLiabilities, nextProperties);
      if (!totalsAreSafe(totals)) {
        errors.push({
          code: 'unsafe-total',
          entity: 'state',
          message: 'Committed aggregate exceeds the safe integer cent range.'
        });
      } else if (declaredDelta !== undefined) {
        // Conservation across cash + held deposit + property − liability.
        const current = this.getTotals();
        const actualDelta = totals.netWorthCents - current.netWorthCents;
        if (actualDelta !== declaredDelta) {
          errors.push({
            code: 'conservation-mismatch',
            entity: 'state',
            message: `Commit net-worth delta ${actualDelta} does not match the declared conservation delta ${declaredDelta}.`
          });
        }
      }
    }

    if (errors.length > 0) {
      return { committed: false, noop: false, revision, errors: freezeList(errors) };
    }

    // Apply sparsely: only touched entities are replaced.
    for (const [id, value] of nextAccounts) {
      this.#accounts.set(id, value);
    }
    for (const [id, value] of nextLiabilities) {
      this.#liabilities.set(id, value);
    }
    for (const [id, value] of nextProperties) {
      this.#properties.set(id, value);
    }
    this.#revision = revision + 1;

    // Journal exactly one deep-frozen record for the applied transaction. The
    // declared delta is defined here (a meaningful set without it was rejected)
    // and equals the actual delta (conservation was verified above).
    this.#journal.append({
      revision: this.#revision,
      posting: changeSet.posting as PostingContext,
      accountChanges,
      liabilityChanges,
      propertyChanges,
      expectedNetWorthDeltaCents: declaredDelta as number
    });

    return { committed: true, noop: false, revision: this.#revision, errors: freezeList([]) };
  }

  #detectDuplicates<T>(
    changes: readonly T[],
    keyOf: (change: T) => string,
    entity: StateEntityKind,
    errors: StateError[]
  ): void {
    const seen = new Set<string>();
    for (const change of changes) {
      const id = keyOf(change);
      if (seen.has(id)) {
        errors.push({
          code: 'duplicate-change',
          entity,
          id,
          message: `Change set targets ${entity} "${id}" more than once.`
        });
      }
      seen.add(id);
    }
  }

  #planAccounts(changes: readonly AccountChange[], errors: StateError[]): Map<string, AccountState> {
    const next = new Map<string, AccountState>();
    for (const change of changes) {
      const existing = this.#accounts.get(change.accountId);
      if (!existing) {
        errors.push({
          code: 'unknown-entity',
          entity: 'account',
          id: change.accountId,
          message: `Account "${change.accountId}" is not owned by the state.`
        });
        continue;
      }
      if (!isSafeCents(change.deltaCents)) {
        errors.push({
          code: 'unsafe-amount',
          entity: 'account',
          id: change.accountId,
          message: `Account "${change.accountId}" delta is not a safe integer cent amount.`
        });
        continue;
      }
      const balanceCents = existing.balanceCents + change.deltaCents;
      if (!isSafeCents(balanceCents)) {
        errors.push({
          code: 'unsafe-amount',
          entity: 'account',
          id: change.accountId,
          message: `Account "${change.accountId}" balance would exceed the safe integer cent range.`
        });
        continue;
      }
      if (balanceCents < 0) {
        errors.push({
          code: 'negative-balance',
          entity: 'account',
          id: change.accountId,
          message: `Account "${change.accountId}" would go negative (${balanceCents} cents).`
        });
        continue;
      }
      next.set(
        change.accountId,
        freezeAccount({ accountId: change.accountId, balanceCents })
      );
    }
    return next;
  }

  #planLiabilities(changes: readonly LiabilityChange[], errors: StateError[]): Map<string, LiabilityState> {
    const next = new Map<string, LiabilityState>();
    for (const change of changes) {
      const existing = this.#liabilities.get(change.liabilityId);
      if (!existing && !change.create) {
        errors.push({
          code: 'unknown-entity',
          entity: 'liability',
          id: change.liabilityId,
          message: `Liability "${change.liabilityId}" is not owned by the state.`
        });
        continue;
      }
      if (existing && change.create) {
        errors.push({
          code: 'entity-exists',
          entity: 'liability',
          id: change.liabilityId,
          message: `Liability "${change.liabilityId}" already exists and cannot be created.`
        });
        continue;
      }
      if (!existing && change.create && !change.kind) {
        errors.push({
          code: 'missing-creation-data',
          entity: 'liability',
          id: change.liabilityId,
          message: `Liability "${change.liabilityId}" cannot be created without a kind.`
        });
        continue;
      }

      const principalDelta = change.principalDeltaCents ?? 0;
      const interestDelta = change.accruedInterestDeltaCents ?? 0;
      const feesDelta = change.feesDeltaCents ?? 0;
      const deltas = [principalDelta, interestDelta, feesDelta];
      if (!deltas.every(isSafeCents)) {
        errors.push({
          code: 'unsafe-amount',
          entity: 'liability',
          id: change.liabilityId,
          message: `Liability "${change.liabilityId}" delta is not a safe integer cent amount.`
        });
        continue;
      }

      const basePrincipal = existing?.principalCents ?? 0;
      const baseInterest = existing?.accruedInterestCents ?? 0;
      const baseFees = existing?.feesCents ?? 0;
      const principalCents = basePrincipal + principalDelta;
      const accruedInterestCents = baseInterest + interestDelta;
      const feesCents = baseFees + feesDelta;

      if (![principalCents, accruedInterestCents, feesCents].every(isSafeCents)) {
        errors.push({
          code: 'unsafe-amount',
          entity: 'liability',
          id: change.liabilityId,
          message: `Liability "${change.liabilityId}" would exceed the safe integer cent range.`
        });
        continue;
      }
      if (principalCents < 0 || accruedInterestCents < 0 || feesCents < 0) {
        errors.push({
          code: 'negative-balance',
          entity: 'liability',
          id: change.liabilityId,
          message: `Liability "${change.liabilityId}" would go negative.`
        });
        continue;
      }

      next.set(
        change.liabilityId,
        freezeLiability({
          liabilityId: change.liabilityId,
          kind: existing?.kind ?? (change.kind as LiabilityKind),
          principalCents,
          accruedInterestCents,
          feesCents
        })
      );
    }
    return next;
  }

  #planProperties(changes: readonly PropertyChange[], errors: StateError[]): Map<string, PropertyState> {
    const next = new Map<string, PropertyState>();
    for (const change of changes) {
      const existing = this.#properties.get(change.propertyId);
      if (!existing && !change.create) {
        errors.push({
          code: 'unknown-entity',
          entity: 'property',
          id: change.propertyId,
          message: `Property "${change.propertyId}" is not owned by the state.`
        });
        continue;
      }
      if (existing && change.create) {
        errors.push({
          code: 'entity-exists',
          entity: 'property',
          id: change.propertyId,
          message: `Property "${change.propertyId}" already exists and cannot be created.`
        });
        continue;
      }

      const valueDelta = change.valueDeltaCents ?? 0;
      const depositDelta = change.acquisitionDepositDeltaCents ?? 0;
      if (!isSafeCents(valueDelta) || !isSafeCents(depositDelta)) {
        errors.push({
          code: 'unsafe-amount',
          entity: 'property',
          id: change.propertyId,
          message: `Property "${change.propertyId}" delta is not a safe integer cent amount.`
        });
        continue;
      }

      const valueCents = (existing?.valueCents ?? 0) + valueDelta;
      const acquisitionDepositCents = (existing?.acquisitionDepositCents ?? 0) + depositDelta;
      if (!isSafeCents(valueCents) || !isSafeCents(acquisitionDepositCents)) {
        errors.push({
          code: 'unsafe-amount',
          entity: 'property',
          id: change.propertyId,
          message: `Property "${change.propertyId}" would exceed the safe integer cent range.`
        });
        continue;
      }
      if (valueCents < 0 || acquisitionDepositCents < 0) {
        errors.push({
          code: 'negative-balance',
          entity: 'property',
          id: change.propertyId,
          message: `Property "${change.propertyId}" value or held deposit would go negative.`
        });
        continue;
      }

      next.set(
        change.propertyId,
        freezeProperty({
          propertyId: change.propertyId,
          valueCents,
          mortgageId:
            change.mortgageId === undefined ? (existing?.mortgageId ?? null) : change.mortgageId,
          status: change.status ?? existing?.status ?? 'pending',
          acquisitionDepositCents,
          completedDate:
            change.completedDate === undefined ? (existing?.completedDate ?? null) : change.completedDate
        })
      );
    }
    return next;
  }

  #prospectiveTotals(
    nextAccounts: Map<string, AccountState>,
    nextLiabilities: Map<string, LiabilityState>,
    nextProperties: Map<string, PropertyState>
  ): StateTotals {
    const accounts: AccountState[] = [];
    for (const [id, account] of this.#accounts) {
      accounts.push(nextAccounts.get(id) ?? account);
    }
    for (const [id, account] of nextAccounts) {
      if (!this.#accounts.has(id)) {
        accounts.push(account);
      }
    }

    const properties: PropertyState[] = [];
    for (const [id, property] of this.#properties) {
      properties.push(nextProperties.get(id) ?? property);
    }
    for (const [id, property] of nextProperties) {
      if (!this.#properties.has(id)) {
        properties.push(property);
      }
    }

    const liabilities: LiabilityState[] = [];
    for (const [id, liability] of this.#liabilities) {
      liabilities.push(nextLiabilities.get(id) ?? liability);
    }
    for (const [id, liability] of nextLiabilities) {
      if (!this.#liabilities.has(id)) {
        liabilities.push(liability);
      }
    }

    return sumTotals(accounts, liabilities, properties);
  }
}

/**
 * Builds the private cents state from a resolved opening observation. Throws
 * `StateValidationError` when an opening amount is non-finite, unsafe or
 * negative — invalid opening never becomes silent zero money.
 */
export const buildState = (opening: ResolvedOpening): EngineState => {
  const diagnostics: string[] = [];
  const accounts = validateOpeningAccounts(opening.accounts);
  const liabilities = validateOpeningLiabilities(opening.liabilities);
  const properties = validateOpeningProperties(opening.properties, liabilities, diagnostics);
  for (const diagnostic of opening.diagnostics) {
    diagnostics.push(diagnostic);
  }

  // Individually-safe openings can still aggregate into an unsafe total; reject
  // here so `getTotals` can never return an overflowing amount.
  const totals = sumTotals(accounts.values(), liabilities.values(), properties.values());
  if (!totalsAreSafe(totals)) {
    throw new StateValidationError(
      'unsafe-total',
      'state',
      undefined,
      'Opening aggregates (accounts + properties + deposits − liabilities) exceed the safe integer cent range.'
    );
  }

  return new EngineStateImpl(accounts, liabilities, properties, diagnostics);
};
