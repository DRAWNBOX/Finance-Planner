import type {
  CareerPayPlan,
  CareerSourceLine,
  PayFrequency,
  Paycheck,
  PaycheckCategory,
  PaycheckDepositBucket,
  PaycheckInfo,
  PaycheckLine,
  PaycheckLineKind
} from './types';

export const clonePaycheck = (paycheck: Paycheck): Paycheck => ({
  ...paycheck,
  categories: paycheck.categories.map((category) => ({
    ...category,
    lines: category.lines.map((line) => ({ ...line }))
  }))
});

export const cloneSourceLines = (lines: CareerSourceLine[]): CareerSourceLine[] => lines.map((line) => ({ ...line }));

let payPlanSeed = 0;
const makePayPlanId = () => `pay-plan-${Date.now().toString(36)}-${(payPlanSeed += 1).toString(36)}`;

export const createCareerPayPlan = (
  label: string,
  effectiveYearMonth: string,
  paycheck: Paycheck,
  sourceLines: CareerSourceLine[]
): CareerPayPlan => ({
  id: makePayPlanId(),
  label,
  effectiveYearMonth,
  effectiveMarkerId: null,
  paycheck: clonePaycheck(paycheck),
  sourceLines: cloneSourceLines(sourceLines)
});

export const PAY_FREQUENCY_PERIODS: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12
};

export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  semimonthly: 'Semi-monthly',
  monthly: 'Monthly'
};

export const getPeriodsPerYear = (paycheck?: Paycheck): number =>
  paycheck ? PAY_FREQUENCY_PERIODS[paycheck.payFrequency] ?? 12 : 12;

const YEARLY_PERIOD: PaycheckInfo['period'] = {
  grossSalary: 'yearly',
  taxes: 'yearly',
  healthBenefits: 'yearly',
  retirement: 'yearly',
  retirementMatch: 'yearly',
  hsaContribution: 'yearly',
  hsaEmployerMatch: 'yearly',
  otherBenefits: 'yearly',
  livingExpenses: 'yearly'
};

const emptyPaycheckInfo = (): PaycheckInfo => ({
  grossSalary: 0,
  taxes: 0,
  healthBenefits: 0,
  retirement: 0,
  retirementMatch: 0,
  hsaContribution: 0,
  hsaEmployerMatch: 0,
  otherBenefits: 0,
  livingExpenses: 0,
  retirementMode: 'amount',
  retirementMatchMode: 'amount',
  employerMaxMatchPercent: 0,
  hsaContributionMode: 'amount',
  hsaEmployerMatchMode: 'amount',
  employerHsaDeposit: 0,
  employerHsaDepositMode: 'amount',
  period: YEARLY_PERIOD
});

export const getPaycheckLinePerPeriod = (line: PaycheckLine, grossPerPeriod: number): number => {
  if (line.mode === 'percentOfGross') {
    return grossPerPeriod * (line.amount / 100);
  }
  return line.amount;
};

export const getPaycheckGrossPerPeriod = (paycheck: Paycheck): number =>
  paycheck.categories
    .filter((category) => category.kind === 'earning')
    .reduce((sum, category) => sum + category.lines.reduce((lineSum, line) => lineSum + Math.max(0, line.amount), 0), 0);

export interface PaycheckTotals {
  periodsPerYear: number;
  grossPerPeriod: number;
  grossAnnual: number;
  taxAnnual: number;
  pretaxAnnual: number;
  posttaxAnnual: number;
  employerAnnual: number;
  netPerPeriod: number;
  netAnnual: number;
}

export const getPaycheckTotals = (paycheck: Paycheck): PaycheckTotals => {
  const periodsPerYear = getPeriodsPerYear(paycheck);
  const grossPerPeriod = getPaycheckGrossPerPeriod(paycheck);
  let taxAnnual = 0;
  let pretaxAnnual = 0;
  let posttaxAnnual = 0;
  let employerAnnual = 0;

  paycheck.categories.forEach((category) => {
    if (category.kind === 'earning') {
      return;
    }

    const annual = category.lines.reduce(
      (sum, line) => sum + getPaycheckLinePerPeriod(line, grossPerPeriod) * periodsPerYear,
      0
    );

    if (category.kind === 'tax') taxAnnual += annual;
    else if (category.kind === 'pretax') pretaxAnnual += annual;
    else if (category.kind === 'posttax') posttaxAnnual += annual;
    else if (category.kind === 'employer') employerAnnual += annual;
  });

  const netAnnual = Math.max(0, grossPerPeriod * periodsPerYear - taxAnnual - pretaxAnnual - posttaxAnnual);

  return {
    periodsPerYear,
    grossPerPeriod,
    grossAnnual: grossPerPeriod * periodsPerYear,
    taxAnnual,
    pretaxAnnual,
    posttaxAnnual,
    employerAnnual,
    netPerPeriod: netAnnual / periodsPerYear,
    netAnnual
  };
};

export const payFrequencyDefaultCategoryLabels: Record<PaycheckLineKind, string> = {
  earning: 'Earnings',
  tax: 'Statutory',
  pretax: 'Other Deductions',
  posttax: 'Post-Tax Deductions',
  employer: 'Employer Benefits'
};

/**
 * Compiles the granular paycheck model into the flat annual scalars the projection engine consumes.
 * Amounts on lines are per pay period and annualized using the paycheck frequency.
 */
export const compilePaycheck = (paycheck: Paycheck): PaycheckInfo => {
  const periods = getPeriodsPerYear(paycheck);
  const grossPerPeriod = getPaycheckGrossPerPeriod(paycheck);
  const info = emptyPaycheckInfo();
  info.grossSalary = grossPerPeriod * periods;

  for (const category of paycheck.categories) {
    if (category.kind === 'earning') {
      continue;
    }

    for (const line of category.lines) {
      const annual = getPaycheckLinePerPeriod(line, grossPerPeriod) * periods;
      if (annual <= 0) {
        continue;
      }

      if (category.kind === 'tax') {
        info.taxes += annual;
        continue;
      }

      if (category.kind === 'posttax') {
        info.otherBenefits += annual;
        continue;
      }

      const bucket: PaycheckDepositBucket | null = line.bucket ?? null;

      if (category.kind === 'pretax') {
        if (bucket === 'retirement') {
          info.retirement += annual;
          info.retirementAccountId = info.retirementAccountId ?? line.accountId ?? undefined;
        } else if (bucket === 'hsa') {
          info.hsaContribution += annual;
          info.hsaAccountId = info.hsaAccountId ?? line.accountId ?? undefined;
        } else {
          info.healthBenefits += annual;
        }
        continue;
      }

      if (category.kind === 'employer') {
        if (bucket === 'retirement') {
          info.retirementMatch += annual;
          info.retirementAccountId = info.retirementAccountId ?? line.accountId ?? undefined;
        } else if (bucket === 'hsa') {
          info.hsaEmployerMatch += annual;
          info.hsaAccountId = info.hsaAccountId ?? line.accountId ?? undefined;
        }
      }
    }
  }

  return info;
};

export const resolvePaycheckInfo = (career: { paycheck?: Paycheck; paycheckInfo?: PaycheckInfo } | undefined): PaycheckInfo | undefined => {
  if (!career) {
    return undefined;
  }

  if (career.paycheckInfo) {
    return career.paycheckInfo;
  }

  if (career.paycheck) {
    return compilePaycheck(career.paycheck);
  }

  return undefined;
};

let paycheckLineSeed = 0;
const makeSeed = () => `${Date.now().toString(36)}-${(paycheckLineSeed += 1).toString(36)}`;

export const createPaycheckLine = (label: string, amount: number, kind: PaycheckLineKind): PaycheckLine => ({
  id: `paycheck-line-${kind}-${makeSeed()}`,
  label,
  amount,
  mode: 'amount'
});

export const createPaycheckCategory = (label: string, kind: PaycheckLineKind): PaycheckCategory => ({
  id: `paycheck-category-${kind}-${makeSeed()}`,
  label,
  kind,
  lines: []
});

export const createDefaultPaycheck = (index: number, payFrequency: PayFrequency = 'monthly'): Paycheck => {
  const periods = PAY_FREQUENCY_PERIODS[payFrequency];
  const baseSalary = index === 0 ? 98000 : 110000 + index * 12000;

  return {
    payFrequency,
    categories: [
      {
        id: 'paycheck-category-earnings',
        label: 'Earnings',
        kind: 'earning',
        lines: [
          {
            id: 'paycheck-line-earnings-regular',
            label: 'Regular',
            amount: Math.round((baseSalary / periods) * 100) / 100,
            mode: 'amount'
          }
        ]
      },
      createPaycheckCategory('Statutory', 'tax'),
      createPaycheckCategory('Other Deductions', 'pretax'),
      createPaycheckCategory('Employer Benefits', 'employer')
    ]
  };
};

/**
 * Synthesizes a granular paycheck from legacy flat paycheck scalars so the paycheck editor has
 * something to show for scenarios saved before the paycheck model existed. Values are annual
 * scalars distributed across a monthly frequency (amount = annual / 12).
 */
export const paycheckFromPaycheckInfo = (info: PaycheckInfo | undefined): Paycheck => {
  const categories: PaycheckCategory[] = [
    { id: 'paycheck-category-earnings', label: 'Earnings', kind: 'earning', lines: [] },
    { id: 'paycheck-category-statutory', label: 'Statutory', kind: 'tax', lines: [] },
    { id: 'paycheck-category-deductions', label: 'Other Deductions', kind: 'pretax', lines: [] },
    { id: 'paycheck-category-posttax', label: 'Post-Tax Deductions', kind: 'posttax', lines: [] },
    { id: 'paycheck-category-employer', label: 'Employer Benefits', kind: 'employer', lines: [] }
  ];
  const byKind = (kind: PaycheckLineKind) => categories.find((category) => category.kind === kind)!;

  if (!info) {
    return { payFrequency: 'monthly', categories };
  }

  const monthly = (value: number) => Math.round((Math.max(0, value) / 12) * 100) / 100;

  byKind('earning').lines.push({ id: 'paycheck-line-earnings-regular', label: 'Regular', amount: monthly(info.grossSalary), mode: 'amount' });
  if (info.taxes > 0) byKind('tax').lines.push({ id: 'paycheck-line-tax', label: 'Taxes', amount: monthly(info.taxes), mode: 'amount' });

  if (info.healthBenefits > 0) {
    byKind('pretax').lines.push({ id: 'paycheck-line-benefits', label: 'Health Benefits', amount: monthly(info.healthBenefits), mode: 'amount' });
  }
  if (info.retirement > 0) {
    byKind('pretax').lines.push({ id: 'paycheck-line-retirement', label: 'Retirement', amount: monthly(info.retirement), mode: 'amount', accountId: info.retirementAccountId ?? null, bucket: 'retirement' });
  }
  if (info.hsaContribution > 0) {
    byKind('pretax').lines.push({ id: 'paycheck-line-hsa', label: 'HSA', amount: monthly(info.hsaContribution), mode: 'amount', accountId: info.hsaAccountId ?? null, bucket: 'hsa' });
  }

  if (info.otherBenefits > 0) {
    byKind('posttax').lines.push({ id: 'paycheck-line-other', label: 'Other Benefits', amount: monthly(info.otherBenefits), mode: 'amount' });
  }
  if ((info.livingExpenses ?? 0) > 0) {
    byKind('posttax').lines.push({ id: 'paycheck-line-living', label: 'Living Expenses', amount: monthly(info.livingExpenses), mode: 'amount' });
  }

  if (info.retirementMatch > 0) {
    byKind('employer').lines.push({ id: 'paycheck-line-retirement-match', label: 'Retirement Match', amount: monthly(info.retirementMatch), mode: 'amount', accountId: info.retirementAccountId ?? null, bucket: 'retirement' });
  }
  if (info.hsaEmployerMatch > 0) {
    byKind('employer').lines.push({ id: 'paycheck-line-hsa-match', label: 'HSA Match', amount: monthly(info.hsaEmployerMatch), mode: 'amount', accountId: info.hsaAccountId ?? null, bucket: 'hsa' });
  }
  if ((info.employerHsaDeposit ?? 0) > 0) {
    byKind('employer').lines.push({ id: 'paycheck-line-employer-hsa', label: 'Employer HSA Deposit', amount: monthly(info.employerHsaDeposit ?? 0), mode: 'amount', accountId: info.hsaAccountId ?? null, bucket: 'hsa' });
  }

  return { payFrequency: 'monthly', categories };
};
