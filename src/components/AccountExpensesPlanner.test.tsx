import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountDefinition, ExpenseEntry, ExpensesConfig } from '../types';
import type { ProjectionReport } from '../engine/reporting';
import { AccountExpensesPlanner } from './AccountExpensesPlanner';

const account: AccountDefinition = { id: 'checking', label: 'Checking', accountType: 'checking', openingBalance: 1000, annualReturnRate: 0, retirementAnnualReturnRate: null, displayOrder: 0, withdrawalPolicy: { allowAutomaticFallback: true, withdrawalTaxRate: 0, penaltyRate: 0, restrictionNote: '' } };
const occurred: ExpenseEntry = { id: 'imp-1', label: 'Old train', amount: 20, startDate: '2026-10-14', endDate: '2026-10-14', accountId: 'checking', notes: '', originType: 'imported', importSourceId: 'file', importBatchId: 'batch', createdAt: '2026-01-01', updatedAt: '2026-01-01', categoryId: 'food', provenance: 'imported', planningStatus: 'occurred', sourceDate: '2025-04-02', sourceSign: 'debit', asOf: '2025-04-30' };
const config = (entries: ExpenseEntry[] = [occurred]): ExpensesConfig => ({ entries, imports: [], categoriesByAccountId: { checking: [{ id: 'food', label: 'Food' }, { id: 'travel', label: 'Travel' }] }, weeklyBalanceByAccountId: {}, maxBalanceByAccountId: {}, activePlanningAccountId: 'checking', recurringEvents: [], ui: { groupingMode: 'account', zoomLevel: 1, rowHeight: 26, density: 'comfortable', snapToDay: true, scrubberDate: '2026-10-14', windowStartDate: '2026-10-14', windowEndDate: '2026-10-21', selectedAccountIds: [], collapsedTrackIds: [], trackerVisibleAccountIds: [], planningWeekStartDay: 0 } });
const emptyReport = { months: [], outcomes: [], metadata: { startDate: '2020-01-01', endDate: '2100-12-31' } } as unknown as ProjectionReport;

describe('AccountExpensesPlanner', () => {
  afterEach(cleanup);
  it('keeps occurred imports view-only and Plan from import creates a new planned identity without changing provenance', () => {
    const onChange = vi.fn(); render(<AccountExpensesPlanner expenses={config()} accounts={[account]} report={emptyReport} onChange={onChange} />);
    expect(screen.getByText('Occurred · view only')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plan from import' }));
    const next = onChange.mock.calls[0][0] as ExpensesConfig;
    expect(next.entries).toHaveLength(2); expect(next.entries[0]).toEqual(occurred);
    expect(next.entries[1].id).not.toBe(occurred.id); expect(next.entries[1].planningStatus).toBe('planned');
    expect(next.entries[1]).toMatchObject({ sourceDate: null, sourceSign: null, asOf: null, originType: 'manual' });
  });
  it('adds a single manual recurring definition, scoped to the selected account and category', () => {
    const onChange = vi.fn(); render(<AccountExpensesPlanner expenses={config([])} accounts={[account]} report={emptyReport} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. Weekly groceries'), { target: { value: 'Rent' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'recurring' } });
    fireEvent.change(screen.getAllByLabelText('Category')[1], { target: { value: 'travel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));
    const next = onChange.mock.calls[0][0] as ExpensesConfig;
    expect(next.recurringEvents).toHaveLength(1); expect(next.entries).toHaveLength(0);
    expect(next.recurringEvents[0]).toMatchObject({ label: 'Rent', accountId: 'checking', categoryId: 'travel', planningStatus: 'planned', cadence: 'weekly' });
  });
  it('shows category filtering and the empty state', () => {
    render(<AccountExpensesPlanner expenses={config([])} accounts={[account]} report={emptyReport} onChange={vi.fn()} />);
    expect(screen.getAllByText('A clear week is a useful starting point.')).toHaveLength(1);
    fireEvent.change(screen.getAllByLabelText('Category')[0], { target: { value: 'travel' } });
    expect(screen.getAllByText('Travel').length).toBeGreaterThan(0);
  });
  it('copies and moves planned entries while leaving source provenance untouched', () => {
    const plan: ExpenseEntry = { ...occurred, id: 'plan-1', label: 'Planned', originType: 'manual', provenance: 'planner', planningStatus: 'planned', sourceDate: '2024-03-02', sourceSign: 'credit', asOf: '2024-04-01' };
    const onChange = vi.fn(); render(<AccountExpensesPlanner expenses={config([plan])} accounts={[account]} report={emptyReport} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Planned to 2026-10-15' }));
    const moved = onChange.mock.calls[0][0] as ExpensesConfig;
    expect(moved.entries[0]).toMatchObject({ sourceDate: '2024-03-02', sourceSign: 'credit', asOf: '2024-04-01', startDate: '2026-10-15' });
  });
  it('supports keyboard move and copy-to-cell without moving or copying occurred observations', () => {
    const plan: ExpenseEntry = { ...occurred, id: 'plan-keyboard', label: 'Planned', originType: 'manual', provenance: 'planner', planningStatus: 'planned' };
    const onChange = vi.fn(); render(<AccountExpensesPlanner expenses={config([occurred, plan])} accounts={[account]} report={emptyReport} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Plan from import' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy Old train' })).toBeNull();
    fireEvent.keyDown(screen.getByText('Planned').closest('article')!, { key: 'm' });
    fireEvent.keyDown(screen.getByLabelText('Food, 2026-10-15'), { key: 'Enter' });
    expect(onChange.mock.calls[0][0].entries[1].startDate).toBe('2026-10-15');
    cleanup(); onChange.mockClear();
    render(<AccountExpensesPlanner expenses={config([plan])} accounts={[account]} report={emptyReport} onChange={onChange} />);
    fireEvent.keyDown(screen.getByText('Planned').closest('article')!, { key: 'c' });
    fireEvent.keyDown(screen.getByLabelText('Food, 2026-10-15'), { key: 'Enter' });
    const pasted = onChange.mock.calls[0][0] as ExpensesConfig;
    expect(pasted.entries).toHaveLength(2);
    expect(pasted.entries[1]).toMatchObject({ planningStatus: 'planned', sourceDate: null, sourceSign: null, asOf: null, startDate: '2026-10-15' });
    expect(pasted.entries[1].id).not.toBe(plan.id);
  });
  it('sorts by amount and applies/removes a visible flag without altering planning identity', () => {
    const first = { ...occurred, id: 'small', label: 'Small', amount: 5, originType: 'manual' as const, provenance: 'planner' as const, planningStatus: 'planned' as const };
    const second = { ...first, id: 'large', label: 'Large', amount: 50 };
    const onChange = vi.fn(); render(<AccountExpensesPlanner expenses={config([first, second])} accounts={[account]} report={emptyReport} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Sort expenses'), { target: { value: 'amount' } });
    const cards = screen.getAllByText(/\$\d/).map(el => el.closest('article')).filter(Boolean);
    expect(cards[0]?.textContent).toContain('Small');
    fireEvent.click(screen.getByRole('button', { name: 'Flag Small' }));
    const flagged = onChange.mock.calls[0][0] as ExpensesConfig;
    expect(flagged.entries.find(e => e.id === 'small')).toMatchObject({ color: '#c06b36', planningStatus: 'planned', id: 'small' });
    expect(flagged.entries.find(e => e.id === 'large')?.color).toBeUndefined();
  });
  it('imports reviewable parser results and removes only the selected source entries', async () => {
    const manual: ExpenseEntry = { ...occurred, id: 'manual-1', label: 'Manual', originType: 'manual', provenance: 'planner', planningStatus: 'planned', importSourceId: null, importBatchId: null };
    const source = { id: 'other-source', batchId: 'b', fileName: 'other.csv', fileType: 'csv' as const, previewText: '', status: 'ready' as const, parseNotes: [], confidence: 0.8, importedAt: '2026-10-14', appliedAt: '', entryIds: ['other-import'] };
    const otherImport: ExpenseEntry = { ...occurred, id: 'other-import', importSourceId: 'other-source' };
    const initial = { ...config([manual, otherImport]), imports: [source] };
    const onChange = vi.fn(); render(<AccountExpensesPlanner expenses={initial} accounts={[account]} report={emptyReport} onChange={onChange} />);
    const file = new File(['date,description,amount\nnot-a-date,Tea,3\n2026-10-13,Coffee,4'], 'statement.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Import expense files'), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const imported = onChange.mock.calls[0][0] as ExpensesConfig;
    expect(imported.imports).toHaveLength(2);
    const newSource = imported.imports.find(item => item.id !== 'other-source')!;
    expect(newSource.status).toBe('needs_review');
    expect(imported.entries.filter(entry => entry.importSourceId === newSource.id).length).toBeGreaterThan(0);
    expect(imported.entries.find(entry => entry.importSourceId === newSource.id)).toMatchObject({ provenance: 'imported', planningStatus: 'occurred', sourceDate: expect.any(String), sourceSign: expect.stringMatching(/^(debit|credit)$/), asOf: expect.any(String) });
    cleanup(); onChange.mockClear();
    render(<AccountExpensesPlanner expenses={imported} accounts={[account]} report={emptyReport} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove source' })[1]);
    const removed = onChange.mock.calls[0][0] as ExpensesConfig;
    expect(removed.imports.some(item => item.id === newSource.id)).toBe(false);
    expect(removed.entries.some(entry => entry.importSourceId === newSource.id)).toBe(false);
    expect(removed.entries).toEqual(expect.arrayContaining([manual, otherImport]));
    expect(removed.recurringEvents).toEqual(initial.recurringEvents);
  });
  it('edits a recurrence schedule in place rather than adding a second event', () => {
    const recurring = { id: 'rent-monthly', label: 'Rent', amount: 1200, accountId: 'checking', categoryId: 'food', cadence: 'monthly' as const, rule: 'on_date' as const, startDate: '2026-10-01', endDate: '2027-10-01', dayOfMonth: 1, enabled: true, planningStatus: 'planned' as const };
    const onChange = vi.fn(); render(<AccountExpensesPlanner expenses={{ ...config([]), recurringEvents: [recurring] }} accounts={[account]} report={emptyReport} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit schedule' }));
    fireEvent.change(screen.getByLabelText('Rent day of month'), { target: { value: '31' } });
    const changedDay = onChange.mock.calls[0][0] as ExpensesConfig;
    expect(changedDay.recurringEvents[0].dayOfMonth).toBe(31);
    fireEvent.change(screen.getByLabelText('Rent cadence'), { target: { value: 'weekly' } });
    const changedCadence = onChange.mock.calls[1][0] as ExpensesConfig;
    expect(changedCadence.recurringEvents).toHaveLength(1);
    expect(changedCadence.recurringEvents[0]).toMatchObject({ id: 'rent-monthly', cadence: 'weekly', startDate: recurring.startDate, endDate: recurring.endDate });
  });

  it('shows selected-account report closes around the planner week and follows account/month selection', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 23, 30, 0));
    const report = { metadata: { startDate: '2026-10-01', endDate: '2026-11-30' }, outcomes: [], months: [
      { yearMonth: '2026-10', closingDate: '2026-10-31', accounts: [{ accountId: 'checking', closingCents: 15000 }, { accountId: 'savings', closingCents: 20000 }] },
      { yearMonth: '2026-11', closingDate: '2026-11-30', accounts: [{ accountId: 'checking', closingCents: 12000 }, { accountId: 'savings', closingCents: 30000 }] }
    ] } as unknown as ProjectionReport;
    const savings: AccountDefinition = { ...account, id: 'savings', label: 'Savings' };
    const expenses = { ...config([]), maxBalanceByAccountId: { checking: 125 } };
    render(<AccountExpensesPlanner expenses={expenses} accounts={[account, savings]} report={report} onChange={vi.fn()} />);

    expect(screen.getByText('OBSERVED PROJECTION CLOSES')).toBeTruthy();
    expect(screen.getByText('Oct 2026')).toBeTruthy();
    expect(screen.getByText('$150.00')).toBeTruthy();
    expect(screen.getByText('$120.00')).toBeTruthy();
    expect(screen.getByText(/above display threshold/)).toBeTruthy();
    expect(screen.getByText('Monthly · event-date engine')).toBeTruthy();
    expect(screen.getByText(/planned schedule, not a balance forecast/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'savings' } });
    expect(screen.getByText('$200.00')).toBeTruthy();
    expect(screen.getByText('$300.00')).toBeTruthy();
    expect(screen.queryByText('$150.00')).toBeNull();

    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'checking' } });
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByText('Nov 2026')).toBeTruthy();
    expect(screen.getByText('$120.00')).toBeTruthy();
    expect(screen.queryByText('Oct 2026')).toBeNull();
    vi.useRealTimers();
  });

  it('sums only unique selected-week planned outcomes from the report, including fallback sources', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'));
    const planned: ExpenseEntry = { ...occurred, id: 'weekly-plan', label: 'Groceries', originType: 'manual', importSourceId: null, importBatchId: null, provenance: 'planner', planningStatus: 'planned', accountId: 'checking', startDate: '2026-10-12', endDate: '2026-10-12' };
    const imported: ExpenseEntry = { ...occurred, id: 'occurred-only', label: 'Imported meal', startDate: '2026-10-13', endDate: '2026-10-13' };
    const recurring = { id: 'weekly-recurring', label: 'Transit', amount: 30, accountId: 'checking', categoryId: null, cadence: 'weekly' as const, rule: 'on_date' as const, startDate: '2026-10-16', endDate: '2026-12-31', enabled: true, planningStatus: 'planned' as const };
    const outcome = (occurrenceId: string, definitionId: string, date: string, accountId: string, requestedCents: number, executedCents: number, allocations: { accountId: string; netFundedCents: number }[], committed = true) => ({ occurrenceId, definitionId, handlerId: null, yearMonth: date.slice(0, 7), date, phase: 'discretionary', purpose: 'planner', committed, requestedCents, executedCents, shortfallCents: requestedCents - executedCents, status: committed ? 'committed' : 'unfunded', quotaLimited: false, eligibleSources: [], skippedSources: [], plan: { allocations }, row: null });
    const report = { metadata: { startDate: '2026-10-01', endDate: '2026-10-20' }, outcomes: [
      outcome('grocery-occ', 'planner:weekly-plan', '2026-10-12', 'checking', 4000, 4000, [{ accountId: 'checking', netFundedCents: 2000 }, { accountId: 'savings', netFundedCents: 2000 }]),
      outcome('transit-occ', 'recurrence:weekly-recurring', '2026-10-16', 'checking', 3000, 2500, [{ accountId: 'checking', netFundedCents: 1000 }, { accountId: 'savings', netFundedCents: 1500 }]),
      outcome('other-account-occ', 'planner:other-plan', '2026-10-14', 'savings', 5000, 5000, [{ accountId: 'savings', netFundedCents: 5000 }]),
      outcome('occurred-fake-occ', 'planner:occurred-only', '2026-10-13', 'checking', 9000, 9000, [{ accountId: 'checking', netFundedCents: 9000 }]),
      outcome('grocery-occ', 'planner:weekly-plan', '2026-10-12', 'checking', 4000, 4000, [{ accountId: 'checking', netFundedCents: 2000 }, { accountId: 'savings', netFundedCents: 2000 }])
    ], months: [{ yearMonth: '2026-10', closingDate: '2026-10-31', accounts: [{ accountId: 'checking', closingCents: 12345 }, { accountId: 'savings', closingCents: 54321 }] }] } as unknown as ProjectionReport;
    const expenses = { ...config([planned, imported]), recurringEvents: [recurring] };
    const savings: AccountDefinition = { ...account, id: 'savings', label: 'Savings' };
    render(<AccountExpensesPlanner expenses={expenses} accounts={[account, savings]} report={report} onChange={vi.fn()} />);

    expect(screen.getByText('This week · observed planner outcomes')).toBeTruthy();
    expect(screen.getByText('$70.00')).toBeTruthy();
    expect(screen.getByText('$65.00')).toBeTruthy();
    expect(screen.getByText('$30.00')).toBeTruthy();
    expect(screen.getByText('2026-10-11 – 2026-10-17')).toBeTruthy();
    expect(screen.getByText('Oct 2026')).toBeTruthy();
    expect(screen.getByText('$123.45')).toBeTruthy();
    expect(screen.getByText(/not a weekly balance forecast/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByText('This week · observed planner outcomes')).toBeTruthy();
    expect(screen.getAllByText('$0.00')).toHaveLength(3);
    expect(screen.getByText('2026-10-18 – 2026-10-24 · incomplete: outside or crossing the report window')).toBeTruthy();
    expect(screen.getByText('Oct 2026')).toBeTruthy();
    expect(screen.getByText('$123.45')).toBeTruthy();
    vi.useRealTimers();
  });
});
