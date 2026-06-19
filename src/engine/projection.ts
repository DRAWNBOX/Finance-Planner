import type {
  BankAccountDefinition,
  CareerEntry,
  CareerSourceLine,
  CashflowItem,
  LifeEvent,
  PoolDefinition,
  ProjectionResult,
  ProjectionYear,
  Scenario,
  SourceLine
} from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const toRate = (value: number) => value / 100;
const RETIREMENT_FAILURE_NET_WORTH_FLOOR = 100000;

const parseDate = (value: string) => {
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getMonthsUntilNextBirthday = (birthDate: string, referenceDate = new Date()) => {
  const parsedBirthDate = parseDate(birthDate);

  if (!parsedBirthDate) {
    return 12;
  }

  const nextBirthday = new Date(referenceDate.getFullYear(), parsedBirthDate.getMonth(), parsedBirthDate.getDate());

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
  const adjustedAmount = item.amount * Math.pow(1 + inflationRate, yearsFromStart);

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
  const adjustedAmount = event.amount * Math.pow(1 + inflationRate, yearsFromStart);

  return event.direction === 'inflow' ? adjustedAmount : -adjustedAmount;
};

const getManualRates = (scenario: Scenario, age: number, accounts: LedgerAccount[], pools: PoolDefinition[]) => {
  let totalBalance = 0;
  let weightedRate = 0;
  pools.forEach((pool) => {
    const poolBalance = getPoolAccounts(pool.id, accounts).reduce((sum, a) => sum + Math.max(0, a.balance), 0);
    if (poolBalance > 0) {
      const rate = age < scenario.profile.retirementAge
        ? toRate(pool.preRetirementReturnRate)
        : toRate(pool.postRetirementReturnRate);
      weightedRate += poolBalance * rate;
      totalBalance += poolBalance;
    }
  });
  const annualReturnRate = totalBalance > 0 ? weightedRate / totalBalance : 0;
  const inflationRate = toRate(scenario.manualReturns.inflationRate);

  return { annualReturnRate, inflationRate };
};

const getCareerContribution = (salary: number, careerSource: CareerEntry | undefined) => {
  if (!careerSource || salary <= 0) {
    return 0;
  }

  const sourceLines = careerSource.sourceLines ?? [];
  const contributionRate = sourceLines.reduce((sum, line) => sum + Math.max(0, line.contributionRate), 0);
  const savingsRate = toRate(contributionRate);

  return salary * savingsRate;
};

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

const applyAccountDeposit = (accountId: string, amount: number, accounts: LedgerAccount[]) => {
  if (amount <= 0) return;
  const account = accounts.find((a) => a.id === accountId);
  if (account) {
    account.balance += amount;
  }
};

interface LedgerAccount extends BankAccountDefinition {
  virtual: boolean;
}

const toAccountBalancesById = (accounts: LedgerAccount[]) =>
  Object.fromEntries(accounts.map((account) => [account.id, Math.max(0, account.balance)]));

const sumLedgerBalances = (accounts: LedgerAccount[]) =>
  accounts.reduce((sum, account) => sum + Math.max(0, account.balance), 0);

interface WithdrawalContext {
  age: number;
  retirementAge: number;
}

const HSA_PENALTY_FREE_AGE = 65;

const resolvePoolRule = (pool: PoolDefinition | undefined, context?: WithdrawalContext) => {
  const taxRate = pool?.taxRate ?? 0;
  const penaltyRate = pool?.penaltyRate ?? 0;
  const softRestrictionNote = pool?.softRestrictionNote ?? '';

  if (
    pool?.isHSA &&
    context &&
    context.age >= context.retirementAge &&
    context.age >= HSA_PENALTY_FREE_AGE
  ) {
    return { taxRate, penaltyRate: 0, softRestrictionNote: '' };
  }

  return { taxRate, penaltyRate, softRestrictionNote };
};

const effectiveNetFactor = (rule: { taxRate: number; penaltyRate: number }) => Math.max(0.01, 1 - Math.max(0, rule.taxRate + rule.penaltyRate) / 100);

const sortAccountsByPriority = (accounts: LedgerAccount[]) =>
  [...accounts].sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));

const getPoolAccounts = (poolId: string, accounts: LedgerAccount[]): LedgerAccount[] =>
  sortAccountsByPriority(accounts.filter((account) => account.poolId === poolId));

const buildPoolBalances = (pools: PoolDefinition[], accounts: LedgerAccount[]) => {
  const balances: Record<string, number> = {};
  pools.forEach((pool) => {
    balances[pool.id] = getPoolAccounts(pool.id, accounts).reduce((sum, account) => sum + Math.max(0, account.balance), 0);
  });

  return balances;
};

const applyMonthlyGrowth = (accounts: LedgerAccount[], pools: PoolDefinition[], age: number, retirementAge: number) => {
  accounts.forEach((account) => {
    if (account.virtual) {
      return;
    }

    const pool = pools.find((p) => p.id === account.poolId);
    const rate = age < retirementAge
      ? toRate(pool?.preRetirementReturnRate ?? 0)
      : toRate(pool?.postRetirementReturnRate ?? 0);
    const monthlyRate = rate / 12;
    account.balance = Math.max(0, account.balance * (1 + monthlyRate));
  });
};

const applyCareerAccountCaps = (accounts: LedgerAccount[], lines: CareerSourceLine[], warnings: string[]) => {
  const ruleByAccountId = new Map(
    lines
      .filter((line) => line.enabled && line.sourceType === 'account')
      .map((line) => [line.sourceId, line] as const)
  );
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  accounts.forEach((account) => {
    const rule = ruleByAccountId.get(account.id);
    const maxBalance = Math.max(0, rule?.maxBalance ?? 0);
    if (maxBalance <= 0 || account.balance <= maxBalance) {
      return;
    }

    const overflow = account.balance - maxBalance;
    const fallbackId = rule?.overflowFallbackAccountId ?? null;
    const fallback = fallbackId ? accountById.get(fallbackId) : undefined;

    if (!fallback || fallback.id === account.id) {
      const warning = `Overflow fallback missing for ${account.label}; excess above max balance was not rerouted.`;
      if (!warnings.includes(warning)) {
        warnings.push(warning);
      }
      return;
    }

    account.balance = maxBalance;
    fallback.balance += overflow;
  });
};

const applySourceContributions = (
  lines: CareerSourceLine[],
  salary: number,
  accounts: LedgerAccount[],
  pools: PoolDefinition[],
  periodFactor: number
) => {
  lines.forEach((line) => {
    if (!line.enabled || line.contributionRate <= 0) {
      return;
    }

    const amount = Math.max(0, salary * toRate(line.contributionRate) * periodFactor);
    if (amount <= 0) {
      return;
    }

    if (line.sourceType === 'account') {
      const target = accounts.find((account) => account.id === line.sourceId);
      if (target) {
        target.balance += amount;
      }
      return;
    }

    const pool = pools.find((candidate) => candidate.id === line.sourceId);
    if (!pool) {
      return;
    }

    const poolAccounts = getPoolAccounts(pool.id, accounts);
    if (poolAccounts.length === 0) {
      return;
    }

    poolAccounts[0].balance += amount;
  });
};

interface WithdrawalResult {
  netCash: number;
  grossOut: number;
  byLegacyPool: Record<string, number>;
  taxesPaid: number;
  penaltiesPaid: number;
}

const emptySavings = (): Record<string, number> => ({ emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 });

const applyNetTargetWithdrawal = (
  source: SourceLine,
  targetNetAmount: number,
  accounts: LedgerAccount[],
  pools: PoolDefinition[],
  warnings: string[],
  context?: WithdrawalContext
): WithdrawalResult => {
  let netRemaining = Math.max(0, targetNetAmount);
  const result: WithdrawalResult = {
    netCash: 0,
    grossOut: 0,
    byLegacyPool: emptySavings(),
    taxesPaid: 0,
    penaltiesPaid: 0
  };

  const drawAccounts: LedgerAccount[] =
    source.sourceType === 'account'
      ? sortAccountsByPriority(accounts.filter((account) => account.id === source.sourceId))
      : (() => {
          const pool = pools.find((candidate) => candidate.id === source.sourceId);
          return pool ? getPoolAccounts(pool.id, accounts) : [];
        })();

  drawAccounts.forEach((account) => {
    if (netRemaining <= 0) {
      return;
    }

    const pool = pools.find((p) => p.id === account.poolId);
    const rule = resolvePoolRule(pool, context);
    if (rule.softRestrictionNote.trim().length > 0) {
      const warning = `${account.label}: ${rule.softRestrictionNote}`;
      if (!warnings.includes(warning)) {
        warnings.push(warning);
      }
    }

    const netFactor = effectiveNetFactor(rule);
    const maxNetFromAccount = Math.max(0, account.balance * netFactor);
    const netTaken = Math.min(netRemaining, maxNetFromAccount);
    if (netTaken <= 0) {
      return;
    }

    const grossTaken = netTaken / netFactor;
    account.balance = Math.max(0, account.balance - grossTaken);

    result.netCash += netTaken;
    result.grossOut += grossTaken;
    netRemaining -= netTaken;

    const totalWithheld = grossTaken - netTaken;
    const combinedRate = rule.taxRate + rule.penaltyRate;
    if (combinedRate > 0 && totalWithheld > 0) {
      result.taxesPaid += totalWithheld * (rule.taxRate / combinedRate);
      result.penaltiesPaid += totalWithheld * (rule.penaltyRate / combinedRate);
    }

    const poolId = account.poolId;
    if (poolId === 'emergencyFund' || poolId === 'hsa' || poolId === 'investments' || poolId === 'retirement401k') {
      result.byLegacyPool[poolId] += grossTaken;
    }
  });

  return result;
};

const isCareerBreakActive = (scenario: Scenario, age: number) =>
  scenario.lifeEvents.some((event) => event.enabled && event.type === 'career_break' && age >= event.startAge && age <= event.endAge);

const getCareerEntryForAge = (scenario: Scenario, age: number): CareerEntry | undefined => {
  const activeEntries = scenario.careerPlan.entries.filter((entry) => entry.enabled && age >= entry.startAge && age <= entry.endAge);

  if (activeEntries.length > 0) {
    return activeEntries[activeEntries.length - 1];
  }

  return undefined;
};

const sourceLineTargetAmount = (
  line: SourceLine,
  periodFactor: number,
  accounts: LedgerAccount[],
  pools: PoolDefinition[]
) => {
  if (line.mode === 'four_percent') {
    if (line.sourceType === 'account') {
      const account = accounts.find((candidate) => candidate.id === line.sourceId);
      return account ? Math.max(0, account.balance * 0.04) * periodFactor : 0;
    }

    const pool = pools.find((candidate) => candidate.id === line.sourceId);
    if (!pool) {
      return 0;
    }

    const poolBalance = getPoolAccounts(pool.id, accounts).reduce((sum, account) => sum + Math.max(0, account.balance), 0);
    return Math.max(0, poolBalance * 0.04) * periodFactor;
  }

  return Math.max(0, line.amount) * periodFactor;
};

export const projectScenario = (scenario: Scenario): ProjectionResult => {
  const inflationEnabled = scenario.manualReturns.inflationEnabled ?? true;
  const currentAge = Math.floor(clamp(resolveCurrentAge(scenario), 18, 100));
  const retirementAge = Math.floor(clamp(scenario.profile.retirementAge, currentAge, 110));
  const retirementYears = Math.floor(clamp(scenario.profile.retirementYears, 1, 60));
  const endAge = retirementAge + retirementYears;
  const totalYears = Math.max(0, endAge - currentAge);
  const years: ProjectionYear[] = [];
  const firstPeriodMonths = getMonthsUntilNextBirthday(scenario.options.dateOfBirth);
  const projectionStartSerial = new Date().getFullYear() * 12 + new Date().getMonth();

  const pools = (scenario.netWorth.pools ?? [])
    .filter((pool) => pool.enabled)
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  const bankAccounts = scenario.netWorth.bankAccounts ?? [];
  const ledgerAccounts: LedgerAccount[] = bankAccounts.map((account) => ({
    ...account,
    virtual: false
  }));

  const warnings: string[] = [];
  const poolBalancesStart = buildPoolBalances(pools, ledgerAccounts);
  const startingNetWorthBalance = Object.values(poolBalancesStart).reduce((sum, value) => sum + value, 0);
  let balance = startingNetWorthBalance > 0 ? startingNetWorthBalance : Math.max(0, scenario.portfolio.currentAssets);

  const startingLedgerSum = sumLedgerBalances(ledgerAccounts) > 0
    ? sumLedgerBalances(ledgerAccounts)
    : Math.max(0, scenario.portfolio.currentAssets);

  years.push({
    age: currentAge,
    calendarYear: new Date().getFullYear(),
    isBaselineNow: true,
    periodMonths: 0,
    startBalance: startingLedgerSum,
    salary: 0,
    careerContribution: 0,
    contribution: 0,
    careerLabel: 'Now',
    withdrawal: 0,
    taxesPaid: 0,
    penaltiesPaid: 0,
    extraCashflow: 0,
    lifeEventCashflow: 0,
    annualReturnRate: 0,
    inflationRate: 0,
    endBalance: startingLedgerSum,
    depleted: false,
    careerId: null,
    savingsBalances: poolBalancesStart,
    accountBalancesById: toAccountBalancesById(ledgerAccounts)
  });

  const careerEndSavingsBalances: Record<string, Record<string, number>> = {};
  const purchaseFundingShortfalls: Record<string, number> = {};
  const purchaseFirstAffordableAge: Record<string, number | null> = {};
  const purchasePostPurchaseDisplayBalances: Record<string, Record<string, number> | null> = {};
  const longTermPurchaseFundingShortfalls: Record<string, number> = {};
  const loanFundingShortfalls: Record<string, number> = {};
  const incomeFundedItemStatuses: Record<string, { status: 'covered' | 'fallback' | 'shortfall'; shortfallAmount?: number; fallbackDetails?: { accountId: string; amount: number }[]; firstFallbackYearMonth?: string }> = {};
  const incomeUsageByMonth: Record<string, { availableIncome: number; items: { id: string; label: string; amount: number }[] }> = {};
  const loanBalances: Record<string, number> = Object.fromEntries((scenario.loans ?? []).map((loan) => [loan.id, Math.max(0, loan.currentBalance)]));
  const loanDownPaymentApplied: Record<string, boolean> = {};
  const housingLoanBalances: Record<string, number> = {};
  const housingDownPaymentApplied: Record<string, boolean> = {};
  const housingPayoffMonths: Record<string, number | null> = {};
  const housingTotalMonthlyCosts: Record<string, number> = {};
  const housingFundingShortfalls: Record<string, number> = {};
  const housingPMIDropMonth: Record<string, number | null> = {};
  let previousPlannedRetirementLines: Array<{ source: SourceLine; amount: number }> = [];
  let firstRetirementYearPlannedAccountWithdrawals = emptySavings();
  let previousRequiredRetirementMinimum = 0;
  let previousRequiredRetirementMaximum = 0;
  let depletedAge: number | null = null;
  let monthsElapsed = 0;
  let previousLedgerSum = startingLedgerSum;

  const serialToYearMonth = (serial: number) => {
    const y = Math.floor(serial / 12);
    const m = (serial % 12) + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  };

  const recordIncomeUsage = (monthKey: string, monthlyIncome: number, itemId: string, label: string, amount: number) => {
    if (!incomeUsageByMonth[monthKey]) {
      incomeUsageByMonth[monthKey] = { availableIncome: monthlyIncome, items: [] };
    }
    incomeUsageByMonth[monthKey].items.push({ id: itemId, label, amount });
  };

  const processIncomeWaterfall = (
    itemId: string,
    needed: number,
    availIncome: { value: number },
    fb1: string | null | undefined,
    fb2: string | null | undefined,
    accts: LedgerAccount[],
    pls: PoolDefinition[],
    warn: string[],
    ageVal: number,
    retireAge: number
  ): { status: 'covered' | 'fallback' | 'shortfall'; covered: number; fallbackDetails: { accountId: string; amount: number }[]; taxesPaid: number; penaltiesPaid: number } => {
    let remaining = needed;
    const fallbackDetails: { accountId: string; amount: number }[] = [];
    let taxesPaid = 0;
    let penaltiesPaid = 0;

    if (availIncome.value >= remaining) {
      availIncome.value -= remaining;
      return { status: 'covered', covered: needed, fallbackDetails, taxesPaid, penaltiesPaid };
    }

    remaining -= availIncome.value;
    availIncome.value = 0;
    let status: 'covered' | 'fallback' | 'shortfall' = 'fallback';

    if (remaining > 0.001 && !fb1 && !fb2) {
      const msg = `Spending exceeds available income for "${itemId}" but no income fallback accounts are configured.`;
      if (!warn.includes(msg)) {
        warn.push(msg);
      }
    }

    if (remaining > 0.001 && fb1) {
      const source: SourceLine = { id: `${itemId}-fb1`, enabled: true, sourceType: 'account', sourceId: fb1, mode: 'amount', amount: remaining };
      const outcome = applyNetTargetWithdrawal(source, remaining, accts, pls, warn, { age: ageVal, retirementAge: retireAge });
      if (outcome.netCash > 0.001) {
        fallbackDetails.push({ accountId: fb1, amount: outcome.netCash });
      }
      taxesPaid += outcome.taxesPaid;
      penaltiesPaid += outcome.penaltiesPaid;
      remaining -= outcome.netCash;
    }

    if (remaining > 0.001 && fb2) {
      const source: SourceLine = { id: `${itemId}-fb2`, enabled: true, sourceType: 'account', sourceId: fb2, mode: 'amount', amount: remaining };
      const outcome = applyNetTargetWithdrawal(source, remaining, accts, pls, warn, { age: ageVal, retirementAge: retireAge });
      if (outcome.netCash > 0.001) {
        fallbackDetails.push({ accountId: fb2, amount: outcome.netCash });
      }
      taxesPaid += outcome.taxesPaid;
      penaltiesPaid += outcome.penaltiesPaid;
      remaining -= outcome.netCash;
    }

    if (remaining > 0.001) {
      status = 'shortfall';
    }

    return { status, covered: needed - remaining, fallbackDetails, taxesPaid, penaltiesPaid };
  };

  for (let offset = 0; offset < totalYears; offset += 1) {
    const age = currentAge + offset;
    const displayAge = age + 1;
    const periodMonths = offset === 0 ? firstPeriodMonths : 12;
    const periodStartSerial = projectionStartSerial + monthsElapsed;
    const periodEndSerial = periodStartSerial + periodMonths;
    const periodFactor = periodMonths / 12;
    const rates = getManualRates(scenario, age, ledgerAccounts, pools);
    if (rates.annualReturnRate > 0.25) {
      warnings.push(`Age ${age}: annual return rate of ${(rates.annualReturnRate * 100).toFixed(1)}% exceeds 25%. Check your manual return settings or historical data.`);
    }
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

    const careerContribution = age < retirementAge && !careerBreakActive ? getCareerContribution(salary, careerEntry ?? undefined) * periodFactor : 0;
    const careerSourceLines = (careerEntry?.sourceLines ?? []).filter((line) => line.enabled);
    let yearTaxesPaid = 0;
    let yearPenaltiesPaid = 0;
    let purchaseCashflow = 0;

    const monthlyTakeHome = careerEntry?.taxInfo
      ? Math.max(0, (careerEntry.taxInfo.leftoverIncome / 12) - (careerEntry.taxInfo.otherExpenses ?? 0))
      : 0;
    const monthlyIncomePurchases = new Set<string>();

    for (let month = 0; month < periodMonths; month += 1) {
      const currentMonthSerial = periodStartSerial + month;
      const currentMonthKey = serialToYearMonth(currentMonthSerial);
      const monthAvailableIncome = { value: monthlyTakeHome };

      applySourceContributions(careerSourceLines, salary / 12, ledgerAccounts, pools, 1);

      careerSourceLines.forEach((line) => {
        if (line.monthlyWithdrawal <= 0) {
          return;
        }

        const withdrawalSource: SourceLine = {
          id: line.id,
          enabled: true,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          mode: 'amount',
          amount: line.monthlyWithdrawal
        };
        const mwOutcome = applyNetTargetWithdrawal(withdrawalSource, line.monthlyWithdrawal, ledgerAccounts, pools, warnings, {
          age,
          retirementAge
        });
        yearTaxesPaid += mwOutcome.taxesPaid;
        yearPenaltiesPaid += mwOutcome.penaltiesPaid;
      });

      applyCareerAccountCaps(ledgerAccounts, careerSourceLines, warnings);
      applyMonthlyGrowth(ledgerAccounts, pools, age, retirementAge);

      // Process income-funded large purchases for this month
      scenario.largePurchases
        .filter((p) => p.enabled && (p.fundingSource ?? 'income') === 'income')
        .forEach((purchase) => {
          const purchaseSerial = parseYearMonthToSerial(purchase.yearMonth);
          if (purchaseSerial === null || purchaseSerial !== currentMonthSerial) return;

          const needed = Math.max(0, purchase.amount);
          const incomeBefore = monthAvailableIncome.value;
          const result = processIncomeWaterfall(
            purchase.id, needed, monthAvailableIncome,
            scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
            ledgerAccounts, pools, warnings, age, retirementAge
          );
          incomeFundedItemStatuses[purchase.id] = { status: result.status, shortfallAmount: needed - result.covered, fallbackDetails: result.fallbackDetails, firstFallbackYearMonth: result.status !== 'covered' ? currentMonthKey : undefined };
          recordIncomeUsage(currentMonthKey, monthlyTakeHome, purchase.id, purchase.label, incomeBefore - monthAvailableIncome.value);
          purchaseCashflow -= result.covered;
          yearTaxesPaid += result.taxesPaid;
          yearPenaltiesPaid += result.penaltiesPaid;
          purchasePostPurchaseDisplayBalances[purchase.id] = toAccountBalancesById(ledgerAccounts);
          monthlyIncomePurchases.add(purchase.id);
          purchaseFirstAffordableAge[purchase.id] = age;
        });

      // Process income-funded long-term purchases for this month
      (scenario.longTermPurchases ?? [])
        .filter((p) => p.enabled && (p.fundingSource ?? 'income') === 'income')
        .forEach((purchase) => {
          const startSerial = parseYearMonthToSerial(purchase.startYearMonth);
          if (startSerial === null) return;
          const endExclusiveSerial =
            purchase.endMode === 'endDate'
              ? (() => {
                  const parsedEndSerial = parseYearMonthToSerial(purchase.endYearMonth);
                  return parsedEndSerial === null ? null : parsedEndSerial + 1;
                })()
              : startSerial + Math.max(1, Math.floor(purchase.durationMonths));
          if (endExclusiveSerial === null || endExclusiveSerial <= startSerial) return;
          if (currentMonthSerial < startSerial || currentMonthSerial >= endExclusiveSerial) return;

          const needed = Math.max(0, purchase.monthlyAmount);
          const incomeBefore = monthAvailableIncome.value;
          const result = processIncomeWaterfall(
            purchase.id, needed, monthAvailableIncome,
            scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
            ledgerAccounts, pools, warnings, age, retirementAge
          );
          incomeFundedItemStatuses[purchase.id] = { status: result.status, shortfallAmount: needed - result.covered, fallbackDetails: result.fallbackDetails, firstFallbackYearMonth: result.status !== 'covered' ? currentMonthKey : undefined };
          recordIncomeUsage(currentMonthKey, monthlyTakeHome, purchase.id, purchase.label, incomeBefore - monthAvailableIncome.value);
          purchaseCashflow -= result.covered;
          yearTaxesPaid += result.taxesPaid;
          yearPenaltiesPaid += result.penaltiesPaid;
          monthlyIncomePurchases.add(purchase.id);
        });

      // Process account-funded large purchases for this month
      scenario.largePurchases
        .filter((p) => p.enabled && (p.fundingSource ?? 'income') !== 'income')
        .forEach((purchase) => {
          const purchaseSerial = parseYearMonthToSerial(purchase.yearMonth);
          if (purchaseSerial === null || purchaseSerial !== currentMonthSerial) return;

          const beforeAccountBalances = toAccountBalancesById(ledgerAccounts);
          const requestedSources = (purchase.sourceLines ?? []).filter((line) => line.enabled);
          let remainingNet = Math.max(0, purchase.amount);
          let actualNet = 0;

          requestedSources.forEach((source) => {
            const target = Math.max(0, source.amount);
            const outcome = applyNetTargetWithdrawal(
              source,
              Math.min(remainingNet, target),
              ledgerAccounts,
              pools,
              warnings,
              { age, retirementAge }
            );
            actualNet += outcome.netCash;
            remainingNet -= outcome.netCash;
            yearTaxesPaid += outcome.taxesPaid;
            yearPenaltiesPaid += outcome.penaltiesPaid;
          });

          if (remainingNet > 0) {
            requestedSources.forEach((source) => {
              if (remainingNet <= 0) return;
              const outcome = applyNetTargetWithdrawal(source, remainingNet, ledgerAccounts, pools, warnings, { age, retirementAge });
              actualNet += outcome.netCash;
              remainingNet -= outcome.netCash;
              yearTaxesPaid += outcome.taxesPaid;
              yearPenaltiesPaid += outcome.penaltiesPaid;
            });
          }

          const postPurchaseAccountBalances = toAccountBalancesById(ledgerAccounts);
          if (purchase.fundingSource?.startsWith('account:')) {
            const [, accountId] = purchase.fundingSource.split(':', 2);
            if (accountId) {
              postPurchaseAccountBalances[accountId] = (beforeAccountBalances[accountId] ?? 0) - Math.max(0, purchase.amount);
            }
          }
          purchasePostPurchaseDisplayBalances[purchase.id] = postPurchaseAccountBalances;
          purchaseFundingShortfalls[purchase.id] = (purchaseFundingShortfalls[purchase.id] ?? 0) + Math.max(0, purchase.amount - actualNet);
          purchaseCashflow -= actualNet;
          monthlyIncomePurchases.add(purchase.id);
          purchaseFirstAffordableAge[purchase.id] = age;
        });
    }

    const availableIncome = { value: monthlyTakeHome * periodMonths };

    const poolBalancesAfterCareer = buildPoolBalances(pools, ledgerAccounts);
    const affordabilityCandidates = scenario.largePurchases.filter((purchase) => purchase.enabled && age >= purchase.age);

    affordabilityCandidates.forEach((purchase) => {
      if (purchaseFirstAffordableAge[purchase.id] !== undefined) {
        return;
      }

      if ((purchase.fundingSource ?? 'income') === 'income') {
        purchaseFirstAffordableAge[purchase.id] = age;
        return;
      }

      const sources = (purchase.sourceLines ?? []).filter((line) => line.enabled);
      const requested = sources.reduce((sum, line) => sum + Math.max(0, line.amount), 0);
      const available = sources.reduce((sum, line) => {
        if (line.sourceType === 'account') {
          const account = ledgerAccounts.find((candidate) => candidate.id === line.sourceId);
          return sum + (account ? account.balance : 0);
        }

        return sum + (poolBalancesAfterCareer[line.sourceId] ?? 0);
      }, 0);

      if (requested <= 0 || available >= purchase.amount) {
        purchaseFirstAffordableAge[purchase.id] = age;
      }
    });

    const purchasesAtAge = scenario.largePurchases.filter((purchase) => purchase.enabled && purchase.age === age);

    const activeHousing = (scenario.housing ?? []).filter((h) => h.enabled);
    activeHousing.forEach((housing) => {
      const startSerial = parseYearMonthToSerial(housing.startYearMonth);
      if (startSerial === null) return;

      const sellSerial = housing.sellYearMonth ? parseYearMonthToSerial(housing.sellYearMonth) : null;

      const loanAmount = Math.max(0, housing.purchasePrice - housing.downPayment);
      const totalTermMonths = Math.max(1, housing.loanTermYears * 12);
      const monthlyRate = housing.annualInterestRate / 100 / 12;
      const monthlyPI = loanAmount > 0 ? (monthlyRate > 0
        ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalTermMonths)) / (Math.pow(1 + monthlyRate, totalTermMonths) - 1)
        : loanAmount / totalTermMonths) : 0;

      if (!(housing.id in housingLoanBalances)) {
        housingLoanBalances[housing.id] = loanAmount;
      }
      if (housingPayoffMonths[housing.id] === undefined) {
        housingPayoffMonths[housing.id] = null;
      }

      const downPayment = Math.max(0, housing.downPayment);
      const startsThisPeriod = startSerial >= periodStartSerial && startSerial < periodEndSerial;
      if (!housingDownPaymentApplied[housing.id] && downPayment > 0 && startsThisPeriod) {
        const dpSource = housing.downPaymentSource ?? housing.paymentSource ?? 'income';
        if (dpSource !== 'income') {
          const [kind, id] = dpSource.split(':', 2);
          const downPaymentSrc: SourceLine = {
            id: `${housing.id}-dp`,
            enabled: true,
            sourceType: kind === 'account' ? 'account' : 'pool',
            sourceId: id,
            mode: 'amount',
            amount: downPayment
          };
          const outcome = applyNetTargetWithdrawal(downPaymentSrc, downPayment, ledgerAccounts, pools, warnings, { age, retirementAge });
          housingFundingShortfalls[housing.id] = (housingFundingShortfalls[housing.id] ?? 0) + Math.max(0, downPayment - outcome.netCash);
          purchaseCashflow -= outcome.netCash;
          yearTaxesPaid += outcome.taxesPaid;
          yearPenaltiesPaid += outcome.penaltiesPaid;
        } else {
          const incomeBefore = availableIncome.value;
          const dpResult = processIncomeWaterfall(
            `${housing.id}-dp`, downPayment, availableIncome,
            scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
            ledgerAccounts, pools, warnings, age, retirementAge
          );
          purchaseCashflow -= dpResult.covered;
          yearTaxesPaid += dpResult.taxesPaid;
          yearPenaltiesPaid += dpResult.penaltiesPaid;
          recordIncomeUsage(serialToYearMonth(startSerial), monthlyTakeHome, housing.id, housing.label, incomeBefore - availableIncome.value);
          incomeFundedItemStatuses[housing.id] = {
            status: dpResult.status,
            shortfallAmount: downPayment - dpResult.covered,
            fallbackDetails: dpResult.fallbackDetails,
            firstFallbackYearMonth: dpResult.status !== 'covered' ? serialToYearMonth(startSerial) : undefined
          };
        }
        housingDownPaymentApplied[housing.id] = true;
      }

      const activeStart = Math.max(periodStartSerial, startSerial);
      const endSerial = sellSerial ?? (housing.endYearMonth ? parseYearMonthToSerial(housing.endYearMonth) : null);
      const activeEnd = endSerial ? Math.min(periodEndSerial, endSerial + 1) : periodEndSerial;
      const activeMonths = Math.max(0, activeEnd - activeStart);
      if (activeMonths === 0) return;

      let balanceLeft = housingLoanBalances[housing.id] ?? 0;
      const paymentSource = housing.paymentSource ?? 'income';
      const monthlyExtraCosts = housing.propertyTaxYearly / 12 + housing.homeInsuranceYearly / 12 + housing.hoaMonthly + housing.maintenanceMonthly;

      let monthlyTotal = 0;
      for (let month = 0; month < activeMonths; month += 1) {
        const monthsSinceStart = activeStart + month - startSerial;
        const homeValue = housing.purchasePrice > 0 ? housing.purchasePrice * Math.pow(1 + (housing.appreciationRate / 100) / 12, monthsSinceStart) : 0;

        let pmi = 0;
        if (housing.pmiMonthly > 0 && homeValue > 0 && balanceLeft > 0.01) {
          const ltv = balanceLeft / homeValue;
          if (ltv > 0.80) {
            pmi = housing.pmiMonthly;
          } else if (housingPMIDropMonth[housing.id] === null) {
            housingPMIDropMonth[housing.id] = monthsSinceStart;
          }
        }

        const monthExtraCosts = monthlyExtraCosts + pmi;

        if (housing.housingType === 'mortgage' && balanceLeft > 0.01) {
          const withInterest = Math.max(0, balanceLeft * (1 + monthlyRate));
          const principalPayment = Math.min(monthlyPI + housing.extraMonthlyPayment, withInterest);
          const totalTarget = principalPayment + monthExtraCosts;

          if (paymentSource === 'income') {
            const incomeBefore = availableIncome.value;
            const payResult = processIncomeWaterfall(
              housing.id, totalTarget, availableIncome,
              scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
              ledgerAccounts, pools, warnings, age, retirementAge
            );
            purchaseCashflow -= payResult.covered;
            yearTaxesPaid += payResult.taxesPaid;
            yearPenaltiesPaid += payResult.penaltiesPaid;
            const existingStatus = incomeFundedItemStatuses[housing.id];
            if (!existingStatus || payResult.status === 'shortfall' || (payResult.status === 'fallback' && existingStatus.status !== 'shortfall')) {
              const wasCovered = !existingStatus || existingStatus.status === 'covered';
              incomeFundedItemStatuses[housing.id] = {
                status: payResult.status,
                shortfallAmount: totalTarget - payResult.covered,
                fallbackDetails: payResult.fallbackDetails,
                firstFallbackYearMonth: wasCovered && payResult.status !== 'covered'
                  ? serialToYearMonth(activeStart + month)
                  : existingStatus?.firstFallbackYearMonth
              };
            }
            recordIncomeUsage(serialToYearMonth(activeStart + month), monthlyTakeHome, housing.id, housing.label, incomeBefore - availableIncome.value);
            monthlyTotal = totalTarget;
          } else {
            const [kind, id] = paymentSource.split(':', 2);
            const withdrawalSrc: SourceLine = {
              id: `${housing.id}-${month}`,
              enabled: true,
              sourceType: kind === 'account' ? 'account' : 'pool',
              sourceId: id,
              mode: 'amount',
              amount: totalTarget
            };
            const outcome = applyNetTargetWithdrawal(withdrawalSrc, totalTarget, ledgerAccounts, pools, warnings, { age, retirementAge });
            const paid = Math.min(totalTarget, outcome.netCash);
            housingFundingShortfalls[housing.id] = (housingFundingShortfalls[housing.id] ?? 0) + Math.max(0, totalTarget - paid);
            purchaseCashflow -= paid;
            yearTaxesPaid += outcome.taxesPaid;
            yearPenaltiesPaid += outcome.penaltiesPaid;
            monthlyTotal = totalTarget;
          }

          balanceLeft = Math.max(0, withInterest - principalPayment);
        } else if (housing.housingType === 'rental') {
          const rentTarget = housing.monthlyRent + monthExtraCosts;
          if (rentTarget > 0) {
            if (paymentSource === 'income') {
              const incomeBefore = availableIncome.value;
              const rentResult = processIncomeWaterfall(
                housing.id, rentTarget, availableIncome,
                scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
                ledgerAccounts, pools, warnings, age, retirementAge
              );
              purchaseCashflow -= rentResult.covered;
              yearTaxesPaid += rentResult.taxesPaid;
              yearPenaltiesPaid += rentResult.penaltiesPaid;
              const existingStatus = incomeFundedItemStatuses[housing.id];
              if (!existingStatus || rentResult.status === 'shortfall' || (rentResult.status === 'fallback' && existingStatus.status !== 'shortfall')) {
                const wasCovered = !existingStatus || existingStatus.status === 'covered';
                incomeFundedItemStatuses[housing.id] = {
                  status: rentResult.status,
                  shortfallAmount: rentTarget - rentResult.covered,
                  fallbackDetails: rentResult.fallbackDetails,
                  firstFallbackYearMonth: wasCovered && rentResult.status !== 'covered'
                    ? serialToYearMonth(activeStart + month)
                    : existingStatus?.firstFallbackYearMonth
                };
              }
              recordIncomeUsage(serialToYearMonth(activeStart + month), monthlyTakeHome, housing.id, housing.label, incomeBefore - availableIncome.value);
              monthlyTotal = rentTarget;
            } else {
              const [kind, id] = paymentSource.split(':', 2);
              const rentSrc: SourceLine = {
                id: `${housing.id}-rent-${month}`,
                enabled: true,
                sourceType: kind === 'account' ? 'account' : 'pool',
                sourceId: id,
                mode: 'amount',
                amount: rentTarget
              };
              const outcome = applyNetTargetWithdrawal(rentSrc, rentTarget, ledgerAccounts, pools, warnings, { age, retirementAge });
              const paid = Math.min(rentTarget, outcome.netCash);
              housingFundingShortfalls[housing.id] = (housingFundingShortfalls[housing.id] ?? 0) + Math.max(0, rentTarget - paid);
              purchaseCashflow -= paid;
              yearTaxesPaid += outcome.taxesPaid;
              yearPenaltiesPaid += outcome.penaltiesPaid;
              monthlyTotal = rentTarget;
            }
          }
        }

        if (housing.rentalIncomeMonthly > 0 && housing.rentalIncomeAccountId) {
          applyAccountDeposit(housing.rentalIncomeAccountId, housing.rentalIncomeMonthly, ledgerAccounts);
        }

        if (housingPayoffMonths[housing.id] === null && housing.housingType === 'mortgage' && balanceLeft <= 0.01) {
          housingPayoffMonths[housing.id] = monthsSinceStart + 1;
        }

        if (sellSerial !== null && activeStart + month === sellSerial) {
          const yearsHeld = monthsSinceStart / 12;
          const salePrice = housing.purchasePrice * Math.pow(1 + housing.appreciationRate / 100, yearsHeld);
          const sellingCosts = salePrice * (housing.sellingCostsRate / 100);
          const netProceeds = Math.max(0, salePrice - sellingCosts - balanceLeft);
          if (housing.saleProceedsAccountId && netProceeds > 0) {
            applyAccountDeposit(housing.saleProceedsAccountId, netProceeds, ledgerAccounts);
          }
          balanceLeft = 0;
        }
      }

      housingLoanBalances[housing.id] = balanceLeft;
      housingTotalMonthlyCosts[housing.id] = monthlyTotal;
    });

    const activeLoans = (scenario.loans ?? []).filter((loan) => loan.enabled);
    activeLoans.forEach((loan) => {
      const startSerial = parseYearMonthToSerial(loan.startYearMonth);
      if (startSerial === null) {
        return;
      }

      const downPayment = Math.max(0, loan.downPayment ?? 0);
      const paymentSource = loan.paymentSource ?? 'income';
      const downPaymentSrc = loan.downPaymentSource ?? paymentSource;
      const startsThisPeriod = startSerial >= periodStartSerial && startSerial < periodEndSerial;
      if (!loanDownPaymentApplied[loan.id] && downPayment > 0 && startsThisPeriod) {
        if (downPaymentSrc !== 'income') {
          const [kind, id] = downPaymentSrc.split(':', 2);
          const downPaymentSource: SourceLine = {
            id: `${loan.id}-down-payment`,
            enabled: true,
            sourceType: kind === 'account' ? 'account' : 'pool',
            sourceId: id,
            mode: 'amount',
            amount: downPayment
          };
          const outcome = applyNetTargetWithdrawal(
            downPaymentSource,
            downPayment,
            ledgerAccounts,
            pools,
                        warnings,
            { age, retirementAge }
          );
          loanFundingShortfalls[loan.id] = (loanFundingShortfalls[loan.id] ?? 0) + Math.max(0, downPayment - outcome.netCash);
          purchaseCashflow -= outcome.netCash;
          yearTaxesPaid += outcome.taxesPaid;
          yearPenaltiesPaid += outcome.penaltiesPaid;
        } else {
          const incomeBefore = availableIncome.value;
          const dpResult = processIncomeWaterfall(
            `${loan.id}-down`, downPayment, availableIncome,
            scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
            ledgerAccounts, pools, warnings, age, retirementAge
          );
          if (dpResult.status !== 'covered') {
            incomeFundedItemStatuses[loan.id] = { status: dpResult.status, shortfallAmount: downPayment - dpResult.covered, fallbackDetails: dpResult.fallbackDetails, firstFallbackYearMonth: serialToYearMonth(startSerial) };
          }
          purchaseCashflow -= dpResult.covered;
          yearTaxesPaid += dpResult.taxesPaid;
          yearPenaltiesPaid += dpResult.penaltiesPaid;
          recordIncomeUsage(serialToYearMonth(startSerial), monthlyTakeHome, loan.id, loan.label, incomeBefore - availableIncome.value);
        }

        loanDownPaymentApplied[loan.id] = true;
      }

      const activeStart = Math.max(periodStartSerial, startSerial);
      const activeMonths = Math.max(0, periodEndSerial - activeStart);
      if (activeMonths === 0) {
        return;
      }

      const remainingLoanBalance = loanBalances[loan.id] ?? Math.max(0, loan.currentBalance);
      if (remainingLoanBalance <= 0.01) {
        loanBalances[loan.id] = 0;
        return;
      }

      const plannedMonthlyPayment = Math.max(0, loan.minimumMonthlyPayment + loan.extraMonthlyPayment);
      let totalPaid = 0;
      let balanceLeft = remainingLoanBalance;

      for (let month = 0; month < activeMonths; month += 1) {
        if (balanceLeft <= 0.01) {
          balanceLeft = 0;
          break;
        }

        const withInterest = Math.max(0, balanceLeft * (1 + Math.max(-0.99, loan.annualInterestRate / 100 / 12)));
        const paymentTarget = Math.min(plannedMonthlyPayment, withInterest);

        if (paymentSource === 'income') {
          const incomeBefore = availableIncome.value;
          const loanResult = processIncomeWaterfall(
            loan.id, paymentTarget, availableIncome,
            scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
            ledgerAccounts, pools, warnings, age, retirementAge
          );
          const existingStatus = incomeFundedItemStatuses[loan.id];
          if (!existingStatus || loanResult.status === 'shortfall' || (loanResult.status === 'fallback' && existingStatus.status !== 'shortfall')) {
            const wasCovered = !existingStatus || existingStatus.status === 'covered';
            incomeFundedItemStatuses[loan.id] = {
              status: loanResult.status,
              shortfallAmount: paymentTarget - loanResult.covered,
              fallbackDetails: loanResult.fallbackDetails,
              firstFallbackYearMonth: wasCovered && loanResult.status !== 'covered'
                ? serialToYearMonth(activeStart + month)
                : existingStatus?.firstFallbackYearMonth
            };
          }
          balanceLeft = Math.max(0, withInterest - paymentTarget);
          totalPaid += paymentTarget;
          purchaseCashflow -= loanResult.covered;
          yearTaxesPaid += loanResult.taxesPaid;
          yearPenaltiesPaid += loanResult.penaltiesPaid;
          recordIncomeUsage(serialToYearMonth(activeStart + month), monthlyTakeHome, loan.id, loan.label, incomeBefore - availableIncome.value);
          continue;
        }

        const [kind, id] = paymentSource.split(':', 2);
        const withdrawalSource: SourceLine = {
          id: `${loan.id}-${month}`,
          enabled: true,
          sourceType: kind === 'account' ? 'account' : 'pool',
          sourceId: id,
          mode: 'amount',
          amount: paymentTarget
        };
        const outcome = applyNetTargetWithdrawal(
          withdrawalSource,
          paymentTarget,
          ledgerAccounts,
          pools,
                    warnings,
          { age, retirementAge }
        );
        const paymentMade = Math.min(withInterest, outcome.netCash);
        loanFundingShortfalls[loan.id] = (loanFundingShortfalls[loan.id] ?? 0) + Math.max(0, paymentTarget - paymentMade);
        yearTaxesPaid += outcome.taxesPaid;
        yearPenaltiesPaid += outcome.penaltiesPaid;
        balanceLeft = Math.max(0, withInterest - paymentMade);
        totalPaid += paymentMade;
        purchaseCashflow -= paymentMade;
      }

      loanBalances[loan.id] = balanceLeft;
    });

    purchasesAtAge.forEach((purchase) => {
      if (monthlyIncomePurchases.has(purchase.id)) return;
      if ((purchase.fundingSource ?? 'income') === 'income') {
        const needed = Math.max(0, purchase.amount);
        const incomeBefore = availableIncome.value;
        const result = processIncomeWaterfall(
          purchase.id, needed, availableIncome,
          scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
          ledgerAccounts, pools, warnings, age, retirementAge
        );
        incomeFundedItemStatuses[purchase.id] = { status: result.status, shortfallAmount: needed - result.covered, fallbackDetails: result.fallbackDetails, firstFallbackYearMonth: result.status !== 'covered' ? (purchase.yearMonth || serialToYearMonth(periodStartSerial)) : undefined };
        recordIncomeUsage(purchase.yearMonth || serialToYearMonth(periodStartSerial), monthlyTakeHome, purchase.id, purchase.label, incomeBefore - availableIncome.value);
        purchaseCashflow -= result.covered;
        yearTaxesPaid += result.taxesPaid;
        yearPenaltiesPaid += result.penaltiesPaid;
        purchasePostPurchaseDisplayBalances[purchase.id] = toAccountBalancesById(ledgerAccounts);
        return;
      }

      const beforeAccountBalances = toAccountBalancesById(ledgerAccounts);
      const requestedSources = (purchase.sourceLines ?? []).filter((line) => line.enabled);
      let remainingNet = Math.max(0, purchase.amount);
      let actualNet = 0;
      let availableNet = 0;

      requestedSources.forEach((source) => {
        const target = Math.max(0, source.amount);
        availableNet += target;
        const outcome = applyNetTargetWithdrawal(
          source,
          Math.min(remainingNet, target),
          ledgerAccounts,
          pools,
          warnings,
          { age, retirementAge }
        );
        actualNet += outcome.netCash;
        remainingNet -= outcome.netCash;
        yearTaxesPaid += outcome.taxesPaid;
        yearPenaltiesPaid += outcome.penaltiesPaid;
      });

      if (remainingNet > 0) {
        requestedSources.forEach((source) => {
          if (remainingNet <= 0) {
            return;
          }

          const outcome = applyNetTargetWithdrawal(source, remainingNet, ledgerAccounts, pools, warnings, {
            age,
            retirementAge
          });
          actualNet += outcome.netCash;
          remainingNet -= outcome.netCash;
          yearTaxesPaid += outcome.taxesPaid;
          yearPenaltiesPaid += outcome.penaltiesPaid;
        });
      }

      const postPurchaseAccountBalances = toAccountBalancesById(ledgerAccounts);
      const fundingSource = purchase.fundingSource ?? 'income';
      if (fundingSource.startsWith('account:')) {
        const [, accountId] = fundingSource.split(':', 2);
        if (accountId) {
          postPurchaseAccountBalances[accountId] = (beforeAccountBalances[accountId] ?? 0) - Math.max(0, purchase.amount);
        }
      }
      purchasePostPurchaseDisplayBalances[purchase.id] = postPurchaseAccountBalances;

      purchaseFundingShortfalls[purchase.id] = (purchaseFundingShortfalls[purchase.id] ?? 0) + Math.max(0, purchase.amount - actualNet);
      purchaseCashflow -= actualNet;
    });

    const activeLongTermPurchases = scenario.longTermPurchases.filter((purchase) => purchase.enabled && !monthlyIncomePurchases.has(purchase.id));
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

      if ((purchase.fundingSource ?? 'income') === 'income') {
        const incomeBefore = availableIncome.value;
        const result = processIncomeWaterfall(
          purchase.id, targetAmount, availableIncome,
          scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
          ledgerAccounts, pools, warnings, age, retirementAge
        );
        incomeFundedItemStatuses[purchase.id] = { status: result.status, shortfallAmount: targetAmount - result.covered, fallbackDetails: result.fallbackDetails, firstFallbackYearMonth: result.status !== 'covered' ? (purchase.startYearMonth || serialToYearMonth(periodStartSerial)) : undefined };
        purchaseCashflow -= result.covered;
        yearTaxesPaid += result.taxesPaid;
        yearPenaltiesPaid += result.penaltiesPaid;
        recordIncomeUsage(purchase.startYearMonth || serialToYearMonth(periodStartSerial), monthlyTakeHome, purchase.id, purchase.label, incomeBefore - availableIncome.value);
        return;
      }

      const sourceLines = (purchase.sourceLines ?? []).filter((line) => line.enabled);
      let remaining = targetAmount;
      let actualNet = 0;

      sourceLines.forEach((line) => {
        if (remaining <= 0) {
          return;
        }

        const perLineTarget = Math.max(0, line.amount) * activeMonths;
        const outcome = applyNetTargetWithdrawal(
          line,
          Math.min(remaining, perLineTarget),
          ledgerAccounts,
          pools,
                    warnings,
          { age, retirementAge }
        );
        actualNet += outcome.netCash;
        remaining -= outcome.netCash;
        yearTaxesPaid += outcome.taxesPaid;
        yearPenaltiesPaid += outcome.penaltiesPaid;
      });

      if (remaining > 0) {
        sourceLines.forEach((line) => {
          if (remaining <= 0) {
            return;
          }

          const outcome = applyNetTargetWithdrawal(line, remaining, ledgerAccounts, pools, warnings, {
            age,
            retirementAge
          });
          actualNet += outcome.netCash;
          remaining -= outcome.netCash;
          yearTaxesPaid += outcome.taxesPaid;
          yearPenaltiesPaid += outcome.penaltiesPaid;
        });
      }

      longTermPurchaseFundingShortfalls[purchase.id] =
        (longTermPurchaseFundingShortfalls[purchase.id] ?? 0) + Math.max(0, targetAmount - actualNet);
      purchaseCashflow -= actualNet;
    });

    const contribution =
      age < retirementAge
        ? scenario.contribution.yearlyContribution * Math.pow(1 + toRate(scenario.contribution.yearlyIncreaseRate), age - currentAge) * periodFactor
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

    let withdrawal = 0;
    let requiredMinimumWithdrawalForPeriod = 0;
    let requiredMaximumWithdrawalForPeriod = Number.POSITIVE_INFINITY;

    if (age >= retirementAge) {
      const baseMinimumYearlyWithdrawal = Math.max(0, scenario.withdrawal.minimumYearlyWithdrawal ?? 0);
      const baseMaximumYearlyWithdrawal = Math.max(0, scenario.withdrawal.maximumYearlyWithdrawal ?? Number.POSITIVE_INFINITY);
      if (previousRequiredRetirementMinimum === 0) {
        requiredMinimumWithdrawalForPeriod = baseMinimumYearlyWithdrawal * periodFactor;
      } else {
        requiredMinimumWithdrawalForPeriod =
          inflationEnabled
            ? previousRequiredRetirementMinimum * Math.pow(1 + effectiveInflationRate, periodFactor)
            : previousRequiredRetirementMinimum;
      }
      if (!Number.isFinite(baseMaximumYearlyWithdrawal)) {
        requiredMaximumWithdrawalForPeriod = Number.POSITIVE_INFINITY;
      } else if (previousRequiredRetirementMaximum === 0) {
        requiredMaximumWithdrawalForPeriod = baseMaximumYearlyWithdrawal * periodFactor;
      } else {
        requiredMaximumWithdrawalForPeriod =
          inflationEnabled
            ? previousRequiredRetirementMaximum * Math.pow(1 + effectiveInflationRate, periodFactor)
            : previousRequiredRetirementMaximum;
      }

      const retirementSourceLines = (scenario.withdrawal.sourceLines ?? []).filter((line) => line.enabled);
      const uncappedPlannedLines =
        previousPlannedRetirementLines.length > 0
          ? previousPlannedRetirementLines.map((line) => ({
              source: line.source,
              sourceStartAge:
                line.source.startAge ??
                retirementSourceLines.find(
                  (candidate) =>
                    candidate.sourceType === line.source.sourceType && candidate.sourceId === line.source.sourceId
                )?.startAge,
              amount:
                inflationEnabled
                  ? line.amount * Math.pow(1 + effectiveInflationRate, periodFactor)
                  : line.amount
            }))
          : retirementSourceLines.map((line) => ({
              source: line,
              sourceStartAge: line.startAge,
              amount:
                sourceLineTargetAmount(line, periodFactor, ledgerAccounts, pools) ||
                (scenario.withdrawal.mode === 'specified' ? Math.max(0, line.amount) * periodFactor : 0)
            }));
      const plannedTotal = uncappedPlannedLines.reduce((sum, line) => sum + Math.max(0, line.amount), 0);
      const effectiveCap = Math.max(0, requiredMaximumWithdrawalForPeriod);
      const capRatio =
        Number.isFinite(effectiveCap) && plannedTotal > 0 && plannedTotal > effectiveCap
          ? effectiveCap / plannedTotal
          : 1;
      const plannedLines = uncappedPlannedLines.map((line) => ({
        ...line,
        amount: Math.max(0, line.amount * capRatio)
      }));

      let firstYearByLegacy = emptySavings();
      plannedLines.forEach((planned) => {
        if (displayAge < (planned.sourceStartAge ?? retirementAge)) {
          return;
        }
        const outcome = applyNetTargetWithdrawal(
          planned.source,
          planned.amount,
          ledgerAccounts,
          pools,
                    warnings,
          { age, retirementAge }
        );
        withdrawal += outcome.netCash;
        yearTaxesPaid += outcome.taxesPaid;
        yearPenaltiesPaid += outcome.penaltiesPaid;

        let remaining = planned.amount - outcome.netCash;
        if (remaining > 0.001 && planned.source.sourceType === 'pool') {
          const exhaustedPoolId = planned.source.sourceId;
          const orderedPools = [...pools].sort((a, b) => a.priority - b.priority);
          for (const fbPool of orderedPools) {
            if (fbPool.id === exhaustedPoolId) continue;
            const fbSource: SourceLine = {
              id: `${planned.source.id}-fb-${fbPool.id}`,
              enabled: true,
              sourceType: 'pool',
              sourceId: fbPool.id,
              mode: 'amount',
              amount: remaining
            };
            const fbOutcome = applyNetTargetWithdrawal(fbSource, remaining, ledgerAccounts, pools, warnings, { age, retirementAge });
            withdrawal += fbOutcome.netCash;
            yearTaxesPaid += fbOutcome.taxesPaid;
            yearPenaltiesPaid += fbOutcome.penaltiesPaid;
            firstYearByLegacy = {
              emergencyFund: firstYearByLegacy.emergencyFund + fbOutcome.byLegacyPool.emergencyFund,
              hsa: firstYearByLegacy.hsa + fbOutcome.byLegacyPool.hsa,
              investments: firstYearByLegacy.investments + fbOutcome.byLegacyPool.investments,
              retirement401k: firstYearByLegacy.retirement401k + fbOutcome.byLegacyPool.retirement401k
            };
            remaining -= fbOutcome.netCash;
            if (remaining <= 0.001) break;
          }
        }

        firstYearByLegacy = {
          emergencyFund: firstYearByLegacy.emergencyFund + outcome.byLegacyPool.emergencyFund,
          hsa: firstYearByLegacy.hsa + outcome.byLegacyPool.hsa,
          investments: firstYearByLegacy.investments + outcome.byLegacyPool.investments,
          retirement401k: firstYearByLegacy.retirement401k + outcome.byLegacyPool.retirement401k
        };
      });

      if (age === retirementAge) {
        firstRetirementYearPlannedAccountWithdrawals = firstYearByLegacy;
      }

      previousPlannedRetirementLines = plannedLines;
      previousRequiredRetirementMinimum = requiredMinimumWithdrawalForPeriod;
      previousRequiredRetirementMaximum = requiredMaximumWithdrawalForPeriod;
    }

    const startBalance = balance;
    const totalContribution = contribution + careerContribution;
    const preReturnBalance = balance + totalContribution + extraCashflow - withdrawal;
    const rawEndBalance = preReturnBalance * Math.pow(1 + rates.annualReturnRate, periodFactor);

    const poolTotals = buildPoolBalances(pools, ledgerAccounts);
    const netWorthAfterWithdrawals = Object.values(poolTotals).reduce((sum, value) => sum + value, 0);
    const retirementBelowFloor = age >= retirementAge && netWorthAfterWithdrawals < RETIREMENT_FAILURE_NET_WORTH_FLOOR;
    const retirementMinimumNotMet = age >= retirementAge && withdrawal < requiredMinimumWithdrawalForPeriod;
    const depleted = rawEndBalance <= 0 || retirementBelowFloor || retirementMinimumNotMet;

    if (depleted && depletedAge === null) {
      depletedAge = age;
    }

    balance = Math.max(0, rawEndBalance);

    const currentLedgerSum = sumLedgerBalances(ledgerAccounts);

    if (Math.abs(balance - currentLedgerSum) > 1 && currentLedgerSum > 0) {
      const ratio = balance / currentLedgerSum;
      if (ratio > 1.001 || ratio < 0.999) {
        warnings.push(`Age ${displayAge}: portfolio balance (${formatCurrency(balance)}) and ledger account sum (${formatCurrency(currentLedgerSum)}) diverged by ${((ratio - 1) * 100).toFixed(2)}%. This may indicate a calculation inconsistency.`);
      }
    }

    years.push({
      age: displayAge,
      calendarYear: new Date().getFullYear() + offset,
      isBaselineNow: false,
      periodMonths,
      startBalance: previousLedgerSum,
      salary,
      careerContribution,
      contribution: totalContribution,
      careerLabel: jobChange?.label ?? careerEntry?.label ?? 'No Career',
      withdrawal,
      taxesPaid: yearTaxesPaid,
      penaltiesPaid: yearPenaltiesPaid,
      extraCashflow,
      lifeEventCashflow,
      annualReturnRate: rates.annualReturnRate,
      inflationRate: effectiveInflationRate,
      endBalance: currentLedgerSum,
      depleted,
      careerId: careerEntry?.id ?? null,
      savingsBalances: poolTotals,
      accountBalancesById: toAccountBalancesById(ledgerAccounts)
    });

    if (careerEntry && age === careerEntry.endAge) {
      careerEndSavingsBalances[careerEntry.id] = poolTotals;
    }

    monthsElapsed += periodMonths;
    previousLedgerSum = currentLedgerSum;
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
    ? `Congratulations! Based on your retirement plan, you can retire at age ${retirementAge} and finish with ${formatCurrency(endingBalance)} at age ${endAge}.`
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
    loanFundingShortfalls,
    warnings,
    incomeFundedItemStatuses,
    incomeUsageByMonth,
    housingPayoffMonths,
    housingTotalMonthlyCosts,
    housingFundingShortfalls
  };
};

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
