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
const RETIREMENT_FAILURE_NET_WORTH_FLOOR = 100000;
const EMERGENCY_FUND_MAX_BALANCE = 15000;

const parseDate = (value: string) => {
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getMonthsUntilNextBirthday = (birthDate: string, referenceDate = new Date()) => {
  const parsedBirthDate = parseDate(birthDate);

  if (!parsedBirthDate) {
    return 12;
  }

  const nextBirthday = new Date(
    referenceDate.getFullYear(),
    parsedBirthDate.getMonth(),
    parsedBirthDate.getDate()
  );

  if (nextBirthday <= referenceDate) {
    nextBirthday.setFullYear(nextBirthday.getFullYear() + 1);
  }

  const millisUntilBirthday = nextBirthday.getTime() - referenceDate.getTime();
  const approxDays = millisUntilBirthday / (1000 * 60 * 60 * 24);
  const approxMonths = Math.ceil(approxDays / 30.4375);

  return clamp(approxMonths, 1, 12);
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

const PURCHASE_ACCOUNT_KEYS: Array<keyof SavingsBalances> = ['emergencyFund', 'hsa', 'investments', 'retirement401k'];
const parseYearMonthToSerial = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return year * 12 + (month - 1);
};

const getRequestedPurchaseSources = (purchase: Scenario['largePurchases'][number]): SavingsBalances => ({
  emergencyFund: Math.max(0, purchase.sourceAmounts?.emergencyFund ?? 0),
  hsa: Math.max(0, purchase.sourceAmounts?.hsa ?? 0),
  investments: Math.max(0, purchase.sourceAmounts?.investments ?? 0),
  retirement401k: Math.max(0, purchase.sourceAmounts?.retirement401k ?? 0)
});

const getSelectedPurchaseAccounts = (requested: SavingsBalances) =>
  PURCHASE_ACCOUNT_KEYS.filter((account) => requested[account] > 0);

const sumSelectedAccountBalances = (balances: SavingsBalances, selectedAccounts: Array<keyof SavingsBalances>) =>
  selectedAccounts.reduce((sum, account) => sum + Math.max(0, balances[account]), 0);

const allocatePurchaseWithdrawals = (
  targetAmount: number,
  requested: SavingsBalances,
  available: SavingsBalances
): SavingsBalances => {
  const selectedAccounts = getSelectedPurchaseAccounts(requested);
  const withdrawals = getEmptySavingsBalances();
  const normalizedTargetAmount = Math.max(0, targetAmount);

  if (normalizedTargetAmount === 0 || selectedAccounts.length === 0) {
    return withdrawals;
  }

  let remaining = normalizedTargetAmount;

  // Honor explicit source preferences first.
  selectedAccounts.forEach((account) => {
    if (remaining <= 0) {
      return;
    }

    const preferredAmount = requested[account];
    const availableAmount = Math.max(0, available[account]);
    const withdrawalAmount = Math.min(remaining, preferredAmount, availableAmount);

    withdrawals[account] = withdrawalAmount;
    remaining -= withdrawalAmount;
  });

  // If selected accounts still have capacity, use it to finish funding the purchase.
  selectedAccounts.forEach((account) => {
    if (remaining <= 0) {
      return;
    }

    const availableAmount = Math.max(0, available[account]);
    const remainingCapacity = Math.max(0, availableAmount - withdrawals[account]);

    if (remainingCapacity <= 0) {
      return;
    }

    const supplemental = Math.min(remaining, remainingCapacity);
    withdrawals[account] += supplemental;
    remaining -= supplemental;
  });

  return withdrawals;
};

const simulateLoanAmortization = (
  startingBalance: number,
  annualInterestRate: number,
  monthlyPayment: number,
  months: number
) => {
  let balance = Math.max(0, startingBalance);
  const monthlyRate = Math.max(-0.99, annualInterestRate / 100 / 12);
  const plannedMonthlyPayment = Math.max(0, monthlyPayment);
  let totalPaid = 0;

  for (let month = 0; month < months; month += 1) {
    if (balance <= 0.01) {
      balance = 0;
      break;
    }

    const withInterest = Math.max(0, balance * (1 + monthlyRate));
    const payment = Math.min(plannedMonthlyPayment, withInterest);
    balance = Math.max(0, withInterest - payment);
    totalPaid += payment;
  }

  return {
    endingBalance: balance,
    totalPaid
  };
};

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
  annualRates: SavingsBalances,
  periodMonths = 12
): SavingsBalances => {
  const monthlyContributions = {
    emergencyFund: contributions.emergencyFund / 12,
    hsa: contributions.hsa / 12,
    investments: contributions.investments / 12,
    retirement401k: contributions.retirement401k / 12
  };
  const monthlyRates = {
    emergencyFund: toRate(annualRates.emergencyFund) / 12,
    hsa: toRate(annualRates.hsa) / 12,
    investments: toRate(annualRates.investments) / 12,
    retirement401k: toRate(annualRates.retirement401k) / 12
  };
  const balances = {
    emergencyFund: Math.max(0, currentBalances.emergencyFund),
    hsa: Math.max(0, currentBalances.hsa),
    investments: Math.max(0, currentBalances.investments),
    retirement401k: Math.max(0, currentBalances.retirement401k)
  };

  for (let month = 0; month < periodMonths; month += 1) {
    const emergencyBeforeCap = Math.max(
      0,
      balances.emergencyFund + monthlyContributions.emergencyFund - withdrawals.emergencyFund
    );
    const overflowToInvestments = Math.max(0, emergencyBeforeCap - EMERGENCY_FUND_MAX_BALANCE);
    balances.emergencyFund = emergencyBeforeCap - overflowToInvestments;

    balances.hsa = Math.max(0, balances.hsa + monthlyContributions.hsa - withdrawals.hsa);
    balances.investments = Math.max(
      0,
      balances.investments + monthlyContributions.investments + overflowToInvestments - withdrawals.investments
    );
    balances.retirement401k = Math.max(
      0,
      balances.retirement401k + monthlyContributions.retirement401k - withdrawals.retirement401k
    );

    balances.emergencyFund *= 1 + monthlyRates.emergencyFund;
    balances.hsa *= 1 + monthlyRates.hsa;
    balances.investments *= 1 + monthlyRates.investments;
    balances.retirement401k *= 1 + monthlyRates.retirement401k;
  }

  return balances;
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
  const inflationEnabled = scenario.manualReturns.inflationEnabled ?? true;
  const currentAge = Math.floor(clamp(resolveCurrentAge(scenario), 18, 100));
  const retirementAge = Math.floor(clamp(scenario.profile.retirementAge, currentAge, 110));
  const retirementYears = Math.floor(clamp(scenario.profile.retirementYears, 1, 60));
  const endAge = retirementAge + retirementYears;
  const totalYears = Math.max(0, endAge - currentAge);
  const historicalWindow =
    scenario.returnMode === 'historical'
      ? getHistoricalWindow(totalYears, scenario.portfolio.fixedIncomeDuration)
      : [];
  const years: ProjectionYear[] = [];
  const firstPeriodMonths = getMonthsUntilNextBirthday(scenario.options.dateOfBirth);
  const projectionStartSerial = new Date().getFullYear() * 12 + new Date().getMonth();

  let savingsBalances = {
    emergencyFund: scenario.netWorth.accountBalances.emergencyFund,
    hsa: scenario.netWorth.accountBalances.hsa,
    investments: scenario.netWorth.accountBalances.investments,
    retirement401k: scenario.netWorth.accountBalances.retirement401k
  };
  const startingNetWorthBalance = sumSavingsBalances(savingsBalances);
  let balance =
    startingNetWorthBalance > 0 ? startingNetWorthBalance : Math.max(0, scenario.portfolio.currentAssets);
  years.push({
    age: currentAge,
    calendarYear: new Date().getFullYear(),
    isBaselineNow: true,
    periodMonths: 0,
    startBalance: balance,
    salary: 0,
    careerContribution: 0,
    contribution: 0,
    careerLabel: 'Now',
    withdrawal: 0,
    extraCashflow: 0,
    lifeEventCashflow: 0,
    annualReturnRate: 0,
    inflationRate: 0,
    endBalance: balance,
    depleted: false,
    careerId: null,
    savingsBalances: { ...savingsBalances }
  });
  const careerEndSavingsBalances: Record<string, SavingsBalances> = {};
  const purchaseFundingShortfalls: Record<string, number> = {};
  const purchaseFirstAffordableAge: Record<string, number | null> = {};
  const purchasePostPurchaseDisplayBalances: Record<string, SavingsBalances | null> = {};
  const longTermPurchaseFundingShortfalls: Record<string, number> = {};
  const loanBalances: Record<string, number> = Object.fromEntries(
    (scenario.loans ?? []).map((loan) => [loan.id, Math.max(0, loan.currentBalance)])
  );
  let previousPlannedAccountWithdrawals = getEmptySavingsBalances();
  let firstRetirementYearPlannedAccountWithdrawals = getEmptySavingsBalances();
  let previousRequiredRetirementMinimum = 0;
  let depletedAge: number | null = null;
  let monthsElapsed = 0;
  for (let offset = 0; offset < totalYears; offset += 1) {
    const age = currentAge + offset;
    const displayAge = age + 1;
    const periodMonths = offset === 0 ? firstPeriodMonths : 12;
    const periodStartSerial = projectionStartSerial + monthsElapsed;
    const periodEndSerial = periodStartSerial + periodMonths;
    const periodFactor = periodMonths / 12;
    const historicalEntry = historicalWindow[offset];
    const rates =
      scenario.returnMode === 'historical' && historicalEntry
        ? getHistoricalRates(historicalEntry, scenario)
        : getManualRates(scenario, age);
    const effectiveInflationRate = inflationEnabled ? rates.inflationRate : 0;

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
        ? getCareerContribution(salary, careerEntry ?? undefined) * periodFactor
        : 0;
    const savingsContributions = scaleSavingsBalances(getSavingsContributions(salary, careerEntry), periodFactor);
    const savingsWithdrawals = getSavingsWithdrawals(careerEntry);
    savingsBalances = projectSavingsBalancesForYear(
      savingsBalances,
      savingsContributions,
      savingsWithdrawals,
      scenario.savingsTracker.annualInterestRates,
      periodMonths
    );
    const affordabilityCandidates = scenario.largePurchases.filter((purchase) => purchase.enabled && age >= purchase.age);

    affordabilityCandidates.forEach((purchase) => {
      if (purchaseFirstAffordableAge[purchase.id] !== undefined) {
        return;
      }

      const requestedByAccount = getRequestedPurchaseSources(purchase);
      const selectedAccounts = getSelectedPurchaseAccounts(requestedByAccount);
      const selectedAvailableBalance = sumSelectedAccountBalances(savingsBalances, selectedAccounts);
      const affordable = purchase.amount <= 0 || (selectedAccounts.length > 0 && selectedAvailableBalance >= purchase.amount);

      if (affordable) {
        purchaseFirstAffordableAge[purchase.id] = age;
      }
    });

    const purchasesAtAge = scenario.largePurchases.filter((purchase) => purchase.enabled && purchase.age === age);
    let purchaseCashflow = 0;

    purchasesAtAge.forEach((purchase) => {
      const requestedByAccount = getRequestedPurchaseSources(purchase);
      const selectedAccounts = getSelectedPurchaseAccounts(requestedByAccount);
      const selectedAvailableBalance = sumSelectedAccountBalances(savingsBalances, selectedAccounts);
      const affordable = purchase.amount <= 0 || (selectedAccounts.length > 0 && selectedAvailableBalance >= purchase.amount);
      purchasePostPurchaseDisplayBalances[purchase.id] = {
        emergencyFund: savingsBalances.emergencyFund - requestedByAccount.emergencyFund,
        hsa: savingsBalances.hsa - requestedByAccount.hsa,
        investments: savingsBalances.investments - requestedByAccount.investments,
        retirement401k: savingsBalances.retirement401k - requestedByAccount.retirement401k
      };
      const actualByAccount = affordable
        ? allocatePurchaseWithdrawals(purchase.amount, requestedByAccount, savingsBalances)
        : getEmptySavingsBalances();
      const actualTotal = sumSavingsBalances(actualByAccount);
      const shortfall = Math.max(0, purchase.amount - selectedAvailableBalance);
      purchaseFundingShortfalls[purchase.id] = (purchaseFundingShortfalls[purchase.id] ?? 0) + shortfall;

      savingsBalances = {
        emergencyFund: Math.max(0, savingsBalances.emergencyFund - actualByAccount.emergencyFund),
        hsa: Math.max(0, savingsBalances.hsa - actualByAccount.hsa),
        investments: Math.max(0, savingsBalances.investments - actualByAccount.investments),
        retirement401k: Math.max(0, savingsBalances.retirement401k - actualByAccount.retirement401k)
      };
      purchaseCashflow -= actualTotal;
    });

    const activeLoans = (scenario.loans ?? []).filter((loan) => loan.enabled);
    activeLoans.forEach((loan) => {
      const startSerial = parseYearMonthToSerial(loan.startYearMonth);
      if (startSerial === null) {
        return;
      }

      const activeStart = Math.max(periodStartSerial, startSerial);
      const activeMonths = Math.max(0, periodEndSerial - activeStart);
      if (activeMonths === 0) {
        return;
      }

      const sourceAccount: keyof SavingsBalances | null =
        loan.paymentSourceAccount === 'income' ? null : loan.paymentSourceAccount;
      const remainingLoanBalance = loanBalances[loan.id] ?? Math.max(0, loan.currentBalance);
      if (remainingLoanBalance <= 0.01) {
        loanBalances[loan.id] = 0;
        return;
      }

      const plannedMonthlyPayment = Math.max(0, loan.minimumMonthlyPayment + loan.extraMonthlyPayment);
      const availableBudget =
        sourceAccount === null ? Number.POSITIVE_INFINITY : Math.max(0, savingsBalances[sourceAccount]);
      const cappedMonthlyPayment =
        activeMonths > 0 ? Math.min(plannedMonthlyPayment, availableBudget / activeMonths) : 0;
      const amortization = simulateLoanAmortization(
        remainingLoanBalance,
        loan.annualInterestRate,
        cappedMonthlyPayment,
        activeMonths
      );
      const actualPaid = amortization.totalPaid;

      if (sourceAccount !== null) {
        savingsBalances = {
          ...savingsBalances,
          [sourceAccount]: Math.max(0, savingsBalances[sourceAccount] - actualPaid)
        };
        purchaseCashflow -= actualPaid;
      }
      loanBalances[loan.id] = amortization.endingBalance;
    });

    const activeLongTermPurchases = scenario.longTermPurchases.filter((purchase) => purchase.enabled);
    activeLongTermPurchases.forEach((purchase) => {
      const startSerial = parseYearMonthToSerial(purchase.startYearMonth);
      if (startSerial === null) {
        return;
      }

      const endExclusiveSerial =
        purchase.endMode === 'endDate'
          ? (() => {
              const parsedEndSerial = parseYearMonthToSerial(purchase.endYearMonth);
              return parsedEndSerial === null ? null : parsedEndSerial + 1;
            })()
          : startSerial + Math.max(1, Math.floor(purchase.durationMonths));

      if (endExclusiveSerial === null || endExclusiveSerial <= startSerial) {
        return;
      }

      const activeStart = Math.max(periodStartSerial, startSerial);
      const activeEnd = Math.min(periodEndSerial, endExclusiveSerial);
      const activeMonths = Math.max(0, activeEnd - activeStart);
      if (activeMonths === 0) {
        return;
      }

      const targetAmount = Math.max(0, purchase.monthlyAmount) * activeMonths;
      const requestedByAccountMonthly = {
        emergencyFund: Math.max(0, purchase.sourceAmounts?.emergencyFund ?? 0),
        hsa: Math.max(0, purchase.sourceAmounts?.hsa ?? 0),
        investments: Math.max(0, purchase.sourceAmounts?.investments ?? 0),
        retirement401k: Math.max(0, purchase.sourceAmounts?.retirement401k ?? 0)
      };
      const requestedByAccount = scaleSavingsBalances(requestedByAccountMonthly, activeMonths);
      const selectedAccounts = getSelectedPurchaseAccounts(requestedByAccountMonthly);
      const selectedAvailableBalance = sumSelectedAccountBalances(savingsBalances, selectedAccounts);
      const affordable = targetAmount <= 0 || (selectedAccounts.length > 0 && selectedAvailableBalance >= targetAmount);
      const actualByAccount = affordable
        ? allocatePurchaseWithdrawals(targetAmount, requestedByAccount, savingsBalances)
        : getEmptySavingsBalances();
      const actualTotal = sumSavingsBalances(actualByAccount);
      const shortfall = Math.max(0, targetAmount - selectedAvailableBalance);
      longTermPurchaseFundingShortfalls[purchase.id] = (longTermPurchaseFundingShortfalls[purchase.id] ?? 0) + shortfall;

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
          Math.pow(1 + toRate(scenario.contribution.yearlyIncreaseRate), age - currentAge) *
          periodFactor
        : 0;

    const lifeEventCashflow = scenario.lifeEvents.reduce((sum, event) => {
      const value = getLifeEventCashflowForAge(event, age, effectiveInflationRate);
      const scaled = event.cadence === 'recurring' ? value * periodFactor : value;

      return sum + scaled;
    }, 0);
    const addOnCashflow = scenario.cashflowItems.reduce((sum, item) => {
      const value = getCashflowAmountForAge(item, age, effectiveInflationRate);
      const scaled = item.cadence === 'recurring' ? value * periodFactor : value;

      return sum + scaled;
    }, 0);
    const extraCashflow = lifeEventCashflow + addOnCashflow + purchaseCashflow;

    let plannedAccountWithdrawals = getEmptySavingsBalances();
    let requiredMinimumWithdrawalForPeriod = 0;

    if (age >= retirementAge) {
      const baseMinimumYearlyWithdrawal = Math.max(0, scenario.withdrawal.minimumYearlyWithdrawal ?? 0);
      if (previousRequiredRetirementMinimum === 0) {
        requiredMinimumWithdrawalForPeriod = baseMinimumYearlyWithdrawal * periodFactor;
      } else {
        requiredMinimumWithdrawalForPeriod =
          inflationEnabled && scenario.withdrawal.inflationAdjusted
            ? previousRequiredRetirementMinimum * Math.pow(1 + effectiveInflationRate, periodFactor)
            : previousRequiredRetirementMinimum;
      }

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
            ? Math.max(0, savingsBalances.emergencyFund * 0.04) * periodFactor
            : fallbackLegacySpecified.emergencyFund * periodFactor,
          hsa: effectiveUseFourPercent.hsa
            ? Math.max(0, savingsBalances.hsa * 0.04) * periodFactor
            : fallbackLegacySpecified.hsa * periodFactor,
          investments: effectiveUseFourPercent.investments
            ? Math.max(0, savingsBalances.investments * 0.04) * periodFactor
            : fallbackLegacySpecified.investments * periodFactor,
          retirement401k: effectiveUseFourPercent.retirement401k
            ? Math.max(0, savingsBalances.retirement401k * 0.04) * periodFactor
            : fallbackLegacySpecified.retirement401k * periodFactor
        };
      } else {
        plannedAccountWithdrawals = scenario.withdrawal.inflationAdjusted
          ? scaleSavingsBalances(previousPlannedAccountWithdrawals, Math.pow(1 + effectiveInflationRate, periodFactor))
          : previousPlannedAccountWithdrawals;
      }

      if (age === retirementAge) {
        firstRetirementYearPlannedAccountWithdrawals = plannedAccountWithdrawals;
      }
    }

    const actualAccountWithdrawals = capWithdrawalsToAvailable(plannedAccountWithdrawals, savingsBalances);
    const withdrawal = sumSavingsBalances(actualAccountWithdrawals);

    savingsBalances = {
      emergencyFund: Math.max(0, savingsBalances.emergencyFund - actualAccountWithdrawals.emergencyFund),
      hsa: Math.max(0, savingsBalances.hsa - actualAccountWithdrawals.hsa),
      investments: Math.max(0, savingsBalances.investments - actualAccountWithdrawals.investments),
      retirement401k: Math.max(0, savingsBalances.retirement401k - actualAccountWithdrawals.retirement401k)
    };

    previousPlannedAccountWithdrawals = plannedAccountWithdrawals;
    if (age >= retirementAge) {
      previousRequiredRetirementMinimum = requiredMinimumWithdrawalForPeriod;
    }

    const startBalance = balance;
    const totalContribution = contribution + careerContribution;
    const preReturnBalance = balance + totalContribution + extraCashflow - withdrawal;
    const rawEndBalance = preReturnBalance * Math.pow(1 + rates.annualReturnRate, periodFactor);
    const netWorthAfterWithdrawals = sumSavingsBalances(savingsBalances);
    const retirementBelowFloor = age >= retirementAge && netWorthAfterWithdrawals < RETIREMENT_FAILURE_NET_WORTH_FLOOR;
    const retirementMinimumNotMet = age >= retirementAge && withdrawal < requiredMinimumWithdrawalForPeriod;
    const depleted = rawEndBalance <= 0 || retirementBelowFloor || retirementMinimumNotMet;

    if (depleted && depletedAge === null) {
      depletedAge = age;
    }

    balance = Math.max(0, rawEndBalance);

    years.push({
      age: displayAge,
      calendarYear: historicalEntry?.year ?? new Date().getFullYear() + offset,
      isBaselineNow: false,
      periodMonths,
      startBalance,
      salary,
      careerContribution,
      contribution: totalContribution,
      careerLabel: jobChange?.label ?? careerEntry?.label ?? 'No Career',
      withdrawal,
      extraCashflow,
      lifeEventCashflow,
      annualReturnRate: rates.annualReturnRate,
      inflationRate: effectiveInflationRate,
      endBalance: balance,
      depleted,
      careerId: careerEntry?.id ?? null,
      savingsBalances: { ...savingsBalances }
    });

    if (careerEntry && age === careerEntry.endAge) {
      careerEndSavingsBalances[careerEntry.id] = { ...savingsBalances };
    }

    monthsElapsed += periodMonths;

  }

  scenario.largePurchases.forEach((purchase) => {
    if (purchaseFirstAffordableAge[purchase.id] === undefined) {
      purchaseFirstAffordableAge[purchase.id] = null;
    }
    if (purchasePostPurchaseDisplayBalances[purchase.id] === undefined) {
      purchasePostPurchaseDisplayBalances[purchase.id] = null;
    }
  });

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
    purchaseFundingShortfalls,
    purchaseFirstAffordableAge,
    purchasePostPurchaseDisplayBalances,
    longTermPurchaseFundingShortfalls,
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
