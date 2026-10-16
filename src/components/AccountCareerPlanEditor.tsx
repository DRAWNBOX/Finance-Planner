import { useEffect, useState } from 'react';
import type { AccountDefinition, CareerEntry, CareerPlan, CareerPayPlan, CareerDepositPlan, CareerSourceLine, Paycheck } from '../types';
import { compilePaycheck, createCareerPayPlan, createDefaultPaycheck, paycheckFromPaycheckInfo } from '../paycheck';
import { deepClone } from '../commands';
import { PaycheckEditorModal } from './PaycheckEditorModal';
import './AccountCareerPlanEditor.css';

interface Props {
  value: CareerPlan;
  accounts: AccountDefinition[];
  onChange: (value: CareerPlan) => void;
}
const makeId = () => `career-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const blankCareer = (index: number): CareerEntry => ({
  id: makeId(), label: `Career ${index + 1}`, enabled: true, usePreviousCareerStartAge: false,
  startAge: 30, endAge: 65, annualRaiseRate: 0, savingsRate: 0, emergencyFundContributionRate: 0,
  hsaContributionRate: 0, investmentsContributionRate: 0, retirement401kContributionRate: 0,
  emergencyFundSavingsMonthly: false, hsaSavingsMonthly: false, investmentsSavingsMonthly: false, retirement401kSavingsMonthly: false,
  emergencyFundStartBalanceMode: 'manual', hsaStartBalanceMode: 'manual', investmentsStartBalanceMode: 'manual', retirement401kStartBalanceMode: 'manual',
  emergencyFundManualStartBalance: 0, hsaManualStartBalance: 0, investmentsManualStartBalance: 0, retirement401kManualStartBalance: 0,
  paycheck: createDefaultPaycheck(index), sourceLines: [], depositPlan: { allocations: [], remainderAccountId: null, postingDay: 1 }, payPlans: []
});
const newLine = (accountId = ''): CareerSourceLine => ({ id: makeId(), enabled: true, sourceType: 'account', sourceId: accountId, contributionRate: 0, savingsMonthly: false, monthlyWithdrawal: 0, mode: 'percentOfSalary', fixedAmount: 0 });

export function AccountCareerPlanEditor({ value, accounts, onChange }: Props) {
  const [careerId, setCareerId] = useState(value.entries[0]?.id ?? '');
  const [planId, setPlanId] = useState('initial');
  const [paycheckOpen, setPaycheckOpen] = useState(false);
  const career = value.entries.find(item => item.id === careerId) ?? value.entries[0];
  const plans = career?.payPlans ?? [];
  const plan = plans.find(item => item.id === planId);
  const paycheck = plan?.paycheck ?? career?.paycheck ?? (career ? paycheckFromPaycheckInfo(career.paycheckInfo) : null);
  useEffect(() => { if (career && career.id !== careerId) setCareerId(career.id); }, [career, careerId]);
  const updateCareer = (patch: Partial<CareerEntry>) => career && onChange({ ...value, entries: value.entries.map(item => item.id === career.id ? { ...item, ...patch } : item) });
  const setDepositPlan = (next: CareerDepositPlan) => {
    if (!career) return;
    if (plan) updateCareer({ payPlans: plans.map(item => item.id === plan.id ? { ...item, depositPlan: next } : item) });
    else updateCareer({ depositPlan: next });
  };
  const deposit = plan?.depositPlan ?? career?.depositPlan ?? { allocations: [], remainderAccountId: null, postingDay: 1 };
  const updatePaycheck = (next: Paycheck) => {
    if (!career) return;
    if (plan) updateCareer({ payPlans: plans.map(item => item.id === plan.id ? { ...item, paycheck: next } : item) });
    else updateCareer({ paycheck: next, paycheckInfo: compilePaycheck(next) });
    setPaycheckOpen(false);
  };
  const addCareer = () => { const next = blankCareer(value.entries.length); onChange({ ...value, entries: [...value.entries, next] }); setCareerId(next.id); setPlanId('initial'); };
  const copyPrevious = () => {
    const index = value.entries.findIndex(item => item.id === career?.id); const previous = value.entries[index - 1];
    if (!previous || !career) return;
    const source = previous.paycheck ?? paycheckFromPaycheckInfo(previous.paycheckInfo);
    updateCareer({ paycheck: source, paycheckInfo: compilePaycheck(source), annualRaiseRate: previous.annualRaiseRate });
  };
  return <section className="account-career" aria-label="Career and account plan">
    <header><div><p className="account-career-kicker">Income setup</p><h2>Career plan</h2><p>Set up pay and choose where each deposit goes. Balances are managed in Accounts.</p></div><button type="button" onClick={addCareer}>＋ Add career</button></header>
    {!value.entries.length ? <div className="account-career-empty"><h3>Start with a career</h3><p>Add a career to configure its paycheck and account deposits.</p><button onClick={addCareer}>Add your first career</button></div> : <>
      <nav className="account-career-tabs" aria-label="Careers">{value.entries.map((item,index)=><div className={career?.id===item.id?'selected':''} key={item.id}><button onClick={()=>{setCareerId(item.id);setPlanId('initial')}}>{item.label || `Career ${index+1}`}</button><button aria-label={`Move ${item.label} earlier`} disabled={!index} onClick={()=>{const entries=[...value.entries];[entries[index-1],entries[index]]=[entries[index],entries[index-1]];onChange({...value,entries})}}>↑</button><button aria-label={`Move ${item.label} later`} disabled={index===value.entries.length-1} onClick={()=>{const entries=[...value.entries];[entries[index+1],entries[index]]=[entries[index],entries[index+1]];onChange({...value,entries})}}>↓</button></div>)}</nav>
      {career && <>
        <div className="account-career-fields"><label>Career name<input value={career.label} onChange={e=>updateCareer({label:e.target.value})}/></label><label className="account-career-check"><input type="checkbox" checked={career.enabled} onChange={e=>updateCareer({enabled:e.target.checked})}/> Estimate income from this career</label><button onClick={()=>{const copy={...deepClone(career),id:makeId(),label:`${career.label} copy`};onChange({...value,entries:[...value.entries,copy]});setCareerId(copy.id)}}>Duplicate career</button><button className="danger" onClick={()=>{const rest=value.entries.filter(item=>item.id!==career.id);onChange({...value,entries:rest});setCareerId(rest[0]?.id??'')}}>Remove career</button></div>
        <div className="account-career-plans" role="tablist" aria-label="Pay plans"><button role="tab" aria-selected={planId==='initial'} onClick={()=>setPlanId('initial')}>Initial</button>{plans.map(p=><button key={p.id} role="tab" aria-selected={planId===p.id} onClick={()=>setPlanId(p.id)}>{p.label}</button>)}<button onClick={()=>{if(!paycheck)return;const p=createCareerPayPlan(`Plan ${plans.length+2}`,'',paycheck,career.sourceLines??[]);updateCareer({payPlans:[...plans,p]});setPlanId(p.id)}}>＋ Pay plan</button>{plan&&<button onClick={()=>{updateCareer({payPlans:plans.filter(p=>p.id!==plan.id)});setPlanId('initial')}}>Remove plan</button>}</div>
        {plan&&<label className="account-career-plan-name">Plan name<input value={plan.label} onChange={e=>updateCareer({payPlans:plans.map(p=>p.id===plan.id?{...p,label:e.target.value}:p)})}/><span>Effective month</span><input type="month" value={plan.effectiveYearMonth} onChange={e=>updateCareer({payPlans:plans.map(p=>p.id===plan.id?{...p,effectiveYearMonth:e.target.value}:p)})}/></label>}
        <div className="account-career-panel"><div><h3>Paycheck</h3><p>Detailed earnings, deductions, and employer deposits.</p></div><button onClick={()=>setPaycheckOpen(true)}>Edit paycheck</button></div>
        <div className="account-career-panel allocation"><div><h3>Net pay allocations</h3><p>Ordered destinations for take-home pay. Any remainder goes to the account you choose.</p></div>
          {deposit.allocations.map((line,i)=><div className="allocation-row" key={line.id}>
            <span>{i+1}</span>
            <select aria-label={`Allocation account ${i+1}`} value={line.sourceId} onChange={e=>setDepositPlan({...deposit,allocations:deposit.allocations.map((x,n)=>n===i?{...x,sourceId:e.target.value}:x)})}>
              <option value="">Choose account</option>
              {line.sourceId&&!accounts.some(a=>a.id===line.sourceId)&&<option value={line.sourceId}>Unresolved account ({line.sourceId})</option>}
              {accounts.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select>
            <select aria-label={`Allocation type ${i+1}`} value={line.mode??'percentOfSalary'} onChange={e=>setDepositPlan({...deposit,allocations:deposit.allocations.map((x,n)=>n===i?{...x,mode:e.target.value as CareerSourceLine['mode']}:x)})}>
              <option value="percentOfSalary">Percent</option>
              <option value="fixedAmount">Fixed amount</option></select>
            <input aria-label={`Allocation amount ${i+1}`} type="number" min="0" value={line.mode==='fixedAmount'?line.fixedAmount??0:line.contributionRate} onChange={e=>{const raw=e.target.value;const amount=raw===''?0:Number(raw);setDepositPlan({...deposit,allocations:deposit.allocations.map((x,n)=>n===i?line.mode==='fixedAmount'?{...x,fixedAmount:amount}:{...x,contributionRate:amount}:x)})}}/>
            <div className="allocation-limits">
              <label>Maximum account balance ($)<input aria-label={`Maximum account balance ${i+1}`} type="number" min="0" placeholder="No limit" value={line.maxBalance == null ? '' : line.maxBalance} onChange={e=>{const raw=e.target.value;setDepositPlan({...deposit,allocations:deposit.allocations.map((x,n)=>{if(n!==i)return x;const next={...x};if(raw==='')delete next.maxBalance;else next.maxBalance=Math.max(0,Number(raw));return next;})})}}/></label>
              <label>Overflow account<select aria-label={`Overflow account ${i+1}`} value={line.overflowFallbackAccountId??''} onChange={e=>setDepositPlan({...deposit,allocations:deposit.allocations.map((x,n)=>n===i?{...x,overflowFallbackAccountId:e.target.value||null}:x)})}>
                <option value="">No overflow destination</option>
                {line.overflowFallbackAccountId&&!accounts.some(a=>a.id===line.overflowFallbackAccountId)&&<option value={line.overflowFallbackAccountId}>Unresolved account ({line.overflowFallbackAccountId})</option>}
                {accounts.filter(a=>a.id!==line.sourceId).map(a=><option key={a.id} value={a.id}>{a.label}</option>)}
                {line.overflowFallbackAccountId===line.sourceId&&<option value={line.sourceId} disabled>Same as destination (not allowed)</option>}
              </select></label>
              {line.overflowFallbackAccountId===line.sourceId&&<p className="allocation-note" role="status">Choose a different account; overflow cannot return to this destination.</p>}
              {line.overflowFallbackAccountId&&!accounts.some(a=>a.id===line.overflowFallbackAccountId)&&<p className="allocation-note" role="status">This overflow account is unresolved. Choose a valid account or clear it.</p>}
            </div>
            <button aria-label={`Remove allocation ${i+1}`} onClick={()=>setDepositPlan({...deposit,allocations:deposit.allocations.filter((_,n)=>n!==i)})}>Remove</button>
          </div>)}
          <button onClick={()=>setDepositPlan({...deposit,allocations:[...deposit.allocations,newLine(accounts[0]?.id)]})}>＋ Add destination</button>
          <div className="allocation-footer">
            <label>Remainder account<select value={deposit.remainderAccountId??''} onChange={e=>setDepositPlan({...deposit,remainderAccountId:e.target.value||null})}>
              <option value="">Choose account</option>
              {deposit.remainderAccountId&&!accounts.some(a=>a.id===deposit.remainderAccountId)&&<option value={deposit.remainderAccountId}>Unresolved account ({deposit.remainderAccountId})</option>}
              {accounts.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
            <label>Posting day<input type="number" min="1" max="31" value={deposit.postingDay??1} onChange={e=>setDepositPlan({...deposit,postingDay:Number(e.target.value)})}/></label>
          </div>
        </div>
      </>}
    </>}
    {career&&paycheckOpen&&paycheck&&<PaycheckEditorModal paycheck={paycheck} accounts={accounts} onClose={()=>setPaycheckOpen(false)} onSave={updatePaycheck}/>}
  </section>;
}
