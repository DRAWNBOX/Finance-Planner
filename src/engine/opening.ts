/**
 * P1.5 — Opening-resolution contract (engine-internal, pure).
 *
 * Opening state is an **observation**: configured historical facts, keyed by
 * stable IDs, that the projection starts from. This module resolves the
 * scenario's configured accounts, liabilities and properties plus any recorded
 * `OpeningSnapshot` into a single immutable, provenance-labelled opening state.
 *
 * Contract (frozen_contracts.md P0.3.1 item 5 / P0.5, migration_plan.md
 * "Opening liability exactly-once contract"):
 *
 * - Account/property/liability values are keyed by stable IDs.
 * - Measurement metadata is preserved (`assetOnly` vs `assetsMinusLiabilities`).
 * - **Observed debt wins, including an observed `0`.** A snapshot entry for a
 *   liability ID is authoritative even when its balance is zero.
 * - **Configured debt is used once when no observation exists.** A configured
 *   `LiabilityDefinition.openingBalance` is never added on top of a snapshot
 *   entry, and a liability is never duplicated.
 * - **Historical net-worth entries remain `assetOnly`.** No liability is
 *   retroactively subtracted from a stored history total.
 * - **No speculative mortgage payment history and no loan proceeds.** Opening
 *   resolution never injects borrowed principal into account balances and never
 *   reconstructs past amortization; it only reports the observed/configured
 *   opening values.
 *
 * This module contains no financial math beyond summation, reads no wall clock,
 * mutates no input, and aliases no input arrays/objects into its result.
 */

import type {
  AccountDefinition,
  AccountWithdrawalPolicy,
  LiabilityDefinition,
  LiabilityKind,
  OpeningMeasurement,
  PropertyDefinition,
  PropertyStatus,
  Scenario
} from '../types';

/** Where an opening value came from: a recorded observation or the configured value. */
export type OpeningValueSource = 'observed' | 'configured';

/** A snapshot-only liability has no configured kind; it is surfaced honestly. */
export type OpeningLiabilityKind = LiabilityKind | 'unknown';

/** A snapshot-only account has no configured account type; never fabricated. */
export type OpeningAccountType = AccountDefinition['accountType'] | 'unknown';

/** Which observation the debt came from when `source === 'observed'`. */
export type OpeningDebtObservation = 'liability' | 'property';

export interface OpeningAccountState {
  accountId: string;
  label: string;
  /** `'unknown'` for an observed snapshot-only account with no configuration. */
  accountType: OpeningAccountType;
  /** Persisted dollars. */
  openingBalance: number;
  annualReturnRate: number;
  retirementAnnualReturnRate: number | null;
  withdrawalPolicy: AccountWithdrawalPolicy;
  displayOrder: number;
  color?: string;
  source: OpeningValueSource;
}

export interface OpeningLiabilityState {
  liabilityId: string;
  kind: OpeningLiabilityKind;
  label?: string;
  /** Persisted dollars; positive = debt. */
  openingBalance: number;
  source: OpeningValueSource;
  /**
   * Set when `source === 'observed'`: whether the debt was observed directly on
   * the liability record or on its linked property record.
   */
  observedFrom?: OpeningDebtObservation;
  linkedPropertyId?: string | null;
  annualInterestRate?: number;
}

export interface OpeningPropertyState {
  propertyId: string;
  label?: string;
  /** Persisted dollars; observed/configured opening value. */
  value: number;
  /** Observed linked debt on the snapshot property record, if present. */
  linkedDebtBalance?: number;
  debtLink?: string | null;
  status: PropertyStatus;
  requiredDownPayment: number;
  source: OpeningValueSource;
  /** Account IDs of configured down-payment funding events (empty for property-only). */
  fundingEventAccountIds: string[];
}

/** A historical net-worth observation is always asset-only; never reinterpreted. */
export interface OpeningHistoryObservation {
  id: string;
  date: string;
  measurement: 'assetOnly';
  totalNetWorth: number;
}

export interface ResolvedOpening {
  /** Date-only observation start. */
  date: string;
  measurement: OpeningMeasurement;
  hasSnapshot: boolean;
  sourceSnapshotId: string | null;
  accounts: OpeningAccountState[];
  liabilities: OpeningLiabilityState[];
  properties: OpeningPropertyState[];
  history: OpeningHistoryObservation[];
  diagnostics: string[];
}

export interface OpeningSummary {
  /** Sum of opening account balances + property values (dollars). */
  assets: number;
  /** Sum of opening liabilities (dollars, positive = debt). */
  liabilities: number;
  /** assets − liabilities (dollars). */
  netWorth: number;
  measurement: OpeningMeasurement;
  /** Informational: linked property debt recorded on snapshot property records. */
  propertyLinkedDebt: number;
}

const DEFAULT_OPENING_POLICY: AccountWithdrawalPolicy = {
  allowAutomaticFallback: true,
  withdrawalTaxRate: 0,
  penaltyRate: 0,
  restrictionNote: ''
};

/**
 * Resolves the opening state from configured accounts/liabilities/properties and
 * the optional recorded `OpeningSnapshot`. Pure: the caller's scenario is never
 * mutated and no returned value aliases an input object.
 */
export const resolveOpening = (scenario: Scenario): ResolvedOpening => {
  const netWorth = scenario.netWorth;
  const snapshot = netWorth?.openingSnapshot ?? null;
  const diagnostics: string[] = [];

  const date = snapshot?.date || netWorth?.asOfDate || '';
  const measurement: OpeningMeasurement = snapshot?.measurement ?? 'assetOnly';
  const hasSnapshot = Boolean(snapshot);
  const sourceSnapshotId = snapshot?.sourceSnapshotId ?? null;

  // --- Accounts ---------------------------------------------------------
  const configuredAccounts = netWorth?.accounts ?? [];
  const observedAccountBalances = new Map<string, number>(
    (snapshot?.accounts ?? []).map((value) => [value.accountId, value.balance])
  );

  const accounts: OpeningAccountState[] = configuredAccounts.map((account) => {
    const observed = observedAccountBalances.has(account.id);
    return {
      accountId: account.id,
      label: account.label,
      accountType: account.accountType,
      openingBalance: observed ? (observedAccountBalances.get(account.id) as number) : account.openingBalance,
      annualReturnRate: account.annualReturnRate,
      retirementAnnualReturnRate: account.retirementAnnualReturnRate,
      withdrawalPolicy: { ...account.withdrawalPolicy },
      displayOrder: account.displayOrder,
      color: account.color,
      source: observed ? 'observed' : 'configured'
    };
  });

  const configuredAccountIds = new Set(configuredAccounts.map((account) => account.id));
  (snapshot?.accounts ?? []).forEach((value) => {
    if (configuredAccountIds.has(value.accountId)) {
      return;
    }
    accounts.push({
      accountId: value.accountId,
      label: value.accountId,
      // No configuration to derive a type from; do not fabricate one.
      accountType: 'unknown',
      openingBalance: value.balance,
      annualReturnRate: 0,
      retirementAnnualReturnRate: null,
      withdrawalPolicy: { ...DEFAULT_OPENING_POLICY },
      displayOrder: accounts.length,
      source: 'observed'
    });
    diagnostics.push(`Opening snapshot account "${value.accountId}" has no account configuration.`);
  });

  // --- Properties (resolved first so property-linked debt reconciles once) ---
  const configuredProperties: PropertyDefinition[] = scenario.properties ?? [];
  const configuredPropertyById = new Map(configuredProperties.map((property) => [property.id, property]));
  const configuredPropertyIds = new Set(configuredProperties.map((property) => property.id));
  const observedPropertyDebt = new Map<string, number>();
  (snapshot?.properties ?? []).forEach((value) => {
    if (typeof value.debtBalance === 'number') {
      observedPropertyDebt.set(value.propertyId, value.debtBalance);
    }
  });

  const propertyLinkedToLiability = (liability: LiabilityDefinition): string | null => {
    const explicit = liability.linkedPropertyId ?? null;
    if (explicit && (configuredPropertyIds.has(explicit) || observedPropertyDebt.has(explicit))) {
      return explicit;
    }
    const viaDebtLink = configuredProperties.find((property) => property.debtLink === liability.id);
    return viaDebtLink ? viaDebtLink.id : null;
  };

  // --- Liabilities (observed debt wins, including 0; configured used once) ---
  const configuredLiabilities: LiabilityDefinition[] = scenario.liabilities ?? [];
  const observedLiabilityBalances = new Map<string, number>(
    (snapshot?.liabilities ?? []).map((value) => [value.liabilityId, value.balance])
  );

  /**
   * A configured liability that only finances a still-pending acquisition has no
   * opening debt: the future mortgage does not exist until its required down
   * payment is fully funded (ADR-020/CA09). Observed facts still win and are
   * counted once — a direct liability observation (even `0`) or observed property
   * debt short-circuits this. Resolved here so the pending-skip and the
   * diagnostics below agree exactly. A pending acquisition's configured link is
   * intentionally not carried as opening debt; the completion handler establishes
   * the property/mortgage link atomically when funding completes.
   */
  const isFuturePendingLiability = (
    liability: LiabilityDefinition,
    linkedPropertyId: string | null
  ): boolean =>
    linkedPropertyId !== null &&
    !observedLiabilityBalances.has(liability.id) &&
    !observedPropertyDebt.has(linkedPropertyId) &&
    configuredPropertyById.get(linkedPropertyId)?.status === 'pending';

  const liabilities: OpeningLiabilityState[] = [];
  configuredLiabilities.forEach((liability) => {
    const linkedPropertyId = propertyLinkedToLiability(liability);
    if (observedLiabilityBalances.has(liability.id)) {
      // A direct liability observation (even 0) is authoritative.
      liabilities.push({
        liabilityId: liability.id,
        kind: liability.kind,
        label: liability.label,
        openingBalance: observedLiabilityBalances.get(liability.id) as number,
        source: 'observed',
        observedFrom: 'liability',
        linkedPropertyId: liability.linkedPropertyId ?? linkedPropertyId,
        annualInterestRate: liability.annualInterestRate
      });
      return;
    }

    const propertyDebt = linkedPropertyId !== null ? observedPropertyDebt.get(linkedPropertyId) : undefined;
    if (typeof propertyDebt === 'number') {
      // The linked property's observed debt is this liability's observation; it is
      // counted here once and never synthesized again below.
      liabilities.push({
        liabilityId: liability.id,
        kind: liability.kind,
        label: liability.label,
        openingBalance: propertyDebt,
        source: 'observed',
        observedFrom: 'property',
        linkedPropertyId: liability.linkedPropertyId ?? linkedPropertyId,
        annualInterestRate: liability.annualInterestRate
      });
      return;
    }

    if (isFuturePendingLiability(liability, linkedPropertyId)) {
      // Future acquisition financing: no opening debt (and no liability record)
      // before complete funding. Skipped, not silently — diagnostics below note it.
      return;
    }

    liabilities.push({
      liabilityId: liability.id,
      kind: liability.kind,
      label: liability.label,
      // No observation anywhere: configured opening balance used exactly once.
      openingBalance: liability.openingBalance,
      source: 'configured',
      linkedPropertyId: liability.linkedPropertyId ?? null,
      annualInterestRate: liability.annualInterestRate
    });
  });

  const configuredLiabilityIds = new Set(configuredLiabilities.map((liability) => liability.id));
  const observedOnlyLiabilities: string[] = [];
  (snapshot?.liabilities ?? []).forEach((value) => {
    if (configuredLiabilityIds.has(value.liabilityId)) {
      return;
    }
    observedOnlyLiabilities.push(value.liabilityId);
    liabilities.push({
      liabilityId: value.liabilityId,
      kind: 'unknown',
      openingBalance: value.balance,
      source: 'observed',
      observedFrom: 'liability',
      linkedPropertyId: null
    });
  });
  if (observedOnlyLiabilities.length > 0) {
    diagnostics.push(
      `Opening snapshot records liabilities with no configured kind: ${observedOnlyLiabilities.join(', ')}.`
    );
  }
  configuredLiabilities.forEach((liability) => {
    const linkedPropertyId = propertyLinkedToLiability(liability);
    const represented =
      observedLiabilityBalances.has(liability.id) ||
      (linkedPropertyId !== null && observedPropertyDebt.has(linkedPropertyId));
    if (represented) {
      return;
    }
    if (isFuturePendingLiability(liability, linkedPropertyId)) {
      diagnostics.push(
        `Liability "${liability.id}" finances pending property "${linkedPropertyId}" and has no opening debt; configured financing applies only on completion.`
      );
      return;
    }
    diagnostics.push(
      `Liability "${liability.id}" has no opening snapshot entry; configured opening balance used once.`
    );
  });

  // Snapshot property debt with no linked liability is synthesized exactly once
  // under a stable `property:<id>` ID (an observation, never amortization).
  const propertyDebtSynthesized: string[] = [];
  const representedPropertyIds = new Set(
    liabilities
      .map((liability) => liability.linkedPropertyId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );
  const synthesizePropertyDebt = (propertyId: string, debtBalance: number): void => {
    if (representedPropertyIds.has(propertyId)) {
      return;
    }
    liabilities.push({
      liabilityId: `property:${propertyId}`,
      kind: 'mortgage',
      openingBalance: debtBalance,
      source: 'observed',
      observedFrom: 'property',
      linkedPropertyId: propertyId
    });
    representedPropertyIds.add(propertyId);
    propertyDebtSynthesized.push(propertyId);
  };
  configuredProperties.forEach((property) => {
    const debtBalance = observedPropertyDebt.get(property.id);
    if (typeof debtBalance === 'number') {
      synthesizePropertyDebt(property.id, debtBalance);
    }
  });

  // --- Properties -------------------------------------------------------
  const observedProperties = new Map<string, { value: number; debtBalance?: number }>(
    (snapshot?.properties ?? []).map((value) => [
      value.propertyId,
      { value: value.value, debtBalance: value.debtBalance }
    ])
  );

  const properties: OpeningPropertyState[] = configuredProperties.map((property) => {
    const observed = observedProperties.get(property.id);
    // An unobserved pending acquisition has no property yet: its opening value is
    // zero. The configured `value` is the future acquisition price, not an opening
    // fact. Observed values (even 0) always win. Identity + requiredDownPayment are
    // preserved unchanged for the completion handler.
    const value = observed ? observed.value : property.status === 'pending' ? 0 : property.value;
    return {
      propertyId: property.id,
      label: property.label,
      value,
      linkedDebtBalance: observed?.debtBalance,
      debtLink: property.debtLink ?? null,
      status: property.status,
      requiredDownPayment: property.requiredDownPayment,
      source: observed ? 'observed' : 'configured',
      fundingEventAccountIds: (property.fundingEvents ?? [])
        .map((event) => event.accountId ?? '')
        .filter((id): id is string => id.length > 0)
    };
  });

  (snapshot?.properties ?? []).forEach((value) => {
    if (configuredPropertyIds.has(value.propertyId)) {
      return;
    }
    properties.push({
      propertyId: value.propertyId,
      value: value.value,
      linkedDebtBalance: value.debtBalance,
      debtLink: null,
      status: 'owned',
      requiredDownPayment: 0,
      source: 'observed',
      fundingEventAccountIds: []
    });
    if (typeof value.debtBalance === 'number') {
      synthesizePropertyDebt(value.propertyId, value.debtBalance);
    }
    diagnostics.push(`Opening snapshot property "${value.propertyId}" has no property configuration.`);
  });

  if (propertyDebtSynthesized.length > 0) {
    diagnostics.push(
      `Opening snapshot property debt had no linked liability and was recorded once: ${propertyDebtSynthesized.join(', ')}.`
    );
  }

  // --- Historical observations (always asset-only) ----------------------
  const history: OpeningHistoryObservation[] = (netWorth?.history ?? []).map((entry) => ({
    id: entry.id,
    date: entry.date,
    measurement: 'assetOnly',
    // A stored history total is an asset-only observation; never subtract debt
    // from it retroactively.
    totalNetWorth: entry.totalNetWorth
  }));

  return {
    date,
    measurement,
    hasSnapshot,
    sourceSnapshotId,
    accounts,
    liabilities,
    properties,
    history,
    diagnostics
  };
};

/** Assets − liabilities for an already-resolved opening state. */
export const summarizeOpening = (opening: ResolvedOpening): OpeningSummary => {
  const assets =
    opening.accounts.reduce((sum, account) => sum + account.openingBalance, 0) +
    opening.properties.reduce((sum, property) => sum + property.value, 0);
  const liabilities = opening.liabilities.reduce((sum, liability) => sum + liability.openingBalance, 0);
  const propertyLinkedDebt = opening.properties.reduce(
    (sum, property) => sum + (property.linkedDebtBalance ?? 0),
    0
  );

  return {
    assets,
    liabilities,
    netWorth: assets - liabilities,
    measurement: opening.measurement,
    propertyLinkedDebt
  };
};

/** Opening balance per stable account ID (dollars) for a scenario. */
export const resolveOpeningAccountBalances = (scenario: Scenario): Record<string, number> => {
  const opening = resolveOpening(scenario);
  const balances: Record<string, number> = {};
  opening.accounts.forEach((account) => {
    balances[account.accountId] = account.openingBalance;
  });
  return balances;
};

/**
 * Historical net-worth observations resolved as asset-only. Provided separately
 * so reporting can label old history without reinterpreting it as net worth.
 */
export const resolveHistoricalObservations = (scenario: Scenario): OpeningHistoryObservation[] =>
  (scenario.netWorth?.history ?? []).map((entry) => ({
    id: entry.id,
    date: entry.date,
    measurement: 'assetOnly' as const,
    totalNetWorth: entry.totalNetWorth
  }));
