import { createDefaultScenario } from './defaultScenario';
import { compilePaycheck, paycheckFromPaycheckInfo } from './paycheck';
import type {
  AccountDefinition,
  AccountTypePreset,
  AccountWithdrawalPolicy,
  AnyTrajectorySnapshot,
  CanonicalTrajectoryAnnualPoint,
  CanonicalTrajectoryContext,
  CanonicalTrajectorySnapshot,
  CareerDepositPlan,
  CareerEntry,
  CareerPlan,
  CareerPayPlan,
  CareerSourceLine,
  CardPlan,
  CashflowCadence,
  CashflowCategory,
  CashflowDirection,
  CashflowItem,
  CreditCard,
  CreditCardPaymentMode,
  DateMarker,
  ExpenseCategory,
  ExpenseEntry,
  ExpenseImportFileType,
  ExpenseImportSource,
  ExpenseImportStatus,
  ExpenseOriginType,
  ExpensesConfig,
  ExpenseTimelineUiState,
  FundingPolicy,
  HousingEntry,
  HousingFundingGroup,
  HousingType,
  HsaWithdrawalPolicy,
  LargePurchase,
  LiabilityDefinition,
  LiabilityKind,
  LifeEvent,
  LifeEventType,
  Loan,
  LongTermPurchase,
  LongTermPurchaseEndMode,
  MeasurementBasis,
  NetWorthConfig,
  NetWorthCustomAccount,
  NetWorthHistoryEntry,
  NetWorthHistoryProvenance,
  OpeningMeasurement,
  OpeningSnapshot,
  OpeningSnapshotAccountValue,
  OpeningSnapshotLiabilityValue,
  OpeningSnapshotPropertyValue,
  OrdinaryCardSchedule,
  PayFrequency,
  Paycheck,
  PaycheckCategory,
  PaycheckDepositBucket,
  PaycheckInfo,
  PaycheckLine,
  PaycheckLineKind,
  PlannerProvenance,
  PlannerSourceSign,
  PlanningStatus,
  PropertyDefinition,
  PropertyFundingEvent,
  PropertyKind,
  PropertyStatus,
  PurchaseCategory,
  RecurringEventCadence,
  RecurringEventRule,
  RecurringExpenseEvent,
  ResultContextMetadata,
  RetirementWithdrawalMode,
  RetirementWithdrawalSourceLine,
  Scenario,
  SourceLine,
  SourceLineMode,
  Timeline,
  TrajectorySnapshot,
  TrajectoryYear,
  WeeklyBalancePoint,
  WithdrawalMode,
  WithdrawalPlan,
  ZeroInterestCardPlan
} from './types';

/**
 * P1.3 canonical persistence codec.
 *
 * Pure, structural, allowlist-only: it never reads storage, never reads the wall
 * clock (the caller supplies a reference date), never mutates its input, and
 * performs no financial calculation or legacy financial conversion. Unknown and
 * obsolete keys are pruned by construction (every record is rebuilt from an
 * explicit field allowlist), including nested import/UI/trajectory shapes.
 * Marker resolution is intentionally NOT performed here (owned by commands).
 */

/**
 * Envelope schema version. v2 completed the D9/D24 save-format cutover: the
 * derived flat `CareerEntry.paycheckInfo` cache is no longer persisted (the
 * granular `paycheck` is the authority; `paycheckInfo` is re-derived on load).
 * v3 adds the G20/G22 ordered per-group `HousingEntry.fundingPolicies` override
 * map. The new field is optional (an absent group inherits the global default
 * policy and the legacy `*Source` scalar stays the read fallback), so older
 * payloads load losslessly; the bump exists so a **v2 build** refuses rather
 * than silently pruning a persisted group policy on its next save. Older (v1/v2)
 * payloads still load and are upgraded losslessly on the next save.
 */
export const CURRENT_SCHEMA_VERSION = 3;

/**
 * D20 canonical trajectory format version. `formatVersion: 2` marks a
 * cents-only canonical snapshot. A **missing** value is a legacy (unversioned)
 * snapshot and is normalized through the legacy path unchanged; a higher value
 * is a future format that is refused (and blocks the load) rather than
 * reinterpreted; any other value is a malformed discriminator.
 */
export const CANONICAL_TRAJECTORY_FORMAT_VERSION = 2;

export interface StorageDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  path?: string;
}

export interface DecodeResult {
  scenario: Scenario;
  ui: AppUiState;
  diagnostics: StorageDiagnostic[];
  /** Version found in the stored envelope (0 = pre-versioning). */
  schemaVersion: number;
  /** True when the payload was created by a newer schema and must not be overwritten. */
  blocked: boolean;
  blockedReason?: string;
  /** True when raw JSON could not be parsed and fresh defaults were returned. */
  corrupt: boolean;
  /** Original bytes when blocked/corrupt (caller must preserve them). */
  preservedBytes: string | null;
}

export interface EncodeResult {
  json: string;
  schemaVersion: number;
  diagnostics: StorageDiagnostic[];
}

export const APP_TABS = ['options', 'careers', 'netWorth', 'expenses'] as const;
export type AppTab = (typeof APP_TABS)[number];
export const CAREERS_SUB_TABS = [
  'retirement',
  'careers',
  'timeline',
  'purchasesExpenses',
  'housing',
  'trajectory',
  'warnings',
  'dateMarkers'
] as const;
export type CareersSubTab = (typeof CAREERS_SUB_TABS)[number];
export const EXPENSES_SUB_TABS = ['planning', 'tracking', 'creditCards'] as const;
export type ExpensesSubTab = (typeof EXPENSES_SUB_TABS)[number];

export interface AppUiState {
  activeTab: AppTab;
  selectedCareerId: string;
  careersSubTab: CareersSubTab;
  expensesSubTab: ExpensesSubTab;
  compareTrajectoryId: string;
  showRealDollars: boolean;
}

export interface PersistedAppState {
  scenario: Scenario;
  ui: AppUiState;
}

/** Independent UI factory (fresh object each call). */
export const createDefaultUiState = (): AppUiState => ({
  activeTab: 'careers',
  selectedCareerId: '',
  careersSubTab: 'careers',
  expensesSubTab: 'planning',
  compareTrajectoryId: '',
  showRealDollars: false
});

const ACCOUNT_TYPES: AccountTypePreset[] = ['checking', 'savings', 'taxable', 'retirement401k', 'roth', 'hsa'];
const PAY_FREQUENCIES: PayFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
const PAYCHECK_LINE_KINDS: PaycheckLineKind[] = ['earning', 'tax', 'pretax', 'posttax', 'employer'];
const SOURCE_LINE_MODES: SourceLineMode[] = ['amount', 'four_percent'];
const WITHDRAWAL_MODES: WithdrawalMode[] = ['specified', 'percentOfInitialBalance'];
const RETIREMENT_WITHDRAWAL_MODES: RetirementWithdrawalMode[] = ['amount', 'percentOfInitialBalance'];
const CASHFLOW_CADENCES: CashflowCadence[] = ['one_time', 'recurring'];
const CASHFLOW_DIRECTIONS: CashflowDirection[] = ['inflow', 'outflow'];
const CASHFLOW_CATEGORIES: CashflowCategory[] = [
  'social_security', 'social_security_spouse', 'inheritance', 'college_child_1', 'college_child_2',
  'college_child_3', 'pension_1', 'pension_2', 'cash_benefit_1', 'cash_benefit_2', 'home_real_estate'
];
const LONG_TERM_END_MODES: LongTermPurchaseEndMode[] = ['duration', 'endDate'];
const CREDIT_CARD_PAYMENT_MODES: CreditCardPaymentMode[] = ['fixed', 'payInFull', 'minimum', 'fixedPlusLump', 'autopay'];
const HOUSING_TYPES: HousingType[] = ['mortgage', 'rental'];
const HOUSING_FUNDING_GROUPS: HousingFundingGroup[] = [
  'payment',
  'taxesInsurance',
  'hoaMaintenance',
  'pmi',
  'downPayment'
];
const LIABILITY_KINDS: LiabilityKind[] = ['loan', 'mortgage', 'zeroInterestCard', 'saleDeficiency'];
const PROPERTY_STATUSES: PropertyStatus[] = ['pending', 'owned', 'sold'];
const PROPERTY_KINDS: PropertyKind[] = ['primaryResidence', 'rental', 'other'];
const OPENING_MEASUREMENTS: OpeningMeasurement[] = ['assetOnly', 'assetsMinusLiabilities'];
const MEASUREMENT_BASES: MeasurementBasis[] = ['assetOnly', 'assetsMinusLiabilities', 'accountAssets'];
const NET_WORTH_HISTORY_PROVENANCES: NetWorthHistoryProvenance[] = ['manual', 'imported', 'projected'];
const RECURRING_CADENCES: RecurringEventCadence[] = ['weekly', 'monthly'];
const RECURRING_RULES: RecurringEventRule[] = ['on_date', 'every_friday', 'first_monday_after'];
const LIFE_EVENT_TYPES: LifeEventType[] = [
  'job_change', 'career_break', 'house_purchase', 'house_sale', 'large_expense', 'custom_income', 'custom_expense'
];
const EXPENSE_ORIGIN_TYPES: ExpenseOriginType[] = ['manual', 'imported'];
const EXPENSE_IMPORT_FILE_TYPES: ExpenseImportFileType[] = ['csv', 'pdf', 'unknown'];
const EXPENSE_IMPORT_STATUSES: ExpenseImportStatus[] = ['staged', 'ready', 'needs_review', 'error', 'applied'];
const PLANNER_PROVENANCES: PlannerProvenance[] = ['planner', 'recurrence', 'imported'];
const PLANNER_SOURCE_SIGNS: PlannerSourceSign[] = ['debit', 'credit'];
const PLANNING_STATUSES: PlanningStatus[] = ['occurred', 'planned'];
const DENSITIES: Array<'compact' | 'comfortable'> = ['compact', 'comfortable'];

interface NormalizeContext {
  diagnostics: StorageDiagnostic[];
  /**
   * Reference date for date-dependent defaults. `null` while encoding without an
   * explicit reference: missing dates are left blank instead of being stamped
   * with a synthetic (e.g. 1970) date.
   */
  referenceDate: Date | null;
  /** Date written for a missing single date; empty when no reference date exists. */
  fallbackDate: string;
  /**
   * `load` keeps derived in-memory caches (e.g. `CareerEntry.paycheckInfo`) so
   * editors/consumers can read them; `save` prunes those derived caches from the
   * persisted output while still synthesizing an authority when only legacy flat
   * scalars exist (D24).
   */
  mode: 'load' | 'save';
}

/**
 * Diagnostic codes emitted by the codec that must block a canonical save rather
 * than let a partially-converted payload overwrite the user's stored edits.
 */
export const SAVE_BLOCKING_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set(['paycheck-info-unconvertible']);

/** True when any encode diagnostic must abort the write (see storage.saveAppState). */
export const hasBlockingSaveDiagnostic = (diagnostics: readonly StorageDiagnostic[]): boolean =>
  diagnostics.some((entry) => entry.severity === 'error' || SAVE_BLOCKING_DIAGNOSTIC_CODES.has(entry.code));

/** Fixed scalar-default reference (never used to stamp output dates). */
const DEFAULT_REFERENCE_DATE = new Date(0);

/** Legacy pool names that must never be treated as account IDs. */
const LEGACY_POOL_NAMES = new Set(['emergencyFund', 'hsa', 'investments', 'retirement401k']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const strOrUndef = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
const nullableStr = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const nonNeg = (value: unknown, fallback = 0): number => Math.max(0, num(value, fallback));
const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.min(max, Math.max(min, num(value, fallback)));
const intClamp = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.min(max, Math.max(min, Math.floor(num(value, fallback))));
const nullableNum = (value: unknown, fallback: number | null = null): number | null => {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
};
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;
const isYearMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);
const yearMonth = (value: unknown): string => (isYearMonth(value) ? value : '');
const isoDate = (value: unknown): string => (isIsoDate(value) ? value : '');
const color = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
const stringArray = (value: unknown): string[] =>
  arr(value)
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
const dedupeStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  });
  return out;
};
const numberRecord = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  Object.entries(asRecord(value)).forEach(([key, entry]) => {
    if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry;
  });
  return out;
};
const toIsoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

/** Reference-relative date; blank when there is no reference (encode without one). */
const offsetDate = (ctx: NormalizeContext, days: number): string =>
  ctx.referenceDate ? toIsoDate(addDays(ctx.referenceDate, days)) : '';

/** Deterministic duplicate-id repair (first occurrence keeps its id). */
const repairCollection = <T extends { id: string }>(
  items: T[],
  prefix: string,
  ctx: NormalizeContext,
  label: string
): T[] => {
  const used = new Set<string>();
  let repaired = 0;
  const out = items.map((item, index) => {
    let id = item.id && item.id.trim().length > 0 ? item.id.trim() : `${prefix}-${index + 1}`;
    if (used.has(id)) {
      let suffix = 2;
      let candidate = `${id}-${suffix}`;
      while (used.has(candidate)) {
        suffix += 1;
        candidate = `${id}-${suffix}`;
      }
      id = candidate;
    }
    used.add(id);
    if (id !== item.id) {
      repaired += 1;
      return { ...item, id };
    }
    return item;
  });
  if (repaired > 0) {
    ctx.diagnostics.push({
      code: 'duplicate-id-repaired',
      severity: 'warning',
      message: `Repaired ${repaired} missing or duplicate id(s).`,
      path: label
    });
  }
  return out;
};

/** Deterministic duplicate repair for collections keyed by a non-`id` field (e.g. snapshot accountId). */
const repairByKey = <T>(
  items: T[],
  getKey: (item: T) => string,
  setKey: (item: T, key: string) => T,
  prefix: string,
  ctx: NormalizeContext,
  label: string
): T[] => {
  const used = new Set<string>();
  let repaired = 0;
  const out = items.map((item, index) => {
    let id = getKey(item);
    if (!id) id = `${prefix}-${index + 1}`;
    if (used.has(id)) {
      let suffix = 2;
      let candidate = `${id}-${suffix}`;
      while (used.has(candidate)) {
        suffix += 1;
        candidate = `${id}-${suffix}`;
      }
      id = candidate;
    }
    used.add(id);
    if (id !== getKey(item)) {
      repaired += 1;
      return setKey(item, id);
    }
    return item;
  });
  if (repaired > 0) {
    ctx.diagnostics.push({
      code: 'duplicate-id-repaired',
      severity: 'warning',
      message: `Repaired ${repaired} duplicate id(s).`,
      path: label
    });
  }
  return out;
};

/**
 * Maps a persisted **record collection** through its owning normalizer, emitting
 * one non-blocking `malformed-record-recovered` warning for each non-object entry
 * (null, array, primitive) at its original index and then recovering the entry in
 * place through that normalizer (P0.4.3 / RV29). Valid siblings are preserved.
 *
 * A non-array raw value is NOT a malformed collection: `arr` treats it as absent,
 * so no diagnostic is emitted. A wrong-typed scalar field **inside** a record is
 * coerced by the owning normalizer and is deliberately NOT reported here.
 */
const normalizeCollectionRecords = <T>(
  raw: unknown,
  normalize: (entry: unknown, index: number) => T,
  ctx: NormalizeContext,
  path: string
): T[] =>
  arr(raw).map((entry, index) => {
    if (!isRecord(entry)) {
      ctx.diagnostics.push({
        code: 'malformed-record-recovered',
        severity: 'warning',
        message: `A non-object record in '${path}' was recovered in place with a defaults instance; valid siblings were preserved.`,
        path: `${path}[${index}]`
      });
    }
    return normalize(entry, index);
  });

const normalizeFundingPolicy = (raw: unknown): FundingPolicy => {
  const r = asRecord(raw);
  const primary = strOrUndef(r.primaryAccountId) ?? null;
  return {
    primaryAccountId: primary,
    fallbackAccountIds: dedupeStrings(stringArray(r.fallbackAccountIds)).filter((id) => id !== primary),
    ...(r.purpose === undefined ? {} : { purpose: str(r.purpose, '') })
  };
};

const normalizeHsaPolicy = (raw: unknown): HsaWithdrawalPolicy => {
  const r = asRecord(raw);
  return {
    nonQualifiedPenaltyRate: nonNeg(r.nonQualifiedPenaltyRate, 20),
    nonQualifiedPenaltyWaiverAge: intClamp(r.nonQualifiedPenaltyWaiverAge, 0, 120, 65)
  };
};

const normalizeAccountPolicy = (raw: unknown, accountType: AccountTypePreset): AccountWithdrawalPolicy => {
  const r = asRecord(raw);
  const policy: AccountWithdrawalPolicy = {
    allowAutomaticFallback: bool(
      r.allowAutomaticFallback,
      accountType === 'checking' || accountType === 'savings' || accountType === 'taxable'
    ),
    withdrawalTaxRate: num(r.withdrawalTaxRate, 0),
    penaltyRate: num(r.penaltyRate, 0),
    restrictionNote: str(r.restrictionNote, '')
  };
  if (accountType === 'hsa' || r.hsa !== undefined) policy.hsa = normalizeHsaPolicy(r.hsa);
  return policy;
};

const normalizeAccount = (raw: unknown, index: number): AccountDefinition => {
  const r = asRecord(raw);
  const accountType = oneOf(r.accountType, ACCOUNT_TYPES, 'checking');
  const isTaxable = accountType === 'taxable';
  return {
    id: str(r.id, `account-${index + 1}`),
    label: str(r.label, `Account ${index + 1}`),
    accountType,
    openingBalance: num(r.openingBalance, 0),
    annualReturnRate: Math.max(-100, num(r.annualReturnRate, 0)),
    retirementAnnualReturnRate: (() => {
      const value = nullableNum(r.retirementAnnualReturnRate, null);
      return value === null ? null : Math.max(-100, value);
    })(),
    color: color(r.color),
    displayOrder: typeof r.displayOrder === 'number' && Number.isFinite(r.displayOrder) ? intClamp(r.displayOrder, 0, 1000000, index) : index,
    withdrawalPolicy: normalizeAccountPolicy(r.withdrawalPolicy, accountType),
    ...(r.assumedGainPercent === undefined
      ? isTaxable ? { assumedGainPercent: 20 } : {}
      : { assumedGainPercent: nonNeg(r.assumedGainPercent, 0) }),
    ...(r.capitalGainsTaxRate === undefined
      ? isTaxable ? { capitalGainsTaxRate: 15 } : {}
      : { capitalGainsTaxRate: nonNeg(r.capitalGainsTaxRate, 0) })
  };
};

const normalizeCustomAccount = (raw: unknown, index: number): NetWorthCustomAccount => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `custom-account-${index + 1}`),
    label: str(r.label, `Account ${index + 1}`),
    balance: num(r.balance, 0)
  };
};

const normalizeOpeningAccountValue = (raw: unknown, index: number): OpeningSnapshotAccountValue => {
  const r = asRecord(raw);
  return { accountId: str(r.accountId, `account-${index + 1}`), balance: num(r.balance, 0) };
};

const normalizeOpeningLiabilityValue = (raw: unknown, index: number): OpeningSnapshotLiabilityValue => {
  const r = asRecord(raw);
  return { liabilityId: str(r.liabilityId, `liability-${index + 1}`), balance: num(r.balance, 0) };
};

const normalizeOpeningPropertyValue = (raw: unknown, index: number): OpeningSnapshotPropertyValue => {
  const r = asRecord(raw);
  return {
    propertyId: str(r.propertyId, `property-${index + 1}`),
    value: num(r.value, 0),
    ...(r.debtBalance === undefined ? {} : { debtBalance: num(r.debtBalance, 0) })
  };
};

const normalizeOpeningSnapshot = (raw: unknown, ctx: NormalizeContext): OpeningSnapshot => {
  const r = asRecord(raw);
  return {
    date: isoDate(r.date),
    accounts: repairByKey(
      normalizeCollectionRecords(r.accounts, normalizeOpeningAccountValue, ctx, 'openingSnapshot.accounts'),
      (v) => v.accountId,
      (v, id) => ({ ...v, accountId: id }),
      'opening-account',
      ctx,
      'openingSnapshot.accounts'
    ),
    liabilities: repairByKey(
      normalizeCollectionRecords(r.liabilities, normalizeOpeningLiabilityValue, ctx, 'openingSnapshot.liabilities'),
      (v) => v.liabilityId,
      (v, id) => ({ ...v, liabilityId: id }),
      'opening-liability',
      ctx,
      'openingSnapshot.liabilities'
    ),
    properties: repairByKey(
      normalizeCollectionRecords(r.properties, normalizeOpeningPropertyValue, ctx, 'openingSnapshot.properties'),
      (v) => v.propertyId,
      (v, id) => ({ ...v, propertyId: id }),
      'opening-property',
      ctx,
      'openingSnapshot.properties'
    ),
    measurement: oneOf(r.measurement, OPENING_MEASUREMENTS, 'assetOnly'),
    sourceSnapshotId: strOrUndef(r.sourceSnapshotId) ?? null
  };
};

const normalizeLiability = (raw: unknown, index: number): LiabilityDefinition => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `liability-${index + 1}`),
    kind: oneOf(r.kind, LIABILITY_KINDS, 'loan'),
    ...(r.label === undefined ? {} : { label: str(r.label, '') }),
    openingBalance: num(r.openingBalance, 0),
    ...(r.sourceConfigId === undefined ? {} : { sourceConfigId: nullableStr(r.sourceConfigId) }),
    ...(r.linkedPropertyId === undefined ? {} : { linkedPropertyId: nullableStr(r.linkedPropertyId) }),
    ...(r.annualInterestRate === undefined ? {} : { annualInterestRate: num(r.annualInterestRate, 0) }),
    ...(r.minimumMonthlyPayment === undefined ? {} : { minimumMonthlyPayment: nonNeg(r.minimumMonthlyPayment, 0) }),
    ...(r.extraMonthlyPayment === undefined ? {} : { extraMonthlyPayment: nonNeg(r.extraMonthlyPayment, 0) }),
    ...(r.endYearMonth === undefined ? {} : { endYearMonth: nullableStr(r.endYearMonth) }),
    ...(r.openingYearMonth === undefined ? {} : { openingYearMonth: nullableStr(r.openingYearMonth) }),
    ...(r.paymentDay === undefined ? {} : { paymentDay: intClamp(r.paymentDay, 1, 31, 1) })
  };
};

const normalizePropertyFundingEvent = (raw: unknown, index: number): PropertyFundingEvent => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `property-funding-${index + 1}`),
    date: isoDate(r.date),
    amount: num(r.amount, 0),
    ...(r.accountId === undefined ? {} : { accountId: nullableStr(r.accountId) })
  };
};

const normalizeProperty = (raw: unknown, index: number, ctx: NormalizeContext): PropertyDefinition => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `property-${index + 1}`),
    ...(r.label === undefined ? {} : { label: str(r.label, '') }),
    ...(r.kind === undefined ? {} : { kind: oneOf(r.kind, PROPERTY_KINDS, 'other') }),
    value: num(r.value, 0),
    ...(r.debtLink === undefined ? {} : { debtLink: nullableStr(r.debtLink) }),
    requiredDownPayment: nonNeg(r.requiredDownPayment, 0),
    status: oneOf(r.status, PROPERTY_STATUSES, 'pending'),
    ...(r.sourceConfigId === undefined ? {} : { sourceConfigId: nullableStr(r.sourceConfigId) }),
    ...(r.acquisitionYearMonth === undefined ? {} : { acquisitionYearMonth: nullableStr(r.acquisitionYearMonth) }),
    ...(r.completedDate === undefined ? {} : { completedDate: nullableStr(r.completedDate) }),
    ...(r.appreciationRate === undefined ? {} : { appreciationRate: num(r.appreciationRate, 0) }),
    ...(r.sellingCostsRate === undefined ? {} : { sellingCostsRate: nonNeg(r.sellingCostsRate, 0) }),
    fundingEvents: repairCollection(
      normalizeCollectionRecords(r.fundingEvents, normalizePropertyFundingEvent, ctx, 'property.fundingEvents'),
      'property-funding',
      ctx,
      'property.fundingEvents'
    )
  };
};

const normalizeHistoryEntry = (raw: unknown, index: number, ctx: NormalizeContext): NetWorthHistoryEntry => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `networth-history-${index + 1}`),
    date: isoDate(r.date),
    accounts: repairCollection(
      normalizeCollectionRecords(
        r.accounts,
        (account, accountIndex) => {
          const a = asRecord(account);
          return {
            id: str(a.id, `history-account-${accountIndex + 1}`),
            label: str(a.label, `Account ${accountIndex + 1}`),
            balance: num(a.balance, 0)
          };
        },
        ctx,
        'netWorth.history.accounts'
      ),
      'history-account',
      ctx,
      'netWorth.history.accounts'
    ),
    totalNetWorth: num(r.totalNetWorth, 0),
    // Explicit measurement is persisted; a legacy entry without one is labeled
    // asset-only and is never silently reinterpreted as signed net worth.
    measurement: oneOf(r.measurement, MEASUREMENT_BASES, 'assetOnly'),
    ...(r.provenance === undefined
      ? {}
      : { provenance: oneOf(r.provenance, NET_WORTH_HISTORY_PROVENANCES, 'manual') }),
    ...(r.sourceSnapshotId === undefined ? {} : { sourceSnapshotId: nullableStr(r.sourceSnapshotId) })
  };
};

const normalizeLegacyBankAccount = (raw: unknown, index: number): AccountDefinition => {
  const r = asRecord(raw);
  const accountType = oneOf(r.accountType, ACCOUNT_TYPES, 'taxable');
  const isTaxable = accountType === 'taxable';
  return {
    id: str(r.id, `account-${index + 1}`),
    label: str(r.label, `Account ${index + 1}`),
    accountType,
    openingBalance: num(r.balance, 0),
    // Missing rates default to 0% / null override; pool rates are never inherited.
    annualReturnRate: 0,
    retirementAnnualReturnRate: null,
    color: color(r.color),
    displayOrder: index,
    withdrawalPolicy: normalizeAccountPolicy(undefined, accountType),
    ...(isTaxable ? { assumedGainPercent: 20, capitalGainsTaxRate: 15 } : {})
  };
};

const normalizeNetWorth = (raw: unknown, ctx: NormalizeContext): NetWorthConfig => {
  const r = asRecord(raw);
  const canonicalAccounts = arr(r.accounts);
  const legacyBankAccounts = arr(r.bankAccounts);
  let accounts: AccountDefinition[];

  if (canonicalAccounts.length > 0) {
    accounts = repairCollection(
      normalizeCollectionRecords(canonicalAccounts, normalizeAccount, ctx, 'netWorth.accounts'),
      'account',
      ctx,
      'netWorth.accounts'
    );
    if (legacyBankAccounts.length > 0) {
      ctx.diagnostics.push({
        code: 'legacy-bank-accounts-ignored',
        severity: 'info',
        message: 'Canonical accounts present; legacy netWorth.bankAccounts ignored.',
        path: 'netWorth.bankAccounts'
      });
    }
  } else if (legacyBankAccounts.length > 0) {
    accounts = repairCollection(
      normalizeCollectionRecords(legacyBankAccounts, normalizeLegacyBankAccount, ctx, 'netWorth.bankAccounts'),
      'account',
      ctx,
      'netWorth.bankAccounts'
    );
    ctx.diagnostics.push({
      code: 'bank-accounts-migrated',
      severity: 'info',
      message:
        'Migrated legacy netWorth.bankAccounts to canonical accounts (ids/labels/types/balances preserved; missing rates default 0%/null with no pool inheritance).',
      path: 'netWorth.bankAccounts'
    });
  } else {
    accounts = [];
  }

  if (accounts.length === 0 && isRecord(r.accountBalances)) {
    ctx.diagnostics.push({
      code: 'legacy-pool-balances-ignored',
      severity: 'warning',
      message: 'Legacy netWorth.accountBalances is a pool map and was not converted into accounts.',
      path: 'netWorth.accountBalances'
    });
  }

  return {
    accounts,
    customAccounts: repairCollection(
      normalizeCollectionRecords(r.customAccounts, normalizeCustomAccount, ctx, 'netWorth.customAccounts'),
      'custom-account',
      ctx,
      'netWorth.customAccounts'
    ),
    history: repairCollection(
      normalizeCollectionRecords(r.history, (entry, index) => normalizeHistoryEntry(entry, index, ctx), ctx, 'netWorth.history'),
      'networth-history',
      ctx,
      'netWorth.history'
    ),
    ...(r.openingSnapshot === undefined ? {} : { openingSnapshot: normalizeOpeningSnapshot(r.openingSnapshot, ctx) }),
    asOfDate: isoDate(r.asOfDate)
  };
};

const normalizePaycheckLine = (raw: unknown, kind: PaycheckLineKind, index: number): PaycheckLine => {
  const r = asRecord(raw);
  const bucketValue: PaycheckDepositBucket | null =
    r.bucket === 'retirement' || r.bucket === 'hsa' ? (r.bucket as PaycheckDepositBucket) : null;
  return {
    id: str(r.id, `paycheck-line-${kind}-${index + 1}`),
    label: str(r.label, 'Item'),
    amount: num(r.amount, 0),
    mode: r.mode === 'percentOfGross' ? 'percentOfGross' : 'amount',
    ...(typeof r.rate === 'number' && Number.isFinite(r.rate) ? { rate: r.rate } : {}),
    ...(typeof r.hours === 'number' && Number.isFinite(r.hours) ? { hours: r.hours } : {}),
    ytd: nonNeg(r.ytd, 0),
    accountId: strOrUndef(r.accountId) ?? null,
    bucket: bucketValue
  };
};

const normalizePaycheckCategory = (raw: unknown, index: number): PaycheckCategory => {
  const r = asRecord(raw);
  const kind = oneOf(r.kind, PAYCHECK_LINE_KINDS, 'pretax');
  return {
    id: str(r.id, `paycheck-category-${kind}-${index + 1}`),
    label: str(r.label, kind),
    kind,
    lines: arr(r.lines).map((line, lineIndex) => normalizePaycheckLine(line, kind, lineIndex))
  };
};

const normalizePaycheck = (raw: unknown): Paycheck | undefined => {
  if (!isRecord(raw)) return undefined;
  return {
    payFrequency: oneOf(raw.payFrequency, PAY_FREQUENCIES, 'monthly'),
    categories: arr(raw.categories).map((category, index) => normalizePaycheckCategory(category, index))
  };
};

const normalizePeriodMap = (raw: unknown): Record<string, 'monthly' | 'yearly'> => {
  const out: Record<string, 'monthly' | 'yearly'> = {};
  Object.entries(asRecord(raw)).forEach(([key, value]) => {
    if (value === 'monthly' || value === 'yearly') out[key] = value;
  });
  return out;
};

const normalizePaycheckInfo = (raw: unknown): PaycheckInfo | undefined => {
  if (!isRecord(raw)) return undefined;
  return {
    grossSalary: nonNeg(raw.grossSalary, 0),
    taxes: nonNeg(raw.taxes, 0),
    healthBenefits: nonNeg(raw.healthBenefits, 0),
    retirement: nonNeg(raw.retirement, 0),
    retirementMatch: nonNeg(raw.retirementMatch, 0),
    hsaContribution: nonNeg(raw.hsaContribution, 0),
    hsaEmployerMatch: nonNeg(raw.hsaEmployerMatch, 0),
    otherBenefits: nonNeg(raw.otherBenefits, 0),
    retirementAccountId: strOrUndef(raw.retirementAccountId),
    hsaAccountId: strOrUndef(raw.hsaAccountId),
    livingExpenses: nonNeg(raw.livingExpenses, 0),
    ...(raw.retirementMode === undefined ? {} : { retirementMode: oneOf(raw.retirementMode, ['amount', 'percentOfSalary'] as const, 'amount') }),
    ...(raw.retirementMatchMode === undefined ? {} : { retirementMatchMode: oneOf(raw.retirementMatchMode, ['amount', 'percentOfRetirement'] as const, 'amount') }),
    ...(raw.employerMaxMatchPercent === undefined ? {} : { employerMaxMatchPercent: nonNeg(raw.employerMaxMatchPercent, 0) }),
    ...(raw.hsaContributionMode === undefined ? {} : { hsaContributionMode: oneOf(raw.hsaContributionMode, ['amount', 'percentOfSalary'] as const, 'amount') }),
    ...(raw.hsaEmployerMatchMode === undefined ? {} : { hsaEmployerMatchMode: oneOf(raw.hsaEmployerMatchMode, ['amount', 'percentOfHsaContribution'] as const, 'amount') }),
    ...(raw.employerHsaDeposit === undefined ? {} : { employerHsaDeposit: nonNeg(raw.employerHsaDeposit, 0) }),
    ...(raw.employerHsaDepositMode === undefined ? {} : { employerHsaDepositMode: oneOf(raw.employerHsaDepositMode, ['amount', 'percentOfSalary'] as const, 'amount') }),
    ...(raw.period === undefined ? {} : { period: normalizePeriodMap(raw.period) })
  };
};

const normalizeCareerSourceLine = (raw: unknown, index: number, ctx?: NormalizeContext): CareerSourceLine => {
  const r = asRecord(raw);
  const isPoolSource = r.sourceType === 'pool';
  const rawOverflow = r.overflowFallbackAccountId;
  const overflowIsPool = typeof rawOverflow === 'string' && LEGACY_POOL_NAMES.has(rawOverflow);
  if (ctx && isPoolSource) {
    ctx.diagnostics.push({
      code: 'legacy-pool-source-cleared',
      severity: 'warning',
      message: 'Legacy pool source dropped; a pool id is never treated as an account ID.',
      path: `careerSourceLine[${index}]`
    });
  }
  return {
    id: str(r.id, `career-source-${index + 1}`),
    enabled: bool(r.enabled, true),
    sourceType: 'account',
    sourceId: isPoolSource ? '' : str(r.sourceId, str(r.accountId, '')),
    contributionRate: nonNeg(r.contributionRate, 0),
    savingsMonthly: bool(r.savingsMonthly, false),
    monthlyWithdrawal: nonNeg(r.monthlyWithdrawal, 0),
    // P0.4.2 absent vs explicit 0: a missing cap means "no limit" and must stay
    // absent (the editor reopening shows blank, not 0). An explicit `0` is a
    // stored value; a present-but-malformed type normalizes safely to 0 without
    // dropping the valid sibling fields on this line.
    ...(r.maxBalance === undefined ? {} : { maxBalance: nonNeg(r.maxBalance, 0) }),
    overflowFallbackAccountId: overflowIsPool ? null : nullableStr(rawOverflow),
    ...(r.mode === undefined ? {} : { mode: oneOf(r.mode, ['percentOfSalary', 'fixedAmount'] as const, 'percentOfSalary') }),
    ...(r.fixedAmount === undefined ? {} : { fixedAmount: nonNeg(r.fixedAmount, 0) }),
    ...(r.increaseWithPaycheck === undefined ? {} : { increaseWithPaycheck: bool(r.increaseWithPaycheck, false) }),
    ...(r.increaseWithdrawalWithPaycheck === undefined ? {} : { increaseWithdrawalWithPaycheck: bool(r.increaseWithdrawalWithPaycheck, false) })
  };
};

const normalizeCareerDepositPlan = (raw: unknown, ctx: NormalizeContext): CareerDepositPlan | undefined => {
  if (!isRecord(raw)) return undefined;
  return {
    allocations: repairCollection(
      normalizeCollectionRecords(
        raw.allocations,
        (line, index) => normalizeCareerSourceLine(line, index, ctx),
        ctx,
        'careerDepositPlan.allocations'
      ),
      'career-allocation',
      ctx,
      'careerDepositPlan.allocations'
    ),
    remainderAccountId: nullableStr(raw.remainderAccountId),
    ...(raw.postingDay === undefined ? {} : { postingDay: intClamp(raw.postingDay, 1, 31, 1) })
  };
};

const normalizeCareerPayPlan = (raw: unknown, index: number, ctx: NormalizeContext): CareerPayPlan => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `pay-plan-${index + 1}`),
    label: str(r.label, `Plan ${index + 1}`),
    effectiveYearMonth: yearMonth(r.effectiveYearMonth),
    effectiveMarkerId: nullableStr(r.effectiveMarkerId),
    paycheck: normalizePaycheck(r.paycheck) ?? { payFrequency: 'monthly', categories: [] },
    sourceLines: repairCollection(
      normalizeCollectionRecords(
        r.sourceLines,
        (line, lineIndex) => normalizeCareerSourceLine(line, lineIndex, ctx),
        ctx,
        'careerPayPlan.sourceLines'
      ),
      'career-source',
      ctx,
      'careerPayPlan.sourceLines'
    ),
    ...(r.annualRaiseRate === undefined ? {} : { annualRaiseRate: num(r.annualRaiseRate, 0) }),
    ...(r.depositPlan === undefined ? {} : { depositPlan: normalizeCareerDepositPlan(r.depositPlan, ctx) })
  };
};

const normalizeCareerEntry = (raw: unknown, index: number, ctx: NormalizeContext): CareerEntry => {
  const r = asRecord(raw);
  const startAge = num(r.startAge, 0);

  // D9 single paycheck authority. The granular `paycheck` wins whenever present
  // and the flat `paycheckInfo` is kept as a derived cache so editor values do
  // not drift. A legacy flat-only entry (paycheckInfo without paycheck) is
  // synthesized into a granular paycheck (its flat scalars are kept in memory on
  // load; on save the granular authority is persisted and the cache is pruned).
  const normalizedPaycheck = r.paycheck === undefined ? undefined : normalizePaycheck(r.paycheck);
  const rawPaycheckInfo = r.paycheckInfo === undefined ? undefined : normalizePaycheckInfo(r.paycheckInfo);
  // A present-but-unusable flat payload (non-record) must never be silently
  // dropped on save; flag it so the write is rejected instead.
  const hasUnusableFlatInfo = r.paycheckInfo !== undefined && r.paycheckInfo !== null && !rawPaycheckInfo;
  let paycheck = normalizedPaycheck;
  let paycheckInfo = rawPaycheckInfo;
  if (normalizedPaycheck) {
    // Granular paycheck is the authority; the flat info is a derived cache.
    paycheckInfo = compilePaycheck(normalizedPaycheck);
  } else if (rawPaycheckInfo) {
    // Legacy flat-only entry: synthesize the granular authority. The original
    // flat scalars are preserved as the in-memory cache on load (so the editor
    // shows exactly what was saved); on save they simply aren't persisted.
    paycheck = paycheckFromPaycheckInfo(rawPaycheckInfo);
    ctx.diagnostics.push({
      code: 'legacy-paycheck-info-synthesized',
      severity: 'info',
      message:
        'Legacy flat-only paycheckInfo synthesized into a granular paycheck; the granular paycheck becomes the engine authority and the flat cache is not persisted.',
      path: 'careerPlan.entries.paycheck'
    });
  } else if (ctx.mode === 'save' && hasUnusableFlatInfo) {
    ctx.diagnostics.push({
      code: 'paycheck-info-unconvertible',
      severity: 'error',
      message:
        'Legacy flat paycheckInfo could not be converted to a granular paycheck; the save was rejected so no user edits are lost.',
      path: 'careerPlan.entries.paycheckInfo'
    });
  }

  return {
    id: str(r.id, `career-${index + 1}`),
    label: str(r.label, `Career ${index + 1}`),
    enabled: bool(r.enabled, true),
    usePreviousCareerStartAge: bool(r.usePreviousCareerStartAge, false),
    useBirthdayBasedStartAge: bool(r.useBirthdayBasedStartAge, false),
    startYearMonth: yearMonth(r.startYearMonth),
    endYearMonth: yearMonth(r.endYearMonth),
    startMarkerId: nullableStr(r.startMarkerId),
    endMarkerId: nullableStr(r.endMarkerId),
    startAge,
    endAge: Math.max(startAge, num(r.endAge, startAge)),
    annualRaiseRate: num(r.annualRaiseRate, 0),
    savingsRate: num(r.savingsRate, 0),
    emergencyFundContributionRate: nonNeg(r.emergencyFundContributionRate, 0),
    hsaContributionRate: nonNeg(r.hsaContributionRate, 0),
    investmentsContributionRate: nonNeg(r.investmentsContributionRate, 0),
    retirement401kContributionRate: nonNeg(r.retirement401kContributionRate, 0),
    emergencyFundSavingsMonthly: bool(r.emergencyFundSavingsMonthly, false),
    hsaSavingsMonthly: bool(r.hsaSavingsMonthly, false),
    investmentsSavingsMonthly: bool(r.investmentsSavingsMonthly, false),
    retirement401kSavingsMonthly: bool(r.retirement401kSavingsMonthly, false),
    emergencyFundStartBalanceMode: r.emergencyFundStartBalanceMode === 'manual' ? 'manual' : 'auto',
    hsaStartBalanceMode: r.hsaStartBalanceMode === 'manual' ? 'manual' : 'auto',
    investmentsStartBalanceMode: r.investmentsStartBalanceMode === 'manual' ? 'manual' : 'auto',
    retirement401kStartBalanceMode: r.retirement401kStartBalanceMode === 'manual' ? 'manual' : 'auto',
    emergencyFundManualStartBalance: nonNeg(r.emergencyFundManualStartBalance, 0),
    hsaManualStartBalance: nonNeg(r.hsaManualStartBalance, 0),
    investmentsManualStartBalance: nonNeg(r.investmentsManualStartBalance, 0),
    retirement401kManualStartBalance: nonNeg(r.retirement401kManualStartBalance, 0),
    ...(r.emergencyFundMonthlyWithdrawal === undefined ? {} : { emergencyFundMonthlyWithdrawal: nonNeg(r.emergencyFundMonthlyWithdrawal, 0) }),
    ...(r.hsaMonthlyWithdrawal === undefined ? {} : { hsaMonthlyWithdrawal: nonNeg(r.hsaMonthlyWithdrawal, 0) }),
    ...(r.investmentsMonthlyWithdrawal === undefined ? {} : { investmentsMonthlyWithdrawal: nonNeg(r.investmentsMonthlyWithdrawal, 0) }),
    ...(r.retirement401kMonthlyWithdrawal === undefined ? {} : { retirement401kMonthlyWithdrawal: nonNeg(r.retirement401kMonthlyWithdrawal, 0) }),
    ...(r.sourceLines === undefined
      ? {}
      : {
          sourceLines: repairCollection(
            normalizeCollectionRecords(
              r.sourceLines,
              (line, lineIndex) => normalizeCareerSourceLine(line, lineIndex, ctx),
              ctx,
              'careerEntry.sourceLines'
            ),
            'career-source',
            ctx,
            'careerEntry.sourceLines'
          )
        }),
    ...(r.depositPlan === undefined ? {} : { depositPlan: normalizeCareerDepositPlan(r.depositPlan, ctx) }),
    // D24: the flat paycheckInfo is a derived cache. It is kept in memory on
    // load (so the legacy editor can read it) but is never persisted; the
    // granular paycheck is the authority and paycheckInfo is re-derived on load.
    ...(ctx.mode === 'save' || paycheckInfo === undefined ? {} : { paycheckInfo }),
    ...(paycheck === undefined ? {} : { paycheck }),
    ...(r.payPlans === undefined
      ? {}
      : {
          payPlans: repairCollection(
            normalizeCollectionRecords(
              r.payPlans,
              (plan, planIndex) => normalizeCareerPayPlan(plan, planIndex, ctx),
              ctx,
              'careerEntry.payPlans'
            ),
            'pay-plan',
            ctx,
            'careerEntry.payPlans'
          )
        })
  };
};

const normalizeCareerPlan = (raw: unknown, ctx: NormalizeContext): CareerPlan => {
  const r = asRecord(raw);
  return {
    enabled: bool(r.enabled, true),
    entries: repairCollection(
      normalizeCollectionRecords(r.entries, (entry, index) => normalizeCareerEntry(entry, index, ctx), ctx, 'careerPlan.entries'),
      'career',
      ctx,
      'careerPlan.entries'
    )
  };
};

const normalizeRetirementSource = (raw: unknown, index: number, ctx: NormalizeContext): RetirementWithdrawalSourceLine => {
  const r = asRecord(raw);
  const firstWithdrawalDate = isoDate(r.firstWithdrawalDate) || ctx.fallbackDate;
  const legacySourceType = r.sourceType;
  const legacySourceId = typeof r.sourceId === 'string' ? r.sourceId : '';
  const isRetiredFourPercent = r.mode === 'four_percent';
  const isLegacyShape = legacySourceType !== undefined || legacySourceId.length > 0 || isRetiredFourPercent;

  if (isLegacyShape) {
    ctx.diagnostics.push({
      code: 'retired-withdrawal-source',
      severity: 'warning',
      message:
        'Legacy retirement withdrawal source normalized; pool sources cannot become account IDs and the retired four-percent mode maps to the configurable percentage mode.',
      path: `withdrawal.sourceLines[${index}]`
    });
  }

  let accountId = strOrUndef(r.accountId) ?? '';
  if (LEGACY_POOL_NAMES.has(accountId)) accountId = '';
  if (!accountId && legacySourceType !== 'pool' && !LEGACY_POOL_NAMES.has(legacySourceId)) {
    accountId = legacySourceId;
  }

  return {
    id: str(r.id, `retirement-source-${index + 1}`),
    ...(r.label === undefined ? {} : { label: str(r.label, '') }),
    enabled: bool(r.enabled, true),
    accountId,
    mode: isRetiredFourPercent ? 'percentOfInitialBalance' : oneOf(r.mode, RETIREMENT_WITHDRAWAL_MODES, 'amount'),
    amount: nonNeg(r.amount, 0),
    ...(r.initialWithdrawalRatePercent === undefined
      ? { initialWithdrawalRatePercent: 4 }
      : { initialWithdrawalRatePercent: nonNeg(r.initialWithdrawalRatePercent, 4) }),
    firstWithdrawalDate,
    initialWithdrawalValuationDate:
      r.initialWithdrawalValuationDate === null ? null : isoDate(r.initialWithdrawalValuationDate) || firstWithdrawalDate,
    ...(r.paymentDay === undefined || r.paymentDay === null ? {} : { paymentDay: intClamp(r.paymentDay, 1, 31, 1) }),
    ...(r.startMarkerId === undefined ? {} : { startMarkerId: nullableStr(r.startMarkerId) }),
    ...(r.syncWithRetirementAge === undefined ? {} : { syncWithRetirementAge: bool(r.syncWithRetirementAge, true) }),
    ...(r.startAge === undefined ? {} : { startAge: num(r.startAge, 0) }),
    ...(r.fallbackAccountIds === undefined ? {} : { fallbackAccountIds: dedupeStrings(stringArray(r.fallbackAccountIds)) })
  };
};

const normalizeWithdrawalPlan = (raw: unknown, ctx: NormalizeContext): WithdrawalPlan => {
  const r = asRecord(raw);
  return {
    mode: oneOf(r.mode, WITHDRAWAL_MODES, 'specified'),
    minimumYearlyWithdrawal: nonNeg(r.minimumYearlyWithdrawal, 0),
    maximumYearlyWithdrawal: nonNeg(r.maximumYearlyWithdrawal, 1000000),
    useRetirementAgeAsWithdrawalStartAge: bool(r.useRetirementAgeAsWithdrawalStartAge, true),
    ...(r.fallbackAccountIds === undefined ? {} : { fallbackAccountIds: dedupeStrings(stringArray(r.fallbackAccountIds)) }),
    ...(r.sourceLines === undefined
      ? {}
      : {
          sourceLines: repairCollection(
            normalizeCollectionRecords(
              r.sourceLines,
              (line, index) => normalizeRetirementSource(line, index, ctx),
              ctx,
              'withdrawal.sourceLines'
            ),
            'retirement-source',
            ctx,
            'withdrawal.sourceLines'
          )
        })
  };
};

/** Keeps only the target account/income funding variants (drops `pool:`). */
const parseAccountFunding = (value: unknown): 'income' | `account:${string}` | undefined => {
  if (value === 'income') return 'income';
  if (typeof value === 'string' && value.startsWith('account:') && value.length > 'account:'.length) {
    return value as `account:${string}`;
  }
  return undefined;
};

const normalizeSourceLine = (raw: unknown, index: number, ctx?: NormalizeContext): SourceLine => {
  const r = asRecord(raw);
  const isPoolSource = r.sourceType === 'pool';
  const rawAccountId = strOrUndef(r.accountId);
  const accountIdIsPool = rawAccountId !== undefined && LEGACY_POOL_NAMES.has(rawAccountId);
  if (ctx && (isPoolSource || accountIdIsPool)) {
    ctx.diagnostics.push({
      code: 'legacy-pool-source-cleared',
      severity: 'warning',
      message: 'Legacy pool source dropped; a pool id is never treated as an account ID.',
      path: `sourceLine[${index}]`
    });
  }
  const cleanAccountId = isPoolSource || accountIdIsPool ? undefined : rawAccountId;
  const rawSourceId = isPoolSource ? '' : str(r.sourceId, str(r.accountId, ''));
  return {
    id: str(r.id, `source-line-${index + 1}`),
    enabled: bool(r.enabled, true),
    ...(cleanAccountId === undefined ? {} : { accountId: cleanAccountId }),
    sourceType: 'account',
    sourceId: LEGACY_POOL_NAMES.has(rawSourceId) ? '' : rawSourceId,
    mode: oneOf(r.mode, SOURCE_LINE_MODES, 'amount'),
    amount: nonNeg(r.amount, 0),
    ...(r.startAge === undefined ? {} : { startAge: num(r.startAge, 0) }),
    ...(r.syncWithRetirementAge === undefined ? {} : { syncWithRetirementAge: bool(r.syncWithRetirementAge, true) })
  };
};

const normalizeLargePurchase = (raw: unknown, index: number, ctx: NormalizeContext): LargePurchase => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `purchase-${index + 1}`),
    label: str(r.label, `Purchase ${index + 1}`),
    enabled: bool(r.enabled, true),
    showOnGraph: bool(r.showOnGraph, true),
    flagColor: color(r.flagColor),
    yearMonth: yearMonth(r.yearMonth),
    yearMonthMarkerId: nullableStr(r.yearMonthMarkerId),
    age: num(r.age, 0),
    amount: nonNeg(r.amount, 0),
    ...(r.sourceLines === undefined
      ? {}
      : {
          sourceLines: normalizeCollectionRecords(
            r.sourceLines,
            (line, lineIndex) => normalizeSourceLine(line, lineIndex, ctx),
            ctx,
            'largePurchase.sourceLines'
          )
        }),
    ...(r.fundingSource === undefined ? {} : { fundingSource: parseAccountFunding(r.fundingSource) }),
    categoryId: nullableStr(r.categoryId)
  };
};

const normalizeLongTermPurchase = (raw: unknown, index: number, ctx: NormalizeContext): LongTermPurchase => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `long-term-purchase-${index + 1}`),
    label: str(r.label, `Long-Term Purchase ${index + 1}`),
    enabled: bool(r.enabled, true),
    showOnGraph: bool(r.showOnGraph, true),
    flagColor: color(r.flagColor),
    startYearMonth: yearMonth(r.startYearMonth),
    endMode: oneOf(r.endMode, LONG_TERM_END_MODES, 'duration'),
    durationMonths: intClamp(r.durationMonths, 1, 1200, 12),
    endYearMonth: yearMonth(r.endYearMonth),
    startMarkerId: nullableStr(r.startMarkerId),
    endMarkerId: nullableStr(r.endMarkerId),
    monthlyAmount: nonNeg(r.monthlyAmount, 0),
    ...(r.sourceLines === undefined
      ? {}
      : {
          sourceLines: normalizeCollectionRecords(
            r.sourceLines,
            (line, lineIndex) => normalizeSourceLine(line, lineIndex, ctx),
            ctx,
            'longTermPurchase.sourceLines'
          )
        }),
    ...(r.fundingSource === undefined ? {} : { fundingSource: parseAccountFunding(r.fundingSource) })
  };
};

const normalizeLoan = (raw: unknown, index: number, ctx: NormalizeContext): Loan => {
  const r = asRecord(raw);
  const rawPaymentSourceAccount = str(r.paymentSourceAccount, '');
  const paymentSourceAccountIsLegacyPool = LEGACY_POOL_NAMES.has(rawPaymentSourceAccount);
  if (paymentSourceAccountIsLegacyPool) {
    ctx.diagnostics.push({
      code: 'legacy-pool-payment-source-cleared',
      severity: 'warning',
      message: 'Legacy pool-name payment source cleared; it is not an account ID.',
      path: `loan[${index}].paymentSourceAccount`
    });
  }
  return {
    id: str(r.id, `loan-${index + 1}`),
    label: str(r.label, `Loan ${index + 1}`),
    enabled: bool(r.enabled, true),
    showOnGraph: bool(r.showOnGraph, true),
    flagColor: color(r.flagColor),
    startYearMonth: yearMonth(r.startYearMonth),
    startMarkerId: nullableStr(r.startMarkerId),
    originalAmount: nonNeg(r.originalAmount, 0),
    downPayment: nonNeg(r.downPayment, 0),
    currentBalance: nonNeg(r.currentBalance, 0),
    annualInterestRate: num(r.annualInterestRate, 0),
    minimumMonthlyPayment: nonNeg(r.minimumMonthlyPayment, 0),
    extraMonthlyPayment: nonNeg(r.extraMonthlyPayment, 0),
    paymentSourceAccount: paymentSourceAccountIsLegacyPool ? '' : rawPaymentSourceAccount,
    ...(r.paymentSource === undefined ? {} : { paymentSource: parseAccountFunding(r.paymentSource) }),
    ...(r.downPaymentSource === undefined ? {} : { downPaymentSource: parseAccountFunding(r.downPaymentSource) })
  };
};

const normalizeCreditCard = (raw: unknown, index: number): CreditCard => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `cc-${index + 1}`),
    label: str(r.label, `Credit Card ${index + 1}`),
    enabled: bool(r.enabled, true),
    currentBalance: nonNeg(r.currentBalance, 0),
    annualInterestRate: num(r.annualInterestRate, 0),
    introEnabled: bool(r.introEnabled, false),
    introEndYearMonth: yearMonth(r.introEndYearMonth),
    introEndMarkerId: nullableStr(r.introEndMarkerId),
    monthlyCharges: nonNeg(r.monthlyCharges, 0),
    paymentMode: oneOf(r.paymentMode, CREDIT_CARD_PAYMENT_MODES, 'minimum'),
    fixedPaymentAmount: nonNeg(r.fixedPaymentAmount, 100),
    minimumPaymentPercent: nonNeg(r.minimumPaymentPercent, 2),
    minimumPaymentFloor: nonNeg(r.minimumPaymentFloor, 25),
    paymentSource: parseAccountFunding(r.paymentSource) ?? 'income',
    lumpSumPaymentSource: parseAccountFunding(r.lumpSumPaymentSource) ?? 'income',
    paymentDay: intClamp(r.paymentDay, 1, 31, 15),
    ...(r.autopayEndYearMonth === undefined ? {} : { autopayEndYearMonth: yearMonth(r.autopayEndYearMonth) }),
    ...(r.autopayEndMarkerId === undefined ? {} : { autopayEndMarkerId: nullableStr(r.autopayEndMarkerId) }),
    ...(r.showOnGraph === undefined ? {} : { showOnGraph: bool(r.showOnGraph, false) }),
    flagColor: color(r.flagColor)
  };
};

/**
 * Allowlist-only normalization of the optional per-group housing funding map
 * (G20/G22). Only the five retained group keys survive (unknown keys pruned);
 * each value is rebuilt through `normalizeFundingPolicy`, so a valid `null`
 * primary and an explicit empty `fallbackAccountIds` are preserved (never
 * defaulted, never redirected to a first fallback). A group key that is absent
 * stays absent so it keeps inheriting the global default policy; an entirely
 * unusable map normalizes to `undefined` (inheritance) rather than fabricating a
 * policy.
 */
const normalizeHousingFundingPolicies = (
  raw: unknown
): Partial<Record<HousingFundingGroup, FundingPolicy>> | undefined => {
  if (!isRecord(raw)) return undefined;
  const out: Partial<Record<HousingFundingGroup, FundingPolicy>> = {};
  let hasGroup = false;
  HOUSING_FUNDING_GROUPS.forEach((group) => {
    const value = raw[group];
    if (value === undefined || value === null) return;
    if (!isRecord(value)) return;
    out[group] = normalizeFundingPolicy(value);
    hasGroup = true;
  });
  return hasGroup ? out : undefined;
};

const normalizeHousing = (raw: unknown, index: number, ctx: NormalizeContext): HousingEntry => {
  const r = asRecord(raw);
  const fundingPolicies = normalizeHousingFundingPolicies(r.fundingPolicies);
  return {
    id: str(r.id, `housing-${index + 1}`),
    label: str(r.label, `Home ${index + 1}`),
    enabled: bool(r.enabled, true),
    showOnGraph: bool(r.showOnGraph, true),
    flagColor: color(r.flagColor),
    housingType: oneOf(r.housingType, HOUSING_TYPES, 'mortgage'),
    startYearMonth: yearMonth(r.startYearMonth),
    startMarkerId: nullableStr(r.startMarkerId),
    purchasePrice: nonNeg(r.purchasePrice, 0),
    downPayment: nonNeg(r.downPayment, 0),
    ...(r.downPaymentSource === undefined ? {} : { downPaymentSource: parseAccountFunding(r.downPaymentSource) }),
    annualInterestRate: num(r.annualInterestRate, 0),
    loanTermYears: nonNeg(r.loanTermYears, 0),
    extraMonthlyPayment: nonNeg(r.extraMonthlyPayment, 0),
    monthlyRent: nonNeg(r.monthlyRent, 0),
    endYearMonth: yearMonth(r.endYearMonth),
    endMarkerId: nullableStr(r.endMarkerId),
    propertyTaxYearly: nonNeg(r.propertyTaxYearly, 0),
    homeInsuranceYearly: nonNeg(r.homeInsuranceYearly, 0),
    hoaMonthly: nonNeg(r.hoaMonthly, 0),
    maintenanceMonthly: nonNeg(r.maintenanceMonthly, 0),
    pmiMonthly: nonNeg(r.pmiMonthly, 0),
    rentalIncomeMonthly: nonNeg(r.rentalIncomeMonthly, 0),
    ...(r.rentalIncomeAccountId === undefined ? {} : { rentalIncomeAccountId: strOrUndef(r.rentalIncomeAccountId) }),
    sellYearMonth: yearMonth(r.sellYearMonth),
    sellMarkerId: nullableStr(r.sellMarkerId),
    appreciationRate: num(r.appreciationRate, 0),
    sellingCostsRate: nonNeg(r.sellingCostsRate, 0),
    ...(r.saleProceedsAccountId === undefined ? {} : { saleProceedsAccountId: strOrUndef(r.saleProceedsAccountId) }),
    ...(r.usePreviousEndAsStart === undefined ? {} : { usePreviousEndAsStart: bool(r.usePreviousEndAsStart, false) }),
    linkedCareerStartId: nullableStr(r.linkedCareerStartId),
    linkedCareerEndId: nullableStr(r.linkedCareerEndId),
    ...(r.paymentSource === undefined ? {} : { paymentSource: parseAccountFunding(r.paymentSource) ?? 'income' }),
    ...(r.taxesInsuranceSource === undefined ? {} : { taxesInsuranceSource: parseAccountFunding(r.taxesInsuranceSource) ?? 'income' }),
    ...(r.hoaMaintenanceSource === undefined ? {} : { hoaMaintenanceSource: parseAccountFunding(r.hoaMaintenanceSource) ?? 'income' }),
    ...(r.pmiSource === undefined ? {} : { pmiSource: parseAccountFunding(r.pmiSource) ?? 'income' }),
    // G20/G22 ordered per-group overrides. Absent groups stay absent (inherit the
    // global default policy + the legacy `*Source` read fallback); explicit
    // policies are rebuilt through the allowlist so unknown keys are pruned and a
    // valid `null`/`[]` is preserved.
    ...(fundingPolicies === undefined ? {} : { fundingPolicies }),
    // Timeline-local funding events (RV04/F23). An explicit list is preserved
    // verbatim (valid `[]`/`0`/`null`/account ids included); an absent list stays
    // absent so a legacy timeline never implicitly inherits the base property
    // events (consumers interpret omission as `[]`).
    ...(r.fundingEvents === undefined
      ? {}
      : {
          fundingEvents: repairCollection(
            normalizeCollectionRecords(r.fundingEvents, normalizePropertyFundingEvent, ctx, 'housing.fundingEvents'),
            'property-funding',
            ctx,
            'housing.fundingEvents'
          )
        })
  };
};

const normalizeCardPlan = (raw: unknown, index: number): CardPlan => {
  const r = asRecord(raw);
  if (r.kind === 'zeroInterestPayoff') {
    const plan: ZeroInterestCardPlan = {
      kind: 'zeroInterestPayoff',
      id: str(r.id, `card-plan-${index + 1}`),
      label: str(r.label, `0% Card Payoff ${index + 1}`),
      enabled: bool(r.enabled, true),
      liabilityId: str(r.liabilityId, ''),
      initialBalance: nonNeg(r.initialBalance, 0),
      startYearMonth: yearMonth(r.startYearMonth),
      targetYearMonth: yearMonth(r.targetYearMonth),
      startMarkerId: nullableStr(r.startMarkerId),
      endMarkerId: nullableStr(r.endMarkerId),
      paymentDay: intClamp(r.paymentDay, 1, 31, 1),
      funding: normalizeFundingPolicy(r.funding),
      ...(r.payoffYearMonth === undefined ? {} : { payoffYearMonth: nullableStr(r.payoffYearMonth) }),
      ...(r.payoffFunding === undefined ? {} : { payoffFunding: normalizeFundingPolicy(r.payoffFunding) }),
      ...(r.showOnGraph === undefined ? {} : { showOnGraph: bool(r.showOnGraph, false) }),
      flagColor: color(r.flagColor)
    };
    return plan;
  }

  const plan: OrdinaryCardSchedule = {
    kind: 'expectedPayment',
    id: str(r.id, `card-plan-${index + 1}`),
    label: str(r.label, `Expected Payment ${index + 1}`),
    enabled: bool(r.enabled, true),
    amount: nonNeg(r.amount, 0),
    startYearMonth: yearMonth(r.startYearMonth),
    endYearMonth: yearMonth(r.endYearMonth),
    startMarkerId: nullableStr(r.startMarkerId),
    endMarkerId: nullableStr(r.endMarkerId),
    paymentDay: intClamp(r.paymentDay, 1, 31, 1),
    funding: normalizeFundingPolicy(r.funding),
    ...(r.showOnGraph === undefined ? {} : { showOnGraph: bool(r.showOnGraph, false) }),
    flagColor: color(r.flagColor)
  };
  return plan;
};

const normalizeTimeline = (raw: unknown, index: number, ctx: NormalizeContext): Timeline => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `timeline-${index + 1}`),
    label: str(r.label, `Timeline ${index + 1}`),
    purchases: repairCollection(
      normalizeCollectionRecords(r.purchases, (p, i) => normalizeLargePurchase(p, i, ctx), ctx, 'timeline.purchases'),
      'purchase',
      ctx,
      'timeline.purchases'
    ),
    longTermPurchases: repairCollection(
      normalizeCollectionRecords(r.longTermPurchases, (p, i) => normalizeLongTermPurchase(p, i, ctx), ctx, 'timeline.longTermPurchases'),
      'long-term-purchase',
      ctx,
      'timeline.longTermPurchases'
    ),
    loans: repairCollection(
      normalizeCollectionRecords(r.loans, (l, i) => normalizeLoan(l, i, ctx), ctx, 'timeline.loans'),
      'loan',
      ctx,
      'timeline.loans'
    ),
    creditCards: repairCollection(
      normalizeCollectionRecords(r.creditCards, normalizeCreditCard, ctx, 'timeline.creditCards'),
      'cc',
      ctx,
      'timeline.creditCards'
    ),
    // Timeline-local card plans. A legacy timeline without the field normalizes
    // to `[]` and never inherits the base list (RV04/F23: cards are per-timeline).
    cardPlans: repairCollection(
      normalizeCollectionRecords(r.cardPlans, normalizeCardPlan, ctx, 'timeline.cardPlans'),
      'card-plan',
      ctx,
      'timeline.cardPlans'
    ),
    careerPlan: normalizeCareerPlan(r.careerPlan, ctx),
    housing: repairCollection(
      normalizeCollectionRecords(r.housing, (h, i) => normalizeHousing(h, i, ctx), ctx, 'timeline.housing'),
      'housing',
      ctx,
      'timeline.housing'
    )
  };
};

const normalizeTrajectoryYear = (raw: unknown): TrajectoryYear => {
  const r = asRecord(raw);
  return {
    age: num(r.age, 0),
    calendarYear: num(r.calendarYear, 0),
    isBaselineNow: bool(r.isBaselineNow, false),
    startBalance: num(r.startBalance, 0),
    endBalance: num(r.endBalance, 0),
    salary: num(r.salary, 0),
    netIncome: num(r.netIncome, 0),
    careerContribution: num(r.careerContribution, 0),
    contribution: num(r.contribution, 0),
    withdrawal: num(r.withdrawal, 0),
    taxesPaid: num(r.taxesPaid, 0),
    penaltiesPaid: num(r.penaltiesPaid, 0),
    annualReturnRate: num(r.annualReturnRate, 0),
    inflationRate: num(r.inflationRate, 0),
    depleted: bool(r.depleted, false),
    savingsBalances: numberRecord(r.savingsBalances),
    accountBalancesById: numberRecord(r.accountBalancesById),
    creditCardBalancesById: numberRecord(r.creditCardBalancesById),
    totalCreditCardDebt: num(r.totalCreditCardDebt, 0)
  };
};

const normalizeResultContext = (raw: unknown): ResultContextMetadata | undefined => {
  if (!isRecord(raw)) return undefined;
  return {
    measurement: oneOf(raw.measurement, MEASUREMENT_BASES, 'accountAssets'),
    startDate: isoDate(raw.startDate),
    endDate: isoDate(raw.endDate),
    ...(raw.schemaVersion === undefined ? {} : { schemaVersion: num(raw.schemaVersion, CURRENT_SCHEMA_VERSION) }),
    ...(raw.engineRevision === undefined ? {} : { engineRevision: str(raw.engineRevision, '') }),
    ...(raw.contextId === undefined ? {} : { contextId: str(raw.contextId, '') })
  };
};

/**
 * Legacy (unversioned) trajectory snapshot. Rebuilt from the same explicit
 * allowlist as before (no `formatVersion`, `years` honored verbatim) so an
 * existing asset-only snapshot round-trips byte-for-byte. A legacy record is
 * **never** given modern context metadata it did not carry.
 */
const normalizeTrajectorySnapshot = (raw: unknown, index: number): TrajectorySnapshot => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `trajectory-${index + 1}`),
    label: str(r.label, `Trajectory ${index + 1}`),
    createdAt: str(r.createdAt, ''),
    survivesToEnd: bool(r.survivesToEnd, true),
    depletedAge: nullableNum(r.depletedAge, null),
    endAge: num(r.endAge, 0),
    endingBalance: num(r.endingBalance, 0),
    summary: str(r.summary, ''),
    years: arr(r.years).map((year) => normalizeTrajectoryYear(year)),
    ...(r.context === undefined ? {} : { context: normalizeResultContext(r.context) })
  };
};

/**
 * One canonical annual point. Rejected locally (dropped with a diagnostic) when
 * any field is malformed: `calendarYear`/cents must be **safe integers** and
 * `closingDate` a valid date-only. A malformed point never cross-fills a legacy
 * year and never fabricates a value.
 */
const normalizeCanonicalTrajectoryPoint = (
  raw: unknown,
  pointIndex: number,
  snapshotIndex: number,
  ctx: NormalizeContext
): CanonicalTrajectoryAnnualPoint | null => {
  const r = asRecord(raw);
  const calendarYear = r.calendarYear;
  const closingDate = r.closingDate;
  const netWorthCents = r.netWorthCents;
  const accountAssetsCents = r.accountAssetsCents;
  const liabilityCents = r.liabilityCents;
  const valid =
    Number.isSafeInteger(calendarYear) &&
    isIsoDate(closingDate) &&
    Number.isSafeInteger(netWorthCents) &&
    Number.isSafeInteger(accountAssetsCents) &&
    Number.isSafeInteger(liabilityCents);
  if (!valid) {
    ctx.diagnostics.push({
      code: 'malformed-trajectory-point',
      severity: 'warning',
      message:
        'A canonical trajectory annual point was malformed (calendarYear and all cents must be safe integers; closingDate must be a valid date-only) and was dropped.',
      path: `trajectorySnapshots[${snapshotIndex}].annualPoints[${pointIndex}]`
    });
    return null;
  }
  return {
    calendarYear: calendarYear as number,
    closingDate: closingDate as string,
    netWorthCents: netWorthCents as number,
    accountAssetsCents: accountAssetsCents as number,
    liabilityCents: liabilityCents as number
  };
};

/**
 * Required, validated canonical context. Returns `null` (never a fabricated or
 * partial context) when the measurement is unknown, a date is malformed or
 * reversed, `schemaVersion` is not finite, or `engineRevision` is empty.
 */
const normalizeCanonicalTrajectoryContext = (
  raw: unknown,
  snapshotIndex: number,
  ctx: NormalizeContext
): CanonicalTrajectoryContext | null => {
  if (!isRecord(raw)) return null;
  const measurement = raw.measurement;
  const startDate = raw.startDate;
  const endDate = raw.endDate;
  const schemaVersion = raw.schemaVersion;
  const engineRevision = raw.engineRevision;
  const valid =
    (measurement === 'assetOnly' ||
      measurement === 'assetsMinusLiabilities' ||
      measurement === 'accountAssets') &&
    isIsoDate(startDate) &&
    isIsoDate(endDate) &&
    endDate >= startDate &&
    typeof schemaVersion === 'number' &&
    Number.isFinite(schemaVersion) &&
    typeof engineRevision === 'string' &&
    engineRevision.length > 0;
  if (!valid) {
    ctx.diagnostics.push({
      code: 'malformed-trajectory-context',
      severity: 'error',
      message:
        'A canonical trajectory snapshot was missing valid required metadata (measurement/startDate/endDate/schemaVersion/engineRevision); it was refused rather than given fabricated metadata.',
      path: `trajectorySnapshots[${snapshotIndex}].context`
    });
    return null;
  }
  return {
    measurement: measurement as CanonicalTrajectoryContext['measurement'],
    startDate: startDate as string,
    endDate: endDate as string,
    schemaVersion: schemaVersion as number,
    engineRevision: engineRevision as string,
    ...(raw.contextId === undefined ? {} : { contextId: str(raw.contextId, '') })
  };
};

/** Canonical `formatVersion: 2` snapshot: required context + allowlisted points. */
const normalizeCanonicalTrajectorySnapshot = (
  raw: Record<string, unknown>,
  index: number,
  ctx: NormalizeContext
): CanonicalTrajectorySnapshot | null => {
  const context = normalizeCanonicalTrajectoryContext(raw.context, index, ctx);
  if (!context) return null;
  const annualPoints: CanonicalTrajectoryAnnualPoint[] = [];
  arr(raw.annualPoints).forEach((point, pointIndex) => {
    const normalized = normalizeCanonicalTrajectoryPoint(point, pointIndex, index, ctx);
    if (normalized) annualPoints.push(normalized);
  });
  return {
    formatVersion: CANONICAL_TRAJECTORY_FORMAT_VERSION,
    id: str(raw.id, `trajectory-${index + 1}`),
    label: str(raw.label, `Trajectory ${index + 1}`),
    createdAt: str(raw.createdAt, ''),
    context,
    annualPoints
  };
};

/**
 * Discriminates on `formatVersion` **before** any shape-specific read, then
 * normalizes through the matching allowlist:
 * - absent `formatVersion` → legacy snapshot (unchanged legacy path);
 * - `2` → canonical snapshot;
 * - a finite value `> 2` → future format, refused (blocks the load, bytes kept);
 * - any other present value → malformed discriminator, refused.
 */
const normalizeTrajectorySnapshotEntry = (
  raw: unknown,
  index: number,
  ctx: NormalizeContext
): AnyTrajectorySnapshot | null => {
  const r = asRecord(raw);
  if (r.formatVersion !== undefined) {
    if (r.formatVersion === CANONICAL_TRAJECTORY_FORMAT_VERSION) {
      return normalizeCanonicalTrajectorySnapshot(r, index, ctx);
    }
    if (
      typeof r.formatVersion === 'number' &&
      Number.isFinite(r.formatVersion) &&
      r.formatVersion > CANONICAL_TRAJECTORY_FORMAT_VERSION
    ) {
      ctx.diagnostics.push({
        code: 'future-trajectory-format-version',
        severity: 'error',
        message: `Trajectory snapshot formatVersion ${r.formatVersion} is newer than supported (${CANONICAL_TRAJECTORY_FORMAT_VERSION}); refusing to reinterpret it and preserving the original bytes.`,
        path: `trajectorySnapshots[${index}]`
      });
      return null;
    }
    ctx.diagnostics.push({
      code: 'malformed-trajectory-format-version',
      severity: 'error',
      message: `Trajectory snapshot formatVersion ${JSON.stringify(r.formatVersion)} is not a supported canonical format (${CANONICAL_TRAJECTORY_FORMAT_VERSION}); the snapshot was refused rather than reinterpreted.`,
      path: `trajectorySnapshots[${index}]`
    });
    return null;
  }
  return normalizeTrajectorySnapshot(raw, index);
};

const normalizeTrajectorySnapshots = (raw: unknown, ctx: NormalizeContext): AnyTrajectorySnapshot[] =>
  repairCollection(
    arr(raw)
      .map((entry, index) => normalizeTrajectorySnapshotEntry(entry, index, ctx))
      .filter((entry): entry is AnyTrajectorySnapshot => entry !== null),
    'trajectory',
    ctx,
    'trajectorySnapshots'
  );

/**
 * Normalizes occurrence provenance. `defaultStatus` is provenance-derived
 * (imported → occurred, else planned); an explicit valid `planningStatus` wins,
 * but an invalid/absent value never gets promoted from a date or anchor.
 */
const normalizeExpenseProvenance = (
  r: Record<string, unknown>,
  defaultStatus: PlanningStatus = 'planned'
) => ({
  ...(r.provenance === undefined ? {} : { provenance: oneOf(r.provenance, PLANNER_PROVENANCES, 'planner') }),
  ...(r.sourceDate === undefined ? {} : { sourceDate: isoDate(r.sourceDate) || null }),
  // Preserve an explicit `null` as `null` (a cleared planned copy) and leave an
  // absent value absent; only a present, malformed value falls back to the
  // approved default. Sibling provenance fields are never discarded.
  ...(r.sourceSign === undefined
    ? {}
    : { sourceSign: r.sourceSign === null ? null : oneOf(r.sourceSign, PLANNER_SOURCE_SIGNS, 'debit') }),
  ...(r.asOf === undefined ? {} : { asOf: typeof r.asOf === 'string' ? r.asOf : null }),
  planningStatus: oneOf(r.planningStatus, PLANNING_STATUSES, defaultStatus)
});

const normalizeExpenseEntry = (raw: unknown, index: number, ctx: NormalizeContext): ExpenseEntry => {
  const r = asRecord(raw);
  const startDate = isoDate(r.startDate) || ctx.fallbackDate;
  // Imported observations are view-only regardless of display date/anchor.
  const isImported = r.originType === 'imported' || r.provenance === 'imported';
  return {
    ...normalizeExpenseProvenance(r, isImported ? 'occurred' : 'planned'),
    id: str(r.id, `expense-${index + 1}`),
    label: str(r.label, `Expense ${index + 1}`),
    amount: nonNeg(r.amount, 0),
    startDate,
    endDate: isoDate(r.endDate) || startDate,
    accountId: nullableStr(r.accountId),
    notes: str(r.notes, ''),
    originType: oneOf(r.originType, EXPENSE_ORIGIN_TYPES, 'manual'),
    importSourceId: nullableStr(r.importSourceId),
    importBatchId: nullableStr(r.importBatchId),
    createdAt: isoDate(r.createdAt) || startDate,
    updatedAt: isoDate(r.updatedAt) || startDate,
    categoryId: nullableStr(r.categoryId),
    color: color(r.color),
    ...(r.fundingSource === undefined ? {} : { fundingSource: parseAccountFunding(r.fundingSource) }),
    startMarkerId: nullableStr(r.startMarkerId),
    endMarkerId: nullableStr(r.endMarkerId)
  };
};

const normalizeExpenseImport = (raw: unknown, index: number, ctx: NormalizeContext): ExpenseImportSource => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `expense-import-${index + 1}`),
    batchId: str(r.batchId, `batch-${index + 1}`),
    fileName: str(r.fileName, `import-${index + 1}.csv`),
    fileType: oneOf(r.fileType, EXPENSE_IMPORT_FILE_TYPES, 'unknown'),
    previewText: str(r.previewText, ''),
    status: oneOf(r.status, EXPENSE_IMPORT_STATUSES, 'staged'),
    parseNotes: stringArray(r.parseNotes),
    confidence: clamp(r.confidence, 0, 1, 0),
    importedAt: isoDate(r.importedAt) || ctx.fallbackDate,
    appliedAt: isoDate(r.appliedAt),
    entryIds: stringArray(r.entryIds)
  };
};

const normalizeExpenseCategory = (raw: unknown, index: number): ExpenseCategory => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `expense-category-${index + 1}`),
    label: str(r.label, `Category ${index + 1}`),
    color: color(r.color)
  };
};

const normalizeWeeklyBalancePoint = (raw: unknown, ctx: NormalizeContext): WeeklyBalancePoint => {
  const r = asRecord(raw);
  return {
    weekStartDate: isoDate(r.weekStartDate) || ctx.fallbackDate,
    balance: num(r.balance, 0)
  };
};

const normalizeRecurringEvent = (raw: unknown, index: number, ctx: NormalizeContext): RecurringExpenseEvent => {
  const r = asRecord(raw);
  const startDate = isoDate(r.startDate) || offsetDate(ctx, 7);
  return {
    ...normalizeExpenseProvenance(r, r.provenance === 'imported' ? 'occurred' : 'planned'),
    id: str(r.id, `recurring-expense-${index + 1}`),
    label: str(r.label, `Recurring Event ${index + 1}`),
    amount: nonNeg(r.amount, 0),
    accountId: str(r.accountId, ''),
    paymentAccountId: nullableStr(r.paymentAccountId),
    categoryId: nullableStr(r.categoryId),
    cadence: oneOf(r.cadence, RECURRING_CADENCES, 'weekly'),
    rule: oneOf(r.rule, RECURRING_RULES, 'on_date'),
    startDate,
    endDate: isoDate(r.endDate) || offsetDate(ctx, 365),
    ...(r.dayOfMonth === undefined ? {} : { dayOfMonth: intClamp(r.dayOfMonth, 1, 31, 1) }),
    ...(r.anchorDate === undefined ? {} : { anchorDate: isoDate(r.anchorDate) }),
    enabled: bool(r.enabled, true),
    color: color(r.color),
    ...(r.fundingSource === undefined ? {} : { fundingSource: parseAccountFunding(r.fundingSource) }),
    startMarkerId: nullableStr(r.startMarkerId),
    endMarkerId: nullableStr(r.endMarkerId)
  };
};

const normalizeExpenseUi = (raw: unknown, ctx: NormalizeContext): ExpenseTimelineUiState => {
  const r = asRecord(raw);
  const defaultScrubber = offsetDate(ctx, 7);
  return {
    groupingMode: 'account',
    zoomLevel: clamp(r.zoomLevel, 0.5, 4, 1),
    rowHeight: intClamp(r.rowHeight, 32, 120, 56),
    density: oneOf(r.density, DENSITIES, 'comfortable'),
    snapToDay: bool(r.snapToDay, true),
    scrubberDate: isoDate(r.scrubberDate) || defaultScrubber,
    windowStartDate: isoDate(r.windowStartDate) || defaultScrubber,
    windowEndDate: isoDate(r.windowEndDate) || offsetDate(ctx, 365),
    selectedAccountIds: stringArray(r.selectedAccountIds),
    collapsedTrackIds: stringArray(r.collapsedTrackIds),
    trackerVisibleAccountIds: stringArray(r.trackerVisibleAccountIds),
    planningWeekStartDay: intClamp(r.planningWeekStartDay, 0, 6, 5)
  };
};

const normalizeExpenses = (raw: unknown, ctx: NormalizeContext): ExpensesConfig => {
  const r = asRecord(raw);
  const categoriesByAccountId: Record<string, ExpenseCategory[]> = {};
  Object.entries(asRecord(r.categoriesByAccountId)).forEach(([accountId, categories]) => {
    categoriesByAccountId[accountId] = arr(categories)
      .map((category, index) => normalizeExpenseCategory(category, index))
      .filter((category) => category.label.length > 0);
  });
  const weeklyBalanceByAccountId: Record<string, WeeklyBalancePoint[]> = {};
  Object.entries(asRecord(r.weeklyBalanceByAccountId)).forEach(([accountId, points]) => {
    weeklyBalanceByAccountId[accountId] = arr(points).map((point) => normalizeWeeklyBalancePoint(point, ctx));
  });
  const maxBalanceByAccountId: Record<string, number> = {};
  Object.entries(asRecord(r.maxBalanceByAccountId)).forEach(([accountId, value]) => {
    maxBalanceByAccountId[accountId] = nonNeg(value, 0);
  });

  return {
    entries: repairCollection(
      normalizeCollectionRecords(r.entries, (e, i) => normalizeExpenseEntry(e, i, ctx), ctx, 'expenses.entries'),
      'expense',
      ctx,
      'expenses.entries'
    ),
    imports: repairCollection(
      normalizeCollectionRecords(r.imports, (e, i) => normalizeExpenseImport(e, i, ctx), ctx, 'expenses.imports'),
      'expense-import',
      ctx,
      'expenses.imports'
    ),
    categoriesByAccountId,
    weeklyBalanceByAccountId,
    maxBalanceByAccountId,
    activePlanningAccountId: nullableStr(r.activePlanningAccountId),
    recurringEvents: repairCollection(
      normalizeCollectionRecords(r.recurringEvents, (e, i) => normalizeRecurringEvent(e, i, ctx), ctx, 'expenses.recurringEvents'),
      'recurring-expense',
      ctx,
      'expenses.recurringEvents'
    ),
    ui: normalizeExpenseUi(r.ui, ctx)
  };
};

const normalizeCashflowItem = (raw: unknown, index: number): CashflowItem => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `cashflow-${index + 1}`),
    category: oneOf(r.category, CASHFLOW_CATEGORIES, 'cash_benefit_1'),
    label: str(r.label, `Cashflow ${index + 1}`),
    enabled: bool(r.enabled, true),
    cadence: oneOf(r.cadence, CASHFLOW_CADENCES, 'one_time'),
    direction: oneOf(r.direction, CASHFLOW_DIRECTIONS, 'inflow'),
    amount: num(r.amount, 0),
    startAge: num(r.startAge, 0),
    endAge: num(r.endAge, 0),
    ...(r.accountId === undefined ? {} : { accountId: nullableStr(r.accountId) }),
    ...(r.startYearMonth === undefined ? {} : { startYearMonth: yearMonth(r.startYearMonth) }),
    ...(r.endYearMonth === undefined ? {} : { endYearMonth: yearMonth(r.endYearMonth) }),
    ...(r.startMarkerId === undefined ? {} : { startMarkerId: nullableStr(r.startMarkerId) }),
    ...(r.endMarkerId === undefined ? {} : { endMarkerId: nullableStr(r.endMarkerId) })
  };
};

const normalizeLifeEvent = (raw: unknown, index: number): LifeEvent => {
  const r = asRecord(raw);
  return {
    id: str(r.id, `life-event-${index + 1}`),
    type: oneOf(r.type, LIFE_EVENT_TYPES, 'custom_expense'),
    label: str(r.label, `Life Event ${index + 1}`),
    enabled: bool(r.enabled, true),
    cadence: oneOf(r.cadence, CASHFLOW_CADENCES, 'one_time'),
    direction: oneOf(r.direction, CASHFLOW_DIRECTIONS, 'outflow'),
    startAge: num(r.startAge, 0),
    endAge: num(r.endAge, 0),
    amount: num(r.amount, 0),
    newSalary: num(r.newSalary, 0),
    annualSalaryGrowthOverride: num(r.annualSalaryGrowthOverride, 0),
    ...(r.accountId === undefined ? {} : { accountId: nullableStr(r.accountId) }),
    ...(r.startYearMonth === undefined ? {} : { startYearMonth: yearMonth(r.startYearMonth) }),
    ...(r.endYearMonth === undefined ? {} : { endYearMonth: yearMonth(r.endYearMonth) }),
    ...(r.startMarkerId === undefined ? {} : { startMarkerId: nullableStr(r.startMarkerId) }),
    ...(r.endMarkerId === undefined ? {} : { endMarkerId: nullableStr(r.endMarkerId) })
  };
};

const normalizePurchaseCategory = (raw: unknown, index: number): PurchaseCategory => {
  const r = asRecord(raw);
  return { id: str(r.id, `purchase-category-${index + 1}`), label: str(r.label, `Category ${index + 1}`) };
};

const normalizeDateMarker = (raw: unknown, index: number): DateMarker => {
  const r = asRecord(raw);
  return { id: str(r.id, `marker-${index + 1}`), label: str(r.label, `Marker ${index + 1}`), date: isoDate(r.date) };
};

const normalizeActiveTab = (value: unknown): AppTab => oneOf(value, APP_TABS, 'careers');

const normalizeCareersSubTab = (value: unknown): CareersSubTab => {
  if ((CAREERS_SUB_TABS as readonly string[]).includes(value as string)) return value as CareersSubTab;
  if (value === 'futureRetirement') return 'retirement';
  if (value === 'events') return 'timeline';
  if (value === 'purchases') return 'purchasesExpenses';
  return 'careers';
};

const normalizeExpensesSubTab = (value: unknown): ExpensesSubTab =>
  (EXPENSES_SUB_TABS as readonly string[]).includes(value as string) ? (value as ExpensesSubTab) : 'planning';

const normalizeAppUi = (raw: unknown): AppUiState => {
  const r = asRecord(raw);
  return {
    activeTab: normalizeActiveTab(r.activeTab),
    selectedCareerId: str(r.selectedCareerId, ''),
    careersSubTab: normalizeCareersSubTab(r.careersSubTab),
    expensesSubTab: normalizeExpensesSubTab(r.expensesSubTab),
    compareTrajectoryId: str(r.compareTrajectoryId, ''),
    showRealDollars: bool(r.showRealDollars, false)
  };
};

// ---------------------------------------------------------------------------
// Scenario + public codec entry points
// ---------------------------------------------------------------------------

const normalizeScenario = (raw: unknown, ctx: NormalizeContext): Scenario => {
  const r = asRecord(raw);
  const defaults = createDefaultScenario(ctx.referenceDate ?? DEFAULT_REFERENCE_DATE);
  const profileRaw = asRecord(r.profile);
  const optionsRaw = asRecord(r.options);
  const portfolioRaw = asRecord(r.portfolio);
  const futureRaw = asRecord(r.futureRetirement);
  const manualRaw = asRecord(r.manualReturns);

  const timelines = repairCollection(
    normalizeCollectionRecords(r.timelines, (t, i) => normalizeTimeline(t, i, ctx), ctx, 'timelines'),
    'timeline',
    ctx,
    'timelines'
  );
  const rawActiveTimelineId = nullableStr(r.activeTimelineId);
  const activeTimelineId =
    rawActiveTimelineId && timelines.some((timeline) => timeline.id === rawActiveTimelineId) ? rawActiveTimelineId : null;
  if (rawActiveTimelineId && !activeTimelineId) {
    ctx.diagnostics.push({
      code: 'dangling-active-timeline',
      severity: 'warning',
      message: `activeTimelineId '${rawActiveTimelineId}' does not match any timeline and was cleared.`,
      path: 'activeTimelineId'
    });
  }

  return {
    profile: {
      currentAge: num(profileRaw.currentAge, defaults.profile.currentAge),
      retirementAge: num(profileRaw.retirementAge, defaults.profile.retirementAge),
      retirementYears: num(profileRaw.retirementYears, defaults.profile.retirementYears)
    },
    options: { dateOfBirth: isoDate(optionsRaw.dateOfBirth) || defaults.options.dateOfBirth },
    portfolio: { currentAssets: num(portfolioRaw.currentAssets, 0) },
    careerPlan: normalizeCareerPlan(r.careerPlan, ctx),
    netWorth: normalizeNetWorth(r.netWorth, ctx),
    futureRetirement: {
      useCareerEndAge: bool(futureRaw.useCareerEndAge, true),
      retirementAge: num(futureRaw.retirementAge, defaults.futureRetirement.retirementAge),
      retirementYears: num(futureRaw.retirementYears, defaults.futureRetirement.retirementYears)
    },
    withdrawal: normalizeWithdrawalPlan(r.withdrawal, ctx),
    manualReturns: {
      inflationEnabled: bool(manualRaw.inflationEnabled, true),
      inflationRate: num(manualRaw.inflationRate, defaults.manualReturns.inflationRate)
    },
    purchaseCategories: repairCollection(
      normalizeCollectionRecords(r.purchaseCategories, normalizePurchaseCategory, ctx, 'purchaseCategories'),
      'purchase-category',
      ctx,
      'purchaseCategories'
    ),
    dateMarkers: repairCollection(
      normalizeCollectionRecords(r.dateMarkers, normalizeDateMarker, ctx, 'dateMarkers'),
      'marker',
      ctx,
      'dateMarkers'
    ).filter((m) => m.date.length > 0),
    timelines,
    activeTimelineId,
    trajectorySnapshots: normalizeTrajectorySnapshots(r.trajectorySnapshots, ctx),
    largePurchases: repairCollection(
      normalizeCollectionRecords(r.largePurchases, (p, i) => normalizeLargePurchase(p, i, ctx), ctx, 'largePurchases'),
      'purchase',
      ctx,
      'largePurchases'
    ),
    creditCards: repairCollection(
      normalizeCollectionRecords(r.creditCards, normalizeCreditCard, ctx, 'creditCards'),
      'cc',
      ctx,
      'creditCards'
    ),
    longTermPurchases: repairCollection(
      normalizeCollectionRecords(r.longTermPurchases, (p, i) => normalizeLongTermPurchase(p, i, ctx), ctx, 'longTermPurchases'),
      'long-term-purchase',
      ctx,
      'longTermPurchases'
    ),
    loans: repairCollection(
      normalizeCollectionRecords(r.loans, (l, i) => normalizeLoan(l, i, ctx), ctx, 'loans'),
      'loan',
      ctx,
      'loans'
    ),
    housing: repairCollection(
      normalizeCollectionRecords(r.housing, (h, i) => normalizeHousing(h, i, ctx), ctx, 'housing'),
      'housing',
      ctx,
      'housing'
    ),
    cashflowItems: repairCollection(
      normalizeCollectionRecords(r.cashflowItems, normalizeCashflowItem, ctx, 'cashflowItems'),
      'cashflow',
      ctx,
      'cashflowItems'
    ),
    lifeEvents: repairCollection(
      normalizeCollectionRecords(r.lifeEvents, normalizeLifeEvent, ctx, 'lifeEvents'),
      'life-event',
      ctx,
      'lifeEvents'
    ),
    expenses: normalizeExpenses(r.expenses, ctx),
    incomeFallbackAccountId: nullableStr(r.incomeFallbackAccountId),
    incomeFallbackAccountId2: nullableStr(r.incomeFallbackAccountId2),
    fundingPolicy: normalizeFundingPolicy(r.fundingPolicy ?? defaults.fundingPolicy),
    liabilities: repairCollection(
      normalizeCollectionRecords(r.liabilities, normalizeLiability, ctx, 'liabilities'),
      'liability',
      ctx,
      'liabilities'
    ),
    properties: repairCollection(
      normalizeCollectionRecords(r.properties, (p, i) => normalizeProperty(p, i, ctx), ctx, 'properties'),
      'property',
      ctx,
      'properties'
    ),
    cardPlans: repairCollection(
      normalizeCollectionRecords(r.cardPlans, normalizeCardPlan, ctx, 'cardPlans'),
      'card-plan',
      ctx,
      'cardPlans'
    )
  };
};

export const decodeAppState = (raw: string | null | undefined, referenceDate: Date): DecodeResult => {
  const diagnostics: StorageDiagnostic[] = [];
  if (raw === null || raw === undefined || raw.trim().length === 0) {
    return {
      scenario: createDefaultScenario(referenceDate),
      ui: createDefaultUiState(),
      diagnostics,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      blocked: false,
      corrupt: false,
      preservedBytes: null
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    diagnostics.push({
      code: 'parse-failed',
      severity: 'error',
      message: 'Stored data could not be parsed; fresh defaults returned and original bytes preserved.'
    });
    return {
      scenario: createDefaultScenario(referenceDate),
      ui: createDefaultUiState(),
      diagnostics,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      blocked: false,
      corrupt: true,
      preservedBytes: raw
    };
  }

  if (!isRecord(parsed)) {
    diagnostics.push({
      code: 'invalid-root',
      severity: 'error',
      message: 'Stored data root was not an object; fresh defaults returned and original bytes preserved.'
    });
    return {
      scenario: createDefaultScenario(referenceDate),
      ui: createDefaultUiState(),
      diagnostics,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      blocked: false,
      corrupt: true,
      preservedBytes: raw
    };
  }

  const version =
    typeof parsed.schemaVersion === 'number' && Number.isFinite(parsed.schemaVersion)
      ? Math.floor(parsed.schemaVersion)
      : 0;

  if (version > CURRENT_SCHEMA_VERSION) {
    diagnostics.push({
      code: 'future-schema-version',
      severity: 'error',
      message: `Stored data was created by a newer version (schema ${version} > ${CURRENT_SCHEMA_VERSION}); refusing to load and preserving the original bytes.`
    });
    return {
      scenario: createDefaultScenario(referenceDate),
      ui: createDefaultUiState(),
      diagnostics,
      schemaVersion: version,
      blocked: true,
      blockedReason: 'future-schema-version',
      corrupt: false,
      preservedBytes: raw
    };
  }

  const scenarioRaw = isRecord(parsed.scenario) ? parsed.scenario : parsed;
  const ctx: NormalizeContext = {
    diagnostics,
    referenceDate,
    fallbackDate: toIsoDate(referenceDate),
    mode: 'load'
  };
  const scenario = normalizeScenario(scenarioRaw, ctx);
  const ui = normalizeAppUi(parsed.ui);

  // A trajectory snapshot written by a newer canonical format version cannot be
  // reinterpreted: block the whole load (preserving the original bytes) so an
  // automatic save can never overwrite it with a partially-read payload.
  if (diagnostics.some((entry) => entry.code === 'future-trajectory-format-version')) {
    return {
      scenario,
      ui,
      diagnostics,
      schemaVersion: version,
      blocked: true,
      blockedReason: 'future-trajectory-format-version',
      corrupt: false,
      preservedBytes: raw
    };
  }

  return {
    scenario,
    ui,
    diagnostics,
    schemaVersion: version,
    blocked: false,
    corrupt: false,
    preservedBytes: null
  };
};

/**
 * Encodes canonical state. When no `referenceDate` is supplied, missing dates are
 * left blank rather than being stamped with a synthetic date. Callers loading
 * with a reference date should pass the same date so blank fills stay stable.
 */
export const encodeAppState = (state: PersistedAppState, referenceDate?: Date): EncodeResult => {
  const diagnostics: StorageDiagnostic[] = [];
  const ctx: NormalizeContext = {
    diagnostics,
    referenceDate: referenceDate ?? null,
    fallbackDate: referenceDate ? toIsoDate(referenceDate) : '',
    mode: 'save'
  };
  const scenario = normalizeScenario(state.scenario, ctx);
  const ui = normalizeAppUi(state.ui);
  return {
    json: JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, scenario, ui }),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    diagnostics
  };
};
