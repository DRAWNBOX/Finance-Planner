export type ReturnMode = 'manual' | 'historical';
export type FixedIncomeDuration = 'one_year' | 'ten_year';
export type WithdrawalMode = 'four_percent' | 'specified';
export type CashflowCadence = 'one_time' | 'recurring';
export type CashflowDirection = 'inflow' | 'outflow';
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

export interface SavingsBalances {
  emergencyFund: number;
  hsa: number;
  investments: number;
  retirement401k: number;
}

export interface SavingsBalanceFlags {
  emergencyFund: boolean;
  hsa: boolean;
  investments: boolean;
  retirement401k: boolean;
}

export interface LargePurchase {
  id: string;
  label: string;
  enabled: boolean;
  age: number;
  amount: number;
  sourceAmounts: SavingsBalances;
}

export interface SavingsTrackerConfig {
  annualInterestRates: SavingsBalances;
}

export interface NetWorthConfig {
  accountBalances: SavingsBalances;
  asOfDate: string;
}

export interface WithdrawalPlan {
  mode: WithdrawalMode;
  firstYearAmount: number;
  firstYearAccountWithdrawals: SavingsBalances;
  firstYearAccountUseFourPercent: SavingsBalanceFlags;
  inflationAdjusted: boolean;
}

export interface ManualReturnModel {
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
  cashflowItems: CashflowItem[];
  lifeEvents: LifeEvent[];
}

export interface ProjectionYear {
  age: number;
  calendarYear: number;
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
}

export interface HistoricalYear {
  year: number;
  equityReturn: number;
  inflationRate: number;
  fixedIncomeReturn: number;
}
