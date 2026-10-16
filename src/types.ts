// Plan-level retirement withdrawal selector. The former fixed `'four_percent'`
// label is replaced by `'percentOfInitialBalance'`; per-source mode lives on
// `RetirementWithdrawalSourceLine` (configurable rate, no implied fixed 4%).
export type WithdrawalMode = 'specified' | 'percentOfInitialBalance';
export type CashflowCadence = 'one_time' | 'recurring';
export type CashflowDirection = 'inflow' | 'outflow';
// Target schema has no pool domain: the only remaining source kind is an account.
export type SourceType = 'account';
export type SourceLineMode = 'amount' | 'four_percent';
export type AccountTypePreset = 'checking' | 'savings' | 'taxable' | 'retirement401k' | 'roth' | 'hsa';
export type CashflowCategory =
  | 'social_security'
  | 'social_security_spouse'
  | 'inheritance'
  | 'college_child_1'
  | 'college_child_2'
  | 'college_child_3'
  | 'pension_1'
  | 'pension_2'
  | 'cash_benefit_1'
  | 'cash_benefit_2'
  | 'home_real_estate';

export interface PersonProfile {
  currentAge: number;
  retirementAge: number;
  retirementYears: number;
}

export interface AgeOptions {
  dateOfBirth: string;
}

export interface DateMarker {
  id: string;
  label: string;
  date: string;
}

export interface PortfolioConfig {
  currentAssets: number;
}

export type BalanceInputMode = string;

export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export type PaycheckLineKind = 'earning' | 'tax' | 'pretax' | 'posttax' | 'employer';

export type PaycheckDepositBucket = 'retirement' | 'hsa';

export interface PaycheckLine {
  id: string;
  label: string;
  amount: number;
  mode: 'amount' | 'percentOfGross';
  rate?: number;
  hours?: number;
  ytd?: number;
  accountId?: string | null;
  bucket?: PaycheckDepositBucket | null;
}

export interface PaycheckCategory {
  id: string;
  label: string;
  kind: PaycheckLineKind;
  lines: PaycheckLine[];
}

export interface Paycheck {
  payFrequency: PayFrequency;
  categories: PaycheckCategory[];
}

export interface CareerPayPlan {
  id: string;
  label: string;
  effectiveYearMonth: string;
  effectiveMarkerId?: string | null;
  paycheck: Paycheck;
  sourceLines: CareerSourceLine[];
  annualRaiseRate?: number;
  /** Canonical ordered net-pay allocation + remainder (successor to `sourceLines`). */
  depositPlan?: CareerDepositPlan;
}

export interface CareerEntry {
  id: string;
  label: string;
  enabled: boolean;
  usePreviousCareerStartAge: boolean;
  useBirthdayBasedStartAge?: boolean;
  startYearMonth?: string;
  endYearMonth?: string;
  startMarkerId?: string | null;
  endMarkerId?: string | null;
  startAge: number;
  endAge: number;
  annualRaiseRate: number;
  savingsRate: number;
  emergencyFundContributionRate: number;
  hsaContributionRate: number;
  investmentsContributionRate: number;
  retirement401kContributionRate: number;
  emergencyFundSavingsMonthly: boolean;
  hsaSavingsMonthly: boolean;
  investmentsSavingsMonthly: boolean;
  retirement401kSavingsMonthly: boolean;
  emergencyFundStartBalanceMode: BalanceInputMode;
  hsaStartBalanceMode: BalanceInputMode;
  investmentsStartBalanceMode: BalanceInputMode;
  retirement401kStartBalanceMode: BalanceInputMode;
  emergencyFundManualStartBalance: number;
  hsaManualStartBalance: number;
  investmentsManualStartBalance: number;
  retirement401kManualStartBalance: number;
  emergencyFundMonthlyWithdrawal?: number;
  hsaMonthlyWithdrawal?: number;
  investmentsMonthlyWithdrawal?: number;
  retirement401kMonthlyWithdrawal?: number;
  sourceLines?: CareerSourceLine[];
  /** Canonical ordered net-pay allocation + remainder (Initial plan successor). */
  depositPlan?: CareerDepositPlan;
  paycheckInfo?: PaycheckInfo;
  paycheck?: Paycheck;
  payPlans?: CareerPayPlan[];
}

export interface PaycheckInfo {
  grossSalary: number;
  taxes: number;
  healthBenefits: number;
  retirement: number;
  retirementMatch: number;
  hsaContribution: number;
  hsaEmployerMatch: number;
  otherBenefits: number;
  retirementAccountId?: string;
  hsaAccountId?: string;
  livingExpenses: number;
  retirementMode?: 'amount' | 'percentOfSalary';
  retirementMatchMode?: 'amount' | 'percentOfRetirement';
  employerMaxMatchPercent?: number;
  hsaContributionMode?: 'amount' | 'percentOfSalary';
  hsaEmployerMatchMode?: 'amount' | 'percentOfHsaContribution';
  employerHsaDeposit?: number;
  employerHsaDepositMode?: 'amount' | 'percentOfSalary';
  period?: Record<string, 'monthly' | 'yearly'>;
}

export interface CareerPlan {
  enabled: boolean;
  entries: CareerEntry[];
}

export interface FutureRetirementPlan {
  useCareerEndAge: boolean;
  retirementAge: number;
  retirementYears: number;
}

/**
 * Purchase/long-term source line. `accountId` is the canonical target; the
 * legacy `sourceType`/`sourceId` pair is retained for existing consumers until
 * P3S migrates them, and no longer exposes a pool variant. Purchase modes are
 * intentionally distinct from `RetirementWithdrawalSourceLine` modes.
 */
export interface SourceLine {
  id: string;
  enabled: boolean;
  /** Canonical target account ID. */
  accountId?: string;
  /** @deprecated legacy consumer field; migrate to `accountId` (P3S). */
  sourceType: SourceType;
  /** @deprecated legacy consumer field; migrate to `accountId` (P3S). */
  sourceId: string;
  mode: SourceLineMode;
  amount: number;
  startAge?: number;
  syncWithRetirementAge?: boolean;
}

/**
 * Withdrawal-specific successor to the shared `SourceLine` (purchases keep the
 * `SourceLine` modes unchanged). The percentage mode uses a per-source editable
 * rate against the account's authoritative balance on the valuation date.
 */
export type RetirementWithdrawalMode = 'amount' | 'percentOfInitialBalance';

export interface RetirementWithdrawalSourceLine {
  id: string;
  label?: string;
  enabled: boolean;
  accountId: string;
  mode: RetirementWithdrawalMode;
  /** Fixed dollar amount when `mode === 'amount'`. */
  amount: number;
  /**
   * Editable percentage of the account's initial balance when
   * `mode === 'percentOfInitialBalance'`. New-item default 4; an explicit 0 is valid.
   */
  initialWithdrawalRatePercent?: number;
  /** Date-only first withdrawal date for this source. */
  firstWithdrawalDate: string;
  /** Defaults to `firstWithdrawalDate` when absent. */
  initialWithdrawalValuationDate?: string | null;
  paymentDay?: number | null;
  /** Optional marker/retirement start link. */
  startMarkerId?: string | null;
  syncWithRetirementAge?: boolean;
  startAge?: number;
  /** Explicit ordered fallback account IDs for this source. */
  fallbackAccountIds?: string[];
}

export interface CareerSourceLine {
  id: string;
  enabled: boolean;
  sourceType: SourceType;
  sourceId: string;
  contributionRate: number;
  savingsMonthly: boolean;
  monthlyWithdrawal: number;
  maxBalance?: number;
  overflowFallbackAccountId?: string | null;
  mode?: 'percentOfSalary' | 'fixedAmount';
  fixedAmount?: number;
  increaseWithPaycheck?: boolean;
  increaseWithdrawalWithPaycheck?: boolean;
}

export interface PurchaseCategory {
  id: string;
  label: string;
}

export interface Timeline {
  id: string;
  label: string;
  purchases: LargePurchase[];
  longTermPurchases: LongTermPurchase[];
  loans: Loan[];
  creditCards: CreditCard[];
  /**
   * Card-product plans (ordinary expected-payment / permanent-0% payoff) are a
   * timeline-local domain (RV04/F23: cards are timeline-specific). The base
   * `Scenario.cardPlans` field is the implicit base timeline; each timeline owns
   * an independent copy. A legacy timeline without the field normalizes to `[]`
   * and never inherits the base plan list.
   */
  cardPlans: CardPlan[];
  careerPlan: CareerPlan;
  housing: HousingEntry[];
}

export interface LargePurchase {
  id: string;
  label: string;
  enabled: boolean;
  showOnGraph: boolean;
  flagColor?: string;
  yearMonth: string;
  yearMonthMarkerId?: string | null;
  age: number;
  amount: number;
  sourceLines?: SourceLine[];
  fundingSource?: 'income' | `account:${string}`;
  categoryId?: string | null;
}

export type LongTermPurchaseEndMode = 'duration' | 'endDate';

export interface LongTermPurchase {
  id: string;
  label: string;
  enabled: boolean;
  showOnGraph: boolean;
  flagColor?: string;
  startYearMonth: string;
  endMode: LongTermPurchaseEndMode;
  durationMonths: number;
  endYearMonth: string;
  startMarkerId?: string | null;
  endMarkerId?: string | null;
  monthlyAmount: number;
  sourceLines?: SourceLine[];
  fundingSource?: 'income' | `account:${string}`;
}

export type LoanPaymentSourceAccount = string | 'income';
// Pool source variant removed from the target schema (`account:` / `income` only).
export type LoanPaymentSource = 'income' | `account:${string}`;

export interface Loan {
  id: string;
  label: string;
  enabled: boolean;
  showOnGraph: boolean;
  flagColor?: string;
  startYearMonth: string;
  startMarkerId?: string | null;
  originalAmount: number;
  downPayment: number;
  currentBalance: number;
  annualInterestRate: number;
  minimumMonthlyPayment: number;
  extraMonthlyPayment: number;
  paymentSourceAccount: LoanPaymentSourceAccount;
  paymentSource?: LoanPaymentSource;
  downPaymentSource?: LoanPaymentSource;
}

export type CreditCardPaymentMode = 'fixed' | 'payInFull' | 'minimum' | 'fixedPlusLump' | 'autopay';

export interface CreditCard {
  id: string;
  label: string;
  enabled: boolean;
  currentBalance: number;
  annualInterestRate: number;
  introEnabled: boolean;
  introEndYearMonth: string;
  introEndMarkerId?: string | null;
  monthlyCharges: number;
  paymentMode: CreditCardPaymentMode;
  fixedPaymentAmount: number;
  minimumPaymentPercent: number;
  minimumPaymentFloor: number;
  paymentSource: 'income' | `account:${string}`;
  lumpSumPaymentSource: 'income' | `account:${string}`;
  paymentDay: number;
  autopayEndYearMonth?: string;
  autopayEndMarkerId?: string | null;
  showOnGraph?: boolean;
  flagColor?: string;
}

export type HousingType = 'mortgage' | 'rental';

/**
 * Retained housing payment groups (G20/G22). Keys map to the obligation groups
 * the housing engine posts: PI+extra / rent (`payment`), taxes+insurance
 * (`taxesInsurance`), HOA+maintenance (`hoaMaintenance`), PMI (`pmi`), and the
 * acquisition down payment (`downPayment`).
 */
export type HousingFundingGroup = 'payment' | 'taxesInsurance' | 'hoaMaintenance' | 'pmi' | 'downPayment';

/**
 * Legacy mortgage/rental editor configuration. Kept for existing housing
 * consumers until P3H migrates them; `PropertyDefinition`/`LiabilityDefinition`
 * are the canonical observed shapes and link back via `sourceConfigId`.
 */
export interface HousingEntry {
  id: string;
  label: string;
  enabled: boolean;
  showOnGraph: boolean;
  flagColor?: string;

  housingType: HousingType;
  startYearMonth: string;
  startMarkerId?: string | null;

  purchasePrice: number;
  downPayment: number;
  downPaymentSource?: LoanPaymentSource;
  annualInterestRate: number;
  loanTermYears: number;
  extraMonthlyPayment: number;

  monthlyRent: number;
  endYearMonth: string;
  endMarkerId?: string | null;

  propertyTaxYearly: number;
  homeInsuranceYearly: number;
  hoaMonthly: number;
  maintenanceMonthly: number;
  pmiMonthly: number;

  rentalIncomeMonthly: number;
  rentalIncomeAccountId?: string;

  sellYearMonth: string;
  sellMarkerId?: string | null;
  appreciationRate: number;
  sellingCostsRate: number;
  saleProceedsAccountId?: string;

  usePreviousEndAsStart?: boolean;
  linkedCareerStartId?: string | null;
  linkedCareerEndId?: string | null;
  paymentSource?: LoanPaymentSource;
  taxesInsuranceSource?: LoanPaymentSource;
  hoaMaintenanceSource?: LoanPaymentSource;
  pmiSource?: LoanPaymentSource;
  /**
   * Ordered per-group funding overrides (G20/G22). Each group is an independent
   * `FundingPolicy` (explicit `primaryAccountId` + ordered `fallbackAccountIds`).
   * A **missing** group inherits the configured global default policy; an
   * explicit policy overrides it, and a valid `null` primary / empty
   * `fallbackAccountIds` is preserved rather than defaulted. When a group policy
   * is absent its legacy `*Source` scalar (above) remains the read fallback. No
   * hidden account is ever invented.
   */
  fundingPolicies?: Partial<Record<HousingFundingGroup, FundingPolicy>>;
  /**
   * Timeline-local dated funding events for the property linked to this housing
   * entry (matched by the property's `sourceConfigId`, else by `id`). RV04/F23:
   * a property's observed identity (`value`/`status`/`debtLink`) stays global and
   * authoritative, but its dated **future** funding events are per-timeline.
   * `scenario.properties[].fundingEvents` is the implicit base timeline; a named
   * timeline reads this list instead and never implicitly inherits the base list.
   * Absent is interpreted as `[]` for a named timeline.
   */
  fundingEvents?: PropertyFundingEvent[];
}

/**
 * HSA-only withdrawal configuration. Kept separate from the generic account
 * `withdrawalTaxRate`/`penaltyRate` so qualified income tax, the generic
 * penalty, and the age-based non-qualified extra penalty never collapse.
 */
export interface HsaWithdrawalPolicy {
  /**
   * Extra penalty rate (%) applied to non-qualified withdrawals before the
   * waiver age. Separately configurable; default 20. Not income tax.
   */
  nonQualifiedPenaltyRate: number;
  /**
   * Age (holder's birthday) at or after which the non-qualified extra penalty
   * is waived regardless of retirement status. Default 65.
   */
  nonQualifiedPenaltyWaiverAge: number;
}

export interface AccountWithdrawalPolicy {
  /** Whether this account may be used as an automatic fallback funding source. */
  allowAutomaticFallback: boolean;
  /** Configured income-tax assumption (%) applied to taxable withdrawals. */
  withdrawalTaxRate: number;
  /** Generic extra penalty rate (%) applied once, separately from income tax. */
  penaltyRate: number;
  /** Free-text restriction shown to the user (e.g., qualified medical only). */
  restrictionNote: string;
  /**
   * HSA-only non-qualified penalty configuration. Absent for non-HSA accounts.
   * Explicitly qualified medical spending remains tax/penalty-free.
   */
  hsa?: HsaWithdrawalPolicy;
}

/**
 * Canonical account (replaces the pool-era `BankAccountDefinition`). Owns its
 * opening balance, base return, optional retirement override and withdrawal
 * policy. There is no pool membership, shared rate or hidden scalar asset.
 */
export interface AccountDefinition {
  id: string;
  label: string;
  accountType: AccountTypePreset;
  /** Persisted dollars. Runtime postings use integer cents. */
  openingBalance: number;
  /** Effective annual return / APY (%). Missing defaults to 0. */
  annualReturnRate: number;
  /** Optional retirement-phase rate override (%); null = same as base rate. */
  retirementAnnualReturnRate: number | null;
  color?: string;
  /** Display-only ordering; never changes funding or deposit order. */
  displayOrder: number;
  withdrawalPolicy: AccountWithdrawalPolicy;
  /** Taxable-proxy assumed gain share of gross debit (%). Default 20. */
  assumedGainPercent?: number;
  /** Editable long-term capital-gains rate (%) applied to the assumed gain. Default 15. */
  capitalGainsTaxRate?: number;
}

export type LiabilityKind = 'loan' | 'mortgage' | 'zeroInterestCard' | 'saleDeficiency';

/**
 * Observed/configured debt. Negative account balances are never debt.
 * `saleDeficiency` is a persisted liability kind: an underwater-sale deficiency
 * retained as debt. The runtime deficiency amount produced by a sale is written
 * into a `LiabilityDefinition` of this kind (engine/reporting owner); unlike the
 * runtime-only `acquisitionDepositCents`, it survives as configuration.
 */
export interface LiabilityDefinition {
  id: string;
  kind: LiabilityKind;
  label?: string;
  /** Persisted dollars; positive = debt. */
  openingBalance: number;
  /** Source config (loan/housing/zero-interest card) this liability derives from. */
  sourceConfigId?: string | null;
  linkedPropertyId?: string | null;
  /** Contractual annual interest rate (%), distinct from account APY. */
  annualInterestRate?: number;
  minimumMonthlyPayment?: number;
  extraMonthlyPayment?: number;
  /** Inclusive final payment / term date. */
  endYearMonth?: string | null;
  openingYearMonth?: string | null;
  paymentDay?: number;
}

export type PropertyStatus = 'pending' | 'owned' | 'sold';
export type PropertyKind = 'primaryResidence' | 'rental' | 'other';

/** A dated funding event toward a property's required down payment. */
export interface PropertyFundingEvent {
  id: string;
  date: string;
  /** Persisted dollars requested. */
  amount: number;
  accountId?: string | null;
}

/** Property identity/lifecycle. Held deposit is runtime state, not persisted here. */
export interface PropertyDefinition {
  id: string;
  label?: string;
  kind?: PropertyKind;
  /** Persisted dollars; observed opening value. */
  value: number;
  /** Linked liability ID (e.g., mortgage); debt is counted once. */
  debtLink?: string | null;
  requiredDownPayment: number;
  status: PropertyStatus;
  sourceConfigId?: string | null;
  acquisitionYearMonth?: string | null;
  completedDate?: string | null;
  /** Property appreciation rate (%). */
  appreciationRate?: number;
  sellingCostsRate?: number;
  fundingEvents?: PropertyFundingEvent[];
}

export type OpeningMeasurement = 'assetOnly' | 'assetsMinusLiabilities';

export interface OpeningSnapshotAccountValue {
  accountId: string;
  /** Persisted dollars. */
  balance: number;
}

export interface OpeningSnapshotLiabilityValue {
  liabilityId: string;
  /** Persisted dollars; positive = debt. Observed 0 wins over configured debt. */
  balance: number;
}

export interface OpeningSnapshotPropertyValue {
  propertyId: string;
  /** Persisted dollars; observed opening value. */
  value: number;
  /** Observed linked debt (positive = debt) when present. */
  debtBalance?: number;
}

/** Observation before same-date events. Keyed by stable IDs. */
export interface OpeningSnapshot {
  date: string;
  accounts: OpeningSnapshotAccountValue[];
  liabilities: OpeningSnapshotLiabilityValue[];
  properties?: OpeningSnapshotPropertyValue[];
  measurement: OpeningMeasurement;
  sourceSnapshotId?: string | null;
}

/** Ordered account funding: primary first, then deduplicated fallbacks. */
export interface FundingPolicy {
  primaryAccountId: string | null;
  fallbackAccountIds: string[];
  /** Optional short purpose label (e.g., 'housing', 'loan'). */
  purpose?: string;
}

/** Ordered net-pay allocation with an explicit remainder destination. */
export interface CareerDepositPlan {
  allocations: CareerSourceLine[];
  remainderAccountId: string | null;
  postingDay?: number;
}

export interface OrdinaryCardSchedule {
  kind: 'expectedPayment';
  id: string;
  label: string;
  enabled: boolean;
  /** Expected payment per scheduled month (dollars). Missing defaults to 0. */
  amount: number;
  startYearMonth: string;
  /** Inclusive end; default = start + 11 months (twelve payments). */
  endYearMonth: string;
  startMarkerId?: string | null;
  endMarkerId?: string | null;
  paymentDay: number;
  funding: FundingPolicy;
  showOnGraph?: boolean;
  flagColor?: string;
}

export interface ZeroInterestCardPlan {
  kind: 'zeroInterestPayoff';
  id: string;
  label: string;
  enabled: boolean;
  /** Linked liability ID; opening debt is counted once. */
  liabilityId: string;
  /** Persisted dollars; opening balance (mirrors the liability). */
  initialBalance: number;
  startYearMonth: string;
  /** Inclusive target payoff date. */
  targetYearMonth: string;
  startMarkerId?: string | null;
  endMarkerId?: string | null;
  paymentDay: number;
  funding: FundingPolicy;
  /** Explicit residual lump-sum payoff date; defaults to `targetYearMonth`. */
  payoffYearMonth?: string | null;
  payoffFunding?: FundingPolicy;
  showOnGraph?: boolean;
  flagColor?: string;
}

/** Two card product models. APR/charges/minimums are not simulated. */
export type CardPlan = OrdinaryCardSchedule | ZeroInterestCardPlan;

export interface NetWorthCustomAccount {
  id: string;
  label: string;
  balance: number;
}

export interface NetWorthHistoryAccountSnapshot {
  id: string;
  label: string;
  balance: number;
}

/**
 * Origin of a net-worth history observation. Optional on purpose: a legacy
 * record with no provenance stays unspecified rather than being given a
 * fabricated origin.
 */
export type NetWorthHistoryProvenance = 'manual' | 'imported' | 'projected';

export interface NetWorthHistoryEntry {
  id: string;
  date: string;
  accounts: NetWorthHistoryAccountSnapshot[];
  /**
   * Total for this observation. Legacy entries are `assetOnly` (sum of account
   * balances) and were never negative; signed records use
   * `assetsMinusLiabilities` and may be negative. The stored value is never
   * clamped — a negative net-worth observation is a valid record.
   */
  totalNetWorth: number;
  /**
   * Explicit measurement basis. A legacy entry without one decodes to
   * `assetOnly`; an old asset-only total is never reinterpreted as signed net
   * worth.
   */
  measurement?: MeasurementBasis;
  /** Optional origin of the observation; absent = legacy/unspecified. */
  provenance?: NetWorthHistoryProvenance;
  /** Optional observation snapshot id this record was derived from. */
  sourceSnapshotId?: string | null;
}

export interface TrajectoryYear {
  age: number;
  calendarYear: number;
  isBaselineNow: boolean;
  startBalance: number;
  endBalance: number;
  salary: number;
  netIncome: number;
  careerContribution: number;
  contribution: number;
  withdrawal: number;
  taxesPaid: number;
  penaltiesPaid: number;
  annualReturnRate: number;
  inflationRate: number;
  depleted: boolean;
  savingsBalances: Record<string, number>;
  accountBalancesById: Record<string, number>;
  creditCardBalancesById: Record<string, number>;
  totalCreditCardDebt: number;
}

export interface TrajectorySnapshot {
  id: string;
  label: string;
  createdAt: string;
  survivesToEnd: boolean;
  depletedAge: number | null;
  endAge: number;
  endingBalance: number;
  summary: string;
  years: TrajectoryYear[];
  /** Measurement/schema/engine/date metadata frozen with the snapshot. */
  context?: ResultContextMetadata;
}

/** How a result's money values should be interpreted (signed net worth vs assets-only). */
export type MeasurementBasis = 'assetOnly' | 'assetsMinusLiabilities' | 'accountAssets';

/** Per-result measurement/schema/engine/date metadata for views and frozen snapshots. */
export interface ResultContextMetadata {
  measurement: MeasurementBasis;
  /** Date-only observation start. */
  startDate: string;
  /** Date-only observation end. */
  endDate: string;
  schemaVersion?: number;
  engineRevision?: string;
  /** Named-context identifier (revision/cache key). */
  contextId?: string;
}

/**
 * One canonical trajectory annual point (D20 `formatVersion: 2`): the actual
 * year-close stocks in **integer cents**. `netWorthCents` is signed
 * (assets − liabilities) and may be negative; `accountAssetsCents` (account-only
 * assets) and `liabilityCents` (positive = debt) stay separate so an asset-only
 * figure is never silently reinterpreted as signed net worth.
 */
export interface CanonicalTrajectoryAnnualPoint {
  /** Calendar-year label of the report group. */
  calendarYear: number;
  /** Date-only closing observation for this year. */
  closingDate: string;
  /** Signed net worth in integer cents (may be negative; never clamped). */
  netWorthCents: number;
  /** Account-only assets in integer cents. */
  accountAssetsCents: number;
  /** Liabilities (positive = debt) in integer cents. */
  liabilityCents: number;
}

/**
 * Required, validated freeze context for a canonical snapshot. Unlike the
 * legacy optional {@link ResultContextMetadata}, every field is mandatory, so a
 * canonical snapshot can never be persisted with fabricated or partial modern
 * metadata. Structurally assignable to `ResultContextMetadata`.
 */
export interface CanonicalTrajectoryContext {
  measurement: MeasurementBasis;
  /** Date-only observation start. */
  startDate: string;
  /** Date-only observation end. */
  endDate: string;
  schemaVersion: number;
  engineRevision: string;
  /** Named-context identifier (revision/cache key). */
  contextId?: string;
}

/**
 * Versioned (D20 `formatVersion: 2`) trajectory snapshot: an immutable,
 * cents-only record of actual year-close stocks plus the exact context it was
 * produced under. Deliberately **distinct** from the legacy
 * {@link TrajectorySnapshot}, which stays unversioned and is never silently
 * reinterpreted as this shape.
 */
export interface CanonicalTrajectorySnapshot {
  formatVersion: 2;
  id: string;
  label: string;
  createdAt: string;
  context: CanonicalTrajectoryContext;
  annualPoints: CanonicalTrajectoryAnnualPoint[];
}

/**
 * Persisted trajectory entry: either a legacy (unversioned) derived snapshot or
 * a canonical `formatVersion: 2` snapshot. Discriminate with the `isCanonical`
 * guard / the presence of `formatVersion`.
 */
export type AnyTrajectorySnapshot = TrajectorySnapshot | CanonicalTrajectorySnapshot;

export interface NetWorthConfig {
  /** Canonical global accounts (rates, policies and opening balances live here). */
  accounts: AccountDefinition[];
  customAccounts?: NetWorthCustomAccount[];
  history?: NetWorthHistoryEntry[];
  /** Dated observation snapshot; observed debt wins over configured debt. */
  openingSnapshot?: OpeningSnapshot;
  asOfDate: string;
}

export type ExpenseOriginType = 'manual' | 'imported';
/** No pool grouping in the target schema. */
export type ExpenseGroupingMode = 'account';
export type ExpenseImportFileType = 'csv' | 'pdf' | 'unknown';
export type ExpenseImportStatus = 'staged' | 'ready' | 'needs_review' | 'error' | 'applied';

/**
 * Occurrence provenance for one obligation identity. Stable keys are
 * `planner:<entryId>:<date>` and `recurrence:<eventId>:<date>`.
 */
export type PlannerProvenance = 'planner' | 'recurrence' | 'imported';
/** Original transaction direction, preserved for occurred (view-only) imports. */
export type PlannerSourceSign = 'debit' | 'credit';
/**
 * Occurrence planning status. `occurred` is a view-only historical observation
 * with no projection/planning effect; `planned` is a projected obligation.
 * Never inferred from a display date or simulation anchor.
 */
export type PlanningStatus = 'occurred' | 'planned';

export interface PlannerProvenanceFields {
  provenance?: PlannerProvenance;
  /** Original source date (date-only) for occurred imports. */
  sourceDate?: string | null;
  /** Original sign; imports must not be inferred from absolute values. */
  sourceSign?: PlannerSourceSign | null;
  /** Time the source record was observed/staged. */
  asOf?: string | null;
  /**
   * Explicit occurrence status. Imported observations default to `'occurred'`
   * (view-only); manual plans/recurrences default to `'planned'`. An explicit
   * valid value (e.g. a deliberately planned import) is preserved; an invalid
   * value is ignored in favour of the provenance-derived default. No date-based
   * promotion is ever applied.
   */
  planningStatus?: PlanningStatus;
}

export interface ExpenseEntry extends PlannerProvenanceFields {
  id: string;
  label: string;
  amount: number;
  startDate: string;
  endDate: string;
  accountId: string | null;
  notes: string;
  originType: ExpenseOriginType;
  importSourceId: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
  categoryId?: string | null;
  color?: string;
  fundingSource?: 'income' | `account:${string}`;
  startMarkerId?: string | null;
  endMarkerId?: string | null;
}

export interface ExpenseCategory {
  id: string;
  label: string;
  color?: string;
}

export interface WeeklyBalancePoint {
  weekStartDate: string;
  balance: number;
}

export type RecurringEventCadence = 'weekly' | 'monthly';
export type RecurringEventRule = 'on_date' | 'every_friday' | 'first_monday_after';

export interface RecurringExpenseEvent extends PlannerProvenanceFields {
  id: string;
  label: string;
  amount: number;
  accountId: string;
  paymentAccountId?: string | null;
  categoryId: string | null;
  cadence: RecurringEventCadence;
  rule: RecurringEventRule;
  startDate: string;
  endDate: string;
  dayOfMonth?: number;
  anchorDate?: string;
  enabled: boolean;
  color?: string;
  fundingSource?: 'income' | `account:${string}`;
  startMarkerId?: string | null;
  endMarkerId?: string | null;
}

export interface ExpenseImportSource {
  id: string;
  batchId: string;
  fileName: string;
  fileType: ExpenseImportFileType;
  previewText: string;
  status: ExpenseImportStatus;
  parseNotes: string[];
  confidence: number;
  importedAt: string;
  appliedAt: string;
  entryIds: string[];
}

export interface ExpenseTimelineUiState {
  groupingMode: ExpenseGroupingMode;
  zoomLevel: number;
  rowHeight: number;
  density: 'compact' | 'comfortable';
  snapToDay: boolean;
  scrubberDate: string;
  windowStartDate: string;
  windowEndDate: string;
  selectedAccountIds: string[];
  collapsedTrackIds: string[];
  trackerVisibleAccountIds: string[];
  planningWeekStartDay: number;
}

export interface ExpensesConfig {
  entries: ExpenseEntry[];
  imports: ExpenseImportSource[];
  categoriesByAccountId: Record<string, ExpenseCategory[]>;
  weeklyBalanceByAccountId: Record<string, WeeklyBalancePoint[]>;
  maxBalanceByAccountId: Record<string, number>;
  activePlanningAccountId: string | null;
  recurringEvents: RecurringExpenseEvent[];
  ui: ExpenseTimelineUiState;
}

export interface WithdrawalPlan {
  mode: WithdrawalMode;
  minimumYearlyWithdrawal: number;
  maximumYearlyWithdrawal: number;
  useRetirementAgeAsWithdrawalStartAge: boolean;
  /**
   * Explicit ordered retirement fallback account IDs. Distinct from
   * `FundingPolicy.fallbackAccountIds` (ordinary obligation funding) and from
   * per-source `RetirementWithdrawalSourceLine.fallbackAccountIds`.
   */
  fallbackAccountIds?: string[];
  sourceLines?: RetirementWithdrawalSourceLine[];
}

export interface ManualReturnModel {
  inflationEnabled: boolean;
  inflationRate: number;
}

export interface CashflowItem {
  id: string;
  category: CashflowCategory;
  label: string;
  enabled: boolean;
  cadence: CashflowCadence;
  direction: CashflowDirection;
  amount: number;
  startAge: number;
  endAge: number;
  accountId?: string | null;
  startYearMonth?: string;
  endYearMonth?: string;
  startMarkerId?: string | null;
  endMarkerId?: string | null;
}

export type LifeEventType =
  | 'job_change'
  | 'career_break'
  | 'house_purchase'
  | 'house_sale'
  | 'large_expense'
  | 'custom_income'
  | 'custom_expense';

export interface LifeEvent {
  id: string;
  type: LifeEventType;
  label: string;
  enabled: boolean;
  cadence: CashflowCadence;
  direction: CashflowDirection;
  startAge: number;
  endAge: number;
  amount: number;
  newSalary: number;
  annualSalaryGrowthOverride: number;
  accountId?: string | null;
  startYearMonth?: string;
  endYearMonth?: string;
  startMarkerId?: string | null;
  endMarkerId?: string | null;
}

export interface Scenario {
  profile: PersonProfile;
  options: AgeOptions;
  portfolio: PortfolioConfig;
  careerPlan: CareerPlan;
  netWorth: NetWorthConfig;
  futureRetirement: FutureRetirementPlan;
  withdrawal: WithdrawalPlan;
  manualReturns: ManualReturnModel;
  purchaseCategories: PurchaseCategory[];
  dateMarkers: DateMarker[];
  timelines: Timeline[];
  activeTimelineId: string | null;
  /** Legacy and/or canonical (versioned) trajectory entries. */
  trajectorySnapshots: AnyTrajectorySnapshot[];
  largePurchases: LargePurchase[];
  creditCards: CreditCard[];
  longTermPurchases: LongTermPurchase[];
  loans: Loan[];
  housing: HousingEntry[];
  cashflowItems: CashflowItem[];
  lifeEvents: LifeEvent[];
  expenses: ExpensesConfig;
  incomeFallbackAccountId?: string | null;
  incomeFallbackAccountId2?: string | null;
  /** Global default account funding policy for obligations (primary + ordered fallbacks). */
  fundingPolicy?: FundingPolicy;
  /** Canonical observed/opening liabilities keyed by stable ID. */
  liabilities?: LiabilityDefinition[];
  /** Canonical observed/opening properties keyed by stable ID. */
  properties?: PropertyDefinition[];
  /** Canonical card product model (two card types). */
  cardPlans?: CardPlan[];
}

export interface ProjectionYear {
  age: number;
  calendarYear: number;
  isBaselineNow: boolean;
  periodMonths: number;
  startBalance: number;
  salary: number;
  netIncome: number;
  careerContribution: number;
  contribution: number;
  careerLabel: string;
  withdrawal: number;
  extraCashflow: number;
  lifeEventCashflow: number;
  annualReturnRate: number;
  inflationRate: number;
  endBalance: number;
  depleted: boolean;
  careerId: string | null;
  taxesPaid: number;
  penaltiesPaid: number;
  savingsBalances: Record<string, number>;
  accountBalancesById: Record<string, number>;
  creditCardBalancesById: Record<string, number>;
  totalCreditCardDebt: number;
}

export interface PurchaseFlag {
  id: string;
  label: string;
  age: number;
  amount: number;
  type: 'large_purchase' | 'long_term_purchase' | 'loan' | 'housing';
  color: string;
  yearMonth?: string;
}

export interface MonthlySnapshot {
  age: number;
  calendarYear: number;
  calendarMonth: number;
  periodMonths: number;
  startBalance: number;
  salary: number;
  netIncome: number;
  careerContribution: number;
  contribution: number;
  careerLabel: string;
  withdrawal: number;
  taxesPaid: number;
  penaltiesPaid: number;
  annualReturnRate: number;
  inflationRate: number;
  endBalance: number;
  accountBalancesById: Record<string, number>;
  accountActivity?: Record<string, Array<{ label: string; amount: number }>>;
}

export interface MonthlyWaterfallSnapshot {
  calendarYear: number;
  calendarMonth: number;
  careerLabel: string;
  takeHomeIncome: number;
  careerSavingsDeposits: number;
  careerWithdrawals: number;
  housingCosts: number;
  housingIncomeCosts: number;
  otherIncomeExpenses: number;
  leftoverIncome: number;
}

export interface IncomePoolUsageItem {
  id: string;
  label: string;
  requested: number;
  fromIncome: number;
  fromFallback: number;
  shortfall: number;
}

export interface IncomePoolUsagePeriod {
  pool: 'monthly' | 'yearly';
  periodKey: string;
  budget: number;
  totalRequested: number;
  totalFromIncome: number;
  totalFromFallback: number;
  totalShortfall: number;
  exceedsIncome: boolean;
  hasUnmet: boolean;
  items: IncomePoolUsageItem[];
}

export interface IncomeValidationGroup {
  pool: 'monthly' | 'yearly';
  periodKeys: string[];
  budget: number;
  totalRequested: number;
  totalFromIncome: number;
  totalFromFallback: number;
  totalShortfall: number;
  minOverage: number;
  maxOverage: number;
  exceedsIncome: boolean;
  hasUnmet: boolean;
  items: IncomePoolUsageItem[];
}

export interface IncomeValidation {
  hasOverspend: boolean;
  periods: IncomePoolUsagePeriod[];
  groups: IncomeValidationGroup[];
}

export interface ProjectionResult {
  years: ProjectionYear[];
  survivesToEnd: boolean;
  depletedAge: number | null;
  endAge: number;
  endingBalance: number;
  summary: string;
  simulationStartDate: string;
  simulationStartYearMonth: string;
  careerEndSavingsBalances: Record<string, Record<string, number>>;
  firstRetirementYearPlannedAccountWithdrawals: Record<string, number>;
  purchaseFundingShortfalls: Record<string, number>;
  purchaseFirstAffordableAge: Record<string, number | null>;
  purchasePostPurchaseDisplayBalances: Record<string, Record<string, number> | null>;
  longTermPurchaseFundingShortfalls: Record<string, number>;
  loanFundingShortfalls: Record<string, number>;
  warnings?: string[];
  incomeFundedItemStatuses: Record<string, { status: 'covered' | 'fallback' | 'shortfall'; shortfallAmount?: number; fallbackDetails?: { accountId: string; amount: number }[]; firstFallbackYearMonth?: string }>;
  incomeUsageByMonth: Record<string, { availableIncome: number; items: { id: string; label: string; amount: number }[] }>;
  incomeValidation: IncomeValidation;
  housingPayoffMonths: Record<string, number | null>;
  housingTotalMonthlyCosts: Record<string, number>;
  housingFundingShortfalls: Record<string, number>;
   creditCardFundingShortfalls: Record<string, number>;
  creditCardBalancesById: Record<string, number>;
  careerWithdrawalShortfalls: Record<string, number>;
  monthlySnapshots?: MonthlySnapshot[];
  monthlyWaterfall?: MonthlyWaterfallSnapshot[];
  /** Measurement/schema/engine/date metadata for this result context. */
  context?: ResultContextMetadata;
}
