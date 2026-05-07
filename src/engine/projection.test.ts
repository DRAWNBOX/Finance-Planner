import { describe, expect, it, vi } from 'vitest';
import { defaultScenario } from '../defaultScenario';
import { projectScenario } from './projection';

const findProjectedYear = (result: ReturnType<typeof projectScenario>, age: number) =>
  result.years.find((year) => year.age === age && !year.isBaselineNow)!;

describe('projectScenario', () => {
  it('grows the portfolio with contributions before retirement', () => {
    const result = projectScenario(defaultScenario);
    const age46 = result.years.find((year) => year.age === 46);

    expect(age46).toBeDefined();
    expect(age46!.contribution).toBeGreaterThan(0);
    expect(result.endingBalance).toBeGreaterThan(0);
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
        ...defaultScenario.manualReturns,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 1000,
          hsa: 2000,
          investments: 3000,
          retirement401k: 4000
        },
        asOfDate: ''
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        firstYearAmount: 0,
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        firstYearAccountUseFourPercent: {
          emergencyFund: false,
          hsa: false,
          investments: false,
          retirement401k: false
        },
        inflationAdjusted: false
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
        ...defaultScenario.manualReturns,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: ''
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        firstYearAmount: 0,
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        firstYearAccountUseFourPercent: {
          emergencyFund: false,
          hsa: false,
          investments: false,
          retirement401k: false
        },
        inflationAdjusted: false
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        },
        asOfDate: ''
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'four_percent' as const
      }
    };

    const result = projectScenario(scenario);
    const retirementYear = findProjectedYear(result, scenario.profile.retirementAge + 1);
    const expected = 100000 * 0.04;

    expect(retirementYear!.withdrawal).toBeCloseTo(expected, 2);
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 100000,
          retirement401k: 0
        },
        asOfDate: ''
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        useRetirementAgeAsWithdrawalStartAge: false,
        firstYearAmount: 10000,
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 10000,
          retirement401k: 0
        },
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
        inflationAdjusted: false
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
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 10000
        },
        inflationAdjusted: true
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        },
        asOfDate: ''
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 20000,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: ''
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        firstYearAmount: 10000,
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 10000,
          investments: 0,
          retirement401k: 0
        },
        firstYearAccountUseFourPercent: {
          emergencyFund: false,
          hsa: false,
          investments: false,
          retirement401k: false
        }
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
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 10000
        },
        inflationAdjusted: true
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        },
        asOfDate: ''
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 100000
        },
        asOfDate: ''
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'specified' as const,
        minimumYearlyWithdrawal: 0,
        maximumYearlyWithdrawal: 8000,
        firstYearAmount: 15000,
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 15000
        },
        firstYearAccountUseFourPercent: {
          emergencyFund: false,
          hsa: false,
          investments: false,
          retirement401k: false
        },
        inflationAdjusted: false
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
          inflationAdjusted: true
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
          inflationAdjusted: true
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
          inflationAdjusted: true
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
          inflationAdjusted: false
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
          inflationAdjusted: false
        }
      ]
    };

    const result = projectScenario(scenario);
    const age49 = findProjectedYear(result, 49);
    const age51 = findProjectedYear(result, 51);

    expect(age49.extraCashflow).toBe(-10000);
    expect(age51.extraCashflow).toBe(50000);
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
            endAge: 42,
            startingSalary: 100000,
            annualRaiseRate: 0,
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
    expect(age41.careerContribution).toBeCloseTo(12000, 6);
    expect(age41.contribution).toBeCloseTo(12000, 6);
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
            endAge: 45,
            startingSalary: 100000,
            annualRaiseRate: 0,
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
          inflationAdjusted: false
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
          inflationAdjusted: false
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
          inflationAdjusted: false
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

  it('runs deterministic historical mode using the bundled local series', () => {
    const result = projectScenario({
      ...defaultScenario,
      returnMode: 'historical'
    });

    expect(result.historicalWindowLabel).toMatch(/^\d{4}-\d{4}$/);
    expect(result.years[0].annualReturnRate).not.toBe(defaultScenario.manualReturns.preRetirementEquityReturn / 100);
  });

  it('marks the projection as depleted when withdrawals are unsustainable', () => {
    const result = projectScenario({
      ...defaultScenario,
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
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 50000
        },
        firstYearAccountUseFourPercent: {
          emergencyFund: false,
          hsa: false,
          investments: false,
          retirement401k: false
        },
        inflationAdjusted: false
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
        asOfDate: ''
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
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 50000
        },
        firstYearAccountUseFourPercent: {
          emergencyFund: false,
          hsa: false,
          investments: false,
          retirement401k: false
        },
        inflationAdjusted: false
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
        inflationEnabled: false,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 150000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: ''
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 0,
        minimumYearlyWithdrawal: 10000,
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        inflationAdjusted: false
      }
    });

    expect(result.survivesToEnd).toBe(false);
    expect(result.depletedAge).toBe(65);
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
        inflationEnabled: false,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 200000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: ''
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 10000,
        minimumYearlyWithdrawal: 10000,
        firstYearAccountWithdrawals: {
          emergencyFund: 10000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        inflationAdjusted: false
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      manualReturns: {
        ...defaultScenario.manualReturns,
        inflationEnabled: true,
        inflationRate: 3,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 30100,
          investments: 100000,
          retirement401k: 0
        },
        asOfDate: ''
      },
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 20000,
        minimumYearlyWithdrawal: 10000,
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 20000,
          investments: 0,
          retirement401k: 0
        },
        inflationAdjusted: true
      }
    });

    expect(result.depletedAge).toBe(66);
    const age66 = findProjectedYear(result, 66);
    const age67 = findProjectedYear(result, 67);
    expect(age66.withdrawal).toBe(20000);
    expect(age67.withdrawal).toBe(10100);
  });

  it('scales the minimum yearly withdrawal threshold for a partial first retirement year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));

    const baseScenario = {
      ...defaultScenario,
      options: {
        ...defaultScenario.options,
        dateOfBirth: '1980-05-01T12:00:00Z'
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
        inflationEnabled: false,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 200000,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: ''
      }
    };

    const calibration = projectScenario({
      ...baseScenario,
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 0,
        minimumYearlyWithdrawal: 0,
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        inflationAdjusted: false
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
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 12001,
          investments: 0,
          retirement401k: 0
        },
        inflationAdjusted: false
      }
    });

    const missesMinimum = projectScenario({
      ...baseScenario,
      withdrawal: {
        ...defaultScenario.withdrawal,
        firstYearAmount: 11999,
        minimumYearlyWithdrawal: 12000,
        firstYearAccountWithdrawals: {
          emergencyFund: 0,
          hsa: 11999,
          investments: 0,
          retirement401k: 0
        },
        inflationAdjusted: false
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
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
            endAge: 42,
            startingSalary: 100000,
            annualRaiseRate: 0,
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
        ...defaultScenario.manualReturns,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: ''
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
            endAge: 44,
            startingSalary: 12000,
            annualRaiseRate: 0,
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
          yearMonth: '2000-01',
          age: 40,
          amount: 2000,
          sourceAmounts: {
            emergencyFund: 0,
            hsa: 0,
            investments: 2000,
            retirement401k: 0
          }
        }
      ]
    };

    const result = projectScenario(scenario);

    expect(result.purchaseFundingShortfalls['purchase-1']).toBeGreaterThan(0);
    expect(result.purchaseFirstAffordableAge['purchase-1']).toBe(42);
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
        ...defaultScenario.manualReturns,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 2000,
          hsa: 0,
          investments: 5000,
          retirement401k: 0
        },
        asOfDate: ''
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
          yearMonth: '2000-01',
          age: 40,
          amount: 6000,
          sourceAmounts: {
            emergencyFund: 4000,
            hsa: 0,
            investments: 2000,
            retirement401k: 0
          }
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
        ...defaultScenario.manualReturns,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 1000,
          hsa: 0,
          investments: 2000,
          retirement401k: 0
        },
        asOfDate: ''
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
          yearMonth: '2000-01',
          age: 40,
          amount: 1200,
          sourceAmounts: {
            emergencyFund: 200,
            hsa: 0,
            investments: 1000,
            retirement401k: 0
          }
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
        ...defaultScenario.manualReturns,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 5000,
          retirement401k: 0
        },
        asOfDate: ''
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
          startYearMonth: '2026-06',
          endMode: 'duration' as const,
          durationMonths: 6,
          endYearMonth: '2026-06',
          monthlyAmount: 500,
          sourceAmounts: {
            emergencyFund: 0,
            hsa: 0,
            investments: 500,
            retirement401k: 0
          }
        }
      ]
    };

    const result = projectScenario(scenario);
    const age41 = findProjectedYear(result, 41);

    expect(result.longTermPurchaseFundingShortfalls['lt-1'] ?? 0).toBe(0);
    expect(age41.savingsBalances.investments).toBeLessThan(5000);
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
        retirementAge: 41,
        retirementYears: 1
      },
      contribution: {
        yearlyContribution: 0,
        yearlyIncreaseRate: 0
      },
      manualReturns: {
        ...defaultScenario.manualReturns,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 12000,
          retirement401k: 0
        },
        asOfDate: ''
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
          startYearMonth: '2026-01',
          originalAmount: 10000,
          downPayment: 0,
          currentBalance: 10000,
          annualInterestRate: 12,
          minimumMonthlyPayment: 900,
          extraMonthlyPayment: 100,
          paymentSourceAccount: 'investments' as const
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
        ...defaultScenario.manualReturns,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 100,
          retirement401k: 0
        },
        asOfDate: ''
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
          startYearMonth: '2026-01',
          originalAmount: 1000,
          downPayment: 0,
          currentBalance: 1000,
          annualInterestRate: 0,
          minimumMonthlyPayment: 500,
          extraMonthlyPayment: 0,
          paymentSourceAccount: 'investments' as const
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
        ...defaultScenario.manualReturns,
        preRetirementEquityReturn: 0,
        postRetirementEquityReturn: 0,
        fixedIncomeReturn: 0
      },
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 0,
          hsa: 0,
          investments: 12000,
          retirement401k: 0
        },
        asOfDate: ''
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
        dateOfBirth: '1985-01-01',
        useDateBasedAge: false
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
        asOfDate: ''
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
          paymentSourceAccount: 'investments' as const
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 14900,
          hsa: 0,
          investments: 1000,
          retirement401k: 0
        },
        asOfDate: ''
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
            ...baseCareer,
            id: 'career-1',
            enabled: true,
            startAge: 40,
            endAge: 40,
            startingSalary: 12000,
            annualRaiseRate: 0,
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 15000,
          hsa: 0,
          investments: 1000,
          retirement401k: 0
        },
        asOfDate: ''
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
            ...baseCareer,
            id: 'career-1-no-cap',
            enabled: true,
            startAge: 40,
            endAge: 40,
            startingSalary: 12000,
            annualRaiseRate: 0,
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
            enabled: true,
            startAge: 41,
            endAge: 41,
            startingSalary: 12000,
            annualRaiseRate: 0,
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 14900,
          hsa: 0,
          investments: 1000,
          retirement401k: 0
        },
        asOfDate: ''
      },
      careerPlan: {
        enabled: true,
        entries: [
          {
            ...baseCareer,
            id: 'career-1',
            enabled: true,
            startAge: 40,
            endAge: 40,
            startingSalary: 12000,
            annualRaiseRate: 0,
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 0,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 1000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: ''
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
            endAge: 25,
            startingSalary: 12000,
            annualRaiseRate: 0,
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

  it('compounds monthly while APY input remains annual', () => {
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
      savingsTracker: {
        annualInterestRates: {
          emergencyFund: 12,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        }
      },
      netWorth: {
        accountBalances: {
          emergencyFund: 1000,
          hsa: 0,
          investments: 0,
          retirement401k: 0
        },
        asOfDate: ''
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
            endAge: 25,
            startingSalary: 0,
            annualRaiseRate: 0,
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
    const expected = 1000 * Math.pow(1 + 0.12 / 12, 12);

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
        asOfDate: ''
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
      manualReturns: { ...defaultScenario.manualReturns, preRetirementEquityReturn: 0, postRetirementEquityReturn: 0, fixedIncomeReturn: 0 },
      savingsTracker: { annualInterestRates: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 } },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          takeHomePay: { amount: 5000, period: 'monthly' }
        }]
      },
      largePurchases: [{
        id: 'income-purchase-covered',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: '2000-01',
        age: 40,
        amount: 3000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income'
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeFundedItemStatuses['income-purchase-covered']).toBeDefined();
    expect(result.incomeFundedItemStatuses['income-purchase-covered']!.status).toBe('covered');
  });

  it('uses fallback account when income is insufficient', () => {
    const accountId = defaultScenario.netWorth.bankAccounts![0].id;
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns, preRetirementEquityReturn: 0, postRetirementEquityReturn: 0, fixedIncomeReturn: 0 },
      savingsTracker: { annualInterestRates: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 } },
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
          takeHomePay: { amount: 1000, period: 'monthly' }
        }]
      },
      incomeFallbackAccountId: accountId,
      incomeFallbackAccountId2: null,
      largePurchases: [{
        id: 'income-purchase-fallback',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: '2000-01',
        age: 40,
        amount: 20000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income'
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeFundedItemStatuses['income-purchase-fallback']).toBeDefined();
    expect(result.incomeFundedItemStatuses['income-purchase-fallback']!.status).toBe('fallback');
  });

  it('marks purchase as shortfall when income and fallback accounts are exhausted', () => {
    const scenario = {
      ...defaultScenario,
      options: { ...defaultScenario.options, dateOfBirth: 'invalid-date' },
      profile: { currentAge: 40, retirementAge: 41, retirementYears: 1 },
      contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
      manualReturns: { ...defaultScenario.manualReturns, preRetirementEquityReturn: 0, postRetirementEquityReturn: 0, fixedIncomeReturn: 0 },
      savingsTracker: { annualInterestRates: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 } },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          takeHomePay: { amount: 100, period: 'monthly' }
        }]
      },
      incomeFallbackAccountId: null,
      incomeFallbackAccountId2: null,
      largePurchases: [{
        id: 'income-purchase-shortfall',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: '2000-01',
        age: 40,
        amount: 50000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income'
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
      manualReturns: { ...defaultScenario.manualReturns, preRetirementEquityReturn: 0, postRetirementEquityReturn: 0, fixedIncomeReturn: 0 },
      savingsTracker: { annualInterestRates: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 } },
      careerPlan: {
        enabled: true,
        entries: [{
          ...defaultScenario.careerPlan.entries[0],
          startAge: 40, endAge: 41,
          takeHomePay: { amount: 60000, period: 'yearly' }
        }]
      },
      largePurchases: [{
        id: 'income-yearly-test',
        label: 'Test',
        enabled: true,
        showOnGraph: true,
        yearMonth: '2000-01',
        age: 40,
        amount: 4000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income'
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
      manualReturns: { ...defaultScenario.manualReturns, preRetirementEquityReturn: 0, postRetirementEquityReturn: 0, fixedIncomeReturn: 0 },
      savingsTracker: { annualInterestRates: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 } },
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
        yearMonth: '2000-01',
        age: 40,
        amount: 3000,
        sourceAmounts: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
        fundingSource: 'income'
      }]
    };

    const result = projectScenario(scenario);
    expect(result.incomeFundedItemStatuses['income-no-career']!.status).toBe('fallback');
  });
});
