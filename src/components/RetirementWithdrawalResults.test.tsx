import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { RetirementWithdrawalResults } from './RetirementWithdrawalResults';

const source = { id: 'line-a', label: '401K', enabled: true, accountId: 'acct', mode: 'percentOfInitialBalance' as const, amount: 0, firstWithdrawalDate: '2026-07-01' };
const outcome = (overrides: Record<string, unknown> = {}) => ({ occurrenceId: 'occ-a', definitionId: 'retirement:line-a', handlerId: null, yearMonth: '2026-07', date: '2026-07-15', phase: 'mandatory' as const, purpose: 'retirement', committed: true, requestedCents: 33333, executedCents: 33333, shortfallCents: 0, status: 'committed', quotaLimited: false, eligibleSources: [], skippedSources: [], plan: { allocations: [] }, row: null, ...overrides }) as never;

describe('RetirementWithdrawalResults', () => {
  afterEach(cleanup);
  it('shows exact-date observed request, committed payment and unpaid amount by source identity', () => {
    render(<RetirementWithdrawalResults sourceLines={[source]} outcomes={[outcome({ committed: true, executedCents: 20000, shortfallCents: 13333 })]} />);
    const row = screen.getByRole('row', { name: /2026-07-15/ });
    expect(within(row).getByText('$333.33')).toBeInTheDocument();
    expect(within(row).getByText('$200.00')).toBeInTheDocument();
    expect(within(row).getByText('$133.33')).toBeInTheDocument();
  });

  it('does not invent activity for a zero-rate source', () => {
    render(<RetirementWithdrawalResults sourceLines={[source]} outcomes={[]} />);
    expect(screen.getByText(/No withdrawals were observed for 401K/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lets a later-start source show its own first outcome when an earlier source has over 12', async () => {
    const user = userEvent.setup();
    const second = { ...source, id: 'line-b', label: 'Roth', accountId: 'roth' };
    const firstThirteen = Array.from({ length: 13 }, (_, index) => outcome({ occurrenceId: `first-${index}`, definitionId: 'retirement:line-a', date: `2026-${String(index + 1).padStart(2, '0')}-15`, yearMonth: `2026-${String(index + 1).padStart(2, '0')}` }));
    const later = outcome({ occurrenceId: 'later-source', definitionId: 'retirement:line-b', date: '2028-01-15', yearMonth: '2028-01', requestedCents: 4200, executedCents: 4200, shortfallCents: 0 });
    render(<RetirementWithdrawalResults sourceLines={[source, second]} outcomes={[...firstThirteen, later]} />);
    expect(screen.getAllByRole('row')).toHaveLength(13);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Retirement withdrawal source' }), 'line-b');
    expect(screen.getByRole('row', { name: /2028-01-15/ })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /2028-01-15/ })).getAllByText('$42.00')).toHaveLength(2);
    expect(screen.queryByRole('row', { name: /2026-/ })).not.toBeInTheDocument();
  });

  it('shows no posted payment as fully unpaid even when an uncommitted quote includes tentative execution', () => {
    render(<RetirementWithdrawalResults sourceLines={[source]} outcomes={[outcome({ committed: false, requestedCents: 10000, executedCents: 9000, shortfallCents: 1000, plan: { allocations: [{ accountId: 'acct', grossDebitCents: 9000, netFundedCents: 9000, withheldTaxCents: 0, penaltyCents: 0 }] } })]} />);
    const row = screen.getByRole('row', { name: /2026-07-15/ });
    expect(within(row).getAllByText('$100.00')).toHaveLength(2);
    expect(within(row).getByText('$0.00')).toBeInTheDocument();
    expect(within(row).getByText('No payment posted')).toBeInTheDocument();
    expect(screen.queryByText('Committed account details')).not.toBeInTheDocument();
  });
});
