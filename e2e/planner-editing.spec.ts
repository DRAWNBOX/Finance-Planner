import { test, expect, type Page } from '@playwright/test';
import type { ExpenseEntry, Scenario } from '../src/types';
import {
  ACCOUNT_IDS,
  FIXED_NOW,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  readStoredBytes,
  seedScenario,
  waitForSaved
} from './fixtures';

/**
 * GUI-A07 / G27 — occurrence integrity in the account expense planner.
 *
 * Bounded Chromium flows for the weekly planner grid's keyboard schedule edits:
 * a keyboard **move** rewrites the original planned occurrence's date (no
 * duplicate, no stale quote), and a keyboard **copy** adds a separate planned
 * occurrence with a distinct id. Occurred imports stay view-only, cannot be moved
 * or copied, and never join the quoted weekly summary.
 *
 * Honesty note: these are bounded browser flows over a canonical v3 seed via
 * `seedScenario`; they do NOT certify the GUI-A/G or CA matrices — Vitest remains
 * the owner of those per-item engine flows (`src/App.test.tsx`,
 * `src/components/AccountExpensesPlanner.test.tsx`, `src/engine/planner.test.ts`).
 *
 * Determinism:
 * - Fresh Playwright context (blank localStorage); the clock is pinned through
 *   `seedScenario` before the first navigation (fixed UI clock 2026-10-14), the
 *   engine start date stays explicit (`netWorth.asOfDate` = 2026-06-15), and all
 *   dates are literal. Role/label locators with Playwright auto-retry, no sleeps.
 * - Hand-computed cents from the fixture (never read back from report output):
 *   planned $25 = Emergency Fund $10 primary + Checking $15 fallback; the occurred
 *   $99 import is not scheduled. One moved occurrence stays $25 requested / $25
 *   paid / $15 paid-from-Checking / Checking close $85.00. One copied occurrence
 *   makes it $50 requested / $50 paid / $40 paid-from-Checking / Checking close
 *   $60.00.
 */

/** The local-noon fixed UI clock for the planner week (Wed 2026-10-14). */
const PLANNER_NOW = new Date(2026, 9, 14, 12, 0, 0);

/** Fresh canonical scenario at the engine reference date (start 2026-06-15). */
const scenarioWith = (mutate: (scenario: Scenario) => void): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  mutate(scenario);
  return scenario;
};

/** A seeded Checking plan: $25 on Wed 2026-10-14, Emergency Fund primary. */
const plannedEntry: ExpenseEntry = {
  id: 'plan-week-25',
  label: 'Week groceries',
  amount: 25,
  startDate: '2026-10-14',
  endDate: '2026-10-14',
  accountId: ACCOUNT_IDS.checking,
  notes: '',
  originType: 'manual',
  importSourceId: null,
  importBatchId: null,
  createdAt: '2026-06-01',
  updatedAt: '2026-06-01',
  categoryId: 'food',
  provenance: 'planner',
  planningStatus: 'planned',
  // Explicit ordered source: Emergency Fund ($10) primary, Checking ($15) fallback.
  fundingSource: `account:${ACCOUNT_IDS.emergencyFund}`
};

/** A seeded occurred import sibling: $99 on Tue 2026-10-13, permanently view-only. */
const occurredEntry: ExpenseEntry = {
  id: 'imp-week-99',
  label: 'Imported meal',
  amount: 99,
  startDate: '2026-10-13',
  endDate: '2026-10-13',
  accountId: ACCOUNT_IDS.checking,
  notes: '',
  originType: 'imported',
  importSourceId: 'src',
  importBatchId: 'batch',
  createdAt: '2026-06-01',
  updatedAt: '2026-06-01',
  categoryId: 'food',
  provenance: 'imported',
  planningStatus: 'occurred',
  sourceDate: '2026-10-13',
  sourceSign: 'debit',
  asOf: '2026-10-20'
};

/** Canonical scenario: 0% growth (Checking $100, Emergency Fund $10), no career. */
const plannerScenario = (): Scenario =>
  scenarioWith((next) => {
    next.careerPlan = { enabled: false, entries: [] };
    next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
      ...account,
      openingBalance: account.id === ACCOUNT_IDS.checking ? 100 : account.id === ACCOUNT_IDS.emergencyFund ? 10 : 0
    }));
    next.expenses = {
      ...next.expenses,
      activePlanningAccountId: ACCOUNT_IDS.checking,
      categoriesByAccountId: { [ACCOUNT_IDS.checking]: [{ id: 'food', label: 'Food' }] },
      entries: [plannedEntry, occurredEntry]
    };
  });

const openPlanner = async (page: Page): Promise<void> => {
  await mainNav(page).getByRole('button', { name: 'Expenses' }).click();
  await expect(page.getByRole('heading', { name: 'Plan expenses by account' })).toBeVisible();
};

const outcomesRegion = (page: Page) =>
  page.getByRole('region', { name: 'This week observed planner outcomes' });

const stat = (page: Page, label: string) =>
  outcomesRegion(page).locator('dl > div').filter({ hasText: label }).locator('dd');

const balanceRegion = (page: Page) => page.getByRole('region', { name: 'Monthly funded balance' });

const plannedCard = (page: Page) => page.getByRole('article').filter({ hasText: plannedEntry.label });

const occurredCard = (page: Page) => page.getByRole('article').filter({ hasText: occurredEntry.label });

const foodCell = (page: Page, day: string) => page.getByLabel(`Food, ${day}`);

/** Parses the persisted canonical scenario's `expenses` config. */
const storedExpenses = async (page: Page) => {
  const raw = (await readStoredBytes(page)) as string;
  return (JSON.parse(raw) as { scenario: Scenario }).scenario.expenses;
};

test('GUI-A07 / G27: keyboard move rewrites the original planned occurrence date (no duplicate) and the moved single id/provenance survives save/reload', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, plannerScenario(), PLANNER_NOW);
  await expectCleanSeed(page);
  await openPlanner(page);

  // The pinned UI clock puts the planner week at 2026-10-11 – 2026-10-17.
  await expect(outcomesRegion(page)).toContainText('2026-10-11 – 2026-10-17');

  // Hand-computed baseline: $25 requested, $25 paid across accounts, $15 from
  // selected Checking; the occurred $99 sibling is never quoted.
  await expect(stat(page, 'Requested')).toHaveText('$25.00');
  await expect(stat(page, 'Paid · all accounts')).toHaveText('$25.00');
  await expect(stat(page, 'Paid from selected account')).toHaveText('$15.00');
  await expect(outcomesRegion(page)).not.toContainText('$99.00');

  // The planned card starts on Wed 2026-10-14; the occurred import on 2026-10-13.
  await expect(plannedCard(page)).toBeVisible();
  await expect(foodCell(page, '2026-10-14').getByText(plannedEntry.label)).toBeVisible();
  await expect(foodCell(page, '2026-10-13').getByText(occurredEntry.label)).toBeVisible();

  // Keyboard M on the planned card, then Enter on the target date cell.
  await plannedCard(page).press('m');
  await expect(page.getByText(/Move ready/)).toBeVisible();
  await foodCell(page, '2026-10-16').press('Enter');
  await expect(page.getByText('Moved to 2026-10-16.')).toBeVisible();

  // The original occurrence moved; it did not duplicate.
  await expect(foodCell(page, '2026-10-16').getByText(plannedEntry.label)).toBeVisible();
  await expect(foodCell(page, '2026-10-14')).not.toContainText(plannedEntry.label);

  // The report-funded summary reflects the moved date without reusing a stale
  // quote: still exactly one $25 occurrence (never $50).
  await expect(stat(page, 'Requested')).toHaveText('$25.00');
  await expect(stat(page, 'Paid · all accounts')).toHaveText('$25.00');
  await expect(stat(page, 'Paid from selected account')).toHaveText('$15.00');
  // Checking close 100.00 − 15.00 = $85.00 in October.
  await expect(balanceRegion(page).locator('li').filter({ hasText: 'Oct 2026' })).toContainText('$85.00');

  await waitForSaved(page);

  // Canonical bytes: one moved planned identity, provenance untouched, no clone.
  const afterMove = await storedExpenses(page);
  expect(afterMove.entries).toHaveLength(2);
  const moved = afterMove.entries.find((entry) => entry.id === plannedEntry.id);
  expect(moved).toMatchObject({
    id: 'plan-week-25',
    startDate: '2026-10-16',
    endDate: '2026-10-16',
    amount: 25,
    provenance: 'planner',
    planningStatus: 'planned',
    originType: 'manual'
  });
  expect(afterMove.entries.find((entry) => entry.id === occurredEntry.id)).toMatchObject({
    id: 'imp-week-99',
    startDate: '2026-10-13',
    provenance: 'imported',
    planningStatus: 'occurred'
  });

  // Reload hydrates the moved single identity from canonical bytes.
  await page.reload();
  await expectCleanSeed(page);
  await openPlanner(page);
  await expect(foodCell(page, '2026-10-16').getByText(plannedEntry.label)).toBeVisible();
  await expect(foodCell(page, '2026-10-14')).not.toContainText(plannedEntry.label);
  await expect(foodCell(page, '2026-10-13').getByText(occurredEntry.label)).toBeVisible();

  const afterReload = await storedExpenses(page);
  expect(afterReload.entries.filter((entry) => entry.id === plannedEntry.id)).toHaveLength(1);
  expect(afterReload.entries.find((entry) => entry.id === plannedEntry.id)).toMatchObject({
    startDate: '2026-10-16',
    endDate: '2026-10-16',
    provenance: 'planner',
    planningStatus: 'planned'
  });

  expect(errors).toEqual([]);
});

test('GUI-A07 / G27: keyboard copy adds a separate planned occurrence with a distinct id, while the occurred import cannot be moved or copied and stays unquoted', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, plannerScenario(), PLANNER_NOW);
  await expectCleanSeed(page);
  await openPlanner(page);

  // --- Occurred import is permanently view-only and unquoted ---------------
  await expect(occurredCard(page)).toBeVisible();
  await expect(page.getByText('Occurred · view only')).toBeVisible();
  // No copy/move affordance is rendered on an occurred card.
  await expect(occurredCard(page).getByRole('button', { name: `Copy ${occurredEntry.label}` })).toHaveCount(0);
  await expect(occurredCard(page).getByRole('button', { name: `Move ${occurredEntry.label} to 2026-10-14` })).toHaveCount(0);
  await expect(outcomesRegion(page)).not.toContainText('$99.00');

  // Keyboard C/M on the occurred card arms nothing; Enter on a cell adds nothing.
  await occurredCard(page).press('m');
  await occurredCard(page).press('c');
  await expect(page.getByText(/Move ready/)).toHaveCount(0);
  await expect(page.getByText(/Copy ready/)).toHaveCount(0);
  await foodCell(page, '2026-10-15').press('Enter');
  await expect(stat(page, 'Requested')).toHaveText('$25.00');
  await expect(foodCell(page, '2026-10-15')).not.toContainText(plannedEntry.label);

  // --- Keyboard copy creates a separate planned occurrence -----------------
  await plannedCard(page).press('c');
  await expect(page.getByText(/Copy ready/)).toBeVisible();
  await foodCell(page, '2026-10-15').press('Enter');
  await expect(page.getByText('A separate planned copy was added.')).toBeVisible();

  // Original remains on 2026-10-14; a distinct planned copy sits on 2026-10-15.
  await expect(foodCell(page, '2026-10-14').getByText(plannedEntry.label)).toBeVisible();
  await expect(foodCell(page, '2026-10-15').getByText(plannedEntry.label)).toBeVisible();

  // One additional dated occurrence raises requested exactly once ($25 → $50),
  // and the funding split is Emergency Fund $10 + Checking $15 (first) then
  // Checking $25 (second): $40 paid from the selected Checking account.
  await expect(stat(page, 'Requested')).toHaveText('$50.00');
  await expect(stat(page, 'Paid · all accounts')).toHaveText('$50.00');
  await expect(stat(page, 'Paid from selected account')).toHaveText('$40.00');
  // Checking close 100.00 − 15.00 − 25.00 = $60.00 in October.
  await expect(balanceRegion(page).locator('li').filter({ hasText: 'Oct 2026' })).toContainText('$60.00');
  // The occurred $99 sibling still never joins the quoted summary.
  await expect(outcomesRegion(page)).not.toContainText('$99.00');

  await waitForSaved(page);

  // Canonical bytes: the original is untouched, the copy has a distinct id and
  // planner provenance, and the occurred import is unchanged.
  const stored = await storedExpenses(page);
  expect(stored.entries).toHaveLength(3);
  expect(stored.entries.find((entry) => entry.id === plannedEntry.id)).toMatchObject({
    id: 'plan-week-25',
    startDate: '2026-10-14',
    provenance: 'planner',
    planningStatus: 'planned'
  });
  expect(stored.entries.find((entry) => entry.id === occurredEntry.id)).toMatchObject({
    id: 'imp-week-99',
    startDate: '2026-10-13',
    provenance: 'imported',
    planningStatus: 'occurred'
  });
  const copies = stored.entries.filter(
    (entry) => entry.id !== plannedEntry.id && entry.id !== occurredEntry.id
  );
  expect(copies).toHaveLength(1);
  expect(copies[0]).toMatchObject({
    label: plannedEntry.label,
    amount: 25,
    startDate: '2026-10-15',
    endDate: '2026-10-15',
    accountId: ACCOUNT_IDS.checking,
    categoryId: 'food',
    originType: 'manual',
    provenance: 'planner',
    planningStatus: 'planned',
    sourceDate: null,
    sourceSign: null,
    asOf: null
  });
  expect(copies[0].id).not.toBe(plannedEntry.id);

  expect(errors).toEqual([]);
});
