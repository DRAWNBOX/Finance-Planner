import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountDefinition,
  CareerEntry,
  CareerSourceLine,
  CareerPlan
} from '../types';
import { compilePaycheck, createCareerPayPlan, createDefaultPaycheck } from '../paycheck';
import { AccountCareerPlanEditor } from './AccountCareerPlanEditor';

afterEach(cleanup);

const makeAccount = (id: string, label: string): AccountDefinition => ({
  id,
  label,
  accountType: 'taxable',
  openingBalance: 0,
  annualReturnRate: 0,
  retirementAnnualReturnRate: null,
  displayOrder: 0,
  withdrawalPolicy: { allowAutomaticFallback: true, withdrawalTaxRate: 0, penaltyRate: 0, restrictionNote: '' }
});

const accounts: AccountDefinition[] = [makeAccount('acct-a', 'Account A'), makeAccount('acct-b', 'Account B')];

const makeSourceLine = (overrides: Partial<CareerSourceLine> = {}): CareerSourceLine => ({
  id: 'alloc-1',
  enabled: true,
  sourceType: 'account',
  sourceId: 'acct-a',
  contributionRate: 0,
  savingsMonthly: false,
  monthlyWithdrawal: 0,
  mode: 'percentOfSalary',
  fixedAmount: 0,
  ...overrides
});

const makeCareer = (overrides: Partial<CareerEntry> = {}): CareerEntry => ({
  id: 'career-1',
  label: 'Current Career',
  enabled: true,
  usePreviousCareerStartAge: false,
  startAge: 30,
  endAge: 65,
  annualRaiseRate: 0,
  savingsRate: 0,
  emergencyFundContributionRate: 0,
  hsaContributionRate: 0,
  investmentsContributionRate: 0,
  retirement401kContributionRate: 0,
  emergencyFundSavingsMonthly: false,
  hsaSavingsMonthly: false,
  investmentsSavingsMonthly: false,
  retirement401kSavingsMonthly: false,
  emergencyFundStartBalanceMode: 'manual',
  hsaStartBalanceMode: 'manual',
  investmentsStartBalanceMode: 'manual',
  retirement401kStartBalanceMode: 'manual',
  emergencyFundManualStartBalance: 0,
  hsaManualStartBalance: 0,
  investmentsManualStartBalance: 0,
  retirement401kManualStartBalance: 0,
  paycheck: createDefaultPaycheck(0),
  paycheckInfo: compilePaycheck(createDefaultPaycheck(0)),
  sourceLines: [],
  depositPlan: { allocations: [], remainderAccountId: null, postingDay: 1 },
  payPlans: [],
  ...overrides
});

/**
 * Stateful harness so the controlled component actually reflects the value it
 * emits (needed for add/duplicate/remove/reorder flows where the UI depends on
 * the updated list). `onChange` still records every emission for assertions.
 */
const renderHarness = (initial: CareerPlan, accountList: AccountDefinition[] = accounts) => {
  const onChange = vi.fn();
  let latest = initial;
  const Harness = () => {
    const [value, setValue] = useState(initial);
    latest = value;
    return (
      <AccountCareerPlanEditor
        value={value}
        accounts={accountList}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  };
  const view = render(<Harness />);
  return { ...view, onChange, latest: () => latest };
};

describe('AccountCareerPlanEditor', () => {
  it('keeps an empty career plan empty until a career is added', () => {
    const onChange = vi.fn();
    render(<AccountCareerPlanEditor value={{ enabled: false, entries: [] }} accounts={accounts} onChange={onChange} />);

    expect(screen.getByRole('heading', { name: 'Start with a career' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Careers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Initial' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add your first career' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as CareerPlan;
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({ enabled: true, label: 'Career 1', payPlans: [] });
    expect(next.entries[0].paycheck).toBeDefined();
  });

  it('adds a career and selects it without mutating existing entries', () => {
    const existing = makeCareer();
    const { onChange, latest } = renderHarness({ enabled: true, entries: [existing] });

    fireEvent.click(screen.getByRole('button', { name: '＋ Add career' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as CareerPlan;
    expect(next.entries).toHaveLength(2);
    expect(next.entries[0]).toBe(existing);
    expect(next.entries[1].id).not.toBe(existing.id);
    expect(next.entries[1].label).toBe('Career 2');
    expect(latest().entries).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Career 2' })).toBeInTheDocument();
  });

  it('duplicates a career with deep-cloned source lines, pay plans, deposit plans, and paychecks', () => {
    const paycheck = createDefaultPaycheck(0);
    const plan = createCareerPayPlan('Plan A', '2031-01', paycheck, [makeSourceLine({ id: 'plan-src-1', sourceId: 'acct-b', contributionRate: 4 })]);
    plan.depositPlan = { allocations: [makeSourceLine({ id: 'plan-alloc-1', sourceId: 'acct-a', contributionRate: 5 })], remainderAccountId: 'acct-a', postingDay: 5 };
    const original = makeCareer({
      label: 'Primary',
      sourceLines: [makeSourceLine({ id: 'src-1', sourceId: 'acct-a', contributionRate: 3 })],
      depositPlan: { allocations: [makeSourceLine({ id: 'career-alloc-1', sourceId: 'acct-b', contributionRate: 6 })], remainderAccountId: 'acct-b', postingDay: 3 },
      payPlans: [plan]
    });
    const { onChange } = renderHarness({ enabled: true, entries: [original] });

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate career' }));

    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    expect(next.entries).toHaveLength(2);
    const copy = next.entries[1];
    expect(copy.id).not.toBe(original.id);
    expect(copy.label).toBe('Primary copy');

    // Values are preserved at every level.
    expect(copy.sourceLines).toEqual(original.sourceLines);
    expect(copy.depositPlan).toEqual(original.depositPlan);
    expect(copy.paycheck).toEqual(original.paycheck);
    expect(copy.paycheckInfo).toEqual(original.paycheckInfo);
    expect(copy.payPlans).toEqual(original.payPlans);

    // Object identities are fully isolated (source line, payPlan source line,
    // depositPlan allocation, paycheck line, plus containers).
    expect(copy.sourceLines).not.toBe(original.sourceLines);
    expect(copy.sourceLines?.[0]).not.toBe(original.sourceLines?.[0]);
    expect(copy.depositPlan).not.toBe(original.depositPlan);
    expect(copy.depositPlan?.allocations).not.toBe(original.depositPlan?.allocations);
    expect(copy.depositPlan?.allocations[0]).not.toBe(original.depositPlan?.allocations[0]);
    expect(copy.paycheck).not.toBe(original.paycheck);
    expect(copy.paycheck?.categories[0]).not.toBe(original.paycheck?.categories[0]);
    expect(copy.paycheck?.categories[0].lines[0]).not.toBe(original.paycheck?.categories[0].lines[0]);
    expect(copy.paycheckInfo).not.toBe(original.paycheckInfo);
    expect(copy.payPlans).not.toBe(original.payPlans);
    expect(copy.payPlans?.[0]).not.toBe(original.payPlans?.[0]);
    expect(copy.payPlans?.[0].sourceLines).not.toBe(original.payPlans?.[0].sourceLines);
    expect(copy.payPlans?.[0].sourceLines[0]).not.toBe(original.payPlans?.[0].sourceLines[0]);
    expect(copy.payPlans?.[0].paycheck).not.toBe(original.payPlans?.[0].paycheck);
    expect(copy.payPlans?.[0].paycheck.categories[0]).not.toBe(original.payPlans?.[0].paycheck.categories[0]);
    expect(copy.payPlans?.[0].paycheck.categories[0].lines[0]).not.toBe(original.payPlans?.[0].paycheck.categories[0].lines[0]);
    expect(copy.payPlans?.[0].depositPlan).not.toBe(original.payPlans?.[0].depositPlan);
    expect(copy.payPlans?.[0].depositPlan?.allocations[0]).not.toBe(original.payPlans?.[0].depositPlan?.allocations[0]);

    // Mutating the copy never reaches the source graph.
    copy.sourceLines![0].contributionRate = 99;
    copy.payPlans![0].sourceLines[0].contributionRate = 99;
    copy.payPlans![0].paycheck.categories[0].lines[0].amount = 1;
    copy.payPlans![0].depositPlan!.allocations[0].contributionRate = 99;
    copy.paycheck!.categories[0].lines[0].amount = 1;
    expect(original.sourceLines?.[0].contributionRate).toBe(3);
    expect(original.payPlans?.[0].sourceLines[0].contributionRate).toBe(4);
    expect(original.payPlans?.[0].paycheck.categories[0].lines[0].amount).toBe(paycheck.categories[0].lines[0].amount);
    expect(original.payPlans?.[0].depositPlan?.allocations[0].contributionRate).toBe(5);
    expect(original.paycheck?.categories[0].lines[0].amount).toBe(paycheck.categories[0].lines[0].amount);
  });

  it('removes the active career and leaves the remaining entries untouched', () => {
    const first = makeCareer({ id: 'career-1', label: 'First' });
    const second = makeCareer({ id: 'career-2', label: 'Second' });
    const { onChange, latest } = renderHarness({ enabled: true, entries: [first, second] });

    fireEvent.click(screen.getByRole('button', { name: 'Remove career' }));

    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    expect(next.entries.map((entry) => entry.id)).toEqual(['career-2']);
    expect(next.entries[0]).toBe(second);
    expect(latest().entries.map((entry) => entry.id)).toEqual(['career-2']);
  });

  it('reorders careers with the earlier/later controls and disables the ends', () => {
    const first = makeCareer({ id: 'career-1', label: 'First' });
    const second = makeCareer({ id: 'career-2', label: 'Second' });
    const { onChange } = renderHarness({ enabled: true, entries: [first, second] });

    expect(screen.getByRole('button', { name: 'Move First earlier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Second later' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move Second earlier' }));

    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    expect(next.entries.map((entry) => entry.label)).toEqual(['Second', 'First']);
  });

  it('edits only the selected pay plan, preserving the initial and other plans', () => {
    const initialPaycheck = createDefaultPaycheck(0);
    const planA = createCareerPayPlan('Plan A', '2031-01', createDefaultPaycheck(0), []);
    const planB = createCareerPayPlan('Plan B', '2032-01', createDefaultPaycheck(0), []);
    const career = makeCareer({ paycheck: initialPaycheck, payPlans: [planA, planB] });
    const { onChange } = renderHarness({ enabled: true, entries: [career] });

    fireEvent.click(screen.getByRole('tab', { name: 'Plan A' }));

    fireEvent.change(screen.getByDisplayValue('Plan A'), { target: { value: 'Plan A renamed' } });
    fireEvent.change(screen.getByDisplayValue('2031-01'), { target: { value: '2031-06' } });

    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    const updated = next.entries[0];
    expect(updated.paycheck).toEqual(initialPaycheck);
    expect(updated.payPlans).toHaveLength(2);
    expect(updated.payPlans?.find((plan) => plan.id === planA.id)).toMatchObject({
      label: 'Plan A renamed',
      effectiveYearMonth: '2031-06'
    });
    expect(updated.payPlans?.find((plan) => plan.id === planB.id)).toEqual(planB);
  });

  it('routes allocation edits to the selected plan while leaving the career deposit plan alone', () => {
    const plan = createCareerPayPlan('Plan P', '2031-01', createDefaultPaycheck(0), []);
    const career = makeCareer({
      depositPlan: { allocations: [], remainderAccountId: 'acct-a', postingDay: 1 },
      payPlans: [plan]
    });
    const { onChange } = renderHarness({ enabled: true, entries: [career] });

    fireEvent.click(screen.getByRole('tab', { name: 'Plan P' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ Add destination' }));

    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    const updated = next.entries[0];
    expect(updated.depositPlan).toEqual(career.depositPlan);
    expect(updated.payPlans?.[0].depositPlan?.allocations).toHaveLength(1);
    expect(updated.payPlans?.[0].depositPlan?.allocations[0].sourceId).toBe('acct-a');
  });

  it('edits a dated allocation cap and overflow account without changing Initial', () => {
    const initialAllocation = makeSourceLine({ id: 'initial-allocation', sourceId: 'acct-a', maxBalance: 1200 });
    const datedAllocation = makeSourceLine({ id: 'dated-allocation', sourceId: 'acct-a' });
    const plan = createCareerPayPlan('Plan P', '2031-01', createDefaultPaycheck(0), []);
    plan.depositPlan = { allocations: [datedAllocation], remainderAccountId: null, postingDay: 1 };
    const career = makeCareer({ depositPlan: { allocations: [initialAllocation], remainderAccountId: null, postingDay: 1 }, payPlans: [plan] });
    const { onChange } = renderHarness({ enabled: true, entries: [career] });

    fireEvent.click(screen.getByRole('tab', { name: 'Plan P' }));
    fireEvent.change(screen.getByLabelText('Maximum account balance 1'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Overflow account 1'), { target: { value: 'acct-b' } });

    const updated = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    expect(updated.entries[0].depositPlan?.allocations[0].maxBalance).toBe(1200);
    expect(updated.entries[0].depositPlan?.allocations[0].overflowFallbackAccountId).toBeUndefined();
    expect(updated.entries[0].payPlans?.[0].depositPlan?.allocations[0]).toMatchObject({ maxBalance: 500, overflowFallbackAccountId: 'acct-b' });
    expect(screen.getByLabelText('Maximum account balance 1')).toHaveValue(500);
  });

  it('recompiles the derived paycheckInfo when a granular paycheck is saved on the initial plan', () => {
    const career = makeCareer({ paycheck: createDefaultPaycheck(0), paycheckInfo: compilePaycheck(createDefaultPaycheck(0)) });
    const { onChange } = renderHarness({ enabled: true, entries: [career] });

    fireEvent.click(screen.getByRole('button', { name: 'Edit paycheck' }));
    expect(screen.getByRole('heading', { name: 'Configure Paycheck' })).toBeInTheDocument();

    const modal = screen.getByRole('heading', { name: 'Configure Paycheck' }).closest('.paycheck-modal') as HTMLElement;
    const spinbuttons = within(modal).getAllByRole('spinbutton');
    // earnings row order: rate, hours, amount, ytd
    fireEvent.change(spinbuttons[2], { target: { value: '6000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Paycheck' }));

    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    const updated = next.entries[0];
    expect(updated.paycheck?.categories[0].lines[0].amount).toBe(6000);
    expect(updated.paycheckInfo).toEqual(compilePaycheck(updated.paycheck!));
    expect(updated.paycheckInfo?.grossSalary).toBe(72000);
    expect(screen.queryByRole('heading', { name: 'Configure Paycheck' })).not.toBeInTheDocument();
  });

  it('saving a paycheck for a selected plan updates that plan only', () => {
    const initialPaycheck = createDefaultPaycheck(0);
    const initialInfo = compilePaycheck(initialPaycheck);
    const plan = createCareerPayPlan('Plan P', '2031-01', createDefaultPaycheck(0), []);
    const career = makeCareer({ paycheck: initialPaycheck, paycheckInfo: initialInfo, payPlans: [plan] });
    const { onChange } = renderHarness({ enabled: true, entries: [career] });

    fireEvent.click(screen.getByRole('tab', { name: 'Plan P' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit paycheck' }));

    const modal = screen.getByRole('heading', { name: 'Configure Paycheck' }).closest('.paycheck-modal') as HTMLElement;
    fireEvent.change(within(modal).getAllByRole('spinbutton')[2], { target: { value: '6000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Paycheck' }));

    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    const updated = next.entries[0];
    expect(updated.paycheck).toEqual(initialPaycheck);
    expect(updated.paycheckInfo).toEqual(initialInfo);
    expect(updated.payPlans?.[0].paycheck.categories[0].lines[0].amount).toBe(6000);
  });

  it('records a zero allocation amount while preserving other allocations, remainder, and posting day', () => {
    const allocationA = makeSourceLine({ id: 'alloc-a', sourceId: 'acct-a', contributionRate: 5 });
    const allocationB = makeSourceLine({ id: 'alloc-b', sourceId: 'acct-b', contributionRate: 7 });
    const plan = createCareerPayPlan('Plan P', '2031-01', createDefaultPaycheck(0), []);
    const career = makeCareer({
      depositPlan: { allocations: [allocationA, allocationB], remainderAccountId: 'acct-a', postingDay: 15 },
      payPlans: [plan]
    });
    const { onChange } = renderHarness({ enabled: true, entries: [career] });

    fireEvent.change(screen.getByLabelText('Allocation amount 1'), { target: { value: '0' } });

    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    const deposit = next.entries[0].depositPlan!;
    expect(deposit.allocations[0].contributionRate).toBe(0);
    expect(deposit.allocations[1]).toEqual(allocationB);
    expect(deposit.remainderAccountId).toBe('acct-a');
    expect(deposit.postingDay).toBe(15);
    expect(next.entries[0].payPlans).toEqual([plan]);
  });

  it('keeps an unresolved allocation account selected and offers it as an option', () => {
    const unresolved = makeSourceLine({ id: 'alloc-x', sourceId: 'missing-account' });
    const career = makeCareer({ depositPlan: { allocations: [unresolved], remainderAccountId: null, postingDay: 1 } });

    renderHarness({ enabled: true, entries: [career] });

    const select = screen.getByLabelText('Allocation account 1') as HTMLSelectElement;
    expect(select).toHaveValue('missing-account');
    expect(screen.getByRole('option', { name: 'Unresolved account (missing-account)' })).toBeInTheDocument();
  });

  it('updates the remainder account and posting day without touching allocations or plans', () => {
    const allocation = makeSourceLine({ id: 'alloc-a', sourceId: 'acct-a', contributionRate: 5 });
    const plan = createCareerPayPlan('Plan P', '2031-01', createDefaultPaycheck(0), []);
    const career = makeCareer({
      depositPlan: { allocations: [allocation], remainderAccountId: 'acct-a', postingDay: 1 },
      payPlans: [plan]
    });
    const { onChange } = renderHarness({ enabled: true, entries: [career] });

    fireEvent.change(screen.getByRole('combobox', { name: /remainder account/i }), { target: { value: 'acct-b' } });

    const afterRemainder = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    expect(afterRemainder.entries[0].depositPlan?.remainderAccountId).toBe('acct-b');
    expect(afterRemainder.entries[0].depositPlan?.allocations).toEqual([allocation]);
    expect(afterRemainder.entries[0].depositPlan?.postingDay).toBe(1);
    expect(afterRemainder.entries[0].payPlans).toEqual([plan]);

    fireEvent.change(screen.getByLabelText('Posting day'), { target: { value: '28' } });

    const afterPostingDay = onChange.mock.calls[onChange.mock.calls.length - 1][0] as CareerPlan;
    expect(afterPostingDay.entries[0].depositPlan?.postingDay).toBe(28);
    expect(afterPostingDay.entries[0].depositPlan?.remainderAccountId).toBe('acct-b');
    expect(afterPostingDay.entries[0].depositPlan?.allocations).toEqual([allocation]);
    expect(afterPostingDay.entries[0].payPlans).toEqual([plan]);
  });
});
