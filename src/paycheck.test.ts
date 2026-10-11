import { describe, expect, it } from 'vitest';
import type { Paycheck, PaycheckInfo } from './types';
import { compilePaycheck, getPaycheckTotals, paycheckFromPaycheckInfo, resolvePaycheckInfo } from './paycheck';

const makePaycheck = (overrides?: Partial<Paycheck>): Paycheck => ({
  payFrequency: 'weekly',
  categories: [
    {
      id: 'cat-earnings',
      label: 'Earnings',
      kind: 'earning',
      lines: [{ id: 'earn-1', label: 'Regular', amount: 1000, mode: 'amount', rate: 25, hours: 40 }]
    },
    {
      id: 'cat-statutory',
      label: 'Statutory',
      kind: 'tax',
      lines: [{ id: 'tax-1', label: 'Federal Income Tax', amount: 200, mode: 'amount' }]
    },
    {
      id: 'cat-other',
      label: 'Other Deductions',
      kind: 'pretax',
      lines: [
        { id: 'ret-1', label: '401k', amount: 100, mode: 'amount', accountId: 'retirement401k-account-default', bucket: 'retirement' },
        { id: 'med-1', label: 'Medical', amount: 0, mode: 'percentOfGross' }
      ]
    },
    {
      id: 'cat-posttax',
      label: 'Post-Tax Deductions',
      kind: 'posttax',
      lines: [{ id: 'roth-1', label: 'Roth', amount: 25, mode: 'amount' }]
    },
    {
      id: 'cat-employer',
      label: 'Employer Benefits',
      kind: 'employer',
      lines: [{ id: 'match-1', label: '401K Er Match', amount: 50, mode: 'amount', accountId: 'retirement401k-account-default', bucket: 'retirement' }]
    }
  ],
  ...overrides
});

describe('compilePaycheck', () => {
  it('annualizes per-period amounts using the pay frequency', () => {
    const info = compilePaycheck(makePaycheck());

    expect(info.grossSalary).toBe(52000);
    expect(info.taxes).toBe(10400);
    expect(info.retirement).toBe(5200);
    expect(info.retirementMatch).toBe(2600);
    expect(info.otherBenefits).toBe(1300);
    expect(info.retirementAccountId).toBe('retirement401k-account-default');
  });

  it('supports percent-of-gross deduction lines', () => {
    const paycheck = makePaycheck();
    paycheck.categories[2].lines[1].amount = 5;
    const info = compilePaycheck(paycheck);

    expect(info.healthBenefits).toBe(2600);
  });

  it('summarizes gross, deductions, and net per period', () => {
    const totals = getPaycheckTotals(makePaycheck());

    expect(totals.periodsPerYear).toBe(52);
    expect(totals.grossPerPeriod).toBe(1000);
    expect(totals.grossAnnual).toBe(52000);
    expect(totals.taxAnnual).toBe(10400);
    expect(totals.pretaxAnnual).toBe(5200);
    expect(totals.posttaxAnnual).toBe(1300);
    expect(totals.employerAnnual).toBe(2600);
    expect(totals.netPerPeriod).toBe(675);
  });
});

describe('paycheckFromPaycheckInfo', () => {
  it('migrates legacy flat scalars into category lines', () => {
    const legacy: PaycheckInfo = {
      grossSalary: 60000,
      taxes: 6000,
      healthBenefits: 0,
      retirement: 3000,
      retirementMatch: 1500,
      hsaContribution: 0,
      hsaEmployerMatch: 0,
      otherBenefits: 0,
      retirementAccountId: 'retirement401k-account-default',
      livingExpenses: 1200,
      employerHsaDeposit: 0
    };

    const paycheck = paycheckFromPaycheckInfo(legacy);
    const info = compilePaycheck(paycheck);

    expect(info.grossSalary).toBe(60000);
    expect(info.taxes).toBe(6000);
    expect(info.retirement).toBe(3000);
    expect(info.retirementMatch).toBe(1500);
    expect(info.otherBenefits).toBe(1200);
    expect(info.retirementAccountId).toBe('retirement401k-account-default');
  });
});

describe('resolvePaycheckInfo', () => {
  it('prefers an explicit paycheckInfo over the compiled paycheck', () => {
    const career = {
      paycheck: makePaycheck(),
      paycheckInfo: { grossSalary: 1234 } as PaycheckInfo
    };

    expect(resolvePaycheckInfo(career)?.grossSalary).toBe(1234);
  });

  it('compiles the paycheck when no paycheckInfo is present', () => {
    expect(resolvePaycheckInfo({ paycheck: makePaycheck() })?.grossSalary).toBe(52000);
  });
});
