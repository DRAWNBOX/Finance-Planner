import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccountDefinition, LargePurchase, LongTermPurchase } from '../types';
import { PurchaseEditor } from './PurchaseEditor';

const accounts = [{ id:'cash', label:'Cash', accountType:'checking', openingBalance:0, annualReturnRate:0, retirementAnnualReturnRate:null, displayOrder:0, withdrawalPolicy:{allowAutomaticFallback:true,withdrawalTaxRate:0,penaltyRate:0} }] as AccountDefinition[];
const large: LargePurchase = { id:'p1', label:'Repair', enabled:true, showOnGraph:true, flagColor:'gold', yearMonth:'2031-01', yearMonthMarkerId:'missing-date', age:0, amount:0, fundingSource:'account:missing-cash', categoryId:null };
const recurring: LongTermPurchase = { id:'p2', label:'Tuition', enabled:true, showOnGraph:false, startYearMonth:'2031-01', endMode:'endDate', durationMonths:0, endYearMonth:'2031-12', startMarkerId:null, endMarkerId:'end-marker', monthlyAmount:0, fundingSource:'account:missing-cash' };

describe('PurchaseEditor', () => {
  it('keeps zero/null and unrelated data on a one-time date edit; preserves missing funding references', () => {
    const onChange = vi.fn();
    render(<PurchaseEditor purchase={large} accounts={accounts} onChange={onChange} />);
    expect(screen.getByRole('option', { name:/Unavailable account \(missing-cash\)/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Purchase month'), { target:{ value:'2032-06' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ yearMonth:'2032-06', amount:0, categoryId:null, yearMonthMarkerId:'missing-date', flagColor:'gold' }));
    expect(screen.getByText(/No projected or hypothetical balance is shown/i)).toBeInTheDocument();
  });
  it('uses monthly amount and inclusive end-date controls for recurring purchases', () => {
    const onChange = vi.fn();
    render(<PurchaseEditor purchase={recurring} accounts={accounts} onChange={onChange} />);
    expect(screen.getByLabelText('Monthly amount')).toHaveValue(0);
    expect(screen.getByLabelText('First month')).toHaveValue('2031-01');
    expect(screen.getByLabelText('Last month (inclusive)')).toHaveValue('2031-12');
    fireEvent.change(screen.getByLabelText('Last month (inclusive)'), { target:{ value:'2032-01' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ endYearMonth:'2032-01', monthlyAmount:0, endMarkerId:'end-marker' }));
  });
});
