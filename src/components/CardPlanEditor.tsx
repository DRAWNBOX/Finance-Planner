import type { AccountDefinition, CardPlan, DateMarker, FundingPolicy, LiabilityDefinition } from '../types';
import { createDefaultOrdinaryCardSchedule, createDefaultZeroInterestCardPlan } from '../defaultScenario';
import { FundingPolicyEditor } from './FundingPolicyEditor';
import './CardPlanEditor.css';

export interface CardPlanEditorProps {
  plan: CardPlan | null;
  accounts: AccountDefinition[];
  liabilities: LiabilityDefinition[];
  markers?: DateMarker[];
  onChange: (plan: CardPlan) => void;
  onCancel?: () => void;
  referenceDate?: Date;
}

export function CardPlanEditor({ plan, accounts, liabilities, markers = [], onChange, onCancel, referenceDate }: CardPlanEditorProps) {
  const change = (next: CardPlan) => onChange(next);
  const create = (kind: CardPlan['kind']) => {
    if (!referenceDate) return;
    change(kind === 'expectedPayment' ? createDefaultOrdinaryCardSchedule(referenceDate) : createDefaultZeroInterestCardPlan(referenceDate));
  };
  if (!plan) return <section className="card-plan-editor" aria-labelledby="card-plan-title">
    <header className="card-plan-header"><div><p className="card-plan-eyebrow">Card plan</p><h2 id="card-plan-title">Choose a card type</h2><p>Pick the model that matches what you want to plan. You can edit its details next.</p></div></header>
    <div className="card-plan-choices">
      <button type="button" disabled={!referenceDate} onClick={() => create('expectedPayment')}><span className="card-plan-choice-mark">01</span><strong>Expected card payment</strong><span>Plan a monthly expense. It does not create or reduce card debt.</span></button>
      <button type="button" disabled={!referenceDate} onClick={() => create('zeroInterestPayoff')}><span className="card-plan-choice-mark">02</span><strong>Permanent 0% payoff</strong><span>Plan payments against an identified, interest-free card liability.</span></button>
    </div>
    {!referenceDate && <p className="card-plan-note">A reference date is needed before a new plan can be created.</p>}
  </section>;

  const ordinary = plan.kind === 'expectedPayment';
  const update = (fields: Partial<CardPlan>) => change({ ...plan, ...fields } as CardPlan);
  const dateField = (label: string, value: string, markerId: string | null | undefined, dateKey: 'startYearMonth' | 'endYearMonth' | 'targetYearMonth', markerKey: 'startMarkerId' | 'endMarkerId') => <div className="card-plan-date">
    <label>{label}<input type="month" value={month(value)} onChange={e => update({ [dateKey]: e.target.value, [markerKey]: null })} /></label>
    {markers.length > 0 && <label>{label} marker<select value={markerId ?? ''} onChange={e => {
      const marker = markers.find(item => item.id === e.target.value);
      const markerMonth = month(marker?.date);
      if (marker && markerMonth) update({ [markerKey]: marker.id, [dateKey]: markerMonth });
      else update({ [markerKey]: null });
    }}><option value="">Use date</option>{markers.map(marker => <option key={marker.id} value={marker.id}>{marker.label}</option>)}</select></label>}
  </div>;
  const funding = (title: string, policy: FundingPolicy | undefined, commit: (value: FundingPolicy) => void) => <div className="card-plan-funding"><h3>{title}</h3><FundingPolicyEditor policy={policy ?? { primaryAccountId: null, fallbackAccountIds: [] }} accounts={accounts} mode="override" onChange={commit} /></div>;
  const month = (date: string | undefined) => {
    const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(date ?? '');
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return '';
    if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 31)) return '';
    return `${match[1]}-${match[2]}`;
  };
  const startMonth = month(plan.startYearMonth);
  const endMonth = month(ordinary ? plan.endYearMonth : plan.targetYearMonth);
  const dayInvalid = !Number.isInteger(plan.paymentDay) || plan.paymentDay < 1 || plan.paymentDay > 31;
  const dateInvalid = !startMonth || !endMonth || startMonth > endMonth;

  return <section className="card-plan-editor" aria-labelledby="card-plan-title">
    <header className="card-plan-header"><div><p className="card-plan-eyebrow">{ordinary ? 'Expected payment · no debt modeled' : 'Permanent 0% · liability payoff'}</p><h2 id="card-plan-title">{plan.label || 'Untitled card plan'}</h2><p>{ordinary ? 'A scheduled expense, whether or not a card balance exists. APR, new charges, and debt payoff are not part of this plan.' : 'Opening debt is linked to a liability. Funded payments reduce that debt; any remaining amount is paid once on the payoff date.'}</p></div><label className="card-plan-enabled"><input type="checkbox" checked={plan.enabled} onChange={e => update({ enabled: e.target.checked })} /> Plan is active</label></header>
    <div className="card-plan-fields">
      <label>Plan name<input type="text" value={plan.label} onChange={e => update({ label: e.target.value })} /></label>
      <label>Payment day<input aria-invalid={dayInvalid} type="number" min="1" max="31" value={plan.paymentDay} onChange={e => update({ paymentDay: e.target.value === '' ? 0 : Number(e.target.value) })} /><small>Months without this day use their final calendar day.</small>{dayInvalid && <span className="card-plan-error" role="alert">Enter a day from 1 to 31.</span>}</label>
      {ordinary ? <>
        <label>Expected monthly payment ($)<input type="number" min="0" step="0.01" value={plan.amount} onChange={e => update({ amount: e.target.value === '' ? 0 : Number(e.target.value) })} /></label>
        {dateField('First payment month', plan.startYearMonth, plan.startMarkerId, 'startYearMonth', 'startMarkerId')}
        {dateField('Last payment month (inclusive)', plan.endYearMonth, plan.endMarkerId, 'endYearMonth', 'endMarkerId')}
        <p className="card-plan-note">The default schedule spans twelve monthly payments. Changing the first month does not silently move a manually chosen end date.</p>
        {funding('Payment funding', plan.funding, funding => update({ funding }))}
      </> : <>
        <label>Linked liability<select value={plan.liabilityId} onChange={e => {
          const liability = liabilities.find(item => item.id === e.target.value);
          update({ liabilityId: e.target.value, ...(liability ? { initialBalance: liability.openingBalance } : {}) });
        }}><option value="">Choose a liability</option>{liabilities.filter(item => item.kind === 'zeroInterestCard').map(item => <option key={item.id} value={item.id}>{item.label || item.id}</option>)}</select><small>Debt is counted from the linked liability, not as a second card balance.</small></label>
        {(() => { const liability = liabilities.find(item => item.id === plan.liabilityId); return liability ? <label>Linked opening debt ($)<input type="number" readOnly value={liability.openingBalance} /><small>Set the authoritative opening debt on the linked liability.</small></label> : <p className="card-plan-error" role="alert">Choose an available 0% card liability. The plan’s saved opening amount is not used as a substitute.</p>; })()}
        {dateField('Payment start month', plan.startYearMonth, plan.startMarkerId, 'startYearMonth', 'startMarkerId')}
        {dateField('Target payoff month (inclusive)', plan.targetYearMonth, plan.endMarkerId, 'targetYearMonth', 'endMarkerId')}
        {funding('Regular payment funding', plan.funding, funding => update({ funding }))}
        {funding('Residual payoff funding', plan.payoffFunding ?? plan.funding, payoffFunding => update({ payoffFunding }))}
        <label>Residual payoff month<input type="month" value={plan.payoffYearMonth ?? plan.targetYearMonth} onChange={e => update({ payoffYearMonth: e.target.value || null })} /><small>Defaults to the target payoff month.</small></label>
        <p className="card-plan-note">The residual payoff is a one-time request for any debt left after regular payments. This editor does not estimate payment amounts or simulate balances.</p>
      </>}
      {dateInvalid && <p className="card-plan-error" role="alert">{!startMonth || !endMonth ? 'Enter valid start and end months.' : 'The end month must be the same as or later than the start month.'}</p>}
    </div>
    <footer className="card-plan-footer"><span>{ordinary ? 'Expected expense' : '0% debt payoff'}</span>{onCancel && <button type="button" className="card-plan-cancel" onClick={onCancel}>Done</button>}</footer>
  </section>;
}

export default CardPlanEditor;
