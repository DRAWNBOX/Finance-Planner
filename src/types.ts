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

export interface WithdrawalPlan {
  mode: WithdrawalMode;
  firstYearAmount: number;
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

export interface Scenario {
  profile: PersonProfile;
  portfolio: PortfolioConfig;
  contribution: ContributionPlan;
  withdrawal: WithdrawalPlan;
  returnMode: ReturnMode;
  manualReturns: ManualReturnModel;
  cashflowItems: CashflowItem[];
}

export interface ProjectionYear {
  age: number;
  calendarYear: number;
  startBalance: number;
  contribution: number;
  withdrawal: number;
  extraCashflow: number;
  annualReturnRate: number;
  inflationRate: number;
  endBalance: number;
  depleted: boolean;
}

export interface ProjectionResult {
  years: ProjectionYear[];
  survivesToEnd: boolean;
  depletedAge: number | null;
  endAge: number;
  endingBalance: number;
  summary: string;
  historicalWindowLabel?: string;
}

export interface HistoricalYear {
  year: number;
  equityReturn: number;
  inflationRate: number;
  fixedIncomeReturn: number;
}
