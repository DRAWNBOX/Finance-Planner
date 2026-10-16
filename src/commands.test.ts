import { describe, expect, it } from 'vitest';

import {
  addAccount,
  addCareerPayPlan,
  addTimeline,
  applyGlobal,
  applyToActiveTimeline,
  changedScenarioKeys,
  clearDanglingMarkerReferences,
  cloneCareerEntry,
  createConfigurationCommands,
  deepClone,
  deepFreeze,
  deleteTimeline,
  duplicateCareer,
  duplicateTimeline,
  getActiveTimelineData,
  getCareerPayPlan,
  GLOBAL_SCENARIO_KEYS,
  isGlobalScenarioKey,
  isTimelineScopeScenarioKey,
  removeAccount,
  removeCareer,
  removeCareerPayPlan,
  removeDateMarker,
  resolveCareerAndHousingChains,
  resolveCareerChain,
  resolveHousingChain,
  resolveMarkerReferences,
  scanMarkerReferences,
  switchTimeline,
  TIMELINE_SCOPE_SCENARIO_KEYS,
  updateAccount,
  updateCareerPayPlan
} from './commands';
import {
  resolveHistoricalObservations,
  resolveOpening,
  resolveOpeningAccountBalances,
  summarizeOpening
} from './engine/opening';
import {
  createDefaultCareerEntry,
  createDefaultHousingEntry,
  createDefaultLargePurchase,
  createDefaultLoan,
  createDefaultOrdinaryCardSchedule,
  createDefaultScenario,
  createDefaultZeroInterestCardPlan
} from './defaultScenario';
import type { CareerPayPlan, PropertyDefinition, Scenario, Timeline } from './types';

const REFERENCE_DATE = new Date('2026-01-15');
const DATE_OF_BIRTH = '1980-10-01';

const makeScenario = (): Scenario => createDefaultScenario(REFERENCE_DATE);

const makePayPlan = (id: string, seedCareer = createDefaultCareerEntry(0, 45, 65, 'seed')): CareerPayPlan => ({
  id,
  label: `Plan ${id}`,
  effectiveYearMonth: '2027-01',
  effectiveMarkerId: null,
  paycheck: deepClone(seedCareer.paycheck!),
  sourceLines: deepClone(seedCareer.sourceLines!),
  annualRaiseRate: 2,
  depositPlan: deepClone(seedCareer.depositPlan)
});

describe('deepClone / deepFreeze', () => {
  it('deepClone produces independent nested career/plan graphs', () => {
    const career = createDefaultCareerEntry(0, 45, 65, 'c1');
    career.payPlans = [makePayPlan('p1')];
    const clone = deepClone(career);

    clone.payPlans![0].paycheck.categories[0].lines[0].amount = 999;
    clone.payPlans![0].sourceLines[0].contributionRate = 77;
    clone.depositPlan!.allocations[0].contributionRate = 66;
    clone.paycheck!.categories[0].lines[0].amount = 55;

    expect(career.payPlans![0].paycheck.categories[0].lines[0].amount).not.toBe(999);
    expect(career.payPlans![0].sourceLines[0].contributionRate).not.toBe(77);
    expect(career.depositPlan!.allocations[0].contributionRate).not.toBe(66);
    expect(career.paycheck!.categories[0].lines[0].amount).not.toBe(55);
    expect(clone).not.toBe(career);
  });

  it('deepFreeze freezes an independent clone and never freezes the source', () => {
    const source = { a: { b: [1, 2] }, c: 'x' };
    const frozen = deepFreeze(source);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a.b)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.a)).toBe(false);
    expect(() => {
      (frozen as { c: string }).c = 'y';
    }).toThrow();
  });
});

describe('active timeline selectors and writes', () => {
  it('falls back to base fields when no timeline is active', () => {
    const scenario = makeScenario();
    const data = getActiveTimelineData(scenario);
    expect(data.purchases).toEqual(scenario.largePurchases);
    expect(data.careerPlan).toEqual(scenario.careerPlan);
  });

  it('resolves the active timeline domains when one is active', () => {
    const base = makeScenario();
    const timeline = addTimeline(base, { id: 't1', label: 'T1' });
    const data = getActiveTimelineData(timeline);
    expect(data.purchases).toBe(timeline.timelines![0].purchases);
    expect(data.careerPlan).toBe(timeline.timelines![0].careerPlan);
  });

  it('writes only to the active timeline and never mutates the source', () => {
    const base = makeScenario();
    const active = addTimeline(base, { id: 't1', label: 'T1' });
    const purchase = createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE);

    const next = applyToActiveTimeline(active, (data) => ({ ...data, purchases: [...data.purchases, purchase] }));

    expect(next.timelines![0].purchases).toHaveLength(1);
    expect(next.largePurchases).toHaveLength(0);
    // Source untouched.
    expect(active.timelines![0].purchases).toHaveLength(0);
    expect(base.largePurchases).toHaveLength(0);
  });

  it('writes to base fields when no timeline is active', () => {
    const base = makeScenario();
    const purchase = createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE);
    const next = applyToActiveTimeline(base, (data) => ({ ...data, purchases: [purchase] }));
    expect(next.largePurchases).toHaveLength(1);
    expect(next.timelines).toHaveLength(0);
    expect(base.largePurchases).toHaveLength(0);
  });

  it('recovers a dangling activeTimelineId with a safe base write and clears the stale id', () => {
    const scenario = makeScenario();
    scenario.activeTimelineId = 'missing-timeline';
    const purchase = createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE);

    const next = applyToActiveTimeline(scenario, (data) => ({ ...data, purchases: [purchase] }));

    expect(next.activeTimelineId).toBeNull();
    expect(next.largePurchases).toHaveLength(1);
    // Write agrees with the selectors' fallback.
    expect(getActiveTimelineData(next).purchases).toBe(next.largePurchases);
    // Source untouched.
    expect(scenario.activeTimelineId).toBe('missing-timeline');
    expect(scenario.largePurchases).toHaveLength(0);
  });
});

describe('timeline CRUD', () => {
  it('addTimeline deep-copies the active set and activates the copy', () => {
    const base = makeScenario();
    base.largePurchases = [createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE)];

    const next = addTimeline(base, { id: 't1', label: 'T1' });

    expect(next.activeTimelineId).toBe('t1');
    expect(next.timelines).toHaveLength(1);
    expect(next.timelines![0].purchases).toHaveLength(1);
    expect(next.timelines![0].purchases[0]).not.toBe(base.largePurchases[0]);
  });

  it('switch/rename/delete behave and reset the active id on delete', () => {
    const base = makeScenario();
    const one = addTimeline(base, { id: 't1', label: 'One' });
    const two = addTimeline(one, { id: 't2', label: 'Two' });
    expect(two.activeTimelineId).toBe('t2');

    const switched = switchTimeline(two, 't1');
    expect(switched.activeTimelineId).toBe('t1');

    const deleted = deleteTimeline(switched, 't1');
    expect(deleted.activeTimelineId).toBeNull();
    expect(deleted.timelines).toHaveLength(1);
  });

  it('duplicateTimeline deep-copies without activating', () => {
    const base = makeScenario();
    const one = addTimeline(base, { id: 't1' });
    const copy = duplicateTimeline(one, 't1', { id: 't2' });
    expect(copy.activeTimelineId).toBe('t1');
    expect(copy.timelines).toHaveLength(2);
    expect(copy.timelines![1]).not.toBe(copy.timelines![0]);
    expect(copy.timelines![1].id).toBe('t2');
  });
});

describe('timeline-local card plans (RV04/F23)', () => {
  const checkingId = 'checking-account-default';
  const keepId = 'keep-account';

  it('keeps base and timeline card plans isolated (base + active selectors)', () => {
    const base = makeScenario();
    base.cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
        id: 'base-plan',
        funding: { primaryAccountId: checkingId, fallbackAccountIds: [] }
      })
    ];

    // No timeline yet: the active selector is the implicit base timeline.
    expect(getActiveTimelineData(base).cardPlans.map((plan) => plan.id)).toEqual(['base-plan']);

    const withTimeline = addTimeline(base, { id: 't1', label: 'T1' });
    // addTimeline deep-copies the active (base) set into the new timeline.
    expect(withTimeline.timelines![0].cardPlans.map((plan) => plan.id)).toEqual(['base-plan']);
    expect(withTimeline.timelines![0].cardPlans[0]).not.toBe(base.cardPlans![0]);

    const written = applyToActiveTimeline(withTimeline, (data) => ({
      ...data,
      cardPlans: [
        ...data.cardPlans,
        createDefaultOrdinaryCardSchedule(REFERENCE_DATE, { id: 'tl-plan', funding: { primaryAccountId: keepId, fallbackAccountIds: [] } })
      ]
    }));

    // The write lands only on the active timeline; the base list is untouched.
    expect(written.timelines![0].cardPlans.map((plan) => plan.id)).toEqual(['base-plan', 'tl-plan']);
    expect(written.cardPlans!.map((plan) => plan.id)).toEqual(['base-plan']);
    expect(getActiveTimelineData(written).cardPlans.map((plan) => plan.id)).toEqual(['base-plan', 'tl-plan']);
    expect(getActiveTimelineData(switchTimeline(written, null)).cardPlans.map((plan) => plan.id)).toEqual(['base-plan']);

    // Source never mutated or aliased.
    expect(base.cardPlans!.map((plan) => plan.id)).toEqual(['base-plan']);
    expect(withTimeline.timelines![0].cardPlans.map((plan) => plan.id)).toEqual(['base-plan']);
  });

  it('duplicateTimeline deep-clones nested card funding with no aliases', () => {
    const base = makeScenario();
    base.cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
        id: 'cp1',
        funding: { primaryAccountId: checkingId, fallbackAccountIds: [keepId] }
      })
    ];
    const one = addTimeline(base, { id: 't1', label: 'One' });
    const copy = duplicateTimeline(one, 't1', { id: 't2' });

    const sourcePlan = copy.timelines!.find((t) => t.id === 't1')!.cardPlans[0];
    const copiedPlan = copy.timelines!.find((t) => t.id === 't2')!.cardPlans[0];
    expect(copiedPlan).not.toBe(sourcePlan);
    expect(copiedPlan.funding).not.toBe(sourcePlan.funding);
    expect(copiedPlan.funding.fallbackAccountIds).not.toBe(sourcePlan.funding.fallbackAccountIds);

    copiedPlan.funding.primaryAccountId = 'mutated';
    copiedPlan.funding.fallbackAccountIds.push('extra');
    expect(sourcePlan.funding.primaryAccountId).toBe(checkingId);
    expect(sourcePlan.funding.fallbackAccountIds).toEqual([keepId]);
  });

  it('addTimeline deep-clones zero-interest payoff funding without fabricating debt', () => {
    const base = makeScenario();
    base.cardPlans = [
      createDefaultZeroInterestCardPlan(REFERENCE_DATE, {
        id: 'zp1',
        liabilityId: 'L1',
        initialBalance: 5000,
        funding: { primaryAccountId: checkingId, fallbackAccountIds: [keepId] },
        payoffFunding: { primaryAccountId: keepId, fallbackAccountIds: [] }
      })
    ];

    const next = addTimeline(base, { id: 't1' });
    const source = base.cardPlans![0];
    const plan = next.timelines![0].cardPlans[0];

    // No fictitious clone: the identity + debt values are copied verbatim.
    expect(plan.kind).toBe('zeroInterestPayoff');
    if (plan.kind === 'zeroInterestPayoff' && source.kind === 'zeroInterestPayoff') {
      expect(plan.liabilityId).toBe('L1');
      expect(plan.initialBalance).toBe(5000);
      expect(plan.funding).not.toBe(source.funding);
      expect(plan.payoffFunding).not.toBe(source.payoffFunding);
      expect(plan.payoffFunding!.primaryAccountId).toBe(keepId);
    }
  });

  it('addTimeline from a card-plan-free base fabricates no card or loan debt', () => {
    const base = makeScenario();
    expect(base.cardPlans).toEqual([]);

    const next = addTimeline(base, { id: 't1' });
    expect(next.timelines![0].cardPlans).toEqual([]);
    expect(next.timelines![0].loans).toEqual([]);
    expect(next.timelines![0].creditCards).toEqual([]);
  });
});

describe('timeline-local housing funding events (RV04/F23)', () => {
  const checkingId = 'checking-account-default';
  const keepId = 'keep-account';

  const futureProperty = (): PropertyDefinition => ({
    id: 'prop-1',
    label: 'Future Home',
    kind: 'primaryResidence',
    value: 0,
    debtLink: null,
    requiredDownPayment: 60000,
    status: 'pending',
    sourceConfigId: 'hA',
    acquisitionYearMonth: '2027-06',
    fundingEvents: [
      { id: 'pfe-1', date: '2026-06-01', amount: 30000, accountId: checkingId },
      { id: 'pfe-2', date: '2027-01-01', amount: 30000, accountId: keepId }
    ]
  });

  const baseHousing = (): ReturnType<typeof createDefaultHousingEntry> => {
    const entry = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    entry.id = 'hA';
    entry.purchasePrice = 300000;
    return entry;
  };

  it('seeds a base clone from the matching property and leaves the base/properties untouched', () => {
    const base = makeScenario();
    base.housing = [baseHousing()];
    base.properties = [futureProperty()];

    const withA = addTimeline(base, { id: 'tA', label: 'A' });

    const cloned = withA.timelines!.find((timeline) => timeline.id === 'tA')!.housing[0];
    expect(cloned.fundingEvents?.map((event) => event.id)).toEqual(['pfe-1', 'pfe-2']);
    expect(cloned.fundingEvents![0].accountId).toBe(checkingId);
    // Independent copies (no aliasing into the cloned global property events).
    expect(cloned.fundingEvents![0]).not.toBe(withA.properties![0].fundingEvents![0]);

    // Base housing is not given a local list, and the global property identity is unchanged.
    expect(base.housing[0].fundingEvents).toBeUndefined();
    expect(base.properties![0].fundingEvents![0].amount).toBe(30000);
  });

  it('matches the property by id when no sourceConfigId link exists', () => {
    const base = makeScenario();
    const entry = baseHousing();
    entry.id = 'prop-1';
    base.housing = [entry];
    base.properties = [{ ...futureProperty(), id: 'prop-1', sourceConfigId: undefined }];

    const next = addTimeline(base, { id: 't1' });
    expect(next.timelines![0].housing[0].fundingEvents?.map((event) => event.id)).toEqual(['pfe-1', 'pfe-2']);
  });

  it('editing A after a base clone does not affect the base or a later B clone', () => {
    const base = makeScenario();
    base.housing = [baseHousing()];
    base.properties = [futureProperty()];

    const withA = addTimeline(base, { id: 'tA', label: 'A' });
    const editedA = applyToActiveTimeline(withA, (data) => ({
      ...data,
      housing: data.housing.map((entry) => ({
        ...entry,
        fundingEvents: (entry.fundingEvents ?? []).map((event) =>
          event.id === 'pfe-1' ? { ...event, amount: 99999, date: '2030-03-01' } : event
        )
      }))
    }));

    expect(editedA.timelines!.find((t) => t.id === 'tA')!.housing[0].fundingEvents![0]).toMatchObject({
      amount: 99999,
      date: '2030-03-01'
    });
    // Global property events are untouched by the timeline-local edit.
    expect(editedA.properties![0].fundingEvents![0].amount).toBe(30000);
    expect(editedA.properties![0].fundingEvents![0].date).toBe('2026-06-01');

    // Clone B from the base: seeded fresh, not A's edit.
    const backToBase = switchTimeline(editedA, null);
    const withB = addTimeline(backToBase, { id: 'tB', label: 'B' });
    expect(withB.timelines!.find((t) => t.id === 'tB')!.housing[0].fundingEvents![0].amount).toBe(30000);
    // A keeps its independent edit.
    expect(withB.timelines!.find((t) => t.id === 'tA')!.housing[0].fundingEvents![0].amount).toBe(99999);
  });

  it('cloning a named timeline copies its local list rather than re-seeding the base', () => {
    const base = makeScenario();
    base.housing = [baseHousing()];
    base.properties = [futureProperty()];

    const withA = addTimeline(base, { id: 'tA', label: 'A' });
    const editedA = applyToActiveTimeline(withA, (data) => ({
      ...data,
      housing: data.housing.map((entry) => ({
        ...entry,
        fundingEvents: [{ id: 'local-only', date: '2031-01-01', amount: 5, accountId: keepId }]
      }))
    }));

    // A is active, so this clones A (not the base).
    const withC = addTimeline(editedA, { id: 'tC', label: 'C' });
    const tC = withC.timelines!.find((t) => t.id === 'tC')!;
    expect(tC.housing[0].fundingEvents!.map((event) => event.id)).toEqual(['local-only']);
    expect(tC.housing[0].fundingEvents!.some((event) => event.id === 'pfe-1')).toBe(false);
  });

  it('duplicateTimeline deep-copies nested funding events with no aliases', () => {
    const base = makeScenario();
    base.housing = [baseHousing()];
    base.properties = [futureProperty()];

    const withA = addTimeline(base, { id: 'tA', label: 'A' });
    const dup = duplicateTimeline(withA, 'tA', { id: 'tB' });
    const source = dup.timelines!.find((t) => t.id === 'tA')!.housing[0].fundingEvents!;
    const copy = dup.timelines!.find((t) => t.id === 'tB')!.housing[0].fundingEvents!;

    expect(copy).not.toBe(source);
    expect(copy[0]).not.toBe(source[0]);

    copy[0].amount = 1;
    copy[0].accountId = 'mutated';
    expect(source[0].amount).toBe(30000);
    expect(source[0].accountId).toBe(checkingId);
  });

  it('removeAccount clears base and inactive timeline-local funding event account refs', () => {
    const scenario = makeScenario();
    const accountId = checkingId;
    scenario.housing = [
      { ...baseHousing(), fundingEvents: [{ id: 'base-e', date: '2026-01-01', amount: 10, accountId }] }
    ];
    scenario.timelines = [
      {
        id: 'tl1',
        label: 'Inactive',
        purchases: [],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [],
        careerPlan: { enabled: true, entries: [] },
        housing: [
          {
            ...baseHousing(),
            id: 'h-inactive',
            fundingEvents: [
              { id: 'in-e', date: '2026-02-01', amount: 10, accountId },
              { id: 'in-keep', date: '2026-03-01', amount: 10, accountId: keepId }
            ]
          }
        ]
      }
    ];

    const next = removeAccount(scenario, accountId);

    expect(next.housing[0].fundingEvents![0].accountId).toBeNull();
    const inactive = next.timelines![0].housing[0];
    expect(inactive.fundingEvents![0].accountId).toBeNull();
    expect(inactive.fundingEvents![1].accountId).toBe(keepId);
    // Source untouched.
    expect(scenario.housing[0].fundingEvents![0].accountId).toBe(accountId);
  });
});

describe('career CRUD / pay-plan clone', () => {
  it('cloneCareerEntry deep-copies every nested plan field', () => {
    const career = createDefaultCareerEntry(0, 45, 65, 'c1');
    career.payPlans = [makePayPlan('p1')];
    const originalLine = career.payPlans![0].paycheck.categories[0].lines[0];

    const clone = cloneCareerEntry(career, { id: 'c2', label: 'Copy' });
    clone.payPlans![0].paycheck.categories[0].lines[0].amount = originalLine.amount + 1;
    clone.payPlans![0].sourceLines[0].contributionRate = 42;
    clone.paycheckInfo!.retirementMode = 'percentOfSalary';

    expect(clone.id).toBe('c2');
    expect(career.payPlans![0].paycheck.categories[0].lines[0].amount).toBe(originalLine.amount);
    expect(career.payPlans![0].sourceLines[0].contributionRate).not.toBe(42);
    expect(career.paycheckInfo!.retirementMode).not.toBe('percentOfSalary');
    expect(clone.depositPlan).toEqual(career.depositPlan);
  });

  it('duplicateCareer inserts a deep copy after the source', () => {
    const scenario = makeScenario();
    scenario.careerPlan = {
      enabled: true,
      entries: [createDefaultCareerEntry(0, 45, 65, 'c1'), createDefaultCareerEntry(1, 45, 65, 'c2')]
    };
    scenario.careerPlan.entries[0].payPlans = [makePayPlan('p1')];

    const next = duplicateCareer(scenario, 'c1', { id: 'c1-copy' });
    const ids = next.careerPlan.entries.map((entry) => entry.id);
    expect(ids).toEqual(['c1', 'c1-copy', 'c2']);
    const copy = next.careerPlan.entries[1];
    expect(copy.payPlans![0]).not.toBe(scenario.careerPlan.entries[0].payPlans![0]);
    expect(copy.payPlans![0].paycheck).toEqual(scenario.careerPlan.entries[0].payPlans![0].paycheck);
  });

  it('pay-plan CRUD preserves nested fields and returns a new scenario', () => {
    const scenario = makeScenario();
    scenario.careerPlan = { enabled: true, entries: [createDefaultCareerEntry(0, 45, 65, 'c1')] };
    const plan = makePayPlan('p1');

    const added = addCareerPayPlan(scenario, 'c1', plan);
    expect(getCareerPayPlan(added.careerPlan.entries[0], 'p1')?.label).toBe('Plan p1');
    expect(scenario.careerPlan.entries[0].payPlans).toHaveLength(0);

    const updated = updateCareerPayPlan(added, 'c1', { ...plan, label: 'Renamed' });
    expect(getCareerPayPlan(updated.careerPlan.entries[0], 'p1')?.label).toBe('Renamed');
    expect(getCareerPayPlan(added.careerPlan.entries[0], 'p1')?.label).toBe('Plan p1');

    const removed = removeCareerPayPlan(updated, 'c1', 'p1');
    expect(getCareerPayPlan(removed.careerPlan.entries[0], 'p1')).toBeUndefined();
  });

  it('removeCareer clears only matching housing links, preserving other fields', () => {
    const scenario = makeScenario();
    scenario.careerPlan = {
      enabled: true,
      entries: [createDefaultCareerEntry(0, 45, 65, 'c1'), createDefaultCareerEntry(1, 45, 65, 'c2')]
    };
    const housingA = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    housingA.id = 'hA';
    housingA.purchasePrice = 321000;
    housingA.linkedCareerStartId = 'c1';
    housingA.linkedCareerEndId = 'c2';
    const housingB = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    housingB.id = 'hB';
    housingB.linkedCareerStartId = 'c2';
    scenario.housing = [housingA, housingB];

    const next = removeCareer(scenario, 'c1');

    expect(next.careerPlan.entries.map((entry) => entry.id)).toEqual(['c2']);
    const a = next.housing.find((entry) => entry.id === 'hA')!;
    const b = next.housing.find((entry) => entry.id === 'hB')!;
    expect(a.linkedCareerStartId).toBeNull();
    expect(a.linkedCareerEndId).toBe('c2');
    expect(a.purchasePrice).toBe(321000);
    expect(b.linkedCareerStartId).toBe('c2');
    // Source untouched.
    expect(scenario.housing[0].linkedCareerStartId).toBe('c1');
  });
});

describe('account CRUD / deletion cleanup', () => {
  it('addAccount/updateAccount are pure and global', () => {
    const scenario = makeScenario();
    const account = { ...scenario.netWorth.accounts[0], id: 'new-account', label: 'New' };
    const added = addAccount(scenario, account);
    expect(added.netWorth.accounts.map((entry) => entry.id)).toContain('new-account');
    expect(scenario.netWorth.accounts.map((entry) => entry.id)).not.toContain('new-account');

    const updated = addAccount(scenario, account);
    const renamed = { ...account, label: 'Renamed' };
    const result = updateAccount(updated, renamed);
    expect(result.netWorth.accounts.find((entry) => entry.id === 'new-account')?.label).toBe('Renamed');
  });

  it('removeAccount clears global + timeline references and preserves unrelated fields', () => {
    const scenario = makeScenario();
    const accountId = 'checking-account-default';
    const keepId = 'keep-account';

    scenario.incomeFallbackAccountId = accountId;
    scenario.fundingPolicy = { primaryAccountId: accountId, fallbackAccountIds: [accountId, keepId] };
    scenario.withdrawal.fallbackAccountIds = [accountId, keepId];
    scenario.withdrawal.sourceLines![0].accountId = accountId;
    scenario.withdrawal.sourceLines![0].fallbackAccountIds = [accountId, keepId];

    const career = scenario.careerPlan.entries[0];
    career.sourceLines![0].sourceId = accountId;
    career.depositPlan!.allocations[0].sourceId = accountId;
    career.depositPlan!.remainderAccountId = accountId;
    career.paycheckInfo!.retirementAccountId = accountId;
    career.paycheck!.categories[0].lines[0].accountId = accountId;
    career.payPlans = [makePayPlan('p1')];
    career.payPlans[0].sourceLines[0].sourceId = accountId;
    career.payPlans[0].depositPlan!.remainderAccountId = accountId;

    const loan = createDefaultLoan(45, DATE_OF_BIRTH, REFERENCE_DATE);
    loan.paymentSourceAccount = accountId;
    loan.paymentSource = `account:${accountId}`;
    scenario.loans = [loan];

    const purchase = createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE);
    purchase.fundingSource = `account:${accountId}`;
    purchase.sourceLines![0].accountId = accountId;
    purchase.sourceLines![0].sourceId = accountId;
    scenario.largePurchases = [purchase];

    scenario.cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
        id: 'cp1',
        funding: { primaryAccountId: accountId, fallbackAccountIds: [accountId, keepId] }
      })
    ];

    scenario.properties = [
      {
        id: 'prop1',
        value: 100,
        requiredDownPayment: 0,
        status: 'owned',
        fundingEvents: [
          { id: 'fe1', date: '2026-01-01', amount: 10, accountId },
          { id: 'fe2', date: '2026-02-01', amount: 10, accountId: keepId }
        ]
      }
    ];

    scenario.cashflowItems = [];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [
        { accountId, balance: 123 },
        { accountId: keepId, balance: 456 }
      ],
      liabilities: [],
      measurement: 'assetOnly'
    };

    scenario.expenses.entries = [
      {
        id: 'e1',
        label: 'Expense',
        amount: 10,
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        accountId,
        notes: '',
        originType: 'manual',
        importSourceId: null,
        importBatchId: null,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        fundingSource: `account:${accountId}`
      }
    ];
    scenario.expenses.categoriesByAccountId = { [accountId]: [], [keepId]: [] };
    scenario.expenses.activePlanningAccountId = accountId;
    scenario.expenses.ui.selectedAccountIds = [accountId, keepId];

    const inactiveTimeline: Timeline = {
      id: 'tl1',
      label: 'Inactive',
      purchases: [deepClone(purchase)],
      longTermPurchases: [],
      loans: [],
      creditCards: [],
      cardPlans: [],
      careerPlan: { enabled: true, entries: [deepClone(career)] },
      housing: []
    };
    scenario.timelines = [inactiveTimeline];

    const next = removeAccount(scenario, accountId);

    expect(next.netWorth.accounts.map((entry) => entry.id)).not.toContain(accountId);
    expect(next.incomeFallbackAccountId).toBeNull();
    expect(next.fundingPolicy!.primaryAccountId).toBeNull();
    expect(next.fundingPolicy!.fallbackAccountIds).toEqual([keepId]);
    expect(next.withdrawal.sourceLines![0].accountId).toBe('');
    expect(next.withdrawal.sourceLines![0].fallbackAccountIds).toEqual([keepId]);
    expect(next.withdrawal.fallbackAccountIds).toEqual([keepId]);

    const nextCareer = next.careerPlan.entries[0];
    expect(nextCareer.sourceLines![0].sourceId).toBe('');
    expect(nextCareer.depositPlan!.allocations[0].sourceId).toBe('');
    expect(nextCareer.depositPlan!.remainderAccountId).toBeNull();
    expect(nextCareer.paycheckInfo!.retirementAccountId).toBeUndefined();
    expect(nextCareer.paycheck!.categories[0].lines[0].accountId).toBeNull();
    expect(nextCareer.payPlans![0].sourceLines[0].sourceId).toBe('');
    expect(nextCareer.payPlans![0].depositPlan!.remainderAccountId).toBeNull();

    expect(next.loans![0].paymentSourceAccount).toBe('');
    expect(next.loans![0].paymentSource).toBeUndefined();
    expect(next.largePurchases![0].fundingSource).toBeUndefined();
    expect(next.largePurchases![0].sourceLines![0].accountId).toBeUndefined();
    expect(next.largePurchases![0].sourceLines![0].sourceId).toBe('');

    expect(next.cardPlans![0].funding.primaryAccountId).toBeNull();
    expect(next.cardPlans![0].funding.fallbackAccountIds).toEqual([keepId]);

    expect(next.properties![0].fundingEvents![0].accountId).toBeNull();
    expect(next.properties![0].fundingEvents![1].accountId).toBe(keepId);

    expect(next.netWorth.openingSnapshot!.accounts.map((value) => value.accountId)).toEqual([keepId]);

    expect(next.expenses.entries[0].accountId).toBeNull();
    expect(next.expenses.entries[0].fundingSource).toBeUndefined();
    expect(next.expenses.categoriesByAccountId[accountId]).toBeUndefined();
    expect(next.expenses.categoriesByAccountId[keepId]).toBeDefined();
    expect(next.expenses.activePlanningAccountId).toBeNull();
    expect(next.expenses.ui.selectedAccountIds).toEqual([keepId]);

    const nextInactive = next.timelines![0];
    expect(nextInactive.purchases[0].fundingSource).toBeUndefined();
    expect(nextInactive.purchases[0].sourceLines![0].accountId).toBeUndefined();
    expect(nextInactive.careerPlan.entries[0].sourceLines![0].sourceId).toBe('');

    // Unrelated config preserved.
    expect(next.careerPlan.entries[0].label).toBe(scenario.careerPlan.entries[0].label);
    // Source untouched.
    expect(scenario.fundingPolicy!.primaryAccountId).toBe(accountId);
    expect(scenario.netWorth.accounts.map((entry) => entry.id)).toContain(accountId);
  });

  it('removeAccount clears card-plan funding in the base and every timeline only', () => {
    const scenario = makeScenario();
    const accountId = 'checking-account-default';
    const keepId = 'keep-account';

    scenario.cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
        id: 'base-cp',
        funding: { primaryAccountId: accountId, fallbackAccountIds: [accountId, keepId] }
      })
    ];
    scenario.timelines = [
      {
        id: 'tl1',
        label: 'T1',
        purchases: [],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [
          createDefaultZeroInterestCardPlan(REFERENCE_DATE, {
            id: 'tl-zp',
            liabilityId: 'L1',
            initialBalance: 1234,
            funding: { primaryAccountId: accountId, fallbackAccountIds: [keepId] },
            payoffFunding: { primaryAccountId: accountId, fallbackAccountIds: [accountId] }
          })
        ],
        careerPlan: { enabled: true, entries: [] },
        housing: []
      }
    ];

    const next = removeAccount(scenario, accountId);

    expect(next.cardPlans![0].funding.primaryAccountId).toBeNull();
    expect(next.cardPlans![0].funding.fallbackAccountIds).toEqual([keepId]);

    const plan = next.timelines![0].cardPlans[0];
    expect(plan.funding.primaryAccountId).toBeNull();
    expect(plan.funding.fallbackAccountIds).toEqual([keepId]);
    if (plan.kind === 'zeroInterestPayoff') {
      expect(plan.payoffFunding!.primaryAccountId).toBeNull();
      expect(plan.payoffFunding!.fallbackAccountIds).toEqual([]);
      // No fictitious debt clone: identity + debt values are untouched.
      expect(plan.liabilityId).toBe('L1');
      expect(plan.initialBalance).toBe(1234);
    }

    // Source untouched.
    expect(scenario.cardPlans![0].funding.primaryAccountId).toBe(accountId);
    expect(scenario.timelines![0].cardPlans[0].funding.primaryAccountId).toBe(accountId);
  });

  it('removeAccount clears housing group-policy refs in base + every timeline without redirecting to a fallback', () => {
    const scenario = makeScenario();
    const accountId = 'checking-account-default';
    const keepId = 'keep-account';
    const untouchedId = 'untouched-account';

    const baseEntry = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    baseEntry.id = 'h-base';
    baseEntry.startMarkerId = 'm1';
    baseEntry.fundingPolicies = {
      payment: { primaryAccountId: accountId, fallbackAccountIds: [accountId, keepId] },
      downPayment: { primaryAccountId: untouchedId, fallbackAccountIds: [] }
    };
    scenario.housing = [baseEntry];

    const inactiveEntry = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    inactiveEntry.id = 'h-inactive';
    inactiveEntry.fundingPolicies = {
      hoaMaintenance: { primaryAccountId: accountId, fallbackAccountIds: [keepId, accountId] }
    };
    scenario.timelines = [
      {
        id: 'tl1',
        label: 'Inactive',
        purchases: [],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [],
        careerPlan: { enabled: true, entries: [] },
        housing: [inactiveEntry]
      }
    ];

    // An untouched pay plan proves unrelated configuration survives.
    scenario.careerPlan.entries[0].payPlans = [makePayPlan('p1')];

    const before = deepClone(scenario);
    const next = removeAccount(scenario, accountId);

    // Base: primary cleared to `null` (never redirected to the first fallback);
    // the deleted id is removed from the ordered fallbacks.
    const payment = next.housing[0].fundingPolicies!.payment!;
    expect(payment.primaryAccountId).toBeNull();
    expect(payment.fallbackAccountIds).toEqual([keepId]);
    // An unrelated group (different primary) is untouched.
    expect(next.housing[0].fundingPolicies!.downPayment).toEqual({
      primaryAccountId: untouchedId,
      fallbackAccountIds: []
    });
    // Marker references are unchanged.
    expect(next.housing[0].startMarkerId).toBe('m1');

    // Inactive timeline is cleaned independently.
    const inactive = next.timelines![0].housing[0].fundingPolicies!.hoaMaintenance!;
    expect(inactive.primaryAccountId).toBeNull();
    expect(inactive.fallbackAccountIds).toEqual([keepId]);

    // An untouched pay plan keeps its identity/paycheck (only account refs equal
    // to the deleted id are cleared, and this plan references other accounts).
    const beforePlan = before.careerPlan.entries[0].payPlans![0];
    const afterPlan = next.careerPlan.entries[0].payPlans![0];
    expect(afterPlan.id).toBe('p1');
    expect(afterPlan.effectiveYearMonth).toBe(beforePlan.effectiveYearMonth);
    expect(afterPlan.paycheck).toEqual(beforePlan.paycheck);
    expect(next.housing[0].purchasePrice).toBe(before.housing[0].purchasePrice);

    // Source untouched.
    expect(scenario.housing[0].fundingPolicies!.payment!.primaryAccountId).toBe(accountId);
    expect(scenario.timelines![0].housing[0].fundingPolicies!.hoaMaintenance!.primaryAccountId).toBe(accountId);
  });
});

describe('marker reference registry', () => {
  const buildMarkerScenario = (): Scenario => {
    const scenario = makeScenario();
    scenario.dateMarkers = [{ id: 'm1', label: 'Marker 1', date: '2030-06-15' }];

    scenario.cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
        id: 'cp1',
        startMarkerId: 'm1',
        endMarkerId: 'm2'
      })
    ];

    const career = createDefaultCareerEntry(0, 45, 65, 'c1');
    career.payPlans = [{ ...makePayPlan('p1'), effectiveMarkerId: 'm1' }];
    scenario.careerPlan = { enabled: true, entries: [career] };

    const housing = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    housing.id = 'hA';
    housing.startMarkerId = 'm1';
    scenario.housing = [housing];

    const purchase = createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE);
    purchase.yearMonthMarkerId = 'm2';
    scenario.timelines = [
      {
        id: 'tl1',
        label: 'Timeline 1',
        purchases: [purchase],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [],
        careerPlan: { enabled: true, entries: [] },
        housing: []
      }
    ];

    scenario.expenses.entries = [
      {
        id: 'e1',
        label: 'Expense',
        amount: 10,
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        accountId: null,
        notes: '',
        originType: 'manual',
        importSourceId: null,
        importBatchId: null,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        startMarkerId: 'm1'
      }
    ];
    return scenario;
  };

  it('scans references across base, timelines, pay plans and card plans', () => {
    const refs = scanMarkerReferences(buildMarkerScenario());
    const domains = refs.map((ref) => `${ref.scope}:${ref.domain}:${ref.field}:${ref.precision}`);
    expect(domains).toContain('base:cardPlan:startMarkerId:month');
    expect(domains).toContain('base:cardPlan:endMarkerId:month');
    expect(domains).toContain('base:careerPayPlan:effectiveMarkerId:month');
    expect(domains).toContain('base:housing:startMarkerId:month');
    expect(domains).toContain('timeline:purchase:yearMonthMarkerId:month');
    expect(domains).toContain('base:expense:startMarkerId:date');
    expect(refs.find((ref) => ref.domain === 'expense')?.timelineId).toBeNull();
  });

  it('clears only dangling references, deterministically and without mutation', () => {
    const scenario = buildMarkerScenario();
    const cleaned = clearDanglingMarkerReferences(scenario);

    expect(cleaned.cardPlans![0].startMarkerId).toBe('m1');
    expect(cleaned.cardPlans![0].endMarkerId).toBeNull();
    expect(cleaned.careerPlan.entries[0].payPlans![0].effectiveMarkerId).toBe('m1');
    expect(cleaned.timelines![0].purchases[0].yearMonthMarkerId).toBeNull();

    // Idempotent/deterministic.
    expect(JSON.stringify(clearDanglingMarkerReferences(cleaned))).toBe(JSON.stringify(cleaned));
    // Source untouched.
    expect(scenario.cardPlans![0].endMarkerId).toBe('m2');
    expect(scenario.timelines![0].purchases[0].yearMonthMarkerId).toBe('m2');
  });

  it('resolves month vs date precision and clears dangling refs', () => {
    const resolved = resolveMarkerReferences(buildMarkerScenario());

    expect(resolved.cardPlans![0].startYearMonth).toBe('2030-06');
    expect(resolved.cardPlans![0].endMarkerId).toBeNull();
    expect(resolved.careerPlan.entries[0].payPlans![0].effectiveMarkerId).toBe('m1');
    expect(resolved.careerPlan.entries[0].payPlans![0].effectiveYearMonth).toBe('2030-06');
    expect(resolved.timelines![0].purchases[0].yearMonthMarkerId).toBeNull();
    expect(resolved.expenses.entries[0].startDate).toBe('2030-06-15');
  });

  it('removeDateMarker deletes the marker and clears every reference', () => {
    const scenario = buildMarkerScenario();
    const next = removeDateMarker(scenario, 'm1');

    expect(next.dateMarkers).toHaveLength(0);
    expect(next.cardPlans![0].startMarkerId).toBeNull();
    expect(next.careerPlan.entries[0].payPlans![0].effectiveMarkerId).toBeNull();
    expect(next.housing[0].startMarkerId).toBeNull();
    expect(next.expenses.entries[0].startMarkerId).toBeNull();
  });

  it('scans, clears and resolves card-plan markers in inactive timelines too', () => {
    const scenario = buildMarkerScenario();
    scenario.timelines![0].cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
        id: 'tl-cp',
        startMarkerId: 'm1',
        endMarkerId: 'm2'
      })
    ];

    const refs = scanMarkerReferences(scenario);
    const timelineCardRefs = refs.filter((ref) => ref.domain === 'cardPlan' && ref.scope === 'timeline');
    expect(timelineCardRefs.map((ref) => `${ref.field}:${ref.precision}`)).toEqual([
      'startMarkerId:month',
      'endMarkerId:month'
    ]);
    expect(timelineCardRefs.every((ref) => ref.timelineId === 'tl1')).toBe(true);

    const cleaned = clearDanglingMarkerReferences(scenario);
    expect(cleaned.timelines![0].cardPlans[0].startMarkerId).toBe('m1');
    expect(cleaned.timelines![0].cardPlans[0].endMarkerId).toBeNull();

    const resolved = resolveMarkerReferences(scenario);
    expect(resolved.timelines![0].cardPlans[0].startYearMonth).toBe('2030-06');
    expect(resolved.timelines![0].cardPlans[0].endMarkerId).toBeNull();
    // Base card plans still resolve too.
    expect(resolved.cardPlans![0].startYearMonth).toBe('2030-06');

    const removed = removeDateMarker(scenario, 'm1');
    expect(removed.cardPlans![0].startMarkerId).toBeNull();
    expect(removed.timelines![0].cardPlans[0].startMarkerId).toBeNull();
  });
});

// GUI-A09 / G38 / CA11: one fixed marker referenced by several domains across
// the base set and TWO inactive named timelines. `resolveMarkerReferences`
// rewrites exactly the supported concrete fields (month vs day precision kept
// distinct) and `removeDateMarker` clears only the target ids without touching
// siblings, unrelated funding/account fields, or the selected timeline.
describe('marker reference registry: shared marker across inactive timelines', () => {
  const buildSharedMarkerScenario = (): Scenario => {
    const scenario = makeScenario();
    // Both named timelines are inactive: nothing is selected for projection.
    scenario.activeTimelineId = null;
    scenario.dateMarkers = [
      { id: 'm1', label: 'Move', date: '2030-06-15' },
      { id: 'm2', label: 'Sell', date: '2031-03-10' }
    ];

    // Base month-precision domain: career pay-plan effective month -> m1.
    const career = createDefaultCareerEntry(0, 45, 65, 'base-c');
    career.payPlans = [{ ...makePayPlan('base-p1'), effectiveMarkerId: 'm1', effectiveYearMonth: '2029-01' }];
    scenario.careerPlan = { enabled: true, entries: [career] };

    // Base month-precision domain: housing start -> m1 (+ unrelated funding).
    const home = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    home.id = 'base-h';
    home.startYearMonth = '2029-02';
    home.startMarkerId = 'm1';
    home.fundingPolicies = { downPayment: { primaryAccountId: 'acct-home', fallbackAccountIds: ['acct-b'] } };
    scenario.housing = [home];

    // Base month-precision domain: ordinary card plan start -> m1, end -> m2.
    scenario.cardPlans = [
      createDefaultOrdinaryCardSchedule(REFERENCE_DATE, {
        id: 'base-cp',
        startYearMonth: '2029-03',
        startMarkerId: 'm1',
        endYearMonth: '2029-05',
        endMarkerId: 'm2',
        funding: { primaryAccountId: 'acct-card', fallbackAccountIds: ['acct-b'] }
      })
    ];

    // Base date-precision domain: expense start date -> m1 (keeps the day).
    scenario.expenses.entries = [
      {
        id: 'base-e',
        label: 'Move expense',
        amount: 500,
        startDate: '2029-01-01',
        endDate: '2029-02-01',
        accountId: null,
        notes: '',
        originType: 'manual',
        importSourceId: null,
        importBatchId: null,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        startMarkerId: 'm1'
      }
    ];

    // Inactive timeline 1: purchase + pay plan + housing start -> m1, with
    // unrelated funding/account fields that must survive untouched.
    const tl1Purchase = createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE);
    tl1Purchase.id = 'tl1-p';
    tl1Purchase.yearMonth = '2029-04';
    tl1Purchase.yearMonthMarkerId = 'm1';
    tl1Purchase.fundingSource = 'account:tl1-funding';
    const tl1Career = createDefaultCareerEntry(0, 45, 65, 'tl1-c');
    tl1Career.payPlans = [{ ...makePayPlan('tl1-p1'), effectiveMarkerId: 'm1', effectiveYearMonth: '2029-06' }];
    const tl1Home = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    tl1Home.id = 'tl1-h';
    tl1Home.startYearMonth = '2029-07';
    tl1Home.startMarkerId = 'm1';
    tl1Home.fundingPolicies = { payment: { primaryAccountId: 'tl1-acct', fallbackAccountIds: [] } };

    // Inactive timeline 2: 0% card plan + loan -> m1, with unrelated funding.
    const tl2Card = createDefaultZeroInterestCardPlan(REFERENCE_DATE, {
      id: 'tl2-cp',
      startYearMonth: '2029-08',
      startMarkerId: 'm1',
      targetYearMonth: '2029-10',
      liabilityId: 'tl2-liability',
      funding: { primaryAccountId: 'tl2-acct', fallbackAccountIds: ['tl2-b'] }
    });
    const tl2Loan = createDefaultLoan(45, DATE_OF_BIRTH, REFERENCE_DATE);
    tl2Loan.id = 'tl2-l';
    tl2Loan.startYearMonth = '2029-09';
    tl2Loan.startMarkerId = 'm1';
    tl2Loan.paymentSourceAccount = 'tl2-loan-acct';

    scenario.timelines = [
      {
        id: 'tl1',
        label: 'Timeline 1',
        purchases: [tl1Purchase],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [],
        careerPlan: { enabled: true, entries: [tl1Career] },
        housing: [tl1Home]
      },
      {
        id: 'tl2',
        label: 'Timeline 2',
        purchases: [],
        longTermPurchases: [],
        loans: [tl2Loan],
        creditCards: [],
        cardPlans: [tl2Card],
        careerPlan: { enabled: true, entries: [] },
        housing: []
      }
    ];

    return scenario;
  };

  it('the shared marker is referenced by several domains and both inactive timelines', () => {
    const refs = scanMarkerReferences(buildSharedMarkerScenario()).filter((ref) => ref.markerId === 'm1');
    const domains = new Set(refs.map((ref) => ref.domain));
    expect(domains.size).toBeGreaterThanOrEqual(2);
    expect(domains).toContain('careerPayPlan');
    expect(domains).toContain('cardPlan');
    expect(domains).toContain('expense');
    const timelineIds = new Set(refs.filter((ref) => ref.scope === 'timeline').map((ref) => ref.timelineId));
    expect(timelineIds).toEqual(new Set(['tl1', 'tl2']));
    // Precisions are tracked per reference, not conflated for the same marker.
    expect(refs.find((ref) => ref.domain === 'expense')?.precision).toBe('date');
    expect(refs.find((ref) => ref.domain === 'careerPayPlan')?.precision).toBe('month');
  });

  it('resolveMarkerReferences updates exactly the supported month/date fields without crossing precision', () => {
    const commands = createConfigurationCommands();
    const scenario = buildSharedMarkerScenario();
    const resolved = commands.resolveMarkerReferences(scenario);

    // Base month-precision fields -> YYYY-MM (day dropped).
    expect(resolved.careerPlan.entries[0].payPlans![0].effectiveYearMonth).toBe('2030-06');
    expect(resolved.careerPlan.entries[0].payPlans![0].effectiveMarkerId).toBe('m1');
    expect(resolved.housing[0].startYearMonth).toBe('2030-06');
    expect(resolved.housing[0].startMarkerId).toBe('m1');
    const basePlan = resolved.cardPlans![0];
    if (basePlan.kind !== 'expectedPayment') {
      throw new Error('expected an ordinary card schedule for the base plan');
    }
    expect(basePlan.startYearMonth).toBe('2030-06');
    expect(basePlan.startMarkerId).toBe('m1');
    // The sibling m2 reference still resolves independently.
    expect(basePlan.endYearMonth).toBe('2031-03');
    expect(basePlan.endMarkerId).toBe('m2');

    // Base date-precision field keeps the full day (not truncated to a month).
    expect(resolved.expenses.entries[0].startDate).toBe('2030-06-15');
    expect(resolved.expenses.entries[0].startMarkerId).toBe('m1');

    // Month fields never absorb the day; date fields never drop it.
    expect(resolved.housing[0].startYearMonth).toHaveLength(7);
    expect(resolved.expenses.entries[0].startDate).toHaveLength(10);

    // Every inactive timeline resolves its own marker links too.
    expect(resolved.timelines![0].purchases[0].yearMonth).toBe('2030-06');
    expect(resolved.timelines![0].careerPlan.entries[0].payPlans![0].effectiveYearMonth).toBe('2030-06');
    expect(resolved.timelines![0].housing[0].startYearMonth).toBe('2030-06');
    expect(resolved.timelines![1].cardPlans[0].startYearMonth).toBe('2030-06');
    expect(resolved.timelines![1].loans[0].startYearMonth).toBe('2030-06');

    // Resolution is pure: the source scenario is never mutated.
    expect(scenario.careerPlan.entries[0].payPlans![0].effectiveYearMonth).toBe('2029-01');
    expect(scenario.expenses.entries[0].startDate).toBe('2029-01-01');
    expect(scenario.timelines![0].purchases[0].yearMonth).toBe('2029-04');
  });

  it('re-resolving after a marker date change moves every reference, day-vs-month intact', () => {
    const commands = createConfigurationCommands();
    const scenario = buildSharedMarkerScenario();
    scenario.dateMarkers = scenario.dateMarkers.map((marker) =>
      marker.id === 'm1' ? { ...marker, date: '2033-11-02' } : marker
    );

    const resolved = commands.resolveMarkerReferences(scenario);

    expect(resolved.housing[0].startYearMonth).toBe('2033-11');
    expect(resolved.careerPlan.entries[0].payPlans![0].effectiveYearMonth).toBe('2033-11');
    expect(resolved.cardPlans![0].startYearMonth).toBe('2033-11');
    expect(resolved.timelines![0].purchases[0].yearMonth).toBe('2033-11');
    expect(resolved.timelines![1].loans[0].startYearMonth).toBe('2033-11');
    // Date-precision field adopts the exact new day; month fields drop it.
    expect(resolved.expenses.entries[0].startDate).toBe('2033-11-02');
    expect(resolved.housing[0].startYearMonth).not.toContain('-02');
    // The untouched m2 sibling reference is stable.
    const basePlan = resolved.cardPlans![0];
    if (basePlan.kind !== 'expectedPayment') {
      throw new Error('expected an ordinary card schedule for the base plan');
    }
    expect(basePlan.endYearMonth).toBe('2031-03');
  });

  it('resolve and remove preserve unrelated funding/account fields on every timeline', () => {
    const commands = createConfigurationCommands();
    const scenario = buildSharedMarkerScenario();
    const before = deepClone(scenario);

    const resolved = commands.resolveMarkerReferences(scenario);
    expect(resolved.timelines![0].purchases[0].fundingSource).toBe('account:tl1-funding');
    expect(resolved.timelines![0].purchases[0].sourceLines).toEqual(before.timelines![0].purchases[0].sourceLines);
    expect(resolved.timelines![0].housing[0].fundingPolicies).toEqual({
      payment: { primaryAccountId: 'tl1-acct', fallbackAccountIds: [] }
    });
    const tl2Plan = resolved.timelines![1].cardPlans[0];
    if (tl2Plan.kind !== 'zeroInterestPayoff') {
      throw new Error('expected a 0% card plan for timeline 2');
    }
    expect(tl2Plan.liabilityId).toBe('tl2-liability');
    expect(tl2Plan.funding).toEqual({
      primaryAccountId: 'tl2-acct',
      fallbackAccountIds: ['tl2-b']
    });
    expect(resolved.timelines![1].loans[0].paymentSourceAccount).toBe('tl2-loan-acct');
    expect(resolved.housing[0].fundingPolicies).toEqual({
      downPayment: { primaryAccountId: 'acct-home', fallbackAccountIds: ['acct-b'] }
    });
    expect(resolved.cardPlans![0].funding).toEqual({
      primaryAccountId: 'acct-card',
      fallbackAccountIds: ['acct-b']
    });

    const removed = commands.removeDateMarker(scenario, 'm1');
    expect(removed.timelines![0].purchases[0].fundingSource).toBe('account:tl1-funding');
    expect(removed.timelines![0].housing[0].fundingPolicies).toEqual({
      payment: { primaryAccountId: 'tl1-acct', fallbackAccountIds: [] }
    });
    expect(removed.timelines![1].cardPlans[0].funding).toEqual({
      primaryAccountId: 'tl2-acct',
      fallbackAccountIds: ['tl2-b']
    });
    expect(removed.timelines![1].loans[0].paymentSourceAccount).toBe('tl2-loan-acct');
    // Source untouched by both commands.
    expect(before.timelines![0].purchases[0].fundingSource).toBe('account:tl1-funding');
    expect(scenario.timelines![1].cardPlans[0].funding.primaryAccountId).toBe('tl2-acct');
  });

  it('removeDateMarker clears only the target ids, keeps the sibling and selects no timeline', () => {
    const commands = createConfigurationCommands();
    const scenario = buildSharedMarkerScenario();
    const next = commands.removeDateMarker(scenario, 'm1');

    // The valid sibling marker survives; only m1 is deleted.
    expect(next.dateMarkers.map((marker) => marker.id)).toEqual(['m2']);
    expect(next.cardPlans![0].endMarkerId).toBe('m2');

    // Every m1 reference is cleared, across the base set and both timelines.
    expect(next.cardPlans![0].startMarkerId).toBeNull();
    expect(next.careerPlan.entries[0].payPlans![0].effectiveMarkerId).toBeNull();
    expect(next.housing[0].startMarkerId).toBeNull();
    expect(next.expenses.entries[0].startMarkerId).toBeNull();
    expect(next.timelines![0].purchases[0].yearMonthMarkerId).toBeNull();
    expect(next.timelines![0].careerPlan.entries[0].payPlans![0].effectiveMarkerId).toBeNull();
    expect(next.timelines![0].housing[0].startMarkerId).toBeNull();
    expect(next.timelines![1].cardPlans[0].startMarkerId).toBeNull();
    expect(next.timelines![1].loans[0].startMarkerId).toBeNull();

    // No inactive timeline is selected for projection and none is dropped.
    expect(next.activeTimelineId).toBeNull();
    expect(next.timelines!.map((timeline) => timeline.id)).toEqual(['tl1', 'tl2']);

    // Source untouched.
    expect(scenario.dateMarkers).toHaveLength(2);
    expect(scenario.cardPlans![0].startMarkerId).toBe('m1');
  });

  it('leaves the retirement-source start marker id for engine resolution (no persisted target field)', () => {
    const commands = createConfigurationCommands();
    const scenario = buildSharedMarkerScenario();
    const line = scenario.withdrawal.sourceLines![0];
    scenario.withdrawal = {
      ...scenario.withdrawal,
      sourceLines: [{ ...line, startMarkerId: 'm1' }]
    };

    // The registry scans it as a month-precision reference...
    const scanned = scanMarkerReferences(scenario).find((ref) => ref.domain === 'retirementSource');
    expect(scanned?.markerId).toBe('m1');
    expect(scanned?.precision).toBe('month');

    // ...but resolve has no persisted `*YearMonth` target for this line, so the id
    // is preserved and the engine resolves it from `context.markers` at compile.
    const resolved = commands.resolveMarkerReferences(scenario);
    expect(resolved.withdrawal.sourceLines![0].startMarkerId).toBe('m1');

    // Deletion still clears the dangling reference.
    const removed = commands.removeDateMarker(scenario, 'm1');
    expect(removed.withdrawal.sourceLines![0].startMarkerId).toBeNull();
  });
});

describe('career / housing chain resolution', () => {
  it('chains a previous career start to the month after its end', () => {
    const first = createDefaultCareerEntry(0, 45, 65, 'c1');
    first.startAge = 40;
    first.endAge = 45;
    first.startYearMonth = '2025-01';
    first.endYearMonth = '2026-01';
    first.usePreviousCareerStartAge = false;
    first.useBirthdayBasedStartAge = false;
    first.startMarkerId = null;

    const second = createDefaultCareerEntry(1, 45, 65, 'c2');
    second.usePreviousCareerStartAge = true;
    second.useBirthdayBasedStartAge = false;
    second.startMarkerId = null;
    second.startAge = 50;
    second.endAge = 55;
    second.endYearMonth = '';

    const resolved = resolveCareerChain([first, second], {
      dateOfBirth: DATE_OF_BIRTH,
      currentAge: 45
    });

    expect(resolved[1].startYearMonth).toBe('2026-02');
    expect(resolved[1].endAge).toBeGreaterThanOrEqual(resolved[1].startAge);
    // Other fields preserved.
    expect(resolved[1].label).toBe(second.label);
  });

  it('repairs duplicate career ids deterministically', () => {
    const a = createDefaultCareerEntry(0, 45, 65, 'dup');
    const b = createDefaultCareerEntry(1, 45, 65, 'dup');
    const resolved = resolveCareerChain([a, b], { dateOfBirth: DATE_OF_BIRTH, currentAge: 45 });
    expect(new Set(resolved.map((entry) => entry.id)).size).toBe(2);
  });

  it('resolves housing career start/end links and previous-end chaining', () => {
    const career = createDefaultCareerEntry(0, 45, 65, 'c1');
    career.startYearMonth = '2025-01';
    career.endYearMonth = '2030-01';

    const mortgage = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    mortgage.id = 'hA';
    mortgage.linkedCareerStartId = 'c1';
    mortgage.linkedCareerEndId = 'c1';
    mortgage.startMarkerId = null;
    mortgage.sellMarkerId = null;

    const rental = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    rental.id = 'hB';
    rental.housingType = 'rental';
    rental.usePreviousEndAsStart = true;
    rental.startMarkerId = null;

    const resolved = resolveHousingChain([mortgage, rental], [career], {
      dateOfBirth: DATE_OF_BIRTH,
      currentAge: 45
    });

    expect(resolved[0].startYearMonth).toBe('2025-01');
    expect(resolved[0].sellYearMonth).toBe('2030-01');
    expect(resolved[1].startYearMonth).toBe('2030-02');
  });

  it('resolves chains for base and every timeline', () => {
    const scenario = makeScenario();
    const career = createDefaultCareerEntry(0, 45, 65, 'c1');
    career.startYearMonth = '2025-01';
    career.endYearMonth = '2030-01';
    scenario.careerPlan = { enabled: true, entries: [career] };

    const baseHousing = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    baseHousing.linkedCareerStartId = 'c1';
    baseHousing.startMarkerId = null;
    scenario.housing = [baseHousing];

    const timelineCareer = deepClone(career);
    timelineCareer.id = 'c2';
    timelineCareer.startYearMonth = '2024-01';
    const timelineHousing = createDefaultHousingEntry(45, DATE_OF_BIRTH, REFERENCE_DATE);
    timelineHousing.linkedCareerStartId = 'c2';
    timelineHousing.startMarkerId = null;
    scenario.timelines = [
      {
        id: 'tl1',
        label: 'T1',
        purchases: [],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [],
        careerPlan: { enabled: true, entries: [timelineCareer] },
        housing: [timelineHousing]
      }
    ];

    const resolved = resolveCareerAndHousingChains(scenario, { dateOfBirth: DATE_OF_BIRTH, currentAge: 45 });
    expect(resolved.housing[0].startYearMonth).toBe('2025-01');
    expect(resolved.timelines![0].housing[0].startYearMonth).toBe('2024-01');
  });
});

describe('engine/opening resolution', () => {
  it('lets observed balances (including zero debt) win over configured values', () => {
    const scenario = makeScenario();
    const accountId = 'checking-account-default';
    scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) =>
      account.id === accountId ? { ...account, openingBalance: 1000 } : account
    );
    scenario.liabilities = [{ id: 'L1', kind: 'loan', openingBalance: 500 }];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [{ accountId, balance: 2000 }],
      liabilities: [{ liabilityId: 'L1', balance: 0 }],
      measurement: 'assetsMinusLiabilities'
    };

    const opening = resolveOpening(scenario);
    const account = opening.accounts.find((entry) => entry.accountId === accountId)!;
    const liability = opening.liabilities.find((entry) => entry.liabilityId === 'L1')!;

    expect(account.openingBalance).toBe(2000);
    expect(account.source).toBe('observed');
    expect(liability.openingBalance).toBe(0);
    expect(liability.source).toBe('observed');
    expect(opening.measurement).toBe('assetsMinusLiabilities');
    expect(opening.hasSnapshot).toBe(true);
  });

  it('uses configured debt once only when no observation exists', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'L9', kind: 'mortgage', openingBalance: 1234 },
      { id: 'L10', kind: 'zeroInterestCard', openingBalance: 40 }
    ];

    const opening = resolveOpening(scenario);
    const l9 = opening.liabilities.filter((entry) => entry.liabilityId === 'L9');
    expect(l9).toHaveLength(1);
    expect(l9[0].openingBalance).toBe(1234);
    expect(l9[0].source).toBe('configured');
    expect(opening.measurement).toBe('assetOnly');
  });

  it('surfaces snapshot-only liabilities without fabricating account proceeds', () => {
    const scenario = makeScenario();
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [],
      liabilities: [{ liabilityId: 'L-observed', balance: 300 }],
      measurement: 'assetsMinusLiabilities'
    };

    const opening = resolveOpening(scenario);
    const observedOnly = opening.liabilities.find((entry) => entry.liabilityId === 'L-observed')!;
    expect(observedOnly.kind).toBe('unknown');
    expect(observedOnly.openingBalance).toBe(300);
    // No speculative loan proceeds: no account balances were injected.
    expect(opening.accounts).toHaveLength(scenario.netWorth.accounts.length);
    expect(opening.diagnostics.some((line) => line.includes('L-observed'))).toBe(true);
  });

  it('marks snapshot-only accounts observed-unknown instead of fabricating a type', () => {
    const scenario = makeScenario();
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [{ accountId: 'mystery', balance: 50 }],
      liabilities: [],
      measurement: 'assetOnly'
    };

    const opening = resolveOpening(scenario);
    const mystery = opening.accounts.find((entry) => entry.accountId === 'mystery')!;
    expect(mystery.accountType).toBe('unknown');
    expect(mystery.source).toBe('observed');
    expect(opening.diagnostics.some((line) => line.includes('mystery'))).toBe(true);
  });

  it('records snapshot property debt exactly once when no liability is configured', () => {
    const scenario = makeScenario();
    scenario.liabilities = [];
    scenario.properties = [];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [],
      liabilities: [],
      properties: [{ propertyId: 'home', value: 300000, debtBalance: 240000 }],
      measurement: 'assetsMinusLiabilities'
    };

    const opening = resolveOpening(scenario);
    const linked = opening.liabilities.filter((entry) => entry.linkedPropertyId === 'home');
    expect(linked).toHaveLength(1);
    expect(linked[0].liabilityId).toBe('property:home');
    expect(linked[0].openingBalance).toBe(240000);
    expect(linked[0].source).toBe('observed');
    expect(linked[0].observedFrom).toBe('property');

    const summary = summarizeOpening(opening);
    expect(summary.liabilities).toBe(240000);
    expect(summary.netWorth).toBe(60000);
    // No speculative proceeds injected into accounts.
    expect(opening.accounts).toHaveLength(scenario.netWorth.accounts.length);
  });

  it('uses observed property debt once for a configured linked liability without double counting', () => {
    const scenario = makeScenario();
    scenario.liabilities = [{ id: 'mort1', kind: 'mortgage', openingBalance: 0, linkedPropertyId: 'home' }];
    scenario.properties = [
      { id: 'home', value: 300000, requiredDownPayment: 0, status: 'owned', debtLink: 'mort1' }
    ];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [],
      liabilities: [],
      properties: [{ propertyId: 'home', value: 300000, debtBalance: 240000 }],
      measurement: 'assetsMinusLiabilities'
    };

    const opening = resolveOpening(scenario);
    expect(opening.liabilities).toHaveLength(1);
    expect(opening.liabilities[0].liabilityId).toBe('mort1');
    expect(opening.liabilities[0].openingBalance).toBe(240000);
    expect(opening.liabilities[0].observedFrom).toBe('property');
    expect(summarizeOpening(opening).liabilities).toBe(240000);
  });

  it('honors an explicit observed zero liability over property debt, counted once', () => {
    const scenario = makeScenario();
    scenario.liabilities = [{ id: 'mort1', kind: 'mortgage', openingBalance: 500, linkedPropertyId: 'home' }];
    scenario.properties = [
      { id: 'home', value: 300000, requiredDownPayment: 0, status: 'owned', debtLink: 'mort1' }
    ];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [],
      liabilities: [{ liabilityId: 'mort1', balance: 0 }],
      properties: [{ propertyId: 'home', value: 300000, debtBalance: 240000 }],
      measurement: 'assetsMinusLiabilities'
    };

    const opening = resolveOpening(scenario);
    expect(opening.liabilities).toHaveLength(1);
    expect(opening.liabilities[0].openingBalance).toBe(0);
    expect(opening.liabilities[0].observedFrom).toBe('liability');
    expect(summarizeOpening(opening).liabilities).toBe(0);
  });

  it('keeps historical observations asset-only and never subtracts debt', () => {
    const scenario = makeScenario();
    scenario.liabilities = [{ id: 'L1', kind: 'loan', openingBalance: 999 }];
    scenario.netWorth.history = [
      { id: 'h1', date: '2025-01-01', accounts: [], totalNetWorth: 5000 }
    ];

    const opening = resolveOpening(scenario);
    expect(opening.history).toHaveLength(1);
    expect(opening.history[0].measurement).toBe('assetOnly');
    expect(opening.history[0].totalNetWorth).toBe(5000);

    const history = resolveHistoricalObservations(scenario);
    expect(history[0].measurement).toBe('assetOnly');
    expect(history[0].totalNetWorth).toBe(5000);
  });

  it('summarizes opening assets, liabilities and net worth', () => {
    const scenario = makeScenario();
    const accountId = 'checking-account-default';
    scenario.netWorth.accounts = scenario.netWorth.accounts.map((account) =>
      account.id === accountId ? { ...account, openingBalance: 2000 } : { ...account, openingBalance: 0 }
    );
    scenario.liabilities = [
      { id: 'L1', kind: 'loan', openingBalance: 0 },
      { id: 'L2', kind: 'loan', openingBalance: 300 }
    ];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [{ accountId, balance: 2000 }],
      liabilities: [
        { liabilityId: 'L1', balance: 0 },
        { liabilityId: 'L2', balance: 300 }
      ],
      measurement: 'assetsMinusLiabilities'
    };

    const opening = resolveOpening(scenario);
    const summary = summarizeOpening(opening);
    expect(summary.assets).toBe(2000);
    expect(summary.liabilities).toBe(300);
    expect(summary.netWorth).toBe(1700);
    expect(summary.measurement).toBe('assetsMinusLiabilities');

    expect(resolveOpeningAccountBalances(scenario)[accountId]).toBe(2000);
  });

  it('does not mutate the input scenario', () => {
    const scenario = makeScenario();
    const before = JSON.stringify(scenario);
    resolveOpening(scenario);
    summarizeOpening(resolveOpening(scenario));
    expect(JSON.stringify(scenario)).toBe(before);
  });
});

describe('createConfigurationCommands seam', () => {
  it('exposes the pure command surface', () => {
    const commands = createConfigurationCommands();
    const scenario = makeScenario();
    const next = commands.addTimeline(scenario, { id: 't1' });
    expect(next.activeTimelineId).toBe('t1');
    expect(scenario.activeTimelineId).toBeNull();
    expect(commands.deepClone(scenario)).not.toBe(scenario);
  });

  it('exposes applyGlobal and the global/local scope helpers', () => {
    const commands = createConfigurationCommands();
    const scenario = makeScenario();
    const next = commands.applyGlobal(scenario, (draft) => {
      draft.manualReturns = { ...draft.manualReturns, inflationRate: 1 };
      return draft;
    });
    expect(next.manualReturns.inflationRate).toBe(1);
    expect(scenario.manualReturns.inflationRate).toBe(2.9);
    expect(commands.isGlobalScenarioKey('profile')).toBe(true);
    expect(commands.isTimelineScopeScenarioKey('housing')).toBe(true);
    expect(commands.changedScenarioKeys(scenario, next)).toEqual(['manualReturns']);
  });
});

describe('applyGlobal (global configuration writes)', () => {
  it('deep-clones the full scenario and never shallow-aliases the source', () => {
    const scenario = makeScenario();
    const next = applyGlobal(scenario, (draft) => {
      draft.profile = { ...draft.profile, currentAge: 50 };
      return draft;
    });

    expect(next).not.toBe(scenario);
    expect(next.profile.currentAge).toBe(50);
    expect(next.profile.retirementAge).toBe(scenario.profile.retirementAge);
    // Source untouched.
    expect(scenario.profile.currentAge).toBe(45);

    // Every nested graph is an independent copy.
    expect(next.netWorth).not.toBe(scenario.netWorth);
    expect(next.expenses).not.toBe(scenario.expenses);
    expect(next.careerPlan).not.toBe(scenario.careerPlan);
    expect(next.withdrawal).not.toBe(scenario.withdrawal);

    next.netWorth.accounts[0].label = 'mutated';
    next.expenses.ui.selectedAccountIds.push('x');
    expect(scenario.netWorth.accounts[0].label).not.toBe('mutated');
    expect(scenario.expenses.ui.selectedAccountIds).not.toContain('x');
  });

  it('edits one global field while preserving base + inactive timelines, pay plans and new metadata', () => {
    const scenario = makeScenario();
    const originalDob = scenario.options.dateOfBirth;

    const career = scenario.careerPlan.entries[0];
    career.payPlans = [makePayPlan('base-plan')];
    scenario.largePurchases = [createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE)];

    const timelineCareer = createDefaultCareerEntry(0, 45, 65, 'tl-career');
    timelineCareer.payPlans = [makePayPlan('tl-plan', timelineCareer)];
    scenario.timelines = [
      {
        id: 'tl1',
        label: 'Inactive',
        purchases: [createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE)],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [],
        careerPlan: { enabled: true, entries: [timelineCareer] },
        housing: []
      }
    ];
    scenario.activeTimelineId = null;

    type WithMeta = Scenario & { experimentalMeta?: { revision: number } };
    const next = applyGlobal(scenario, (draft) => {
      draft.options = { ...draft.options, dateOfBirth: '1982-02-02' };
      (draft as WithMeta).experimentalMeta = { revision: 4 };
      return draft;
    }) as WithMeta;

    expect(next.options.dateOfBirth).toBe('1982-02-02');
    expect(next.experimentalMeta).toEqual({ revision: 4 });

    // Unrelated base + inactive timeline locals survive.
    expect(JSON.stringify(next.largePurchases)).toBe(JSON.stringify(scenario.largePurchases));
    expect(JSON.stringify(next.timelines)).toBe(JSON.stringify(scenario.timelines));
    expect(next.careerPlan.entries[0].payPlans![0].label).toBe('Plan base-plan');
    expect(next.timelines![0].careerPlan.entries[0].payPlans![0].label).toBe('Plan tl-plan');

    // The preserved graphs are independent copies, not aliases.
    expect(next.timelines![0].purchases[0]).not.toBe(scenario.timelines![0].purchases[0]);
    expect(next.careerPlan.entries[0].payPlans![0]).not.toBe(scenario.careerPlan.entries[0].payPlans![0]);

    // Valid explicit empties/nulls survive.
    expect(next.trajectorySnapshots).toEqual([]);
    expect(next.dateMarkers).toEqual([]);
    expect(next.incomeFallbackAccountId).toBeNull();
    expect(next.activeTimelineId).toBeNull();
    expect(next.expenses.entries).toEqual([]);

    // Source untouched.
    expect(scenario.options.dateOfBirth).toBe(originalDob);
    expect((scenario as WithMeta).experimentalMeta).toBeUndefined();
  });

  it('does not silently reassign missing funding accounts or invent pool maps', () => {
    const scenario = makeScenario();
    scenario.incomeFallbackAccountId = 'missing-account';
    scenario.incomeFallbackAccountId2 = null;
    scenario.fundingPolicy = undefined;
    (scenario.netWorth as unknown as { pools?: unknown }).pools = undefined;
    const accountIds = scenario.netWorth.accounts.map((account) => account.id);

    const next = applyGlobal(scenario, (draft) => {
      draft.profile = { ...draft.profile, retirementAge: 62 };
      return draft;
    });

    // A dangling fallback is preserved, never silently repaired to another account.
    expect(next.incomeFallbackAccountId).toBe('missing-account');
    expect(next.incomeFallbackAccountId2).toBeNull();
    // An absent funding policy stays absent (no factory default invented).
    expect(next.fundingPolicy).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(next, 'fundingPolicy')).toBe(true);
    // No pool map is synthesized.
    expect((next.netWorth as unknown as { pools?: unknown }).pools).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(next.netWorth, 'pools')).toBe(true);
    expect(next.netWorth.accounts.map((account) => account.id)).toEqual(accountIds);
  });

  it('leaves active + base timeline locals unchanged for an unrelated global edit, with deep isolation', () => {
    const base = makeScenario();
    base.largePurchases = [createDefaultLargePurchase(45, DATE_OF_BIRTH, REFERENCE_DATE)];
    const active = addTimeline(base, { id: 't1', label: 'T1' });
    const withPurchase = applyToActiveTimeline(active, (data) => ({
      ...data,
      purchases: [createDefaultLargePurchase(46, DATE_OF_BIRTH, REFERENCE_DATE)]
    }));

    const next = applyGlobal(withPurchase, (draft) => {
      draft.manualReturns = { ...draft.manualReturns, inflationRate: 1.5 };
      return draft;
    });

    expect(next.activeTimelineId).toBe('t1');
    expect(JSON.stringify(next.largePurchases)).toBe(JSON.stringify(withPurchase.largePurchases));
    expect(JSON.stringify(next.timelines![0].purchases)).toBe(
      JSON.stringify(withPurchase.timelines![0].purchases)
    );
    expect(next.timelines![0].purchases).toHaveLength(1);

    // Deep isolation: mutating the result cannot leak into the source.
    next.timelines![0].purchases[0].label = 'mutated';
    expect(withPurchase.timelines![0].purchases[0].label).not.toBe('mutated');
  });

  it('keeps an empty career plan empty (no fabricated entries) in base and timelines', () => {
    const scenario = makeScenario();
    scenario.careerPlan = { enabled: true, entries: [] };
    scenario.timelines = [
      {
        id: 'tl1',
        label: 'Empty',
        purchases: [],
        longTermPurchases: [],
        loans: [],
        creditCards: [],
        cardPlans: [],
        careerPlan: { enabled: true, entries: [] },
        housing: []
      }
    ];

    const next = applyGlobal(scenario, (draft) => {
      draft.purchaseCategories = [{ id: 'cat-1', label: 'Travel' }];
      return draft;
    });

    expect(next.careerPlan.entries).toEqual([]);
    expect(next.timelines![0].careerPlan.entries).toEqual([]);
    expect(next.purchaseCategories).toEqual([{ id: 'cat-1', label: 'Travel' }]);
    expect(next.careerPlan).not.toBe(scenario.careerPlan);
  });

  it('leaves marker/chain resolution to the existing canonical commands (no local rebuild)', () => {
    const withDanglingMarker = applyGlobal(makeScenario(), (draft) => {
      draft.dateMarkers = [{ id: 'm1', label: 'Retire', date: '2030-06-15' }];
      draft.cashflowItems = [
        {
          id: 'cf1',
          category: 'inheritance',
          label: 'Inheritance',
          enabled: true,
          cadence: 'one_time',
          direction: 'inflow',
          amount: 1000,
          startAge: 45,
          endAge: 45,
          startMarkerId: 'missing-marker'
        }
      ];
      return draft;
    });

    // applyGlobal never rewrites the reference itself.
    expect(withDanglingMarker.cashflowItems[0].startMarkerId).toBe('missing-marker');

    // The existing canonical commands own cleanup + resolution.
    expect(clearDanglingMarkerReferences(withDanglingMarker).cashflowItems[0].startMarkerId).toBeNull();

    const withValidMarker = applyGlobal(makeScenario(), (draft) => {
      draft.dateMarkers = [{ id: 'm1', label: 'Retire', date: '2030-06-15' }];
      draft.cashflowItems = [
        {
          id: 'cf1',
          category: 'inheritance',
          label: 'Inheritance',
          enabled: true,
          cadence: 'one_time',
          direction: 'inflow',
          amount: 1000,
          startAge: 45,
          endAge: 45,
          startMarkerId: 'm1'
        }
      ];
      return draft;
    });
    const resolved = resolveMarkerReferences(withValidMarker);
    expect(resolved.cashflowItems[0].startYearMonth).toBe('2030-06');
    expect(resolved.cashflowItems[0].startMarkerId).toBe('m1');
  });

  it('enforces the global-vs-local split via typed helpers and changedScenarioKeys', () => {
    expect(GLOBAL_SCENARIO_KEYS).toContain('expenses');
    expect(GLOBAL_SCENARIO_KEYS).not.toContain('housing');
    expect(TIMELINE_SCOPE_SCENARIO_KEYS).toContain('housing');
    expect(TIMELINE_SCOPE_SCENARIO_KEYS).not.toContain('expenses');

    expect(isGlobalScenarioKey('profile')).toBe(true);
    expect(isGlobalScenarioKey('largePurchases')).toBe(false);
    expect(isTimelineScopeScenarioKey('careerPlan')).toBe(true);
    expect(isTimelineScopeScenarioKey('expenses')).toBe(false);

    const scenario = makeScenario();
    const next = applyGlobal(scenario, (draft) => {
      draft.profile = { ...draft.profile, currentAge: 47 };
      draft.manualReturns = { ...draft.manualReturns, inflationRate: 1.5 };
      return draft;
    });
    const changed = changedScenarioKeys(scenario, next);
    expect([...changed].sort()).toEqual(['manualReturns', 'profile']);
    expect(changed.every(isGlobalScenarioKey)).toBe(true);

    // The helper also reports timeline-local writes (it is not global-only).
    const localNext = applyToActiveTimeline(scenario, (data) => ({
      ...data,
      loans: [createDefaultLoan(45, DATE_OF_BIRTH, REFERENCE_DATE)]
    }));
    expect(changedScenarioKeys(scenario, localNext)).toEqual(['loans']);
  });
});
