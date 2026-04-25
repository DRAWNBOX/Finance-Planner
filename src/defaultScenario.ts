import type { CashflowCategory, CashflowItem, Scenario } from './types';

const makeItemId = (category: CashflowCategory) => `${category}-default`;

export const createDefaultCashflowItem = (
  category: CashflowCategory,
  currentAge: number,
  retirementAge: number,
  retirementYears: number
): CashflowItem => {
  const retirementEndAge = retirementAge + retirementYears;

  switch (category) {
    case 'social_security':
      return {
        id: makeItemId(category),
        category,
        label: 'Social Security',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        amount: 24000,
        startAge: retirementAge,
        endAge: retirementEndAge,
        inflationAdjusted: true
      };
    case 'social_security_spouse':
      return {
        id: makeItemId(category),
        category,
        label: 'SS (Spouse)',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        amount: 18000,
        startAge: retirementAge,
        endAge: retirementEndAge,
        inflationAdjusted: true
      };
    case 'inheritance':
      return {
        id: makeItemId(category),
        category,
        label: 'Inheritance',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        amount: 50000,
        startAge: retirementAge + 5,
        endAge: retirementAge + 5,
        inflationAdjusted: false
      };
    case 'college_child_1':
    case 'college_child_2':
    case 'college_child_3':
      return {
        id: makeItemId(category),
        category,
        label:
          category === 'college_child_1'
            ? 'College Child 1'
            : category === 'college_child_2'
              ? 'College Child 2'
              : 'College Child 3',
        enabled: true,
        cadence: 'recurring',
        direction: 'outflow',
        amount: 12000,
        startAge: currentAge + 5,
        endAge: currentAge + 8,
        inflationAdjusted: true
      };
    case 'pension_1':
      return {
        id: makeItemId(category),
        category,
        label: 'Pension 1',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        amount: 15000,
        startAge: retirementAge,
        endAge: retirementEndAge,
        inflationAdjusted: true
      };
    case 'pension_2':
      return {
        id: makeItemId(category),
        category,
        label: 'Pension 2',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        amount: 10000,
        startAge: retirementAge,
        endAge: retirementEndAge,
        inflationAdjusted: true
      };
    case 'cash_benefit_1':
      return {
        id: makeItemId(category),
        category,
        label: 'Cash Benefit 1',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        amount: 25000,
        startAge: retirementAge + 3,
        endAge: retirementAge + 3,
        inflationAdjusted: false
      };
    case 'cash_benefit_2':
      return {
        id: makeItemId(category),
        category,
        label: 'Cash Benefit 2',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        amount: 15000,
        startAge: retirementAge + 10,
        endAge: retirementAge + 10,
        inflationAdjusted: false
      };
    case 'home_real_estate':
      return {
        id: makeItemId(category),
        category,
        label: 'Home/Real Estate',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        amount: 80000,
        startAge: retirementAge + 8,
        endAge: retirementAge + 8,
        inflationAdjusted: false
      };
  }
};

export const defaultScenario: Scenario = {
  profile: {
    currentAge: 45,
    retirementAge: 65,
    retirementYears: 30
  },
  portfolio: {
    currentAssets: 500000,
    equityAllocation: 75,
    fixedIncomeAllocation: 25,
    fixedIncomeDuration: 'one_year'
  },
  contribution: {
    yearlyContribution: 17500,
    yearlyIncreaseRate: 2.9
  },
  withdrawal: {
    mode: 'specified',
    firstYearAmount: 40000,
    inflationAdjusted: true
  },
  returnMode: 'manual',
  manualReturns: {
    inflationRate: 2.9,
    preRetirementEquityReturn: 5,
    postRetirementEquityReturn: 5,
    fixedIncomeReturn: 2.9
  },
  cashflowItems: []
};
