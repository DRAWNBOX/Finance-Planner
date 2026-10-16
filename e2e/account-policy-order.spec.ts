import { test, expect, type Page } from '@playwright/test';
import type { Scenario } from '../src/types';
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
  seedScenario
} from './fixtures';

/**
 * Bounded real-Chromium GUI-A01/G03/G04/G07 account-policy and display-order
 * flow.
 *
 * Honesty note: this drives the real `AccountManagementEditor` (color + the
 * account withdrawal `Allow automatic fallback` policy + the display-order
 * Move up/down buttons) and the real Timeline `ResultsTable` over canonical v3
 * bytes seeded through the app's own codec. It does NOT certify the
 * GUI-A01–A10/G01–G40 or CA01–CA13 matrices; Vitest remains the owner of the
 * per-item engine flows.
 *
 * Determinism:
 * - Fresh isolated Chromium context per test; the clock is pinned before the
 *   first navigation by `seedScenario`, and the seed is written once (no
 *   repeating `addInitScript`). No arbitrary sleeps — every wait is a web-first
 *   assertion.
 * - No projection/report import: the only expected money value is the literal
 *   configured sum of the two opening balances ($100 + $200). The persisted
 *   shape is read from raw v3 bytes.
 */

const CHECKING_DOLLARS = 100;
const EMERGENCY_DOLLARS = 200;
const TOTAL_DOLLARS = CHECKING_DOLLARS + EMERGENCY_DOLLARS;
const CHECKING_COLOR = '#123456';

/**
 * Canonical scenario whose net worth is exactly the two configured opening
 * balances: no career/income stream, every rate 0%, and no purchases, loans,
 * housing, cards or cashflow obligations (all empty by default). Accounts
 * open at $100 (Checking) / $200 (Emergency Fund) / $0 elsewhere, so the
 * projection net worth is input-derived $300 and never moves.
 */
const openingBalancesScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance:
      account.id === ACCOUNT_IDS.checking
        ? CHECKING_DOLLARS
        : account.id === ACCOUNT_IDS.emergencyFund
          ? EMERGENCY_DOLLARS
          : 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  return scenario;
};

const openTimeline = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
};

const openAccounts = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts & funding' })).toBeVisible();
};

const resultsTable = (page: Page) =>
  page.getByRole('region', { name: 'Projection results' }).getByRole('table');

/** The body row whose row header is exactly `year`. */
const yearRow = (page: Page, year: string) =>
  resultsTable(page).locator(`tbody tr:has(th[scope="row"]:text-is("${year}"))`);

/** Header index; the matching body `td` sits at `headerIndex - 1` (the row label is a th). */
const headerIndex = async (page: Page, header: string): Promise<number> => {
  const headers = (await resultsTable(page).locator('thead th').allTextContents()).map((text) => text.trim());
  const index = headers.indexOf(header);
  if (index < 0) throw new Error(`Missing table column header "${header}".`);
  return index;
};

// The runtime table formatter (default locale, 2 fraction digits), mirroring the
// view — never the report data.
const tableCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

/** The account card whose display-color input is labelled for `label`. */
const accountCardByColorLabel = (page: Page, label: string) =>
  page.locator('.account-card', { has: page.getByLabel(`${label} display color`) });

/** The `Accounts` list region (the G03 anchor for the removed pool controls). */
const accountsRegion = (page: Page) => page.getByRole('region', { name: 'Accounts' });

interface PersistedAccount {
  id?: string;
  color?: string;
  displayOrder?: number;
  withdrawalPolicy?: { allowAutomaticFallback?: boolean };
}

interface PersistedShape {
  schemaVersion?: number;
  scenario?: { netWorth?: { accounts?: PersistedAccount[] } };
}

const readAccounts = async (page: Page): Promise<Map<string, PersistedAccount>> => {
  const raw = await readStoredBytes(page);
  expect(raw).not.toBeNull();
  const persisted = JSON.parse(raw as string) as PersistedShape;
  expect(persisted.schemaVersion).toBe(SCHEMA_VERSION);
  const accounts = persisted.scenario?.netWorth?.accounts ?? [];
  return new Map(accounts.map((account) => [account.id ?? '', account]));
};

test('GUI-A01/G03/G04/G07: checking color/fallback edits and a display-order swap survive pagehide/reload while net worth stays the input-derived $300 and no pool controls appear', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, openingBalancesScenario());
  await expectCleanSeed(page);

  // Baseline: the Timeline report's closing net worth is the literal configured
  // sum of the two openings (no income, no growth, no obligations).
  await openTimeline(page);
  const closingCol = await headerIndex(page, 'Closing net worth');
  const closingCell = (table: ReturnType<typeof resultsTable>) => table.locator('td').nth(closingCol - 1);
  await expect(closingCell(yearRow(page, '2026'))).toHaveText(tableCurrency(TOTAL_DOLLARS));
  await expect(closingCell(resultsTable(page).locator('tbody tr').last())).toHaveText(tableCurrency(TOTAL_DOLLARS));

  // Accounts editor: edit the Checking display color and its withdrawal policy.
  await openAccounts(page);
  const checkingCard = accountCardByColorLabel(page, 'Checking');
  await expect(checkingCard).toHaveCount(1);
  await expect(checkingCard.getByLabel('Account name')).toHaveValue('Checking');

  await checkingCard.getByLabel('Checking display color').fill(CHECKING_COLOR);
  await expect(checkingCard.getByLabel('Checking display color')).toHaveValue(CHECKING_COLOR);

  // Default checking `allowAutomaticFallback` is true; flip it to prove the
  // policy is editable and persists independently of the money math.
  await checkingCard.locator('summary').click();
  const checkingFallback = checkingCard.getByLabel('Allow automatic fallback');
  await expect(checkingFallback).toBeChecked();
  await checkingFallback.uncheck();
  await expect(checkingFallback).not.toBeChecked();

  // Display order only: swap the first two accounts with the Move down button.
  await checkingCard.getByRole('button', { name: 'Move Checking down' }).click();

  const accountNames = accountsRegion(page).getByLabel('Account name');
  await expect(accountNames).toHaveCount(5);
  await expect(accountNames.nth(0)).toHaveValue('Emergency Fund');
  await expect(accountNames.nth(1)).toHaveValue('Checking');

  // G03: no pool-derived controls exist inside the Accounts region. Anchored to
  // the actual GUI-audit pool dropdown names — "Add Pool" and the account
  // "Pool" membership dropdown — never a bare negative on the word "pool".
  await expect(accountsRegion(page).getByRole('button', { name: /add pool/i })).toHaveCount(0);
  await expect(accountsRegion(page).getByRole('combobox', { name: /pool/i })).toHaveCount(0);

  // Reordering is display-only: the Timeline closing net worth is unchanged.
  await openTimeline(page);
  await expect(closingCell(yearRow(page, '2026'))).toHaveText(tableCurrency(TOTAL_DOLLARS));
  await expect(closingCell(resultsTable(page).locator('tbody tr').last())).toHaveText(tableCurrency(TOTAL_DOLLARS));

  // pagehide flushes the debounced autosave synchronously; the canonical bytes
  // must carry the same five account ids, the checker reorder, and both edits.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  const persisted = await readAccounts(page);
  expect([...persisted.keys()].sort()).toEqual([...Object.values(ACCOUNT_IDS)].sort());
  const checking = persisted.get(ACCOUNT_IDS.checking);
  const emergency = persisted.get(ACCOUNT_IDS.emergencyFund);
  expect(checking?.color).toBe(CHECKING_COLOR);
  expect(checking?.withdrawalPolicy?.allowAutomaticFallback).toBe(false);
  expect(emergency?.withdrawalPolicy?.allowAutomaticFallback).toBe(true);
  expect(emergency?.color).not.toBe(CHECKING_COLOR);
  // Display order reflects the swap (Checking still exists, but now after the
  // Emergency Fund).
  expect(checking?.displayOrder ?? 0).toBeGreaterThan(emergency?.displayOrder ?? -1);

  // Everything survives a reload of those bytes.
  await page.reload();
  await expectCleanSeed(page);
  await openAccounts(page);

  const reloadedNames = accountsRegion(page).getByLabel('Account name');
  await expect(reloadedNames.nth(0)).toHaveValue('Emergency Fund');
  await expect(reloadedNames.nth(1)).toHaveValue('Checking');

  const reloadedChecking = accountCardByColorLabel(page, 'Checking');
  await expect(reloadedChecking.getByLabel('Checking display color')).toHaveValue(CHECKING_COLOR);
  await reloadedChecking.locator('summary').click();
  await expect(reloadedChecking.getByLabel('Allow automatic fallback')).not.toBeChecked();

  // And the input-derived net worth is still exactly $300 after the reload.
  await openTimeline(page);
  await expect(closingCell(yearRow(page, '2026'))).toHaveText(tableCurrency(TOTAL_DOLLARS));
  await expect(closingCell(resultsTable(page).locator('tbody tr').last())).toHaveText(tableCurrency(TOTAL_DOLLARS));

  expect(errors).toEqual([]);
});
