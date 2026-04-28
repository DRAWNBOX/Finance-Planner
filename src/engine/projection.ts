import { getHistoricalWindow } from '../data/historicalReturns';
import type {
  CashflowItem,
  CareerEntry,
  HistoricalYear,
  LifeEvent,
  ProjectionResult,
  ProjectionYear,
  SavingsBalances,
  Scenario
} from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const toRate = (value: number) => value / 100;

const parseDate = (value: string) => {
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const calculateAgeFromBirthDate = (birthDate: string, referenceDate = new Date()) => {
  const parsedBirthDate = parseDate(birthDate);

  if (!parsedBirthDate) {
    return null;
  }

  let age = referenceDate.getFullYear() - parsedBirthDate.getFullYear();
  const monthDifference = referenceDate.getMonth() - parsedBirthDate.getMonth();

  if (monthDifference < 0 || (monthDifference === 0 && referenceDate.getDate() < parsedBirthDate.getDate())) {
    age -= 1;
  }

  return Math.max(0, age);
};

export const resolveCurrentAge = (scenario: Scenario, referenceDate = new Date()) => {
  if (scenario.options.useDateBasedAge) {
    const age = calculateAgeFromBirthDate(scenario.options.dateOfBirth, referenceDate);

    if (age !== null) {
      return age;
    }
  }

  return scenario.profile.currentAge;
};

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

const getLifeEventCashflowForAge = (event: LifeEvent, age: number, inflationRate: number) => {
  if (!event.enabled || event.type === 'job_change' || event.type === 'career_break') {
    return 0;
  }

  if (event.cadence === 'one_time' && age !== event.startAge) {
    return 0;
  }

  if (event.cadence === 'recurring' && (age < event.startAge || age > event.endAge)) {
    return 0;
  }

  const yearsFromStart = Math.max(0, age - event.startAge);
  const adjustedAmount = event.inflationAdjusted ? event.amount * Math.pow(1 + inflationRate, yearsFromStart) : event.amount;

  return event.direction === 'inflow' ? adjustedAmount : -adjustedAmount;
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

const getCareerContribution = (salary: number, careerSource: CareerEntry | undefined) => {
  if (!careerSource || salary <= 0) {
    return 0;
  }

  const savingsRate = toRate(
    careerSource.emergencyFundContributionRate +
      careerSource.hsaContributionRate +
      careerSource.investmentsContributionRate +
      careerSource.retirement401kContributionRate
  );
  const employerMatchRate = toRate(careerSource.employerMatchRate);
  const bonusRate = toRate(careerSource.bonusRate);
  const bonusSavingsRate = toRate(careerSource.bonusSavingsRate);
  const bonus = salary * bonusRate;

  return salary * (savingsRate + employerMatchRate) + bonus * bonusSavingsRate;
};

const getEmptySavingsBalances = (): SavingsBalances => ({
  emergencyFund: 0,
  hsa: 0,
  investments: 0,
  retirement401k: 0
});

const sumSavingsBalances = (balances: SavingsBalances) =>
  balances.emergencyFund + balances.hsa + balances.investments + balances.retirement401k;

const scaleSavingsBalances = (balances: SavingsBalances, factor: number): SavingsBalances => ({
  emergencyFund: balances.emergencyFund * factor,
  hsa: balances.hsa * factor,
  investments: balances.investments * factor,
  retirement401k: balances.retirement401k * factor
});

const capWithdrawalsToAvailable = (requested: SavingsBalances, available: SavingsBalances): SavingsBalances => ({
  emergencyFund: Math.min(Math.max(0, requested.emergencyFund), Math.max(0, available.emergencyFund)),
  hsa: Math.min(Math.max(0, requested.hsa), Math.max(0, available.hsa)),
  investments: Math.min(Math.max(0, requested.investments), Math.max(0, available.investments)),
  retirement401k: Math.min(Math.max(0, requested.retirement401k), Math.max(0, available.retirement401k))
});

const getSavingsContributions = (salary: number, careerSource: CareerEntry | undefined): SavingsBalances => {
  if (!careerSource || salary <= 0) {
    return getEmptySavingsBalances();
  }

  return {
    emergencyFund: salary * toRate(careerSource.emergencyFundContributionRate),
    hsa: salary * toRate(careerSource.hsaContributionRate),
    investments: salary * toRate(careerSource.investmentsContributionRate),
    retirement401k: salary * toRate(careerSource.retirement401kContributionRate)
  };
};

const getSavingsWithdrawals = (careerSource: CareerEntry | undefined): SavingsBalances => {
  if (!careerSource) {
    return getEmptySavingsBalances();
  }

  return {
    emergencyFund: Math.max(0, careerSource.emergencyFundMonthlyWithdrawal ?? 0),
    hsa: Math.max(0, careerSource.hsaMonthlyWithdrawal ?? 0),
    investments: Math.max(0, careerSource.investmentsMonthlyWithdrawal ?? 0),
    retirement401k: Math.max(0, careerSource.retirement401kMonthlyWithdrawal ?? 0)
  };
};

const projectSavingsBalancesForYear = (
  currentBalances: SavingsBalances,
  contributions: SavingsBalances,
  withdrawals: SavingsBalances,
  annualRates: SavingsBalances
): SavingsBalances => {
  const simulateAccount = (startBalance: number, annualContribution: number, monthlyWithdrawal: number, annualRate: number) => {
    const monthlyContribution = annualContribution / 12;
    const monthlyRate = toRate(annualRate) / 12;
    let running = Math.max(0, startBalance);

    for (let month = 0; month < 12; month += 1) {
      running = Math.max(0, running + monthlyContribution - monthlyWithdrawal);
      running *= 1 + monthlyRate;
    }

    return running;
  };

  return {
    emergencyFund: simulateAccount(
      currentBalances.emergencyFund,
      contributions.emergencyFund,
      withdrawals.emergencyFund,
      annualRates.emergencyFund
    ),
    hsa: simulateAccount(currentBalances.hsa, contributions.hsa, withdrawals.hsa, annualRates.hsa),
    investments: simulateAccount(
      currentBalances.investments,
      contributions.investments,
      withdrawals.investments,
      annualRates.investments
    ),
    retirement401k: simulateAccount(
      currentBalances.retirement401k,
      contributions.retirement401k,
      withdrawals.retirement401k,
      annualRates.retirement401k
    )
  };
};

const isCareerBreakActive = (scenario: Scenario, age: number) =>
  scenario.lifeEvents.some((event) => event.enabled && event.type === 'career_break' && age >= event.startAge && age <= event.endAge);

const getCareerEntryForAge = (scenario: Scenario, age: number): CareerEntry | undefined => {
  const activeEntries = scenario.careerPlan.entries.filter(
    (entry) => entry.enabled && age >= entry.startAge && age <= entry.endAge
  );

  if (activeEntries.length > 0) {
    return activeEntries[activeEntries.length - 1];
  }

  return undefined;
};

export const projectScenario = (scenario: Scenario): ProjectionResult => {
  const currentAge = Math.floor(clamp(resolveCurrentAge(scenario), 18, 100));
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
  let savingsBalances = {
    emergencyFund: scenario.netWorth.accountBalances.emergencyFund,
    hsa: scenario.netWorth.accountBalances.hsa,
    investments: scenario.netWorth.accountBalances.investments,
    retirement401k: scenario.netWorth.accountBalances.retirement401k
  };
  const careerEndSavingsBalances: Record<string, SavingsBalances> = {};
  let previousPlannedAccountWithdrawals = getEmptySavingsBalances();
  let firstRetirementYearPlannedAccountWithdrawals = getEmptySavingsBalances();
  let depletedAge: number | null = null;
  for (let offset = 0; offset < totalYears; offset += 1) {
    const age = currentAge + offset;
    const historicalEntry = historicalWindow[offset];
    const rates =
      scenario.returnMode === 'historical' && historicalEntry
        ? getHistoricalRates(historicalEntry, scenario)
        : getManualRates(scenario, age);

    const careerEntry = getCareerEntryForAge(scenario, age);
    const jobChange = scenario.lifeEvents.find((event) => event.enabled && event.type === 'job_change' && age >= event.startAge && age <= event.endAge);
    const careerBreakActive = isCareerBreakActive(scenario, age);
    const salary =
      age < retirementAge && !careerBreakActive
        ? jobChange
          ? jobChange.newSalary * Math.pow(1 + toRate(jobChange.annualSalaryGrowthOverride), Math.max(0, age - jobChange.startAge))
          : careerEntry
            ? careerEntry.startingSalary * Math.pow(1 + toRate(careerEntry.annualRaiseRate), Math.max(0, age - careerEntry.startAge))
            : 0
        : 0;

    const careerContribution =
      age < retirementAge && !careerBreakActive
        ? getCareerContribution(salary, careerEntry ?? undefined)
        : 0;
    const savingsContributions = getSavingsContributions(salary, careerEntry);
    const savingsWithdrawals = getSavingsWithdrawals(careerEntry);
    savingsBalances = projectSavingsBalancesForYear(
      savingsBalances,
      savingsContributions,
      savingsWithdrawals,
      scenario.savingsTracker.annualInterestRates
    );
    const purchasesAtAge = scenario.largePurchases.filter((purchase) => purchase.enabled && purchase.age === age);
    let purchaseCashflow = 0;

    purchasesAtAge.forEach((purchase) => {
      const requestedByAccount = {
        emergencyFund: Math.max(0, purchase.sourceAmounts?.emergencyFund ?? 0),
        hsa: Math.max(0, purchase.sourceAmounts?.hsa ?? 0),
        investments: Math.max(0, purchase.sourceAmounts?.investments ?? 0),
        retirement401k: Math.max(0, purchase.sourceAmounts?.retirement401k ?? 0)
      };
      const actualByAccount = capWithdrawalsToAvailable(requestedByAccount, savingsBalances);
      const actualTotal = sumSavingsBalances(actualByAccount);

      savingsBalances = {
        emergencyFund: Math.max(0, savingsBalances.emergencyFund - actualByAccount.emergencyFund),
        hsa: Math.max(0, savingsBalances.hsa - actualByAccount.hsa),
        investments: Math.max(0, savingsBalances.investments - actualByAccount.investments),
        retirement401k: Math.max(0, savingsBalances.retirement401k - actualByAccount.retirement401k)
      };
      purchaseCashflow -= actualTotal;
    });

    const contribution =
      age < retirementAge
        ? scenario.contribution.yearlyContribution *
          Math.pow(1 + toRate(scenario.contribution.yearlyIncreaseRate), age - currentAge)
        : 0;

    const lifeEventCashflow = scenario.lifeEvents.reduce((sum, event) => sum + getLifeEventCashflowForAge(event, age, rates.inflationRate), 0);
    const addOnCashflow = scenario.cashflowItems.reduce((sum, item) => sum + getCashflowAmountForAge(item, age, rates.inflationRate), 0);
    const extraCashflow = lifeEventCashflow + addOnCashflow + purchaseCashflow;

    let plannedAccountWithdrawals = getEmptySavingsBalances();

    if (age >= retirementAge) {
      if (sumSavingsBalances(previousPlannedAccountWithdrawals) === 0) {
        const useFourPercent = scenario.withdrawal.firstYearAccountUseFourPercent ?? {
          emergencyFund: scenario.withdrawal.mode === 'four_percent',
          hsa: scenario.withdrawal.mode === 'four_percent',
          investments: scenario.withdrawal.mode === 'four_percent',
          retirement401k: scenario.withdrawal.mode === 'four_percent'
        };
        const effectiveUseFourPercent = {
          emergencyFund: scenario.withdrawal.mode === 'four_percent' || useFourPercent.emergencyFund,
          hsa: scenario.withdrawal.mode === 'four_percent' || useFourPercent.hsa,
          investments: scenario.withdrawal.mode === 'four_percent' || useFourPercent.investments,
          retirement401k: scenario.withdrawal.mode === 'four_percent' || useFourPercent.retirement401k
        };
        const configured = scenario.withdrawal.firstYearAccountWithdrawals ?? getEmptySavingsBalances();
        const configuredTotal = sumSavingsBalances(configured);
        const fallbackLegacySpecified = configuredTotal > 0
          ? configured
          : {
              emergencyFund: 0,
              hsa: 0,
              investments: 0,
              retirement401k: Math.max(0, scenario.withdrawal.firstYearAmount)
            };

        plannedAccountWithdrawals = {
          emergencyFund: effectiveUseFourPercent.emergencyFund
            ? Math.max(0, savingsBalances.emergencyFund * 0.04)
            : fallbackLegacySpecified.emergencyFund,
          hsa: effectiveUseFourPercent.hsa ? Math.max(0, savingsBalances.hsa * 0.04) : fallbackLegacySpecified.hsa,
          investments: effectiveUseFourPercent.investments
            ? Math.max(0, savingsBalances.investments * 0.04)
            : fallbackLegacySpecified.investments,
          retirement401k: effectiveUseFourPercent.retirement401k
            ? Math.max(0, savingsBalances.retirement401k * 0.04)
            : fallbackLegacySpecified.retirement401k
        };
      } else {
        plannedAccountWithdrawals = scenario.withdrawal.inflationAdjusted
          ? scaleSavingsBalances(previousPlannedAccountWithdrawals, 1 + rates.inflationRate)
          : previousPlannedAccountWithdrawals;
      }

      if (age === retirementAge) {
        firstRetirementYearPlannedAccountWithdrawals = plannedAccountWithdrawals;
      }
    }

    const actualAccountWithdrawals = capWithdrawalsToAvailable(plannedAccountWithdrawals, savingsBalances);
    const plannedWithdrawal = sumSavingsBalances(plannedAccountWithdrawals);
    const withdrawal = sumSavingsBalances(actualAccountWithdrawals);
    const retirementFundsShortfall = plannedWithdrawal > withdrawal + 0.000001;

    savingsBalances = {
      emergencyFund: Math.max(0, savingsBalances.emergencyFund - actualAccountWithdrawals.emergencyFund),
      hsa: Math.max(0, savingsBalances.hsa - actualAccountWithdrawals.hsa),
      investments: Math.max(0, savingsBalances.investments - actualAccountWithdrawals.investments),
      retirement401k: Math.max(0, savingsBalances.retirement401k - actualAccountWithdrawals.retirement401k)
    };

    previousPlannedAccountWithdrawals = plannedAccountWithdrawals;

    const startBalance = balance;
    const totalContribution = contribution + careerContribution;
    const preReturnBalance = balance + totalContribution + extraCashflow - withdrawal;
    const rawEndBalance = preReturnBalance * (1 + rates.annualReturnRate);
    const depleted = rawEndBalance <= 0 || retirementFundsShortfall;

    if (depleted && depletedAge === null) {
      depletedAge = age;
    }

    balance = Math.max(0, rawEndBalance);

    years.push({
      age,
      calendarYear: historicalEntry?.year ?? new Date().getFullYear() + offset,
      startBalance,
      salary,
      careerContribution,
      contribution: totalContribution,
      careerLabel: jobChange?.label ?? careerEntry?.label ?? 'No Career',
      withdrawal,
      extraCashflow,
      lifeEventCashflow,
      annualReturnRate: rates.annualReturnRate,
      inflationRate: rates.inflationRate,
      endBalance: balance,
      depleted,
      careerId: careerEntry?.id ?? null,
      savingsBalances: { ...savingsBalances }
    });

    if (careerEntry && age === careerEntry.endAge) {
      careerEndSavingsBalances[careerEntry.id] = { ...savingsBalances };
    }

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
    careerEndSavingsBalances,
    firstRetirementYearPlannedAccountWithdrawals,
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
