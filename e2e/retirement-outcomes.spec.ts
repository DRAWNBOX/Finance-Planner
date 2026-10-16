import { test, expect } from '@playwright/test';
import { ACCOUNT_IDS, FIXED_NOW, collectErrors, createDefaultScenario, expectCleanSeed, seedScenario } from './fixtures';
import type { Scenario } from '../src/types';

test('retirement panel shows the July 2026 observed withdrawal without a balance-at-retirement preview', async ({ page }) => {
  const errors = collectErrors(page);
  const scenario: Scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map(account => ({ ...account, openingBalance: account.id === ACCOUNT_IDS.retirement401k ? 100000 : 0, annualReturnRate: 0, retirementAnnualReturnRate: null }));
  scenario.withdrawal.sourceLines = [{ id: 'outcomes-july', label: '401K July', enabled: true, accountId: ACCOUNT_IDS.retirement401k, mode: 'percentOfInitialBalance', amount: 0, initialWithdrawalRatePercent: 4, firstWithdrawalDate: '2026-07-01', initialWithdrawalValuationDate: '2026-07-01', paymentDay: 15 }];
  await seedScenario(page, scenario);
  await expectCleanSeed(page);
  const panel = page.getByRole('region', { name: 'Retirement withdrawals' });
  await expect(panel).toContainText('401K July');
  const july = panel.getByRole('row', { name: /^2026-07-15/ });
  await expect(july).toBeVisible();
  await expect(july).toContainText('$333.33');
  await expect(panel.getByText('This view reports observed withdrawals only; it does not estimate assets at retirement.')).toBeVisible();
  expect(errors).toEqual([]);
});
