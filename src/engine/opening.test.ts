/**
 * P3H.2 prerequisite — opening resolution for pending acquisitions.
 *
 * ADR-020 / CA09 / frozen P0.5.3: before the required down payment is fully
 * funded a pending acquisition has **no property value and no mortgage**. Only
 * actual observed opening facts win (including an observed `0`). These tests pin
 * that contract on the pure `resolveOpening` boundary and on the `buildState`
 * totals consumers (read-only), while confirming owned/sold observations and
 * unrelated liabilities are untouched.
 */

import { describe, expect, it } from 'vitest';

import { createDefaultScenario } from '../defaultScenario';
import type { PropertyDefinition } from '../types';
import { resolveOpening, summarizeOpening } from './opening';
import { buildState } from './state';

const REFERENCE_DATE = new Date('2026-01-15');

const makeScenario = () => createDefaultScenario(REFERENCE_DATE);

const pendingHome = (over: Partial<PropertyDefinition> = {}): PropertyDefinition => ({
  id: 'home',
  label: 'Future home',
  value: 300000,
  debtLink: 'home-mortgage',
  requiredDownPayment: 60000,
  status: 'pending',
  ...over
});

describe('opening resolution — pending acquisition (ADR-020 / CA09)', () => {
  it('reports zero opening value and no opening debt for an unobserved pending property', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'home-mortgage', kind: 'mortgage', openingBalance: 240000, linkedPropertyId: 'home' }
    ];
    scenario.properties = [pendingHome()];

    const opening = resolveOpening(scenario);
    const home = opening.properties.find((property) => property.propertyId === 'home')!;

    // No property value before the down payment completes — $300k is a future price.
    expect(home.value).toBe(0);
    expect(home.status).toBe('pending');
    // Identity + future down payment are preserved for the completion handler.
    expect(home.label).toBe('Future home');
    expect(home.requiredDownPayment).toBe(60000);
    expect(home.debtLink).toBe('home-mortgage');

    // $240k configured financing is not opening debt.
    expect(opening.liabilities).toHaveLength(0);

    const summary = summarizeOpening(opening);
    expect(summary.liabilities).toBe(0);
    expect(summary.propertyLinkedDebt).toBe(0);
    // No account balances configured: the pending price is not counted as assets.
    expect(summary.assets).toBe(0);

    // Skipped, not silently: the future financing is called out explicitly and the
    // generic "configured opening balance used once" line is not emitted.
    expect(
      opening.diagnostics.some(
        (line) => line.includes('home-mortgage') && line.includes('pending property "home"')
      )
    ).toBe(true);
    expect(
      opening.diagnostics.some(
        (line) => line.includes('home-mortgage') && line.includes('configured opening balance used once')
      )
    ).toBe(false);
  });

  it('preserves an observed zero liability over the pending future mortgage', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'home-mortgage', kind: 'mortgage', openingBalance: 240000, linkedPropertyId: 'home' }
    ];
    scenario.properties = [pendingHome()];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [],
      liabilities: [{ liabilityId: 'home-mortgage', balance: 0 }],
      measurement: 'assetsMinusLiabilities'
    };

    const opening = resolveOpening(scenario);
    const liability = opening.liabilities.find((entry) => entry.liabilityId === 'home-mortgage')!;

    expect(liability.openingBalance).toBe(0);
    expect(liability.source).toBe('observed');
    expect(liability.observedFrom).toBe('liability');
    expect(summarizeOpening(opening).liabilities).toBe(0);
    expect(opening.hasSnapshot).toBe(true);
  });

  it('lets observed property debt win over the pending skip, counted once', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'home-mortgage', kind: 'mortgage', openingBalance: 240000, linkedPropertyId: 'home' }
    ];
    scenario.properties = [pendingHome()];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [],
      liabilities: [],
      properties: [{ propertyId: 'home', value: 300000, debtBalance: 240000 }],
      measurement: 'assetsMinusLiabilities'
    };

    const opening = resolveOpening(scenario);
    const linked = opening.liabilities.filter((entry) => entry.linkedPropertyId === 'home');
    const home = opening.properties.find((property) => property.propertyId === 'home')!;

    // An authoritative observed value/debt wins even while status is pending.
    expect(linked).toHaveLength(1);
    expect(linked[0].liabilityId).toBe('home-mortgage');
    expect(linked[0].openingBalance).toBe(240000);
    expect(linked[0].source).toBe('observed');
    expect(linked[0].observedFrom).toBe('property');
    expect(home.value).toBe(300000);
    // Property debt is counted exactly once: never synthesized under `property:home`.
    expect(opening.liabilities.some((entry) => entry.liabilityId === 'property:home')).toBe(false);
    expect(summarizeOpening(opening).liabilities).toBe(240000);
  });

  it('keeps property-only observed debt once for a pending property', () => {
    const scenario = makeScenario();
    scenario.liabilities = [];
    scenario.properties = [pendingHome({ debtLink: null })];
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
  });

  it('does not silently drop unrelated liabilities', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'student-loan', kind: 'loan', openingBalance: 5000 },
      { id: 'home-mortgage', kind: 'mortgage', openingBalance: 240000, linkedPropertyId: 'home' }
    ];
    scenario.properties = [pendingHome()];

    const opening = resolveOpening(scenario);

    expect(opening.liabilities.map((entry) => entry.liabilityId)).toEqual(['student-loan']);
    expect(opening.liabilities[0].openingBalance).toBe(5000);
    expect(opening.liabilities[0].source).toBe('configured');
  });

  it('leaves owned property observation unchanged', () => {
    const scenario = makeScenario();
    scenario.liabilities = [
      { id: 'mort1', kind: 'mortgage', openingBalance: 240000, linkedPropertyId: 'home' }
    ];
    scenario.properties = [
      { id: 'home', label: 'Current home', value: 300000, debtLink: 'mort1', requiredDownPayment: 0, status: 'owned' }
    ];

    const configured = resolveOpening(scenario);
    expect(configured.properties[0].value).toBe(300000);
    expect(configured.properties[0].source).toBe('configured');
    const configuredLiability = configured.liabilities.find((entry) => entry.liabilityId === 'mort1')!;
    expect(configuredLiability.openingBalance).toBe(240000);
    expect(configuredLiability.source).toBe('configured');

    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [],
      liabilities: [],
      properties: [{ propertyId: 'home', value: 350000, debtBalance: 200000 }],
      measurement: 'assetsMinusLiabilities'
    };

    const observed = resolveOpening(scenario);
    const home = observed.properties.find((property) => property.propertyId === 'home')!;
    const liability = observed.liabilities.find((entry) => entry.liabilityId === 'mort1')!;

    expect(home.value).toBe(350000);
    expect(home.status).toBe('owned');
    expect(home.source).toBe('observed');
    expect(liability.openingBalance).toBe(200000);
    expect(liability.source).toBe('observed');
    expect(liability.observedFrom).toBe('property');
  });
});

describe('opening resolution — pending acquisition through buildState totals', () => {
  it('excludes the future $300k property and $240k mortgage from state totals', () => {
    const scenario = makeScenario();
    scenario.netWorth.accounts = scenario.netWorth.accounts.map((account, index) =>
      index === 0 ? { ...account, openingBalance: 5000 } : account
    );
    scenario.liabilities = [
      { id: 'home-mortgage', kind: 'mortgage', openingBalance: 240000, linkedPropertyId: 'home' }
    ];
    scenario.properties = [pendingHome()];

    const state = buildState(resolveOpening(scenario));

    expect(state.getProperty('home')?.valueCents).toBe(0);
    expect(state.getProperty('home')?.status).toBe('pending');
    // The future mortgage link is cleared at the state boundary; the completion
    // handler establishes the property/mortgage link atomically when it funds.
    expect(state.getProperty('home')?.mortgageId).toBeNull();
    expect(state.getLiability('home-mortgage')).toBeUndefined();
    expect(state.getLiabilities()).toHaveLength(0);

    const totals = state.getTotals();
    expect(totals.propertyValueCents).toBe(0);
    expect(totals.liabilityCents).toBe(0);
    expect(totals.accountCents).toBe(500000);
    expect(totals.netWorthCents).toBe(500000);

    expect(state.getDiagnostics().some((line) => line.includes('link cleared'))).toBe(true);
  });
});
