export type ReturnMode = 'manual' | 'historical';
export type FixedIncomeDuration = 'one_year' | 'ten_year';
export type WithdrawalMode = 'four_percent' | 'specified';
export type CashflowCadence = 'one_time' | 'recurring';
export type CashflowDirection = 'inflow' | 'outflow';
export type LegacyPoolId = 'emergencyFund' | 'hsa' | 'investments' | 'retirement401k';
export type SourceType = 'pool' | 'account';
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
  useDateBasedAge: boolean;
  dateOfBirth: string;
}

export interface PortfolioConfig {
  currentAssets: number;
  equityAllocation: number;
  fixedIncomeAllocation: number;
  fixedIncomeDuration: FixedIncomeDuration;
}

export interface ContributionPlan {
  yearlyContribution: number;
  yearlyIncreaseRate: number;
}

export type BalanceInputMode = string;

export interface CareerEntry {
  id: string;
  label: string;
  enabled: boolean;
  usePreviousCareerStartAge: boolean;
  useBirthdayBasedStartAge?: boolean;
  startYearMonth?: string;
  endYearMonth?: string;
  startAge: number;
  endAge: number;
  startingSalary: number;
  annualRaiseRate: number;
  savingsRate: number;
  employerMatchRate: number;
  bonusRate: number;
  bonusSavingsRate: number;
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
  takeHomePay?: { amount: number; period: 'monthly' | 'yearly' };
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

export type SavingsBalances = Record<string, number>;
export type SavingsBalanceFlags = Record<string, boolean>;

export interface SourceLine {
  id: string;
  enabled: boolean;
  sourceType: SourceType;
  sourceId: string;
  mode: SourceLineMode;
  amount: number;
  startAge?: number;
  syncWithRetirementAge?: boolean;
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
}

export interface LargePurchase {
  id: string;
  label: string;
  enabled: boolean;
  showOnGraph: boolean;
  flagColor?: string;
  yearMonth: string;
  age: number;
  amount: number;
  sourceAmounts: SavingsBalances;
  sourceLines?: SourceLine[];
  fundingSource?: 'income' | `account:${string}`;
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
  monthlyAmount: number;
  sourceAmounts: SavingsBalances;
  sourceLines?: SourceLine[];
  fundingSource?: 'income' | `account:${string}`;
}

export type LoanPaymentSourceAccount = string | 'income';
export type LoanPaymentSource = 'income' | `pool:${string}` | `account:${string}`;

export interface Loan {
  id: string;
  label: string;
  enabled: boolean;
  showOnGraph: boolean;
  flagColor?: string;
  startYearMonth: string;
  originalAmount: number;
  downPayment: number;
  currentBalance: number;
  annualInterestRate: number;
  minimumMonthlyPayment: number;
  extraMonthlyPayment: number;
  paymentSourceAccount: LoanPaymentSourceAccount;
  paymentSource?: LoanPaymentSource;
}

export interface SavingsTrackerConfig {
  annualInterestRates: SavingsBalances;
}

export interface PoolDefinition {
  id: string;
  label: string;
  enabled: boolean;
  priority: number;
  color?: string;
  legacyFallbackId?: LegacyPoolId;
}

export interface AccountRuleConfig {
  taxRate: number;
  penaltyRate: number;
  softRestrictionNote: string;
}

export interface BankAccountDefinition {
  id: string;
  label: string;
  poolId: string;
  priority: number;
  accountType: AccountTypePreset;
  annualReturnRate: number;
  balance: number;
  ruleOverrides?: Partial<AccountRuleConfig>;
}

export interface NetWorthCustomAccount {
  id: string;
  label: string;
  balance: number;
}

export type NetWorthImportFileType = 'csv' | 'pdf' | 'unknown';
export type NetWorthImportStatus = 'ready' | 'needs_review' | 'error' | 'applied';
export type NetWorthImportApplyMode = 'net_worth_only' | 'net_worth_and_expenses';

export interface NetWorthImportSourceAccount {
  id: string;
  label: string;
  balance: number;
}

export interface BankImportParseResult {
  detectedAccountId: string | null;
  detectedBalance: number | null;
  statementDate: string;
  confidence: number;
  status: Exclude<NetWorthImportStatus, 'applied'>;
  parseNotes: string[];
  previewText: string;
}

export interface NetWorthImportRecord {
  id: string;
  fileName: string;
  fileType: NetWorthImportFileType;
  previewText: string;
  detectedAccountId: string | null;
  detectedBalance: number | null;
  statementDate: string;
  selectedAccountId: string | null;
  status: NetWorthImportStatus;
  confidence: number;
  parseNotes: string[];
  applyMode?: NetWorthImportApplyMode;
  applied: boolean;
  appliedAt: string;
}

export interface NetWorthHistoryAccountSnapshot {
  id: string;
  label: string;
  balance: number;
}

export interface NetWorthHistoryEntry {
  id: string;
  date: string;
  accounts: NetWorthHistoryAccountSnapshot[];
  totalNetWorth: number;
}

export interface NetWorthConfig {
  accountBalances: SavingsBalances;
  pools?: PoolDefinition[];
  bankAccounts?: BankAccountDefinition[];
  customAccounts?: NetWorthCustomAccount[];
  imports?: NetWorthImportRecord[];
  history?: NetWorthHistoryEntry[];
  asOfDate: string;
}

export type ExpenseOriginType = 'manual' | 'imported';
export type ExpenseGroupingMode = 'account' | 'pool';
export type ExpenseImportFileType = 'csv' | 'pdf' | 'unknown';
export type ExpenseImportStatus = 'staged' | 'ready' | 'needs_review' | 'error' | 'applied';

export interface ExpenseEntry {
  id: string;
  label: string;
  amount: number;
  startDate: string;
  endDate: string;
  accountId: string | null;
  poolId: string | null;
  notes: string;
  originType: ExpenseOriginType;
  importSourceId: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
  categoryId?: string | null;
  color?: string;
  fundingSource?: 'income' | `account:${string}`;
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

export interface RecurringExpenseEvent {
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
  selectedPoolIds: string[];
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
  firstYearAmount: number;
  minimumYearlyWithdrawal: number;
  maximumYearlyWithdrawal: number;
  useRetirementAgeAsWithdrawalStartAge: boolean;
  firstYearAccountWithdrawals: SavingsBalances;
  firstYearAccountUseFourPercent: SavingsBalanceFlags;
  sourceLines?: SourceLine[];
  inflationAdjusted: boolean;
}

export interface ManualReturnModel {
  inflationEnabled: boolean;
  inflationRate: number;
  preRetirementEquityReturn: number;
  postRetirementEquityReturn: number;
  fixedIncomeReturn: number;
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
  inflationAdjusted: boolean;
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
  inflationAdjusted: boolean;
}

export interface Scenario {
  profile: PersonProfile;
  options: AgeOptions;
  portfolio: PortfolioConfig;
  contribution: ContributionPlan;
  careerPlan: CareerPlan;
  savingsTracker: SavingsTrackerConfig;
  netWorth: NetWorthConfig;
  futureRetirement: FutureRetirementPlan;
  withdrawal: WithdrawalPlan;
  returnMode: ReturnMode;
  manualReturns: ManualReturnModel;
  largePurchases: LargePurchase[];
  longTermPurchases: LongTermPurchase[];
  loans: Loan[];
  cashflowItems: CashflowItem[];
  lifeEvents: LifeEvent[];
  expenses: ExpensesConfig;
  incomeFallbackAccountId?: string | null;
  incomeFallbackAccountId2?: string | null;
}

export interface ProjectionYear {
  age: number;
  calendarYear: number;
  isBaselineNow: boolean;
  periodMonths: number;
  startBalance: number;
  salary: number;
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
  savingsBalances: SavingsBalances;
  accountBalancesById: Record<string, number>;
}

export interface PurchaseFlag {
  id: string;
  label: string;
  age: number;
  amount: number;
  type: 'large_purchase' | 'long_term_purchase' | 'loan';
  color: string;
}

export interface ProjectionResult {
  years: ProjectionYear[];
  survivesToEnd: boolean;
  depletedAge: number | null;
  endAge: number;
  endingBalance: number;
  summary: string;
  historicalWindowLabel?: string;
  careerEndSavingsBalances: Record<string, SavingsBalances>;
  firstRetirementYearPlannedAccountWithdrawals: SavingsBalances;
  purchaseFundingShortfalls: Record<string, number>;
  purchaseFirstAffordableAge: Record<string, number | null>;
  purchasePostPurchaseDisplayBalances: Record<string, Record<string, number> | null>;
  longTermPurchaseFundingShortfalls: Record<string, number>;
  loanFundingShortfalls: Record<string, number>;
  warnings?: string[];
  incomeFundedItemStatuses: Record<string, { status: 'covered' | 'fallback' | 'shortfall'; shortfallAmount?: number }>;
}

export interface HistoricalYear {
  year: number;
  equityReturn: number;
  inflationRate: number;
  fixedIncomeReturn: number;
}
