import { test, expect, type Page } from '@playwright/test';
import type { Scenario } from '../src/types';
import { createDefaultHousingEntry } from '../src/defaultScenario';
import {
  ACCOUNT_IDS,
  FIXED_NOW,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  planSections,
  seedScenario
} from './fixtures';

/**
 * Bounded real-Chromium GUI-A05 housing-outcome flows.
 *
 * Honesty note: these two specs drive the real `App` (the one
 * `projectFeatureScenario` composition seam) in a fresh isolated Chromium
 * context seeded with canonical v3 bytes. They assert the read-only
 * `HousingResults` region text, which is rendered verbatim from the one
 * projection report (`report.months[last]`, `report.schedules`,
 * `report.outcomes`) — they do NOT certify the GUI-A01–A10/G01–G40 or
 * CA01–CA13 matrices; Vitest remains the owner of the per-item engine flows.
 * This lane deliberately does **not** import `projectFeatureScenario`: the
 * browser report is the single source of truth here.
 *
 * Fixtures source `src/App.test.tsx`:
 * - underfunded acquisition: `id: 'pending-*'`, a $80,000 required down payment
 *   with a checking-funded event and no funds, `status: 'pending'`;
 * - underwater sale: a $10,000 owned property + a $100,000 mortgage at 0%
 *   selling costs, sold July 2026.
 *
 * Canonical identity follows the App test: the property links to the housing
 * config entry via `sourceConfigId`, and its debt via `debtLink`; the liability
 * links back via `sourceConfigId`/`linkedPropertyId`. The mortgage
 * `openingBalance` is **persisted dollars** (`100000`, not cents).
 *
 * Determinism:
 * - Every test gets a fresh Playwright context (blank localStorage); the clock
 *   is pinned with `page.clock.setFixedTime` inside `seedScenario` **before**
 *   the first navigation, and the canonical bytes are written once (no repeating
 *   `addInitScript`, no real profile). Waits are role/region auto-retries.
 * - The career stream is disabled and every account opening is `$0` so no
 *   unrelated income can fund the pending down payment or offset the underwater
 *   deficit. No arbitrary sleeps.
 * - The underwater assertion is intentionally structure/sign-only: the retained
 *   deficiency and the signed report net worth are read back from the rendered
 *   report paragraph and asserted > 0 / < 0. Exact cents are not re-derived
 *   here, because that would require reproducing the clipped nominal monthly
 *   interest and the July sale dates outside the report.
 */

/** One fresh default scenario with no enabled career and $0 opening accounts. */
const zeroedNoCareerScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0
  }));
  return scenario;
};

const openHousing = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Housing' }).click();
};

const dollarsToCents = (money: string): number =>
  Math.round(Number(money.replace(/[$,]/g, '')) * 100);

test('GUI-A05: an unfunded pending mortgage acquisition stays pending with $0 property/deposit and no fabricated owned costs or debt', async ({ page }) => {
  const errors = collectErrors(page);

  const scenario = zeroedNoCareerScenario();
  const home = {
    ...createDefaultHousingEntry(scenario.profile.currentAge, scenario.options.dateOfBirth, FIXED_NOW),
    id: 'unfunded-home',
    label: 'Unfunded home',
    startYearMonth: '2026-07',
    // Deliberate non-zero owned costs: a pending acquisition must not post them.
    propertyTaxYearly: 12000,
    homeInsuranceYearly: 1200
  };
  scenario.housing = [home];
  scenario.properties = [
    {
      id: 'unfunded-property',
      sourceConfigId: home.id,
      label: home.label,
      kind: 'primaryResidence',
      value: 0,
      debtLink: 'unfunded-mortgage',
      requiredDownPayment: 80000,
      status: 'pending',
      acquisitionYearMonth: '2026-07',
      fundingEvents: [{ id: 'fe-unfunded', date: '2026-07-01', amount: 80000, accountId: ACCOUNT_IDS.checking }]
    }
  ];
  scenario.liabilities = [
    {
      id: 'unfunded-mortgage',
      kind: 'mortgage',
      label: 'Unfunded mortgage',
      openingBalance: 0,
      sourceConfigId: home.id,
      linkedPropertyId: 'unfunded-property'
    }
  ];

  await seedScenario(page, scenario);
  await expectCleanSeed(page);
  await openHousing(page);

  const region = page.getByRole('region', { name: 'Unfunded home results' });
  await expect(region).toBeVisible();

  // Record-backed: the pending acquisition never acquired value or a deposit.
  await expect(region).toContainText('Acquisition still pending');
  await expect(region).toContainText('Observed property value $0.00 · held deposit $0.00');

  // No owned obligation was fabricated from the configured tax/insurance.
  await expect(region).toContainText('No housing obligations were observed in this projection window.');
  await expect(region).not.toContainText('Observed housing obligations');

  // A pending acquisition's future financing is not opening debt, so no
  // mortgage balance line (not even $0.00) is invented.
  await expect(region).not.toContainText('Mortgage balance at projection close');

  expect(errors).toEqual([]);
});

test('GUI-A05: an underwater sale retains a positive sale deficiency and a signed negative net worth from the same report month', async ({ page }) => {
  const errors = collectErrors(page);

  const scenario = zeroedNoCareerScenario();
  const home = {
    ...createDefaultHousingEntry(scenario.profile.currentAge, scenario.options.dateOfBirth, FIXED_NOW),
    id: 'underwater-home',
    label: 'Underwater home',
    startYearMonth: '2026-06',
    sellYearMonth: '2026-07'
  };
  scenario.housing = [home];
  scenario.properties = [
    {
      id: 'underwater-property',
      sourceConfigId: home.id,
      label: home.label,
      kind: 'primaryResidence',
      // Persisted dollars: a $10,000 owned home against $100,000 of debt.
      value: 10000,
      debtLink: 'underwater-mortgage',
      requiredDownPayment: 0,
      status: 'owned',
      acquisitionYearMonth: '2020-01',
      sellingCostsRate: 0
    }
  ];
  scenario.liabilities = [
    {
      id: 'underwater-mortgage',
      kind: 'mortgage',
      label: 'Underwater mortgage',
      // Persisted dollars, NOT cents: $100,000 of opening mortgage debt.
      openingBalance: 100000,
      sourceConfigId: home.id,
      linkedPropertyId: 'underwater-property'
    }
  ];

  await seedScenario(page, scenario);
  await expectCleanSeed(page);
  await openHousing(page);

  const region = page.getByRole('region', { name: 'Underwater home results' });
  await expect(region).toBeVisible();

  const warning = region
    .locator('p.housing-results__warning')
    .filter({ hasText: 'Sale deficiency retained as debt' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Sale deficiency retained as debt:');
  await expect(warning).toContainText('Signed net worth at projection close:');

  // Structure/sign-only: read the rendered report month's figures back instead
  // of re-deriving exact cents (clipped nominal interest + July sale dates).
  const text = (await warning.textContent()) ?? '';
  const match = /Sale deficiency retained as debt: (\$[\d,]+\.\d{2})\. Signed net worth at projection close: (-?\$[\d,]+\.\d{2})\./.exec(text);
  expect(match).not.toBeNull();

  const deficiencyCents = dollarsToCents(match![1]);
  const netWorthCents = dollarsToCents(match![2]);
  expect(deficiencyCents).toBeGreaterThan(0);
  expect(netWorthCents).toBeLessThan(0);

  expect(errors).toEqual([]);
});
