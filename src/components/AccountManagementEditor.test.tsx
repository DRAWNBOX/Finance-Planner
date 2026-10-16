import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAccount, createDefaultFundingPolicy } from '../defaultScenario';
import type { AccountDefinition, NetWorthConfig } from '../types';
import { AccountManagementEditor } from './AccountManagementEditor';

const account = createDefaultAccount({id:'a',label:'Everyday',openingBalance:0,displayOrder:0});
const netWorth: NetWorthConfig = { accounts:[account], asOfDate:'2026-10-14', openingSnapshot:{date:'2026-10-14',measurement:'assetOnly',accounts:[{accountId:'a',balance:0}],liabilities:[]} };
const setup = (overrides: Record<string, unknown> = {}) => {
  const props = {netWorth,fundingPolicy:createDefaultFundingPolicy({primaryAccountId:'missing'}),onAddAccount:vi.fn(),onUpdateAccount:vi.fn(),onReorderAccounts:vi.fn(),onRemoveAccount:vi.fn(),onFundingPolicyChange:vi.fn(),onOpeningSnapshotChange:vi.fn(),...overrides} as React.ComponentProps<typeof AccountManagementEditor>;
  return { ...render(<AccountManagementEditor {...props}/>), props };
};
afterEach(cleanup);

describe('AccountManagementEditor',()=>{
  it('keeps zero opening values and nullable retirement overrides distinct',()=>{
    const {props}=setup();
    expect(screen.getByLabelText(/Opening balance/)).toHaveValue(0);
    expect(screen.getByLabelText(/Retirement return/)).toHaveValue(null);
    fireEvent.change(screen.getByLabelText(/Opening balance/),{target:{value:'5'}});
    expect(props.onUpdateAccount).toHaveBeenCalledWith(expect.objectContaining({openingBalance:5}));
  });
  it('adds a fresh independent default and confirms deletion accessibly',()=>{
    const {props}=setup();
    fireEvent.click(screen.getByRole('button',{name:'＋ Add account'}));
    const next=(props.onAddAccount as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(next.openingBalance).toBe(0); expect(next.annualReturnRate).toBe(0); expect(next.retirementAnnualReturnRate).toBeNull();
    expect(next.withdrawalPolicy).not.toBe(account.withdrawalPolicy);
    fireEvent.click(screen.getByRole('button',{name:'Remove account'}));
    expect(screen.getByRole('alert')).toHaveTextContent('Linked funding references');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button',{name:'Remove account'}));
    expect(props.onRemoveAccount).toHaveBeenCalledWith('a');
  });
  it('flags an orphaned funding reference and preserves an asset-only zero observation',()=>{
    setup();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('no longer available');
    expect(screen.getByText('Assets only')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
  });
  it('captures configured accounts and liabilities as observations without changing measurement',()=>{
    const onOpeningSnapshotChange=vi.fn();
    setup({onOpeningSnapshotChange,liabilities:[{id:'debt',kind:'loan',openingBalance:0}],properties:[]});
    fireEvent.click(screen.getAllByRole('button',{name:'Capture opening values'})[0]);
    expect(onOpeningSnapshotChange).toHaveBeenCalledWith(expect.objectContaining({measurement:'assetOnly',accounts:[{accountId:'a',balance:0}],liabilities:[{liabilityId:'debt',balance:0}]}));
  });
  it('supports keyboard focused account edits without mutating input config',()=>{
    const before=JSON.stringify(netWorth);
    setup();
    screen.getAllByLabelText('Account name')[0].focus();
    expect(document.activeElement).toBe(screen.getAllByLabelText('Account name')[0]);
    expect(JSON.stringify(netWorth)).toBe(before);
  });
  it('edits dated observed debt including zero and preserves sibling observations',()=>{
    const snapshot={date:'2026-10-14',measurement:'assetsMinusLiabilities' as const,accounts:[{accountId:'a',balance:77}],liabilities:[{liabilityId:'debt',balance:500}],properties:[{propertyId:'home',value:900,debtBalance:300}]};
    const onOpeningSnapshotChange=vi.fn();
    setup({netWorth:{...netWorth,openingSnapshot:snapshot},liabilities:[{id:'debt',kind:'loan',openingBalance:800}] ,onOpeningSnapshotChange});
    fireEvent.change(screen.getByLabelText('Observed balance for debt'),{target:{value:'0'}});
    expect(onOpeningSnapshotChange).toHaveBeenCalledWith({...snapshot,liabilities:[{liabilityId:'debt',balance:0}]});
    expect(onOpeningSnapshotChange.mock.calls[0][0].accounts).toEqual(snapshot.accounts);
    expect(onOpeningSnapshotChange.mock.calls[0][0].properties).toEqual(snapshot.properties);
    expect(screen.getByText(/takes precedence, including \$0/i)).toBeInTheDocument();
  });
  it('adds, edits and removes canonical liability references through optional callbacks',()=>{
    const onAddLiability=vi.fn(),onUpdateLiability=vi.fn(),onRemoveLiability=vi.fn();
    setup({liabilities:[{id:'debt',kind:'loan',openingBalance:90}],onAddLiability,onUpdateLiability,onRemoveLiability});
    fireEvent.change(screen.getByLabelText('Configured opening debt ($)'),{target:{value:'120'}});
    expect(onUpdateLiability).toHaveBeenCalledWith(expect.objectContaining({id:'debt',openingBalance:120}));
    fireEvent.click(screen.getByRole('button',{name:'＋ Add liability'}));
    expect(onAddLiability).toHaveBeenCalledWith(expect.objectContaining({kind:'loan',openingBalance:0}));
    fireEvent.click(screen.getByRole('button',{name:'Remove liability'}));
    expect(onRemoveLiability).toHaveBeenCalledWith('debt');
  });
  it('reorders through one immutable whole-list callback with exact display orders and no lost account',()=>{
    const onReorderAccounts=vi.fn();
    const a=createDefaultAccount({id:'a',label:'Alpha',openingBalance:11,displayOrder:0});
    const b=createDefaultAccount({id:'b',label:'Bravo',openingBalance:22,displayOrder:1});
    const c=createDefaultAccount({id:'c',label:'Charlie',openingBalance:33,displayOrder:2});
    setup({netWorth:{accounts:[a,b,c],asOfDate:'2026-10-14',openingSnapshot:{date:'2026-10-14',measurement:'assetOnly',accounts:[],liabilities:[]}},onReorderAccounts});
    fireEvent.click(screen.getByRole('button',{name:'Move Alpha down'}));
    expect(onReorderAccounts).toHaveBeenCalledTimes(1);
    const next=(onReorderAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0] as AccountDefinition[];
    expect(next.map(item=>item.id)).toEqual(['b','a','c']);
    expect(next.map(item=>item.displayOrder)).toEqual([0,1,2]);
    expect(new Set(next.map(item=>item.id)).size).toBe(3);
    expect(next.find(item=>item.id==='a')?.openingBalance).toBe(11);
    expect(next.find(item=>item.id==='b')?.openingBalance).toBe(22);
    expect(next.find(item=>item.id==='c')?.openingBalance).toBe(33);
    expect(next.find(item=>item.id==='a')).not.toBe(a);
  });
});
