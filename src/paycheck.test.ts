import { describe, expect, it } from 'vitest';
import type { Paycheck, PaycheckInfo } from './types';
import {
  compilePaycheck,
  compilePaycheckLineAmounts,
  getPaycheckTotals,
  paycheckFromPaycheckInfo,
  resolvePaycheckInfo
} from './paycheck';
import { createCumulativeShareSchedule, dollarsToCents, splitCumulative } from './engine/money';

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

describe('paycheckFromPaycheckInfo precision (P5.3 / D24)', () => {
  const flatInfo = (overrides: Partial<PaycheckInfo> = {}): PaycheckInfo => ({
    grossSalary: 0,
    taxes: 0,
    healthBenefits: 0,
    retirement: 0,
    retirementMatch: 0,
    hsaContribution: 0,
    hsaEmployerMatch: 0,
    otherBenefits: 0,
    livingExpenses: 0,
    employerHsaDeposit: 0,
    ...overrides
  });

  it('round-trips an arbitrary annual gross salary to the same integer cents', () => {
    // 100000 / 12 = 8333.333…; the old 2-decimal rounding synthesized 8333.33 and
    // compiled back to 99999.96, silently losing 4 cents of supported saved data.
    const paycheck = paycheckFromPaycheckInfo(flatInfo({ grossSalary: 100000 }));
    const compiled = compilePaycheck(paycheck);

    expect(dollarsToCents(compiled.grossSalary)).toBe(10_000_000);
    // No fabricated income: an all-zero tax bucket stays empty.
    expect(compiled.taxes).toBe(0);
    expect(paycheck.categories.find((category) => category.kind === 'tax')!.lines).toHaveLength(0);
  });

  it('preserves exact cents on every deduction / benefit line independently', () => {
    const info = flatInfo({
      grossSalary: 100000.03,
      taxes: 12345.67,
      healthBenefits: 321.09,
      retirement: 0.01,
      retirementMatch: 88.89,
      hsaContribution: 5.55,
      hsaEmployerMatch: 2.22,
      otherBenefits: 7.77
    });
    const compiled = compilePaycheck(paycheckFromPaycheckInfo(info));

    expect(dollarsToCents(compiled.grossSalary)).toBe(dollarsToCents(info.grossSalary));
    expect(dollarsToCents(compiled.taxes)).toBe(dollarsToCents(info.taxes));
    expect(dollarsToCents(compiled.healthBenefits)).toBe(dollarsToCents(info.healthBenefits));
    expect(dollarsToCents(compiled.retirement)).toBe(dollarsToCents(info.retirement));
    expect(dollarsToCents(compiled.retirementMatch)).toBe(dollarsToCents(info.retirementMatch));
    expect(dollarsToCents(compiled.hsaContribution)).toBe(dollarsToCents(info.hsaContribution));
    expect(dollarsToCents(compiled.hsaEmployerMatch)).toBe(dollarsToCents(info.hsaEmployerMatch));
    expect(dollarsToCents(compiled.otherBenefits)).toBe(dollarsToCents(info.otherBenefits));
  });

  it('folds living expenses into post-tax other benefits and employer HSA deposit into the employer HSA match without losing cents', () => {
    const info = flatInfo({ grossSalary: 100, otherBenefits: 7.77, livingExpenses: 999.99, hsaEmployerMatch: 2.22, employerHsaDeposit: 4.44 });
    const compiled = compilePaycheck(paycheckFromPaycheckInfo(info));

    expect(dollarsToCents(compiled.otherBenefits)).toBe(dollarsToCents(7.77) + dollarsToCents(999.99));
    expect(dollarsToCents(compiled.hsaEmployerMatch)).toBe(dollarsToCents(2.22) + dollarsToCents(4.44));
  });

  it('splits a one-cent annual gross across twelve months with no residual', () => {
    const paycheck = paycheckFromPaycheckInfo(flatInfo({ grossSalary: 0.01 }));
    const earning = compilePaycheckLineAmounts(paycheck).find((line) => line.kind === 'earning')!;
    const annualCents = dollarsToCents(earning.annualAmount);

    expect(annualCents).toBe(1);
    const shares = splitCumulative(createCumulativeShareSchedule(annualCents, 12));
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(1);
  });

  it('keeps the existing non-negative normalization (negative clamps to zero, non-finite stays non-finite)', () => {
    const negative = paycheckFromPaycheckInfo(flatInfo({ grossSalary: -1000, taxes: -5 }));
    const earning = negative.categories.find((category) => category.kind === 'earning')!.lines[0];
    expect(earning.amount).toBe(0);
    expect(negative.categories.find((category) => category.kind === 'tax')!.lines).toHaveLength(0);
    expect(dollarsToCents(compilePaycheck(negative).grossSalary)).toBe(0);

    // Existing normalization is `Math.max(0, value)`; `Math.max(0, NaN)` is NaN,
    // so a non-finite value is preserved rather than fabricated into income.
    const nan = paycheckFromPaycheckInfo(flatInfo({ grossSalary: NaN }));
    expect(Number.isNaN(nan.categories.find((category) => category.kind === 'earning')!.lines[0].amount)).toBe(true);
  });
});

describe('compilePaycheckLineAmounts', () => {
  it('annualizes every line and preserves destination metadata', () => {
    const lines = compilePaycheckLineAmounts(makePaycheck());

    const byId = (id: string) => lines.find((line) => line.id === id)!;
    expect(byId('earn-1')).toMatchObject({
      kind: 'earning',
      accountId: null,
      bucket: null,
      perPeriodAmount: 1000,
      annualAmount: 52000
    });
    expect(byId('tax-1')).toMatchObject({ kind: 'tax', annualAmount: 10400 });
    expect(byId('ret-1')).toMatchObject({
      kind: 'pretax',
      bucket: 'retirement',
      accountId: 'retirement401k-account-default',
      annualAmount: 5200
    });
    expect(byId('roth-1')).toMatchObject({ kind: 'posttax', annualAmount: 1300 });
    expect(byId('match-1')).toMatchObject({
      kind: 'employer',
      bucket: 'retirement',
      accountId: 'retirement401k-account-default',
      annualAmount: 2600
    });
  });

  it('resolves percent-of-gross lines against the per-period gross', () => {
    const paycheck = makePaycheck();
    paycheck.categories[2].lines[1].amount = 5;
    const lines = compilePaycheckLineAmounts(paycheck);
    const medical = lines.find((line) => line.id === 'med-1')!;

    expect(medical.perPeriodAmount).toBe(50);
    expect(medical.annualAmount).toBe(2600);
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
