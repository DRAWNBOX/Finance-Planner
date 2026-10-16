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
  seedScenario,
  waitForSaved
} from './fixtures';

/**
 * Bounded real-Chromium GUI-A02/G05/G06 retirement-withdrawal-source flow.
 *
 * Honesty note: this drives the real `RetirementSpendingEditor` (add source,
 * choose account, configurable rate incl. explicit 0/6%, first withdrawal date,
 * optional balance valuation date, payment day, and the plan min/max limits) over
 * canonical v3 bytes seeded through the app's own allowlisted codec. It proves
 * the *input-derived configuration* round-trips across `pagehide`/reload. It does
 * NOT certify the GUI-A02/G05/G06 matrices and it does NOT re-derive the engine
 * target math — that remains `src/engine/retirement.test.ts`'s job.
 *
 * Numeric-preview limitation (reported, not invented): the app's `ResultsTable`
 * is yearly-only (`showMonths` defaults to `false` at every mount in `App.tsx`),
 * and no retirement view renders a per-month or per-source schedule. So the July
 * `$10,000 × 4% / 12` first share is **not exposed by any report selector** —
 * neither the yearly "Paid" cell nor the chart is the July actual paid. This spec
 * therefore asserts no month-level dollar figure and invents no preview.
 *
 * Determinism:
 * - Fresh isolated Chromium context per test; the clock is pinned before the
 *   first navigation by `seedScenario`, and the seed is written once (no
 *   repeating `addInitScript`). No arbitrary sleeps — waits are web-first
 *   assertions on role locators or the debounced save-status indicator, and the
 *   persisted shape is read from raw v3 bytes after a synchronous `pagehide`
 *   flush. No real browser profile is touched.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Canonical career-free plan whose only asset is a positive `$10,000` 401K with
 * `0%` growth: no income stream, no appreciation, and every other account opens
 * at `$0`. The retirement-withdrawal configuration is the only moving part, so
 * any persisted change is unambiguously the editor's own input.
 */
const noCareerTenThousandScenario = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);
  scenario.careerPlan = { enabled: false, entries: [] };
  scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: account.id === ACCOUNT_IDS.retirement401k ? 10000 : 0,
    // 0% growth on every account; no retirement-rate override.
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  return scenario;
};

interface PersistedSource {
  id?: string;
  accountId?: string;
  mode?: string;
  initialWithdrawalRatePercent?: number;
  firstWithdrawalDate?: string;
  initialWithdrawalValuationDate?: string | null;
  paymentDay?: number;
}

interface PersistedWithdrawal {
  minimumYearlyWithdrawal?: number;
  maximumYearlyWithdrawal?: number;
  sourceLines?: PersistedSource[];
}

interface PersistedShape {
  schemaVersion?: number;
  scenario?: { withdrawal?: PersistedWithdrawal };
}

/** The persisted withdrawal plan from raw canonical v3 bytes (asserts schema v3). */
const readWithdrawal = async (page: Page): Promise<PersistedWithdrawal> => {
  const raw = await readStoredBytes(page);
  expect(raw).not.toBeNull();
  const persisted = JSON.parse(raw as string) as PersistedShape;
  expect(persisted.schemaVersion).toBe(SCHEMA_VERSION);
  const withdrawal = persisted.scenario?.withdrawal;
  expect(withdrawal).toBeTruthy();
  return withdrawal as PersistedWithdrawal;
};

/** The withdrawal source whose `firstWithdrawalDate` is exactly `date`. */
const sourceStarting = (withdrawal: PersistedWithdrawal, date: string): PersistedSource => {
  const line = (withdrawal.sourceLines ?? []).find(
    (candidate) => candidate.firstWithdrawalDate === date
  );
  expect(line, `Expected a withdrawal source starting ${date}.`).toBeTruthy();
  return line as PersistedSource;
};

/** The withdrawal source `article`s (the plan-limits `<details>` is not an article). */
const sources = (page: Page) => page.locator('article.retirement-source');

/** Opens the collapsed "Plan withdrawal limits and inflation" details. */
const openLimits = async (page: Page): Promise<void> => {
  await page.locator('details.retirement-plan-limits summary').click();
};

/** Flushes the debounced autosave synchronously. */
const flushAutosave = async (page: Page): Promise<void> => {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
};

// ---------------------------------------------------------------------------
// GUI-A02/G05 — add a source, configurable rate (incl. explicit 0), dates and limits
// ---------------------------------------------------------------------------

test('GUI-A02/G05: an added retirement source keeps its account, explicit 0% rate, first/blank valuation dates, payment day and plan limits across pagehide/reload', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, noCareerTenThousandScenario());
  await expectCleanSeed(page);

  // Default boot lands on Options → Retirement: the editor plus the report table.
  await expect(page.getByRole('heading', { name: 'Plan account withdrawals' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Projection results' })).toBeVisible();
  await expect(sources(page)).toHaveCount(1);

  // Add a second source via the real UI button and target the new article.
  await page.getByRole('button', { name: 'Add withdrawal source' }).click();
  await expect(sources(page)).toHaveCount(2);
  const added = sources(page).nth(1);

  // A new source starts on the 401K at the contractual 4% (never 0).
  await expect(added.getByLabel('Withdraw from account')).toHaveValue(ACCOUNT_IDS.retirement401k);
  await expect(added.getByLabel('Withdrawal method')).toHaveValue('percentOfInitialBalance');
  await expect(added.getByLabel('Withdrawal rate')).toHaveValue('4');

  // The account is explicitly re-selected through the editor.
  await added.getByLabel('Withdraw from account').selectOption({ label: '401K' });
  await expect(added.getByLabel('Withdraw from account')).toHaveValue(ACCOUNT_IDS.retirement401k);

  // An explicit 0% is honored (it is not silently coerced to the 4% default).
  await added.getByLabel('Withdrawal rate').fill('0');
  await expect(added.getByLabel('Withdrawal rate')).toHaveValue('0');

  // First withdrawal date first, then explicitly blank the optional valuation date
  // (setting the first date first avoids the editor's auto-mirror of the valuation).
  await added.getByLabel('First withdrawal date', { exact: true }).fill('2026-07-01');
  await expect(added.getByLabel('First withdrawal date', { exact: true })).toHaveValue('2026-07-01');
  await added.getByLabel('Balance valuation date').fill('');
  await expect(added.getByLabel('Balance valuation date')).toHaveValue('');

  await added.getByLabel('Payment day').fill('15');
  await expect(added.getByLabel('Payment day')).toHaveValue('15');

  // Plan withdrawal limits live behind a collapsed details element.
  await openLimits(page);
  await page.getByLabel('Minimum yearly withdrawal').fill('1200');
  await page.getByLabel('Maximum yearly withdrawal').fill('4800');

  await waitForSaved(page);
  await flushAutosave(page);

  // Canonical v3 bytes carry the added source verbatim.
  const withdrawal = await readWithdrawal(page);
  expect(withdrawal.minimumYearlyWithdrawal).toBe(1200);
  expect(withdrawal.maximumYearlyWithdrawal).toBe(4800);
  expect(withdrawal.sourceLines).toHaveLength(2);

  const addedLine = sourceStarting(withdrawal, '2026-07-01');
  expect(addedLine.accountId).toBe(ACCOUNT_IDS.retirement401k);
  expect(addedLine.mode).toBe('percentOfInitialBalance');
  expect(addedLine.initialWithdrawalRatePercent).toBe(0);
  // A blank valuation date persists as an explicit `null` (uses the first date).
  expect(addedLine.initialWithdrawalValuationDate).toBeNull();
  expect(addedLine.paymentDay).toBe(15);

  // The pre-existing default source is untouched (its 4% is not clobbered).
  const defaultLine = (withdrawal.sourceLines ?? []).find(
    (candidate) => candidate.firstWithdrawalDate !== '2026-07-01'
  );
  expect(defaultLine?.initialWithdrawalRatePercent).toBe(4);

  // Everything is editable and intact after a reload of those bytes.
  await page.reload();
  await expectCleanSeed(page);

  const reloaded = sources(page).nth(1);
  await expect(reloaded.getByLabel('Withdraw from account')).toHaveValue(ACCOUNT_IDS.retirement401k);
  await expect(reloaded.getByLabel('Withdrawal rate')).toHaveValue('0');
  await expect(reloaded.getByLabel('First withdrawal date', { exact: true })).toHaveValue('2026-07-01');
  await expect(reloaded.getByLabel('Balance valuation date')).toHaveValue('');
  await expect(reloaded.getByLabel('Payment day')).toHaveValue('15');
  await openLimits(page);
  await expect(page.getByLabel('Minimum yearly withdrawal')).toHaveValue('1200');
  await expect(page.getByLabel('Maximum yearly withdrawal')).toHaveValue('4800');

  // The no-career plan still renders its chart, table and warnings panel.
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
  await expect(page.getByRole('region', { name: 'Projection chart' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Projection results' })).toBeVisible();

  await planSections(page).getByRole('button', { name: 'Warnings' }).click();
  await expect(page.getByRole('heading', { name: 'Plan checks' })).toBeVisible();
  await expect(page.locator('.warning-panel')).toContainText(
    /Needs attention|Fallback used|No funding warnings in this plan/
  );

  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// GUI-A06 — explicit 6% and a later-start second source's own valuation date
// ---------------------------------------------------------------------------

test('GUI-A06: an explicit 6% rate and a later-start second source keep their own account, rate and valuation date independently across pagehide/reload', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, noCareerTenThousandScenario());
  await expectCleanSeed(page);

  await expect(page.getByRole('heading', { name: 'Plan account withdrawals' })).toBeVisible();

  // Source 1: 401K, explicit 6%, starts 2026-07-01 with its own explicit valuation date.
  await page.getByRole('button', { name: 'Add withdrawal source' }).click();
  const first = sources(page).nth(1);
  await first.getByLabel('Withdraw from account').selectOption({ label: '401K' });
  await first.getByLabel('Withdrawal rate').fill('6');
  await expect(first.getByLabel('Withdrawal rate')).toHaveValue('6');
  await first.getByLabel('First withdrawal date', { exact: true }).fill('2026-07-01');
  await first.getByLabel('Balance valuation date').fill('2026-07-01');
  await expect(first.getByLabel('Balance valuation date')).toHaveValue('2026-07-01');

  // Source 2: a distinct later start, its own explicit valuation date, 4% rate.
  await page.getByRole('button', { name: 'Add withdrawal source' }).click();
  await expect(sources(page)).toHaveCount(3);
  const second = sources(page).nth(2);
  await second.getByLabel('Withdraw from account').selectOption({ label: '401K' });
  await expect(second.getByLabel('Withdrawal rate')).toHaveValue('4');
  await second.getByLabel('First withdrawal date', { exact: true }).fill('2027-01-01');
  await second.getByLabel('Balance valuation date').fill('2027-01-01');
  await expect(second.getByLabel('Balance valuation date')).toHaveValue('2027-01-01');

  await waitForSaved(page);
  await flushAutosave(page);

  // Each source persists its own account, rate and valuation date — no bleed.
  const withdrawal = await readWithdrawal(page);
  expect(withdrawal.sourceLines).toHaveLength(3);

  const julySource = sourceStarting(withdrawal, '2026-07-01');
  expect(julySource.accountId).toBe(ACCOUNT_IDS.retirement401k);
  expect(julySource.initialWithdrawalRatePercent).toBe(6);
  expect(julySource.initialWithdrawalValuationDate).toBe('2026-07-01');

  const januarySource = sourceStarting(withdrawal, '2027-01-01');
  expect(januarySource.accountId).toBe(ACCOUNT_IDS.retirement401k);
  expect(januarySource.initialWithdrawalRatePercent).toBe(4);
  expect(januarySource.initialWithdrawalValuationDate).toBe('2027-01-01');

  // The two sources' own valuation dates are genuinely distinct.
  expect(januarySource.initialWithdrawalValuationDate).not.toBe(julySource.initialWithdrawalValuationDate);

  await page.reload();
  await expectCleanSeed(page);

  const reloadedFirst = sources(page).nth(1);
  await expect(reloadedFirst.getByLabel('Withdrawal rate')).toHaveValue('6');
  await expect(reloadedFirst.getByLabel('First withdrawal date', { exact: true })).toHaveValue('2026-07-01');
  await expect(reloadedFirst.getByLabel('Balance valuation date')).toHaveValue('2026-07-01');

  const reloadedSecond = sources(page).nth(2);
  await expect(reloadedSecond.getByLabel('Withdrawal rate')).toHaveValue('4');
  await expect(reloadedSecond.getByLabel('First withdrawal date', { exact: true })).toHaveValue('2027-01-01');
  await expect(reloadedSecond.getByLabel('Balance valuation date')).toHaveValue('2027-01-01');

  // The no-career plan still projects (table renders; no crash on the two sources).
  await mainNav(page).getByRole('button', { name: 'Finances Prediction' }).click();
  await planSections(page).getByRole('button', { name: 'Timeline' }).click();
  await expect(page.getByRole('region', { name: 'Projection chart' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Projection results' })).toBeVisible();

  expect(errors).toEqual([]);
});
