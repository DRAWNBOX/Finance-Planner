import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountDefinition, FundingPolicy } from '../types';
import { FundingPolicyEditor } from './FundingPolicyEditor';

const accounts: AccountDefinition[] = ['a', 'b', 'c'].map((id, index) => ({
  id, label: `Account ${id.toUpperCase()}`, accountType: 'taxable' as AccountDefinition['accountType'],
  openingBalance: 1000, annualReturnRate: 0, retirementAnnualReturnRate: null, displayOrder: index,
  withdrawalPolicy: { allowAutomaticFallback: true, withdrawalTaxRate: 0, penaltyRate: 0, restrictionNote: '' }
}));
const policy = (overrides: Partial<FundingPolicy> = {}): FundingPolicy => ({ primaryAccountId: 'a', fallbackAccountIds: ['b', 'c'], ...overrides });
afterEach(cleanup);

describe('FundingPolicyEditor', () => {
  it('retains unavailable IDs when there are no accounts', () => {
    const onChange = vi.fn();
    render(<FundingPolicyEditor policy={policy({ primaryAccountId: 'gone', fallbackAccountIds: ['also-gone'] })} accounts={[]} mode="override" onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Primary account' })).toHaveValue('gone');
    expect(screen.getByRole('combobox', { name: 'Fallback 1' })).toHaveValue('also-gone');
    expect(screen.getByText(/will not be redirected automatically/i)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a null primary distinct from the first fallback and allows an explicit primary choice', () => {
    const onChange = vi.fn();
    render(<FundingPolicyEditor policy={policy({ primaryAccountId: null, fallbackAccountIds: ['b'] })} accounts={accounts} mode="override" onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Primary account' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Fallback 1' })).toHaveValue('b');
    fireEvent.change(screen.getByRole('combobox', { name: 'Primary account' }), { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ primaryAccountId: 'a', fallbackAccountIds: ['b'] }));
  });

  it('reorders and removes fallbacks; inherited controls are disabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FundingPolicyEditor policy={policy()} accounts={accounts} mode="override" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Fallback 2 up' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fallbackAccountIds: ['c', 'b'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Fallback 1' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ fallbackAccountIds: ['c'] }));
    rerender(<FundingPolicyEditor policy={policy()} accounts={accounts} mode="inherited" onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Primary account' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('uses distinct labels for add-fallback controls in multiple instances', () => {
    render(<><FundingPolicyEditor policy={policy({ fallbackAccountIds: [] })} accounts={accounts} mode="override" onChange={vi.fn()} /><FundingPolicyEditor policy={policy({ fallbackAccountIds: [] })} accounts={accounts} mode="override" onChange={vi.fn()} /></>);
    const selects = screen.getAllByLabelText('Add fallback');
    expect(selects).toHaveLength(2);
    expect(selects[0]).not.toBe(selects[1]);
  });
});
