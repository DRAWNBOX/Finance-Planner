import { describe, expect, it } from 'vitest';

import {
  CURRENT_SCHEMA_VERSION,
  createDefaultUiState,
  decodeAppState,
  encodeAppState
} from './codec';
import {
  createDefaultAccountWithdrawalPolicy,
  createDefaultHousingEntry,
  createDefaultLargePurchase,
  createDefaultOrdinaryCardSchedule,
  createDefaultRentalEntry,
  createDefaultRetirementWithdrawalSource,
  createDefaultScenario
} from './defaultScenario';
import { resolveOpening } from './engine/opening';
import {
  applyToActiveTimeline,
  clearDanglingMarkerReferences,
  deepClone,
  removeAccount,
  removeCareer,
  removeDateMarker,
  updateAccount
} from './commands';
import { compilePaycheck } from './paycheck';
import { dollarsToCents } from './engine/money';
import type { CanonicalTrajectorySnapshot, CareerSourceLine, PropertyDefinition, Scenario, TrajectorySnapshot } from './types';

/**
 * P1.7 focused persistence acceptance tests (CA11 / TC05–TC08).
 *
 * Pure codec/decoder coverage: factories, absent vs explicit empty/0/false/null,
 * record-local malformed recovery, deterministic duplicate-id repair, nested
 * allowlist pruning, future-version blocking, round-trip/idempotence, opening
 * liability identity, the configurable withdrawal percentage and HSA policy, and
 * command/edit-path field preservation with orphan-reference cleanup.
 */

const REFERENCE_DATE = new Date('2026-01-15');
const DATE_OF_BIRTH = '1980-10-01';

/** Builds a versioned envelope string from a raw (untrusted) scenario object. */
const envelope = (scenario: unknown, ui: unknown = createDefaultUiState(), schemaVersion = CURRENT_SCHEMA_VERSION) =>
  JSON.stringify({ schemaVersion, scenario, ui });

const decodeScenario = (
  scenario: unknown,
  ui: unknown = createDefaultUiState(),
  schemaVersion = CURRENT_SCHEMA_VERSION
) => decodeAppState(envelope(scenario, ui, schemaVersion), REFERENCE_DATE);

const reencode = (state: { scenario: Scenario; ui: ReturnType<typeof createDefaultUiState> }) =>
  encodeAppState(state, REFERENCE_DATE).json;

// ---------------------------------------------------------------------------
// TC06 — independent factories / fresh load isolation
// ---------------------------------------------------------------------------

describe('independent factories and fresh load (TC06)', () => {
  it('createDefaultScenario returns independent object graphs', () => {
    const a = createDefaultScenario(REFERENCE_DATE);
    const b = createDefaultScenario(REFERENCE_DATE);

    a.netWorth.accounts[0].openingBalance = 123;
    a.careerPlan.entries[0].sourceLines![0].contributionRate = 99;
    a.withdrawal.sourceLines![0].initialWithdrawalRatePercent = 17;

    expect(b.netWorth.accounts[0].openingBalance).toBe(0);
    expect(b.careerPlan.entries[0].sourceLines![0].contributionRate).toBe(2);
    expect(b.withdrawal.sourceLines![0].initialWithdrawalRatePercent).toBe(4);
    expect(a).not.toBe(b);
    expect(a.netWorth.accounts[0]).not.toBe(b.netWorth.accounts[0]);
  });

  it('reset never mutates a later factory call (no shared singleton)', () => {
    const first = createDefaultScenario(REFERENCE_DATE);
    first.profile.currentAge = 99;
    first.netWorth.accounts.length = 0;
    expect(createDefaultScenario(REFERENCE_DATE).profile.currentAge).toBe(45);
    expect(createDefaultScenario(REFERENCE_DATE).netWorth.accounts).toHaveLength(5);
  });

  it('createDefaultUiState returns a fresh object each call', () => {
    const a = createDefaultUiState();
    const b = createDefaultUiState();
    a.activeTab = 'options';
    a.showRealDollars = true;
    expect(b.activeTab).toBe('careers');
    expect(b.showRealDollars).toBe(false);
    expect(a).not.toBe(b);
  });

  it('two fresh (fully absent storage) loads share no nested references', () => {
    const a = decodeAppState(null, REFERENCE_DATE).scenario;
    const b = decodeAppState(undefined, REFERENCE_DATE).scenario;

    a.netWorth.accounts[0].withdrawalPolicy.allowAutomaticFallback = false;
    a.withdrawal.sourceLines![0].accountId = 'mutated';

    expect(b.netWorth.accounts[0].withdrawalPolicy.allowAutomaticFallback).toBe(true);
    expect(b.withdrawal.sourceLines![0].accountId).not.toBe('mutated');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// TC05 / CA11 — absent vs explicit empty / 0 / false / null
// ---------------------------------------------------------------------------

describe('absent vs explicit empty/0/false/null', () => {
  const raw = {
    profile: { currentAge: 0, retirementAge: 70, retirementYears: 10 },
    careerPlan: { enabled: false, entries: [] },
    netWorth: {
      accounts: [
        {
          id: 'acct-1',
          label: 'Empty',
          accountType: 'checking',
          openingBalance: 0,
          annualReturnRate: 0,
          retirementAnnualReturnRate: null,
          displayOrder: 0,
          withdrawalPolicy: {
            allowAutomaticFallback: false,
            withdrawalTaxRate: 0,
            penaltyRate: 0,
            restrictionNote: ''
          }
        }
      ],
      asOfDate: ''
    },
    manualReturns: { inflationEnabled: false, inflationRate: 0 },
    withdrawal: {
      mode: 'specified',
      minimumYearlyWithdrawal: 0,
      maximumYearlyWithdrawal: 0,
      useRetirementAgeAsWithdrawalStartAge: false,
      sourceLines: []
    },
    timelines: [],
    largePurchases: [],
    dateMarkers: [],
    incomeFallbackAccountId: null,
    activeTimelineId: null
  };

  it('keeps explicit zero / false / null values instead of defaulting them', () => {
    const { scenario } = decodeScenario(raw, { activeTab: 'options', showRealDollars: false });

    // numeric 0
    expect(scenario.profile.currentAge).toBe(0);
    expect(scenario.manualReturns.inflationRate).toBe(0);
    expect(scenario.withdrawal.minimumYearlyWithdrawal).toBe(0);
    expect(scenario.withdrawal.maximumYearlyWithdrawal).toBe(0);

    const account = scenario.netWorth.accounts[0];
    expect(account.openingBalance).toBe(0);
    expect(account.annualReturnRate).toBe(0);
    expect(account.retirementAnnualReturnRate).toBeNull();

    // boolean false
    expect(scenario.careerPlan.enabled).toBe(false);
    expect(scenario.manualReturns.inflationEnabled).toBe(false);
    expect(scenario.withdrawal.useRetirementAgeAsWithdrawalStartAge).toBe(false);
    expect(account.withdrawalPolicy.allowAutomaticFallback).toBe(false);

    // allowed null
    expect(scenario.incomeFallbackAccountId).toBeNull();
    expect(scenario.activeTimelineId).toBeNull();
  });

  it('keeps explicit empty collections empty (never restored)', () => {
    const { scenario } = decodeScenario(raw);

    expect(scenario.careerPlan.entries).toEqual([]);
    expect(scenario.withdrawal.sourceLines).toEqual([]);
    expect(scenario.timelines).toEqual([]);
    expect(scenario.largePurchases).toEqual([]);
    expect(scenario.netWorth.accounts).toHaveLength(1);
    expect(scenario.dateMarkers).toEqual([]);
  });

  it('fully absent storage uses the fresh factories', () => {
    const { scenario, corrupt, blocked } = decodeAppState(null, REFERENCE_DATE);
    expect(corrupt).toBe(false);
    expect(blocked).toBe(false);
    expect(scenario.careerPlan.entries).toHaveLength(1);
    expect(scenario.netWorth.accounts).toHaveLength(5);
    expect(scenario.withdrawal.sourceLines).toHaveLength(1);
  });

  it('defaults an absent career birthday-start flag to false at decode', () => {
    const career = createDefaultScenario(REFERENCE_DATE).careerPlan.entries[0];
    const { useBirthdayBasedStartAge: _omitted, ...legacyCareer } = career;
    const { scenario } = decodeScenario({ careerPlan: { enabled: true, entries: [legacyCareer] } });
    expect(scenario.careerPlan.entries[0].useBirthdayBasedStartAge).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC07 — record-local malformed recovery
// ---------------------------------------------------------------------------

describe('record-local malformed recovery', () => {
  it('recovers a malformed record in place while preserving valid siblings', () => {
    const { scenario } = decodeScenario({
      netWorth: {
        accounts: [
          {
            id: 'acct-a',
            label: 'A',
            accountType: 'checking',
            openingBalance: 5,
            annualReturnRate: 1,
            retirementAnnualReturnRate: null,
            displayOrder: 0
          },
          null,
          {
            id: 'acct-b',
            label: 'B',
            accountType: 'savings',
            openingBalance: 7,
            annualReturnRate: 2,
            retirementAnnualReturnRate: null,
            displayOrder: 1
          }
        ],
        asOfDate: ''
      }
    });

    const accounts = scenario.netWorth.accounts;
    expect(accounts).toHaveLength(3);
    expect(accounts[0].label).toBe('A');
    expect(accounts[0].openingBalance).toBe(5);
    expect(accounts[2].label).toBe('B');
    expect(accounts[2].openingBalance).toBe(7);

    // The malformed entry is recovered with a generated id, not dropped.
    expect(accounts[1].id).toBe('account-2');
    expect(accounts[1].openingBalance).toBe(0);
  });

  it('coerces invalid enum/type values to safe defaults without erasing siblings', () => {
    const { scenario } = decodeScenario({
      netWorth: {
        accounts: [
          { id: 'bad', label: 'Bad', accountType: 42, openingBalance: 'nope', annualReturnRate: 'x' },
          { id: 'good', label: 'Good', accountType: 'taxable', openingBalance: 100 }
        ],
        asOfDate: ''
      }
    });

    const [bad, good] = scenario.netWorth.accounts;
    expect(bad.id).toBe('bad');
    expect(bad.accountType).toBe('checking');
    expect(bad.openingBalance).toBe(0);
    expect(bad.annualReturnRate).toBe(0);
    expect(good.accountType).toBe('taxable');
    expect(good.openingBalance).toBe(100);
  });

  it('emits a diagnostic and keeps valid siblings when ids collide', () => {
    const { scenario, diagnostics } = decodeScenario({
      largePurchases: [
        { id: 'dup', label: 'First', amount: 10, yearMonth: '2026-01' },
        { id: 'dup', label: 'Second', amount: 20, yearMonth: '2026-02' }
      ]
    });

    expect(scenario.largePurchases).toHaveLength(2);
    expect(scenario.largePurchases[0].label).toBe('First');
    expect(scenario.largePurchases[1].label).toBe('Second');
    expect(scenario.largePurchases.map((purchase) => purchase.id)).toEqual(['dup', 'dup-2']);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'duplicate-id-repaired', path: 'largePurchases' })
    );
  });

  // P0.4.3 / RV29 — a non-object entry is a record-local recovery (non-blocking
  // warning), distinct from a wrong-typed scalar field inside a valid record.
  it('recovers a non-object account [valid, null, valid] in place with a non-blocking warning and stays saveable', () => {
    const result = decodeScenario({
      netWorth: {
        accounts: [
          {
            id: 'acct-a',
            label: 'A',
            accountType: 'checking',
            openingBalance: 5,
            annualReturnRate: 1,
            retirementAnnualReturnRate: null,
            displayOrder: 0
          },
          null,
          {
            id: 'acct-c',
            label: 'C',
            accountType: 'savings',
            openingBalance: 7,
            annualReturnRate: 2,
            retirementAnnualReturnRate: null,
            displayOrder: 2
          }
        ],
        asOfDate: ''
      }
    });

    // Valid siblings preserved; the malformed entry recovered in place with a generated id.
    const accounts = result.scenario.netWorth.accounts;
    expect(accounts.map((account) => account.id)).toEqual(['acct-a', 'account-2', 'acct-c']);
    expect(accounts[0].openingBalance).toBe(5);
    expect(accounts[2].openingBalance).toBe(7);
    expect(accounts[1].openingBalance).toBe(0);

    // A non-blocking warning records the recovery at the original index.
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'malformed-record-recovered',
        severity: 'warning',
        path: 'netWorth.accounts[1]'
      })
    );

    // Subsequent canonical save is stable and no longer reports a malformed record.
    const { json: first, diagnostics: saveDiagnostics } = encodeAppState(
      { scenario: result.scenario, ui: createDefaultUiState() },
      REFERENCE_DATE
    );
    expect(saveDiagnostics.some((entry) => entry.code === 'malformed-record-recovered')).toBe(false);

    const reloaded = decodeAppState(first, REFERENCE_DATE);
    expect(reloaded.scenario.netWorth.accounts.map((account) => account.id)).toEqual([
      'acct-a',
      'account-2',
      'acct-c'
    ]);
    expect(reloaded.diagnostics.some((entry) => entry.code === 'malformed-record-recovered')).toBe(false);

    const second = encodeAppState({ scenario: reloaded.scenario, ui: reloaded.ui }, REFERENCE_DATE).json;
    expect(second).toBe(first);
  });

  it('coerces a wrong-typed scalar field with a valid id to defaults WITHOUT a malformed-record warning', () => {
    const { scenario, diagnostics } = decodeScenario({
      netWorth: {
        accounts: [{ id: 'bad', label: 'Bad', accountType: 42, openingBalance: 'nope', annualReturnRate: 'x' }],
        asOfDate: ''
      }
    });

    const [bad] = scenario.netWorth.accounts;
    expect(bad.id).toBe('bad');
    expect(bad.accountType).toBe('checking');
    expect(bad.openingBalance).toBe(0);
    expect(bad.annualReturnRate).toBe(0);
    expect(diagnostics.some((entry) => entry.code === 'malformed-record-recovered')).toBe(false);
  });

  it('does not report a malformed record when the raw collection is not an array', () => {
    const { diagnostics } = decodeScenario({ netWorth: { accounts: 'not-an-array', asOfDate: '' } });
    expect(diagnostics.some((entry) => entry.code === 'malformed-record-recovered')).toBe(false);
  });

  it('recovers a non-object purchase in an inactive timeline with a stable nested path', () => {
    const { scenario, diagnostics } = decodeScenario({
      activeTimelineId: null,
      timelines: [
        {
          id: 'tl-1',
          label: 'Inactive',
          purchases: [
            { id: 'keep', label: 'Keep', amount: 10, yearMonth: '2026-01' },
            'not-a-record'
          ],
          longTermPurchases: [],
          loans: [],
          creditCards: [],
          cardPlans: [],
          careerPlan: { enabled: true, entries: [] },
          housing: []
        }
      ]
    });

    const timeline = scenario.timelines[0];
    expect(timeline.purchases).toHaveLength(2);
    expect(timeline.purchases[0].id).toBe('keep');
    expect(timeline.purchases[0].amount).toBe(10);
    expect(timeline.purchases[1].id).toBe('purchase-2');
    expect(timeline.purchases[1].amount).toBe(0);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'malformed-record-recovered',
        severity: 'warning',
        path: 'timeline.purchases[1]'
      })
    );
  });
});

// ---------------------------------------------------------------------------
// TC07 — deterministic duplicate-id repair across base / inactive / pay plans
// ---------------------------------------------------------------------------

describe('deterministic duplicate id repair', () => {
  const raw = {
    largePurchases: [
      { id: 'dup', label: 'P1', amount: 10, yearMonth: '2026-01' },
      { id: 'dup', label: 'P2', amount: 20, yearMonth: '2026-02' },
      { id: 'dup', label: 'P3', amount: 30, yearMonth: '2026-03' }
    ],
    careerPlan: {
      enabled: true,
      entries: [
        {
          id: 'c-dup',
          label: 'C1',
          payPlans: [
            { id: 'pp', label: 'Plan A', effectiveYearMonth: '2027-01', paycheck: { payFrequency: 'monthly', categories: [] } },
            { id: 'pp', label: 'Plan B', effectiveYearMonth: '2028-01', paycheck: { payFrequency: 'monthly', categories: [] } }
          ]
        },
        { id: 'c-dup', label: 'C2' }
      ]
    },
    timelines: [
      {
        id: 'tl',
        label: 'Inactive',
        purchases: [
          { id: 'dup', label: 'T1', amount: 1, yearMonth: '2026-01' },
          { id: 'dup', label: 'T2', amount: 2, yearMonth: '2026-02' }
        ],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        careerPlan: { enabled: true, entries: [] },
        housing: []
      }
    ]
  };

  it('repairs base, inactive-timeline and pay-plan ids deterministically', () => {
    const { scenario, diagnostics } = decodeScenario(raw);

    expect(scenario.largePurchases.map((purchase) => purchase.id)).toEqual(['dup', 'dup-2', 'dup-3']);
    expect(scenario.careerPlan.entries.map((entry) => entry.id)).toEqual(['c-dup', 'c-dup-2']);
    expect(scenario.careerPlan.entries[0].payPlans!.map((plan) => plan.id)).toEqual(['pp', 'pp-2']);
    expect(scenario.timelines[0].purchases.map((purchase) => purchase.id)).toEqual(['dup', 'dup-2']);

    expect(diagnostics.filter((entry) => entry.code === 'duplicate-id-repaired').length).toBeGreaterThan(0);
  });

  it('is deterministic across repeated decodes', () => {
    const first = decodeScenario(raw).scenario;
    const second = decodeScenario(raw).scenario;
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

// ---------------------------------------------------------------------------
// P1.3 — allowlist pruning of obsolete fields (nested)
// ---------------------------------------------------------------------------

describe('allowlist pruning of obsolete fields', () => {
  const raw = {
    contribution: { yearlyContribution: 17500, yearlyIncreaseRate: 2.9 },
    netWorth: {
      accounts: [
        {
          id: 'a1',
          label: 'A',
          accountType: 'checking',
          poolId: 'pool-x',
          priority: 3,
          balance: 123,
          openingBalance: 10,
          annualReturnRate: 1,
          retirementAnnualReturnRate: null,
          displayOrder: 0,
          withdrawalPolicy: {
            allowAutomaticFallback: true,
            withdrawalTaxRate: 0,
            penaltyRate: 0,
            restrictionNote: '',
            poolTaxRate: 5
          }
        }
      ],
      pools: [{ id: 'pool-x', taxRate: 10 }],
      asOfDate: ''
    },
    withdrawal: {
      mode: 'specified',
      minimumYearlyWithdrawal: 0,
      maximumYearlyWithdrawal: 1000,
      useRetirementAgeAsWithdrawalStartAge: true,
      firstYearAmount: 12345,
      firstYearAccountWithdrawals: true,
      firstYearAccountUseFourPercent: true,
      sourceLines: [
        { id: 'rs', enabled: true, accountId: 'a1', mode: 'amount', amount: 0, mystery: 'x' }
      ]
    },
    largePurchases: [
      {
        id: 'p1',
        label: 'P',
        enabled: true,
        showOnGraph: true,
        yearMonth: '2026-01',
        age: 45,
        amount: 100,
        fundingSource: 'pool:old-pool',
        obsolete: true,
        sourceLines: [
          { id: 'sl', enabled: true, sourceType: 'account', sourceId: 'a1', mode: 'amount', amount: 100, junkField: 1 }
        ]
      }
    ],
    expenses: {
      entries: [
        {
          id: 'e1',
          label: 'E',
          amount: 5,
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          accountId: null,
          notes: '',
          originType: 'manual',
          importSourceId: null,
          importBatchId: null,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          obsoleteFlag: true
        }
      ],
      imports: [
        {
          id: 'i1',
          batchId: 'b1',
          fileName: 'f.csv',
          fileType: 'csv',
          previewText: '',
          status: 'staged',
          parseNotes: [],
          confidence: 0.5,
          importedAt: '2026-01-01',
          appliedAt: '',
          entryIds: [],
          legacyColumns: ['x']
        }
      ],
      categoriesByAccountId: { a1: [{ id: 'cat', label: 'Cat', hidden: true }] },
      weeklyBalanceByAccountId: {},
      maxBalanceByAccountId: {},
      activePlanningAccountId: null,
      recurringEvents: [],
      ui: {
        groupingMode: 'account',
        zoomLevel: 1,
        rowHeight: 56,
        density: 'comfortable',
        snapToDay: true,
        scrubberDate: '2026-01-01',
        windowStartDate: '2026-01-01',
        windowEndDate: '2026-12-31',
        selectedAccountIds: [],
        collapsedTrackIds: [],
        trackerVisibleAccountIds: [],
        planningWeekStartDay: 5,
        oldUiFlag: true
      }
    },
    trajectorySnapshots: [
      {
        id: 't1',
        label: 'T',
        createdAt: '',
        survivesToEnd: true,
        depletedAge: null,
        endAge: 90,
        endingBalance: 0,
        summary: '',
        legacy: true,
        years: [
          {
            age: 45,
            calendarYear: 2026,
            isBaselineNow: true,
            startBalance: 0,
            endBalance: 0,
            salary: 0,
            netIncome: 0,
            careerContribution: 0,
            contribution: 0,
            withdrawal: 0,
            taxesPaid: 0,
            penaltiesPaid: 0,
            annualReturnRate: 0,
            inflationRate: 0,
            depleted: false,
            savingsBalances: {},
            accountBalancesById: {},
            creditCardBalancesById: {},
            totalCreditCardDebt: 0,
            legacyYear: true
          }
        ]
      }
    ],
    ui: { activeTab: 'options', showRealDollars: true, legacyUi: true }
  };

  // The obsolete `ui` above is deliberately nested inside the scenario object
  // (ignored by the codec); the real envelope UI is supplied per test.

  it('drops obsolete fields at every nesting level on decode', () => {
    const { scenario, ui } = decodeScenario(raw, { activeTab: 'options', showRealDollars: true, legacyUi: true });

    expect(scenario).not.toHaveProperty('contribution');

    const account = scenario.netWorth.accounts[0];
    expect(account).not.toHaveProperty('poolId');
    expect(account).not.toHaveProperty('priority');
    expect(account).not.toHaveProperty('balance');
    expect(account.openingBalance).toBe(10);
    expect(account.withdrawalPolicy).not.toHaveProperty('poolTaxRate');
    expect(scenario.netWorth).not.toHaveProperty('pools');

    const withdrawal = scenario.withdrawal;
    expect(withdrawal).not.toHaveProperty('firstYearAmount');
    expect(withdrawal).not.toHaveProperty('firstYearAccountWithdrawals');
    expect(withdrawal).not.toHaveProperty('firstYearAccountUseFourPercent');
    expect(withdrawal.sourceLines![0]).not.toHaveProperty('mystery');

    const purchase = scenario.largePurchases![0];
    expect(purchase).not.toHaveProperty('obsolete');
    expect(purchase.fundingSource).toBeUndefined();
    expect(purchase.sourceLines![0]).not.toHaveProperty('junkField');

    expect(scenario.expenses.entries[0]).not.toHaveProperty('obsoleteFlag');
    expect(scenario.expenses.imports[0]).not.toHaveProperty('legacyColumns');
    expect(scenario.expenses.categoriesByAccountId.a1[0]).not.toHaveProperty('hidden');
    expect(scenario.expenses.ui).not.toHaveProperty('oldUiFlag');

    expect(scenario.trajectorySnapshots[0]).not.toHaveProperty('legacy');
    expect((scenario.trajectorySnapshots[0] as TrajectorySnapshot).years[0]).not.toHaveProperty('legacyYear');

    expect(ui).not.toHaveProperty('legacyUi');
    expect(ui).toMatchObject({ activeTab: 'options', showRealDollars: true });
  });

  it('maps obsolete sub-tab aliases and prunes on encode (save path)', () => {
    const { scenario, ui } = decodeScenario(raw);
    const json = reencode({ scenario, ui });
    const saved = JSON.parse(json);

    expect(saved.scenario).not.toHaveProperty('contribution');
    expect(saved.scenario.withdrawal).not.toHaveProperty('firstYearAmount');
    expect(saved.scenario.netWorth.accounts[0]).not.toHaveProperty('poolId');
    expect(saved.ui).not.toHaveProperty('legacyUi');
  });

  it('prunes obsolete fields nested in inactive timelines and pay plans', () => {
    const { scenario } = decodeScenario({
      timelines: [
        {
          id: 'tl',
          label: 'Inactive',
          purchases: [
            {
              id: 'tp',
              label: 'T',
              enabled: true,
              showOnGraph: true,
              yearMonth: '2026-01',
              age: 45,
              amount: 1,
              poolId: 'pool-y',
              fundingSource: 'pool:y'
            }
          ],
          longTermPurchases: [],
          loans: [],
          creditCards: [],
          careerPlan: {
            enabled: true,
            entries: [
              {
                id: 'tc',
                label: 'TC',
                payPlans: [
                  {
                    id: 'tpp',
                    label: 'TPP',
                    effectiveYearMonth: '2027-01',
                    paycheck: { payFrequency: 'monthly', categories: [] },
                    legacyPlanField: true
                  }
                ]
              }
            ]
          },
          housing: []
        }
      ]
    });

    const purchase = scenario.timelines[0].purchases[0];
    expect(purchase).not.toHaveProperty('poolId');
    expect(purchase.fundingSource).toBeUndefined();
    const plan = scenario.timelines[0].careerPlan.entries[0].payPlans![0];
    expect(plan).not.toHaveProperty('legacyPlanField');
    expect(plan.id).toBe('tpp');
  });
});

// ---------------------------------------------------------------------------
// P1.3 / D2 — future-version block
// ---------------------------------------------------------------------------

describe('future-version block', () => {
  it('refuses to load a newer schema and preserves the original bytes', () => {
    const raw = envelope({ profile: { currentAge: 99 } }, createDefaultUiState(), CURRENT_SCHEMA_VERSION + 5);
    const result = decodeAppState(raw, REFERENCE_DATE);

    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toBe('future-schema-version');
    expect(result.preservedBytes).toBe(raw);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 5);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'future-schema-version', severity: 'error' })
    );
    // Fresh defaults, not the newer payload.
    expect(result.scenario.profile.currentAge).toBe(45);
  });

  it('loads an equal or older version normally', () => {
    const equal = decodeAppState(envelope({ profile: { currentAge: 50 } }), REFERENCE_DATE);
    expect(equal.blocked).toBe(false);
    expect(equal.scenario.profile.currentAge).toBe(50);

    const older = decodeAppState(envelope({ profile: { currentAge: 50 } }, createDefaultUiState(), 0), REFERENCE_DATE);
    expect(older.blocked).toBe(false);
    expect(older.schemaVersion).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P1.3 — corrupt recovery
// ---------------------------------------------------------------------------

describe('corrupt payload recovery', () => {
  it('returns fresh defaults and preserves bytes for unparseable JSON', () => {
    const raw = '{ definitely not json';
    const result = decodeAppState(raw, REFERENCE_DATE);
    expect(result.corrupt).toBe(true);
    expect(result.preservedBytes).toBe(raw);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'parse-failed', severity: 'error' }));
    expect(result.scenario.netWorth.accounts).toHaveLength(5);
  });

  it('treats a non-object root as corrupt', () => {
    const raw = JSON.stringify([1, 2, 3]);
    const result = decodeAppState(raw, REFERENCE_DATE);
    expect(result.corrupt).toBe(true);
    expect(result.preservedBytes).toBe(raw);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid-root', severity: 'error' }));
  });

  it('treats blank/absent input as a fresh valid state (not corrupt)', () => {
    for (const raw of [null, undefined, '', '   ']) {
      const result = decodeAppState(raw, REFERENCE_DATE);
      expect(result.corrupt).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.preservedBytes).toBeNull();
      expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
  });
});

// ---------------------------------------------------------------------------
// P1.3 — round-trip / idempotence
// ---------------------------------------------------------------------------

describe('round-trip and idempotence', () => {
  const richScenario = (): Scenario => createDefaultScenario(REFERENCE_DATE);

  it('encode(decode(encode(x))) is byte-stable and decode is idempotent', () => {
    const state = { scenario: richScenario(), ui: createDefaultUiState() };

    const first = reencode(state);
    const decoded = decodeAppState(first, REFERENCE_DATE);
    const second = reencode({ scenario: decoded.scenario, ui: decoded.ui });
    expect(second).toBe(first);

    const decodedAgain = decodeAppState(second, REFERENCE_DATE);
    expect(decodedAgain.scenario).toEqual(decoded.scenario);
    expect(decodedAgain.ui).toEqual(decoded.ui);
  });

  it('never mutates the supplied state or raw input', () => {
    const state = { scenario: richScenario(), ui: createDefaultUiState() };
    const before = JSON.stringify(state);
    const encoded = encodeAppState(state, REFERENCE_DATE);
    expect(JSON.stringify(state)).toBe(before);

    const rawInput = encoded.json;
    const snapshot = rawInput;
    decodeAppState(rawInput, REFERENCE_DATE);
    expect(rawInput).toBe(snapshot);
  });

  it('preserves new fields through a save/load cycle', () => {
    const scenario = richScenario();
    const account = scenario.netWorth.accounts[3];
    account.annualReturnRate = 6.5;
    account.retirementAnnualReturnRate = 4.25;
    account.color = '#123456';
    account.displayOrder = 9;
    account.assumedGainPercent = 20;
    account.capitalGainsTaxRate = 18;
    account.withdrawalPolicy.withdrawalTaxRate = 15;
    account.withdrawalPolicy.penaltyRate = 2;

    const decoded = decodeAppState(reencode({ scenario, ui: createDefaultUiState() }), REFERENCE_DATE);
    const roundTripped = decoded.scenario.netWorth.accounts[3];
    expect(roundTripped.annualReturnRate).toBe(6.5);
    expect(roundTripped.retirementAnnualReturnRate).toBe(4.25);
    expect(roundTripped.color).toBe('#123456');
    expect(roundTripped.displayOrder).toBe(9);
    expect(roundTripped.assumedGainPercent).toBe(20);
    expect(roundTripped.capitalGainsTaxRate).toBe(18);
    expect(roundTripped.withdrawalPolicy.withdrawalTaxRate).toBe(15);
    expect(roundTripped.withdrawalPolicy.penaltyRate).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// P1.5 — opening liability identity
// ---------------------------------------------------------------------------

describe('opening liability identity', () => {
  it('lets an observed 0 win and uses configured debt exactly once', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    scenario.liabilities = [
      { id: 'L1', kind: 'loan', openingBalance: 500 },
      { id: 'L2', kind: 'mortgage', openingBalance: 900 }
    ];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [],
      liabilities: [{ liabilityId: 'L1', balance: 0 }],
      measurement: 'assetsMinusLiabilities'
    };

    const opening = resolveOpening(scenario);
    const l1 = opening.liabilities.filter((entry) => entry.liabilityId === 'L1');
    const l2 = opening.liabilities.filter((entry) => entry.liabilityId === 'L2');

    expect(l1).toHaveLength(1);
    expect(l1[0].openingBalance).toBe(0);
    expect(l1[0].source).toBe('observed');
    expect(l2).toHaveLength(1);
    expect(l2[0].openingBalance).toBe(900);
    expect(l2[0].source).toBe('configured');
  });

  it('does not mutate the input scenario', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    scenario.liabilities = [{ id: 'L1', kind: 'loan', openingBalance: 500 }];
    const before = JSON.stringify(scenario);
    resolveOpening(scenario);
    expect(JSON.stringify(scenario)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// D4 / ADR-021 — withdrawal percentage and HSA penalty/tax defaults
// ---------------------------------------------------------------------------

describe('withdrawal percentage and HSA policy (D4 / ADR-021)', () => {
  it('new percentage source defaults to 4 and preserves an explicit 0', () => {
    const def = createDefaultRetirementWithdrawalSource(REFERENCE_DATE);
    expect(def.mode).toBe('percentOfInitialBalance');
    expect(def.initialWithdrawalRatePercent).toBe(4);

    const zero = createDefaultRetirementWithdrawalSource(REFERENCE_DATE, { initialWithdrawalRatePercent: 0 });
    expect(zero.initialWithdrawalRatePercent).toBe(0);
  });

  it('codec defaults a missing rate to 4 and keeps an explicit 0 on round-trip', () => {
    const { scenario } = decodeScenario({
      withdrawal: {
        mode: 'percentOfInitialBalance',
        minimumYearlyWithdrawal: 0,
        maximumYearlyWithdrawal: 1000,
        useRetirementAgeAsWithdrawalStartAge: true,
        sourceLines: [
          { id: 'r1', enabled: true, accountId: 'a1', mode: 'percentOfInitialBalance', amount: 0, firstWithdrawalDate: '2030-01-01' },
          { id: 'r2', enabled: true, accountId: 'a2', mode: 'percentOfInitialBalance', amount: 0, initialWithdrawalRatePercent: 0, firstWithdrawalDate: '2030-01-01' }
        ]
      }
    });

    const [r1, r2] = scenario.withdrawal.sourceLines!;
    expect(r1.initialWithdrawalRatePercent).toBe(4);
    expect(r2.initialWithdrawalRatePercent).toBe(0);

    const roundTripped = decodeAppState(reencode({ scenario, ui: createDefaultUiState() }), REFERENCE_DATE);
    expect(roundTripped.scenario.withdrawal.sourceLines![1].initialWithdrawalRatePercent).toBe(0);
  });

  it('HSA policy keeps income tax and the age-based penalty separate', () => {
    const policy = createDefaultAccountWithdrawalPolicy('hsa');
    expect(policy.withdrawalTaxRate).toBe(0);
    expect(policy.penaltyRate).toBe(0);
    expect(policy.hsa).toEqual({ nonQualifiedPenaltyRate: 20, nonQualifiedPenaltyWaiverAge: 65 });
  });

  it('codec round-trips a configured HSA penalty separately from income tax', () => {
    const { scenario } = decodeScenario({
      netWorth: {
        accounts: [
          {
            id: 'h1',
            label: 'HSA',
            accountType: 'hsa',
            openingBalance: 0,
            annualReturnRate: 0,
            retirementAnnualReturnRate: null,
            displayOrder: 0,
            withdrawalPolicy: {
              allowAutomaticFallback: false,
              withdrawalTaxRate: 12,
              penaltyRate: 3,
              restrictionNote: 'note',
              hsa: { nonQualifiedPenaltyRate: 25, nonQualifiedPenaltyWaiverAge: 60 }
            }
          }
        ],
        asOfDate: ''
      }
    });

    const policy = scenario.netWorth.accounts[0].withdrawalPolicy;
    expect(policy.withdrawalTaxRate).toBe(12);
    expect(policy.penaltyRate).toBe(3);
    expect(policy.hsa).toEqual({ nonQualifiedPenaltyRate: 25, nonQualifiedPenaltyWaiverAge: 60 });
  });
});

// ---------------------------------------------------------------------------
// G01 / CA11 — unrelated command edits preserve new fields + orphan cleanup
// ---------------------------------------------------------------------------

describe('configuration commands preserve new fields and clean orphan references', () => {
  const richScenario = (): Scenario => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const account = scenario.netWorth.accounts.find((entry) => entry.id === 'investments-account-default')!;
    account.annualReturnRate = 6.5;
    account.retirementAnnualReturnRate = 4.25;
    account.color = '#123456';
    account.displayOrder = 9;
    account.assumedGainPercent = 20;
    account.capitalGainsTaxRate = 18;
    account.withdrawalPolicy = {
      allowAutomaticFallback: false,
      withdrawalTaxRate: 15,
      penaltyRate: 2,
      restrictionNote: 'restricted'
    };

    scenario.fundingPolicy = {
      primaryAccountId: account.id,
      fallbackAccountIds: ['checking-account-default'],
      purpose: 'global'
    };
    scenario.withdrawal.sourceLines![0].initialWithdrawalRatePercent = 6;
    scenario.liabilities = [{ id: 'L1', kind: 'loan', openingBalance: 500, linkedPropertyId: 'P1' }];
    scenario.properties = [
      { id: 'P1', value: 300000, debtLink: 'L1', requiredDownPayment: 60000, status: 'owned' }
    ];
    scenario.cardPlans = [createDefaultOrdinaryCardSchedule(REFERENCE_DATE, { id: 'cp1' })];
    return scenario;
  };

  const expectNewFieldsIntact = (scenario: Scenario): void => {
    const account = scenario.netWorth.accounts.find((entry) => entry.id === 'investments-account-default');
    expect(account).toBeDefined();
    expect(account!.annualReturnRate).toBe(6.5);
    expect(account!.retirementAnnualReturnRate).toBe(4.25);
    expect(account!.color).toBe('#123456');
    expect(account!.displayOrder).toBe(9);
    expect(account!.assumedGainPercent).toBe(20);
    expect(account!.capitalGainsTaxRate).toBe(18);
    expect(account!.withdrawalPolicy.withdrawalTaxRate).toBe(15);
    expect(account!.withdrawalPolicy.penaltyRate).toBe(2);
    expect(account!.withdrawalPolicy.restrictionNote).toBe('restricted');

    expect(scenario.fundingPolicy).toEqual({
      primaryAccountId: 'investments-account-default',
      fallbackAccountIds: ['checking-account-default'],
      purpose: 'global'
    });
    expect(scenario.withdrawal.sourceLines![0].initialWithdrawalRatePercent).toBe(6);
    expect(scenario.liabilities).toEqual([{ id: 'L1', kind: 'loan', openingBalance: 500, linkedPropertyId: 'P1' }]);
    expect(scenario.properties![0].debtLink).toBe('L1');
    expect(scenario.cardPlans![0].id).toBe('cp1');
  };

  it('an unrelated active-timeline edit preserves every new field', () => {
    const scenario = richScenario();
    const next = applyToActiveTimeline(scenario, (data) => ({ ...data, purchases: [] }));
    expectNewFieldsIntact(next);
    // Source untouched.
    expect(
      scenario.netWorth.accounts.find((entry) => entry.id === 'investments-account-default')!.annualReturnRate
    ).toBe(6.5);
  });

  it('editing one account leaves every other new field intact', () => {
    const scenario = richScenario();
    const checking = scenario.netWorth.accounts.find((entry) => entry.id === 'checking-account-default')!;
    const next = updateAccount(scenario, { ...checking, label: 'Renamed' });
    expect(next.netWorth.accounts.find((entry) => entry.id === 'checking-account-default')!.label).toBe('Renamed');
    expectNewFieldsIntact(next);
  });

  it('removing an unrelated account clears only its references', () => {
    const scenario = richScenario();
    const next = removeAccount(scenario, 'hsa-account-default');
    expect(next.netWorth.accounts.map((entry) => entry.id)).not.toContain('hsa-account-default');
    expectNewFieldsIntact(next);
    // Source untouched.
    expect(scenario.netWorth.accounts.map((entry) => entry.id)).toContain('hsa-account-default');
  });

  it('removing a career clears only its housing links and preserves other config', () => {
    const scenario = richScenario();
    const careerA = scenario.careerPlan.entries[0];
    careerA.id = 'cA';
    const careerB = deepClone(careerA);
    careerB.id = 'cB';
    careerB.label = 'Career B';
    scenario.careerPlan.entries = [careerA, careerB];

    const housing = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    housing.id = 'hA';
    housing.linkedCareerStartId = 'cA';
    housing.linkedCareerEndId = 'cB';
    scenario.housing = [housing];

    const next = removeCareer(scenario, 'cA');
    expect(next.careerPlan.entries.map((entry) => entry.id)).toEqual(['cB']);
    expect(next.housing[0].linkedCareerStartId).toBeNull();
    expect(next.housing[0].linkedCareerEndId).toBe('cB');
    expectNewFieldsIntact(next);
  });

  it('clears dangling marker references without disturbing new fields', () => {
    const scenario = richScenario();
    scenario.dateMarkers = [{ id: 'm1', label: 'M', date: '2030-01-01' }];
    const purchase = createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE);
    purchase.id = 'pA';
    purchase.yearMonthMarkerId = 'missing';
    scenario.largePurchases = [purchase];

    const cleaned = clearDanglingMarkerReferences(scenario);
    expect(cleaned.largePurchases![0].yearMonthMarkerId).toBeNull();
    expectNewFieldsIntact(cleaned);
  });

  it('removing a date marker clears references and preserves new fields', () => {
    const scenario = richScenario();
    scenario.dateMarkers = [{ id: 'm1', label: 'M', date: '2030-01-01' }];
    const housing = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    housing.id = 'hA';
    housing.startMarkerId = 'm1';
    scenario.housing = [housing];

    const next = removeDateMarker(scenario, 'm1');
    expect(next.dateMarkers).toHaveLength(0);
    expect(next.housing[0].startMarkerId).toBeNull();
    expectNewFieldsIntact(next);
  });
});

// ---------------------------------------------------------------------------
// Oracle codec regressions (owned by the codec lane; asserted here)
// ---------------------------------------------------------------------------

describe('legacy pool-era persistence regression', () => {
  it('preserves legacy netWorth.bankAccounts into canonical accounts', () => {
    const { scenario } = decodeScenario({
      netWorth: {
        bankAccounts: [
          { id: 'legacy-1', label: 'Legacy Checking', accountType: 'checking', balance: 2500, poolId: 'checking', priority: 0 },
          { id: 'legacy-2', label: 'Legacy Investments', accountType: 'taxable', balance: 10000, poolId: 'investments', priority: 1 }
        ],
        asOfDate: '2026-01-01'
      }
    });

    expect(scenario.netWorth.accounts).toHaveLength(2);
    const checking = scenario.netWorth.accounts.find((account) => account.id === 'legacy-1');
    expect(checking).toBeDefined();
    expect(checking!.label).toBe('Legacy Checking');
    expect(checking!.accountType).toBe('checking');
    expect(checking!.openingBalance).toBe(2500);
    expect(checking!.annualReturnRate).toBe(0);
    expect(checking!.retirementAnnualReturnRate).toBeNull();

    const investments = scenario.netWorth.accounts.find((account) => account.id === 'legacy-2');
    expect(investments!.openingBalance).toBe(10000);
  });

  it('clears legacy pool source ids and records a diagnostic', () => {
    const { scenario, diagnostics } = decodeScenario({
      largePurchases: [
        {
          id: 'p1',
          label: 'P',
          enabled: true,
          showOnGraph: true,
          yearMonth: '2026-01',
          age: 45,
          amount: 100,
          fundingSource: 'pool:investments',
          sourceLines: [
            { id: 'sl', enabled: true, sourceType: 'pool', sourceId: 'investments', mode: 'amount', amount: 100 }
          ]
        }
      ]
    });

    const purchase = scenario.largePurchases[0];
    expect(purchase.fundingSource).toBeUndefined();
    expect(purchase.sourceLines![0].sourceId).toBe('');
    expect(purchase.sourceLines![0].accountId ?? null).toBeNull();

    const poolDiagnostics = diagnostics.filter((entry) => /pool/i.test(`${entry.code} ${entry.message} ${entry.path ?? ''}`));
    expect(poolDiagnostics.length).toBeGreaterThan(0);
    expect(poolDiagnostics.some((entry) => entry.severity === 'warning' || entry.severity === 'error')).toBe(true);
  });

  it('clears a dangling activeTimelineId but keeps a valid one', () => {
    const dangling = decodeScenario({ activeTimelineId: 'missing-timeline', timelines: [] });
    expect(dangling.scenario.activeTimelineId).toBeNull();

    const valid = decodeScenario({
      activeTimelineId: 'tl-1',
      timelines: [
        {
          id: 'tl-1',
          label: 'Timeline',
          purchases: [],
          longTermPurchases: [],
          loans: [],
          creditCards: [],
          careerPlan: { enabled: true, entries: [] },
          housing: []
        }
      ]
    });
    expect(valid.scenario.activeTimelineId).toBe('tl-1');
  });
});

describe('encode date default regression', () => {
  it('fills missing dates from an explicit reference date and never uses the 1970 epoch', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const expensesUi = scenario.expenses.ui as unknown as Record<string, unknown>;
    delete expensesUi.scrubberDate;
    delete expensesUi.windowStartDate;
    delete expensesUi.windowEndDate;

    // Without a reference date, absent dates stay blank (not a synthetic epoch).
    const blank = JSON.parse(encodeAppState({ scenario, ui: createDefaultUiState() }).json).scenario.expenses.ui;
    for (const value of [blank.scrubberDate, blank.windowStartDate, blank.windowEndDate]) {
      expect(value).not.toMatch(/^19[67]/);
    }

    // With an explicit reference date, missing dates fill deterministically.
    const filled = JSON.parse(reencode({ scenario, ui: createDefaultUiState() })).scenario.expenses.ui;
    for (const value of [filled.scrubberDate, filled.windowStartDate, filled.windowEndDate]) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number(value.slice(0, 4))).toBeGreaterThan(2000);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — planner occurrence status (occurred vs planned)
// ---------------------------------------------------------------------------

describe('planner occurrence status (Phase 3 safeguards)', () => {
  const importedEntry = (overrides: Record<string, unknown> = {}) => ({
    id: 'imp-1',
    label: 'Imported',
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
    sourceDate: '2026-03-15',
    sourceSign: 'debit',
    asOf: '2026-01-10T08:00:00.000Z',
    ...overrides
  });

  const manualEntry = (overrides: Record<string, unknown> = {}) => ({
    id: 'man-1',
    label: 'Manual',
    amount: 20,
    startDate: '2026-02-01',
    endDate: '2026-02-01',
    accountId: null,
    notes: '',
    originType: 'manual',
    importSourceId: null,
    importBatchId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    provenance: 'planner',
    ...overrides
  });

  const recurringEvent = (overrides: Record<string, unknown> = {}) => ({
    id: 'rec-1',
    label: 'Rent',
    amount: 1500,
    accountId: 'checking-account-default',
    categoryId: null,
    cadence: 'monthly',
    rule: 'on_date',
    startDate: '2026-02-01',
    endDate: '2026-12-31',
    dayOfMonth: 1,
    enabled: true,
    provenance: 'recurrence',
    ...overrides
  });

  it('defaults imports to occurred (view-only) and manual entries to planned', () => {
    const { scenario } = decodeScenario({
      expenses: {
        entries: [
          importedEntry(),
          manualEntry(),
          importedEntry({ id: 'imp-future', startDate: '2030-01-01', sourceDate: '2030-01-01' })
        ],
        recurringEvents: [recurringEvent(), recurringEvent({ id: 'imported-rec', provenance: 'imported' })]
      }
    });

    const [imported, manual, futureImport] = scenario.expenses.entries;
    expect(imported.planningStatus).toBe('occurred');
    // Future-dated imports are still view-only: no date-based promotion.
    expect(futureImport.planningStatus).toBe('occurred');
    expect(manual.planningStatus).toBe('planned');
    expect(scenario.expenses.recurringEvents[0].planningStatus).toBe('planned');
    expect(scenario.expenses.recurringEvents[1].planningStatus).toBe('occurred');
  });

  it('preserves an explicit valid planned import but ignores an invalid status', () => {
    const { scenario } = decodeScenario({
      expenses: {
        entries: [
          importedEntry({ id: 'imp-planned', planningStatus: 'planned' }),
          importedEntry({ id: 'imp-bad', planningStatus: 'maybe' })
        ]
      }
    });

    expect(scenario.expenses.entries[0].planningStatus).toBe('planned');
    expect(scenario.expenses.entries[1].planningStatus).toBe('occurred');
  });

  it('does not promote an occurred import under a moved date or earlier anchor', () => {
    const raw = {
      expenses: {
        entries: [
          importedEntry({
            startDate: '2027-06-01',
            endDate: '2027-06-01',
            sourceDate: '2027-06-01',
            asOf: '2020-01-01T00:00:00.000Z'
          })
        ]
      }
    };

    const decoded = decodeScenario(raw);
    const first = decoded.scenario.expenses.entries[0];
    expect(first.planningStatus).toBe('occurred');

    // Round-trip is stable: repeated save/load never promotes the status.
    const roundTripped = decodeAppState(
      reencode({ scenario: decoded.scenario, ui: decoded.ui }),
      REFERENCE_DATE
    );
    expect(roundTripped.scenario.expenses.entries[0].planningStatus).toBe('occurred');
  });

  it('round-trips occurrence status and preserves original provenance fields', () => {
    const { scenario } = decodeScenario({
      expenses: {
        entries: [
          importedEntry({ id: 'imp-1' }),
          importedEntry({ id: 'imp-planned', planningStatus: 'planned' }),
          manualEntry()
        ],
        recurringEvents: [recurringEvent({ provenance: 'recurrence' })]
      }
    });

    const saved = JSON.parse(reencode({ scenario, ui: createDefaultUiState() })).scenario.expenses;
    expect(saved.entries.map((e: { planningStatus: string }) => e.planningStatus)).toEqual([
      'occurred',
      'planned',
      'planned'
    ]);
    expect(saved.recurringEvents[0].planningStatus).toBe('planned');
    expect(saved.entries[0].sourceDate).toBe('2026-03-15');
    expect(saved.entries[0].sourceSign).toBe('debit');
    expect(saved.entries[0].asOf).toBe('2026-01-10T08:00:00.000Z');
  });

  it('does not mutate the raw input while normalizing occurrence status', () => {
    const raw = {
      expenses: {
        entries: [importedEntry(), manualEntry()],
        recurringEvents: [recurringEvent()]
      }
    };
    const before = JSON.stringify(raw);
    decodeScenario(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Planned-copy provenance clearing (explicit `sourceSign: null`)
//
// AccountExpensesPlanner `copyTo` builds a planned manual clone with the import
// provenance explicitly cleared (`sourceDate`/`sourceSign`/`asOf` = `null`).
// The codec must preserve that explicit `null` as `null` instead of fabricating
// the default `'debit'`, while leaving a valid sibling import sign unchanged.
// ---------------------------------------------------------------------------

describe('planned-copy provenance clearing (explicit null sourceSign)', () => {
  const importedEntry = (sign: 'debit' | 'credit') => ({
    id: `imp-${sign}`,
    label: `Imported ${sign}`,
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
    sourceSign: sign,
    asOf: '2026-01-10T08:00:00.000Z'
  });

  // Mirrors `copyTo`: a planned manual clone with provenance explicitly cleared.
  const plannedCopy = (id: string) => ({
    id,
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
  });

  it('preserves the explicit null copy sign and the import sibling sign unchanged', () => {
    for (const sign of ['debit', 'credit'] as const) {
      const { scenario } = decodeScenario({
        expenses: { entries: [importedEntry(sign), plannedCopy(`copy-${sign}`)] }
      });

      const savedEntries = JSON.parse(reencode({ scenario, ui: createDefaultUiState() })).scenario.expenses
        .entries;
      const copy = savedEntries.find((entry: { id: string }) => entry.id === `copy-${sign}`);
      const sibling = savedEntries.find((entry: { id: string }) => entry.id === `imp-${sign}`);

      // No fabricated sign on the copied planned record; explicit null stays null.
      expect(copy.sourceSign).toBeNull();
      expect(copy.sourceSign).not.toBe('debit');
      expect(copy).toHaveProperty('sourceSign', null);
      // The original imported sibling keeps its own sign and provenance.
      expect(sibling.sourceSign).toBe(sign);
      expect(sibling.sourceDate).toBe('2026-03-15');
      expect(sibling.asOf).toBe('2026-01-10T08:00:00.000Z');
    }
  });

  it('is idempotent across save/load/save and never fabricates a sign', () => {
    const { scenario, ui } = decodeScenario({
      expenses: { entries: [importedEntry('credit'), plannedCopy('copy-credit')] }
    });

    const first = reencode({ scenario, ui });
    const reloaded = decodeAppState(first, REFERENCE_DATE);
    const second = reencode(reloaded);

    expect(second).toBe(first);

    const roundTripped = JSON.parse(second).scenario.expenses.entries;
    const copy = roundTripped.find((entry: { id: string }) => entry.id === 'copy-credit');
    const sibling = roundTripped.find((entry: { id: string }) => entry.id === 'imp-credit');
    expect(copy.sourceSign).toBeNull();
    expect(sibling.sourceSign).toBe('credit');
  });

  it('keeps an absent sign absent and only defaults a malformed present value', () => {
    const { sourceSign: _omitted, ...absentCopy } = plannedCopy('absent');
    void _omitted;
    const { scenario } = decodeScenario({
      expenses: {
        entries: [absentCopy, { ...plannedCopy('malformed'), sourceSign: 'not-a-sign' }]
      }
    });

    const savedEntries = JSON.parse(reencode({ scenario, ui: createDefaultUiState() })).scenario.expenses
      .entries;
    const absent = savedEntries.find((entry: { id: string }) => entry.id === 'absent');
    const malformed = savedEntries.find((entry: { id: string }) => entry.id === 'malformed');

    // Missing (undefined) stays absent — no manufactured key.
    expect(absent).not.toHaveProperty('sourceSign');
    // A present malformed value normalizes to the approved default without
    // discarding its siblings.
    expect(malformed.sourceSign).toBe('debit');
    expect(malformed.sourceDate).toBeNull();
    expect(malformed.asOf).toBeNull();
    expect(malformed.provenance).toBe('planner');
    expect(malformed.planningStatus).toBe('planned');
  });

  it('does not mutate the raw input while clearing provenance', () => {
    const raw = {
      expenses: { entries: [importedEntry('debit'), plannedCopy('copy-debit')] }
    };
    const before = JSON.stringify(raw);
    decodeScenario(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / D9 — single paycheck authority (granular ↔ flat sync on load)
// ---------------------------------------------------------------------------

describe('single paycheck authority (D9)', () => {
  const flatInfo = (overrides: Record<string, unknown> = {}) => ({
    grossSalary: 72000,
    taxes: 6000,
    healthBenefits: 0,
    retirement: 3000,
    retirementMatch: 1500,
    hsaContribution: 0,
    hsaEmployerMatch: 0,
    otherBenefits: 0,
    livingExpenses: 0,
    ...overrides
  });

  const granularPaycheck = {
    payFrequency: 'monthly',
    categories: [
      {
        id: 'cat-earnings',
        label: 'Earnings',
        kind: 'earning',
        lines: [{ id: 'earn-1', label: 'Regular', amount: 5000, mode: 'amount' }]
      },
      {
        id: 'cat-statutory',
        label: 'Statutory',
        kind: 'tax',
        lines: [{ id: 'tax-1', label: 'Federal', amount: 500, mode: 'amount' }]
      }
    ]
  };

  it('synthesizes a granular paycheck from a legacy flat-only entry and preserves the flat scalars', () => {
    const { scenario, diagnostics } = decodeScenario({
      careerPlan: { enabled: true, entries: [{ id: 'c1', label: 'Legacy', paycheckInfo: flatInfo() }] }
    });

    const career = scenario.careerPlan.entries[0];
    expect(career.paycheck).toBeDefined();
    expect(career.paycheck!.categories.length).toBeGreaterThan(0);
    // Flat scalars are preserved (not overwritten by the synthesized paycheck).
    expect(career.paycheckInfo!.grossSalary).toBe(72000);
    // The synthesized granular paycheck compiles back to non-zero gross.
    expect(compilePaycheck(career.paycheck!).grossSalary).toBe(72000);
    expect(compilePaycheck(career.paycheck!).grossSalary).toBeGreaterThan(0);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'legacy-paycheck-info-synthesized', severity: 'info' })
    );
  });

  it('derives the flat info from a granular paycheck, overriding stale flat values', () => {
    const { scenario } = decodeScenario({
      careerPlan: {
        enabled: true,
        entries: [{ id: 'c1', label: 'C', paycheck: granularPaycheck, paycheckInfo: flatInfo({ grossSalary: 1234 }) }]
      }
    });

    const career = scenario.careerPlan.entries[0];
    expect(career.paycheck!.payFrequency).toBe('monthly');
    // Flat info is re-derived from the granular authority, not the stale 1234.
    expect(career.paycheckInfo!.grossSalary).toBe(60000);
    expect(career.paycheckInfo!.taxes).toBe(6000);
  });

  it('applies the same sync to careers inside inactive timelines', () => {
    const { scenario } = decodeScenario({
      timelines: [
        {
          id: 'tl',
          label: 'Inactive',
          purchases: [],
          longTermPurchases: [],
          loans: [],
          creditCards: [],
          housing: [],
          careerPlan: {
            enabled: true,
            entries: [
              { id: 'tc-flat', label: 'Legacy TL', paycheckInfo: flatInfo() },
              { id: 'tc-granular', label: 'Granular TL', paycheck: granularPaycheck, paycheckInfo: flatInfo({ grossSalary: 999 }) }
            ]
          }
        }
      ]
    });

    const [flat, granular] = scenario.timelines[0].careerPlan.entries;
    expect(flat.paycheck).toBeDefined();
    expect(flat.paycheckInfo!.grossSalary).toBe(72000);
    expect(compilePaycheck(flat.paycheck!).grossSalary).toBe(72000);
    expect(granular.paycheckInfo!.grossSalary).toBe(60000);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 / D20 — signed net-worth history measurement
// ---------------------------------------------------------------------------

describe('signed net-worth history measurement (P4.6 / D20)', () => {
  const historyRaw = (overrides: Record<string, unknown> = {}) => ({
    id: 'h-1',
    date: '2026-01-31',
    accounts: [{ id: 'a1', label: 'Checking', balance: 1000 }],
    totalNetWorth: 1000,
    ...overrides
  });

  it('labels a legacy asset-only entry explicitly and preserves values/labels', () => {
    const { scenario } = decodeScenario({
      netWorth: { accounts: [], history: [historyRaw()], asOfDate: '' }
    });

    const entry = scenario.netWorth.history![0];
    expect(entry.measurement).toBe('assetOnly');
    expect(entry.totalNetWorth).toBe(1000);
    expect(entry.accounts[0]).toEqual({ id: 'a1', label: 'Checking', balance: 1000 });
    // Absent provenance/sourceSnapshotId are not invented for legacy entries.
    expect(entry.provenance).toBeUndefined();
    expect(entry.sourceSnapshotId).toBeUndefined();
  });

  it('preserves signed negative net worth without clamping', () => {
    const { scenario } = decodeScenario({
      netWorth: {
        accounts: [],
        history: [
          historyRaw({
            id: 'h-neg',
            measurement: 'assetsMinusLiabilities',
            accounts: [{ id: 'a1', label: 'Checking', balance: -250 }],
            totalNetWorth: -15000,
            provenance: 'imported',
            sourceSnapshotId: 'snap-9'
          })
        ],
        asOfDate: ''
      }
    });

    const entry = scenario.netWorth.history![0];
    expect(entry.measurement).toBe('assetsMinusLiabilities');
    expect(entry.totalNetWorth).toBe(-15000);
    expect(entry.accounts[0].balance).toBe(-250);
    expect(entry.provenance).toBe('imported');
    expect(entry.sourceSnapshotId).toBe('snap-9');
  });

  it('round-trips signed history and provenance byte-stably', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    scenario.netWorth.history = [
      historyRaw(),
      {
        id: 'h-neg',
        date: '2026-02-28',
        accounts: [],
        totalNetWorth: -1234.56,
        measurement: 'assetsMinusLiabilities',
        provenance: 'projected',
        sourceSnapshotId: null
      }
    ];

    const first = reencode({ scenario, ui: createDefaultUiState() });
    const decoded = decodeAppState(first, REFERENCE_DATE);
    const second = reencode({ scenario: decoded.scenario, ui: decoded.ui });
    expect(second).toBe(first);

    const signed = decoded.scenario.netWorth.history![1];
    expect(signed.measurement).toBe('assetsMinusLiabilities');
    expect(signed.totalNetWorth).toBe(-1234.56);
    expect(signed.provenance).toBe('projected');
    expect(signed.sourceSnapshotId).toBeNull();
  });

  it('coerces an invalid measurement/provenance but never drops the record', () => {
    const { scenario } = decodeScenario({
      netWorth: { accounts: [], history: [historyRaw({ measurement: 'nonsense', provenance: 'weird' })], asOfDate: '' }
    });

    const entry = scenario.netWorth.history![0];
    expect(entry.measurement).toBe('assetOnly');
    expect(entry.provenance).toBe('manual');
    expect(entry.totalNetWorth).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 / D20 — trajectory freeze context allowlist + round-trip
// ---------------------------------------------------------------------------

describe('trajectory freeze context allowlist and round-trip (P4.6 / D20)', () => {
  const snapshotRaw = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    label: 'T',
    createdAt: '2026-01-15',
    survivesToEnd: true,
    depletedAge: null,
    endAge: 90,
    endingBalance: 0,
    summary: '',
    years: [],
    ...overrides
  });

  it('round-trips complete freeze metadata and prunes unknown context keys', () => {
    const { scenario } = decodeScenario({
      trajectorySnapshots: [
        snapshotRaw({
          context: {
            measurement: 'assetsMinusLiabilities',
            startDate: '2026-01-01',
            endDate: '2046-01-01',
            schemaVersion: 3,
            engineRevision: 'p9.9-test',
            contextId: 'ctx-7',
            bogus: 'drop-me'
          }
        })
      ]
    });

    const context = scenario.trajectorySnapshots[0].context!;
    expect(context).toEqual({
      measurement: 'assetsMinusLiabilities',
      startDate: '2026-01-01',
      endDate: '2046-01-01',
      schemaVersion: 3,
      engineRevision: 'p9.9-test',
      contextId: 'ctx-7'
    });
    expect(context).not.toHaveProperty('bogus');

    const decoded = decodeAppState(reencode({ scenario, ui: createDefaultUiState() }), REFERENCE_DATE);
    expect(decoded.scenario.trajectorySnapshots[0].context).toEqual(context);
  });

  it('keeps a legacy snapshot without context legacy (no invented metadata)', () => {
    const { scenario } = decodeScenario({ trajectorySnapshots: [snapshotRaw()] });
    expect(scenario.trajectorySnapshots[0]).not.toHaveProperty('context');
  });

  it('preserves valid 0 / false / null / empty-string values', () => {
    const { scenario } = decodeScenario({
      trajectorySnapshots: [
        snapshotRaw({
          survivesToEnd: false,
          context: {
            measurement: 'assetOnly',
            startDate: '2026-01-01',
            endDate: '2026-01-01',
            schemaVersion: 0,
            engineRevision: '',
            contextId: ''
          }
        })
      ]
    });

    const snapshot = scenario.trajectorySnapshots[0] as TrajectorySnapshot;
    expect(snapshot.survivesToEnd).toBe(false);
    expect(snapshot.depletedAge).toBeNull();
    expect(snapshot.context!.schemaVersion).toBe(0);
    expect(snapshot.context!.engineRevision).toBe('');
    expect(snapshot.context!.contextId).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Phase 5 / D24 — canonical save cutover (prune derived paycheckInfo)
// ---------------------------------------------------------------------------

describe('save cutover: derived paycheckInfo is pruned (P5.3 / D24)', () => {
  const flatInfo = (overrides: Record<string, unknown> = {}) => ({
    grossSalary: 72000,
    taxes: 6000,
    healthBenefits: 0,
    retirement: 3000,
    retirementMatch: 1500,
    hsaContribution: 0,
    hsaEmployerMatch: 0,
    otherBenefits: 0,
    livingExpenses: 0,
    ...overrides
  });

  const defaultCareer = (scenario: Scenario) => scenario.careerPlan.entries[0];

  it('persists an edited granular paycheck and re-derives the flat cache on load', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const career = defaultCareer(scenario);
    const earning = career.paycheck!.categories.find((category) => category.kind === 'earning')!;
    earning.lines[0].amount = 7777;

    const saved = JSON.parse(reencode({ scenario, ui: createDefaultUiState() }));
    const savedCareer = saved.scenario.careerPlan.entries[0];
    expect(savedCareer).not.toHaveProperty('paycheckInfo');
    expect(savedCareer.paycheck).toBeDefined();
    expect(
      savedCareer.paycheck.categories.find((category: { kind: string }) => category.kind === 'earning').lines[0].amount
    ).toBe(7777);

    const loaded = decodeAppState(JSON.stringify(saved), REFERENCE_DATE).scenario.careerPlan.entries[0];
    expect(loaded.paycheck!.categories.find((category) => category.kind === 'earning')!.lines[0].amount).toBe(7777);
    // The flat cache is re-derived in memory from the granular authority.
    expect(loaded.paycheckInfo).toEqual(compilePaycheck(loaded.paycheck!));
  });

  it('converts a valid flat-only legacy entry to granular on save (never persists the cache)', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const career = defaultCareer(scenario) as unknown as Record<string, unknown>;
    delete career.paycheck;
    career.paycheckInfo = flatInfo();

    const result = encodeAppState({ scenario, ui: createDefaultUiState() }, REFERENCE_DATE);
    const saved = JSON.parse(result.json);
    const savedCareer = saved.scenario.careerPlan.entries[0];
    expect(savedCareer).not.toHaveProperty('paycheckInfo');
    expect(savedCareer.paycheck).toBeDefined();

    const loaded = decodeAppState(result.json, REFERENCE_DATE).scenario.careerPlan.entries[0];
    expect(compilePaycheck(loaded.paycheck!).grossSalary).toBe(72000);
    expect(compilePaycheck(loaded.paycheck!).taxes).toBe(6000);
  });

  it('preserves exact annual cents across the flat-only save cutover', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const career = defaultCareer(scenario) as unknown as Record<string, unknown>;
    delete career.paycheck;
    career.paycheckInfo = flatInfo({ grossSalary: 100000, taxes: 12345.67, retirement: 0.01 });

    const result = encodeAppState({ scenario, ui: createDefaultUiState() }, REFERENCE_DATE);
    const saved = JSON.parse(result.json);
    expect(saved.scenario.careerPlan.entries[0]).not.toHaveProperty('paycheckInfo');
    expect(saved.scenario.careerPlan.entries[0].paycheck).toBeDefined();

    const loaded = decodeAppState(result.json, REFERENCE_DATE).scenario.careerPlan.entries[0];
    const compiled = compilePaycheck(loaded.paycheck!);
    // 100000 / 12 = 8333.333…; the legacy 2-decimal rounding shaved 4 cents.
    expect(dollarsToCents(compiled.grossSalary)).toBe(10_000_000);
    expect(dollarsToCents(compiled.taxes)).toBe(dollarsToCents(12345.67));
    expect(dollarsToCents(compiled.retirement)).toBe(1);
    // The flat cache is re-derived from the granular authority on load.
    expect(loaded.paycheckInfo).toEqual(compiled);
  });

  it('normalizes negative and non-finite flat scalars on decode without fabricating income', () => {
    const { scenario } = decodeScenario({
      careerPlan: {
        enabled: true,
        entries: [{ id: 'c1', label: 'Legacy', paycheckInfo: { grossSalary: -5000, taxes: NaN, retirement: null } }]
      }
    });

    const career = scenario.careerPlan.entries[0];
    const compiled = compilePaycheck(career.paycheck!);
    expect(compiled.grossSalary).toBe(0);
    expect(compiled.taxes).toBe(0);
    expect(compiled.retirement).toBe(0);
    expect(dollarsToCents(compiled.grossSalary)).toBe(0);
  });


  it('flags an unusable flat paycheckInfo as a blocking save diagnostic', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const career = defaultCareer(scenario) as unknown as Record<string, unknown>;
    delete career.paycheck;
    career.paycheckInfo = 'not-a-record';

    const result = encodeAppState({ scenario, ui: createDefaultUiState() }, REFERENCE_DATE);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'paycheck-info-unconvertible', severity: 'error' })
    );
  });

  it('prunes the cache in inactive timelines and pay plans while preserving the granular paycheck', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const base = defaultCareer(scenario);
    const granularPaycheck = base.paycheck!;

    const flatCareer: Record<string, unknown> = { ...base, id: 'tl-flat', label: 'TL Flat', payPlans: [] };
    delete flatCareer.paycheck;
    flatCareer.paycheckInfo = flatInfo();
    const granularCareer: Record<string, unknown> = {
      ...base,
      id: 'tl-gran',
      label: 'TL Gran',
      payPlans: [{ id: 'pp', label: 'Plan', effectiveYearMonth: '2031-01', paycheck: granularPaycheck, sourceLines: [] }]
    };

    scenario.timelines = [
      {
        id: 'tl',
        label: 'Inactive',
        purchases: [],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [],
        careerPlan: { enabled: true, entries: [flatCareer as never, granularCareer as never] },
        housing: []
      }
    ];

    const saved = JSON.parse(reencode({ scenario, ui: createDefaultUiState() }));
    const [flatSaved, granularSaved] = saved.scenario.timelines[0].careerPlan.entries;
    expect(flatSaved).not.toHaveProperty('paycheckInfo');
    expect(flatSaved.paycheck).toBeDefined();
    expect(granularSaved).not.toHaveProperty('paycheckInfo');
    expect(granularSaved.paycheck).toBeDefined();
    expect(granularSaved.payPlans[0].paycheck).toBeDefined();
    expect(granularSaved.payPlans[0]).not.toHaveProperty('paycheckInfo');
  });

  it('preserves history, provenance, trajectory metadata, UI selection, markers and links', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    scenario.netWorth.history = [
      {
        id: 'h1',
        date: '2026-01-31',
        accounts: [{ id: 'a1', label: 'Checking', balance: 1000 }],
        totalNetWorth: -15000,
        measurement: 'assetsMinusLiabilities',
        provenance: 'imported',
        sourceSnapshotId: 'snap-9'
      }
    ];
    scenario.dateMarkers = [{ id: 'm1', label: 'Retire', date: '2040-01-01' }];
    scenario.liabilities = [{ id: 'L1', kind: 'loan', openingBalance: 500, linkedPropertyId: 'P1', endYearMonth: '2030-01' }];
    scenario.properties = [
      { id: 'P1', value: 300000, debtLink: 'L1', requiredDownPayment: 60000, status: 'owned' }
    ];
    scenario.trajectorySnapshots = [
      {
        id: 't1',
        label: 'T',
        createdAt: '2026-01-15',
        survivesToEnd: true,
        depletedAge: null,
        endAge: 90,
        endingBalance: 0,
        summary: '',
        years: [],
        context: {
          measurement: 'assetOnly',
          startDate: '2026-01-15',
          endDate: '2046-01-15',
          schemaVersion: 1,
          engineRevision: 'rev-1',
          contextId: 'ctx-1'
        }
      }
    ];
    const ui = { ...createDefaultUiState(), activeTab: 'expenses' as const, selectedCareerId: 'career-x', showRealDollars: true };

    const first = reencode({ scenario, ui });
    const saved = JSON.parse(first);
    expect(saved.scenario.netWorth.history[0]).toMatchObject({
      measurement: 'assetsMinusLiabilities',
      provenance: 'imported',
      totalNetWorth: -15000,
      sourceSnapshotId: 'snap-9'
    });
    expect(saved.scenario.trajectorySnapshots[0].context).toEqual({
      measurement: 'assetOnly',
      startDate: '2026-01-15',
      endDate: '2046-01-15',
      schemaVersion: 1,
      engineRevision: 'rev-1',
      contextId: 'ctx-1'
    });
    expect(saved.ui).toMatchObject({ activeTab: 'expenses', selectedCareerId: 'career-x', showRealDollars: true });
    expect(saved.scenario.dateMarkers[0]).toEqual({ id: 'm1', label: 'Retire', date: '2040-01-01' });
    expect(saved.scenario.liabilities[0]).toMatchObject({ id: 'L1', linkedPropertyId: 'P1' });
    expect(saved.scenario.properties[0]).toMatchObject({ id: 'P1', debtLink: 'L1' });

    // Byte-stable round-trip/idempotence.
    const decoded = decodeAppState(first, REFERENCE_DATE);
    expect(reencode({ scenario: decoded.scenario, ui: decoded.ui })).toBe(first);
  });

  it('never persists live run/audit/cache, expanded recurrences, or calculated balances', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const anyScenario = scenario as unknown as Record<string, any>;
    anyScenario.run = { complete: true, years: [] };
    anyScenario.projectionRun = { audit: true };
    anyScenario.incomeValidation = { hasOverspend: true };
    anyScenario.monthlySnapshots = [{ age: 45 }];
    anyScenario.calculatedBalances = { a1: 999 };
    anyScenario.cache = { contextId: 'x' };
    anyScenario.careerPlan.entries[0].audit = { live: true };
    anyScenario.careerPlan.entries[0].run = { complete: false };
    anyScenario.netWorth.accounts[0].balance = 12345;
    anyScenario.netWorth.accounts[0].calculatedBalance = 999;
    anyScenario.expenses.recurringEvents.push({
      id: 'rec',
      label: 'Rent',
      amount: 1500,
      accountId: 'checking-account-default',
      categoryId: null,
      cadence: 'monthly',
      rule: 'on_date',
      startDate: '2026-02-01',
      endDate: '2026-12-31',
      enabled: true,
      occurrences: [{ date: '2026-02-01' }],
      expandedDates: ['2026-02-01']
    });

    const saved = JSON.parse(reencode({ scenario, ui: createDefaultUiState() }));
    for (const key of ['run', 'projectionRun', 'incomeValidation', 'monthlySnapshots', 'calculatedBalances', 'cache']) {
      expect(saved.scenario).not.toHaveProperty(key);
    }
    expect(saved.scenario.careerPlan.entries[0]).not.toHaveProperty('audit');
    expect(saved.scenario.careerPlan.entries[0]).not.toHaveProperty('run');
    expect(saved.scenario.netWorth.accounts[0]).not.toHaveProperty('balance');
    expect(saved.scenario.netWorth.accounts[0]).not.toHaveProperty('calculatedBalance');
    expect(saved.scenario.netWorth.accounts[0].openingBalance).toBe(0);
    expect(saved.scenario.expenses.recurringEvents[0]).not.toHaveProperty('occurrences');
    expect(saved.scenario.expenses.recurringEvents[0]).not.toHaveProperty('expandedDates');
  });

  it('preserves valid 0 / false / null on paycheck lines and buckets', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const career = defaultCareer(scenario);
    career.paycheck = {
      payFrequency: 'biweekly',
      categories: [
        {
          id: 'c1',
          label: 'Earnings',
          kind: 'earning',
          lines: [{ id: 'l1', label: 'Base', amount: 0, mode: 'amount', ytd: 0, accountId: null, bucket: null }]
        }
      ]
    };

    const saved = JSON.parse(reencode({ scenario, ui: createDefaultUiState() })).scenario.careerPlan.entries[0];
    expect(saved.paycheck.payFrequency).toBe('biweekly');
    const line = saved.paycheck.categories[0].lines[0];
    expect(line.amount).toBe(0);
    expect(line.ytd).toBe(0);
    expect(line.accountId).toBeNull();
    expect(line.bucket).toBeNull();
  });

  it('keeps fresh reset state isolated and free of persisted caches', () => {
    const first = decodeAppState(null, REFERENCE_DATE);
    const second = decodeAppState(null, REFERENCE_DATE);
    expect(first.scenario.careerPlan.entries[0]).not.toBe(second.scenario.careerPlan.entries[0]);

    const saved = JSON.parse(reencode({ scenario: first.scenario, ui: first.ui }));
    expect(saved.scenario.careerPlan.entries[0]).not.toHaveProperty('paycheckInfo');
    expect(saved.scenario.careerPlan.entries[0].paycheck).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// P0.4.2 — career source `maxBalance`: absent means "no limit" (a cleared editor
// input), explicit `0` is a stored value. The allowlist normalizer must PRESERVE
// ABSENCE (omit the key) rather than coercing a cleared cap to `0` on load/save.
// ---------------------------------------------------------------------------

describe('career source maxBalance absence vs explicit 0 (P0.4.2)', () => {
  const line = (id: string, maxBalance?: number): CareerSourceLine => ({
    id,
    enabled: true,
    sourceType: 'account',
    sourceId: 'investments-account-default',
    contributionRate: 5,
    savingsMonthly: false,
    monthlyWithdrawal: 0,
    ...(maxBalance === undefined ? {} : { maxBalance })
  });

  it('omits an absent cap and keeps explicit 0 / positive dollars across save-load-save (base depositPlan, dated payPlans, inactive timeline)', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const base = scenario.careerPlan.entries[0];

    base.depositPlan = {
      allocations: [line('alloc-absent'), line('alloc-zero', 0), line('alloc-positive', 1200)],
      remainderAccountId: 'checking-account-default',
      postingDay: 1
    };
    base.payPlans = [
      {
        id: 'plan-1',
        label: 'Plan 1',
        effectiveYearMonth: '2031-01',
        paycheck: { payFrequency: 'monthly', categories: [] },
        sourceLines: [],
        depositPlan: {
          allocations: [line('pp-absent'), line('pp-zero', 0), line('pp-positive', 42.5)],
          remainderAccountId: null,
          postingDay: 2
        }
      }
    ];

    scenario.timelines = [
      {
        id: 'tl-inactive',
        label: 'Inactive',
        purchases: [],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [],
        careerPlan: {
          enabled: true,
          entries: [
            {
              ...base,
              id: 'tl-career',
              label: 'Inactive career',
              depositPlan: {
                allocations: [line('tl-absent'), line('tl-zero', 0)],
                remainderAccountId: null,
                postingDay: 3
              },
              payPlans: []
            }
          ]
        },
        housing: []
      }
    ];

    const first = reencode({ scenario, ui: createDefaultUiState() });
    const saved = JSON.parse(first);

    const savedBase = saved.scenario.careerPlan.entries[0];
    expect(savedBase.depositPlan.allocations[0]).not.toHaveProperty('maxBalance');
    expect(savedBase.depositPlan.allocations[1].maxBalance).toBe(0);
    expect(savedBase.depositPlan.allocations[2].maxBalance).toBe(1200);
    expect(savedBase.payPlans[0].depositPlan.allocations[0]).not.toHaveProperty('maxBalance');
    expect(savedBase.payPlans[0].depositPlan.allocations[1].maxBalance).toBe(0);
    expect(savedBase.payPlans[0].depositPlan.allocations[2].maxBalance).toBe(42.5);

    const savedTimelineEntry = saved.scenario.timelines[0].careerPlan.entries[0];
    expect(savedTimelineEntry.depositPlan.allocations[0]).not.toHaveProperty('maxBalance');
    expect(savedTimelineEntry.depositPlan.allocations[1].maxBalance).toBe(0);

    // Load keeps the absence in memory: the cap input reopens blank, not 0.
    const decoded = decodeAppState(first, REFERENCE_DATE);
    const loaded = decoded.scenario.careerPlan.entries[0].depositPlan!.allocations;
    expect(loaded[0]).not.toHaveProperty('maxBalance');
    expect(loaded[0].maxBalance).toBeUndefined();
    expect(loaded[1].maxBalance).toBe(0);
    expect(loaded[2].maxBalance).toBe(1200);

    // save → load → save is byte-idempotent.
    expect(reencode({ scenario: decoded.scenario, ui: decoded.ui })).toBe(first);
  });

  it('normalizes a present-but-malformed cap to 0 without dropping valid sibling fields', () => {
    const { scenario } = decodeScenario({
      careerPlan: {
        enabled: true,
        entries: [
          {
            id: 'c1',
            label: 'Career',
            depositPlan: {
              allocations: [
                { id: 'absent', sourceId: 'a1', sourceType: 'account' },
                { id: 'zero', sourceId: 'a1', sourceType: 'account', maxBalance: 0 },
                { id: 'positive', sourceId: 'a1', sourceType: 'account', maxBalance: 2500.5 },
                { id: 'malformed', sourceId: 'a1', sourceType: 'account', maxBalance: 'oops' },
                { id: 'negative', sourceId: 'a1', sourceType: 'account', maxBalance: -75 },
                { id: 'null', sourceId: 'a1', sourceType: 'account', maxBalance: null }
              ],
              remainderAccountId: null
            }
          }
        ]
      }
    });

    const allocations = scenario.careerPlan.entries[0].depositPlan!.allocations;
    expect(allocations).toHaveLength(6);
    expect(allocations[0]).not.toHaveProperty('maxBalance');
    expect(allocations[1].maxBalance).toBe(0);
    expect(allocations[2].maxBalance).toBe(2500.5);
    // Malformed present types normalize safely to 0 rather than coercing the line
    // away or dropping its valid sibling fields.
    expect(allocations[3].maxBalance).toBe(0);
    expect(allocations[4].maxBalance).toBe(0);
    expect(allocations[5].maxBalance).toBe(0);
    for (const allocation of allocations) {
      expect(allocation.sourceId).toBe('a1');
      expect(allocation.enabled).toBe(true);
      expect(allocation.sourceType).toBe('account');
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 5 / D24 — envelope schema version cutover
// ---------------------------------------------------------------------------

describe('envelope schema version cutover (P5.3 / D24)', () => {
  it('writes the current version and still loads older v1 payloads', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);

    const saved = JSON.parse(reencode({ scenario: createDefaultScenario(REFERENCE_DATE), ui: createDefaultUiState() }));
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    const legacy = envelope({ careerPlan: { enabled: true, entries: [{ id: 'c1', label: 'Legacy', paycheckInfo: { grossSalary: 48000 } }] } }, createDefaultUiState(), 1);
    const loaded = decodeAppState(legacy, REFERENCE_DATE);
    expect(loaded.blocked).toBe(false);
    expect(loaded.scenario.careerPlan.entries[0].paycheck).toBeDefined();

    const future = envelope({ profile: { currentAge: 99 } }, createDefaultUiState(), CURRENT_SCHEMA_VERSION + 1);
    const blocked = decodeAppState(future, REFERENCE_DATE);
    expect(blocked.blocked).toBe(true);
    expect(blocked.preservedBytes).toBe(future);
  });
});

// ---------------------------------------------------------------------------
// RV04 / F23 — card plans are a timeline-local domain
// ---------------------------------------------------------------------------

describe('timeline-local card plans persistence (RV04/F23)', () => {
  const basePlan = {
    kind: 'zeroInterestPayoff',
    id: 'base-zp',
    label: 'Base 0%',
    enabled: true,
    liabilityId: 'L1',
    initialBalance: 9999,
    startYearMonth: '2026-01',
    targetYearMonth: '2026-12',
    paymentDay: 1,
    funding: { primaryAccountId: 'checking-account-default', fallbackAccountIds: [] }
  };
  const timelinePlan = {
    kind: 'expectedPayment',
    id: 'tl-cp',
    label: 'Timeline Plan',
    enabled: true,
    amount: 150,
    startYearMonth: '2026-03',
    endYearMonth: '2027-02',
    paymentDay: 15,
    funding: { primaryAccountId: 'keep-account', fallbackAccountIds: [] }
  };

  it('normalizes a legacy timeline without cardPlans to [] and never clones base debt into it', () => {
    const raw = {
      cardPlans: [basePlan],
      timelines: [
        {
          id: 'tl1',
          label: 'Legacy',
          purchases: [],
          longTermPurchases: [],
          loans: [],
          creditCards: [],
          careerPlan: { enabled: true, entries: [] },
          housing: []
        }
      ]
    };

    const { scenario } = decodeScenario(raw, createDefaultUiState(), 2);

    // Base (implicit base timeline) plan is retained exactly.
    expect(scenario.cardPlans!.map((plan) => plan.id)).toEqual(['base-zp']);
    // The legacy inactive timeline gets an explicit empty array, never the base debt.
    expect(scenario.timelines[0].cardPlans).toEqual([]);
    // The raw input was not mutated to add a synthesized field.
    expect(raw.timelines[0]).not.toHaveProperty('cardPlans');
  });

  it('retains distinct base + per-timeline card plans through an encode round-trip', () => {
    const raw = {
      cardPlans: [basePlan],
      timelines: [
        {
          id: 'tl1',
          label: 'Timeline',
          purchases: [],
          longTermPurchases: [],
          loans: [],
          creditCards: [],
          cardPlans: [timelinePlan],
          careerPlan: { enabled: true, entries: [] },
          housing: []
        }
      ]
    };

    const { scenario } = decodeScenario(raw, createDefaultUiState(), 2);
    expect(scenario.cardPlans!.map((plan) => plan.id)).toEqual(['base-zp']);
    expect(scenario.timelines[0].cardPlans.map((plan) => plan.id)).toEqual(['tl-cp']);

    const saved = JSON.parse(reencode({ scenario, ui: createDefaultUiState() }));
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(saved.scenario.cardPlans.map((plan: { id: string }) => plan.id)).toEqual(['base-zp']);
    expect(saved.scenario.timelines[0].cardPlans.map((plan: { id: string }) => plan.id)).toEqual(['tl-cp']);
    expect(saved.scenario.timelines[0].cardPlans[0].kind).toBe('expectedPayment');
    // Base plan identity/debt is not duplicated onto the timeline.
    expect(saved.scenario.timelines[0].cardPlans.map((plan: { id: string }) => plan.id)).not.toContain('base-zp');
  });

  it('keeps the base card plans as the implicit base timeline after save/reload', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    scenario.cardPlans = [createDefaultOrdinaryCardSchedule(REFERENCE_DATE, { id: 'base-only' })];
    scenario.timelines = [];

    const saved = JSON.parse(reencode({ scenario, ui: createDefaultUiState() }));
    const reloaded = decodeAppState(JSON.stringify(saved), REFERENCE_DATE).scenario;

    expect(reloaded.cardPlans!.map((plan) => plan.id)).toEqual(['base-only']);
    expect(reloaded.timelines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RV04 / F23 — housing funding events are a timeline-local domain
// ---------------------------------------------------------------------------

describe('timeline-local housing funding events persistence (RV04/F23)', () => {
  const baseProperty: PropertyDefinition = {
    id: 'prop-base',
    value: 0,
    requiredDownPayment: 60000,
    status: 'pending',
    sourceConfigId: 'hA',
    fundingEvents: [{ id: 'pfe-1', date: '2026-06-01', amount: 30000, accountId: 'checking-account-default' }]
  };
  const baseHousing = {
    id: 'hA',
    label: 'Home A',
    enabled: true,
    housingType: 'mortgage',
    startYearMonth: '2027-06'
  };

  it('keeps an explicit timeline-local list and the global property opening identity through a round-trip', () => {
    const raw = {
      properties: [baseProperty],
      housing: [baseHousing],
      timelines: [
        {
          id: 'tl1',
          label: 'Timeline',
          purchases: [],
          longTermPurchases: [],
          loans: [],
          creditCards: [],
          careerPlan: { enabled: true, entries: [] },
          housing: [
            {
              ...baseHousing,
              fundingEvents: [
                { id: 'tl-e1', date: '2026-08-01', amount: 15000, accountId: 'keep-account' },
                { id: 'tl-e2', date: '2027-02-01', amount: 0, accountId: null }
              ]
            }
          ]
        }
      ]
    };

    const { scenario } = decodeScenario(raw);
    // Global property identity + events retained (base implicit timeline).
    expect(scenario.properties![0]).toMatchObject({ id: 'prop-base', status: 'pending', sourceConfigId: 'hA' });
    expect(scenario.properties![0].fundingEvents!.map((event) => event.id)).toEqual(['pfe-1']);

    // Timeline-local list is independent and preserves `0` / `null` / account ids.
    const timelineEvents = scenario.timelines[0].housing[0].fundingEvents!;
    expect(timelineEvents.map((event) => event.id)).toEqual(['tl-e1', 'tl-e2']);
    expect(timelineEvents[0].accountId).toBe('keep-account');
    expect(timelineEvents[1].amount).toBe(0);
    expect(timelineEvents[1].accountId).toBeNull();

    const saved = JSON.parse(reencode({ scenario, ui: createDefaultUiState() }));
    expect(saved.scenario.properties[0].fundingEvents.map((event: { id: string }) => event.id)).toEqual(['pfe-1']);
    expect(saved.scenario.properties[0].status).toBe('pending');
    expect(saved.scenario.timelines[0].housing[0].fundingEvents.map((event: { id: string }) => event.id)).toEqual([
      'tl-e1',
      'tl-e2'
    ]);
    // The base list is never duplicated onto the timeline.
    expect(saved.scenario.timelines[0].housing[0].fundingEvents.map((event: { id: string }) => event.id)).not.toContain(
      'pfe-1'
    );
  });

  it('normalizes a legacy timeline housing entry without fundingEvents and never inherits the base list', () => {
    const raw = {
      properties: [baseProperty],
      housing: [baseHousing],
      timelines: [
        {
          id: 'tl1',
          label: 'Legacy',
          purchases: [],
          longTermPurchases: [],
          loans: [],
          creditCards: [],
          careerPlan: { enabled: true, entries: [] },
          housing: [{ ...baseHousing }]
        }
      ]
    };

    const { scenario } = decodeScenario(raw);

    // Omission is preserved (consumers interpret it as `[]`); the base list is not cloned in.
    expect(scenario.timelines[0].housing[0].fundingEvents).toBeUndefined();
    expect(raw.timelines[0].housing[0]).not.toHaveProperty('fundingEvents');
    // The base property events remain the implicit base timeline source.
    expect(scenario.properties![0].fundingEvents!.map((event) => event.id)).toEqual(['pfe-1']);
  });

  it('keeps base property events as the implicit base timeline with no timelines after save/reload', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    scenario.properties = [{ ...baseProperty }];
    scenario.timelines = [];
    scenario.activeTimelineId = null;

    const saved = JSON.parse(reencode({ scenario, ui: createDefaultUiState() }));
    const reloaded = decodeAppState(JSON.stringify(saved), REFERENCE_DATE).scenario;

    expect(reloaded.properties![0].fundingEvents!.map((event) => event.id)).toEqual(['pfe-1']);
    expect(reloaded.properties![0].status).toBe('pending');
    expect(reloaded.timelines).toEqual([]);
    expect(reloaded.activeTimelineId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// G20 / G22 — ordered per-group housing funding policies (P0.3.1 item 6)
// ---------------------------------------------------------------------------

describe('housing per-group funding policies (G20/G22)', () => {
  const baseHousingRaw = (overrides: Record<string, unknown> = {}) => ({
    id: 'hA',
    label: 'Home A',
    enabled: true,
    housingType: 'mortgage',
    startYearMonth: '2027-06',
    ...overrides
  });

  const timeline = (id: string, housing: unknown[]) => ({
    id,
    label: id,
    purchases: [],
    longTermPurchases: [],
    loans: [],
    creditCards: [],
    careerPlan: { enabled: true, entries: [] },
    housing
  });

  it('round-trips ordered base + A/B group policies independently without mutating the raw input', () => {
    const raw = {
      housing: [
        baseHousingRaw({
          fundingPolicies: {
            payment: { primaryAccountId: 'acc-1', fallbackAccountIds: ['acc-2', 'acc-3'] },
            downPayment: { primaryAccountId: null, fallbackAccountIds: [] }
          }
        })
      ],
      timelines: [
        timeline('tlA', [
          baseHousingRaw({
            id: 'hA-tl',
            fundingPolicies: {
              payment: { primaryAccountId: 'acc-A', fallbackAccountIds: ['acc-B'] },
              taxesInsurance: { primaryAccountId: 'acc-C', fallbackAccountIds: [] }
            }
          })
        ]),
        timeline('tlB', [
          baseHousingRaw({
            id: 'hB-tl',
            fundingPolicies: { hoaMaintenance: { primaryAccountId: null, fallbackAccountIds: ['acc-D'] } }
          })
        ])
      ]
    };
    const snapshot = JSON.parse(JSON.stringify(raw));

    const { scenario } = decodeScenario(raw);

    // Base order preserved exactly; explicit `null` primary / `[]` fallbacks kept.
    expect(scenario.housing[0].fundingPolicies).toEqual({
      payment: { primaryAccountId: 'acc-1', fallbackAccountIds: ['acc-2', 'acc-3'] },
      downPayment: { primaryAccountId: null, fallbackAccountIds: [] }
    });
    // Inactive timelines own independent group policies (A ≠ B).
    expect(scenario.timelines[0].housing[0].fundingPolicies).toEqual({
      payment: { primaryAccountId: 'acc-A', fallbackAccountIds: ['acc-B'] },
      taxesInsurance: { primaryAccountId: 'acc-C', fallbackAccountIds: [] }
    });
    expect(scenario.timelines[1].housing[0].fundingPolicies).toEqual({
      hoaMaintenance: { primaryAccountId: null, fallbackAccountIds: ['acc-D'] }
    });

    // The codec never mutates its input.
    expect(raw).toEqual(snapshot);

    // Save → reload keeps the ordered policies for base + both timelines.
    const json = reencode({ scenario, ui: createDefaultUiState() });
    const saved = JSON.parse(json);
    expect(saved.scenario.housing[0].fundingPolicies.payment).toEqual({
      primaryAccountId: 'acc-1',
      fallbackAccountIds: ['acc-2', 'acc-3']
    });
    expect(saved.scenario.timelines[1].housing[0].fundingPolicies.hoaMaintenance).toEqual({
      primaryAccountId: null,
      fallbackAccountIds: ['acc-D']
    });

    const reloaded = decodeAppState(json, REFERENCE_DATE).scenario;
    expect(reloaded.housing[0].fundingPolicies!.payment!.fallbackAccountIds).toEqual(['acc-2', 'acc-3']);
    expect(reloaded.timelines[0].housing[0].fundingPolicies!.payment!.primaryAccountId).toBe('acc-A');
    expect(reloaded.timelines[1].housing[0].fundingPolicies!.hoaMaintenance!.primaryAccountId).toBeNull();
    // The two timelines never alias each other's policies.
    expect(reloaded.timelines[0].housing[0].fundingPolicies!.hoaMaintenance).toBeUndefined();
    expect(reloaded.timelines[1].housing[0].fundingPolicies!.payment).toBeUndefined();
  });

  it('preserves legacy group source account ids as the read fallback when no policy override exists', () => {
    const { scenario } = decodeScenario({
      housing: [
        baseHousingRaw({
          paymentSource: 'account:acc-1',
          taxesInsuranceSource: 'account:acc-2',
          hoaMaintenanceSource: 'account:acc-3',
          pmiSource: 'account:acc-4',
          downPaymentSource: 'account:acc-5'
        })
      ]
    });

    const entry = scenario.housing[0];
    expect(entry.fundingPolicies).toBeUndefined();
    expect(entry.paymentSource).toBe('account:acc-1');
    expect(entry.taxesInsuranceSource).toBe('account:acc-2');
    expect(entry.hoaMaintenanceSource).toBe('account:acc-3');
    expect(entry.pmiSource).toBe('account:acc-4');
    expect(entry.downPaymentSource).toBe('account:acc-5');
  });

  it('keeps an explicit override (beating the global default) and prunes unknown group keys', () => {
    const { scenario } = decodeScenario({
      fundingPolicy: { primaryAccountId: 'global-1', fallbackAccountIds: ['global-2'] },
      housing: [
        baseHousingRaw({
          fundingPolicies: {
            // Explicit override with a null primary must NOT fall back to global.
            payment: { primaryAccountId: null, fallbackAccountIds: ['acc-X'] },
            // Unknown group keys are pruned by the allowlist.
            cableTv: { primaryAccountId: 'nope', fallbackAccountIds: [] }
          }
        })
      ]
    });

    const policies = scenario.housing[0].fundingPolicies!;
    expect(Object.keys(policies)).toEqual(['payment']);
    expect(policies.payment).toEqual({ primaryAccountId: null, fallbackAccountIds: ['acc-X'] });
    // A group with no override stays absent so it inherits the global default.
    expect(policies.taxesInsurance).toBeUndefined();
  });

  it('default housing/rental entries carry no group override so they inherit the global explicit order', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const home = createDefaultHousingEntry(40, DATE_OF_BIRTH, REFERENCE_DATE);
    const rental = createDefaultRentalEntry(40, DATE_OF_BIRTH, REFERENCE_DATE);

    // No fabricated / hidden group override: inheritance is expressed by absence.
    expect(home.fundingPolicies).toBeUndefined();
    expect(rental.fundingPolicies).toBeUndefined();
    // The inherited global order is explicit (checking, no fallbacks).
    expect(scenario.fundingPolicy).toEqual({
      primaryAccountId: 'checking-account-default',
      fallbackAccountIds: []
    });
    expect(scenario.netWorth.accounts.map((account) => account.id)).toEqual([
      'checking-account-default',
      'emergencyFund-account-default',
      'hsa-account-default',
      'investments-account-default',
      'retirement401k-account-default'
    ]);
  });
});

// ---------------------------------------------------------------------------
// P5 / D20 — canonical versioned trajectory snapshots
// ---------------------------------------------------------------------------

describe('canonical versioned trajectory snapshots (P5 / D20)', () => {
  const canonicalRaw = (overrides: Record<string, unknown> = {}) => ({
    formatVersion: 2,
    id: 'c1',
    label: 'Canonical',
    createdAt: '2026-01-15',
    context: {
      measurement: 'assetsMinusLiabilities',
      startDate: '2026-01-15',
      endDate: '2046-01-15',
      schemaVersion: 2,
      engineRevision: 'rev-2',
      contextId: 'ctx-2'
    },
    annualPoints: [
      {
        calendarYear: 2026,
        closingDate: '2026-12-31',
        netWorthCents: 150000,
        accountAssetsCents: 200000,
        liabilityCents: 50000
      },
      {
        calendarYear: 2027,
        closingDate: '2027-12-31',
        netWorthCents: -2500,
        accountAssetsCents: 175000,
        liabilityCents: 177500
      }
    ],
    ...overrides
  });

  const legacyRaw = (overrides: Record<string, unknown> = {}) => ({
    id: 'l1',
    label: 'Legacy',
    createdAt: '2026-01-15',
    survivesToEnd: true,
    depletedAge: null,
    endAge: 90,
    endingBalance: 0,
    summary: '',
    years: [],
    context: {
      measurement: 'assetOnly',
      startDate: '2026-01-15',
      endDate: '2046-01-15',
      schemaVersion: 1,
      engineRevision: 'rev-1',
      contextId: 'ctx-1'
    },
    ...overrides
  });

  it('normalizes a canonical snapshot and preserves signed / exact cents', () => {
    const { scenario, diagnostics } = decodeScenario({ trajectorySnapshots: [canonicalRaw()] });

    const snapshot = scenario.trajectorySnapshots[0] as CanonicalTrajectorySnapshot;
    expect(snapshot.formatVersion).toBe(2);
    expect(snapshot.id).toBe('c1');
    expect(snapshot.context).toEqual({
      measurement: 'assetsMinusLiabilities',
      startDate: '2026-01-15',
      endDate: '2046-01-15',
      schemaVersion: 2,
      engineRevision: 'rev-2',
      contextId: 'ctx-2'
    });
    expect(snapshot.annualPoints).toEqual([
      { calendarYear: 2026, closingDate: '2026-12-31', netWorthCents: 150000, accountAssetsCents: 200000, liabilityCents: 50000 },
      { calendarYear: 2027, closingDate: '2027-12-31', netWorthCents: -2500, accountAssetsCents: 175000, liabilityCents: 177500 }
    ]);
    // Signed net worth is preserved and account assets / debt stay separate.
    expect(snapshot.annualPoints[1].netWorthCents).toBe(-2500);
    expect(snapshot.annualPoints[1].accountAssetsCents).toBe(175000);
    expect(snapshot.annualPoints[1].liabilityCents).toBe(177500);
    expect(snapshot.annualPoints[1].accountAssetsCents).not.toBe(snapshot.annualPoints[1].netWorthCents);
    expect(diagnostics.some((entry) => entry.severity === 'error')).toBe(false);
  });

  it('round-trips a canonical snapshot byte-stably', () => {
    const { scenario } = decodeScenario({ trajectorySnapshots: [canonicalRaw()] });
    const first = reencode({ scenario, ui: createDefaultUiState() });
    const decoded = decodeAppState(first, REFERENCE_DATE);
    const second = reencode({ scenario: decoded.scenario, ui: decoded.ui });

    expect(second).toBe(first);
    const roundTripped = decoded.scenario.trajectorySnapshots[0] as CanonicalTrajectorySnapshot;
    expect(roundTripped.annualPoints[1].netWorthCents).toBe(-2500);
  });

  it('rejects a malformed point locally without dropping the snapshot or valid points', () => {
    const { scenario, diagnostics } = decodeScenario({
      trajectorySnapshots: [
        canonicalRaw({
          annualPoints: [
            { calendarYear: 2026, closingDate: '2026-12-31', netWorthCents: 1, accountAssetsCents: 2, liabilityCents: 0 },
            { calendarYear: 2027, closingDate: 'not-a-date', netWorthCents: 1.5, accountAssetsCents: 'x', liabilityCents: 0 },
            { calendarYear: 2028, closingDate: '2028-12-31', netWorthCents: -3, accountAssetsCents: 4, liabilityCents: 7 }
          ]
        })
      ]
    });

    const snapshot = scenario.trajectorySnapshots[0] as CanonicalTrajectorySnapshot;
    expect(snapshot.formatVersion).toBe(2);
    expect(snapshot.annualPoints.map((point) => point.calendarYear)).toEqual([2026, 2028]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'malformed-trajectory-point', severity: 'warning' })
    );
  });

  it('refuses a canonical snapshot with invalid required metadata and keeps a legacy sibling', () => {
    const { scenario, diagnostics } = decodeScenario({
      trajectorySnapshots: [
        canonicalRaw({
          context: {
            measurement: 'nonsense',
            startDate: '2026-01-15',
            endDate: '2046-01-15',
            schemaVersion: 2,
            engineRevision: 'rev-2'
          }
        }),
        legacyRaw()
      ]
    });

    expect(scenario.trajectorySnapshots).toHaveLength(1);
    expect(scenario.trajectorySnapshots[0]).not.toHaveProperty('formatVersion');
    expect(scenario.trajectorySnapshots[0].id).toBe('l1');
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'malformed-trajectory-context', severity: 'error' })
    );
  });

  it('refuses a canonical snapshot missing engineRevision/schemaVersion (never fabricates metadata)', () => {
    const { scenario, diagnostics } = decodeScenario({
      trajectorySnapshots: [
        canonicalRaw({
          context: { measurement: 'assetOnly', startDate: '2026-01-15', endDate: '2046-01-15' }
        })
      ]
    });

    expect(scenario.trajectorySnapshots).toEqual([]);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'malformed-trajectory-context' }));
  });

  it('blocks a future trajectory formatVersion and preserves the original bytes', () => {
    const raw = envelope({ trajectorySnapshots: [canonicalRaw({ formatVersion: 3 })] });
    const result = decodeAppState(raw, REFERENCE_DATE);

    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toBe('future-trajectory-format-version');
    expect(result.preservedBytes).toBe(raw);
    expect(result.scenario.trajectorySnapshots).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'future-trajectory-format-version', severity: 'error' })
    );
  });

  it('refuses a malformed (non-future, non-2) formatVersion instead of reinterpreting it', () => {
    const { scenario, diagnostics } = decodeScenario({ trajectorySnapshots: [canonicalRaw({ formatVersion: 1 })] });

    expect(scenario.trajectorySnapshots).toEqual([]);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'malformed-trajectory-format-version' }));
  });

  it('leaves a legacy assetOnly snapshot unversioned and byte-equivalent', () => {
    const { scenario } = decodeScenario({ trajectorySnapshots: [legacyRaw()] });
    expect(scenario.trajectorySnapshots[0]).not.toHaveProperty('formatVersion');
    const legacy = scenario.trajectorySnapshots[0] as TrajectorySnapshot;
    expect(legacy.context!.measurement).toBe('assetOnly');

    const first = reencode({ scenario, ui: createDefaultUiState() });
    const decoded = decodeAppState(first, REFERENCE_DATE);
    expect(reencode({ scenario: decoded.scenario, ui: decoded.ui })).toBe(first);
    expect(JSON.parse(first).scenario.trajectorySnapshots[0]).not.toHaveProperty('formatVersion');
  });

  it('preserves valid 0 / empty / absent canonical values', () => {
    const { scenario } = decodeScenario({
      trajectorySnapshots: [
        canonicalRaw({
          createdAt: '',
          context: {
            measurement: 'accountAssets',
            startDate: '2026-01-15',
            endDate: '2026-01-15',
            schemaVersion: 0,
            engineRevision: 'rev-0'
          },
          annualPoints: [
            { calendarYear: 2026, closingDate: '2026-12-31', netWorthCents: 0, accountAssetsCents: 0, liabilityCents: 0 }
          ]
        })
      ]
    });

    const snapshot = scenario.trajectorySnapshots[0] as CanonicalTrajectorySnapshot;
    expect(snapshot.createdAt).toBe('');
    expect(snapshot.context.schemaVersion).toBe(0);
    expect(snapshot.context.engineRevision).toBe('rev-0');
    expect(snapshot.context).not.toHaveProperty('contextId');
    expect(snapshot.annualPoints[0]).toEqual({
      calendarYear: 2026,
      closingDate: '2026-12-31',
      netWorthCents: 0,
      accountAssetsCents: 0,
      liabilityCents: 0
    });
  });

  it('does not mutate the raw input while normalizing a canonical snapshot', () => {
    const raw = { trajectorySnapshots: [canonicalRaw()] };
    const before = JSON.stringify(raw);
    decodeScenario(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
