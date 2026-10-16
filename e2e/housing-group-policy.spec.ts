import { test, expect, type Page } from '@playwright/test';
import type { Scenario } from '../src/types';
import { createDefaultRentalEntry } from '../src/defaultScenario';
import {
  ACCOUNT_IDS,
  FIXED_NOW,
  SCHEMA_VERSION,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  planSections,
  readStoredBytes,
  readStoredEnvelope,
  seedScenario,
  waitForSaved
} from './fixtures';

/**
 * Bounded real-Chromium GUI-A05 / G20–G22 housing grouped funding-policy flows.
 *
 * Honesty note: these specs drive the real `App` (the one
 * `projectFeatureScenario` composition seam) in a fresh isolated Chromium
 * context seeded with the app's canonical v3 bytes via `seedScenario`. They
 * read the one projection report through the read-only `HousingResults` region
 * and the D16 Warnings selectors — they do NOT certify the GUI-A01–A10/G01–G40
 * or CA01–CA13 matrices; Vitest remains the owner of the per-item engine flows.
 *
 * Fixtures mirror `src/App.test.tsx` G20–G22: one **property-free** rental
 * (`id: 'apt-1'`), July 2026 only, monthly rent $150, ancillary groups $0, no
 * careers. Checking opens with $100 and Emergency Fund with $50 (both 0%
 * growth); the payment group owns an explicit ordered override
 * (`primary: Checking, fallback: [Emergency Fund]`) that must win over the
 * global default. With a $100 + $50 split the $150 rent is fully funded and the
 * secondary source is genuinely drawn from, so D16 records a fallback — never a
 * shortfall.
 *
 * Determinism:
 * - Every test gets a fresh Playwright context (blank localStorage); the clock
 *   is pinned inside `seedScenario` **before** the first navigation and the
 *   canonical bytes are written once (no repeating `addInitScript`, no real
 *   profile). Waits are role/text auto-retries — no arbitrary sleeps.
 * - Money assertions are literal input-derived cents rendered with the
 *   component's own 2-decimal formatter (`$150.00`), never read back from the
 *   report and re-derived.
 */

const openHousing = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Housing' }).click();
};

const housingFundingOrder = (page: Page) =>
  page.getByRole('region', { name: 'Housing funding order' });

const housingResults = (page: Page) => page.getByRole('region', { name: 'Apartment results' });

/** One property-free July-2026 rental; the payment group overrides Checking + Emergency Fund. */
const rentalScenario = (checking: number, emergencyFund: number): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    // 0% growth; explicit opening balances for the two cash accounts.
    annualReturnRate: 0,
    openingBalance:
      account.id === ACCOUNT_IDS.checking
        ? checking
        : account.id === ACCOUNT_IDS.emergencyFund
          ? emergencyFund
          : 0
  }));
  scenario.housing = [
    {
      ...createDefaultRentalEntry(scenario.profile.currentAge, scenario.options.dateOfBirth, FIXED_NOW),
      id: 'apt-1',
      startYearMonth: '2026-07',
      endYearMonth: '2026-07',
      monthlyRent: 150,
      propertyTaxYearly: 0,
      homeInsuranceYearly: 0,
      hoaMonthly: 0,
      maintenanceMonthly: 0,
      pmiMonthly: 0,
      rentalIncomeMonthly: 0,
      paymentSource: undefined,
      fundingPolicies: {
        payment: {
          primaryAccountId: ACCOUNT_IDS.checking,
          fallbackAccountIds: [ACCOUNT_IDS.emergencyFund]
        }
      }
    }
  ];
  return scenario;
};

/** The scenario half of the app's persisted v3 envelope (read-only, never hand-built). */
const readStoredScenario = async (page: Page): Promise<Scenario> => {
  const raw = (await readStoredBytes(page)) as string;
  return (JSON.parse(raw) as { scenario: Scenario }).scenario;
};

test('GUI-A05/G20/G22: an explicit per-group rent override wins over the global default and reports the real primary→fallback split', async ({ page }) => {
  const errors = collectErrors(page);

  const scenario = rentalScenario(100, 50);
  // The global default points at the empty Investments account, so only the
  // payment group's override can fund this rent.
  scenario.fundingPolicy = { primaryAccountId: ACCOUNT_IDS.investments, fallbackAccountIds: [] };

  await seedScenario(page, scenario);
  await expectCleanSeed(page);
  await openHousing(page);

  // Requested/paid/unpaid is rendered verbatim from the one report: the $150
  // rent is fully paid as Checking $100 + Emergency Fund $50, nothing unpaid.
  const results = housingResults(page);
  await expect(results).toBeVisible();
  await expect(results.getByRole('row', { name: 'Rent $150.00 $150.00 $0.00' })).toBeVisible();

  // Housing funding order: the payment group shows its controlled override…
  await expect(page.getByLabel('Override Mortgage payment / rent funding')).toBeChecked();
  const order = housingFundingOrder(page);
  await expect(order.getByLabel('Primary account', { exact: true }).first()).toHaveValue(ACCOUNT_IDS.checking);
  await expect(order.getByLabel('Fallback 1', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);
  // …while a group with no override inherits the global default (Investments),
  // proving the group override — not the global policy — funded the rent.
  await expect(order.getByLabel('Primary account', { exact: true }).nth(1)).toHaveValue(ACCOUNT_IDS.investments);

  // The secondary source was actually drawn from, so D16 records a fallback
  // (with its "Fallback used" badge), never a shortfall or exhaustion.
  await planSections(page).getByRole('button', { name: 'Warnings' }).click();
  const panel = page.locator('.warning-panel');
  await expect(panel.getByRole('heading', { name: 'Plan checks' })).toBeVisible();
  await expect(panel).toContainText('Fallback used');
  await expect(
    panel
      .locator('p.warning-warning')
      .filter({ hasText: 'Funding fell back to a secondary source — 2026-07.' })
  ).toHaveCount(1);
  await expect(panel.locator('p.warning-error')).toHaveCount(0);
  await expect(panel).not.toContainText('Some scheduled payments could not be fully funded');

  expect(errors).toEqual([]);
});

test('GUI-A05/G22: clearing a rent override to explicit empty leaves the rent unpaid although the global default could pay, and the override persists', async ({ page }) => {
  const errors = collectErrors(page);

  const scenario = rentalScenario(150, 0);
  // The untouched global default can pay the whole $150 by itself.
  scenario.fundingPolicy = { primaryAccountId: ACCOUNT_IDS.checking, fallbackAccountIds: [] };

  await seedScenario(page, scenario);
  await expectCleanSeed(page);
  await openHousing(page);

  const results = housingResults(page);
  await expect(results.getByRole('row', { name: 'Rent $150.00 $150.00 $0.00' })).toBeVisible();

  // Remove both ordered positions through the FundingPolicyEditor controls,
  // leaving an explicit null-primary / empty-fallback override.
  await page.getByRole('button', { name: 'Remove Primary account', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Fallback 1', exact: true }).click();
  await waitForSaved(page);

  // The explicit empty override is persisted; the global default is untouched.
  const stored = await readStoredScenario(page);
  expect(stored.housing?.[0]?.fundingPolicies?.payment).toEqual({
    primaryAccountId: null,
    fallbackAccountIds: []
  });
  expect(stored.fundingPolicy).toEqual({ primaryAccountId: ACCOUNT_IDS.checking, fallbackAccountIds: [] });

  // The rent is now unpaid ($150.00 outstanding), not silently re-funded from
  // the still-able global Checking default.
  await expect(results.getByRole('row', { name: 'Rent $150.00 $0.00 $150.00' })).toBeVisible();
  await expect(results).toContainText('Some housing costs were only partly paid or went unpaid.');

  // The explicit empty override survives a pagehide flush + reload.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await expectCleanSeed(page);
  await openHousing(page);

  await expect(page.getByLabel('Override Mortgage payment / rent funding')).toBeChecked();
  await expect(housingFundingOrder(page).getByLabel('Primary account', { exact: true }).first()).toHaveValue('');
  await expect(page.getByLabel('Fallback 1', { exact: true })).toHaveCount(0);
  await expect(housingResults(page).getByRole('row', { name: 'Rent $150.00 $0.00 $150.00' })).toBeVisible();

  const envelope = await readStoredEnvelope(page);
  expect(envelope?.schemaVersion).toBe(SCHEMA_VERSION);

  expect(errors).toEqual([]);
});
