import type {
  BankAccountDefinition,
  LargePurchase,
  Loan,
  SourceLine
} from './types';

export const getDefaultBankAccountIdForPool = (accounts: BankAccountDefinition[], poolId: string) =>
  [...accounts]
    .filter((account) => account.poolId === poolId)
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))[0]?.id ?? null;

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
