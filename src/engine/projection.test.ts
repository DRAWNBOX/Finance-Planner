import { describe, expect, it } from 'vitest';
import { defaultScenario } from '../defaultScenario';
import { projectScenario } from './projection';

describe('projectScenario', () => {
  it('grows the portfolio with contributions before retirement', () => {
    const result = projectScenario(defaultScenario);
    const age46 = result.years.find((year) => year.age === 46);

    expect(age46).toBeDefined();
    expect(age46!.contribution).toBeGreaterThan(defaultScenario.contribution.yearlyContribution);
    expect(result.endingBalance).toBeGreaterThan(0);
  });

  it('uses 4 percent of the 401K balance for the initial retirement withdrawal', () => {
    const scenario = {
      ...defaultScenario,
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
    const retirementYear = result.years.find((year) => year.age === scenario.profile.retirementAge);
    const expected = 100000 * 0.04;

    expect(retirementYear!.withdrawal).toBeCloseTo(expected, 2);
  });

  it('inflation-adjusts specified withdrawals across retirement years', () => {
    const scenario = {
      ...defaultScenario,
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
    const age65 = result.years.find((year) => year.age === 65)!;
    const age66 = result.years.find((year) => year.age === 66)!;

    expect(age65.withdrawal).toBe(10000);
    expect(age66.withdrawal).toBeCloseTo(10300, 2);
  });

  it('includes recurring and one-time cashflows', () => {
    const scenario = {
      ...defaultScenario,
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
    const age48 = result.years.find((year) => year.age === 48)!;
    const age50 = result.years.find((year) => year.age === 50)!;

    expect(age48.extraCashflow).toBe(-10000);
    expect(age50.extraCashflow).toBe(50000);
  });

  it('estimates salary-based career savings before retirement', () => {
    const scenario = {
      ...defaultScenario,
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
            retirement401kManualStartBalance: 0
          }
        ]
      },
      lifeEvents: []
    };

    const result = projectScenario(scenario);
    const age40 = result.years.find((year) => year.age === 40)!;

    expect(age40.salary).toBe(100000);
    expect(age40.careerContribution).toBeCloseTo(12000, 6);
    expect(age40.contribution).toBeCloseTo(12000, 6);
  });

  it('applies job changes, breaks, and life-event cashflows', () => {
    const scenario = {
      ...defaultScenario,
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
    const age41 = result.years.find((year) => year.age === 41)!;
    const age42 = result.years.find((year) => year.age === 42)!;
    const age43 = result.years.find((year) => year.age === 43)!;

    expect(age41.extraCashflow).toBe(-30000);
    expect(age42.salary).toBe(150000);
    expect(age43.salary).toBe(0);
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

  it('tracks savings accounts and records per-career end balances', () => {
    const scenario = {
      ...defaultScenario,
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
            retirement401kManualStartBalance: 0
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const age42 = result.years.find((year) => year.age === 42)!;

    expect(age42.savingsBalances.emergencyFund).toBeCloseTo(3000, 6);
    expect(age42.savingsBalances.retirement401k).toBeCloseTo(3000, 6);
    expect(result.careerEndSavingsBalances['career-1'].investments).toBeCloseTo(3000, 6);
  });

  it('applies monthly account withdrawals against monthly contributions', () => {
    const scenario = {
      ...defaultScenario,
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
            retirement401kMonthlyWithdrawal: 0
          }
        ]
      }
    };

    const result = projectScenario(scenario);
    const age25 = result.years.find((year) => year.age === 25)!;

    expect(age25.savingsBalances.emergencyFund).toBeCloseTo(1600, 6);
  });

  it('compounds monthly while APY input remains annual', () => {
    const scenario = {
      ...defaultScenario,
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
    const age25 = result.years.find((year) => year.age === 25)!;
    const expected = 1000 * Math.pow(1 + 0.12 / 12, 12);

    expect(age25.savingsBalances.emergencyFund).toBeCloseTo(expected, 6);
  });
});
