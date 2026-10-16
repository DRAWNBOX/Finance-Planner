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
 * GUI-A08/G08 — browser identity/history branch for the opening snapshot.
 *
 * The prior browser specs cover the signed-net-worth branch (liability with no
 * snapshot) and the display-consistency branch (one funded account, no debt).
 * This spec covers the gap between them: capturing an opening *observation*
 * through the real Net Worth UI, and keeping the snapshot's stable identity
 * (account/liability IDs, date, measurement) plus the observed `$0` debt exact
 * across a pagehide/reload — while a legacy asset-only history record stays
 * labelled asset-only.
 *
 * One canonical scenario is seeded via `seedScenario` (the real allowlisted v3
 * codec), hand-built from `createDefaultScenario`:
 * - Checking opens at $1,000; every other account opens at $0 and grows 0%.
 * - No career/income (careerPlan disabled) and 0% account growth, so the
 *   captured snapshot cannot disturb any default income/expense flow.
 * - One unlinked configured loan liability at $300 opening, 0% rate, no payment
 *   schedule (loans are only scheduled from `context.domains.loans`).
 * - One legacy asset-only history entry with an explicit measurement,
 *   provenance, date and account label.
 *
 * The observed $0 captured through the UI must win over the configured $300, so
 * the signed report net worth reads the full $1,000 account (never $700), while
 * the history record's asset-only total is never reinterpreted as signed net
 * worth.
 *
 * Honesty note: this drives the real app over canonical v3 bytes; it does NOT
 * certify the GUI-A/G or CA matrices. Every expected value is literal
 * configuration (opening balances in dollars); this spec never imports the
 * projection/report output and never re-runs funding.
 *
 * Determinism:
 * - Fresh isolated Chromium context (blank localStorage, no real profile); the
 *   clock is pinned by `seedScenario` before the first navigation and survives
 *   the reload.
 * - No arbitrary sleeps; every wait is a web-first assertion.
 *
 * Measurement note: the capture button defaults the observation to
 * `Assets minus liabilities`. The UI exposes the basis selector, so the spec
 * exercises it (`Assets only`) and asserts the *chosen* basis persists exactly;
 * the observed `$0` debt still wins regardless of the observation basis.
 */

const CHECKING_DOLLARS = 1000;
const CONFIGURED_LIABILITY_DOLLARS = 300;
const OBSERVED_LIABILITY_DOLLARS = 0;
const LIABILITY_ID = 'e2e-opening-liability';
const HISTORY_ID = 'e2e-history-asset-only';
const HISTORY_DATE = '2026-05-31';
const AS_OF_DATE = '2026-06-15';

/**
 * Fresh canonical scenario at the helper's fixed reference date: no income, one
 * funded account, one unlinked $300 loan liability and one legacy asset-only
 * history entry. The five canonical accounts are kept (the withdrawal plan
 * references the 401k id) but only Checking opens at $1,000.
 */
const snapshotIdentityScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.manualReturns = { ...scenario.manualReturns, inflationEnabled: false, inflationRate: 0 };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: account.id === ACCOUNT_IDS.checking ? CHECKING_DOLLARS : 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  // One valid configured opening liability: persisted dollars, 0% rate, no
  // payment schedule (no `scenario.loans` entry links it). The captured observed
  // $0 must win over this configured $300.
  scenario.liabilities = [
    {
      id: LIABILITY_ID,
      kind: 'loan',
      label: 'E2E opening loan',
      openingBalance: CONFIGURED_LIABILITY_DOLLARS,
      annualInterestRate: 0,
      minimumMonthlyPayment: 0
    }
  ];
  // Legacy asset-only observation: explicit measurement/provenance, a labelled
  // account snapshot and a date. It must stay asset-only after the reload.
  scenario.netWorth.history = [
    {
      id: HISTORY_ID,
      date: HISTORY_DATE,
      accounts: [{ id: ACCOUNT_IDS.checking, label: 'Checking', balance: CHECKING_DOLLARS }],
      totalNetWorth: CHECKING_DOLLARS,
      measurement: 'assetOnly',
      provenance: 'manual',
      sourceSnapshotId: null
    }
  ];
  return scenario;
};

// --- Persisted-shape readers (raw v3 bytes, never the report) ----------------

interface PersistedOpeningSnapshot {
  date?: string;
  measurement?: string;
  accounts?: { accountId?: string; balance?: number }[];
  liabilities?: { liabilityId?: string; balance?: number }[];
}

interface PersistedHistoryEntry {
  id?: string;
  date?: string;
  totalNetWorth?: number;
  measurement?: string;
  provenance?: string;
}

interface PersistedScenario {
  netWorth?: {
    asOfDate?: string;
    openingSnapshot?: PersistedOpeningSnapshot;
    history?: PersistedHistoryEntry[];
  };
}

interface PersistedShape {
  schemaVersion?: number;
  scenario?: PersistedScenario;
}

const readPersistedScenario = async (page: Page): Promise<PersistedScenario> => {
  const raw = await readStoredBytes(page);
  expect(raw).not.toBeNull();
  const persisted = JSON.parse(raw as string) as PersistedShape;
  expect(persisted.schemaVersion).toBe(SCHEMA_VERSION);
  expect(persisted.scenario).toBeTruthy();
  return persisted.scenario as PersistedScenario;
};

// --- Navigation + report helpers -------------------------------------------

const openNetWorth = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts & funding' })).toBeVisible();
};

const openTimeline = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
};

const snapshotSection = (page: Page) => page.locator('section.snapshot-section');

const resultsTable = (page: Page) => page.getByRole('region', { name: 'Projection results' }).getByRole('table');

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

// Locale formatter mirroring the exact one owned by the results table (runtime
// default locale, 2 digits). The report data itself is never read.
const tableCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const EXPECTED_ACCOUNT_IDS = [
  ACCOUNT_IDS.checking,
  ACCOUNT_IDS.emergencyFund,
  ACCOUNT_IDS.hsa,
  ACCOUNT_IDS.investments,
  ACCOUNT_IDS.retirement401k
];

test('GUI-A08/G08: a captured opening snapshot keeps its exact IDs, date, measurement and observed $0 debt across pagehide/reload while a legacy asset-only history entry stays asset-only and the signed report reads the $1,000 account', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, snapshotIdentityScenario());
  await expectCleanSeed(page);

  // The seeded history entry is asset-only: the chart labels the series
  // "Account/assets history", never "Net worth history".
  await openNetWorth(page);
  await expect(page.getByText('Account/assets history', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Account/assets history over time' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Net worth history over time' })).toHaveCount(0);

  // Capture the opening observation through the real UI.
  await snapshotSection(page).getByRole('button', { name: 'Capture opening values' }).click();

  // Capture copies the configured values and defaults to the signed basis.
  const asOf = snapshotSection(page).getByLabel('As of date');
  const measurement = snapshotSection(page).getByLabel('Measurement');
  const observedLiability = snapshotSection(page).getByLabel(`Observed balance for ${LIABILITY_ID}`);
  await expect(asOf).toHaveValue(AS_OF_DATE);
  await expect(measurement).toHaveValue('assetsMinusLiabilities');
  await expect(observedLiability).toHaveValue(String(CONFIGURED_LIABILITY_DOLLARS));
  await expect(snapshotSection(page)).toContainText('Checking');

  // The observed $0 must win over the configured $300 — recorded explicitly.
  await observedLiability.fill(String(OBSERVED_LIABILITY_DOLLARS));
  await expect(observedLiability).toHaveValue('0');

  // The basis selector is exposed: exercise it and keep the chosen value so the
  // persisted identity carries the non-default measurement exactly.
  await measurement.selectOption({ label: 'Assets only' });
  await expect(measurement).toHaveValue('assetOnly');

  // pagehide flushes the debounced autosave synchronously; reload hydrates the
  // canonical bytes that were written.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await expectCleanSeed(page);

  // Snapshot identity survives the reload in the UI.
  await openNetWorth(page);
  await expect(snapshotSection(page).getByLabel('As of date')).toHaveValue(AS_OF_DATE);
  await expect(snapshotSection(page).getByLabel('Measurement')).toHaveValue('assetOnly');
  await expect(snapshotSection(page).getByLabel(`Observed balance for ${LIABILITY_ID}`)).toHaveValue('0');

  // ... and in the persisted v3 bytes: exact IDs, date, chosen measurement and
  // observed 0 (never the configured 300).
  const persisted = await readPersistedScenario(page);
  const snapshot = persisted.netWorth?.openingSnapshot;
  expect(snapshot).toBeTruthy();
  expect(snapshot!.date).toBe(AS_OF_DATE);
  expect(snapshot!.measurement).toBe('assetOnly');
  expect((snapshot!.accounts ?? []).map((value) => value.accountId)).toEqual(EXPECTED_ACCOUNT_IDS);
  expect((snapshot!.accounts ?? []).find((value) => value.accountId === ACCOUNT_IDS.checking)?.balance).toBe(
    CHECKING_DOLLARS
  );
  expect((snapshot!.liabilities ?? []).map((value) => value.liabilityId)).toEqual([LIABILITY_ID]);
  expect((snapshot!.liabilities ?? [])[0]?.balance).toBe(OBSERVED_LIABILITY_DOLLARS);
  expect((snapshot!.liabilities ?? [])[0]?.balance).not.toBe(CONFIGURED_LIABILITY_DOLLARS);

  // The legacy history entry is still explicitly asset-only, unchanged, and
  // never reinterpreted as signed net worth.
  const historyEntry = (persisted.netWorth?.history ?? []).find((entry) => entry.id === HISTORY_ID);
  expect(historyEntry).toBeTruthy();
  expect(historyEntry!.measurement).toBe('assetOnly');
  expect(historyEntry!.provenance).toBe('manual');
  expect(historyEntry!.date).toBe(HISTORY_DATE);
  expect(historyEntry!.totalNetWorth).toBe(CHECKING_DOLLARS);
  await expect(page.getByText('Account/assets history', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Net worth history over time' })).toHaveCount(0);

  // The signed report still reads the full $1,000 account: the observed $0 debt
  // wins over the configured $300, so net worth is NOT $700.
  await openTimeline(page);
  const closingCol = await headerIndex(page, 'Closing net worth');
  const assetsCol = await headerIndex(page, 'Assets');
  const closingCell = (row: ReturnType<typeof yearRow>) => row.locator('td').nth(closingCol - 1);
  const assetsCell = (row: ReturnType<typeof yearRow>) => row.locator('td').nth(assetsCol - 1);

  await expect(closingCell(yearRow(page, '2026'))).toHaveText(tableCurrency(CHECKING_DOLLARS));
  await expect(assetsCell(yearRow(page, '2026'))).toHaveText(tableCurrency(CHECKING_DOLLARS));
  // Stability across the horizon: no schedule and a 0% rate keep the observed $0
  // debt from accruing.
  await expect(closingCell(resultsTable(page).locator('tbody tr').last())).toHaveText(tableCurrency(CHECKING_DOLLARS));

  expect(errors).toEqual([]);
});
