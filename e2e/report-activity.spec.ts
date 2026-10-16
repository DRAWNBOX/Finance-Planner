import { test, expect } from '@playwright/test';
import { collectErrors, createDefaultScenario, expectCleanSeed, mainNav, planSections, seedScenario, FIXED_NOW } from './fixtures';

test('report yearly row exposes keyboard-focusable activity detail', async ({ page }) => {
  const errors = collectErrors(page);
  const scenario = createDefaultScenario(FIXED_NOW);
  // A deterministic, input-derived payroll: $2,000 gross − $200 tax = $1,800 net.
  const entry = scenario.careerPlan.entries[0];
  entry.enabled = true;
  entry.startYearMonth = '2026-07';
  entry.endYearMonth = '2026-07';
  entry.annualRaiseRate = 0;
  entry.paycheck = { payFrequency: 'monthly', categories: [
    { id: 'earn', label: 'Earnings', kind: 'earning', lines: [{ id: 'gross', label: 'Salary', amount: 2000, mode: 'amount' }] },
    { id: 'tax', label: 'Tax', kind: 'tax', lines: [{ id: 'withholding', label: 'Tax', amount: 200, mode: 'amount' }] }
  ] };
  entry.payPlans = [];
  await seedScenario(page, scenario);
  await expectCleanSeed(page);
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
  const row = page.getByRole('region', { name: 'Projection results' }).locator('tbody tr').filter({ has: page.locator('th', { hasText: /^2026$/ }) });
  await expect(row).toHaveCount(1);
  await row.focus();
  await expect(row).toHaveAttribute('title', /Gross earnings: \$2,000\.00.*Net pay: \$1,800\.00.*Payroll tax: \$200\.00/);
  expect(errors).toEqual([]);
});
