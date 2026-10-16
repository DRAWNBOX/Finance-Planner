import type { AccountDefinition, FundingPolicy } from '../types';
import { useId } from 'react';
import './FundingPolicyEditor.css';

export interface FundingPolicyEditorProps {
  policy: FundingPolicy;
  accounts: AccountDefinition[];
  mode: 'override' | 'inherited';
  onChange: (policy: FundingPolicy) => void;
}

const accountLabel = (id: string, accounts: AccountDefinition[]) =>
  accounts.find((account) => account.id === id)?.label ?? `Unavailable account (${id})`;

export const FundingPolicyEditor = ({ policy, accounts, mode, onChange }: FundingPolicyEditorProps) => {
  const id = useId();
  const addId = `funding-policy-add-${id}`;
  const inherited = mode === 'inherited';
  const chosenIds = [...(policy.primaryAccountId ? [policy.primaryAccountId] : []), ...policy.fallbackAccountIds];
  const available = accounts.filter((account) => !chosenIds.includes(account.id));
  const update = (primaryAccountId: string | null, fallbackAccountIds: string[]) =>
    onChange({ ...policy, primaryAccountId, fallbackAccountIds });

  return (
    <section className={`funding-policy${inherited ? ' is-inherited' : ''}`} aria-label="Funding accounts">
      <div className="funding-policy-heading">
        <div><h3>Funding order</h3><p>Accounts are tried in order. If one cannot cover the full amount, the next may cover the remainder.</p></div>
        <span className={`funding-policy-mode ${inherited ? 'inherited' : 'override'}`}>{inherited ? 'Using global default' : 'This obligation'}</span>
      </div>
      <ol className="funding-policy-list">
        {[
          { id: policy.primaryAccountId, index: 0 },
          ...policy.fallbackAccountIds.map((id, index) => ({ id, index: index + 1 }))
        ].map(({ id: selectedId, index }) => {
          const id = selectedId ?? '';
          const found = accounts.some((account) => account.id === id);
          const isPrimary = index === 0;
          const role = isPrimary ? 'Primary account' : `Fallback ${index}`;
          return <li className={`funding-policy-row${id && !found ? ' unavailable' : ''}`} key={`${index}-${id}`}>
            <span className="funding-policy-number" aria-hidden="true">{index + 1}</span>
            <label className="funding-policy-account"><span>{role}{id && !found ? ' · unavailable' : ''}</span>
              <select aria-label={role} value={id} disabled={inherited} onChange={(event) => {
                const next = event.target.value;
                if (isPrimary) update(next || null, policy.fallbackAccountIds.filter((fallback) => fallback !== next));
                else update(policy.primaryAccountId, policy.fallbackAccountIds.map((fallback, i) => i === index - 1 ? next : fallback).filter(Boolean));
              }}>
                {!id && <option value="">{accounts.length ? 'Choose primary account' : 'No accounts available'}</option>}
                {id && !found && <option value={id}>{accountLabel(id, accounts)}</option>}
                {accounts.map((account) => <option key={account.id} value={account.id} disabled={chosenIds.includes(account.id) && account.id !== id}>{account.label}</option>)}
              </select>
            </label>
            {!inherited && <div className="funding-policy-actions">
              {!isPrimary && <button type="button" aria-label={`Move ${role} up`} disabled={index <= 1} onClick={() => {
                const fallbacks = [...policy.fallbackAccountIds];
                [fallbacks[index - 1], fallbacks[index - 2]] = [fallbacks[index - 2], fallbacks[index - 1]];
                update(policy.primaryAccountId, fallbacks);
              }}>↑</button>}
              {!isPrimary && <button type="button" aria-label={`Move ${role} down`} disabled={index >= policy.fallbackAccountIds.length} onClick={() => {
                const fallbacks = [...policy.fallbackAccountIds];
                [fallbacks[index - 1], fallbacks[index]] = [fallbacks[index], fallbacks[index - 1]];
                update(policy.primaryAccountId, fallbacks);
              }}>↓</button>}
              <button type="button" className="remove" aria-label={`Remove ${role}`} onClick={() => isPrimary
                ? update(null, policy.fallbackAccountIds)
                : update(policy.primaryAccountId, policy.fallbackAccountIds.filter((_, i) => i !== index - 1))}>Remove</button>
            </div>}
          </li>;
        })}
      </ol>
      {!inherited && <div className="funding-policy-add">
        <label htmlFor={addId}>Add fallback</label>
        <select id={addId} value="" disabled={!available.length} onChange={(event) => {
          if (event.target.value) update(policy.primaryAccountId, [...policy.fallbackAccountIds, event.target.value]);
        }}>
          <option value="">{available.length ? 'Choose an account' : 'No other accounts available'}</option>
          {available.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select>
      </div>}
      {chosenIds.some((id) => !accounts.some((account) => account.id === id)) && <p className="funding-policy-alert" role="status">An account in this order is no longer available. Choose a replacement or remove it; funding will not be redirected automatically.</p>}
      {!accounts.length && <p className="funding-policy-note">Add an account before choosing a funding order. No account will be selected automatically.</p>}
      <p className="funding-policy-note">If the ordered accounts cannot cover the full amount, the remaining amount stays unpaid.</p>
    </section>
  );
};
