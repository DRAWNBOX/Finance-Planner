import { test, expect } from '@playwright/test';
import { ACCOUNT_IDS, collectErrors, createDefaultScenario, expectCleanSeed, mainNav, planSections, seedScenario, FIXED_NOW } from './fixtures';

test('account asset cell exposes committed account activity on keyboard focus', async ({ page }) => {
  const errors = collectErrors(page);
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map(account => ({
    ...account,
    openingBalance: account.id === ACCOUNT_IDS.checking ? 100 : 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  scenario.largePurchases = [{ id: 'activity-debit', label: 'One-time debit', enabled: true, showOnGraph: true, yearMonth: '2026-07', age: 40, amount: 100, fundingSource: `account:${ACCOUNT_IDS.checking}`, categoryId: null }];
  await seedScenario(page, scenario);
  await expectCleanSeed(page);
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
  const header = page.getByRole('columnheader', { name: 'Account asset: checking' });
  await expect(header).toBeVisible();
  const row = page.getByRole('region', { name: 'Projection results' }).locator('tbody tr').filter({ has: page.locator('th', { hasText: /^2026$/ }) });
  const cell = row.locator('td[tabindex="0"]').first();
  await cell.focus();
  await expect(cell).toHaveAttribute('title', /Account change: -\$100\.00/);
  await expect(cell).toHaveAttribute('title', /purchase.*funding/);
  expect(errors).toEqual([]);
});
