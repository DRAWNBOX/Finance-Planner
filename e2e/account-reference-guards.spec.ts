import { test, expect, type Page } from '@playwright/test';
import type { LargePurchase, Scenario, Timeline } from '../src/types';
import {
  ACCOUNT_IDS,
  FIXED_NOW,
  SCHEMA_VERSION,
  STORAGE_KEY,
  collectErrors,
  createDefaultScenario,
  expectCleanSeed,
  mainNav,
  readStoredBytes,
  saveIndicator,
  seedScenario,
  waitForSaved
} from './fixtures';

/**
 * Bounded real-Chromium GUI-A01/G01/G37 account-reference and D24 save-lifecycle
 * flows.
 *
 * Honesty note: these specs drive the real `AccountManagementEditor` and the App
 * save indicator in Chromium and assert deterministic UI strings plus canonical
 * schema-v3 storage bytes. They do NOT certify the GUI-A01–A10/G01–G40 or
 * CA01–CA13 matrices; Vitest remains the owner of the per-item account-removal /
 * future-version engine flows (`src/commands.test.ts` "account CRUD / deletion
 * cleanup", `src/App.test.tsx` "preserves newer-version bytes").
 *
 * Determinism:
 * - Every test runs in a fresh Playwright context, seeds canonical v3 bytes
 *   through the app's own codec via `seedScenario`, and pins the clock before
 *   navigation. No real browser profile is touched.
 * - No numeric math claims: assertions read only role/aria UI state and raw
 *   persisted bytes.
 */

const INACTIVE_TIMELINE_ID = 'timeline-inactive-hsa';
const INACTIVE_TIMELINE_LABEL = 'Inactive HSA plan';

/** The account card whose display-color input is labelled for the HSA account. */
const accountCardByColorLabel = (page: Page, label: string) =>
  page.locator('.account-card', { has: page.getByLabel(`${label} display color`) });

/** A valid scenario whose global funding primary is HSA and whose inactive
 * named timeline still references HSA through a purchase source line. */
const scenarioWithHsaReferences = (): Scenario => {
  const scenario = createDefaultScenario(FIXED_NOW);

  const basePolicy = scenario.fundingPolicy ?? { primaryAccountId: null, fallbackAccountIds: [] };
  scenario.fundingPolicy = {
    ...basePolicy,
    primaryAccountId: ACCOUNT_IDS.hsa,
    fallbackAccountIds: [ACCOUNT_IDS.emergencyFund]
  };

  const hsaPurchase: LargePurchase = {
    id: 'timeline-hsa-purchase',
    label: 'HSA-funded purchase',
    enabled: true,
    showOnGraph: true,
    yearMonth: '2027-01',
    age: 46,
    amount: 5000,
    fundingSource: `account:${ACCOUNT_IDS.hsa}`,
    sourceLines: [
      {
        id: `source-${ACCOUNT_IDS.hsa}`,
        enabled: true,
        accountId: ACCOUNT_IDS.hsa,
        sourceType: 'account',
        sourceId: ACCOUNT_IDS.hsa,
        mode: 'amount',
        amount: 5000
      }
    ]
  };

  const inactiveTimeline: Timeline = {
    id: INACTIVE_TIMELINE_ID,
    label: INACTIVE_TIMELINE_LABEL,
    purchases: [hsaPurchase],
    longTermPurchases: [],
    loans: [],
    creditCards: [],
    cardPlans: [],
    careerPlan: { enabled: false, entries: [] },
    housing: []
  };
  scenario.timelines = [inactiveTimeline];

  return scenario;
};

interface PersistedShape {
  schemaVersion?: number;
  scenario?: {
    netWorth?: { accounts?: Array<{ id?: string }> };
    fundingPolicy?: { primaryAccountId?: string | null; fallbackAccountIds?: string[] };
    timelines?: Array<{
      id?: string;
      label?: string;
      purchases?: Array<{
        fundingSource?: string;
        sourceLines?: Array<{ accountId?: string; sourceId?: string }>;
      }>;
    }>;
  };
}

test('GUI-A01/G01/G37: removing the HSA account clears its global and inactive-timeline funding refs without redirecting to Checking', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, scenarioWithHsaReferences());
  await expectCleanSeed(page);

  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts & funding' })).toBeVisible();

  // Identify the HSA card by its own label; never assume it is the first card.
  const hsaCard = accountCardByColorLabel(page, 'HSA');
  await expect(hsaCard).toHaveCount(1);
  await expect(hsaCard.getByLabel('Account name')).toHaveValue('HSA');

  // The global funding order shows HSA as primary before removal.
  await expect(page.getByLabel('Primary account', { exact: true })).toHaveValue(ACCOUNT_IDS.hsa);

  // Remove account -> confirmation -> remove.
  await hsaCard.getByRole('button', { name: 'Remove account' }).click();
  const confirm = hsaCard.getByRole('alert');
  await expect(confirm).toContainText('Remove this account?');
  await confirm.getByRole('button', { name: 'Remove account' }).click();

  await waitForSaved(page);

  // The HSA card is gone; every unrelated sibling account survives.
  await expect(page.getByLabel('HSA display color')).toHaveCount(0);
  await expect(page.getByLabel('Checking display color')).toHaveCount(1);
  await expect(page.getByLabel('Emergency Fund display color')).toHaveCount(1);
  await expect(page.getByLabel('Investments display color')).toHaveCount(1);
  await expect(page.getByLabel('401K display color')).toHaveCount(1);

  // Global reference is cleared to "none" (never silently redirected to
  // Checking), while the unrelated fallback sibling is preserved.
  await expect(page.getByLabel('Primary account', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Fallback 1', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);
  // A cleaned reference is not a dangling/orphaned one.
  await expect(page.locator('.funding-policy-alert')).toHaveCount(0);

  // Persisted bytes: HSA removed, global refs cleaned, inactive timeline refs
  // cleaned exactly per the canonical `removeAccount` contract, siblings kept.
  const raw = await readStoredBytes(page);
  expect(raw).not.toBeNull();
  const persisted = JSON.parse(raw as string) as PersistedShape;
  expect(persisted.schemaVersion).toBe(SCHEMA_VERSION);

  const accountIds = (persisted.scenario?.netWorth?.accounts ?? []).map((account) => account.id);
  expect(accountIds).not.toContain(ACCOUNT_IDS.hsa);
  expect(accountIds).toEqual(
    expect.arrayContaining([
      ACCOUNT_IDS.checking,
      ACCOUNT_IDS.emergencyFund,
      ACCOUNT_IDS.investments,
      ACCOUNT_IDS.retirement401k
    ])
  );

  expect(persisted.scenario?.fundingPolicy?.primaryAccountId).toBeNull();
  expect(persisted.scenario?.fundingPolicy?.fallbackAccountIds).toEqual([ACCOUNT_IDS.emergencyFund]);

  const timeline = (persisted.scenario?.timelines ?? []).find((entry) => entry.id === INACTIVE_TIMELINE_ID);
  expect(timeline).toBeTruthy();
  expect(timeline?.label).toBe(INACTIVE_TIMELINE_LABEL);
  const purchase = timeline?.purchases?.[0];
  expect(purchase).toBeTruthy();
  expect(purchase?.fundingSource).toBeUndefined();
  expect(purchase?.sourceLines?.[0]?.accountId).toBeUndefined();
  expect(purchase?.sourceLines?.[0]?.sourceId).toBe('');

  // The cleanup survives a reload of the saved v3 bytes.
  await page.reload();
  await expectCleanSeed(page);
  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();
  await expect(page.getByLabel('HSA display color')).toHaveCount(0);
  await expect(page.getByLabel('Primary account', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Fallback 1', { exact: true })).toHaveValue(ACCOUNT_IDS.emergencyFund);

  expect(errors).toEqual([]);
});

test('D24: a newer-version payload shows "Newer plan preserved" and survives an automatic edit and pagehide flush', async ({ page }) => {
  const errors = collectErrors(page);
  await seedScenario(page, createDefaultScenario(FIXED_NOW));
  await expectCleanSeed(page);

  // Test-only mutation of the isolated context's localStorage: bump the payload
  // to schema CURRENT+1. This never touches a real browser profile.
  const futureVersion = SCHEMA_VERSION + 1;
  const futureBytes = await page.evaluate(
    ({ key, version }) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        throw new Error('expected seeded canonical bytes');
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.schemaVersion = version;
      const mutated = JSON.stringify(parsed);
      window.localStorage.setItem(key, mutated);
      return mutated;
    },
    { key: STORAGE_KEY, version: futureVersion }
  );

  await page.reload();

  // The future-version payload is recognized and preserved, never reinterpreted.
  await expect(saveIndicator(page)).toHaveText('Newer plan preserved');
  // A reset exists but is deliberately never used in this test.
  await expect(page.getByRole('button', { name: 'Reset plan' })).toBeVisible();

  // An automatic edit schedules a debounced write; let the window elapse.
  await mainNav(page).getByRole('button', { name: 'Net Worth' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts & funding' })).toBeVisible();
  await page.getByLabel('Annual return').first().fill('3');
  await page.waitForTimeout(700);

  // pagehide forces the autosave controller to flush any pending write.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  // The automatic writes were refused: bytes are untouched, byte-for-byte.
  expect(await readStoredBytes(page)).toBe(futureBytes);
  const stillFuture = JSON.parse((await readStoredBytes(page)) as string) as { schemaVersion?: number };
  expect(stillFuture.schemaVersion).toBe(futureVersion);
  await expect(saveIndicator(page)).toHaveText('Newer plan preserved');

  // The preservation guard survives a further reload.
  await page.reload();
  await expect(saveIndicator(page)).toHaveText('Newer plan preserved');
  expect(await readStoredBytes(page)).toBe(futureBytes);

  expect(errors).toEqual([]);
});
