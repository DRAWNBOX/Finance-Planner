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

  it('uses 4 percent of the first retirement-year balance for the initial withdrawal', () => {
    const scenario = {
      ...defaultScenario,
      withdrawal: {
        ...defaultScenario.withdrawal,
        mode: 'four_percent' as const
      }
    };

    const result = projectScenario(scenario);
    const retirementYear = result.years.find((year) => year.age === scenario.profile.retirementAge);
    const expected = (retirementYear!.startBalance + retirementYear!.contribution + retirementYear!.extraCashflow) * 0.04;

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
        inflationAdjusted: true
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
        inflationAdjusted: false
      }
    });

    expect(result.survivesToEnd).toBe(false);
    expect(result.depletedAge).toBe(65);
  });
});
