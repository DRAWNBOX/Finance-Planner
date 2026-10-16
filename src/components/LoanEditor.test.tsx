import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountDefinition, LiabilityDefinition, Loan } from '../types';
import { LoanEditor } from './LoanEditor';

const loan: Loan = { id:'loan-1', label:'Car note', enabled:true, showOnGraph:false, flagColor:'#abc', startYearMonth:'2030-04', startMarkerId:'gone-marker', originalAmount:12000, downPayment:0, currentBalance:0, annualInterestRate:0, minimumMonthlyPayment:0, extraMonthlyPayment:0, paymentSourceAccount:'missing-account', paymentSource:'account:missing-account' };
const accounts = [{ id:'cash', label:'Cash', accountType:'checking', openingBalance:0, annualReturnRate:0, retirementAnnualReturnRate:null, displayOrder:0, withdrawalPolicy:{allowAutomaticFallback:true,withdrawalTaxRate:0,penaltyRate:0} }] as AccountDefinition[];
afterEach(cleanup);

describe('LoanEditor', () => {
  it('edits canonical linked debt without changing the legacy loan scalar', () => {
    const onChange = vi.fn();
    const onChangeLiability=vi.fn();
    const liability:LiabilityDefinition={id:'liability-1',kind:'loan',sourceConfigId:loan.id,openingBalance:8000,annualInterestRate:3};
    render(<LoanEditor loan={loan} accounts={accounts} liability={liability} observedOpeningBalance={0} onChange={onChange} onChangeLiability={onChangeLiability} />);
    expect(screen.getAllByRole('option', { name:/Unavailable account \(missing-account\)/ })).toHaveLength(2);
    const editor=screen.getByRole('region',{name:'Car note'});
    expect(within(editor).queryByLabelText(/Original principal|Current balance|Opening balance/i)).not.toBeInTheDocument();
    expect(within(editor).getByLabelText(/Configured opening debt/)).toHaveValue(8000);
    expect(screen.getByText(/observed snapshot balance: \$0.*takes precedence/i)).toBeInTheDocument();
    fireEvent.change(within(editor).getByLabelText(/Configured opening debt/), { target:{ value:'25' } });
    expect(onChangeLiability).toHaveBeenCalledWith(expect.objectContaining({openingBalance:25,id:'liability-1'}));
    expect(onChangeLiability).toHaveBeenCalledWith({...liability,openingBalance:25});
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Contract starts'), { target:{ value:'2031-02' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ startYearMonth:'2031-02', flagColor:'#abc' }));
  });
  it('does not present legacy current balance as authoritative when no liability exists',()=>{
    const onChange=vi.fn(),onCreateLiability=vi.fn();
    render(<LoanEditor loan={{...loan,currentBalance:9000}} accounts={accounts} onChange={onChange} onCreateLiability={onCreateLiability}/>);
    expect(screen.queryByLabelText('Opening liability')).not.toBeInTheDocument();
    expect(screen.getByText(/legacy balance is not used/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Create liability'}));
    expect(onCreateLiability).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('preserves legacy loan contract fields on edits',()=>{
    const onChange=vi.fn();render(<LoanEditor loan={loan} accounts={accounts} onChange={onChange}/>);
    fireEvent.change(screen.getAllByLabelText('Contract starts')[0],{target:{value:'2031-02'}});
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({startYearMonth:'2031-02',originalAmount:12000,currentBalance:0,downPayment:0,minimumMonthlyPayment:0,extraMonthlyPayment:0,flagColor:'#abc'}));
  });
  it('shows the minimum floor and interest-first contract explanation without a preview', () => {
    render(<LoanEditor loan={loan} accounts={accounts} onChange={vi.fn()} />);
    expect(screen.getAllByLabelText('Minimum monthly payment')[0]).toHaveValue(0);
    expect(screen.getAllByText(/applied to interest first, then principal/i)).toHaveLength(1);
    expect(screen.queryByText(/projected balance|estimated payment/i)).not.toBeInTheDocument();
  });
  it('edits canonical final month and payment day while preserving unrelated liability fields',()=>{
    const onChangeLiability=vi.fn();
    const liability:LiabilityDefinition={id:'liability-1',kind:'loan',sourceConfigId:loan.id,openingBalance:8000,annualInterestRate:3,endYearMonth:'2035-06',paymentDay:15,linkedPropertyId:'property-1'};
    render(<LoanEditor loan={loan} accounts={accounts} liability={liability} onChange={vi.fn()} onChangeLiability={onChangeLiability}/>);
    fireEvent.change(screen.getByLabelText(/Contractual final payment month/),{target:{value:'2038-11'}});
    expect(onChangeLiability).toHaveBeenLastCalledWith({...liability,endYearMonth:'2038-11'});
    fireEvent.change(screen.getByLabelText(/Payment day/),{target:{value:'31'}});
    expect(onChangeLiability).toHaveBeenLastCalledWith({...liability,paymentDay:31});
    expect(screen.getByText(/clamped to that month’s final day/i)).toBeInTheDocument();
  });
  it('writes an explicit blank final month as null and accepts the first payment day',()=>{
    const onChangeLiability=vi.fn();
    const liability:LiabilityDefinition={id:'liability-1',kind:'loan',openingBalance:100,endYearMonth:'2030-01',paymentDay:31};
    render(<LoanEditor loan={loan} accounts={accounts} liability={liability} onChange={vi.fn()} onChangeLiability={onChangeLiability}/>);
    fireEvent.change(screen.getByLabelText(/Contractual final payment month/),{target:{value:''}});
    expect(onChangeLiability).toHaveBeenLastCalledWith({...liability,endYearMonth:null});
    fireEvent.change(screen.getByLabelText(/Payment day/),{target:{value:'1'}});
    expect(onChangeLiability).toHaveBeenLastCalledWith({...liability,paymentDay:1});
    expect(screen.getByText(/minimum payment governs/i)).toBeInTheDocument();
  });
  it('flags an invalid negative payment day and does not fabricate term controls without a liability',()=>{
    const liability:LiabilityDefinition={id:'liability-1',kind:'loan',openingBalance:100,paymentDay:-2};
    const {rerender}=render(<LoanEditor loan={loan} accounts={accounts} liability={liability} onChange={vi.fn()} onChangeLiability={vi.fn()}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a payment day from 1 to 31.');
    rerender(<LoanEditor loan={loan} accounts={accounts} onChange={vi.fn()}/>);
    expect(screen.queryByLabelText('Contractual final payment month')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Payment day')).not.toBeInTheDocument();
  });
});
