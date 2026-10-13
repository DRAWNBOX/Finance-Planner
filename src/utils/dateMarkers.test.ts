import { describe, expect, it } from 'vitest';
import { defaultScenario } from '../defaultScenario';
import type { HousingEntry, Scenario } from '../types';
import { resolveDateMarkers, yearMonthFromMarkerDate } from './dateMarkers';

const makeHousing = (overrides: Partial<HousingEntry> = {}): HousingEntry => ({
  id: 'h1',
  label: 'Home',
  enabled: true,
  showOnGraph: true,
  housingType: 'mortgage',
  startYearMonth: '2030-01',
  purchasePrice: 0,
  downPayment: 0,
  annualInterestRate: 0,
  loanTermYears: 30,
  extraMonthlyPayment: 0,
  monthlyRent: 0,
  endYearMonth: '',
  propertyTaxYearly: 0,
  homeInsuranceYearly: 0,
  hoaMonthly: 0,
  maintenanceMonthly: 0,
  pmiMonthly: 0,
  rentalIncomeMonthly: 0,
  sellYearMonth: '',
  appreciationRate: 0,
  sellingCostsRate: 0,
  ...overrides
});

const withMarkers = (scenario: Scenario, markers: Scenario['dateMarkers']): Scenario => ({
  ...scenario,
  dateMarkers: markers
});

describe('yearMonthFromMarkerDate', () => {
  it('extracts the year-month from an ISO date', () => {
    expect(yearMonthFromMarkerDate('2035-07-04')).toBe('2035-07');
    expect(yearMonthFromMarkerDate('not-a-date')).toBe('');
  });
});

describe('resolveDateMarkers', () => {
  it('resolves housing start/sell dates from referenced markers', () => {
    const scenario = withMarkers(
      {
        ...defaultScenario,
        housing: [makeHousing({ startMarkerId: 'm-start', sellMarkerId: 'm-sell' })]
      },
      [
        { id: 'm-start', label: 'Move', date: '2031-03-15' },
        { id: 'm-sell', label: 'Sell', date: '2040-11-01' }
      ]
    );

    const resolved = resolveDateMarkers(scenario);
    expect(resolved.housing[0].startYearMonth).toBe('2031-03');
    expect(resolved.housing[0].sellYearMonth).toBe('2040-11');
  });

  it('cascades marker changes to every referencing field', () => {
    const marker = { id: 'm-same', label: 'Together', date: '2033-06-01' };
    const scenario = withMarkers(
      {
        ...defaultScenario,
        housing: [makeHousing({ startMarkerId: 'm-same' })],
        loans: [
          {
            id: 'loan-1',
            label: 'Loan',
            enabled: true,
            showOnGraph: true,
            startYearMonth: '2030-01',
            originalAmount: 1000,
            downPayment: 0,
            currentBalance: 1000,
            annualInterestRate: 5,
            minimumMonthlyPayment: 10,
            extraMonthlyPayment: 0,
            paymentSourceAccount: 'income',
            startMarkerId: 'm-same'
          }
        ]
      },
      [marker]
    );

    const resolved = resolveDateMarkers(scenario);
    expect(resolved.housing[0].startYearMonth).toBe('2033-06');
    expect(resolved.loans[0].startYearMonth).toBe('2033-06');

    const changed = resolveDateMarkers(
      withMarkers(scenario, [{ ...marker, date: '2044-02-20' }])
    );
    expect(changed.housing[0].startYearMonth).toBe('2044-02');
    expect(changed.loans[0].startYearMonth).toBe('2044-02');
  });

  it('resolves expense start/end dates at full-date granularity', () => {
    const scenario = withMarkers(
      {
        ...defaultScenario,
        expenses: {
          ...defaultScenario.expenses,
          entries: [
            {
              id: 'exp-1',
              label: 'Trip',
              amount: 500,
              startDate: '2030-01-01',
              endDate: '2030-01-02',
              accountId: null,
              poolId: null,
              notes: '',
              originType: 'manual',
              importSourceId: null,
              importBatchId: null,
              createdAt: '2030-01-01',
              updatedAt: '2030-01-01',
              startMarkerId: 'm-trip',
              endMarkerId: 'm-trip'
            }
          ]
        }
      },
      [{ id: 'm-trip', label: 'Trip', date: '2036-08-09' }]
    );

    const resolved = resolveDateMarkers(scenario);
    expect(resolved.expenses.entries[0].startDate).toBe('2036-08-09');
    expect(resolved.expenses.entries[0].endDate).toBe('2036-08-09');
  });

  it('derives age-coupled fields (careers) from the marker date', () => {
    const scenario = withMarkers(
      {
        ...defaultScenario,
        options: { dateOfBirth: '1990-01-01' },
        profile: { currentAge: 40, retirementAge: 65, retirementYears: 30 },
        careerPlan: {
          enabled: true,
          entries: [
            {
              ...defaultScenario.careerPlan.entries[0],
              startAge: 40,
              endAge: 60,
              startYearMonth: '2030-01',
              startMarkerId: 'm-job'
            }
          ]
        }
      },
      [{ id: 'm-job', label: 'New job', date: '2035-01-01' }]
    );

    const resolved = resolveDateMarkers(scenario, { dateOfBirth: '1990-01-01', currentAge: 40 });
    expect(resolved.careerPlan.entries[0].startYearMonth).toBe('2035-01');
    expect(resolved.careerPlan.entries[0].startAge).toBe(45);
  });

  it('clears dangling references while keeping the last literal value', () => {
    const scenario = withMarkers(
      {
        ...defaultScenario,
        housing: [makeHousing({ startYearMonth: '2031-03', startMarkerId: 'missing-marker' })]
      },
      [{ id: 'other', label: 'Other', date: '2040-01-01' }]
    );

    const resolved = resolveDateMarkers(scenario);
    expect(resolved.housing[0].startMarkerId).toBeNull();
    expect(resolved.housing[0].startYearMonth).toBe('2031-03');
  });

  it('clears references when the last marker is removed', () => {
    const scenario: Scenario = {
      ...defaultScenario,
      housing: [makeHousing({ startYearMonth: '2031-03', startMarkerId: 'missing' })]
    };
    const resolved = resolveDateMarkers(scenario);
    expect(resolved.housing[0].startMarkerId).toBeNull();
    expect(resolved.housing[0].startYearMonth).toBe('2031-03');
  });

  it('resolves net pay plan effective dates from referenced markers', () => {
    const base = defaultScenario.careerPlan.entries[0];
    const plan = {
      id: 'plan-1',
      label: 'Raise',
      effectiveYearMonth: '2030-01',
      effectiveMarkerId: 'm-raise',
      paycheck: base.paycheck!,
      sourceLines: base.sourceLines ?? []
    };
    const scenario = withMarkers(
      {
        ...defaultScenario,
        careerPlan: { enabled: true, entries: [{ ...base, startAge: 40, endAge: 60, payPlans: [plan] }] }
      },
      [{ id: 'm-raise', label: 'Raise', date: '2033-09-01' }]
    );

    const resolved = resolveDateMarkers(scenario);
    expect(resolved.careerPlan.entries[0].payPlans![0].effectiveYearMonth).toBe('2033-09');
    expect(resolved.careerPlan.entries[0].payPlans![0].effectiveMarkerId).toBe('m-raise');
  });

  it('clears a dangling pay plan marker while keeping the last effective month', () => {
    const base = defaultScenario.careerPlan.entries[0];
    const plan = {
      id: 'plan-1',
      label: 'Raise',
      effectiveYearMonth: '2030-01',
      effectiveMarkerId: 'missing-marker',
      paycheck: base.paycheck!,
      sourceLines: base.sourceLines ?? []
    };
    const scenario = withMarkers(
      {
        ...defaultScenario,
        careerPlan: { enabled: true, entries: [{ ...base, startAge: 40, endAge: 60, payPlans: [plan] }] }
      },
      [{ id: 'other', label: 'Other', date: '2040-01-01' }]
    );

    const resolved = resolveDateMarkers(scenario);
    expect(resolved.careerPlan.entries[0].payPlans![0].effectiveMarkerId).toBeNull();
    expect(resolved.careerPlan.entries[0].payPlans![0].effectiveYearMonth).toBe('2030-01');
  });

  it('resolves a credit card autopay end date from a marker', () => {
    const card = {
      id: 'cc1',
      label: 'Card',
      enabled: true,
      currentBalance: 0,
      annualInterestRate: 0,
      introEnabled: false,
      introEndYearMonth: '',
      monthlyCharges: 0,
      paymentMode: 'autopay' as const,
      fixedPaymentAmount: 100,
      minimumPaymentPercent: 0,
      minimumPaymentFloor: 0,
      paymentSource: 'income' as const,
      lumpSumPaymentSource: 'income' as const,
      paymentDay: 1,
      autopayEndYearMonth: '2030-01',
      autopayEndMarkerId: 'm-cc'
    };
    const scenario = withMarkers(
      { ...defaultScenario, creditCards: [card] },
      [{ id: 'm-cc', label: 'Card end', date: '2034-05-15' }]
    );

    const resolved = resolveDateMarkers(scenario);
    expect(resolved.creditCards[0].autopayEndYearMonth).toBe('2034-05');
    expect(resolved.creditCards[0].autopayEndMarkerId).toBe('m-cc');
  });

  it('clears a dangling autopay end marker while keeping the last month', () => {
    const card = {
      id: 'cc1',
      label: 'Card',
      enabled: true,
      currentBalance: 0,
      annualInterestRate: 0,
      introEnabled: false,
      introEndYearMonth: '',
      monthlyCharges: 0,
      paymentMode: 'autopay' as const,
      fixedPaymentAmount: 100,
      minimumPaymentPercent: 0,
      minimumPaymentFloor: 0,
      paymentSource: 'income' as const,
      lumpSumPaymentSource: 'income' as const,
      paymentDay: 1,
      autopayEndYearMonth: '2030-06',
      autopayEndMarkerId: 'missing-marker'
    };
    const scenario = withMarkers(
      { ...defaultScenario, creditCards: [card] },
      [{ id: 'other', label: 'Other', date: '2040-01-01' }]
    );

    const resolved = resolveDateMarkers(scenario);
    expect(resolved.creditCards[0].autopayEndMarkerId).toBeNull();
    expect(resolved.creditCards[0].autopayEndYearMonth).toBe('2030-06');
  });
});
