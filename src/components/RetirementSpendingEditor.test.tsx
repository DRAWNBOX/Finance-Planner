import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRetirementWithdrawalSource } from '../defaultScenario';
import type { AccountDefinition, WithdrawalPlan } from '../types';
import { RetirementSpendingEditor } from './RetirementSpendingEditor';

const referenceDate = new Date(2030, 0, 15);
const base: WithdrawalPlan = { mode: 'percentOfInitialBalance', minimumYearlyWithdrawal: 0, maximumYearlyWithdrawal: 100000, useRetirementAgeAsWithdrawalStartAge: false, fallbackAccountIds: [], sourceLines: [] };
const account: AccountDefinition = { id: 'acct', label: 'Brokerage', accountType: 'taxable', openingBalance: 10, annualReturnRate: 0, retirementAnnualReturnRate: null, displayOrder: 0, withdrawalPolicy: { allowAutomaticFallback: true, withdrawalTaxRate: 0, penaltyRate: 0, restrictionNote: '' } };
const last = <T,>(values: T[]) => values[values.length - 1];
afterEach(cleanup);

describe('RetirementSpendingEditor', () => {
  it('creates a new 4% source from explicit reference date and accepts explicit zero', () => {
    const onChange = vi.fn();
    const { rerender } = render(<RetirementSpendingEditor plan={base} accounts={[account]} referenceDate={referenceDate} onChange={onChange}/>);
    fireEvent.click(screen.getByRole('button', { name: /add withdrawal source/i }));
    const added = onChange.mock.calls[0][0] as WithdrawalPlan;
    expect(added.sourceLines?.[0]).toMatchObject({ mode: 'percentOfInitialBalance', initialWithdrawalRatePercent: 4, firstWithdrawalDate: '2030-01-15', initialWithdrawalValuationDate: '2030-01-15' });
    rerender(<RetirementSpendingEditor plan={added} accounts={[account]} referenceDate={referenceDate} onChange={onChange}/>);
    fireEvent.change(screen.getByLabelText('Withdrawal rate'), { target: { value: '0' } });
    expect(last(onChange.mock.calls)?.[0].sourceLines[0].initialWithdrawalRatePercent).toBe(0);
    expect(added.sourceLines?.[0].firstWithdrawalDate).not.toBe(new Date(2099, 0, 1).toISOString().slice(0, 10));
  });

  it('moves default valuation with first date but preserves a distinct valuation date', () => {
    const linked = createDefaultRetirementWithdrawalSource(referenceDate, { accountId: 'acct' });
    const distinct = { ...linked, id: 'distinct', firstWithdrawalDate: '2030-01-15', initialWithdrawalValuationDate: '2029-12-01' };
    const onChange = vi.fn();
    const { rerender } = render(<RetirementSpendingEditor plan={{ ...base, sourceLines: [linked] }} accounts={[account]} referenceDate={referenceDate} onChange={onChange}/>);
    fireEvent.change(screen.getByLabelText('First withdrawal date'), { target: { value: '2032-05-01' } });
    expect(last(onChange.mock.calls)?.[0].sourceLines[0].initialWithdrawalValuationDate).toBe('2032-05-01');
    rerender(<RetirementSpendingEditor plan={{ ...base, sourceLines: [distinct] }} accounts={[account]} referenceDate={referenceDate} onChange={onChange}/>);
    fireEvent.change(screen.getByLabelText('First withdrawal date'), { target: { value: '2032-05-01' } });
    expect(last(onChange.mock.calls)?.[0].sourceLines[0].initialWithdrawalValuationDate).toBe('2029-12-01');
  });

  it('retains missing accounts and puts plan-wide limits only once', () => {
    const line = createDefaultRetirementWithdrawalSource(referenceDate, { accountId: 'missing' });
    const onChange = vi.fn();
    render(<RetirementSpendingEditor plan={{ ...base, sourceLines: [line, { ...line, id: 'two' }] }} accounts={[]} referenceDate={referenceDate} onChange={onChange}/>);
    expect(screen.getAllByText(/unavailable account \(missing\)/i)).toHaveLength(2);
    expect(screen.getAllByText('Minimum yearly withdrawal')).toHaveLength(1);
    expect(screen.getAllByText('Maximum yearly withdrawal')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Minimum yearly withdrawal'), { target: { value: '500' } });
    expect(last(onChange.mock.calls)?.[0].minimumYearlyWithdrawal).toBe(500);
    expect(screen.getByText(/inflation adjustment follows/i)).toBeInTheDocument();
  });

  it('shows range errors and keeps invalid rate/day out of canonical plan', () => {
    const line = createDefaultRetirementWithdrawalSource(referenceDate, { accountId: 'acct' });
    const onChange = vi.fn();
    render(<RetirementSpendingEditor plan={{ ...base, sourceLines: [line] }} accounts={[account]} referenceDate={referenceDate} onChange={onChange}/>);
    fireEvent.change(screen.getByLabelText('Withdrawal rate'), { target: { value: '101' } });
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('0 to 100');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Payment day'), { target: { value: '32' } });
    expect(screen.getAllByRole('alert')[1]).toHaveTextContent('1 to 31');
    expect(onChange).not.toHaveBeenCalled();
  });
});
