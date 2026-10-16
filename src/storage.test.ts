import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultScenario } from './defaultScenario';
import {
  CURRENT_SCHEMA_VERSION,
  createDefaultUiState,
  getStorageStatus,
  loadAppState,
  saveAppState
} from './storage';
import type { ExpenseEntry } from './types';

/**
 * P1.7 storage-boundary acceptance tests (CA11 / TC05–TC08).
 *
 * These exercise the localStorage lifecycle only: the load/save guard, byte
 * preservation for blocked/corrupt payloads, no immediate hydration rewrite, and
 * byte-idempotent canonical saves. Structural codec behavior lives in
 * `src/codec.test.ts`.
 */

const STORAGE_KEY = 'finance-planner-state';
const REFERENCE_DATE = new Date('2026-01-15');

const storedBytes = (): string | null => window.localStorage.getItem(STORAGE_KEY);

const writeRaw = (raw: string): void => window.localStorage.setItem(STORAGE_KEY, raw);

describe('storage load/save lifecycle', () => {
  beforeEach(() => window.localStorage.clear());

  it('prunes a removed standalone contribution while retaining supported data', () => {
    const original = createDefaultScenario(REFERENCE_DATE);
    original.cashflowItems = [
      {
        id: 'other-income',
        category: 'pension_1',
        label: 'Other income',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        amount: 1200,
        startAge: 65,
        endAge: 90,
        accountId: 'investments-account-default'
      }
    ];
    const savedScenario = { ...original, contribution: { yearlyContribution: 17500, yearlyIncreaseRate: 2.9 } };

    for (const payload of [{ schemaVersion: CURRENT_SCHEMA_VERSION, scenario: savedScenario }, savedScenario]) {
      writeRaw(JSON.stringify(payload));
      const state = loadAppState(REFERENCE_DATE);

      expect(state.scenario).not.toHaveProperty('contribution');
      expect(state.scenario.careerPlan.entries[0].sourceLines).toEqual(
        expect.arrayContaining(original.careerPlan.entries[0].sourceLines!.map((line) => expect.objectContaining(line)))
      );
      expect(state.scenario.cashflowItems).toEqual(
        expect.arrayContaining([expect.objectContaining(original.cashflowItems[0])])
      );

      saveAppState(state);
      expect(JSON.parse(storedBytes()!).scenario).not.toHaveProperty('contribution');
    }
  });

  it('prunes the obsolete field on direct save without mutating the supplied state', () => {
    const state = structuredClone(loadAppState(REFERENCE_DATE));
    Object.assign(state.scenario, { contribution: { yearlyContribution: 5000, yearlyIncreaseRate: 1 } });
    saveAppState(state);

    expect(state.scenario).toHaveProperty('contribution');
    expect(JSON.parse(storedBytes()!).scenario).not.toHaveProperty('contribution');
  });

  it('does not restore removed defaults on first launch', () => {
    expect(createDefaultScenario(REFERENCE_DATE)).not.toHaveProperty('contribution');
    expect(loadAppState(REFERENCE_DATE).scenario).not.toHaveProperty('contribution');
  });
});

describe('independent load/reset instances (TC06)', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns independent state for repeated fresh loads and factory resets', () => {
    const a = loadAppState(REFERENCE_DATE);
    const b = loadAppState(REFERENCE_DATE);
    const reset = createDefaultScenario(REFERENCE_DATE);

    a.scenario.netWorth.accounts[0].openingBalance = 42;
    a.scenario.careerPlan.entries[0].sourceLines![0].contributionRate = 99;

    expect(b.scenario.netWorth.accounts[0].openingBalance).toBe(0);
    expect(b.scenario.careerPlan.entries[0].sourceLines![0].contributionRate).toBe(2);
    expect(reset.netWorth.accounts[0].openingBalance).toBe(0);
    expect(a.scenario).not.toBe(b.scenario);
  });

  it('load does not immediately rewrite the stored bytes (hydration contract)', () => {
    saveAppState({ scenario: createDefaultScenario(REFERENCE_DATE), ui: createDefaultUiState() });
    const before = storedBytes();
    loadAppState(REFERENCE_DATE);
    expect(storedBytes()).toBe(before);
  });
});

describe('future-version block and autosave guard (D2)', () => {
  beforeEach(() => window.localStorage.clear());

  it('blocks a newer schema and never overwrites the stored bytes', () => {
    const future = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION + 5,
      scenario: { profile: { currentAge: 99 } },
      ui: createDefaultUiState()
    });
    writeRaw(future);

    const loaded = loadAppState(REFERENCE_DATE);
    const status = getStorageStatus();
    expect(status.blocked).toBe(true);
    expect(status.blockedReason).toBe('future-schema-version');
    // Fresh defaults, not the future payload.
    expect(loaded.scenario.profile.currentAge).toBe(45);
    expect(storedBytes()).toBe(future);

    const fresh = { scenario: createDefaultScenario(REFERENCE_DATE), ui: createDefaultUiState() };
    saveAppState(fresh);
    expect(storedBytes()).toBe(future);

    // Even an explicit save must not clobber newer-version bytes.
    saveAppState(fresh, { explicitCanonical: true });
    expect(storedBytes()).toBe(future);
  });
});

describe('corrupt recovery and autosave guard (TC07)', () => {
  beforeEach(() => window.localStorage.clear());

  it('preserves unparseable bytes until an explicit canonical save', () => {
    const corrupt = '{ this is not json';
    writeRaw(corrupt);

    const loaded = loadAppState(REFERENCE_DATE);
    expect(getStorageStatus().corrupt).toBe(true);
    expect(loaded.scenario.netWorth.accounts).toHaveLength(5);
    expect(storedBytes()).toBe(corrupt);

    // Automatic save must not overwrite the unreadable bytes.
    saveAppState(loaded);
    expect(storedBytes()).toBe(corrupt);

    // An explicit canonical save replaces them and clears the corrupt status.
    saveAppState(loaded, { explicitCanonical: true });
    expect(storedBytes()).not.toBe(corrupt);
    expect(getStorageStatus().corrupt).toBe(false);
    expect(JSON.parse(storedBytes()!).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('treats a non-object root as corrupt and preserves its bytes on automatic save', () => {
    const badRoot = JSON.stringify([1, 2, 3]);
    writeRaw(badRoot);

    loadAppState(REFERENCE_DATE);
    expect(getStorageStatus().corrupt).toBe(true);

    saveAppState(loadAppState(REFERENCE_DATE));
    expect(storedBytes()).toBe(badRoot);
  });
});

describe('byte-idempotent canonical saves', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Reset the module-level save guard left by an earlier blocked/corrupt case.
    loadAppState(REFERENCE_DATE);
  });

  it('re-saves loaded canonical state byte-for-byte', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    scenario.netWorth.accounts[0].annualReturnRate = 5.5;
    scenario.netWorth.accounts[0].withdrawalPolicy.withdrawalTaxRate = 12;
    scenario.withdrawal.sourceLines![0].initialWithdrawalRatePercent = 0;

    saveAppState({ scenario, ui: createDefaultUiState() });
    const first = storedBytes();

    const once = loadAppState(REFERENCE_DATE);
    saveAppState(once);
    const second = storedBytes();

    const twice = loadAppState(REFERENCE_DATE);
    saveAppState(twice);
    const third = storedBytes();

    expect(second).toBe(first);
    expect(third).toBe(second);
  });

  it('preserves all new fields through a save/load/save cycle', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const account = scenario.netWorth.accounts[3];
    account.annualReturnRate = 6.5;
    account.retirementAnnualReturnRate = 4.25;
    account.color = '#abcdef';
    account.displayOrder = 9;
    account.assumedGainPercent = 20;
    account.capitalGainsTaxRate = 18;
    account.withdrawalPolicy.withdrawalTaxRate = 15;
    account.withdrawalPolicy.penaltyRate = 2;
    scenario.withdrawal.sourceLines![0].initialWithdrawalRatePercent = 0;

    saveAppState({ scenario, ui: createDefaultUiState() });
    const loaded = loadAppState(REFERENCE_DATE);
    saveAppState(loaded);
    const reloaded = loadAppState(REFERENCE_DATE).scenario;

    const roundTripped = reloaded.netWorth.accounts[3];
    expect(roundTripped.annualReturnRate).toBe(6.5);
    expect(roundTripped.retirementAnnualReturnRate).toBe(4.25);
    expect(roundTripped.color).toBe('#abcdef');
    expect(roundTripped.displayOrder).toBe(9);
    expect(roundTripped.assumedGainPercent).toBe(20);
    expect(roundTripped.capitalGainsTaxRate).toBe(18);
    expect(roundTripped.withdrawalPolicy.withdrawalTaxRate).toBe(15);
    expect(roundTripped.withdrawalPolicy.penaltyRate).toBe(2);
    expect(reloaded.withdrawal.sourceLines![0].initialWithdrawalRatePercent).toBe(0);
  });

  it('keeps an absent career-source cap absent through the storage save/load/save cycle (P0.4.2)', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const base = scenario.careerPlan.entries[0];
    base.depositPlan = {
      allocations: [
        {
          id: 'alloc-absent',
          enabled: true,
          sourceType: 'account',
          sourceId: 'investments-account-default',
          contributionRate: 5,
          savingsMonthly: false,
          monthlyWithdrawal: 0
        },
        {
          id: 'alloc-zero',
          enabled: true,
          sourceType: 'account',
          sourceId: 'investments-account-default',
          contributionRate: 5,
          savingsMonthly: false,
          monthlyWithdrawal: 0,
          maxBalance: 0
        }
      ],
      remainderAccountId: 'checking-account-default',
      postingDay: 1
    };

    saveAppState({ scenario, ui: createDefaultUiState() });
    const first = storedBytes()!;
    const savedAllocations = JSON.parse(first).scenario.careerPlan.entries[0].depositPlan.allocations;
    expect(savedAllocations[0]).not.toHaveProperty('maxBalance');
    expect(savedAllocations[1].maxBalance).toBe(0);

    const loaded = loadAppState(REFERENCE_DATE);
    const loadedAllocations = loaded.scenario.careerPlan.entries[0].depositPlan!.allocations;
    expect(loadedAllocations[0]).not.toHaveProperty('maxBalance');
    expect(loadedAllocations[0].maxBalance).toBeUndefined();
    expect(loadedAllocations[1].maxBalance).toBe(0);

    saveAppState(loaded);
    expect(storedBytes()).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Oracle storage regressions (owned by the codec lane; asserted here)
// ---------------------------------------------------------------------------

describe('save-boundary regressions', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Reset the module-level save guard left by an earlier blocked/corrupt case.
    loadAppState(REFERENCE_DATE);
  });

  it('never stamps missing dates with the 1970 epoch on save', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const expensesUi = scenario.expenses.ui as unknown as Record<string, unknown>;
    delete expensesUi.scrubberDate;
    delete expensesUi.windowStartDate;
    delete expensesUi.windowEndDate;

    saveAppState({ scenario, ui: createDefaultUiState() });

    const savedUi = JSON.parse(storedBytes()!).scenario.expenses.ui;
    for (const value of [savedUi.scrubberDate, savedUi.windowStartDate, savedUi.windowEndDate]) {
      expect(value).not.toMatch(/^19[67]/);
    }
  });

  it('prunes the derived paycheckInfo cache on save (D24)', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    saveAppState({ scenario, ui: createDefaultUiState() });

    const stored = JSON.parse(storedBytes()!);
    for (const entry of stored.scenario.careerPlan.entries) {
      expect(entry).not.toHaveProperty('paycheckInfo');
      expect(entry.paycheck).toBeDefined();
    }

    // Reloading re-derives the cache in memory.
    expect(loadAppState(REFERENCE_DATE).scenario.careerPlan.entries[0].paycheckInfo).toBeDefined();
  });

  it('rejects a save it cannot convert and preserves the stored bytes', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const career = scenario.careerPlan.entries[0] as unknown as Record<string, unknown>;
    delete career.paycheck;
    career.paycheckInfo = 'not-a-record';

    const existing = '{"schemaVersion":1,"scenario":{},"ui":{}}';
    writeRaw(existing);

    saveAppState({ scenario, ui: createDefaultUiState() });

    expect(storedBytes()).toBe(existing);
    expect(getStorageStatus().diagnostics.some((entry) => entry.code === 'paycheck-info-unconvertible')).toBe(true);
  });

  it('records a diagnostic when the storage write fails and keeps existing bytes', () => {
    const existing = '{"schemaVersion":1,"scenario":{},"ui":{}}';
    writeRaw(existing);

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      saveAppState({ scenario: createDefaultScenario(REFERENCE_DATE), ui: createDefaultUiState() });
    } finally {
      spy.mockRestore();
    }

    const status = getStorageStatus();
    const saveFailures = status.diagnostics.filter((entry) =>
      /sav|writ|storage|quota/i.test(`${entry.code} ${entry.message}`)
    );
    expect(saveFailures.length).toBeGreaterThan(0);
    expect(saveFailures.some((entry) => entry.severity === 'error' || entry.severity === 'warning')).toBe(true);
    expect(storedBytes()).toBe(existing);
  });
});

// ---------------------------------------------------------------------------
// TC07 / CA11 — a malformed nested record in an otherwise valid envelope is a
// record-local recovery, NOT a whole-payload corruption: valid siblings survive,
// a diagnostic is recorded, and an ordinary canonical save still writes. Only a
// whole unparseable/newer-version payload may suppress automatic saves.
// ---------------------------------------------------------------------------

describe('storage-boundary local malformed recovery (TC07 / CA11)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Reset the module-level save guard left by an earlier blocked/corrupt case.
    loadAppState(REFERENCE_DATE);
  });

  it('recovers a malformed nested record in an inactive timeline with a diagnostic without blocking an ordinary save', () => {
    const base = createDefaultScenario(REFERENCE_DATE);
    const envelope = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      scenario: {
        ...base,
        activeTimelineId: null,
        largePurchases: [
          {
            id: 'base-keep',
            label: 'Base purchase',
            enabled: true,
            showOnGraph: true,
            yearMonth: '2027-01',
            age: 0,
            amount: 100,
            categoryId: null
          }
        ],
        timelines: [
          {
            id: 'tl-inactive',
            label: 'Inactive plan',
            purchases: [
              {
                id: 'tl-keep',
                label: 'Keep',
                enabled: true,
                showOnGraph: true,
                yearMonth: '2027-06',
                age: 0,
                amount: 500,
                categoryId: null
              },
              // Malformed: a non-object entry (null) in the supported collection.
              null
            ],
            longTermPurchases: [],
            loans: [],
            creditCards: [],
            cardPlans: [],
            careerPlan: { enabled: true, entries: [] },
            housing: []
          }
        ]
      },
      ui: createDefaultUiState()
    });
    writeRaw(envelope);

    const loaded = loadAppState(REFERENCE_DATE);
    const status = getStorageStatus();

    // A local malformed record is neither a corrupt payload nor a blocked one.
    expect(status.corrupt).toBe(false);
    expect(status.blocked).toBe(false);

    // Valid base and sibling records are preserved.
    expect(loaded.scenario.largePurchases.find((purchase) => purchase.id === 'base-keep')?.amount).toBe(100);
    const timeline = loaded.scenario.timelines.find((entry) => entry.id === 'tl-inactive')!;
    expect(timeline.purchases).toHaveLength(2);
    expect(timeline.purchases.find((purchase) => purchase.id === 'tl-keep')?.amount).toBe(500);
    expect(timeline.purchases.find((purchase) => purchase.id === 'tl-keep')?.yearMonth).toBe('2027-06');

    // The malformed entry is safely recovered in place with a generated id.
    const recovered = timeline.purchases.find((purchase) => purchase.id !== 'tl-keep')!;
    expect(recovered.id).toBe('purchase-2');
    expect(recovered.amount).toBe(0);
    expect(recovered.yearMonth).toBe('');

    // The record-local recovery is reported as a non-blocking warning at its
    // original index — not swallowed, and not treated as whole-payload corruption.
    expect(status.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'malformed-record-recovered',
          severity: 'warning',
          path: 'timeline.purchases[1]'
        })
      ])
    );

    // An ordinary (non-explicit) canonical save still writes and does not corrupt
    // unrelated bytes: base and sibling records survive the round-trip.
    saveAppState(loaded);
    const savedBytes = storedBytes()!;
    expect(savedBytes).not.toBe(envelope);
    expect(getStorageStatus().blocked).toBe(false);

    const saved = JSON.parse(savedBytes);
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(saved.scenario.largePurchases.find((purchase: { id: string }) => purchase.id === 'base-keep').amount).toBe(100);
    const savedTimeline = saved.scenario.timelines.find((entry: { id: string }) => entry.id === 'tl-inactive');
    expect(savedTimeline.purchases).toHaveLength(2);
    expect(savedTimeline.purchases.map((purchase: { id: string }) => purchase.id).sort()).toEqual([
      'purchase-2',
      'tl-keep'
    ]);
    expect(savedTimeline.purchases.find((purchase: { id: string }) => purchase.id === 'tl-keep').amount).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Save-boundary provenance clearing (explicit `sourceSign: null`)
//
// A planner `copyTo` clone carries an explicit `null` sign. The storage save
// boundary must round-trip that null unchanged (never fabricating `'debit'`)
// while leaving a valid imported sibling sign intact, byte-idempotently.
// ---------------------------------------------------------------------------

describe('save-boundary provenance clearing (explicit null sourceSign)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Reset the module-level save guard left by an earlier blocked/corrupt case.
    loadAppState(REFERENCE_DATE);
  });

  const importedEntry: ExpenseEntry = {
    id: 'imp-credit',
    label: 'Imported credit',
    amount: 42,
    startDate: '2026-03-15',
    endDate: '2026-03-15',
    accountId: null,
    notes: '',
    originType: 'imported',
    importSourceId: 'src-1',
    importBatchId: 'batch-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    provenance: 'imported',
    planningStatus: 'occurred',
    sourceDate: '2026-03-15',
    sourceSign: 'credit',
    asOf: '2026-01-10T08:00:00.000Z'
  };

  const plannedCopy: ExpenseEntry = {
    id: 'copy-credit',
    label: 'Planned copy',
    amount: 42,
    startDate: '2026-04-01',
    endDate: '2026-04-01',
    accountId: null,
    notes: '',
    originType: 'manual',
    importSourceId: null,
    importBatchId: null,
    createdAt: '2026-04-01',
    updatedAt: '2026-04-01',
    provenance: 'planner',
    planningStatus: 'planned',
    sourceDate: null,
    sourceSign: null,
    asOf: null
  };

  it('preserves the explicit null copy sign and the import sibling sign through save/load/save', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    scenario.expenses.entries = [importedEntry, plannedCopy];

    saveAppState({ scenario, ui: createDefaultUiState() });
    const first = storedBytes()!;

    const savedEntries = JSON.parse(first).scenario.expenses.entries;
    const savedCopy = savedEntries.find((entry: { id: string }) => entry.id === 'copy-credit');
    const savedImport = savedEntries.find((entry: { id: string }) => entry.id === 'imp-credit');
    expect(savedCopy.sourceSign).toBeNull();
    expect(savedCopy.sourceSign).not.toBe('debit');
    expect(savedImport.sourceSign).toBe('credit');

    // save → load → save is byte-idempotent and keeps the cleared provenance.
    const loaded = loadAppState(REFERENCE_DATE);
    saveAppState(loaded);
    expect(storedBytes()).toBe(first);

    const reloadedEntries = loadAppState(REFERENCE_DATE).scenario.expenses.entries;
    const reloadedCopy = reloadedEntries.find((entry) => entry.id === 'copy-credit')!;
    const reloadedImport = reloadedEntries.find((entry) => entry.id === 'imp-credit')!;
    expect(reloadedCopy.sourceSign).toBeNull();
    expect(reloadedImport.sourceSign).toBe('credit');
  });
});
