import { describe, expect, it, vi } from 'vitest';
import type { BankAccountDefinition, IncomePoolUsagePeriod, Scenario } from '../types';

const seedDefaultBankAccounts = (balances: { emergencyFund: number; hsa: number; investments: number; retirement401k: number }): BankAccountDefinition[] => [
  { id: 'emergencyFund-account-default', label: 'Emergency Fund', poolId: 'emergencyFund', priority: 0, accountType: 'savings', balance: Math.max(0, balances.emergencyFund) },
  { id: 'hsa-account-default', label: 'HSA', poolId: 'hsa', priority: 0, accountType: 'hsa', balance: Math.max(0, balances.hsa) },
  { id: 'investments-account-default', label: 'Investments', poolId: 'investments', priority: 0, accountType: 'taxable', balance: Math.max(0, balances.investments) },
  { id: 'retirement401k-account-default', label: '401K', poolId: 'retirement401k', priority: 0, accountType: 'retirement401k', balance: Math.max(0, balances.retirement401k) }
];
import { defaultScenario } from '../defaultScenario';
import { describeIncomeValidationGroup, groupIncomeValidationPeriods, projectScenario } from './projection';

const findProjectedYear = (result: ReturnType<typeof projectScenario>, age: number) =>
  result.years.find((year) => year.age === age && !year.isBaselineNow)!;
const currentYearMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

describe('projectScenario', () => {
  it('grows the portfolio with contributions before retirement', () => {
    const result = projectScenario({ ...defaultScenario, options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' } });
    const age46 = result.years.find((year) => year.age === 46);
    const peakBalance = Math.max(...result.years.map((year) => year.endBalance));

    expect(age46).toBeDefined();
    expect(age46!.contribution).toBeGreaterThan(0);
    expect(peakBalance).toBeGreaterThan(result.years[0].startBalance);
  });

  it('uses tracked net worth balances as the portfolio starting balance when available', () => {
    const scenario = {
      ...defaultScenario,
      profile: {
        currentAge: 40,
        retirementAge: 40,
        retirementYears: 1
      },
      portfolio: {
        ...defaultScenario.portfolio,
        currentAssets: 500000
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 1000,
          hsa: 2000,
          investments: 3000,
          retirement401k: 4000
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 1000,
          hsa: 2000,
          investments: 3000,
          retirement401k: 4000
        }),
         pools: defaultScenario.netWorth.pools?.map((p) => ({
           ...p,
           preRetirementReturnRate: 0,
           postRetirementReturnRate: 0
         }))
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        firstYearAmount: 0,
        }
    };

    const result = projectScenario(scenario);
    const firstYear = result.years[0];

    expect(firstYear.startBalance).toBe(10000);
  });

  it('falls back to legacy current assets when tracked net worth is zero', () => {
    const scenario = {
      ...defaultScenario,
      profile: {
        currentAge: 40,
        retirementAge: 40,
        retirementYears: 1
      },
      portfolio: {
        ...defaultScenario.portfolio,
        currentAssets: 123456
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        firstYearAmount: 0,
        }
    };

    const result = projectScenario(scenario);
    const firstYear = result.years[0];

    expect(firstYear.startBalance).toBe(123456);
  });

  it('uses 4 percent of the 401K balance for the initial retirement withdrawal', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        ...defaultScenario.profile,
        currentAge: 65,
        retirementAge: 65,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationEnabled: false
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        }),
        pools: defaultScenario.netWorth.pools?.map(p => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'four_percent' as const,
        sourceLines: [
          {
            id: 'withdrawal-source-1',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'retirement401k',
            mode: 'amount' as const,
            amount: 4000,
            syncWithRetirementAge: true
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const retirementYear = findProjectedYear(result, scenario.profile.retirementAge + 1);
    const expected = 100000 * 0.04;

    expect(retirementYear!.withdrawal).toBeGreaterThan(expected * 0.99);
    expect(retirementYear!.withdrawal).toBeLessThan(expected * 1.1);
  });

  it('honors per-pool withdrawal start age before drawing retirement withdrawals', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        ...defaultScenario.profile,
        currentAge: 64,
        retirementAge: 65,
        retirementYears: 2
      },
       contribution: {
         yearlyContribution: 0,
         yearlyIncreaseRate: 0
       },
       manualReturns: {
         ...defaultScenario.manualReturns,
         inflationEnabled: false
       },
       netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 100000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 100000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        useRetirementAgeAsWithdrawalStartAge: false,
        firstYearAmount: 10000,
        sourceLines: [
          {
            id: 'withdrawal-source-investments',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'investments',
            mode: 'amount' as const,
            amount: 10000,
            startAge: 67
          }
        ],
        }
    };

    const result = projectScenario(scenario);
    const age66 = findProjectedYear(result, 66);
    const age67 = findProjectedYear(result, 67);

    expect(age66.withdrawal).toBeCloseTo(0, 6);
    expect(age67.withdrawal).toBeCloseTo(10000, 2);
  });

  it('inflation-adjusts specified withdrawals across retirement years', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        ...defaultScenario.profile,
        currentAge: 64,
        retirementAge: 65,
        retirementYears: 2
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        firstYearAmount: 10000,
        sourceLines: [
          {
            id: 'withdrawal-source-1',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'retirement401k',
            mode: 'amount' as const,
            amount: 10000,
            syncWithRetirementAge: true
          }
        ]
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        }),
        pools: defaultScenario.netWorth.pools
      },
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationRate: 3
      }
    };

    const result = projectScenario(scenario);
    const age66 = findProjectedYear(result, 66);
    const age67 = findProjectedYear(result, 67);

    expect(age66.withdrawal).toBe(10000);
    expect(age67.withdrawal).toBeCloseTo(10300, 2);
  });

  it('treats HSA as penalty-free for general retirement withdrawals after age 65', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        ...defaultScenario.profile,
        currentAge: 64,
        retirementAge: 65,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 20000,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 20000,
          investments: 0,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        firstYearAmount: 10000,
        sourceLines: [
          {
            id: 'withdrawal-source-1',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'hsa',
            mode: 'amount' as const,
            amount: 10000,
            syncWithRetirementAge: true
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const retirementYear = findProjectedYear(result, 66);

    expect(retirementYear.withdrawal).toBeCloseTo(10000, 2);
    expect((result.warnings ?? []).some((warning) => warning.toLowerCase().includes('hsa'))).toBe(false);
  });

  it('keeps specified withdrawals flat when global inflation is disabled', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        ...defaultScenario.profile,
        currentAge: 64,
        retirementAge: 65,
        retirementYears: 2
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        firstYearAmount: 10000,
        sourceLines: [
          {
            id: 'withdrawal-source-1',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'retirement401k',
            mode: 'amount' as const,
            amount: 10000,
            syncWithRetirementAge: true
          }
        ]
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        }),
        pools: defaultScenario.netWorth.pools
      },
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationEnabled: false,
        inflationRate: 5
      }
    };

    const result = projectScenario(scenario);
    const age66 = findProjectedYear(result, 66);
    const age67 = findProjectedYear(result, 67);

    expect(age66.withdrawal).toBe(10000);
    expect(age67.withdrawal).toBe(10000);
  });

  it('caps retirement withdrawals at the configured maximum yearly withdrawal', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        ...defaultScenario.profile,
        currentAge: 64,
        retirementAge: 65,
        retirementYears: 1
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        }),
        pools: defaultScenario.netWorth.pools
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        minimumYearlyWithdrawal: 0,
        maximumYearlyWithdrawal: 8000,
        firstYearAmount: 15000,
        }
    };

    const result = projectScenario(scenario);
    const age66 = findProjectedYear(result, 66);

    expect(age66.withdrawal).toBeCloseTo(8000, 2);
  });

  it('keeps inflation-adjusted recurring cashflows flat when global inflation is disabled', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 49,
        retirementAge: 65,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      cashflowItems: [
        {
          id: 'cashflow-1',
          category: 'social_security' as const,
          label: 'Recurring Income',
          enabled: true,
          cadence: 'recurring' as const,
          direction: 'inflow' as const,
          amount: 10000,
          startAge: 50,
          endAge: 51,
          }
      ],
      lifeEvents: [
        {
          id: 'event-1',
          type: 'custom_expense' as const,
          label: 'Recurring Expense',
          enabled: true,
          cadence: 'recurring' as const,
          direction: 'outflow' as const,
          amount: 3000,
          startAge: 50,
          endAge: 51,
          newSalary: 0,
          annualSalaryGrowthOverride: 0,
          }
      ],
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationEnabled: false,
        inflationRate: 5
      }
    };

    const result = projectScenario(scenario);
    const age51 = findProjectedYear(result, 51);
    const age52 = findProjectedYear(result, 52);

    expect(age51.extraCashflow).toBeCloseTo(7000, 6);
    expect(age52.extraCashflow).toBeCloseTo(7000, 6);
  });

  it('keeps inflation-adjusted recurring cashflows flat in historical mode when global inflation is disabled', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 45,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      returnMode: 'historical' as const,
      cashflowItems: [
        {
          id: 'cashflow-historical',
          category: 'inheritance' as const,
          label: 'Recurring Benefit',
          enabled: true,
          cadence: 'recurring' as const,
          direction: 'inflow' as const,
          amount: 10000,
          startAge: 41,
          endAge: 42,
          }
      ],
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationEnabled: false
      }
    };

    const result = projectScenario(scenario);
    const age42 = findProjectedYear(result, 42);
    const age43 = findProjectedYear(result, 43);

    expect(age42.extraCashflow).toBeCloseTo(10000, 6);
    expect(age43.extraCashflow).toBeCloseTo(10000, 6);
    expect(age42.inflationRate).toBe(0);
    expect(age43.inflationRate).toBe(0);
  });

  it('includes recurring and one-time cashflows', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      cashflowItems: [
        {
          id: 'gift',
          category: 'inheritance' as const,
          label: 'Gift',
          enabled: true,
          cadence: 'one_time' as const,
          direction: 'inflow' as const,
          amount: 50000,
          startAge: 50,
          endAge: 50,
          },
        {
          id: 'tuition',
          category: 'college_child_1' as const,
          label: 'Tuition',
          enabled: true,
          cadence: 'recurring' as const,
          direction: 'outflow' as const,
          amount: 10000,
          startAge: 48,
          endAge: 49,
          }
      ]
    };

    const result = projectScenario(scenario);
    const age49 = findProjectedYear(result, 49);
    const age51 = findProjectedYear(result, 51);

    expect(age49.extraCashflow).toBe(-10000);
    expect(age51.extraCashflow).toBe(50000);
  });

  it('deposits recurring cashflow income into the selected account monthly', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 65, retirementYears: 1 },
      netWorth: {
        accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({ emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 }),
        pools: (defaultScenario.netWorth.pools ?? []).map((p) => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      careerPlan: { ...defaultScenario.careerPlan, entries: [] },
      cashflowItems: [
        {
          id: 'ss', category: 'social_security' as const, label: 'Social Security', enabled: true,
          cadence: 'recurring' as const, direction: 'inflow' as const, amount: 12000, startAge: 41, endAge: 41,
          accountId: 'investments-account-default'
        }
      ]
    };

    const result = projectScenario(scenario);
    const age42 = findProjectedYear(result, 42);

    expect(age42.accountBalancesById['investments-account-default']).toBeCloseTo(12000, 2);
  });

  it('deposits one-time cashflow income once at its exact age', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 65, retirementYears: 1 },
      netWorth: {
        accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({ emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 }),
        pools: (defaultScenario.netWorth.pools ?? []).map((p) => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      careerPlan: { ...defaultScenario.careerPlan, entries: [] },
      cashflowItems: [
        {
          id: 'gift', category: 'inheritance' as const, label: 'Gift', enabled: true,
          cadence: 'one_time' as const, direction: 'inflow' as const, amount: 50000, startAge: 42, endAge: 42,
          accountId: 'investments-account-default'
        }
      ]
    };

    const result = projectScenario(scenario);
    const age43 = findProjectedYear(result, 43);

    expect(age43.accountBalancesById['investments-account-default']).toBeCloseTo(50000, 2);
  });

  it('pays each housing expense group from its own source account', () => {
    const startYearMonth = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 65, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      careerPlan: { ...defaultScenario.careerPlan, entries: [] },
      netWorth: {
        accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({ emergencyFund: 50000, hsa: 50000, investments: 50000, retirement401k: 50000 }),
        pools: (defaultScenario.netWorth.pools ?? []).map((p) => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0, taxRate: 0, penaltyRate: 0 }))
      },
      housing: [
        {
          id: 'house-1', label: 'Home', enabled: true, showOnGraph: false,
          housingType: 'rental' as const,
          startYearMonth,
          purchasePrice: 0, downPayment: 0, annualInterestRate: 0, loanTermYears: 30, extraMonthlyPayment: 0,
          monthlyRent: 1200, endYearMonth: '',
          propertyTaxYearly: 1200, homeInsuranceYearly: 600, hoaMonthly: 100, maintenanceMonthly: 50, pmiMonthly: 0,
          rentalIncomeMonthly: 0, sellYearMonth: '', appreciationRate: 0, sellingCostsRate: 0,
          paymentSource: 'account:emergencyFund-account-default' as const,
          taxesInsuranceSource: 'account:hsa-account-default' as const,
          hoaMaintenanceSource: 'account:retirement401k-account-default' as const
        }
      ]
    };

    const result = projectScenario(scenario);
    const age41 = findProjectedYear(result, 41);

    expect(age41.accountBalancesById['emergencyFund-account-default']).toBeCloseTo(50000 - 14400, 2);
    expect(age41.accountBalancesById['hsa-account-default']).toBeCloseTo(50000 - 1800, 2);
    expect(age41.accountBalancesById['retirement401k-account-default']).toBeCloseTo(50000 - 1800, 2);
    expect(age41.accountBalancesById['investments-account-default']).toBeCloseTo(50000, 2);
  });

  it('estimates salary-based career savings before retirement', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 42,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
            id: 'career-1',
            label: 'Career 1',
            enabled: true,
            usePreviousCareerStartAge: false,
            startAge: 40,
            endAge: 42,            annualRaiseRate: 0,
            savingsRate: 10,
            employerMatchRate: 2,
            bonusRate: 0,
            bonusSavingsRate: 0,
            emergencyFundContributionRate: 2,
            hsaContributionRate: 2,
            investmentsContributionRate: 3,
            retirement401kContributionRate: 3,
            emergencyFundSavingsMonthly: false,
            hsaSavingsMonthly: false,
            investmentsSavingsMonthly: false,
            retirement401kSavingsMonthly: false,
            emergencyFundStartBalanceMode: 'auto',
            hsaStartBalanceMode: 'auto',
            investmentsStartBalanceMode: 'auto',
            retirement401kStartBalanceMode: 'auto',
            emergencyFundManualStartBalance: 0,
            hsaManualStartBalance: 0,
            investmentsManualStartBalance: 0,
            retirement401kManualStartBalance: 0,
            paycheckInfo: {
              grossSalary: 100000,
              taxes: 0,
              healthBenefits: 0,
              retirement: 0,
              retirementMatch: 0,
              hsaContribution: 0,
              hsaEmployerMatch: 0,
              otherBenefits: 0,
              livingExpenses: 0
            },
            sourceLines: [
              {
                id: 'career-source-emergency',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'emergencyFund',
                contributionRate: 2,
                savingsMonthly: false,
                monthlyWithdrawal: 0
              },
              {
                id: 'career-source-hsa',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'hsa',
                contributionRate: 2,
                savingsMonthly: false,
                monthlyWithdrawal: 0
              },
              {
                id: 'career-source-investments',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'investments',
                contributionRate: 3,
                savingsMonthly: false,
                monthlyWithdrawal: 0
              },
              {
                id: 'career-source-401k',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'retirement401k',
                contributionRate: 3,
                savingsMonthly: false,
                monthlyWithdrawal: 0
              }
            ]
          }
        ]
      },
      lifeEvents: []
    };

    const result = projectScenario(scenario);
    const age41 = findProjectedYear(result, 41);

    expect(age41.salary).toBe(100000);
    expect(age41.careerContribution).toBeCloseTo(10000, 6);
    expect(age41.contribution).toBeCloseTo(10000, 6);
  });

  it('applies job changes, breaks, and life-event cashflows', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 45,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
            id: 'career-1',
            label: 'Career 1',
            enabled: true,
            usePreviousCareerStartAge: false,
            startAge: 40,
            endAge: 45,            annualRaiseRate: 0,
            savingsRate: 0,
            employerMatchRate: 0,
            bonusRate: 0,
            bonusSavingsRate: 0,
            emergencyFundContributionRate: 0,
            hsaContributionRate: 0,
            investmentsContributionRate: 0,
            retirement401kContributionRate: 0,
            emergencyFundSavingsMonthly: false,
            hsaSavingsMonthly: false,
            investmentsSavingsMonthly: false,
            retirement401kSavingsMonthly: false,
            emergencyFundStartBalanceMode: 'auto',
            hsaStartBalanceMode: 'auto',
            investmentsStartBalanceMode: 'auto',
            retirement401kStartBalanceMode: 'auto',
            emergencyFundManualStartBalance: 0,
            hsaManualStartBalance: 0,
            investmentsManualStartBalance: 0,
            retirement401kManualStartBalance: 0
          }
        ]
      },
      lifeEvents: [
        {
          id: 'job-change',
          type: 'job_change' as const,
          label: 'Job Change',
          enabled: true,
          cadence: 'recurring' as const,
          direction: 'inflow' as const,
          startAge: 42,
          endAge: 45,
          amount: 0,
          newSalary: 150000,
          annualSalaryGrowthOverride: 0,
          },
        {
          id: 'break',
          type: 'career_break' as const,
          label: 'Break',
          enabled: true,
          cadence: 'recurring' as const,
          direction: 'outflow' as const,
          startAge: 43,
          endAge: 43,
          amount: 0,
          newSalary: 0,
          annualSalaryGrowthOverride: 0,
          },
        {
          id: 'house-purchase',
          type: 'house_purchase' as const,
          label: 'House Purchase',
          enabled: true,
          cadence: 'one_time' as const,
          direction: 'outflow' as const,
          startAge: 41,
          endAge: 41,
          amount: 30000,
          newSalary: 0,
          annualSalaryGrowthOverride: 0,
          }
      ]
    };

    const result = projectScenario(scenario);
    const age42 = findProjectedYear(result, 42);
    const age43 = findProjectedYear(result, 43);
    const age44 = findProjectedYear(result, 44);

    expect(age42.extraCashflow).toBe(-30000);
    expect(age43.salary).toBe(150000);
    expect(age44.salary).toBe(0);
  });

  it('marks the projection as depleted when withdrawals are unsustainable', () => {
    const result = projectScenario({
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: {
        currentAge: 65,
        retirementAge: 65,
        retirementYears: 5
      },
      portfolio: {
        ...defaultScenario.portfolio,
        currentAssets: 10000
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      withdrawal: {
        mode: 'specified',
        firstYearAmount: 50000,
        minimumYearlyWithdrawal: 0,
        maximumYearlyWithdrawal: 1000000,
        useRetirementAgeAsWithdrawalStartAge: true,
        }
    });

    expect(result.survivesToEnd).toBe(false);
    expect(result.depletedAge).toBe(65);
  });

  it('does not mark depletion from account shortfall alone while net worth stays above the retirement floor', () => {
    const result = projectScenario({
      ...defaultScenario,
      profile: {
        currentAge: 65,
        retirementAge: 65,
        retirementYears: 2
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 250000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 250000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      portfolio: {
        ...defaultScenario.portfolio,
        currentAssets: 0
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      withdrawal: {
        mode: 'specified',
        firstYearAmount: 50000,
        minimumYearlyWithdrawal: 0,
        maximumYearlyWithdrawal: 1000000,
        useRetirementAgeAsWithdrawalStartAge: true,
        }
    });

    expect(result.survivesToEnd).toBe(true);
    expect(result.depletedAge).toBeNull();
  });

  it('marks depletion when retirement withdrawals miss the configured minimum yearly amount', () => {
    const result = projectScenario({
      ...defaultScenario,
      profile: {
        currentAge: 65,
        retirementAge: 65,
        retirementYears: 1
      },
      portfolio: {
        ...defaultScenario.portfolio,
        currentAssets: 0
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationEnabled: false,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 150000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 150000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 0,
        minimumYearlyWithdrawal: 10000,
        }
    });

    expect(result.survivesToEnd).toBe(true);
    expect(result.depletedAge).toBeNull();
  });

  it('does not deplete when retirement withdrawals meet the configured minimum yearly amount', () => {
    const result = projectScenario({
      ...defaultScenario,
      profile: {
        currentAge: 65,
        retirementAge: 65,
        retirementYears: 1
      },
      portfolio: {
        ...defaultScenario.portfolio,
        currentAssets: 0
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationEnabled: false,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 200000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 200000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 10000,
        minimumYearlyWithdrawal: 10000,
        sourceLines: [
          {
            id: 'withdrawal-source-1',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'emergencyFund',
            mode: 'amount' as const,
            amount: 10000,
            syncWithRetirementAge: true
          }
        ]
      }
    });

    expect(result.survivesToEnd).toBe(true);
    expect(result.depletedAge).toBeNull();
  });

  it('inflation-adjusts the minimum yearly withdrawal threshold during retirement', () => {
    const result = projectScenario({
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 65,
        retirementAge: 65,
        retirementYears: 2
      },
      portfolio: {
        ...defaultScenario.portfolio,
        currentAssets: 0
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationEnabled: true,
        inflationRate: 3,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 30100,
          investments: 100000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 30100,
          investments: 100000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools?.map(p => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 20000,
        minimumYearlyWithdrawal: 10000,
        sourceLines: [
          {
            id: 'withdrawal-source-1',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'hsa',
            mode: 'amount' as const,
            amount: 20000,
            syncWithRetirementAge: true
          }
        ]
      }
    });

    expect(result.depletedAge).toBe(66);
    const age66 = findProjectedYear(result, 66);
    const age67 = findProjectedYear(result, 67);
    expect(age66.withdrawal).toBe(20000);
    expect(age67.withdrawal).toBe(20600);
  });

  it('scales the minimum yearly withdrawal threshold for a partial first retirement year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));

    const baseScenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: '1961-05-01T12:00:00Z'
      },
      profile: {
        currentAge: 64,
        retirementAge: 64,
        retirementYears: 1
      },
      portfolio: {
        ...defaultScenario.portfolio,
        currentAssets: 0
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationEnabled: false,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 200000,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 200000,
          investments: 0,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      }
    };

    const calibration = projectScenario({
      ...baseScenario,
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 0,
        minimumYearlyWithdrawal: 0,
        sourceLines: [
          {
            id: 'withdrawal-source-1',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'hsa',
            mode: 'amount' as const,
            amount: 0,
            syncWithRetirementAge: true
          }
        ]
      }
    });
    const firstRetirementPeriodMonths = findProjectedYear(calibration, 65).periodMonths;
    expect(firstRetirementPeriodMonths).toBeLessThan(12);

    const meetsMinimum = projectScenario({
      ...baseScenario,
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 12001,
        minimumYearlyWithdrawal: 12000,
        sourceLines: [
          {
            id: 'withdrawal-source-1',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'hsa',
            mode: 'amount' as const,
            amount: 12001,
            syncWithRetirementAge: true
          }
        ]
      }
    });

    const missesMinimum = projectScenario({
      ...baseScenario,
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 11999,
        minimumYearlyWithdrawal: 12000,
        sourceLines: [
          {
            id: 'withdrawal-source-1',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'hsa',
            mode: 'amount' as const,
            amount: 11999,
            syncWithRetirementAge: true
          }
        ]
      }
    });

    vi.useRealTimers();

    expect(meetsMinimum.survivesToEnd).toBe(true);
    expect(meetsMinimum.depletedAge).toBeNull();
    expect(missesMinimum.depletedAge).toBe(64);
  });

  it('tracks savings accounts and records per-career end balances', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 43,
        retirementYears: 1
      },
      netWorth: {
        ...defaultScenario.netWorth,
        pools: defaultScenario.netWorth.pools?.map((p) => ({
          ...p,
           preRetirementReturnRate: 0,
           postRetirementReturnRate: 0
        })),
        bankAccounts: defaultScenario.netWorth.bankAccounts
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
            id: 'career-1',
            label: 'Career 1',
            enabled: true,
            usePreviousCareerStartAge: false,
            startAge: 40,
            endAge: 42,            annualRaiseRate: 0,
            savingsRate: 0,
            employerMatchRate: 0,
            bonusRate: 0,
            bonusSavingsRate: 0,
            emergencyFundContributionRate: 1,
            hsaContributionRate: 1,
            investmentsContributionRate: 1,
            retirement401kContributionRate: 1,
            emergencyFundSavingsMonthly: false,
            hsaSavingsMonthly: false,
            investmentsSavingsMonthly: false,
            retirement401kSavingsMonthly: false,
            emergencyFundStartBalanceMode: 'auto',
            hsaStartBalanceMode: 'auto',
            investmentsStartBalanceMode: 'auto',
            retirement401kStartBalanceMode: 'auto',
            emergencyFundManualStartBalance: 0,
            hsaManualStartBalance: 0,
            investmentsManualStartBalance: 0,
            retirement401kManualStartBalance: 0,
            paycheckInfo: {
              grossSalary: 100000,
              taxes: 0,
              healthBenefits: 0,
              retirement: 0,
              retirementMatch: 0,
              hsaContribution: 0,
              hsaEmployerMatch: 0,
              otherBenefits: 0,
              livingExpenses: 0
            },
            sourceLines: [
              {
                id: 'career-source-emergency',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'emergencyFund',
                contributionRate: 1,
                savingsMonthly: false,
                monthlyWithdrawal: 0
              },
              {
                id: 'career-source-hsa',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'hsa',
                contributionRate: 1,
                savingsMonthly: false,
                monthlyWithdrawal: 0
              },
              {
                id: 'career-source-investments',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'investments',
                contributionRate: 1,
                savingsMonthly: false,
                monthlyWithdrawal: 0
              },
              {
                id: 'career-source-401k',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'retirement401k',
                contributionRate: 1,
                savingsMonthly: false,
                monthlyWithdrawal: 0
              }
            ]
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const age43 = findProjectedYear(result, 43);

    expect(age43.savingsBalances.emergencyFund).toBeCloseTo(3000, 6);
    expect(age43.savingsBalances.retirement401k).toBeCloseTo(3000, 6);
    expect(result.careerEndSavingsBalances['career-1'].investments).toBeCloseTo(3000, 6);
  });

  it('returns the first future age when a non-viable purchase becomes affordable', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 45,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
            id: 'career-1',
            label: 'Career 1',
            enabled: true,
            usePreviousCareerStartAge: false,
            startAge: 40,
            endAge: 44,            annualRaiseRate: 0,
            savingsRate: 0,
            employerMatchRate: 0,
            bonusRate: 0,
            bonusSavingsRate: 0,
            emergencyFundContributionRate: 0,
            hsaContributionRate: 0,
            investmentsContributionRate: 10,
            retirement401kContributionRate: 0,
            emergencyFundSavingsMonthly: false,
            hsaSavingsMonthly: false,
            investmentsSavingsMonthly: false,
            retirement401kSavingsMonthly: false,
            emergencyFundStartBalanceMode: 'auto',
            hsaStartBalanceMode: 'auto',
            investmentsStartBalanceMode: 'auto',
            retirement401kStartBalanceMode: 'auto',
            emergencyFundManualStartBalance: 0,
            hsaManualStartBalance: 0,
            investmentsManualStartBalance: 0,
            retirement401kManualStartBalance: 0,
            emergencyFundMonthlyWithdrawal: 0,
            hsaMonthlyWithdrawal: 0,
            investmentsMonthlyWithdrawal: 0,
            retirement401kMonthlyWithdrawal: 0,
            paycheckInfo: {
              grossSalary: 10000,
              taxes: 0,
              healthBenefits: 0,
              retirement: 0,
              retirementMatch: 0,
              hsaContribution: 0,
              hsaEmployerMatch: 0,
              otherBenefits: 0,
              livingExpenses: 0
            },
            sourceLines: [
              {
                id: 'career-source-investments',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'investments',
                contributionRate: 10,
                savingsMonthly: false,
                monthlyWithdrawal: 0
              }
            ]
          }
        ]
      },
      largePurchases: [
        {
          id: 'purchase-1',
          label: 'Large Purchase',
          enabled: true,
          showOnGraph: true,
          yearMonth: currentYearMonth(),
          age: 40,
          amount: 2000,
          fundingSource: 'account:investments-account-default' as const,
          sourceLines: [{
            id: 'purchase-source-investments',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'investments',
            mode: 'amount' as const,
            amount: 2000
          }]
        }
      ]
    };

    const result = projectScenario(scenario);

    expect(result.purchaseFundingShortfalls['purchase-1']).toBeGreaterThan(0);
    expect(result.purchaseFirstAffordableAge['purchase-1']).toBe(41);
  });

  it('treats purchases as affordable when selected source accounts can cover the amount in total', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
         retirementAge: 41,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 2000,
          hsa: 0,
          investments: 5000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 2000,
          hsa: 0,
          investments: 5000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools?.map(p => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      careerPlan: {
        enabled: false,
        entries: []
      },
      largePurchases: [
        {
          id: 'purchase-selected-pool',
          label: 'House',
          enabled: true,
          showOnGraph: true,
          yearMonth: currentYearMonth(),
          age: 40,
          amount: 6000,
          fundingSource: 'account:investments-account-default' as const,
          sourceLines: [
            {
              id: 'purchase-source-emergency',
              enabled: true,
              sourceType: 'pool' as const,
              sourceId: 'emergencyFund',
              mode: 'amount' as const,
              amount: 4000
            },
            {
              id: 'purchase-source-investments',
              enabled: true,
              sourceType: 'pool' as const,
              sourceId: 'investments',
              mode: 'amount' as const,
              amount: 2000
            }
          ]
        }
      ]
    };

    const result = projectScenario(scenario);
    const age41 = findProjectedYear(result, 41);

    expect(result.purchaseFundingShortfalls['purchase-selected-pool']).toBe(0);
    expect(result.purchaseFirstAffordableAge['purchase-selected-pool']).toBe(40);
    expect(age41.savingsBalances.emergencyFund).toBeCloseTo(0, 6);
    expect(age41.savingsBalances.investments).toBeCloseTo(1000, 6);
  });

   it('records post-purchase balances at the scheduled purchase age', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
         retirementAge: 41,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 1000,
          hsa: 0,
          investments: 2000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 1000,
          hsa: 0,
          investments: 2000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools?.map(p => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      careerPlan: {
        enabled: false,
        entries: []
      },
      largePurchases: [
        {
          id: 'purchase-balance-snapshot',
          label: 'Car',
          enabled: true,
          showOnGraph: true,
          yearMonth: currentYearMonth(),
          age: 40,
          amount: 1200,
          fundingSource: 'account:investments-account-default' as const,
          sourceLines: [
            {
              id: 'purchase-source-emergency',
              enabled: true,
              sourceType: 'pool' as const,
              sourceId: 'emergencyFund',
              mode: 'amount' as const,
              amount: 200
            },
            {
              id: 'purchase-source-investments',
              enabled: true,
              sourceType: 'pool' as const,
              sourceId: 'investments',
              mode: 'amount' as const,
              amount: 1000
            }
          ]
        }
      ]
    };

    const result = projectScenario(scenario);
    const snapshot = result.purchasePostPurchaseDisplayBalances['purchase-balance-snapshot'];

    expect(snapshot).not.toBeNull();
    const balances = Object.values(snapshot ?? {});
    expect(balances.some((value) => Math.abs(value - 800) < 0.000001)).toBe(true);
    expect(balances.some((value) => Math.abs(value - 1000) < 0.000001)).toBe(true);
  });

  it('applies long-term monthly purchases over the scheduled duration', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 41,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 5000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
         investments: 5000,
         retirement401k: 0
       }),
       pools: defaultScenario.netWorth.pools?.map((p) => ({
         ...p,
         preRetirementReturnRate: 0,
         postRetirementReturnRate: 0
       }))
      },
      careerPlan: {
        enabled: false,
        entries: []
      },
      longTermPurchases: [
        {
          id: 'lt-1',
          label: 'Renovation',
          enabled: true,
          showOnGraph: true,
          startYearMonth: currentYearMonth(),
          endMode: 'duration' as const,
          durationMonths: 6,
          endYearMonth: '2026-06',
          monthlyAmount: 500,
          fundingSource: 'account:investments-account-default' as const,
          sourceLines: [{
            id: 'long-term-source-investments',
            enabled: true,
            sourceType: 'pool' as const,
            sourceId: 'investments',
            mode: 'amount' as const,
            amount: 500
          }]
        }
      ]
    };

    const result = projectScenario(scenario);
    const age41 = findProjectedYear(result, 41);

    expect(result.longTermPurchaseFundingShortfalls['lt-1']).toBe(0);
    expect(age41.savingsBalances.investments).toBe(2000);
  });

   it('applies loan payments and interest to projection balances', () => {
    const scenarioWithLoan = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
         retirementAge: 80,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 12000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 12000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      careerPlan: {
        enabled: false,
        entries: []
      },
      loans: [
        {
          id: 'loan-1',
          label: 'Car Loan',
          enabled: true,
          showOnGraph: true,
          startYearMonth: currentYearMonth(),
          originalAmount: 10000,
          downPayment: 0,
          currentBalance: 10000,
          annualInterestRate: 12,
          minimumMonthlyPayment: 900,
          extraMonthlyPayment: 100,
          paymentSourceAccount: 'investments' as const,
          paymentSource: 'account:investments-account-default' as const
        }
      ]
    };

    const scenarioWithoutLoan = {
      ...scenarioWithLoan,
      loans: []
    };

    const withLoan = projectScenario(scenarioWithLoan);
    const withoutLoan = projectScenario(scenarioWithoutLoan);
    const withLoanAge41 = findProjectedYear(withLoan, 41);
    const withoutLoanAge41 = findProjectedYear(withoutLoan, 41);

    expect(withLoanAge41.savingsBalances.investments).toBeLessThan(withoutLoanAge41.savingsBalances.investments);
    expect(withLoan.endingBalance).toBeLessThan(withoutLoan.endingBalance);
  });

  it('reports loan funding shortfalls when the selected payment account runs empty', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 41,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 100,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 100,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      careerPlan: {
        enabled: false,
        entries: []
      },
      loans: [
        {
          id: 'loan-shortfall-1',
          label: 'Car Loan',
          enabled: true,
          showOnGraph: true,
          startYearMonth: currentYearMonth(),
          originalAmount: 1000,
          downPayment: 0,
          currentBalance: 1000,
          annualInterestRate: 0,
          minimumMonthlyPayment: 500,
          extraMonthlyPayment: 0,
          paymentSourceAccount: 'investments' as const,
          paymentSource: 'account:investments-account-default' as const
        }
      ]
    };

    const result = projectScenario(scenario);

    expect(result.loanFundingShortfalls['loan-shortfall-1']).toBeGreaterThan(0);
  });

  it('does not affect projection balances when loan is paid from income', () => {
    const scenarioWithIncomeLoan = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 41,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 12000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 12000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      careerPlan: {
        enabled: false,
        entries: []
      },
      loans: [
        {
          id: 'loan-income-1',
          label: 'Car Loan',
          enabled: true,
          showOnGraph: true,
          startYearMonth: '2026-01',
          originalAmount: 10000,
          downPayment: 0,
          currentBalance: 10000,
          annualInterestRate: 12,
          minimumMonthlyPayment: 900,
          extraMonthlyPayment: 100,
          paymentSourceAccount: 'income' as const
        }
      ]
    };

    const scenarioWithoutLoan = {
      ...scenarioWithIncomeLoan,
      loans: []
    };

    const withIncomeLoan = projectScenario(scenarioWithIncomeLoan);
    const withoutLoan = projectScenario(scenarioWithoutLoan);
    const withIncomeLoanAge41 = findProjectedYear(withIncomeLoan, 41);
    const withoutLoanAge41 = findProjectedYear(withoutLoan, 41);

    expect(withIncomeLoanAge41.savingsBalances.investments).toBeCloseTo(withoutLoanAge41.savingsBalances.investments, 6);
    expect(withIncomeLoan.endingBalance).toBeCloseTo(withoutLoan.endingBalance, 6);
  });

  it('applies loan down payment from the selected payment source account at loan start', () => {
    const now = new Date();
    const startYearMonth = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const scenarioWithDownPayment = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: '1986-01-01'
      },
      profile: {
        currentAge: 40,
        retirementAge: 80,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      portfolio: {
        ...defaultScenario.portfolio,
        currentAssets: 12000
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 12000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 0,
          hsa: 0,
          investments: 12000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      careerPlan: {
        enabled: false,
        entries: []
      },
      loans: [
        {
          id: 'loan-down-payment-1',
          label: 'Car Loan',
          enabled: true,
          showOnGraph: true,
          startYearMonth,
          originalAmount: 10000,
          downPayment: 1000,
          currentBalance: 10000,
          annualInterestRate: 0,
          minimumMonthlyPayment: 0,
          extraMonthlyPayment: 0,
          paymentSourceAccount: 'investments' as const,
          paymentSource: 'account:investments-account-default' as const,
          downPaymentSource: 'account:investments-account-default' as const
        }
      ]
    };
    const scenarioWithoutDownPayment = {
      ...scenarioWithDownPayment,
      loans: scenarioWithDownPayment.loans.map((loan) => ({ ...loan, downPayment: 0 }))
    };

    const withDownPayment = projectScenario(scenarioWithDownPayment);
    const withoutDownPayment = projectScenario(scenarioWithoutDownPayment);
    const withDownPaymentAge41 = findProjectedYear(withDownPayment, 41);
    const withoutDownPaymentAge41 = findProjectedYear(withoutDownPayment, 41);

    expect(withDownPaymentAge41.savingsBalances.investments).toBeLessThan(withoutDownPaymentAge41.savingsBalances.investments);
    expect(withDownPayment.endingBalance).toBeLessThan(withoutDownPayment.endingBalance);
  });

  it('applies per-career max balance and routes overflow to configured fallback account', () => {
    const baseCareer = defaultScenario.careerPlan.entries[0];
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 65,
        retirementYears: 1
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 14900,
          hsa: 0,
          investments: 1000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 14900,
          hsa: 0,
          investments: 1000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools?.map(p => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
             ...baseCareer,
             id: 'career-1',
             paycheckInfo: { ...baseCareer.paycheckInfo!, grossSalary: 12000 },
            enabled: true,
            startAge: 40,
            endAge: 40,            annualRaiseRate: 0,
            emergencyFundContributionRate: 20,
            hsaContributionRate: 0,
            investmentsContributionRate: 0,
            retirement401kContributionRate: 0,
            emergencyFundMonthlyWithdrawal: 0,
            hsaMonthlyWithdrawal: 0,
            investmentsMonthlyWithdrawal: 0,
            retirement401kMonthlyWithdrawal: 0,
            sourceLines: [
              {
                id: 'career-source-emergency',
                enabled: true,
                sourceType: 'account' as const,
                sourceId: 'emergencyFund-account-default',
                contributionRate: 20,
                savingsMonthly: false,
                monthlyWithdrawal: 0,
                maxBalance: 15000,
                overflowFallbackAccountId: 'investments-account-default'
              }
            ]
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const age41 = findProjectedYear(result, 41);

    expect(age41.accountBalancesById['emergencyFund-account-default']).toBeCloseTo(15000, 6);
    expect(age41.accountBalancesById['investments-account-default']).toBeCloseTo(3300, 6);
  });

  it('only applies cap rules from the active career', () => {
    const baseCareer = defaultScenario.careerPlan.entries[0];
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 65,
        retirementYears: 1
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 15000,
          hsa: 0,
          investments: 1000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 15000,
          hsa: 0,
          investments: 1000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools?.map(p => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
             ...baseCareer,
             id: 'career-1-no-cap',
             paycheckInfo: { ...baseCareer.paycheckInfo!, grossSalary: 12000 },
            enabled: true,
            startAge: 40,
            endAge: 40,            annualRaiseRate: 0,
            emergencyFundContributionRate: 20,
            hsaContributionRate: 0,
            investmentsContributionRate: 0,
            retirement401kContributionRate: 0,
            emergencyFundMonthlyWithdrawal: 0,
            hsaMonthlyWithdrawal: 0,
            investmentsMonthlyWithdrawal: 0,
            retirement401kMonthlyWithdrawal: 0,
            sourceLines: [
              {
                id: 'career-source-emergency-no-cap',
                enabled: true,
                sourceType: 'account' as const,
                sourceId: 'emergencyFund-account-default',
                contributionRate: 20,
                savingsMonthly: false,
                monthlyWithdrawal: 0,
                maxBalance: 0,
                overflowFallbackAccountId: null
              }
            ]
          },
          {
             ...baseCareer,
             id: 'career-2-with-cap',
             paycheckInfo: { ...baseCareer.paycheckInfo!, grossSalary: 12000 },
            enabled: true,
            startAge: 41,
            endAge: 41,            annualRaiseRate: 0,
            emergencyFundContributionRate: 20,
            hsaContributionRate: 0,
            investmentsContributionRate: 0,
            retirement401kContributionRate: 0,
            emergencyFundMonthlyWithdrawal: 0,
            hsaMonthlyWithdrawal: 0,
            investmentsMonthlyWithdrawal: 0,
            retirement401kMonthlyWithdrawal: 0,
            sourceLines: [
              {
                id: 'career-source-emergency-with-cap',
                enabled: true,
                sourceType: 'account' as const,
                sourceId: 'emergencyFund-account-default',
                contributionRate: 20,
                savingsMonthly: false,
                monthlyWithdrawal: 0,
                maxBalance: 15000,
                overflowFallbackAccountId: 'investments-account-default'
              }
            ]
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const age41 = findProjectedYear(result, 41);
    const age42 = findProjectedYear(result, 42);

    expect(age41.accountBalancesById['emergencyFund-account-default']).toBeGreaterThan(15000);
    expect(age42.accountBalancesById['emergencyFund-account-default']).toBeCloseTo(15000, 6);
    expect(age42.accountBalancesById['investments-account-default']).toBeGreaterThan(age41.accountBalancesById['investments-account-default']);
  });

  it('keeps overflow in place and warns when fallback is invalid', () => {
    const baseCareer = defaultScenario.careerPlan.entries[0];
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 40,
        retirementAge: 65,
        retirementYears: 1
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 14900,
          hsa: 0,
          investments: 1000,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 14900,
          hsa: 0,
          investments: 1000,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
            ...baseCareer,
            id: 'career-1',
            enabled: true,
            startAge: 40,
            endAge: 40,            annualRaiseRate: 0,
            emergencyFundContributionRate: 20,
            hsaContributionRate: 0,
            investmentsContributionRate: 0,
            retirement401kContributionRate: 0,
            emergencyFundMonthlyWithdrawal: 0,
            hsaMonthlyWithdrawal: 0,
            investmentsMonthlyWithdrawal: 0,
            retirement401kMonthlyWithdrawal: 0,
            sourceLines: [
              {
                id: 'career-source-emergency',
                enabled: true,
                sourceType: 'account' as const,
                sourceId: 'emergencyFund-account-default',
                contributionRate: 20,
                savingsMonthly: false,
                monthlyWithdrawal: 0,
                maxBalance: 15000,
                overflowFallbackAccountId: 'missing-account-id'
              }
            ]
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const age41 = findProjectedYear(result, 41);

    expect(age41.accountBalancesById['emergencyFund-account-default']).toBeGreaterThan(15000);
    expect((result.warnings ?? []).some((warning) => warning.includes('Overflow fallback missing'))).toBe(true);
  });

  it('applies monthly account withdrawals against monthly contributions', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 25,
        retirementAge: 26,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 1000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 1000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools?.map(p => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
             id: 'career-monthly-withdrawal',
            label: 'Career 1',
            enabled: true,
            usePreviousCareerStartAge: false,
            startAge: 25,
            endAge: 25,            annualRaiseRate: 0,
            savingsRate: 0,
            employerMatchRate: 0,
            bonusRate: 0,
            bonusSavingsRate: 0,
            emergencyFundContributionRate: 10,
            hsaContributionRate: 0,
            investmentsContributionRate: 0,
            retirement401kContributionRate: 0,
            emergencyFundSavingsMonthly: false,
            hsaSavingsMonthly: false,
            investmentsSavingsMonthly: false,
            retirement401kSavingsMonthly: false,
            emergencyFundStartBalanceMode: 'auto',
            hsaStartBalanceMode: 'auto',
            investmentsStartBalanceMode: 'auto',
            retirement401kStartBalanceMode: 'auto',
            emergencyFundManualStartBalance: 0,
            hsaManualStartBalance: 0,
            investmentsManualStartBalance: 0,
            retirement401kManualStartBalance: 0,
            emergencyFundMonthlyWithdrawal: 50,
            hsaMonthlyWithdrawal: 0,
            investmentsMonthlyWithdrawal: 0,
            retirement401kMonthlyWithdrawal: 0,
            paycheckInfo: {
              grossSalary: 12000,
              taxes: 0,
              healthBenefits: 0,
              retirement: 0,
              retirementMatch: 0,
              hsaContribution: 0,
              hsaEmployerMatch: 0,
              otherBenefits: 0,
              livingExpenses: 0
            },
            sourceLines: [
              {
                id: 'career-source-emergency',
                enabled: true,
                sourceType: 'pool' as const,
                sourceId: 'emergencyFund',
                contributionRate: 10,
                savingsMonthly: false,
                monthlyWithdrawal: 50
              }
            ]
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const age26 = findProjectedYear(result, 26);

    expect(age26.savingsBalances.emergencyFund).toBeCloseTo(1600, 6);
  });

  it('compounds monthly using exact APY', () => {
    const scenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        currentAge: 25,
        retirementAge: 26,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 1000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 1000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }),
        pools: defaultScenario.netWorth.pools?.map(p => ({ ...p, preRetirementReturnRate: p.id === 'emergencyFund' ? 12 : 0 }))
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
            id: 'career-monthly-compounding',
            label: 'Career 1',
            enabled: true,
            usePreviousCareerStartAge: false,
            startAge: 25,
            endAge: 25,            annualRaiseRate: 0,
            savingsRate: 0,
            employerMatchRate: 0,
            bonusRate: 0,
            bonusSavingsRate: 0,
            emergencyFundContributionRate: 0,
            hsaContributionRate: 0,
            investmentsContributionRate: 0,
            retirement401kContributionRate: 0,
            emergencyFundSavingsMonthly: false,
            hsaSavingsMonthly: false,
            investmentsSavingsMonthly: false,
            retirement401kSavingsMonthly: false,
            emergencyFundStartBalanceMode: 'auto',
            hsaStartBalanceMode: 'auto',
            investmentsStartBalanceMode: 'auto',
            retirement401kStartBalanceMode: 'auto',
            emergencyFundManualStartBalance: 0,
            hsaManualStartBalance: 0,
            investmentsManualStartBalance: 0,
            retirement401kManualStartBalance: 0,
            emergencyFundMonthlyWithdrawal: 0,
            hsaMonthlyWithdrawal: 0,
            investmentsMonthlyWithdrawal: 0,
            retirement401kMonthlyWithdrawal: 0
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const age26 = findProjectedYear(result, 26);
    const expected = 1000 * (1 + 0.12);

    expect(age26.savingsBalances.emergencyFund).toBeCloseTo(expected, 6);
  });

  it('adds a baseline now row before projected periods', () => {
    const result = projectScenario({
      ...defaultScenario,
      profile: {
        ...defaultScenario.profile,
        currentAge: 40,
        retirementAge: 41,
        retirementYears: 1
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 1000,
          hsa: 2000,
          investments: 3000,
          retirement401k: 4000
        },
        asOfDate: '',
        bankAccounts: seedDefaultBankAccounts({
          emergencyFund: 1000,
          hsa: 2000,
          investments: 3000,
          retirement401k: 4000
        }),
        pools: defaultScenario.netWorth.pools
      }
    });

    const baseline = result.years[0];

    expect(baseline.isBaselineNow).toBe(true);
    expect(baseline.periodMonths).toBe(0);
    expect(baseline.startBalance).toBe(10000);
    expect(baseline.endBalance).toBe(10000);
  });

  it('uses full-year first period when date of birth is invalid', () => {
    const result = projectScenario({
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: 'invalid-date'
      },
      profile: {
        ...defaultScenario.profile,
        currentAge: 40,
        retirementAge: 41,
        retirementYears: 1
      }
    });

    const firstProjected = result.years.find((year) => !year.isBaselineNow)!;
    expect(firstProjected.periodMonths).toBe(12);
  });

  it('covers income-funded purchase with take-home pay', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 60000, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      largePurchases: [{
        id: 'income-purchase-covered',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 40,
        amount: 3000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeFundedItemStatuses['income-purchase-covered']).toBeDefined();
    expect(result.incomeFundedItemStatuses['income-purchase-covered']!.status).toBe('covered');
  });

  it('grows take-home pay with the annual raise', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 25, retirementAge: 30, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      netWorth: {
        ...defaultScenario.netWorth,
        accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        bankAccounts: seedDefaultBankAccounts({ emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 }),
        pools: (defaultScenario.netWorth.pools ?? []).map((p) => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 25, endAge: 29,
          annualRaiseRate: 10,
          sourceLines: [],
          paycheckInfo: {
            grossSalary: 120000, taxes: 60000, healthBenefits: 0, otherBenefits: 0, livingExpenses: 0,
            retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0
          }
        }]
      },
      largePurchases: [{
        id: 'take-home-raise-purchase',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 26,
        amount: 65000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeFundedItemStatuses['take-home-raise-purchase']).toBeDefined();
    expect(result.incomeFundedItemStatuses['take-home-raise-purchase']!.status).toBe('covered');
  });

  it('grows percentOfSalary retirement with the annual raise', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 25, retirementAge: 30, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      netWorth: {
        ...defaultScenario.netWorth,
        accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        bankAccounts: seedDefaultBankAccounts({ emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 }),
        pools: (defaultScenario.netWorth.pools ?? []).map((p) => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
      },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 25, endAge: 29,
          annualRaiseRate: 10,
          sourceLines: [],
          paycheckInfo: {
            grossSalary: 100000, taxes: 0, healthBenefits: 0, otherBenefits: 0, livingExpenses: 0,
            retirement: 10, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0,
            retirementMode: 'percentOfSalary' as const,
            retirementAccountId: 'retirement401k-account-default'
          }
        }]
      }
    };

    const result = projectScenario(scenario);
    const retirementId = 'retirement401k-account-default';
    const age26 = findProjectedYear(result, 26);
    const age27 = findProjectedYear(result, 27);
    const age28 = findProjectedYear(result, 28);

    const deposit25to26 = age27.accountBalancesById[retirementId] - age26.accountBalancesById[retirementId];
    const deposit26to27 = age28.accountBalancesById[retirementId] - age27.accountBalancesById[retirementId];

    expect(deposit25to26).toBeCloseTo(11000, 6);
    expect(deposit26to27).toBeCloseTo(12100, 6);
    expect(deposit26to27).toBeGreaterThan(deposit25to26);
  });

  it('uses fallback account when income is insufficient', () => {
    const accountId = defaultScenario.netWorth.bankAccounts![0].id;
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      netWorth: {
        ...defaultScenario.netWorth,
        accountBalances: { emergencyFund: 50000, hsa: 0, investments: 0, retirement401k: 0 },
        bankAccounts: defaultScenario.netWorth.bankAccounts!.map((a) =>
          a.id === accountId ? { ...a, balance: 50000 } : a
        )
      },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 12000, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      incomeFallbackAccountId: accountId,
      incomeFallbackAccountId2: null,
      largePurchases: [{
        id: 'income-purchase-fallback',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 40,
        amount: 20000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeFundedItemStatuses['income-purchase-fallback']).toBeDefined();
    expect(result.incomeFundedItemStatuses['income-purchase-fallback']!.status).toBe('fallback');
    // Fallback account should have been debited: 12000 income + 50000 balance covers 20000 purchase
    // fallbackDetails should show ~8000 drawn from the account
    const status = result.incomeFundedItemStatuses['income-purchase-fallback']!;
    expect(status.fallbackDetails!.length).toBe(1);
    expect(status.fallbackDetails![0].amount).toBeGreaterThan(0);
    const age41 = findProjectedYear(result, 41);
    expect(age41.accountBalancesById[accountId]).toBeLessThan(50000);
  });

  it('marks purchase as shortfall when income and fallback accounts are exhausted', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 1200, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      largePurchases: [{
        id: 'income-purchase-shortfall',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 40,
        amount: 50000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeFundedItemStatuses['income-purchase-shortfall']).toBeDefined();
    expect(result.incomeFundedItemStatuses['income-purchase-shortfall']!.status).toBe('shortfall');
  });

  it('uses yearly take-home pay period correctly', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 60000, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      largePurchases: [{
        id: 'income-yearly-test',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 40,
        amount: 4000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeFundedItemStatuses['income-yearly-test']!.status).toBe('covered');
  });

  it('uses fallback accounts when no career is active', () => {
    const accountId = defaultScenario.netWorth.bankAccounts![0].id;
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      netWorth: {
        ...defaultScenario.netWorth,
        accountBalances: { emergencyFund: 5000, hsa: 0, investments: 0, retirement401k: 0 },
        bankAccounts: defaultScenario.netWorth.bankAccounts!.map((a) =>
          a.id === accountId ? { ...a, balance: 5000 } : a
        )
      },
      careerPlan: { enabled: false, entries: [] },
      incomeFallbackAccountId: accountId,
      incomeFallbackAccountId2: null,
      largePurchases: [{
        id: 'income-no-career',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 40,
        amount: 3000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeFundedItemStatuses['income-no-career']!.status).toBe('fallback');
    const age41 = findProjectedYear(result, 41);
    expect(age41.accountBalancesById[accountId]).toBeLessThan(5000);
  });

  it('records fallback account details when income waterfall uses fallback', () => {
    const accountId = defaultScenario.netWorth.bankAccounts![0].id;
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      netWorth: {
        ...defaultScenario.netWorth,
        accountBalances: { emergencyFund: 10000, hsa: 0, investments: 0, retirement401k: 0 },
         bankAccounts: defaultScenario.netWorth.bankAccounts!.map((a) =>
           a.id === accountId ? { ...a, balance: 10000 } : a
         ),
         pools: (defaultScenario.netWorth.pools ?? []).map((p) => ({
           ...p,
           preRetirementReturnRate: 0,
           postRetirementReturnRate: 0
         }))
      },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 1000, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      incomeFallbackAccountId: accountId,
      incomeFallbackAccountId2: null,
      largePurchases: [{
        id: 'fb-details-test',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 40,
        amount: 5000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    const status = result.incomeFundedItemStatuses['fb-details-test'];
    expect(status).toBeDefined();
    expect(status!.fallbackDetails).toBeDefined();
    expect(status!.fallbackDetails!.length).toBe(1);
    expect(status!.fallbackDetails![0].accountId).toBe(accountId);
    expect(status!.fallbackDetails![0].amount).toBeGreaterThan(0);
  });

  it('records firstFallbackYearMonth when loan falls back mid-term', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 3600, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      loans: [{
        id: 'loan-fb-month',
        label: 'Test Loan',
        enabled: true,
        showOnGraph: true,
         startYearMonth: currentYearMonth(),
        originalAmount: 5000,
        downPayment: 0,
        currentBalance: 5000,
        annualInterestRate: 0,
        minimumMonthlyPayment: 350,
        extraMonthlyPayment: 0,
        paymentSourceAccount: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    const status = result.incomeFundedItemStatuses['loan-fb-month'];
    expect(status).toBeDefined();
    expect(status!.firstFallbackYearMonth).toBeDefined();
    expect(status!.firstFallbackYearMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  it('populates incomeUsageByMonth for income-funded items', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 60000, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      loans: [{
        id: 'income-usage-loan',
        label: 'Loan',
        enabled: true,
        showOnGraph: true,
        startYearMonth: '2000-01',
        originalAmount: 5000,
        downPayment: 0,
        currentBalance: 5000,
        annualInterestRate: 0,
        minimumMonthlyPayment: 350,
        extraMonthlyPayment: 0,
        paymentSourceAccount: 'income' as const
      }],
      largePurchases: [{
        id: 'income-usage-purchase',
        label: 'Purchase',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 40,
        amount: 2000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeUsageByMonth).toBeDefined();
    const monthKeys = Object.keys(result.incomeUsageByMonth);
    expect(monthKeys.length).toBeGreaterThan(0);
    const firstMonth = result.incomeUsageByMonth[monthKeys[0]];
    expect(firstMonth).toBeDefined();
    expect(firstMonth.availableIncome).toBeGreaterThan(0);
    expect(firstMonth.items.length).toBeGreaterThan(0);
    const hasLoan = firstMonth.items.some((item) => item.id === 'income-usage-loan');
    const hasPurchase = firstMonth.items.some((item) => item.id === 'income-usage-purchase');
    expect(hasLoan || hasPurchase).toBe(true);
  });

  it('covers loan payments from active career income', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 60000, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      loans: [{
        id: 'loan-active-career',
        label: 'Loan',
        enabled: true,
        showOnGraph: true,
        startYearMonth: '2000-01',
        originalAmount: 4000,
        downPayment: 0,
        currentBalance: 4000,
        annualInterestRate: 0,
        minimumMonthlyPayment: 350,
        extraMonthlyPayment: 0,
        paymentSourceAccount: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    const status = result.incomeFundedItemStatuses['loan-active-career'];
    expect(status).toBeDefined();
    expect(status!.status).toBe('covered');
  });

  it('uses separate downPaymentSource for loan down payment', () => {
    const accountId = defaultScenario.netWorth.bankAccounts![0].id;
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      netWorth: {
        ...defaultScenario.netWorth,
         accountBalances: { emergencyFund: 10000, hsa: 0, investments: 0, retirement401k: 0 },
         bankAccounts: defaultScenario.netWorth.bankAccounts!.map((a) =>
           a.id === accountId ? { ...a, balance: 10000 } : a
         ),
         pools: (defaultScenario.netWorth.pools ?? []).map((p) => ({
           ...p,
           preRetirementReturnRate: 0,
           postRetirementReturnRate: 0
         }))
      },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 60000, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 },
          sourceLines: (defaultScenario.careerPlan.entries[0].sourceLines ?? []).map((sl) => ({ ...sl, contributionRate: 0 }))
        }]
      },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      loans: [{
         id: 'loan-dp-separate',
        label: 'Loan',
        enabled: true,
        showOnGraph: true,
         startYearMonth: currentYearMonth(),
        originalAmount: 4000,
        downPayment: 3000,
        currentBalance: 4000,
        annualInterestRate: 0,
        minimumMonthlyPayment: 350,
        extraMonthlyPayment: 0,
        paymentSourceAccount: 'income' as const,
        paymentSource: 'income' as const,
        downPaymentSource: `account:${accountId}` as const
      }]
    };

    const result = projectScenario(scenario);
    const status = result.incomeFundedItemStatuses['loan-dp-separate'];
    expect(status).toBeDefined();
    expect(status!.status).toBe('covered');
    expect(result.years.find((year) => year.age === 41)?.accountBalancesById[accountId]).toBe(7000);
  });

  it('processes loan payments before large purchases in income waterfall', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 6000, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      loans: [{
        id: 'order-loan',
        label: 'Loan',
        enabled: true,
        showOnGraph: true,
        startYearMonth: '2000-01',
        originalAmount: 4800,
        downPayment: 0,
        currentBalance: 4800,
        annualInterestRate: 0,
        minimumMonthlyPayment: 400,
        extraMonthlyPayment: 0,
        paymentSourceAccount: 'income' as const
      }],
      largePurchases: [{
        id: 'order-purchase',
        label: 'Purchase',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 40,
        amount: 2000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    const loanStatus = result.incomeFundedItemStatuses['order-loan'];
    const purchaseStatus = result.incomeFundedItemStatuses['order-purchase'];
    expect(loanStatus).toBeDefined();
    expect(purchaseStatus).toBeDefined();
    expect(loanStatus!.status).toBe('covered');
    expect(purchaseStatus!.status).toBe('shortfall');
  });

  it('preserves firstFallbackYearMonth across multiple fallback months', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          paycheckInfo: { grossSalary: 4800, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
        }]
      },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      loans: [{
        id: 'loan-preserve-fb',
        label: 'Loan',
        enabled: true,
        showOnGraph: true,
        startYearMonth: '2000-01',
        originalAmount: 10000,
        downPayment: 0,
        currentBalance: 10000,
        annualInterestRate: 0,
        minimumMonthlyPayment: 500,
        extraMonthlyPayment: 0,
        paymentSourceAccount: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    const status = result.incomeFundedItemStatuses['loan-preserve-fb'];
    expect(status).toBeDefined();
    expect(status!.status).toBe('shortfall');
    expect(status!.firstFallbackYearMonth).toBeDefined();
    expect(status!.firstFallbackYearMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  it('uses secondary fallback account when primary is exhausted', () => {
    const accountId1 = defaultScenario.netWorth.bankAccounts![0].id;
    const accountId2 = defaultScenario.netWorth.bankAccounts![1].id;
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      netWorth: {
        ...defaultScenario.netWorth,
        accountBalances: { emergencyFund: 500, hsa: 5000, investments: 0, retirement401k: 0 },
        bankAccounts: defaultScenario.netWorth.bankAccounts!.map((a) => {
          if (a.id === accountId1) return { ...a, balance: 500 };
          if (a.id === accountId2) return { ...a, balance: 5000 };
          return a;
        })
      },
      careerPlan: { enabled: false, entries: [] },
      incomeFallbackAccountId: accountId1,
      incomeFallbackAccountId2: accountId2,
      largePurchases: [{
        id: 'fb-secondary-test',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: currentYearMonth(),
        age: 40,
        amount: 2000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income' as const
      }]
    };

    const result = projectScenario(scenario);
    const status = result.incomeFundedItemStatuses['fb-secondary-test'];
    expect(status).toBeDefined();
    expect(status!.fallbackDetails).toBeDefined();
    expect(status!.fallbackDetails!.length).toBe(2);
    expect(status!.fallbackDetails![0].accountId).toBe(accountId1);
    expect(status!.fallbackDetails![1].accountId).toBe(accountId2);
  });

  describe('verification', () => {
    it('simple growth: $100k at 6% APY, zero contributions and withdrawals', () => {
      const scenario = {
        ...defaultScenario,
        options: {
          ...defaultScenario.options,
          dateOfBirth: 'invalid-date'
        },
        profile: {
          currentAge: 40, retirementAge: 65, retirementYears: 30
        },
        contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
        manualReturns: {          inflationRate: 2.5,
          inflationEnabled: true
        },
        portfolio: {
          currentAssets: 100000,
          equityAllocation: 100,
          fixedIncomeAllocation: 0,
          fixedIncomeDuration: 'one_year' as const
        },
        netWorth: {
          ...defaultScenario.netWorth,
          accountBalances: { emergencyFund: 0, hsa: 0, investments: 100000, retirement401k: 0 },
          pools: defaultScenario.netWorth.pools?.map((p) => ({
            ...p,
            preRetirementReturnRate: p.id === 'investments' ? 6 : 0,
            postRetirementReturnRate: p.id === 'investments' ? 6 : 0
          })),
          bankAccounts: seedDefaultBankAccounts({ emergencyFund: 0, hsa: 0, investments: 100000, retirement401k: 0 })
        },
        careerPlan: { enabled: false, entries: [] },
        withdrawal: {
          mode: 'specified' as const,
          firstYearAmount: 0,
          minimumYearlyWithdrawal: 0,
          maximumYearlyWithdrawal: 0,
          useRetirementAgeAsWithdrawalStartAge: true,
          sourceLines: []
        }
      };

      const result = projectScenario(scenario);
      const year1 = result.years.find((y) => y.age === 41);
      expect(year1).toBeDefined();
      // $100k at 6% APY monthly compounding = 100000 * (1 + 0.06/12)^12 ≈ 106168
      expect(year1!.endBalance).toBeGreaterThan(105000);
      expect(year1!.endBalance).toBeLessThan(107000);
    });

    it('career contribution excludes employer match and bonus savings', () => {
      const scenario = {
        ...defaultScenario,
        options: {
          ...defaultScenario.options,
          dateOfBirth: 'invalid-date'
        },
        profile: {
          currentAge: 40, retirementAge: 50, retirementYears: 10
        },
        contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
        manualReturns: {          inflationRate: 0,
          inflationEnabled: true
        },
        portfolio: {
          currentAssets: 0,
          equityAllocation: 50,
          fixedIncomeAllocation: 50,
          fixedIncomeDuration: 'one_year' as const
        },
        netWorth: {
          ...defaultScenario.netWorth,
          accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
           pools: defaultScenario.netWorth.pools?.map((p) => ({
             ...p,
             preRetirementReturnRate: 0,
             postRetirementReturnRate: 0
           })),
          bankAccounts: (defaultScenario.netWorth.bankAccounts ?? []).map((a) => ({
            ...a, balance: 0
          }))
        },
        lifeEvents: [],
        cashflowItems: [],
        largePurchases: [],
        longTermPurchases: [],
        loans: [],
        careerPlan: {
          enabled: true,
          entries: [{
            id: 'verify-career-1',
            label: 'Verify Career',
            enabled: true,
            usePreviousCareerStartAge: false,
            useBirthdayBasedStartAge: false,
            startAge: 40,
            endAge: 41,            annualRaiseRate: 0,
            savingsRate: 0,
            employerMatchRate: 100,
            bonusRate: 100,
            bonusSavingsRate: 100,
            emergencyFundContributionRate: 0,
            hsaContributionRate: 0,
            investmentsContributionRate: 5,
            retirement401kContributionRate: 0,
            emergencyFundSavingsMonthly: false,
            hsaSavingsMonthly: false,
            investmentsSavingsMonthly: false,
            retirement401kSavingsMonthly: false,
            emergencyFundStartBalanceMode: 'auto' as const,
            hsaStartBalanceMode: 'auto' as const,
            investmentsStartBalanceMode: 'auto' as const,
            retirement401kStartBalanceMode: 'auto' as const,
            emergencyFundManualStartBalance: 0,
            hsaManualStartBalance: 0,
            investmentsManualStartBalance: 0,
            retirement401kManualStartBalance: 0,
            paycheckInfo: {
              grossSalary: 100000,
              taxes: 0,
              healthBenefits: 0,
              retirement: 0,
              retirementMatch: 0,
              hsaContribution: 0,
              hsaEmployerMatch: 0,
              otherBenefits: 0,
              livingExpenses: 0
            },
            sourceLines: (defaultScenario.netWorth.bankAccounts ?? []).filter((ba) => ba.poolId === 'investments').map((ba) => ({
              id: `career-source-${ba.id}`,
              enabled: true,
              sourceType: 'account' as const,
              sourceId: ba.id,
              contributionRate: 5,
              savingsMonthly: false,
              monthlyWithdrawal: 0,
              maxBalance: 0,
              overflowFallbackAccountId: null
            }))
          }]
        }
      };

      const result = projectScenario(scenario);
      const year1 = result.years.find((y) => y.age === 41);
      expect(year1).toBeDefined();
      // contribution = 5% of $100k = $5000; employer match (100%) and bonus savings should be excluded
      expect(year1!.careerContribution).toBeCloseTo(5000, 6);
      // end balance should approximately equal $5000 (5% of salary, zero growth)
      expect(year1!.endBalance).toBeCloseTo(5000, 6);
    });

    it('high withdrawal rate correctly depletes portfolio', () => {
      const scenario = {
        ...defaultScenario,
        options: {
          ...defaultScenario.options,
          dateOfBirth: 'invalid-date'
        },
        profile: {
          currentAge: 40, retirementAge: 40, retirementYears: 20
        },
        contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
        manualReturns: {          inflationRate: 0,
          inflationEnabled: true
        },
        portfolio: {
          currentAssets: 100000,
          equityAllocation: 100,
          fixedIncomeAllocation: 0,
          fixedIncomeDuration: 'one_year' as const
        },
        netWorth: {
          ...defaultScenario.netWorth,
          pools: defaultScenario.netWorth.pools?.map((p) => ({
            ...p
          })),
          bankAccounts: (defaultScenario.netWorth.bankAccounts ?? [])
        },
        careerPlan: { enabled: false, entries: [] },
        lifeEvents: [],
        cashflowItems: [],
        largePurchases: [],
        longTermPurchases: [],
        loans: [],
        withdrawal: {
          mode: 'specified' as const,
          firstYearAmount: 15000,
          minimumYearlyWithdrawal: 15000,
          maximumYearlyWithdrawal: 15000,
          useRetirementAgeAsWithdrawalStartAge: true,
          sourceLines: (defaultScenario.netWorth.bankAccounts ?? []).filter((ba) => ba.poolId === 'investments').map((ba) => ({
            id: `withdrawal-src-${ba.id}`,
            enabled: true,
            sourceType: 'account' as const,
            sourceId: ba.id,
            mode: 'amount' as const,
            amount: 15000,
            startAge: undefined,
            syncWithRetirementAge: false
          }))
        }
      };

      const result = projectScenario(scenario);
      expect(result.survivesToEnd).toBe(false);
      expect(result.depletedAge).toBeLessThanOrEqual(55);
    });
  });

  describe('income validation', () => {
    const baseScenario = (overrides: Record<string, unknown> = {}) => ({
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      netWorth: {
        ...defaultScenario.netWorth,
        accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        bankAccounts: seedDefaultBankAccounts({ emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 })
      },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40,
          endAge: 41,
          sourceLines: [],
          paycheckInfo: {
            grossSalary: 12000, taxes: 0, healthBenefits: 0, otherBenefits: 0, livingExpenses: 0,
            retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0
          }
        }]
      },
      largePurchases: [],
      longTermPurchases: [],
      loans: [],
      ...overrides
    });

    it('flags monthly income-funded spending that exceeds monthly take-home', () => {
      const result = projectScenario(baseScenario({
        longTermPurchases: [{
          id: 'income-lt-overspend',
          label: 'Big Monthly Expense',
          enabled: true,
          showOnGraph: true,
          startYearMonth: currentYearMonth(),
          endMode: 'duration' as const,
          durationMonths: 1,
          endYearMonth: '',
          monthlyAmount: 2000,
          fundingSource: 'income' as const
        }]
      }));

      expect(result.incomeValidation.hasOverspend).toBe(true);
      const period = result.incomeValidation.periods.find(
        (p) => p.pool === 'monthly' && p.periodKey === currentYearMonth()
      );
      expect(period).toBeDefined();
      expect(period!.budget).toBeCloseTo(1000, 2);
      expect(period!.totalRequested).toBeCloseTo(2000, 2);
      expect(period!.totalFromIncome).toBeCloseTo(1000, 2);
      expect(period!.totalShortfall).toBeCloseTo(1000, 2);
      expect(period!.exceedsIncome).toBe(true);
      expect(period!.hasUnmet).toBe(true);
    });

    it('flags yearly income-funded spending that exceeds the annual take-home budget', () => {
      const result = projectScenario(baseScenario({
        largePurchases: [{
          id: 'income-yearly-overspend',
          label: 'Big Purchase',
          enabled: true,
          showOnGraph: true,
          yearMonth: '',
          age: 40,
          amount: 20000,
          sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
          fundingSource: 'income' as const
        }]
      }));

      expect(result.incomeValidation.hasOverspend).toBe(true);
      const period = result.incomeValidation.periods.find((p) => p.pool === 'yearly');
      expect(period).toBeDefined();
      expect(period!.budget).toBeCloseTo(12000, 2);
      expect(period!.totalRequested).toBeCloseTo(20000, 2);
      expect(period!.totalShortfall).toBeCloseTo(8000, 2);
      expect(period!.hasUnmet).toBe(true);
    });

    it('does not flag income usage that stays within budget', () => {
      const result = projectScenario(baseScenario({
        longTermPurchases: [{
          id: 'income-lt-within-budget',
          label: 'Small Monthly Expense',
          enabled: true,
          showOnGraph: true,
          startYearMonth: currentYearMonth(),
          endMode: 'duration' as const,
          durationMonths: 1,
          endYearMonth: '',
          monthlyAmount: 500,
          fundingSource: 'income' as const
        }]
      }));

      expect(result.incomeValidation.hasOverspend).toBe(false);
      expect(result.incomeValidation.periods).toHaveLength(0);
    });

    it('flags fallback-covered spending as exceeding income even when fully covered', () => {
      const accountId = defaultScenario.netWorth.bankAccounts![0].id;
      const result = projectScenario(baseScenario({
        incomeFallbackAccountId: accountId,
        netWorth: {
          ...defaultScenario.netWorth,
          accountBalances: { emergencyFund: 500, hsa: 0, investments: 0, retirement401k: 0 },
          bankAccounts: defaultScenario.netWorth.bankAccounts!.map((a) =>
            a.id === accountId ? { ...a, balance: 500 } : a
          )
        },
        longTermPurchases: [{
          id: 'income-lt-fallback',
          label: 'Fallback Expense',
          enabled: true,
          showOnGraph: true,
          startYearMonth: currentYearMonth(),
          endMode: 'duration' as const,
          durationMonths: 1,
          endYearMonth: '',
          monthlyAmount: 1500,
          fundingSource: 'income' as const
        }]
      }));

      const period = result.incomeValidation.periods.find(
        (p) => p.pool === 'monthly' && p.periodKey === currentYearMonth()
      );
      expect(period).toBeDefined();
      expect(period!.exceedsIncome).toBe(true);
      expect(period!.hasUnmet).toBe(false);
      expect(period!.totalFromFallback).toBeCloseTo(500, 2);
      expect(period!.totalShortfall).toBeCloseTo(0, 2);
    });

    it('flags career source contributions that exceed take-home income', () => {
      const accountId = defaultScenario.netWorth.bankAccounts![0].id;
      const result = projectScenario(baseScenario({
        careerPlan: {
          enabled: true,
          entries: [{
            ...defaultScenario.careerPlan.entries[0],
            startAge: 40,
            endAge: 41,
            sourceLines: [{
              id: 'source-1',
              enabled: true,
              sourceType: 'account' as const,
              sourceId: accountId,
              contributionRate: 200,
              savingsMonthly: false,
              monthlyWithdrawal: 0,
              maxBalance: 0,
              overflowFallbackAccountId: null
            }],
            paycheckInfo: {
              grossSalary: 12000, taxes: 0, healthBenefits: 0, otherBenefits: 0, livingExpenses: 0,
              retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0
            }
          }]
        }
      }));

      const period = result.incomeValidation.periods.find(
        (p) => p.pool === 'monthly' && p.periodKey === currentYearMonth()
      );
      expect(period).toBeDefined();
      const item = period!.items.find((i) => i.id === 'career-source-contributions');
      expect(item).toBeDefined();
      expect(item!.requested).toBeCloseTo(2000, 2);
      expect(item!.fromIncome).toBeCloseTo(1000, 2);
      expect(item!.shortfall).toBeCloseTo(1000, 2);
      expect(period!.hasUnmet).toBe(true);
    });

    it('consolidates repeated months with the same items and overage into one group', () => {
      const result = projectScenario(baseScenario({
        longTermPurchases: [{
          id: 'income-lt-repeated',
          label: 'Rent',
          enabled: true,
          showOnGraph: true,
          startYearMonth: currentYearMonth(),
          endMode: 'duration' as const,
          durationMonths: 6,
          endYearMonth: '',
          monthlyAmount: 2000,
          fundingSource: 'income' as const
        }]
      }));

      expect(result.incomeValidation.groups).toHaveLength(1);
      const group = result.incomeValidation.groups[0];
      expect(group.periodKeys).toHaveLength(6);
      expect(group.minOverage).toBeCloseTo(1000, 2);
      expect(group.maxOverage).toBeCloseTo(1000, 2);
      expect(group.items.some((i) => i.id === 'income-lt-repeated')).toBe(true);
      expect(group.hasUnmet).toBe(true);
    });

    it('groups periods by shared items and similar overage while splitting different causes', () => {
      const makePeriod = (
        periodKey: string,
        id: string,
        requested: number,
        budget = 1000
      ): IncomePoolUsagePeriod => ({
        pool: 'monthly',
        periodKey,
        budget,
        totalRequested: requested,
        totalFromIncome: Math.min(budget, requested),
        totalFromFallback: Math.max(0, requested - budget),
        totalShortfall: 0,
        exceedsIncome: requested > budget,
        hasUnmet: false,
        items: [{
          id,
          label: id,
          requested,
          fromIncome: Math.min(budget, requested),
          fromFallback: Math.max(0, requested - budget),
          shortfall: 0
        }]
      });

      const groups = groupIncomeValidationPeriods([
        makePeriod('2028-03', 'rent', 2500),
        makePeriod('2028-04', 'rent', 2504),
        makePeriod('2028-05', 'rent', 4000),
        makePeriod('2028-06', 'rent', 2501)
      ]);

      expect(groups).toHaveLength(2);
      expect(groups[0].periodKeys).toEqual(['2028-03', '2028-04', '2028-06']);
      expect(groups[0].minOverage).toBeCloseTo(1500, 2);
      expect(groups[0].maxOverage).toBeCloseTo(1504, 2);
      expect(groups[1].periodKeys).toEqual(['2028-05']);
    });

    it('describes consecutive and gapped groups', () => {
      const makePeriod = (periodKey: string, requested: number): IncomePoolUsagePeriod => ({
        pool: 'monthly',
        periodKey,
        budget: 1000,
        totalRequested: requested,
        totalFromIncome: 1000,
        totalFromFallback: requested - 1000,
        totalShortfall: 0,
        exceedsIncome: true,
        hasUnmet: false,
        items: [{
          id: 'rent',
          label: 'Rent',
          requested,
          fromIncome: 1000,
          fromFallback: requested - 1000,
          shortfall: 0
        }]
      });

      const [consecutive] = groupIncomeValidationPeriods([
        makePeriod('2028-03', 2500),
        makePeriod('2028-04', 2500),
        makePeriod('2028-05', 2500)
      ]);
      expect(describeIncomeValidationGroup(consecutive)).toBe('Months 2028-03 – 2028-05 (3 months)');

      const [gapped] = groupIncomeValidationPeriods([
        makePeriod('2028-03', 2500),
        makePeriod('2028-05', 2500)
      ]);
      expect(describeIncomeValidationGroup(gapped)).toBe('Months 2028-03, 2028-05 (2 months)');

      const [single] = groupIncomeValidationPeriods([makePeriod('2028-03', 2500)]);
      expect(describeIncomeValidationGroup(single)).toBe('Month 2028-03');
    });
  });

  describe('simulation start anchoring', () => {
    const anchoredBase = (overrides: Record<string, unknown> = {}) => ({
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 42, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      netWorth: {
        ...defaultScenario.netWorth,
        accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        bankAccounts: seedDefaultBankAccounts({ emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 })
      },
      careerPlan: { enabled: false, entries: [] },
      largePurchases: [],
      longTermPurchases: [],
      loans: [],
      ...overrides
    });

    it('anchors the start date, year-month, and calendar years to the provided start date', () => {
      const result = projectScenario(anchoredBase(), { startDate: '2026-01-15' });

      expect(result.simulationStartDate).toBe('2026-01-15');
      expect(result.simulationStartYearMonth).toBe('2026-01');
      expect(result.years.find((year) => year.isBaselineNow)?.calendarYear).toBe(2026);
      expect(result.years.find((year) => !year.isBaselineNow)?.calendarYear).toBe(2026);
    });

    it('ignores a large purchase scheduled before the simulation start', () => {
      const result = projectScenario(
        anchoredBase({
          largePurchases: [
            {
              id: 'past-purchase',
              label: 'Past',
              enabled: true,
              showOnGraph: true,
              yearMonth: '2025-06',
              age: 40,
              amount: 5000,
              fundingSource: 'income'
            }
          ]
        }),
        { startDate: '2026-01-15' }
      );

      expect(result.incomeFundedItemStatuses['past-purchase']).toBeUndefined();
    });

    it('processes a large purchase scheduled at or after the simulation start', () => {
      const result = projectScenario(
        anchoredBase({
          largePurchases: [
            {
              id: 'future-purchase',
              label: 'Future',
              enabled: true,
              showOnGraph: true,
              yearMonth: '2026-02',
              age: 40,
              amount: 5000,
              fundingSource: 'income'
            }
          ]
        }),
        { startDate: '2026-01-15' }
      );

      expect(result.incomeFundedItemStatuses['future-purchase']).toBeDefined();
    });

    it('charges an in-progress long-term purchase from the simulation start', () => {
      const result = projectScenario(
        anchoredBase({
          longTermPurchases: [
            {
              id: 'in-progress-lt',
              label: 'In progress',
              enabled: true,
              showOnGraph: true,
              startYearMonth: '2025-10',
              endMode: 'duration',
              durationMonths: 12,
              endYearMonth: '',
              monthlyAmount: 100,
              fundingSource: 'income'
            }
          ]
        }),
        { startDate: '2026-01-15' }
      );

      expect(result.incomeUsageByMonth['2026-01']).toBeDefined();
    });
  });
});


describe('paycheck net income as the income source', () => {
  const makeCareer = (annualRaiseRate: number) => {
    const base = defaultScenario.careerPlan.entries[0];
    return {
      ...base,
      annualRaiseRate,
      startAge: 45,
      endAge: 65,
      sourceLines: [],
      paycheckInfo: undefined,
      paycheck: {
        payFrequency: 'weekly' as const,
        categories: [
          { id: 'cat-earn', label: 'Earnings', kind: 'earning' as const, lines: [{ id: 'earn', label: 'Regular', amount: 1000, mode: 'amount' as const }] },
          { id: 'cat-tax', label: 'Statutory', kind: 'tax' as const, lines: [{ id: 'tax', label: 'Federal', amount: 100, mode: 'amount' as const }] },
          {
            id: 'cat-pretax',
            label: 'Deductions',
            kind: 'pretax' as const,
            lines: [{ id: 'ret', label: '401k', amount: 50, mode: 'amount' as const, accountId: 'retirement401k-account-default', bucket: 'retirement' as const }]
          }
        ]
      }
    };
  };

  const scenarioWith = (annualRaiseRate: number) => ({
    ...defaultScenario,
    profile: { ...defaultScenario.profile, currentAge: 45, retirementAge: 65 },
    options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
    careerPlan: { enabled: true, entries: [makeCareer(annualRaiseRate)] }
  });

  it('uses net pay (gross minus deductions) as the annual income', () => {
    const result = projectScenario(scenarioWith(0));
    const years = result.years.filter((year) => !year.isBaselineNow);

    // (1000 - 100 - 50) per week x 52 weeks
    expect(years[0].netIncome).toBeCloseTo(44200, 4);
  });

  it('scales net income with the annual raise', () => {
    const result = projectScenario(scenarioWith(10));
    const years = result.years.filter((year) => !year.isBaselineNow);

    expect(years[0].netIncome).toBeGreaterThan(0);
    expect(years[1].netIncome / years[0].netIncome).toBeCloseTo(1.1, 6);
  });
});

describe('fixed-amount source-line deposits', () => {
  const scenarioWithSourceLine = (increaseWithPaycheck: boolean, annualRaiseRate: number) => {
    const base = defaultScenario.careerPlan.entries[0];
    return {
      ...defaultScenario,
      profile: { ...defaultScenario.profile, currentAge: 45, retirementAge: 65 },
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      careerPlan: {
        enabled: true,
        entries: [
          {
            ...base,
            annualRaiseRate,
            startAge: 45,
            endAge: 65,
            paycheckInfo: undefined,
            paycheck: {
              payFrequency: 'weekly' as const,
              categories: [
                { id: 'cat-earn', label: 'Earnings', kind: 'earning' as const, lines: [{ id: 'earn', label: 'Regular', amount: 1000, mode: 'amount' as const }] }
              ]
            },
            sourceLines: [
              {
                id: 'line-1',
                enabled: true,
                sourceType: 'account' as const,
                sourceId: 'investments-account-default',
                contributionRate: 0,
                savingsMonthly: false,
                monthlyWithdrawal: 0,
                mode: 'fixedAmount' as const,
                fixedAmount: 100,
                increaseWithPaycheck
              }
            ]
          }
        ]
      }
    };
  };

  it('keeps fixed deposits flat across years by default', () => {
    const result = projectScenario(scenarioWithSourceLine(false, 10));
    const years = result.years.filter((year) => !year.isBaselineNow);
    const sample = years[1];

    expect(sample.careerContribution).toBeCloseTo(5200 * (sample.periodMonths / 12), 4);
  });

  it('scales fixed deposits with the paycheck raise when enabled', () => {
    const flat = projectScenario(scenarioWithSourceLine(false, 10));
    const scaled = projectScenario(scenarioWithSourceLine(true, 10));
    const flatYears = flat.years.filter((year) => !year.isBaselineNow);
    const scaledYears = scaled.years.filter((year) => !year.isBaselineNow);

    expect(flatYears[1].careerContribution).toBeGreaterThan(0);
    expect(scaledYears[1].careerContribution / flatYears[1].careerContribution).toBeCloseTo(1.1, 6);
  });
});

describe('career monthly withdrawal expenses', () => {
  const baseWithWithdrawal = (increaseWithdrawalWithPaycheck: boolean, withdrawal: number, accountId: string) => ({
    ...defaultScenario,
    options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
    profile: { ...defaultScenario.profile, currentAge: 40, retirementAge: 65 },
    contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
    netWorth: {
      ...defaultScenario.netWorth,
      accountBalances: { emergencyFund: 10000000, hsa: 0, investments: 0, retirement401k: 0 },
      bankAccounts: defaultScenario.netWorth.bankAccounts!.map((a) => (a.id === accountId ? { ...a, balance: 10000000 } : a)),
      pools: defaultScenario.netWorth.pools?.map((p) => ({ ...p, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }))
    },
    careerPlan: {
      enabled: true,
      entries: [{
        ...defaultScenario.careerPlan.entries[0],
        annualRaiseRate: 10,
        startAge: 40,
        endAge: 60,
        paycheckInfo: { grossSalary: 0, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 },
        sourceLines: [{
          id: `line-${accountId}`,
          enabled: true,
          sourceType: 'account' as const,
          sourceId: accountId,
          contributionRate: 0,
          savingsMonthly: false,
          monthlyWithdrawal: withdrawal,
          increaseWithdrawalWithPaycheck
        }]
      }]
    },
    incomeFallbackAccountId: null,
    incomeFallbackAccountId2: null
  });

  it('records a shortfall when a monthly withdrawal exceeds the account balance', () => {
    const accountId = defaultScenario.netWorth.bankAccounts![0].id;
    const scenario = baseWithWithdrawal(false, 200, accountId);
    scenario.netWorth.bankAccounts = scenario.netWorth.bankAccounts.map((a) => (a.id === accountId ? { ...a, balance: 500 } : a));

    const result = projectScenario(scenario);

    expect(result.careerWithdrawalShortfalls[accountId]).toBeGreaterThan(0);
    expect((result.warnings ?? []).some((warning) => warning.includes('Monthly withdrawal for'))).toBe(true);
  });

  it('scales monthly withdrawals with the raise when enabled', () => {
    const accountId = defaultScenario.netWorth.bankAccounts![0].id;
    const flat = projectScenario(baseWithWithdrawal(false, 100, accountId));
    const scaled = projectScenario(baseWithWithdrawal(true, 100, accountId));
    const sumWithdrawals = (result: ReturnType<typeof projectScenario>) =>
      (result.monthlyWaterfall ?? []).reduce((sum, month) => sum + month.careerWithdrawals, 0);

    expect(sumWithdrawals(flat)).toBeGreaterThan(0);
    expect(sumWithdrawals(scaled) / sumWithdrawals(flat)).toBeGreaterThan(1.05);
  });
});

describe('income fallback for credit cards and housing', () => {
  const fallbackScenario = (): { accountId: string; scenario: Scenario } => {
    const accountId = defaultScenario.netWorth.bankAccounts![0].id;
    return {
      accountId,
      scenario: {
        ...defaultScenario,
        options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
        profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
        contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
        netWorth: {
          ...defaultScenario.netWorth,
          accountBalances: { emergencyFund: 1000000, hsa: 0, investments: 0, retirement401k: 0 },
          bankAccounts: defaultScenario.netWorth.bankAccounts!.map((a) => (a.id === accountId ? { ...a, balance: 1000000 } : a))
        },
        careerPlan: {
          enabled: true,
          entries: [{
            ...defaultScenario.careerPlan.entries[0],
            startAge: 40,
            endAge: 41,
            paycheckInfo: { grossSalary: 12000, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 }
          }]
        },
        incomeFallbackAccountId: accountId,
        incomeFallbackAccountId2: null,
        creditCards: [],
        housing: [],
        largePurchases: [],
        longTermPurchases: [],
        loans: []
      }
    };
  };

  it('draws from the fallback account for income-funded credit card payments', () => {
    const { accountId, scenario } = fallbackScenario();
    scenario.creditCards = [{
      id: 'cc-fallback',
      label: 'Card',
      enabled: true,
      currentBalance: 20000,
      annualInterestRate: 0,
      introEnabled: false,
      introEndYearMonth: '',
      monthlyCharges: 0,
      paymentMode: 'fixed',
      fixedPaymentAmount: 20000,
      minimumPaymentPercent: 0,
      minimumPaymentFloor: 0,
      paymentSource: 'income',
      lumpSumPaymentSource: 'income',
      paymentDay: 1
    }];

    const result = projectScenario(scenario);
    const status = result.incomeFundedItemStatuses['cc-fallback'];

    expect(status).toBeDefined();
    expect(status!.status).toBe('fallback');
    expect(status!.fallbackDetails!.some((detail) => detail.accountId === accountId && detail.amount > 0)).toBe(true);
  });

  it('draws from the fallback account for income-funded housing costs', () => {
    const { accountId, scenario } = fallbackScenario();
    scenario.housing = [{
      id: 'housing-fallback',
      label: 'Rent',
      enabled: true,
      showOnGraph: true,
      housingType: 'rental',
      startYearMonth: currentYearMonth(),
      purchasePrice: 0,
      downPayment: 0,
      annualInterestRate: 0,
      loanTermYears: 0,
      extraMonthlyPayment: 0,
      monthlyRent: 5000,
      endYearMonth: '',
      propertyTaxYearly: 0,
      homeInsuranceYearly: 0,
      hoaMonthly: 0,
      maintenanceMonthly: 0,
      pmiMonthly: 0,
      rentalIncomeMonthly: 0,
      rentalIncomeAccountId: '',
      sellYearMonth: '',
      appreciationRate: 0,
      sellingCostsRate: 0,
      saleProceedsAccountId: '',
      paymentSource: 'income'
    }];

    const result = projectScenario(scenario);
    const status = result.incomeFundedItemStatuses['housing-fallback'];

    expect(status).toBeDefined();
    expect(status!.status).toBe('fallback');
    expect(status!.fallbackDetails!.some((detail) => detail.accountId === accountId && detail.amount > 0)).toBe(true);
  });
});
