import { useId } from 'react';
import type { AccountDefinition, LiabilityDefinition, Loan } from '../types';
import { FundingPolicyEditor } from './FundingPolicyEditor';
import './LoanEditor.css';

export interface LoanEditorProps {
  loan: Loan;
  accounts: AccountDefinition[];
  dateMarkers?: Array<{ id: string; label: string; yearMonth?: string }>;
  onChange: (loan: Loan) => void;
  liability?: LiabilityDefinition | null;
  observedOpeningBalance?: number;
  onChangeLiability?: (liability: LiabilityDefinition) => void;
  onCreateLiability?: () => void;
}

export function LoanEditor({ loan, accounts, dateMarkers = [], onChange, liability = null, observedOpeningBalance, onChangeLiability, onCreateLiability }: LoanEditorProps) {
  const id = useId();
  const sourceId = (source: Loan['paymentSource'] | Loan['paymentSourceAccount']) =>
    source === 'income' ? null : typeof source === 'string' && source.startsWith('account:') ? source.slice(8) : source;
  const fromSource = (accountId: string | null): Loan['paymentSource'] => accountId ? `account:${accountId}` : 'income';
  const policy = {
    primaryAccountId: sourceId(loan.paymentSource ?? loan.paymentSourceAccount) ?? null,
    fallbackAccountIds: [] as string[], purpose: 'loan payment'
  };
  const downPaymentPolicy = { ...policy, primaryAccountId: sourceId(loan.downPaymentSource ?? loan.paymentSource ?? loan.paymentSourceAccount) ?? null, purpose: 'down payment' };
  const field = (name: string, label: string, value: number, step = '0.01') => <label className="finance-field" htmlFor={`${id}-${name}`} key={name}>{label}<input id={`${id}-${name}`} type="number" min="0" step={step} value={value} onChange={e => onChange({ ...loan, [name]: e.currentTarget.value === '' ? 0 : Number(e.currentTarget.value) })} /></label>;
  return <section className="loan-editor" aria-labelledby={`${id}-title`}>
    <header><div><p className="editor-kicker">Debt contract</p><h2 id={`${id}-title`}>{loan.label || 'Loan details'}</h2></div><p>Set the terms and payment sources. This editor does not estimate a balance or payment outcome.</p></header>
    <div className="editor-grid">
      <label className="finance-field" htmlFor={`${id}-label`}>Loan name<input id={`${id}-label`} value={loan.label} onChange={e => onChange({ ...loan, label: e.currentTarget.value })} /></label>
      <label className="finance-field" htmlFor={`${id}-start`}>Contract starts<input id={`${id}-start`} type="month" value={loan.startYearMonth} onChange={e => onChange({ ...loan, startYearMonth: e.currentTarget.value })} /></label>
      {dateMarkers.length > 0 && <label className="finance-field" htmlFor={`${id}-marker`}>Link start to a date marker<select id={`${id}-marker`} value={loan.startMarkerId ?? ''} onChange={e => onChange({ ...loan, startMarkerId: e.currentTarget.value || null })}><option value="">No linked marker</option>{dateMarkers.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>}
      {liability ? <label className="finance-field" htmlFor={`${id}-liability`}>Configured opening debt ($)<input id={`${id}-liability`} type="number" min="0" step="0.01" value={liability.openingBalance} onChange={e=>onChangeLiability?.({...liability,openingBalance:e.currentTarget.value===''?0:Number(e.currentTarget.value)})}/>{observedOpeningBalance!==undefined&&<small>Observed snapshot balance: ${observedOpeningBalance.toLocaleString()}. This observed value takes precedence, including $0.</small>}</label> : <div className="liability-missing" role="status"><strong>No linked liability configured</strong><p>This contract’s legacy balance is not used as opening debt. Create or link a canonical liability to configure debt.</p>{onCreateLiability&&<button type="button" onClick={onCreateLiability}>Create liability</button>}</div>}
      {liability && <>
        <label className="finance-field" htmlFor={`${id}-final-month`}>Contractual final payment month<input id={`${id}-final-month`} type="month" value={liability.endYearMonth ?? ''} onChange={e=>onChangeLiability?.({...liability,endYearMonth:e.currentTarget.value || null})}/><small>Leave blank for no scheduled final month; the configured minimum payment governs.</small></label>
        <label className="finance-field" htmlFor={`${id}-payment-day`}>Payment day<input id={`${id}-payment-day`} type="number" min="1" max="31" step="1" value={liability.paymentDay ?? ''} aria-describedby={`${id}-payment-day-help${liability.paymentDay !== undefined && (liability.paymentDay < 1 || liability.paymentDay > 31) ? ` ${id}-payment-day-error` : ''}`} aria-invalid={liability.paymentDay !== undefined && (liability.paymentDay < 1 || liability.paymentDay > 31)} onChange={e=>{const value=e.currentTarget.value;onChangeLiability?.({...liability,paymentDay:value===''?undefined:Number(value)})}}/><small id={`${id}-payment-day-help`}>Days beyond a month’s last day are clamped to that month’s final day.</small>{liability.paymentDay !== undefined && (liability.paymentDay < 1 || liability.paymentDay > 31) && <small id={`${id}-payment-day-error`} role="alert">Enter a payment day from 1 to 31.</small>}</label>
      </>}
      <label className="finance-field" htmlFor={`${id}-apr`}>Annual interest rate (%)<input id={`${id}-apr`} type="number" min="0" step="0.01" value={loan.annualInterestRate} onChange={e => onChange({ ...loan, annualInterestRate: e.currentTarget.value === '' ? 0 : Number(e.currentTarget.value) })} /></label>
      {field('minimumMonthlyPayment', 'Minimum monthly payment', loan.minimumMonthlyPayment)}{field('extraMonthlyPayment', 'Extra monthly payment', loan.extraMonthlyPayment)}
      {field('downPayment', 'Down payment', loan.downPayment)}
      <label className="finance-check"><input type="checkbox" checked={loan.enabled} onChange={e => onChange({ ...loan, enabled: e.currentTarget.checked })} /> Include this loan</label>
      <label className="finance-check"><input type="checkbox" checked={loan.showOnGraph} onChange={e => onChange({ ...loan, showOnGraph: e.currentTarget.checked })} /> Show on graph</label>
    </div>
    <p className="editor-note">Interest accrues monthly. Funded payments are applied to interest first, then principal; any unpaid amount remains due. No balance preview is calculated here.</p>
    <FundingPolicyEditor policy={policy} accounts={accounts} mode="override" onChange={next => onChange({ ...loan, paymentSource: fromSource(next.primaryAccountId), paymentSourceAccount: next.primaryAccountId ?? 'income' })} />
    <FundingPolicyEditor policy={downPaymentPolicy} accounts={accounts} mode="override" onChange={next => onChange({ ...loan, downPaymentSource: fromSource(next.primaryAccountId) })} />
  </section>;
}
