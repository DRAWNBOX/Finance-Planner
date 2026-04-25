import { getHistoricalWindow } from '../data/historicalReturns';
import type { CashflowItem, HistoricalYear, ProjectionResult, ProjectionYear, Scenario } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const toRate = (value: number) => value / 100;

const getCashflowAmountForAge = (item: CashflowItem, age: number, inflationRate: number) => {
  if (!item.enabled) {
    return 0;
  }

  if (item.cadence === 'one_time' && age !== item.startAge) {
    return 0;
  }

  if (item.cadence === 'recurring' && (age < item.startAge || age > item.endAge)) {
    return 0;
  }

  const yearsFromStart = Math.max(0, age - item.startAge);
  const adjustedAmount = item.inflationAdjusted ? item.amount * Math.pow(1 + inflationRate, yearsFromStart) : item.amount;

  return item.direction === 'inflow' ? adjustedAmount : -adjustedAmount;
};

const getManualRates = (scenario: Scenario, age: number) => {
  const equityRate =
    age < scenario.profile.retirementAge
      ? toRate(scenario.manualReturns.preRetirementEquityReturn)
      : toRate(scenario.manualReturns.postRetirementEquityReturn);
  const fixedRate = toRate(scenario.manualReturns.fixedIncomeReturn);
  const inflationRate = toRate(scenario.manualReturns.inflationRate);
  const annualReturnRate =
    equityRate * (scenario.portfolio.equityAllocation / 100) +
    fixedRate * (scenario.portfolio.fixedIncomeAllocation / 100);

  return { annualReturnRate, inflationRate };
};

const getHistoricalRates = (entry: HistoricalYear, scenario: Scenario) => {
  const annualReturnRate =
    entry.equityReturn * (scenario.portfolio.equityAllocation / 100) +
    entry.fixedIncomeReturn * (scenario.portfolio.fixedIncomeAllocation / 100);

  return {
    annualReturnRate,
    inflationRate: entry.inflationRate
  };
};

export const projectScenario = (scenario: Scenario): ProjectionResult => {
  const currentAge = Math.floor(clamp(scenario.profile.currentAge, 18, 100));
  const retirementAge = Math.floor(clamp(scenario.profile.retirementAge, currentAge, 110));
  const retirementYears = Math.floor(clamp(scenario.profile.retirementYears, 1, 60));
  const endAge = retirementAge + retirementYears;
  const totalYears = endAge - currentAge + 1;
  const historicalWindow =
    scenario.returnMode === 'historical'
      ? getHistoricalWindow(totalYears, scenario.portfolio.fixedIncomeDuration)
      : [];
  const years: ProjectionYear[] = [];

  let balance = scenario.portfolio.currentAssets;
  let previousWithdrawal = 0;
  let depletedAge: number | null = null;

  for (let offset = 0; offset < totalYears; offset += 1) {
    const age = currentAge + offset;
    const historicalEntry = historicalWindow[offset];
    const rates =
      scenario.returnMode === 'historical' && historicalEntry
        ? getHistoricalRates(historicalEntry, scenario)
        : getManualRates(scenario, age);

    const contribution =
      age < retirementAge
        ? scenario.contribution.yearlyContribution *
          Math.pow(1 + toRate(scenario.contribution.yearlyIncreaseRate), age - currentAge)
        : 0;

    const extraCashflow = scenario.cashflowItems.reduce(
      (sum, item) => sum + getCashflowAmountForAge(item, age, rates.inflationRate),
      0
    );

    let withdrawal = 0;

    if (age >= retirementAge) {
      if (scenario.withdrawal.mode === 'four_percent') {
        if (previousWithdrawal === 0) {
          withdrawal = Math.max(0, (balance + contribution + extraCashflow) * 0.04);
        } else {
          withdrawal = scenario.withdrawal.inflationAdjusted
            ? previousWithdrawal * (1 + rates.inflationRate)
            : previousWithdrawal;
        }
      } else if (previousWithdrawal === 0) {
        withdrawal = scenario.withdrawal.firstYearAmount;
      } else {
        withdrawal = scenario.withdrawal.inflationAdjusted
          ? previousWithdrawal * (1 + rates.inflationRate)
          : previousWithdrawal;
      }
    }

    previousWithdrawal = withdrawal;

    const startBalance = balance;
    const preReturnBalance = balance + contribution + extraCashflow - withdrawal;
    const rawEndBalance = preReturnBalance * (1 + rates.annualReturnRate);
    const depleted = rawEndBalance <= 0;

    if (depleted && depletedAge === null) {
      depletedAge = age;
    }

    balance = Math.max(0, rawEndBalance);

    years.push({
      age,
      calendarYear: historicalEntry?.year ?? new Date().getFullYear() + offset,
      startBalance,
      contribution,
      withdrawal,
      extraCashflow,
      annualReturnRate: rates.annualReturnRate,
      inflationRate: rates.inflationRate,
      endBalance: balance,
      depleted
    });
  }

  const survivesToEnd = depletedAge === null;
  const endingBalance = years.length > 0 ? years[years.length - 1].endBalance : 0;
  const summary = survivesToEnd
    ? `Congratulations! Based on your retirement plan, you can retire at age ${retirementAge} and finish with ${formatCurrency(
        endingBalance
      )} at age ${endAge}.`
    : `Your plan runs out of money at age ${depletedAge}. Consider retiring later, saving more, or lowering withdrawals.`;

  return {
    years,
    survivesToEnd,
    depletedAge,
    endAge,
    endingBalance,
    summary,
    historicalWindowLabel:
      scenario.returnMode === 'historical' && historicalWindow.length > 0
        ? `${historicalWindow[0].year}-${historicalWindow[historicalWindow.length - 1].year}`
        : undefined
  };
};

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
