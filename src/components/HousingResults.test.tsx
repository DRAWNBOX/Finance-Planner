import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultHousingEntry, createDefaultScenario } from '../defaultScenario';
import { projectFeatureScenario } from '../engine/featureHandlers';
import type { ProjectionReport } from '../engine/reporting';
import type { HousingEntry, PropertyDefinition } from '../types';
import { HousingResults } from './HousingResults';

describe('HousingResults observed lifecycle status', () => {
  it('does not call an acquisition pending after report evidence shows completion and disposition', () => {
    const scenario = createDefaultScenario(new Date('2026-06-15T12:00:00Z'));
    const housing = { ...createDefaultHousingEntry(scenario.profile.currentAge, scenario.options.dateOfBirth, new Date('2026-06-15T12:00:00Z')), id: 'sold-home', label: 'Sold home' };
    const property: PropertyDefinition = { id: 'sold-property', sourceConfigId: housing.id, label: housing.label, kind: 'primaryResidence', value: 0, debtLink: 'sold-mortgage', requiredDownPayment: 10000, status: 'pending', acquisitionYearMonth: '2026-07' };
    const base = projectFeatureScenario(scenario, { timelineId: null }).report;
    const months = base.months.map((month, index) => index === base.months.length - 1 ? { ...month, properties: [...month.properties, { propertyId: property.id, openingValueCents: 0, openingDepositCents: 0, valueDeltaCents: 0, depositDeltaCents: 0, closingValueCents: 0, closingDepositCents: 0, reconciled: true }], liabilities: [...month.liabilities, { liabilityId: 'sold-mortgage', kind: 'mortgage' as const, openingPrincipalCents: 10000, openingInterestCents: 0, openingFeesCents: 0, principalDeltaCents: -10000, interestDeltaCents: 0, feesDeltaCents: 0, closingPrincipalCents: 0, closingInterestCents: 0, closingFeesCents: 0, reconciled: true }] } : month);
    const audit = [
      { definitionId: 'housing:sold-property:complete', purpose: 'housingAcquisitionCompletion', propertyChanges: [{ propertyId: property.id, status: 'owned' }] },
      { definitionId: 'housing:sold-property:sale', purpose: 'housingDisposition', propertyChanges: [{ propertyId: property.id, status: 'sold' }] }
    ];
    const schedules = [
      { definitionId: 'housing:sold-property:mortgage', purpose: 'housingMortgagePayment', kind: 'housing' as const, periodKind: 'monthly' as const, periodKindReliable: true, firstYearMonth: '2026-07', lastYearMonth: '2026-07', occurrenceCount: 1, months: ['2026-07'], requestedCents: 0, executedCents: 0, shortfallCents: 0, statuses: [], committedCount: 0, unfundedCount: 0, liabilityIds: ['sold-mortgage'], payoffYearMonth: null },
      { definitionId: 'housing:sold-property:accrual', purpose: 'housingMortgageAccrual', kind: 'housing' as const, periodKind: 'monthly' as const, periodKindReliable: true, firstYearMonth: '2026-07', lastYearMonth: '2026-07', occurrenceCount: 1, months: ['2026-07'], requestedCents: 0, executedCents: 0, shortfallCents: 0, statuses: [], committedCount: 0, unfundedCount: 0, liabilityIds: ['sold-mortgage'], payoffYearMonth: '2026-07' }
    ];
    const report = { ...base, months, audit, schedules } as unknown as ProjectionReport;
    render(<HousingResults housing={housing as HousingEntry} property={property} report={report} />);
    expect(screen.getByText('No property held at projection close')).toBeInTheDocument();
    expect(screen.queryByText('Acquisition still pending')).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(screen.getByText(/observed payoff 2026-07/)).toBeInTheDocument();
  });
});
