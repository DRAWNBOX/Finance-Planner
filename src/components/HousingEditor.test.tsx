import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultHousingEntry } from '../defaultScenario';
import type { HousingEntry, LiabilityDefinition, PropertyDefinition } from '../types';
import { HousingEditor } from './HousingEditor';

const housing = { ...createDefaultHousingEntry(40, '1980-01-01', new Date('2026-01-01T00:00:00Z')), id: 'home', linkedCareerStartId: 'missing-career' };
const property: PropertyDefinition = { id:'prop', sourceConfigId:'home', label:'Future home', value:300000, requiredDownPayment:60000, status:'pending', acquisitionYearMonth:'2030-05', fundingEvents:[{id:'event', date:'2030-05-12', amount:0, accountId:'gone'}] };
const debt: LiabilityDefinition = { id:'mortgage', sourceConfigId:'home', kind:'mortgage', openingBalance:0 };
const baseProps = { housing:[housing], selectedHousingId:'home', onSelectHousing:vi.fn(), onChangeHousing:vi.fn(), onReorderHousing:vi.fn(), onAddHousing:vi.fn(), onDuplicateHousing:vi.fn(), onRemoveHousing:vi.fn(), accountOptions:[], orderedBankAccounts:[], careerOptions:[], properties:[property], liabilities:[debt] };

afterEach(cleanup);

describe('HousingEditor canonical property controls', () => {
  it('keeps Start date source buttons exactly named and pressed state accessible', () => {
    render(<HousingEditor {...baseProps} />);
    const source = screen.getByRole('group', { name: 'Start date source' });
    expect(within(source).getByRole('button', { name: /^Date$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(source).getByRole('button', { name: /^Marker$/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('writes full date-only funding events and deterministic IDs, preserving zero and unresolved accounts', () => {
    const onChangeProperty = vi.fn();
    render(<HousingEditor {...baseProps} onChangeProperty={onChangeProperty} referenceDate="2029-02-03" createId={() => 'stable-id'} />);
    expect(screen.getByLabelText('Funding date 1')).toHaveValue('2030-05-12');
    expect(screen.getByRole('option', { name:'Unavailable account (gone)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name:'Add funding event' }));
    expect(onChangeProperty).toHaveBeenLastCalledWith(expect.objectContaining({ fundingEvents:expect.arrayContaining([expect.objectContaining({ id:'stable-id', date:'2029-02-03', amount:0, accountId:null })]) }));
  });

  it('keeps a zero opening debt visible, disables edits without a liability writer, and preserves a missing career link', () => {
    render(<HousingEditor {...baseProps} onChangeProperty={vi.fn()} />);
    const sections = screen.getAllByRole('region', { name:'Canonical property and debt' });
    const canonical = within(sections[sections.length - 1]);
    expect(canonical.getByLabelText('Observed mortgage balance')).toHaveValue(0);
    expect(canonical.getByLabelText('Observed mortgage balance')).toBeDisabled();
    expect(screen.getAllByRole('option', { name:'Unavailable career (missing-career)' }).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Start Career').some(input => (input as HTMLSelectElement).value === 'missing-career')).toBe(true);
  });

  it('commits an explicitly controlled linked mortgage opening balance', () => {
    const onChangeLiability = vi.fn();
    render(<HousingEditor {...baseProps} onChangeProperty={vi.fn()} onChangeLiability={onChangeLiability} />);
    const sections = screen.getAllByRole('region', { name:'Canonical property and debt' });
    const balance = within(sections[sections.length - 1]).getByLabelText('Observed mortgage balance');
    fireEvent.change(balance, { target:{ value:'125' } });
    fireEvent.blur(balance);
    expect(onChangeLiability).toHaveBeenCalledWith(expect.objectContaining({ id:'mortgage', openingBalance:125 }));
  });

  it('shows legacy grouped sources and keeps missing account references visible', () => {
    const onChangeHousing = vi.fn();
    const entry: HousingEntry = { ...housing, paymentSource:'account:checking', taxesInsuranceSource:'account:missing', hoaMaintenanceSource:'account:checking', pmiSource:'account:checking' };
    render(<HousingEditor {...baseProps} housing={[entry]} onChangeHousing={onChangeHousing} accountOptions={[{ value:'account:checking', label:'Checking' }]} />);
    expect(screen.getByRole('option', { name:'Unavailable account (missing)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name:'Unavailable account (missing)' })).toBeInTheDocument();
    expect(screen.getByText('Unavailable account (missing)')).toBeInTheDocument();
    expect(screen.getByLabelText('Override Taxes & insurance funding')).not.toBeChecked();
  });

  it('writes independent ordered overrides without dropping unrelated housing data', () => {
    const onChangeHousing = vi.fn();
    const entry = { ...housing, fundingPolicies: { payment: { primaryAccountId:'a', fallbackAccountIds:['b','c'] } }, startMarkerId:'marker' };
    render(<HousingEditor {...baseProps} housing={[entry]} onChangeHousing={onChangeHousing} orderedBankAccounts={[{ id:'a', label:'A' }, { id:'b', label:'B' }, { id:'c', label:'C' }] as never} />);
    fireEvent.click(screen.getByLabelText('Override Taxes & insurance funding'));
    expect(onChangeHousing).toHaveBeenLastCalledWith(expect.objectContaining({ startMarkerId:'marker', fundingPolicies: expect.objectContaining({ payment: entry.fundingPolicies.payment, taxesInsurance: expect.objectContaining({ primaryAccountId:null, fallbackAccountIds:[] }) }) }));
    onChangeHousing.mockClear();
    fireEvent.click(screen.getByLabelText('Override Mortgage payment / rent funding'));
    const fallbackB = screen.getByLabelText('Fallback 1');
    expect(fallbackB).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name:'Move Fallback 2 up' }));
    expect(onChangeHousing).toHaveBeenLastCalledWith(expect.objectContaining({ fundingPolicies: expect.objectContaining({ payment: expect.objectContaining({ fallbackAccountIds:['c','b'] }) }) }));
  });

  it('keeps explicit empty policies distinct from inherited defaults and exposes zero amounts', () => {
    const entry = { ...housing, fundingPolicies:{ payment:{ primaryAccountId:null, fallbackAccountIds:[] } } };
    render(<HousingEditor {...baseProps} housing={[entry]} globalFundingPolicy={{ primaryAccountId:'a', fallbackAccountIds:['b'] }} orderedBankAccounts={[{ id:'a', label:'A' }, { id:'b', label:'B' }] as never} />);
    expect(screen.getByLabelText('Override Mortgage payment / rent funding')).toBeChecked();
    expect(within(screen.getByRole('region', { name:'Housing funding order' })).getAllByLabelText('Primary account')[0]).toHaveValue('');
    expect(screen.getByLabelText('HOA/mo')).toHaveValue(0);
  });

  it('shows sale destination and pending held-deposit semantics without forecasting costs', () => {
    render(<HousingEditor {...baseProps} onChangeProperty={vi.fn()} orderedBankAccounts={[{ id:'checking', label:'Checking' } as never]} />);
    expect(screen.getAllByLabelText('Sale Proceeds Account').length).toBeGreaterThan(0);
    expect(screen.getByText(/Sale proceeds go to the selected destination account/)).toBeInTheDocument();
    expect(screen.getByText(/Funds remain a held deposit/)).toBeInTheDocument();
    expect(screen.queryByText(/Total monthly cost/)).not.toBeInTheDocument();
  });
});
