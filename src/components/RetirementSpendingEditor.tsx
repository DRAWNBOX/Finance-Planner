import { useId, useState } from 'react';
import type { AccountDefinition, FundingPolicy, RetirementWithdrawalSourceLine, WithdrawalPlan } from '../types';
import { createDefaultRetirementWithdrawalSource } from '../defaultScenario';
import { FundingPolicyEditor } from './FundingPolicyEditor';
import './RetirementSpendingEditor.css';

export interface RetirementSpendingEditorProps {
  plan: WithdrawalPlan;
  accounts: AccountDefinition[];
  /** Calendar date supplied by the parent; this component never reads the clock. */
  referenceDate: Date;
  onChange: (plan: WithdrawalPlan) => void;
}

const accountName = (id: string, accounts: AccountDefinition[]) => id ? accounts.find((account) => account.id === id)?.label ?? `Unavailable account (${id})` : 'Choose account';
const orderedPolicy = (ids: string[]): FundingPolicy => ({ primaryAccountId: ids[0] ?? null, fallbackAccountIds: ids.slice(1) });
const policyIds = (policy: FundingPolicy) => [...(policy.primaryAccountId ? [policy.primaryAccountId] : []), ...policy.fallbackAccountIds];

export const RetirementSpendingEditor = ({ plan, accounts, referenceDate, onChange }: RetirementSpendingEditorProps) => {
  const uid = useId();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const lines = plan.sourceLines ?? [];
  const updateLine = (index: number, changes: Partial<RetirementWithdrawalSourceLine>) => {
    const next = [...lines];
    next[index] = { ...next[index], ...changes };
    onChange({ ...plan, sourceLines: next });
  };
  const addSource = () => onChange({ ...plan, sourceLines: [...lines, createDefaultRetirementWithdrawalSource(referenceDate)] });
  const removeSource = (index: number) => onChange({ ...plan, sourceLines: lines.filter((_, i) => i !== index) });
  const updateFallback = (ids: string[]) => onChange({ ...plan, fallbackAccountIds: ids });
  const boundedNumber = (key: string, raw: string, min: number, max: number, commit: (value: number) => void) => {
    setDrafts((old) => ({ ...old, [key]: raw }));
    const n = Number(raw);
    if (raw !== '' && Number.isFinite(n) && n >= min && n <= max) { commit(n); setDrafts((old) => { const next = { ...old }; delete next[key]; return next; }); }
  };

  return <section className="retirement-spending" aria-labelledby={`ret-spending-title-${uid}`}>
    <header className="retirement-spending__header">
      <div><p className="retirement-spending__eyebrow">RETIREMENT · SPENDING</p><h2 id={`ret-spending-title-${uid}`}>Plan account withdrawals</h2>
        <p>These withdrawals add to planned living spending. They are not income or transfers between accounts.</p></div>
      <span className="retirement-spending__badge">Account-based</span>
    </header>
    <div className="retirement-spending__notice"><strong>Balance date matters.</strong> Each percentage uses that account’s balance on its own selected valuation date. If left blank, it uses that source’s first withdrawal date. Numeric previews arrive in a later phase.</div>
    <div className="retirement-spending__list">
      {lines.map((line, index) => {
        const key = `${uid}-${line.id}`;
        const known = accounts.some((account) => account.id === line.accountId);
        return <article className="retirement-source" key={line.id}>
          <div className="retirement-source__top"><span className="retirement-source__number">{String(index + 1).padStart(2, '0')}</span><div className="retirement-source__heading"><h3>{line.label || accountName(line.accountId, accounts)}</h3><span>{line.enabled ? 'Included' : 'Paused'}</span></div>
            <label className="retirement-source__toggle"><input type="checkbox" checked={line.enabled} onChange={(e) => updateLine(index, { enabled: e.target.checked })}/><span>Include</span></label>
            <button className="retirement-source__remove" type="button" onClick={() => removeSource(index)} aria-label={`Remove withdrawal source ${index + 1}`}>Remove</button>
          </div>
          <div className="retirement-source__grid">
            <label className="retirement-field retirement-field--wide"><span>Withdraw from account</span><select value={line.accountId} onChange={(e) => updateLine(index, { accountId: e.target.value })}>
              {!line.accountId && <option value="">Choose account</option>}{line.accountId && !known && <option value={line.accountId}>{accountName(line.accountId, accounts)} · unavailable</option>}{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>{line.accountId && !known && <small role="status">This account is unavailable. It remains selected until you choose another.</small>}</label>
            <label className="retirement-field"><span>Withdrawal method</span><select value={line.mode} onChange={(e) => updateLine(index, { mode: e.target.value as RetirementWithdrawalSourceLine['mode'] })}><option value="percentOfInitialBalance">Percent of initial balance</option><option value="amount">Fixed amount</option></select></label>
            {line.mode === 'percentOfInitialBalance' ? <label className="retirement-field"><span>Rate</span><span className="retirement-input-suffix"><input aria-label="Withdrawal rate" type="number" min="0" max="100" step="0.1" value={drafts[`${key}-rate`] ?? line.initialWithdrawalRatePercent ?? 4} aria-invalid={!!drafts[`${key}-rate`]} aria-describedby={`${key}-rate-error`} onChange={(e) => boundedNumber(`${key}-rate`, e.target.value, 0, 100, (value) => updateLine(index, { initialWithdrawalRatePercent: value }))}/><b>%</b></span>{drafts[`${key}-rate`] ? <small className="retirement-error" id={`${key}-rate-error`} role="alert">Enter a rate from 0 to 100. The last valid value is kept.</small> : <small>New sources start at 4%; 0% is valid.</small>}</label> : <label className="retirement-field"><span>Annual amount</span><span className="retirement-input-prefix"><b>$</b><input type="number" min="0" step="100" value={line.amount} onChange={(e) => updateLine(index, { amount: e.target.value === '' ? 0 : Number(e.target.value) })}/></span></label>}
            <label className="retirement-field"><span>First withdrawal date</span><input type="date" value={line.firstWithdrawalDate} onChange={(e) => updateLine(index, { firstWithdrawalDate: e.target.value, ...((line.initialWithdrawalValuationDate == null || line.initialWithdrawalValuationDate === line.firstWithdrawalDate) ? { initialWithdrawalValuationDate: e.target.value || null } : {}) })}/></label>
            <label className="retirement-field"><span>Balance valuation date <em>Optional</em></span><input type="date" value={line.initialWithdrawalValuationDate ?? ''} onChange={(e) => updateLine(index, { initialWithdrawalValuationDate: e.target.value || null })}/><small>Blank uses this source’s first withdrawal date.</small></label>
            <label className="retirement-field"><span>Payment day</span><input type="number" min="1" max="31" step="1" value={drafts[`${key}-day`] ?? line.paymentDay ?? 1} aria-invalid={!!drafts[`${key}-day`]} aria-describedby={`${key}-day-error`} onChange={(e) => boundedNumber(`${key}-day`, e.target.value, 1, 31, (value) => updateLine(index, { paymentDay: value }))}/>{drafts[`${key}-day`] && <small className="retirement-error" id={`${key}-day-error`} role="alert">Enter a day from 1 to 31. The last valid value is kept.</small>}</label>
          </div>
          <details className="retirement-source__advanced"><summary>Source-specific fallback order</summary><FundingPolicyEditor policy={orderedPolicy(line.fallbackAccountIds ?? [])} accounts={accounts} mode="override" onChange={(policy) => updateLine(index, { fallbackAccountIds: policyIds(policy) })}/></details>
        </article>;
      })}
      {!lines.length && <div className="retirement-spending__empty"><span aria-hidden="true">↗</span><h3>No withdrawal sources yet</h3><p>Add an account to begin planning additional retirement spending.</p></div>}
    </div>
    <details className="retirement-source retirement-plan-limits"><summary>Plan withdrawal limits and inflation</summary><div className="retirement-source__grid retirement-source__grid--limits">
      <label className="retirement-field"><span>Minimum yearly withdrawal</span><input type="number" min="0" step="100" value={plan.minimumYearlyWithdrawal} onChange={(e) => onChange({ ...plan, minimumYearlyWithdrawal: Number(e.target.value) || 0 })}/></label>
      <label className="retirement-field"><span>Maximum yearly withdrawal</span><input type="number" min="0" step="100" value={plan.maximumYearlyWithdrawal} onChange={(e) => onChange({ ...plan, maximumYearlyWithdrawal: Number(e.target.value) || 0 })}/></label>
      <p>Inflation adjustment follows the plan’s existing inflation setting.</p>
    </div></details>
    <button type="button" className="retirement-spending__add" onClick={addSource}><span aria-hidden="true">＋</span> Add withdrawal source</button>
    <FundingPolicyEditor policy={orderedPolicy(plan.fallbackAccountIds ?? [])} accounts={accounts} mode="override" onChange={(policy) => updateFallback(policyIds(policy))}/>
  </section>;
};
