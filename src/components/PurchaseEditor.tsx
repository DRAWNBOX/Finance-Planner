import { useId } from 'react';
import type { AccountDefinition, FundingPolicy, LargePurchase, LongTermPurchase } from '../types';
import { FundingPolicyEditor } from './FundingPolicyEditor';
import './PurchaseEditor.css';

type Purchase = LargePurchase | LongTermPurchase;
export interface PurchaseEditorProps {
  purchase: Purchase;
  accounts: AccountDefinition[];
  categories?: Array<{ id: string; label: string }>;
  onChange: (purchase: Purchase) => void;
}
export function PurchaseEditor({ purchase, accounts, categories = [], onChange }: PurchaseEditorProps) {
  const id = useId();
  const recurring = 'monthlyAmount' in purchase;
  const lines = purchase.sourceLines ?? [];
  const primary = lines.find(line => line.enabled !== false)?.accountId ?? (purchase.fundingSource?.startsWith('account:') ? purchase.fundingSource.slice(8) : null);
  const policy: FundingPolicy = { primaryAccountId: primary ?? null, fallbackAccountIds: lines.filter(line => line.enabled !== false && line.accountId !== primary).map(line => line.accountId).filter((accountId): accountId is string => Boolean(accountId)), purpose: 'purchase' };
  const amountName = recurring ? 'monthlyAmount' : 'amount';
  const numeric = (name: string, label: string, value: number, step = '0.01') => <label className="finance-field" htmlFor={`${id}-${name}`}>{label}<input id={`${id}-${name}`} type="number" min="0" step={step} value={value} onChange={e => onChange({ ...purchase, [name]: e.currentTarget.value === '' ? 0 : Number(e.currentTarget.value) } as Purchase)} /></label>;
  const updatePolicy = (next: FundingPolicy) => {
    const ids = [...(next.primaryAccountId ? [next.primaryAccountId] : []), ...next.fallbackAccountIds];
    const sourceLines = ids.map((accountId, index) => ({ ...(lines.find(line => line.accountId === accountId) ?? { id: `${purchase.id}-fund-${accountId}`, sourceType: 'account' as const, sourceId: accountId, mode: 'amount' as const, amount: 0 }), enabled: true, accountId, sourceId: accountId, sourceType: 'account' as const, mode: 'amount' as const, amount: index === 0 ? (recurring ? purchase.monthlyAmount : purchase.amount) : 0 }));
    onChange({ ...purchase, sourceLines, fundingSource: next.primaryAccountId ? `account:${next.primaryAccountId}` : undefined } as Purchase);
  };
  return <section className="purchase-editor" aria-labelledby={`${id}-title`}>
    <header><div><p className="editor-kicker">Spending plan · {recurring ? 'ongoing' : 'one-time'}</p><h2 id={`${id}-title`}>{purchase.label || 'Purchase details'}</h2></div><p>{recurring ? 'Choose the inclusive monthly schedule and funding order.' : 'Choose a date, amount and funding order.'} No projected or hypothetical balance is shown.</p></header>
    <div className="editor-grid">
      <label className="finance-field" htmlFor={`${id}-label`}>Name<input id={`${id}-label`} value={purchase.label} onChange={e => onChange({ ...purchase, label: e.currentTarget.value } as Purchase)} /></label>
      {recurring ? <>
        <label className="finance-field" htmlFor={`${id}-start`}>First month<input id={`${id}-start`} type="month" value={purchase.startYearMonth} onChange={e => onChange({ ...purchase, startYearMonth: e.currentTarget.value })} /></label>
        <label className="finance-field" htmlFor={`${id}-endmode`}>Schedule ends<select id={`${id}-endmode`} value={purchase.endMode} onChange={e => onChange({ ...purchase, endMode: e.currentTarget.value as LongTermPurchase['endMode'] })}><option value="duration">After a number of months</option><option value="endDate">On a specific month</option></select></label>
        {purchase.endMode === 'duration' ? numeric('durationMonths','Number of months (inclusive)',purchase.durationMonths,'1') : <label className="finance-field" htmlFor={`${id}-end`}>Last month (inclusive)<input id={`${id}-end`} type="month" value={purchase.endYearMonth} onChange={e => onChange({ ...purchase, endYearMonth: e.currentTarget.value })} /></label>}
      </> : <><label className="finance-field" htmlFor={`${id}-date`}>Purchase month<input id={`${id}-date`} type="month" value={purchase.yearMonth} onChange={e => onChange({ ...purchase, yearMonth: e.currentTarget.value })} /></label>{categories.length > 0 && <label className="finance-field" htmlFor={`${id}-category`}>Category<select id={`${id}-category`} value={purchase.categoryId ?? ''} onChange={e => onChange({ ...purchase, categoryId: e.currentTarget.value || null })}><option value="">No category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}</>}
      {numeric(amountName,recurring?'Monthly amount':'Total amount',recurring?purchase.monthlyAmount:purchase.amount)}
      <label className="finance-check"><input type="checkbox" checked={purchase.enabled} onChange={e => onChange({ ...purchase, enabled:e.currentTarget.checked } as Purchase)} /> Include this plan</label>
      <label className="finance-check"><input type="checkbox" checked={purchase.showOnGraph} onChange={e => onChange({ ...purchase, showOnGraph:e.currentTarget.checked } as Purchase)} /> Show on graph</label>
    </div>
    <p className="editor-note">Funding is requested from the accounts below in order. Any amount those accounts cannot cover remains unpaid; this form does not invent an income source or simulate a negative balance.</p>
    <FundingPolicyEditor policy={policy} accounts={accounts} mode="override" onChange={updatePolicy} />
  </section>;
}
