import type {
  BankAccountDefinition,
  CareerEntry,
  CareerSourceLine,
  IncomePoolUsagePeriod,
  IncomeValidationGroup,
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
  const age = calculateAgeFromBirthDate(scenario.options.dateOfBirth, referenceDate);

  if (age !== null) {
    return age;
  }

  return scenario.profile.currentAge;
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

const applyAccountDeposit = (accountId: string, amount: number, accounts: LedgerAccount[], activityRec?: Record<string, Array<{ label: string; amount: number }>>) => {
  if (amount <= 0) return;
  const account = accounts.find((a) => a.id === accountId);
  if (account) {
    account.balance += amount;
    if (activityRec) {
      if (!activityRec[accountId]) activityRec[accountId] = [];
      activityRec[accountId].push({ label: 'Deposit', amount });
    }
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
    const monthlyRate = Math.pow(1 + rate, 1 / 12) - 1;
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
  context?: WithdrawalContext,
  activityRec?: Record<string, Array<{ label: string; amount: number }>>
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

    if (activityRec) {
      if (!activityRec[account.id]) activityRec[account.id] = [];
      activityRec[account.id].push({ label: source.id, amount: -netTaken });
    }

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

const roundToBucket = (value: number, bucketSize: number) =>
  bucketSize > 0 ? Math.round(value / bucketSize) : Math.round(value);

const periodNumeric = (pool: IncomePoolUsagePeriod['pool'], periodKey: string) => {
  if (pool === 'monthly') {
    const [year, month] = periodKey.split('-').map(Number);
    return year * 12 + (month - 1);
  }
  return Number(periodKey);
};

export const describeIncomeValidationGroup = (group: IncomeValidationGroup): string => {
  const keys = group.periodKeys;
  const noun = group.pool === 'monthly' ? 'Month' : 'Year';
  const plural = group.pool === 'monthly' ? 'Months' : 'Years';
  const unit = group.pool === 'monthly' ? 'month' : 'year';
  if (keys.length === 1) {
    return `${noun} ${keys[0]}`;
  }
  const consecutive = keys.every((key, index) =>
    index === 0 || periodNumeric(group.pool, key) === periodNumeric(group.pool, keys[index - 1]) + 1
  );
  if (consecutive) {
    return `${plural} ${keys[0]} – ${keys[keys.length - 1]} (${keys.length} ${unit}s)`;
  }
  return `${plural} ${keys.join(', ')} (${keys.length} ${unit}s)`;
};

export const groupIncomeValidationPeriods = (
  periods: IncomePoolUsagePeriod[],
  bucketSize = 10
): IncomeValidationGroup[] => {
  const groups = new Map<string, IncomeValidationGroup>();

  periods.forEach((period) => {
    const itemKey = period.items
      .map((item) => `${item.id}:${roundToBucket(item.requested, bucketSize)}`)
      .sort()
      .join(',');
    const overage = Math.max(0, period.totalRequested - period.budget);
    const key = `${period.pool}|${itemKey}|${roundToBucket(overage, bucketSize)}`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        pool: period.pool,
        periodKeys: [period.periodKey],
        budget: period.budget,
        totalRequested: period.totalRequested,
        totalFromIncome: period.totalFromIncome,
        totalFromFallback: period.totalFromFallback,
        totalShortfall: period.totalShortfall,
        minOverage: overage,
        maxOverage: overage,
        exceedsIncome: period.exceedsIncome,
        hasUnmet: period.hasUnmet,
        items: period.items
      });
      return;
    }

    existing.periodKeys.push(period.periodKey);
    existing.minOverage = Math.min(existing.minOverage, overage);
    existing.maxOverage = Math.max(existing.maxOverage, overage);
    existing.exceedsIncome = existing.exceedsIncome || period.exceedsIncome;
    existing.hasUnmet = existing.hasUnmet || period.hasUnmet;
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      periodKeys: [...group.periodKeys].sort((a, b) => a.localeCompare(b))
    }))
    .sort((a, b) => `${a.pool}:${a.periodKeys[0]}`.localeCompare(`${b.pool}:${b.periodKeys[0]}`));
};

export const projectScenario = (scenario: Scenario, options: { startDate?: string } = {}): ProjectionResult => {
  const inflationEnabled = scenario.manualReturns.inflationEnabled ?? true;
  const referenceDate = options.startDate ? parseDate(options.startDate) ?? new Date() : new Date();
  const currentAge = Math.floor(clamp(resolveCurrentAge(scenario, referenceDate), 18, 100));
  const retirementAge = Math.floor(clamp(scenario.profile.retirementAge, currentAge, 110));
  const retirementYears = Math.floor(clamp(scenario.profile.retirementYears, 1, 60));
  const endAge = retirementAge + retirementYears;
  const totalYears = Math.max(0, endAge - currentAge);
  const years: ProjectionYear[] = [];
  const firstPeriodMonths = getMonthsUntilNextBirthday(scenario.options.dateOfBirth, referenceDate);
  const projectionStartSerial = referenceDate.getFullYear() * 12 + referenceDate.getMonth();

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
    calendarYear: referenceDate.getFullYear(),
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
    accountBalancesById: toAccountBalancesById(ledgerAccounts),
    creditCardBalancesById: Object.fromEntries((scenario.creditCards ?? []).filter((cc) => cc.enabled).map((cc) => [cc.id, Math.max(0, cc.currentBalance)])),
    totalCreditCardDebt: (scenario.creditCards ?? []).filter((cc) => cc.enabled).reduce((sum, cc) => sum + Math.max(0, cc.currentBalance), 0)
  });

  const careerEndSavingsBalances: Record<string, Record<string, number>> = {};
  const purchaseFundingShortfalls: Record<string, number> = {};
  const purchaseFirstAffordableAge: Record<string, number | null> = {};
  const purchasePostPurchaseDisplayBalances: Record<string, Record<string, number> | null> = {};
  const longTermPurchaseFundingShortfalls: Record<string, number> = {};
  const loanFundingShortfalls: Record<string, number> = {};
  const incomeFundedItemStatuses: Record<string, { status: 'covered' | 'fallback' | 'shortfall'; shortfallAmount?: number; fallbackDetails?: { accountId: string; amount: number }[]; firstFallbackYearMonth?: string }> = {};
  const incomeUsageByMonth: Record<string, { availableIncome: number; items: { id: string; label: string; amount: number }[] }> = {};
  const incomePoolUsage: Record<string, { pool: 'monthly' | 'yearly'; periodKey: string; budget: number; items: Array<{ id: string; label: string; requested: number; fromIncome: number; fromFallback: number; shortfall: number }> }> = {};
  const loanBalances: Record<string, number> = Object.fromEntries((scenario.loans ?? []).map((loan) => [loan.id, Math.max(0, loan.currentBalance)]));
  const loanDownPaymentApplied: Record<string, boolean> = {};
  const creditCardBalances: Record<string, number> = Object.fromEntries((scenario.creditCards ?? []).filter((cc) => cc.enabled).map((cc) => [cc.id, Math.max(0, cc.currentBalance)]));
  const creditCardFundingShortfalls: Record<string, number> = {};
  const housingLoanBalances: Record<string, number> = {};
  const housingDownPaymentApplied: Record<string, boolean> = {};
  const housingPayoffMonths: Record<string, number | null> = {};
  const housingTotalMonthlyCosts: Record<string, number> = {};
  const housingFundingShortfalls: Record<string, number> = {};
  const housingPMIDropMonth: Record<string, number | null> = {};
  const monthlySnapshots: import('../types').MonthlySnapshot[] = [];
  const monthlyWaterfall: import('../types').MonthlyWaterfallSnapshot[] = [];
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

  const recordIncomePoolUsage = (
    pool: 'monthly' | 'yearly',
    periodKey: string,
    budget: number,
    itemId: string,
    label: string,
    requested: number,
    fromIncome: number,
    fromFallback: number,
    shortfall: number
  ) => {
    const key = `${pool}:${periodKey}`;
    if (!incomePoolUsage[key]) {
      incomePoolUsage[key] = { pool, periodKey, budget, items: [] };
    }
    incomePoolUsage[key].items.push({ id: itemId, label, requested, fromIncome, fromFallback, shortfall });
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
    retireAge: number,
    activityRec?: Record<string, Array<{ label: string; amount: number }>>,
    validation?: { pool: 'monthly' | 'yearly'; periodKey: string; label: string; budget: number }
  ): { status: 'covered' | 'fallback' | 'shortfall'; covered: number; fallbackDetails: { accountId: string; amount: number }[]; taxesPaid: number; penaltiesPaid: number } => {
    let remaining = needed;
    const fallbackDetails: { accountId: string; amount: number }[] = [];
    let taxesPaid = 0;
    let penaltiesPaid = 0;
    const incomeBefore = availIncome.value;

    if (availIncome.value >= remaining) {
      availIncome.value -= remaining;
      if (validation) {
        recordIncomePoolUsage(validation.pool, validation.periodKey, validation.budget, itemId, validation.label, needed, needed, 0, 0);
      }
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
      const outcome = applyNetTargetWithdrawal(source, remaining, accts, pls, warn, { age: ageVal, retirementAge: retireAge }, activityRec);
      if (outcome.netCash > 0.001) {
        fallbackDetails.push({ accountId: fb1, amount: outcome.netCash });
      }
      taxesPaid += outcome.taxesPaid;
      penaltiesPaid += outcome.penaltiesPaid;
      remaining -= outcome.netCash;
    }

    if (remaining > 0.001 && fb2) {
      const source: SourceLine = { id: `${itemId}-fb2`, enabled: true, sourceType: 'account', sourceId: fb2, mode: 'amount', amount: remaining };
      const outcome = applyNetTargetWithdrawal(source, remaining, accts, pls, warn, { age: ageVal, retirementAge: retireAge }, activityRec);
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

    if (validation) {
      const fromIncome = Math.min(incomeBefore, needed);
      const fromFallback = fallbackDetails.reduce((sum, detail) => sum + detail.amount, 0);
      recordIncomePoolUsage(validation.pool, validation.periodKey, validation.budget, itemId, validation.label, needed, fromIncome, fromFallback, Math.max(0, remaining));
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
            ? (careerEntry.paycheckInfo?.grossSalary ?? 0) * Math.pow(1 + toRate(careerEntry.annualRaiseRate), Math.max(0, age - careerEntry.startAge))
            : 0
        : 0;

    const careerContribution = age < retirementAge && !careerBreakActive ? getCareerContribution(salary, careerEntry ?? undefined) * periodFactor : 0;
    const careerSourceLines = (careerEntry?.sourceLines ?? []).filter((line) => line.enabled);
    let yearTaxesPaid = 0;
    let yearPenaltiesPaid = 0;
    let purchaseCashflow = 0;
    let addOnCashflow = 0;
    let lifeEventCashflow = 0;
    let withdrawal = 0;
    let firstYearByLegacy = emptySavings();

    const pi = careerEntry?.paycheckInfo;
    const getYearlyRetirement = () => {
      if (!pi) return 0;
      if (pi.retirementMode === 'percentOfSalary') return salary * (pi.retirement ?? 0) / 100;
      return (pi.retirement ?? 0);
    };
    const getYearlyRetirementMatch = () => {
      if (!pi) return 0;
      if (pi.retirementMatchMode === 'percentOfRetirement') {
        const rawMatch = getYearlyRetirement() * (pi.retirementMatch ?? 0) / 100;
        const maxMatch = salary * (pi.employerMaxMatchPercent ?? 0) / 100;
        return maxMatch > 0 ? Math.min(rawMatch, maxMatch) : rawMatch;
      }
      return (pi.retirementMatch ?? 0);
    };
    const getYearlyHsaContribution = () => {
      if (!pi) return 0;
      if (pi.hsaContributionMode === 'percentOfSalary') return salary * (pi.hsaContribution ?? 0) / 100;
      return (pi.hsaContribution ?? 0);
    };
    const getYearlyHsaEmployerMatch = () => {
      if (!pi) return 0;
      if (pi.hsaEmployerMatchMode === 'percentOfHsaContribution') return getYearlyHsaContribution() * (pi.hsaEmployerMatch ?? 0) / 100;
      return (pi.hsaEmployerMatch ?? 0);
    };
    const getYearlyEmployerHsaDeposit = () => {
      if (!pi) return 0;
      if (pi.employerHsaDepositMode === 'percentOfSalary') return salary * (pi.employerHsaDeposit ?? 0) / 100;
      return (pi.employerHsaDeposit ?? 0);
    };
    const monthlyTakeHome = pi
      ? Math.max(0, (salary - pi.taxes - pi.healthBenefits - pi.otherBenefits - getYearlyRetirement() - getYearlyHsaContribution() - (pi.livingExpenses ?? 0)) / 12)
      : 0;
    const monthlyIncomePurchases = new Set<string>();

    let monthlyRetirementLines: Array<{ source: SourceLine; amount: number; sourceStartAge?: number }> = [];
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

      monthlyRetirementLines = plannedLines.map((planned) => ({
        source: planned.source,
        amount: planned.amount / periodMonths,
        sourceStartAge: planned.sourceStartAge
      }));
    }

    for (let month = 0; month < periodMonths; month += 1) {
      const currentMonthSerial = periodStartSerial + month;
      const currentMonthKey = serialToYearMonth(currentMonthSerial);
      const monthAvailableIncome = { value: monthlyTakeHome };
      const monthStartLedgerSum = sumLedgerBalances(ledgerAccounts);
      const monthAccountActivity: Record<string, Array<{ label: string; amount: number }>> = {};
      let careerSavingsDeposits = 0;
      let careerWithdrawals = 0;
      let housingCosts = 0;
      let housingIncomeCosts = 0;
      const monthWithdrawalStart = withdrawal;
      const monthTaxesStart = yearTaxesPaid;
      const monthPenaltiesStart = yearPenaltiesPaid;

      if ((getYearlyRetirement() > 0) && pi?.retirementAccountId) {
        careerSavingsDeposits += getYearlyRetirement() / 12;
        applyAccountDeposit(pi.retirementAccountId, getYearlyRetirement() / 12, ledgerAccounts, monthAccountActivity);
      }
      if ((getYearlyRetirementMatch() > 0) && pi?.retirementAccountId) {
        careerSavingsDeposits += getYearlyRetirementMatch() / 12;
        applyAccountDeposit(pi.retirementAccountId, getYearlyRetirementMatch() / 12, ledgerAccounts, monthAccountActivity);
      }
      if ((getYearlyHsaContribution() > 0) && pi?.hsaAccountId) {
        careerSavingsDeposits += getYearlyHsaContribution() / 12;
        applyAccountDeposit(pi.hsaAccountId, getYearlyHsaContribution() / 12, ledgerAccounts, monthAccountActivity);
      }
      if ((getYearlyHsaEmployerMatch() > 0) && pi?.hsaAccountId) {
        careerSavingsDeposits += getYearlyHsaEmployerMatch() / 12;
        applyAccountDeposit(pi.hsaAccountId, getYearlyHsaEmployerMatch() / 12, ledgerAccounts, monthAccountActivity);
      }
      if ((getYearlyEmployerHsaDeposit() > 0) && pi?.hsaAccountId) {
        careerSavingsDeposits += getYearlyEmployerHsaDeposit() / 12;
        applyAccountDeposit(pi.hsaAccountId, getYearlyEmployerHsaDeposit() / 12, ledgerAccounts, monthAccountActivity);
      }

      applySourceContributions(careerSourceLines, salary / 12, ledgerAccounts, pools, 1);

      const totalSourceContributions = careerSourceLines.reduce((sum, line) => {
        if (!line.enabled || line.contributionRate <= 0) return sum;
        return sum + (salary / 12) * (line.contributionRate / 100);
      }, 0);
      if (totalSourceContributions > 0) {
        careerSavingsDeposits += totalSourceContributions;
        const sourceContributionFromIncome = Math.min(monthAvailableIncome.value, totalSourceContributions);
        const sourceContributionShortfall = Math.max(0, totalSourceContributions - monthAvailableIncome.value);
        monthAvailableIncome.value = Math.max(0, monthAvailableIncome.value - totalSourceContributions);
        recordIncomePoolUsage('monthly', currentMonthKey, monthlyTakeHome, 'career-source-contributions', 'Career savings', totalSourceContributions, sourceContributionFromIncome, 0, sourceContributionShortfall);
      }

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
        }, monthAccountActivity);
        careerWithdrawals += mwOutcome.netCash;
        yearTaxesPaid += mwOutcome.taxesPaid;
        yearPenaltiesPaid += mwOutcome.penaltiesPaid;
      });

      applyCareerAccountCaps(ledgerAccounts, careerSourceLines, warnings);
      applyMonthlyGrowth(ledgerAccounts, pools, age, retirementAge);

      // Apply cashflow add-ons monthly (deposit to / withdraw from the selected account)
      (scenario.cashflowItems ?? []).forEach((item) => {
        if (!item.enabled) return;
        const startSerial = item.startYearMonth
          ? parseYearMonthToSerial(item.startYearMonth)
          : (projectionStartSerial + (item.startAge - currentAge) * 12);
        if (startSerial === null) return;
        const endSerial = item.cadence === 'recurring'
          ? (item.endYearMonth ? parseYearMonthToSerial(item.endYearMonth) : (projectionStartSerial + (item.endAge - currentAge) * 12 + 11))
          : startSerial;
        if (endSerial === null) return;
        const active = item.cadence === 'one_time'
          ? currentMonthSerial === startSerial
          : currentMonthSerial >= startSerial && currentMonthSerial <= endSerial;
        if (!active) return;

        const yearsFromStart = Math.max(0, age - item.startAge);
        const inflationFactor = Math.pow(1 + effectiveInflationRate, yearsFromStart);
        const monthlyAmount = (item.cadence === 'one_time' ? item.amount : item.amount / 12) * inflationFactor;
        if (monthlyAmount <= 0.001) return;
        addOnCashflow += item.direction === 'inflow' ? monthlyAmount : -monthlyAmount;
        const targetAccountId = item.accountId ?? 'investments-account-default';
        if (item.direction === 'inflow') {
          applyAccountDeposit(targetAccountId, monthlyAmount, ledgerAccounts, monthAccountActivity);
        } else {
          const src: SourceLine = { id: `${item.id}-${currentMonthSerial}`, enabled: true, sourceType: 'account', sourceId: targetAccountId, mode: 'amount', amount: monthlyAmount };
          const outcome = applyNetTargetWithdrawal(src, monthlyAmount, ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
          yearTaxesPaid += outcome.taxesPaid;
          yearPenaltiesPaid += outcome.penaltiesPaid;
        }
      });

      // Apply life-event income/expense monthly (excluding job_change / career_break)
      (scenario.lifeEvents ?? []).forEach((event) => {
        if (!event.enabled || event.type === 'job_change' || event.type === 'career_break') return;
        const startSerial = event.startYearMonth
          ? parseYearMonthToSerial(event.startYearMonth)
          : (projectionStartSerial + (event.startAge - currentAge) * 12);
        if (startSerial === null) return;
        const endSerial = event.cadence === 'recurring'
          ? (event.endYearMonth ? parseYearMonthToSerial(event.endYearMonth) : (projectionStartSerial + (event.endAge - currentAge) * 12 + 11))
          : startSerial;
        if (endSerial === null) return;
        const active = event.cadence === 'one_time'
          ? currentMonthSerial === startSerial
          : currentMonthSerial >= startSerial && currentMonthSerial <= endSerial;
        if (!active) return;

        const yearsFromStart = Math.max(0, age - event.startAge);
        const inflationFactor = Math.pow(1 + effectiveInflationRate, yearsFromStart);
        const monthlyAmount = (event.cadence === 'one_time' ? event.amount : event.amount / 12) * inflationFactor;
        if (monthlyAmount <= 0.001) return;
        lifeEventCashflow += event.direction === 'inflow' ? monthlyAmount : -monthlyAmount;
        const targetAccountId = event.accountId ?? 'investments-account-default';
        if (event.direction === 'inflow') {
          applyAccountDeposit(targetAccountId, monthlyAmount, ledgerAccounts, monthAccountActivity);
        } else {
          const src: SourceLine = { id: `${event.id}-${currentMonthSerial}`, enabled: true, sourceType: 'account', sourceId: targetAccountId, mode: 'amount', amount: monthlyAmount };
          const outcome = applyNetTargetWithdrawal(src, monthlyAmount, ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
          yearTaxesPaid += outcome.taxesPaid;
          yearPenaltiesPaid += outcome.penaltiesPaid;
        }
      });

      // Apply retirement withdrawals monthly
      for (const planned of monthlyRetirementLines) {
        if (planned.amount <= 0.001) continue;
        if (displayAge < (planned.sourceStartAge ?? retirementAge)) continue;
        const outcome = applyNetTargetWithdrawal(planned.source, planned.amount, ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
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
      }

      // Process credit card payments for this month
      (scenario.creditCards ?? []).filter((cc) => cc.enabled).forEach((cc) => {
        if (cc.paymentMode === 'autopay') {
          const paymentTarget = cc.fixedPaymentAmount;
          if (paymentTarget <= 0.001) return;
          if (cc.paymentSource === 'income') {
            const incomeBefore = monthAvailableIncome.value;
            const ccResult = processIncomeWaterfall(cc.id, paymentTarget, monthAvailableIncome, scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2, ledgerAccounts, pools, warnings, age, retirementAge, monthAccountActivity, { pool: 'monthly', periodKey: currentMonthKey, label: cc.label, budget: monthlyTakeHome });
            purchaseCashflow -= ccResult.covered;
            yearTaxesPaid += ccResult.taxesPaid;
            yearPenaltiesPaid += ccResult.penaltiesPaid;
            recordIncomeUsage(currentMonthKey, monthlyTakeHome, cc.id, cc.label, incomeBefore - monthAvailableIncome.value);
          } else {
            const [kind, id] = cc.paymentSource.split(':', 2);
            const withdrawalSource: SourceLine = { id: `${cc.id}-${currentMonthSerial}`, enabled: true, sourceType: kind === 'account' ? 'account' : 'pool', sourceId: id, mode: 'amount', amount: paymentTarget };
            const outcome = applyNetTargetWithdrawal(withdrawalSource, paymentTarget, ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
            creditCardFundingShortfalls[cc.id] = (creditCardFundingShortfalls[cc.id] ?? 0) + Math.max(0, paymentTarget - outcome.netCash);
            yearTaxesPaid += outcome.taxesPaid;
            yearPenaltiesPaid += outcome.penaltiesPaid;
            purchaseCashflow -= outcome.netCash;
          }
          creditCardBalances[cc.id] = 0;
          return;
        }

        let ccBalance = creditCardBalances[cc.id] ?? 0;
        const introEndSerial = cc.introEnabled && cc.introEndYearMonth ? parseYearMonthToSerial(cc.introEndYearMonth) : null;

        ccBalance += cc.monthlyCharges;
        const pastIntro = !introEndSerial || currentMonthSerial >= introEndSerial;
        if (pastIntro && cc.annualInterestRate > 0 && ccBalance > 0.01) {
          ccBalance += ccBalance * (cc.annualInterestRate / 100 / 12);
        }

        if (ccBalance <= 0.01) {
          ccBalance = 0;
          creditCardBalances[cc.id] = 0;
          return;
        }

        let paymentTarget: number;
        if (cc.paymentMode === 'payInFull') {
          paymentTarget = ccBalance;
        } else if (cc.paymentMode === 'fixed') {
          paymentTarget = Math.min(cc.fixedPaymentAmount, ccBalance);
        } else if (cc.paymentMode === 'fixedPlusLump') {
          const isLastIntroMonth = introEndSerial !== null && currentMonthSerial === introEndSerial - 1;
          paymentTarget = isLastIntroMonth ? ccBalance : Math.min(cc.fixedPaymentAmount, ccBalance);
        } else {
          paymentTarget = Math.min(ccBalance, Math.max(cc.minimumPaymentFloor, ccBalance * cc.minimumPaymentPercent / 100));
        }

        if (paymentTarget <= 0.001) {
          creditCardBalances[cc.id] = ccBalance;
          return;
        }

        const isLumpPayment = cc.paymentMode === 'fixedPlusLump' && introEndSerial !== null && currentMonthSerial === introEndSerial - 1;
        const effectiveSource = isLumpPayment ? cc.lumpSumPaymentSource : cc.paymentSource;

        if (effectiveSource === 'income') {
          const incomeBefore = monthAvailableIncome.value;
          const ccResult = processIncomeWaterfall(cc.id, paymentTarget, monthAvailableIncome, scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2, ledgerAccounts, pools, warnings, age, retirementAge, monthAccountActivity, { pool: 'monthly', periodKey: currentMonthKey, label: cc.label, budget: monthlyTakeHome });
          const existingStatus = incomeFundedItemStatuses[cc.id];
          if (!existingStatus || ccResult.status === 'shortfall' || (ccResult.status === 'fallback' && existingStatus.status !== 'shortfall')) {
            const wasCovered = !existingStatus || existingStatus.status === 'covered';
            incomeFundedItemStatuses[cc.id] = {
              status: ccResult.status,
              shortfallAmount: paymentTarget - ccResult.covered,
              fallbackDetails: ccResult.fallbackDetails,
              firstFallbackYearMonth: wasCovered && ccResult.status !== 'covered' ? currentMonthKey : existingStatus?.firstFallbackYearMonth
            };
          }
          ccBalance = Math.max(0, ccBalance - ccResult.covered);
          purchaseCashflow -= ccResult.covered;
          yearTaxesPaid += ccResult.taxesPaid;
          yearPenaltiesPaid += ccResult.penaltiesPaid;
          recordIncomeUsage(currentMonthKey, monthlyTakeHome, cc.id, cc.label, incomeBefore - monthAvailableIncome.value);
        } else {
          const [kind, id] = effectiveSource.split(':', 2);
          const withdrawalSource: SourceLine = { id: `${cc.id}-${currentMonthSerial}`, enabled: true, sourceType: kind === 'account' ? 'account' : 'pool', sourceId: id, mode: 'amount', amount: paymentTarget };
          const outcome = applyNetTargetWithdrawal(withdrawalSource, paymentTarget, ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
          const paymentMade = Math.min(ccBalance, outcome.netCash);
          creditCardFundingShortfalls[cc.id] = (creditCardFundingShortfalls[cc.id] ?? 0) + Math.max(0, paymentTarget - paymentMade);
          yearTaxesPaid += outcome.taxesPaid;
          yearPenaltiesPaid += outcome.penaltiesPaid;
          ccBalance = Math.max(0, ccBalance - paymentMade);
          purchaseCashflow -= paymentMade;
        }

        creditCardBalances[cc.id] = ccBalance;
      });

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
            ledgerAccounts, pools, warnings, age, retirementAge, monthAccountActivity,
            { pool: 'monthly', periodKey: currentMonthKey, label: purchase.label, budget: monthlyTakeHome }
          );
          incomeFundedItemStatuses[purchase.id] = { status: result.status, shortfallAmount: needed - result.covered, fallbackDetails: result.fallbackDetails, firstFallbackYearMonth: result.status !== 'covered' ? currentMonthKey : undefined };
          recordIncomeUsage(currentMonthKey, monthlyTakeHome, purchase.id, purchase.label, incomeBefore - monthAvailableIncome.value);
          purchaseCashflow -= result.covered;
          yearTaxesPaid += result.taxesPaid;
          yearPenaltiesPaid += result.penaltiesPaid;
          purchasePostPurchaseDisplayBalances[purchase.id] = toAccountBalancesById(ledgerAccounts);
          monthlyIncomePurchases.add(purchase.id);
           if (result.status === 'covered') {
             purchaseFirstAffordableAge[purchase.id] = age;
           }
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
            ledgerAccounts, pools, warnings, age, retirementAge, monthAccountActivity,
            { pool: 'monthly', periodKey: currentMonthKey, label: purchase.label, budget: monthlyTakeHome }
          );
          incomeFundedItemStatuses[purchase.id] = { status: result.status, shortfallAmount: needed - result.covered, fallbackDetails: result.fallbackDetails, firstFallbackYearMonth: result.status !== 'covered' ? currentMonthKey : undefined };
          recordIncomeUsage(currentMonthKey, monthlyTakeHome, purchase.id, purchase.label, incomeBefore - monthAvailableIncome.value);
          purchaseCashflow -= result.covered;
          yearTaxesPaid += result.taxesPaid;
          yearPenaltiesPaid += result.penaltiesPaid;
          monthlyIncomePurchases.add(purchase.id);
        });

      // Process account-funded long-term purchases for this month
      (scenario.longTermPurchases ?? [])
        .filter((p) => p.enabled && (p.fundingSource ?? 'income') !== 'income')
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
          const sourceLines = (purchase.sourceLines ?? []).filter((line) => line.enabled);
          let remaining = needed;

          sourceLines.forEach((line) => {
            if (remaining <= 0) return;
            const outcome = applyNetTargetWithdrawal({ ...line, id: purchase.id }, Math.min(remaining, line.amount), ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
            remaining -= outcome.netCash;
            yearTaxesPaid += outcome.taxesPaid;
            yearPenaltiesPaid += outcome.penaltiesPaid;
          });

          if (remaining > 0) {
            sourceLines.forEach((line) => {
              if (remaining <= 0) return;
              const outcome = applyNetTargetWithdrawal({ ...line, id: purchase.id }, remaining, ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
              remaining -= outcome.netCash;
              yearTaxesPaid += outcome.taxesPaid;
              yearPenaltiesPaid += outcome.penaltiesPaid;
            });
          }

          purchaseCashflow -= (needed - remaining);
          longTermPurchaseFundingShortfalls[purchase.id] = (longTermPurchaseFundingShortfalls[purchase.id] ?? 0) + remaining;
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
              { ...source, id: purchase.id },
              Math.min(remainingNet, target),
              ledgerAccounts,
              pools,
              warnings,
              { age, retirementAge }, monthAccountActivity
            );
            actualNet += outcome.netCash;
            remainingNet -= outcome.netCash;
            yearTaxesPaid += outcome.taxesPaid;
            yearPenaltiesPaid += outcome.penaltiesPaid;
          });

          if (remainingNet > 0) {
            requestedSources.forEach((source) => {
              if (remainingNet <= 0) return;
              const outcome = applyNetTargetWithdrawal({ ...source, id: purchase.id }, remainingNet, ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
              actualNet += outcome.netCash;
              remainingNet -= outcome.netCash;
              yearTaxesPaid += outcome.taxesPaid;
              yearPenaltiesPaid += outcome.penaltiesPaid;
            });
          }

          const postPurchaseAccountBalances = toAccountBalancesById(ledgerAccounts);
          if (purchase.fundingSource?.startsWith('account:') && requestedSources.length === 0) {
            const [, accountId] = purchase.fundingSource.split(':', 2);
            if (accountId) {
              postPurchaseAccountBalances[accountId] = (beforeAccountBalances[accountId] ?? 0) - Math.max(0, purchase.amount);
            }
          }
          purchasePostPurchaseDisplayBalances[purchase.id] = postPurchaseAccountBalances;
          purchaseFundingShortfalls[purchase.id] = (purchaseFundingShortfalls[purchase.id] ?? 0) + Math.max(0, purchase.amount - actualNet);
          purchaseCashflow -= actualNet;
          monthlyIncomePurchases.add(purchase.id);
           if (remainingNet <= 0.000001) {
             purchaseFirstAffordableAge[purchase.id] = age;
           }
        });

      // Process housing monthly payments for this month (per-group sources)
      (scenario.housing ?? []).filter((h) => h.enabled).forEach((housing) => {
        const startSerial = parseYearMonthToSerial(housing.startYearMonth);
        if (startSerial === null) return;
        const sellSerial = housing.sellYearMonth ? parseYearMonthToSerial(housing.sellYearMonth) : null;
        const endSerial = sellSerial ?? (housing.endYearMonth ? parseYearMonthToSerial(housing.endYearMonth) : null);
        if (currentMonthSerial < startSerial || (endSerial !== null && currentMonthSerial >= endSerial + 1)) return;

        const loanAmount = Math.max(0, housing.purchasePrice - housing.downPayment);
        const totalTermMonths = Math.max(1, housing.loanTermYears * 12);
        const monthlyRate = housing.annualInterestRate / 100 / 12;
        const monthlyPI = loanAmount > 0 ? (monthlyRate > 0
          ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalTermMonths)) / (Math.pow(1 + monthlyRate, totalTermMonths) - 1)
          : loanAmount / totalTermMonths) : 0;
        if (!(housing.id in housingLoanBalances)) {
          if (housing.housingType === 'mortgage' && startSerial < projectionStartSerial && loanAmount > 0) {
            let caughtUpBalance = loanAmount;
            const monthlyPayment = monthlyPI + Math.max(0, housing.extraMonthlyPayment);
            const monthsBeforeStart = projectionStartSerial - startSerial;
            for (let elapsed = 0; elapsed < monthsBeforeStart && caughtUpBalance > 0.01; elapsed += 1) {
              const withInterest = caughtUpBalance * (1 + monthlyRate);
              caughtUpBalance = Math.max(0, withInterest - Math.min(monthlyPayment, withInterest));
            }
            housingLoanBalances[housing.id] = caughtUpBalance;
          } else {
            housingLoanBalances[housing.id] = loanAmount;
          }
        }
        if (housingPayoffMonths[housing.id] === undefined) {
          housingPayoffMonths[housing.id] = null;
        }

        const downPayment = Math.max(0, housing.downPayment);
        if (!housingDownPaymentApplied[housing.id] && downPayment > 0 && currentMonthSerial === startSerial) {
          housingCosts += downPayment;
          const dpSource = housing.downPaymentSource ?? housing.paymentSource ?? 'income';
          if (dpSource === 'income') {
            const incomeBefore = monthAvailableIncome.value;
            const dpResult = processIncomeWaterfall(
              `${housing.id}-dp`, downPayment, monthAvailableIncome,
              scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
              ledgerAccounts, pools, warnings, age, retirementAge, monthAccountActivity,
              { pool: 'monthly', periodKey: currentMonthKey, label: housing.label, budget: monthlyTakeHome }
            );
            purchaseCashflow -= dpResult.covered;
            housingIncomeCosts += dpResult.covered;
            yearTaxesPaid += dpResult.taxesPaid;
            yearPenaltiesPaid += dpResult.penaltiesPaid;
            recordIncomeUsage(currentMonthKey, monthlyTakeHome, housing.id, housing.label, incomeBefore - monthAvailableIncome.value);
            incomeFundedItemStatuses[housing.id] = {
              status: dpResult.status,
              shortfallAmount: downPayment - dpResult.covered,
              fallbackDetails: dpResult.fallbackDetails,
              firstFallbackYearMonth: dpResult.status !== 'covered' ? currentMonthKey : undefined
            };
          } else {
            const [kind, id] = dpSource.split(':', 2);
            const dpSrc: SourceLine = { id: `${housing.id}-dp`, enabled: true, sourceType: kind === 'account' ? 'account' : 'pool', sourceId: id, mode: 'amount', amount: downPayment };
            const outcome = applyNetTargetWithdrawal(dpSrc, downPayment, ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
            housingFundingShortfalls[housing.id] = (housingFundingShortfalls[housing.id] ?? 0) + Math.max(0, downPayment - outcome.netCash);
            purchaseCashflow -= outcome.netCash;
            yearTaxesPaid += outcome.taxesPaid;
            yearPenaltiesPaid += outcome.penaltiesPaid;
          }
          housingDownPaymentApplied[housing.id] = true;
        }

        const monthsSinceStart = currentMonthSerial - startSerial;
        const homeValue = housing.purchasePrice > 0 ? housing.purchasePrice * Math.pow(1 + (housing.appreciationRate / 100) / 12, monthsSinceStart) : 0;
        let balanceLeft = housingLoanBalances[housing.id] ?? 0;

        let pmi = 0;
        if (housing.pmiMonthly > 0 && homeValue > 0 && balanceLeft > 0.01) {
          if (balanceLeft / homeValue > 0.80) pmi = housing.pmiMonthly;
          else if (housingPMIDropMonth[housing.id] === null) housingPMIDropMonth[housing.id] = monthsSinceStart;
        }

        const taxInsurance = housing.propertyTaxYearly / 12 + housing.homeInsuranceYearly / 12;
        const hoaMaintenance = housing.hoaMonthly + housing.maintenanceMonthly;

        const groups: Array<{ key: string; amount: number; source: string }> = [];
        if (housing.housingType === 'mortgage') {
          const principalPayment = balanceLeft > 0.01 ? Math.min(monthlyPI + housing.extraMonthlyPayment, Math.max(0, balanceLeft * (1 + monthlyRate))) : 0;
          if (principalPayment > 0.001) groups.push({ key: 'pi', amount: principalPayment, source: housing.paymentSource ?? 'income' });
        } else if (housing.monthlyRent > 0.001) {
          groups.push({ key: 'rent', amount: housing.monthlyRent, source: housing.paymentSource ?? 'income' });
        }
        if (taxInsurance > 0.001) groups.push({ key: 'tax-ins', amount: taxInsurance, source: housing.taxesInsuranceSource ?? housing.paymentSource ?? 'income' });
        if (hoaMaintenance > 0.001) groups.push({ key: 'hoa-maint', amount: hoaMaintenance, source: housing.hoaMaintenanceSource ?? housing.paymentSource ?? 'income' });
        if (pmi > 0.001) groups.push({ key: 'pmi', amount: pmi, source: housing.pmiSource ?? housing.paymentSource ?? 'income' });

        let monthlyTotal = 0;
        for (const group of groups) {
          monthlyTotal += group.amount;
          housingCosts += group.amount;
          if (group.source === 'income') {
            const incomeBefore = monthAvailableIncome.value;
            const result = processIncomeWaterfall(
              `${housing.id}-${group.key}`, group.amount, monthAvailableIncome,
              scenario.incomeFallbackAccountId, scenario.incomeFallbackAccountId2,
              ledgerAccounts, pools, warnings, age, retirementAge, monthAccountActivity,
              { pool: 'monthly', periodKey: currentMonthKey, label: housing.label, budget: monthlyTakeHome }
            );
            const existingStatus = incomeFundedItemStatuses[housing.id];
            if (!existingStatus || result.status === 'shortfall' || (result.status === 'fallback' && existingStatus.status !== 'shortfall')) {
              const wasCovered = !existingStatus || existingStatus.status === 'covered';
              incomeFundedItemStatuses[housing.id] = {
                status: result.status,
                shortfallAmount: group.amount - result.covered,
                fallbackDetails: result.fallbackDetails,
                firstFallbackYearMonth: wasCovered && result.status !== 'covered' ? currentMonthKey : existingStatus?.firstFallbackYearMonth
              };
            }
            purchaseCashflow -= result.covered;
            housingIncomeCosts += result.covered;
            yearTaxesPaid += result.taxesPaid;
            yearPenaltiesPaid += result.penaltiesPaid;
            recordIncomeUsage(currentMonthKey, monthlyTakeHome, housing.id, housing.label, incomeBefore - monthAvailableIncome.value);
          } else {
            const [kind, id] = group.source.split(':', 2);
            const src: SourceLine = { id: `${housing.id}-${group.key}-${currentMonthSerial}`, enabled: true, sourceType: kind === 'account' ? 'account' : 'pool', sourceId: id, mode: 'amount', amount: group.amount };
            const outcome = applyNetTargetWithdrawal(src, group.amount, ledgerAccounts, pools, warnings, { age, retirementAge }, monthAccountActivity);
            const paid = Math.min(group.amount, outcome.netCash);
            housingFundingShortfalls[housing.id] = (housingFundingShortfalls[housing.id] ?? 0) + Math.max(0, group.amount - paid);
            purchaseCashflow -= paid;
            yearTaxesPaid += outcome.taxesPaid;
            yearPenaltiesPaid += outcome.penaltiesPaid;
          }
        }

        if (housing.housingType === 'mortgage' && balanceLeft > 0.01) {
          const principalPayment = Math.min(monthlyPI + housing.extraMonthlyPayment, Math.max(0, balanceLeft * (1 + monthlyRate)));
          balanceLeft = Math.max(0, Math.max(0, balanceLeft * (1 + monthlyRate)) - principalPayment);
        }
        housingLoanBalances[housing.id] = balanceLeft;

        if (housing.rentalIncomeMonthly > 0 && housing.rentalIncomeAccountId) {
          applyAccountDeposit(housing.rentalIncomeAccountId, housing.rentalIncomeMonthly, ledgerAccounts, monthAccountActivity);
        }

        if (housingPayoffMonths[housing.id] === null && housing.housingType === 'mortgage' && balanceLeft <= 0.01) {
          housingPayoffMonths[housing.id] = monthsSinceStart + 1;
        }

        if (sellSerial !== null && currentMonthSerial === sellSerial) {
          const yearsHeld = monthsSinceStart / 12;
          const salePrice = housing.purchasePrice * Math.pow(1 + housing.appreciationRate / 100, yearsHeld);
          const sellingCosts = salePrice * (housing.sellingCostsRate / 100);
          const netProceeds = Math.max(0, salePrice - sellingCosts - balanceLeft);
          if (housing.saleProceedsAccountId && netProceeds > 0) {
            applyAccountDeposit(housing.saleProceedsAccountId, netProceeds, ledgerAccounts, monthAccountActivity);
          }
          balanceLeft = 0;
          housingLoanBalances[housing.id] = 0;
        }

        housingTotalMonthlyCosts[housing.id] = monthlyTotal;
      });

      const monthCalendarYear = Math.floor(currentMonthSerial / 12);
      const monthCalendarMonth = (currentMonthSerial % 12) + 1;
      const monthEndSum = sumLedgerBalances(ledgerAccounts);
      monthlySnapshots.push({
        age: displayAge,
        calendarYear: monthCalendarYear,
        calendarMonth: monthCalendarMonth,
        periodMonths: 1,
        startBalance: monthStartLedgerSum,
        salary: salary / periodMonths,
        careerContribution: careerContribution / periodMonths,
        contribution: 0,
        careerLabel: jobChange?.label ?? careerEntry?.label ?? 'No Career',
        withdrawal: withdrawal - monthWithdrawalStart,
        taxesPaid: yearTaxesPaid - monthTaxesStart,
        penaltiesPaid: yearPenaltiesPaid - monthPenaltiesStart,
        annualReturnRate: rates.annualReturnRate,
        inflationRate: effectiveInflationRate,
        endBalance: monthEndSum,
        accountBalancesById: toAccountBalancesById(ledgerAccounts),
        accountActivity: Object.keys(monthAccountActivity).length > 0 ? monthAccountActivity : undefined
      });
      const incomeUsed = Math.max(0, monthlyTakeHome - monthAvailableIncome.value);
      monthlyWaterfall.push({
        calendarYear: monthCalendarYear,
        calendarMonth: monthCalendarMonth,
        careerLabel: jobChange?.label ?? careerEntry?.label ?? 'No Career',
        takeHomeIncome: monthlyTakeHome,
        careerSavingsDeposits,
        careerWithdrawals,
        housingCosts,
        housingIncomeCosts,
        otherIncomeExpenses: Math.max(0, incomeUsed - totalSourceContributions - housingIncomeCosts),
        leftoverIncome: monthAvailableIncome.value
      });
    }
    const availableIncome = { value: monthlyTakeHome * periodMonths };
    const yearlyPeriodKey = String(Math.floor(periodStartSerial / 12));
    const yearlyBudget = monthlyTakeHome * periodMonths;

    const poolBalancesAfterCareer = buildPoolBalances(pools, ledgerAccounts);
    const purchaseIsAtOrAfterStart = (purchase: Scenario['largePurchases'][number]) => {
      const serial = parseYearMonthToSerial(purchase.yearMonth);
      return serial === null || serial >= projectionStartSerial;
    };
    const affordabilityCandidates = scenario.largePurchases.filter(
      (purchase) => purchase.enabled && age >= purchase.age && purchaseIsAtOrAfterStart(purchase)
    );

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

    const purchasesAtAge = scenario.largePurchases.filter(
      (purchase) => purchase.enabled && purchase.age === age && purchaseIsAtOrAfterStart(purchase)
    );

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
            ledgerAccounts, pools, warnings, age, retirementAge, undefined,
            { pool: 'yearly', periodKey: yearlyPeriodKey, label: loan.label, budget: yearlyBudget }
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
            ledgerAccounts, pools, warnings, age, retirementAge, undefined,
            { pool: 'yearly', periodKey: yearlyPeriodKey, label: loan.label, budget: yearlyBudget }
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
          ledgerAccounts, pools, warnings, age, retirementAge, undefined,
          { pool: 'yearly', periodKey: yearlyPeriodKey, label: purchase.label, budget: yearlyBudget }
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
      if (fundingSource.startsWith('account:') && requestedSources.length === 0) {
        const [, accountId] = fundingSource.split(':', 2);
        if (accountId) {
          postPurchaseAccountBalances[accountId] = (beforeAccountBalances[accountId] ?? 0) - Math.max(0, purchase.amount);
        }
      }
      purchasePostPurchaseDisplayBalances[purchase.id] = postPurchaseAccountBalances;

      purchaseFundingShortfalls[purchase.id] = (purchaseFundingShortfalls[purchase.id] ?? 0) + Math.max(0, purchase.amount - actualNet);
      purchaseCashflow -= actualNet;
    });

    const contribution =
      age < retirementAge
        ? scenario.contribution.yearlyContribution * Math.pow(1 + toRate(scenario.contribution.yearlyIncreaseRate), age - currentAge) * periodFactor
        : 0;

    const extraCashflow = lifeEventCashflow + addOnCashflow + purchaseCashflow;

    if (age >= retirementAge) {
      if (age === retirementAge) {
        firstRetirementYearPlannedAccountWithdrawals = firstYearByLegacy;
      }

      previousPlannedRetirementLines = monthlyRetirementLines.map((line) => ({
        source: line.source,
        amount: line.amount * periodMonths
      }));
      previousRequiredRetirementMinimum = requiredMinimumWithdrawalForPeriod;
      previousRequiredRetirementMaximum = requiredMaximumWithdrawalForPeriod;
    }

    const startBalance = balance;
    const totalContribution = contribution + careerContribution;

    const currentLedgerSum = sumLedgerBalances(ledgerAccounts);

    const poolTotals = buildPoolBalances(pools, ledgerAccounts);
    const netWorthAfterWithdrawals = Object.values(poolTotals).reduce((sum, value) => sum + value, 0);
    const retirementBelowFloor = age >= retirementAge && netWorthAfterWithdrawals < RETIREMENT_FAILURE_NET_WORTH_FLOOR;
    const retirementMinimumNotMet = age >= retirementAge && withdrawal < requiredMinimumWithdrawalForPeriod;
    const depleted = currentLedgerSum <= 0 || retirementBelowFloor || retirementMinimumNotMet;

    if (depleted && depletedAge === null) {
      depletedAge = age;
    }

    const preReturnBalance = balance + totalContribution + extraCashflow - withdrawal;
    const rawEndBalance = preReturnBalance * Math.pow(1 + rates.annualReturnRate, periodFactor);
    balance = currentLedgerSum > 0 ? currentLedgerSum : Math.max(0, rawEndBalance);

    if (Math.abs(balance - currentLedgerSum) > 1 && currentLedgerSum > 0) {
      const ratio = balance / currentLedgerSum;
      if (ratio > 1.001 || ratio < 0.999) {
        warnings.push(`Age ${displayAge}: portfolio balance (${formatCurrency(balance)}) and ledger account sum (${formatCurrency(currentLedgerSum)}) diverged by ${((ratio - 1) * 100).toFixed(2)}%. This may indicate a calculation inconsistency.`);
      }
    }

    years.push({
      age: displayAge,
      calendarYear: referenceDate.getFullYear() + offset,
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
      accountBalancesById: toAccountBalancesById(ledgerAccounts),
      creditCardBalancesById: { ...creditCardBalances },
      totalCreditCardDebt: Object.values(creditCardBalances).reduce((sum, bal) => sum + bal, 0)
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

  const incomeValidationPeriods = Object.values(incomePoolUsage)
    .map((bucket) => {
      const totalRequested = bucket.items.reduce((sum, item) => sum + item.requested, 0);
      const totalFromIncome = bucket.items.reduce((sum, item) => sum + item.fromIncome, 0);
      const totalFromFallback = bucket.items.reduce((sum, item) => sum + item.fromFallback, 0);
      const totalShortfall = bucket.items.reduce((sum, item) => sum + item.shortfall, 0);
      return {
        pool: bucket.pool,
        periodKey: bucket.periodKey,
        budget: bucket.budget,
        totalRequested,
        totalFromIncome,
        totalFromFallback,
        totalShortfall,
        exceedsIncome: totalRequested > bucket.budget + 0.01,
        hasUnmet: totalShortfall > 0.01,
        items: bucket.items
      };
    })
    .filter((period) => period.exceedsIncome || period.hasUnmet)
    .sort((a, b) => `${a.pool}:${a.periodKey}`.localeCompare(`${b.pool}:${b.periodKey}`));

  const incomeValidationGroups = groupIncomeValidationPeriods(incomeValidationPeriods);

  const incomeValidation = {
    hasOverspend: incomeValidationPeriods.length > 0,
    periods: incomeValidationPeriods,
    groups: incomeValidationGroups
  };

  incomeValidationGroups.forEach((group) => {
    const scope = describeIncomeValidationGroup(group);
    const unit = group.pool === 'monthly' ? 'month' : 'year';
    const overageText = group.minOverage === group.maxOverage
      ? formatCurrency(group.maxOverage)
      : `${formatCurrency(group.minOverage)}–${formatCurrency(group.maxOverage)}`;
    const msg = `Income validation: overspend in ${scope} of ${overageText} per ${unit} (budget ${formatCurrency(group.budget)}, requested ${formatCurrency(group.totalRequested)})${group.hasUnmet ? '; some spending could not be covered' : '; covered from fallback accounts'}.`;
    if (!warnings.includes(msg)) {
      warnings.push(msg);
    }
  });

  const survivesToEnd = depletedAge === null;
  const endingBalance = years.length > 0 ? years[years.length - 1].endBalance : 0;
  const summary = survivesToEnd
    ? `Congratulations! Based on your retirement plan, you can retire at age ${retirementAge} and finish with ${formatCurrency(endingBalance)} at age ${endAge}.`
    : `Your plan runs out of money at age ${depletedAge}. Consider retiring later, saving more, or lowering withdrawals.`;
  const simulationStartYearMonth = serialToYearMonth(projectionStartSerial);
  const simulationStartDate =
    options.startDate && parseDate(options.startDate)
      ? options.startDate
      : `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}-${String(referenceDate.getDate()).padStart(2, '0')}`;

  return {
    years,
    survivesToEnd,
    depletedAge,
    endAge,
    endingBalance,
    summary,
    simulationStartDate,
    simulationStartYearMonth,
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
    incomeValidation,
    housingPayoffMonths,
    housingTotalMonthlyCosts,
    housingFundingShortfalls,
    creditCardFundingShortfalls,
    creditCardBalancesById: { ...creditCardBalances },
    monthlySnapshots,
    monthlyWaterfall
  };
};

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
