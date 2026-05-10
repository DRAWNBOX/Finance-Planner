import type {
  AccountTypePreset,
  BankAccountDefinition,
  CareerEntry,
  CareerSourceLine,
  LargePurchase,
  Loan,
  LongTermPurchase,
  PoolDefinition,
  SourceLine,
  WithdrawalPlan
} from './types';

type LegacyPoolId = 'emergencyFund' | 'hsa' | 'investments' | 'retirement401k';

export const LEGACY_POOL_IDS: LegacyPoolId[] = ['emergencyFund', 'hsa', 'investments', 'retirement401k'];

export const LEGACY_POOL_LABELS: Record<LegacyPoolId, string> = {
  emergencyFund: 'Emergency Fund',
  hsa: 'HSA',
  investments: 'Investments',
  retirement401k: '401K'
};

const legacyPoolToPreset = (poolId: LegacyPoolId): AccountTypePreset => {
  if (poolId === 'retirement401k') {
    return 'retirement401k';
  }
  if (poolId === 'hsa') {
    return 'hsa';
  }
  if (poolId === 'investments') {
    return 'taxable';
  }

  return 'savings';
};

const DEFAULT_POOL_COLORS = ['#4b87d9', '#32a884', '#f0a235', '#ca5d7b', '#7a75d8', '#3e9ab1', '#d0735a', '#6e9c4e'];

export const seedDefaultPools = (): PoolDefinition[] =>
  LEGACY_POOL_IDS.map((id, index) => {
    const defaults: Pick<PoolDefinition, 'annualReturnRate' | 'taxRate' | 'penaltyRate' | 'isHSA' | 'softRestrictionNote'> =
      id === 'emergencyFund'
        ? { annualReturnRate: 2.5, taxRate: 0, penaltyRate: 0, isHSA: false, softRestrictionNote: '' }
        : id === 'hsa'
          ? { annualReturnRate: 5, taxRate: 0, penaltyRate: 0, isHSA: true, softRestrictionNote: 'Qualified medical withdrawals are tax free.' }
          : id === 'investments'
            ? { annualReturnRate: 6.5, taxRate: 0, penaltyRate: 0, isHSA: false, softRestrictionNote: '' }
            : { annualReturnRate: 6, taxRate: 0, penaltyRate: 0, isHSA: false, softRestrictionNote: '' };

    return {
      id,
      label: LEGACY_POOL_LABELS[id],
      enabled: true,
      priority: index,
      color: DEFAULT_POOL_COLORS[index % DEFAULT_POOL_COLORS.length],
      legacyFallbackId: id,
      ...defaults
    };
  });

export { DEFAULT_POOL_COLORS };

export const seedDefaultBankAccounts = (balances: Record<string, number>): BankAccountDefinition[] =>
  LEGACY_POOL_IDS.map((poolId) => ({
    id: `${poolId}-account-default`,
    label: LEGACY_POOL_LABELS[poolId],
    poolId,
    priority: 0,
    accountType: legacyPoolToPreset(poolId),
    balance: Math.max(0, balances[poolId] ?? 0)
  }));

export const getDefaultBankAccountIdForPool = (accounts: BankAccountDefinition[], poolId: string) =>
  [...accounts]
    .filter((account) => account.poolId === poolId)
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))[0]?.id ?? null;

export const isLegacyPoolId = (value: string): value is LegacyPoolId =>
  value === 'emergencyFund' || value === 'hsa' || value === 'investments' || value === 'retirement401k';

const makeSourceLineId = (prefix: string, index: number) => `${prefix}-${index + 1}`;

export const legacySavingsToSourceLines = (
  savings: Record<string, number>,
  flags?: Partial<Record<LegacyPoolId, boolean>>,
  prefix = 'source'
): SourceLine[] =>
  LEGACY_POOL_IDS.map((poolId, index) => ({
    id: makeSourceLineId(prefix, index),
    enabled: true,
    sourceType: 'pool' as const,
    sourceId: poolId,
    mode: flags?.[poolId] ? ('four_percent' as const) : ('amount' as const),
    amount: Math.max(0, savings[poolId] ?? 0)
  })).filter((line) => line.mode === 'four_percent' || line.amount > 0);

export const legacySavingsToAccountSourceLines = (
  savings: Record<string, number>,
  accounts: BankAccountDefinition[],
  prefix = 'source'
): SourceLine[] =>
  LEGACY_POOL_IDS.map((poolId, index) => {
    const accountId = getDefaultBankAccountIdForPool(accounts, poolId);

    return {
      id: makeSourceLineId(prefix, index),
      enabled: true,
      sourceType: accountId ? ('account' as const) : ('pool' as const),
      sourceId: accountId ?? poolId,
      mode: 'amount' as const,
      amount: Math.max(0, savings[poolId] ?? 0)
    };
  }).filter((line) => line.amount > 0);

export const careerToSourceLines = (career: CareerEntry): CareerSourceLine[] =>
  LEGACY_POOL_IDS.map((poolId, index) => ({
    id: makeSourceLineId('career-source', index),
    enabled: true,
    sourceType: 'pool' as const,
    sourceId: poolId,
    contributionRate:
      poolId === 'emergencyFund'
        ? career.emergencyFundContributionRate
        : poolId === 'hsa'
          ? career.hsaContributionRate
          : poolId === 'investments'
            ? career.investmentsContributionRate
            : career.retirement401kContributionRate,
    savingsMonthly:
      poolId === 'emergencyFund'
        ? Boolean(career.emergencyFundSavingsMonthly)
        : poolId === 'hsa'
          ? Boolean(career.hsaSavingsMonthly)
          : poolId === 'investments'
            ? Boolean(career.investmentsSavingsMonthly)
            : Boolean(career.retirement401kSavingsMonthly),
    monthlyWithdrawal:
      poolId === 'emergencyFund'
        ? Math.max(0, career.emergencyFundMonthlyWithdrawal ?? 0)
        : poolId === 'hsa'
          ? Math.max(0, career.hsaMonthlyWithdrawal ?? 0)
          : poolId === 'investments'
            ? Math.max(0, career.investmentsMonthlyWithdrawal ?? 0)
            : Math.max(0, career.retirement401kMonthlyWithdrawal ?? 0),
    maxBalance: 0,
    overflowFallbackAccountId: null
  })).filter((line) => line.contributionRate > 0 || line.monthlyWithdrawal > 0);

export const ensureSourceLinesForPurchase = (
  purchase: LargePurchase | LongTermPurchase,
  bankAccounts?: BankAccountDefinition[]
): SourceLine[] => {
  if (purchase.sourceLines && purchase.sourceLines.length > 0) {
    return purchase.sourceLines;
  }
  const rawSaved = purchase as unknown as Record<string, unknown>;
  const legacySourceAmounts = rawSaved.sourceAmounts as Record<string, number> | undefined;
  if (!legacySourceAmounts) {
    return [];
  }
  if (bankAccounts && bankAccounts.length > 0) {
    return legacySavingsToAccountSourceLines(legacySourceAmounts as Record<string, number>, bankAccounts, `${purchase.id}-source`);
  }
  return legacySavingsToSourceLines(legacySourceAmounts as Record<string, number>, undefined, `${purchase.id}-source`);
};

export const ensureSourceLinesForWithdrawal = (withdrawal: WithdrawalPlan): SourceLine[] => {
  if (withdrawal.sourceLines && withdrawal.sourceLines.length > 0) {
    return withdrawal.sourceLines;
  }
  const rawSaved = withdrawal as unknown as Record<string, unknown>;
  const legacyWithdrawals = rawSaved.firstYearAccountWithdrawals as Record<string, number> | undefined;
  const legacyFourPercent = rawSaved.firstYearAccountUseFourPercent as Record<string, boolean> | undefined;
  const configuredTotal = Object.values(legacyWithdrawals ?? {}).reduce((s, v) => s + Math.max(0, v ?? 0), 0);
  const normalizedConfigured =
    configuredTotal > 0
      ? legacyWithdrawals
      : { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: Math.max(0, withdrawal.firstYearAmount) };
  const effectiveFourPercentFlags: Partial<Record<LegacyPoolId, boolean>> = {
    emergencyFund: withdrawal.mode === 'four_percent' || Boolean(legacyFourPercent?.emergencyFund),
    hsa: withdrawal.mode === 'four_percent' || Boolean(legacyFourPercent?.hsa),
    investments: withdrawal.mode === 'four_percent' || Boolean(legacyFourPercent?.investments),
    retirement401k: withdrawal.mode === 'four_percent' || Boolean(legacyFourPercent?.retirement401k)
  };
  const legacyStartAges = Object.fromEntries(
    (withdrawal.sourceLines ?? [])
      .filter((line) => line.sourceType === 'pool' && isLegacyPoolId(line.sourceId))
      .map((line) => [line.sourceId, typeof line.startAge === 'number' ? line.startAge : undefined])
  ) as Partial<Record<LegacyPoolId, number | undefined>>;
  const legacySyncFlags = Object.fromEntries(
    (withdrawal.sourceLines ?? [])
      .filter((line) => line.sourceType === 'pool' && isLegacyPoolId(line.sourceId))
      .map((line) => [line.sourceId, line.syncWithRetirementAge ?? true])
  ) as Partial<Record<LegacyPoolId, boolean>>;
  const legacyLines = legacySavingsToSourceLines(normalizedConfigured!, effectiveFourPercentFlags, 'withdrawal-source');
  const legacyLinesWithStartAge = legacyLines.map((line) =>
    line.sourceType === 'pool' && isLegacyPoolId(line.sourceId)
      ? {
          ...line,
          startAge: legacyStartAges[line.sourceId],
          syncWithRetirementAge: legacySyncFlags[line.sourceId]
        }
      : line
  );
  const customLines =
    withdrawal.sourceLines?.filter(
      (line) => line.sourceType === 'pool' && !isLegacyPoolId(line.sourceId) && line.enabled && (line.mode === 'four_percent' || line.amount > 0)
    ) ?? [];

  return [...legacyLinesWithStartAge, ...customLines];
};

export const normalizePurchaseFundingSource = (
  fundingSource: LargePurchase['fundingSource'],
  purchaseAmount: number,
  bankAccounts: BankAccountDefinition[] = []
): SourceLine[] => {
  if (!fundingSource || fundingSource === 'income') {
    return [];
  }

  const [, accountId] = fundingSource.split(':', 2);
  const accountExists = bankAccounts.some((account) => account.id === accountId);

  if (!accountExists || !accountId) {
    return [];
  }

  return [
    {
      id: `funding-source-${accountId}`,
      enabled: true,
      sourceType: 'account',
      sourceId: accountId,
      mode: 'amount',
      amount: Math.max(0, purchaseAmount)
    }
  ];
};

export const normalizeLoanPaymentSource = (
  loan: Loan,
  bankAccounts: BankAccountDefinition[] = []
): Loan['paymentSource'] => {
  if (typeof loan.paymentSource === 'string') {
    if (loan.paymentSource.startsWith('pool:')) {
      const poolId = loan.paymentSource.slice('pool:'.length);
      const accountId = getDefaultBankAccountIdForPool(bankAccounts, poolId);
      return accountId ? `account:${accountId}` : loan.paymentSource;
    }
    return loan.paymentSource;
  }

  if (loan.paymentSourceAccount === 'income') {
    return 'income';
  }

  if (isLegacyPoolId(loan.paymentSourceAccount)) {
    const accountId = getDefaultBankAccountIdForPool(bankAccounts, loan.paymentSourceAccount);
    return accountId ? `account:${accountId}` : `pool:${loan.paymentSourceAccount}`;
  }

  const fallbackId = getDefaultBankAccountIdForPool(bankAccounts, 'investments');
  return fallbackId ? `account:${fallbackId}` : 'pool:investments';
};

export const normalizeLoanDownPaymentSource = (
  loan: Loan,
  bankAccounts: BankAccountDefinition[] = []
): Loan['downPaymentSource'] => {
  if (typeof loan.downPaymentSource === 'string') {
    if (loan.downPaymentSource.startsWith('pool:')) {
      const poolId = loan.downPaymentSource.slice('pool:'.length);
      const accountId = getDefaultBankAccountIdForPool(bankAccounts, poolId);
      return accountId ? `account:${accountId}` : loan.downPaymentSource;
    }
    return loan.downPaymentSource;
  }

  return undefined;
};
