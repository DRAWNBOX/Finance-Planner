import { useEffect, useMemo, useRef, useState } from 'react';
import { createConfigurationCommands, createCommandId } from './commands';
import { createDefaultScenario, createDefaultLargePurchase, createDefaultLongTermPurchase, createDefaultLoan, createDefaultHousingEntry, createDefaultRentalEntry, createDefaultCashflowItem, createDefaultOrdinaryCardSchedule, createDefaultZeroInterestCardPlan } from './defaultScenario';
import { loadAppState, saveAppState, getStorageStatus, type PersistedAppState } from './storage';
import { createAutosaveController, type AutosaveController } from './autosave';
import { projectFeatureScenario } from './engine/featureHandlers';
import { cardDefinitionId, cardPayoffDefinitionId } from './engine/cards';
import { displayContextFromRunMetadata } from './utils/viewAdapters';
import { AccountManagementEditor } from './components/AccountManagementEditor';
import { AccountCareerPlanEditor } from './components/AccountCareerPlanEditor';
import { AccountExpensesPlanner } from './components/AccountExpensesPlanner';
import { RetirementSpendingEditor } from './components/RetirementSpendingEditor';
import { PurchaseEditor } from './components/PurchaseEditor';
import { PurchaseFundingResults } from './components/PurchaseFundingResults';
import { LoanEditor } from './components/LoanEditor';
import { LoanResults } from './components/LoanResults';
import { HousingEditor } from './components/HousingEditor';
import { HousingResults } from './components/HousingResults';
import TimelineManager from './components/TimelineManager';
import { ChartPanel } from './components/ChartPanel';
import { SavingsStackedChart } from './components/SavingsStackedChart';
import { ResultsTable } from './components/ResultsTable';
import { NetWorthHistoryChart } from './components/NetWorthHistoryChart';
import { TrajectoryManager } from './components/TrajectoryManager';
import { DateMarkersEditor } from './components/DateMarkersEditor';
import { CashflowItemEditor } from './components/CashflowItemEditor';
import { CardPlanEditor } from './components/CardPlanEditor';
import { TrajectoryComparisonChart } from './components/TrajectoryComparisonChart';
import { canonicalContextFromRunMetadata } from './trajectoryReportAdapter';
import { createCanonicalTrajectorySnapshot } from './trajectoryFreeze';
import { ageFromYearMonth } from './utils/ageDate';
import type { AnyTrajectorySnapshot, CardPlan, LiabilityDefinition, PropertyDefinition } from './types';
import type { Scenario } from './types';
import './styles.css';

const commands = createConfigurationCommands();
type Tab = 'options' | 'careers' | 'netWorth' | 'expenses';
const nav: { id: Tab; label: string }[] = [{ id: 'options', label: 'Options' }, { id: 'careers', label: 'Finances Prediction' }, { id: 'netWorth', label: 'Net Worth' }, { id: 'expenses', label: 'Expenses' }];
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);

export default function App() {
  const [state, setState] = useState<PersistedAppState>(() => loadAppState(new Date()));
  const [tab, setTab] = useState<Tab>('options');
  const [sub, setSub] = useState('retirement');
  const [realDollar, setRealDollar] = useState(false);
  const [measure, setMeasure] = useState<'netWorth' | 'accountAssets'>('netWorth');
  const [range, setRange] = useState<readonly [string, string] | undefined>();
  const [saveStatus, setSaveStatus] = useState(getStorageStatus());
  const [savePending, setSavePending] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const [selectedTrajectoryId, setSelectedTrajectoryId] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [liabilityNotice, setLiabilityNotice] = useState('');
  const [selectedHousingId, setSelectedHousingId] = useState('');
  const [selectedCardPlanId, setSelectedCardPlanId] = useState('');
  const scenario = state.scenario;
  const timelineId = scenario.activeTimelineId ?? null;
  const context = useMemo(() => projectFeatureScenario(scenario, { timelineId }), [scenario, timelineId]);
  const report = context.report;
  const displayContext = displayContextFromRunMetadata(context.metadata);
  const local = commands.getActiveTimelineData(scenario);
  const update = (next: Scenario) => setState(old => ({ ...old, scenario: next }));
  const updateLocal = (transform: Parameters<typeof commands.applyToActiveTimeline>[1]) => update(commands.applyToActiveTimeline(scenario, transform));

  // P5.3 autosave: one coalescing controller per mount. The first state
  // observation after a controller is created is the hydrated load and is never
  // written back; only subsequent user edits are scheduled. A user reset is the
  // sole explicit canonical save.
  const autosaveRef = useRef<{ controller: AutosaveController; hydrated: boolean } | null>(null);
  useEffect(() => {
    const controller = createAutosaveController();
    autosaveRef.current = { controller, hydrated: false };
    return () => { controller.dispose(); autosaveRef.current = null; };
  }, []);
  useEffect(() => {
    const entry = autosaveRef.current;
    if (!entry) return;
    if (!entry.hydrated) { entry.hydrated = true; return; }
    entry.controller.schedule(state);
    setSavePending(entry.controller.hasPending());
    setSaveComplete(false);
    setSaveStatus(entry.controller.getStatus());
    const done = window.setTimeout(() => { const status=entry.controller.getStatus();setSavePending(entry.controller.hasPending());setSaveStatus(status);setSaveComplete(!entry.controller.hasPending()&&!status.blocked&&!status.corrupt&&!status.diagnostics.some(diagnostic=>diagnostic.code==='save-failed')); }, 550);
    return () => window.clearTimeout(done);
  }, [state]);
  useEffect(() => {
    const flush = () => { const entry = autosaveRef.current; if (!entry) return; entry.controller.flush();const status=entry.controller.getStatus();setSaveStatus(status);setSavePending(entry.controller.hasPending());setSaveComplete(!entry.controller.hasPending()&&!status.blocked&&!status.corrupt&&!status.diagnostics.some(diagnostic=>diagnostic.code==='save-failed')); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const financeTabs = [['retirement','Retirement'],['careers','Careers'],['timeline','Timeline'],['purchasesExpenses','Purchases & expenses'],['housing','Housing'],['trajectory','Trajectory'],['warnings','Warnings'],['dateMarkers','Date markers']];
  const tabs = tab === 'options' ? [['profile','Profile & assumptions']] : tab === 'careers' ? financeTabs : tab === 'expenses' ? [['planning','Planning'],['tracking','Tracking'],['creditCards','Credit cards']] : [['history','History']];
  const reportWarnings: { key: string; text: string; severity: 'error' | 'warning' | 'info' }[] = [
    ...(report.shortfall.warning ? [{ key: 'shortfall', text: report.shortfall.warning, severity: 'error' as const }] : []),
    ...(report.exhaustion.exhausted ? [{ key: 'exhaustion', text: `eligible funding accounts exhausted — ${report.exhaustion.firstExhaustedMonth}`, severity: 'error' as const }] : []),
    ...report.fallback.occurrences.map(occurrence => ({ key: `fallback-${occurrence.occurrenceId}`, text: `Funding fell back to a secondary source — ${occurrence.yearMonth}.`, severity: 'warning' as const }))
  ];
  const storageQuotaBlocked = saveStatus.diagnostics.some(diagnostic => diagnostic.code === 'save-failed');
  const localWrite = (key: 'purchases'|'longTermPurchases'|'loans'|'creditCards'|'careerPlan'|'housing', value: unknown) => updateLocal(data => ({ ...data, [key]: value }));
  const applyGlobal = (transform: (draft: Scenario) => void) => update(commands.applyGlobal(scenario, draft => { transform(draft); return draft; }));
  const refDate = new Date(`${scenario.netWorth.asOfDate}T12:00:00`);
  const addPurchase = (recurring = false) => {
    const item = recurring ? createDefaultLongTermPurchase(scenario.profile.currentAge, scenario.options.dateOfBirth, refDate) : createDefaultLargePurchase(scenario.profile.currentAge, scenario.options.dateOfBirth, refDate);
    if (recurring) updateLocal(data => ({ ...data, longTermPurchases: [...data.longTermPurchases, item as ReturnType<typeof createDefaultLongTermPurchase>] }));
    else updateLocal(data => ({ ...data, purchases: [...data.purchases, item as ReturnType<typeof createDefaultLargePurchase>] }));
  };
  const addLoan = () => {
    const generated = createDefaultLoan(scenario.profile.currentAge, scenario.options.dateOfBirth, refDate);
    const loan = { ...generated, currentBalance: 0 };
    const liability: LiabilityDefinition = { id: createCommandId('loan-liability'), kind: 'loan', label: loan.label, openingBalance: 0, sourceConfigId: loan.id, annualInterestRate: loan.annualInterestRate, minimumMonthlyPayment: loan.minimumMonthlyPayment, extraMonthlyPayment: loan.extraMonthlyPayment };
    setState(previous => {
      const withGlobal = commands.applyGlobal(previous.scenario, draft => ({ ...draft, liabilities: [...(draft.liabilities ?? []), liability] }));
      return { ...previous, scenario: commands.applyToActiveTimeline(withGlobal, data => ({ ...data, loans: [...data.loans, loan] })) };
    });
  };
  const updateLoan = (loan: Scenario['loans'][number]) => setState(previous => {
    const withGlobal = commands.applyGlobal(previous.scenario, draft => ({ ...draft, liabilities: (draft.liabilities ?? []).map(liability => liability.sourceConfigId === loan.id ? { ...liability, label: loan.label, annualInterestRate: loan.annualInterestRate, minimumMonthlyPayment: loan.minimumMonthlyPayment, extraMonthlyPayment: loan.extraMonthlyPayment } : liability) }));
    return { ...previous, scenario: commands.applyToActiveTimeline(withGlobal, data => ({ ...data, loans: data.loans.map(item => item.id === loan.id ? loan : item) })) };
  });
  const createLoanLiability = (loanId: string) => setState(previous => {
    const loan = commands.getActiveTimelineData(previous.scenario).loans.find(item => item.id === loanId);
    if (!loan || (previous.scenario.liabilities ?? []).some(item => item.sourceConfigId === loanId)) return previous;
    const liability: LiabilityDefinition = { id: createCommandId('loan-liability'), kind: 'loan', label: loan.label, openingBalance: 0, sourceConfigId: loan.id, annualInterestRate: loan.annualInterestRate, minimumMonthlyPayment: loan.minimumMonthlyPayment, extraMonthlyPayment: loan.extraMonthlyPayment };
    return { ...previous, scenario: commands.applyGlobal(previous.scenario, draft => ({ ...draft, liabilities: [...(draft.liabilities ?? []), liability] })) };
  });
  const duplicateLoan = (loanId: string) => {
    const loanIdCopy = createCommandId('loan');
    const liabilityId = createCommandId('loan-liability');
    setState(previous => {
      const before = previous.scenario;
      const source = commands.getActiveTimelineData(before).loans.find(item => item.id === loanId);
      if (!source) return previous;
      const copy = { ...commands.deepClone(source), id: loanIdCopy, label: `${source.label} copy`, currentBalance: 0 };
      const liability: LiabilityDefinition = { id: liabilityId, kind: 'loan', label: copy.label, openingBalance: 0, sourceConfigId: copy.id, annualInterestRate: copy.annualInterestRate, minimumMonthlyPayment: copy.minimumMonthlyPayment, extraMonthlyPayment: copy.extraMonthlyPayment };
      const withGlobal = commands.applyGlobal(before, draft => ({ ...draft, liabilities: [...(draft.liabilities ?? []), liability] }));
      return { ...previous, scenario: commands.applyToActiveTimeline(withGlobal, data => ({ ...data, loans: [...data.loans, copy] })) };
    });
  };
  const removeLiability = (liabilityId: string) => {
    const sourceId=(scenario.liabilities??[]).find(item=>item.id===liabilityId)?.sourceConfigId;
    const referenced = (scenario.properties ?? []).some(property => property.debtLink === liabilityId)
      || (scenario.cardPlans ?? []).some(plan => plan.kind === 'zeroInterestPayoff' && plan.liabilityId === liabilityId)
      || (scenario.timelines ?? []).some(timeline => (timeline.cardPlans ?? []).some(plan => plan.kind === 'zeroInterestPayoff' && plan.liabilityId === liabilityId))
      || (scenario.netWorth.openingSnapshot?.liabilities ?? []).some(observation => observation.liabilityId === liabilityId)
      || [scenario.loans, ...(scenario.timelines ?? []).map(timeline => timeline.loans)].some(loans => loans.some(loan => loan.id === sourceId))
      || [scenario.housing, ...(scenario.timelines ?? []).map(timeline => timeline.housing)].some(housing => housing.some(entry => entry.id === sourceId));
    if (referenced) { setLiabilityNotice('This liability is still referenced by a loan, card plan, property, or opening observation. Resolve those references before removing it.'); return; }
    applyGlobal(draft => { draft.liabilities = (draft.liabilities ?? []).filter(item => item.id !== liabilityId); });
    setLiabilityNotice('');
  };
  const updateHousing = (next: typeof local.housing) => updateLocal(data => ({ ...data, housing: next }));
  const propertyForHousing = (property: PropertyDefinition) => {
    const housing = local.housing.find(entry => entry.id === (property.sourceConfigId ?? property.id));
    if (!housing) return property;
    const activeTimeline = commands.getActiveTimeline(scenario);
    const events = activeTimeline ? (housing.fundingEvents ?? []) : property.fundingEvents;
    return events === undefined ? property : { ...property, fundingEvents: events };
  };
  const updateHousingProperty = (property: PropertyDefinition) => {
    const sourceId = property.sourceConfigId ?? property.id;
    const current = (scenario.properties ?? []).find(item => item.id === property.id);
    const globalProperties = (scenario.properties ?? []).map(item => item.id === property.id ? { ...property, fundingEvents: current?.fundingEvents } : item);
    const withGlobal = commands.applyGlobal(scenario, draft => ({ ...draft, properties: globalProperties }));
    const housingEntry = local.housing.find(entry => entry.id === sourceId);
    if (housingEntry && property.fundingEvents !== undefined) {
      const withLocal = commands.applyToActiveTimeline(withGlobal, data => ({ ...data, housing: data.housing.map(entry => entry.id === sourceId ? { ...entry, fundingEvents: property.fundingEvents } : entry) }));
      const isBase = !commands.getActiveTimeline(scenario);
      const canonical = isBase ? commands.applyGlobal(withLocal, draft => ({ ...draft, properties: (draft.properties ?? []).map(item => item.id === property.id ? { ...item, fundingEvents: property.fundingEvents } : item) })) : withLocal;
      update(canonical);
    } else update(withGlobal);
  };
  const signedHistoryPoints = (scenario.netWorth.history ?? []).filter(entry => entry.measurement === 'assetsMinusLiabilities').flatMap(entry => {
    const age = ageFromYearMonth(entry.date.slice(0, 7), scenario.options.dateOfBirth, scenario.profile.currentAge, 0, 120, refDate);
    return age === null ? [] : [{ date: entry.date, age, value: entry.totalNetWorth }];
  });
  const duplicateHousing = (housingId: string) => {
    const copyId = createCommandId('housing');
    const propertyId = createCommandId('property');
    const liabilityId = createCommandId('mortgage-liability');
    setState(previous => {
      const before = previous.scenario;
      const source = commands.getActiveTimelineData(before).housing.find(entry => entry.id === housingId);
      if (!source) return previous;
      const copy = { ...commands.deepClone(source), id: copyId, label: `${source.label} copy`, ...(source.fundingEvents === undefined ? {} : { fundingEvents: commands.deepClone(source.fundingEvents) }) };
      if (source.housingType === 'rental') {
        return { ...previous, scenario: commands.applyToActiveTimeline(before, data => ({ ...data, housing: [...data.housing, copy] })) };
      }
      const property: PropertyDefinition = {
        id: propertyId,
        sourceConfigId: copy.id,
        label: copy.label,
        kind: 'primaryResidence',
        value: 0,
        debtLink: liabilityId,
        requiredDownPayment: copy.downPayment,
        status: 'pending',
        acquisitionYearMonth: copy.startYearMonth,
        ...(!before.activeTimelineId ? { fundingEvents: commands.deepClone(copy.fundingEvents ?? []) } : { fundingEvents: [] })
      };
      const liability: LiabilityDefinition = { id: liabilityId, kind: 'mortgage', label: `${copy.label} mortgage`, openingBalance: 0, sourceConfigId: copy.id, linkedPropertyId: property.id };
      const withGlobal = commands.applyGlobal(before, draft => ({ ...draft, properties: [...(draft.properties ?? []), property], liabilities: [...(draft.liabilities ?? []), liability] }));
      const next = commands.applyToActiveTimeline(withGlobal, data => ({ ...data, housing: [...data.housing, copy] }));
      return { ...previous, scenario: next };
    });
    setSelectedHousingId(copyId);
  };
  const addCardPlan = (kind: CardPlan['kind']) => {
    if (kind === 'expectedPayment') {
      const plan = createDefaultOrdinaryCardSchedule(refDate);
      updateLocal(data => ({ ...data, cardPlans: [...data.cardPlans, plan] }));
      setSelectedCardPlanId(plan.id);
      return;
    }
    const liability: LiabilityDefinition = { id: createCommandId('zero-interest-liability'), kind: 'zeroInterestCard', label: 'New 0% card', openingBalance: 0 };
    const plan = createDefaultZeroInterestCardPlan(refDate, { liabilityId: liability.id, initialBalance: 0 });
    const withLiability = commands.applyGlobal(scenario, draft => ({ ...draft, liabilities: [...(draft.liabilities ?? []), liability] }));
    update(commands.applyToActiveTimeline(withLiability, data => ({ ...data, cardPlans: [...data.cardPlans, plan] })));
    setSelectedCardPlanId(plan.id);
  };
  const writeCardPlan = (next: CardPlan) => updateLocal(data => ({ ...data, cardPlans: data.cardPlans.map(plan => plan.id === next.id ? (next.kind === 'zeroInterestPayoff' ? { ...next, initialBalance: 0 } : next) : plan) }));
  return <div className="app-shell">
    <header className="app-header"><a className="brand-mark" href="#top" aria-label="Finance Planner home">F<span>.</span></a><div className="brand-copy"><p>FINANCE PLANNER <span>·</span> YOUR LONG VIEW</p><h1>Make room for what matters.</h1></div><div className="save-indicator" role="status"><i />{saveStatus.blocked ? 'Newer plan preserved' : saveStatus.corrupt ? 'Plan needs attention' : storageQuotaBlocked ? 'Storage is full' : savePending ? 'Saving…' : saveComplete ? 'Saved on this device' : 'Ready to save'}</div></header>
    <nav className="primary-nav" aria-label="Main sections">{nav.map(item => <button key={item.id} className={tab===item.id?'active':''} onClick={()=>{setTab(item.id);setSub(item.id==='expenses'?'planning':item.id==='netWorth'?'history':item.id==='options'?'profile':'retirement')}}>{item.label}</button>)}</nav>
    <main id="top" className="app-main"><div className="workspace-heading"><div><span className="eyebrow">YOUR PLAN AT A GLANCE</span><h2>{tab==='options'?'Finances prediction':nav.find(x=>x.id===tab)?.label}</h2></div><div className="timeline-inline"><span>VIEWING SCENARIO</span><select aria-label="Selected timeline" value={timelineId??''} onChange={e=>update(commands.switchTimeline(scenario,e.target.value||null))}><option value="">Base plan</option>{scenario.timelines.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></div></div>
    <TimelineManager scenario={scenario} onChange={update} />
    <div className="workspace-grid"><aside className="section-nav" aria-label="Plan sections">{tabs.map(([id,label])=><button key={id} className={sub===id?'selected':''} onClick={()=>setSub(id)}>{label}</button>)}</aside><section className="workspace-content">
    {sub==='profile'&&<><section className="profile-editor"><p className="editor-kicker">STARTING POINT</p><h2>Profile & assumptions</h2><div className="editor-grid"><label>Date of birth<input type="date" value={scenario.options.dateOfBirth} onChange={e=>applyGlobal(draft=>{draft.options.dateOfBirth=e.target.value})}/></label><label>Current age<input type="number" min="18" value={scenario.profile.currentAge} onChange={e=>applyGlobal(draft=>{draft.profile.currentAge=Number(e.target.value)})}/></label><label>Retirement age<input type="number" min="18" value={scenario.profile.retirementAge} onChange={e=>applyGlobal(draft=>{draft.profile.retirementAge=Number(e.target.value)})}/></label><label>Years in retirement<input type="number" min="1" value={scenario.profile.retirementYears} onChange={e=>applyGlobal(draft=>{draft.profile.retirementYears=Number(e.target.value)})}/></label><label>Annual inflation (%)<input type="number" step="0.1" value={scenario.manualReturns.inflationRate} onChange={e=>applyGlobal(draft=>{draft.manualReturns.inflationRate=Number(e.target.value)})}/></label></div></section><section className="managed-item"><header><h2>Other income & expenses</h2><button onClick={()=>{const item=createDefaultCashflowItem('social_security',scenario.profile.currentAge,scenario.profile.retirementAge,scenario.profile.retirementYears);applyGlobal(draft=>{draft.cashflowItems=[...draft.cashflowItems,{...item,id:createCommandId('cashflow'),label:'New cashflow',amount:0,accountId:null}]})}}>＋ Add cashflow</button></header>{scenario.cashflowItems.map(item=><CashflowItemEditor key={item.id} item={item} retirementEndAge={scenario.profile.retirementAge+scenario.profile.retirementYears} dateOfBirth={scenario.options.dateOfBirth} currentAge={scenario.profile.currentAge} accounts={scenario.netWorth.accounts} dateMarkers={scenario.dateMarkers} onChange={next=>applyGlobal(draft=>{draft.cashflowItems=draft.cashflowItems.map(x=>x.id===next.id?next:x)})} onRemove={id=>applyGlobal(draft=>{draft.cashflowItems=draft.cashflowItems.filter(x=>x.id!==id)})}/>)}</section><section className="managed-item"><header><h2>Life events</h2><button onClick={()=>applyGlobal(draft=>{draft.lifeEvents=[...draft.lifeEvents,{id:createCommandId('life-event'),type:'custom_expense',label:'New expense',enabled:true,cadence:'one_time',direction:'outflow',startAge:draft.profile.currentAge,endAge:draft.profile.currentAge,amount:0,newSalary:0,annualSalaryGrowthOverride:0,accountId:null,startYearMonth:draft.netWorth.asOfDate.slice(0,7)}]})}>＋ Add life event</button></header>{scenario.lifeEvents.map(event=><div className="life-event-row" key={event.id}><strong>{event.label}</strong><span>{event.type.replaceAll('_',' ')} · {event.startYearMonth??`Age ${event.startAge}`}</span><button onClick={()=>applyGlobal(draft=>{draft.lifeEvents=draft.lifeEvents.filter(x=>x.id!==event.id)})}>Remove</button></div>)}</section></>}
    {sub==='retirement'&&<><RetirementSpendingEditor plan={scenario.withdrawal} accounts={scenario.netWorth.accounts} referenceDate={refDate} onChange={plan=>applyGlobal(draft=>{draft.withdrawal=plan})}/><ResultsTable report={report} displayContext={displayContext} inflationRatePercent={scenario.manualReturns.inflationRate} inflationEnabled={realDollar}/></>}
    {(sub==='careers'||tab==='careers')&&<>{local.careerPlan.entries.length===0&&<p className="empty-state">No careers are needed for a valid plan. Add one whenever you want to include pay and deposits.</p>}<AccountCareerPlanEditor value={local.careerPlan} accounts={scenario.netWorth.accounts} onChange={value=>localWrite('careerPlan',value)}/></>}
    {sub==='timeline'&&<><div className="report-controls"><label><input type="checkbox" checked={realDollar} onChange={e=>setRealDollar(e.target.checked)}/> Display values in today’s dollars</label><label>Show<select value={measure} onChange={e=>setMeasure(e.target.value as typeof measure)}><option value="netWorth">Net worth (assets minus debt)</option><option value="accountAssets">Account assets</option></select></label><label>From<input aria-label="Chart range start" type="month" value={range?.[0]?.slice(0,7)??report.months[0]?.yearMonth??''} onChange={e=>setRange([`${e.target.value}-01`,range?.[1]??report.months[report.months.length-1]?.closingDate??`${e.target.value}-01`])}/></label><label>Through<input aria-label="Chart range end" type="month" value={range?.[1]?.slice(0,7)??report.months[report.months.length-1]?.yearMonth??''} onChange={e=>setRange([range?.[0]??report.months[0]?.closingDate??`${e.target.value}-01`,`${e.target.value}-31`])}/></label><button onClick={()=>setRange(undefined)}>Full range</button></div><ChartPanel report={report} displayContext={displayContext} realDollar={realDollar} inflationRatePercent={scenario.manualReturns.inflationRate} measure={measure} range={range} onRangeChange={setRange}/><SavingsStackedChart report={report} accounts={scenario.netWorth.accounts} realDollars={realDollar} annualInflationRatePercent={scenario.manualReturns.inflationRate}/><ResultsTable report={report} displayContext={displayContext} inflationRatePercent={scenario.manualReturns.inflationRate} inflationEnabled={realDollar}/></>}
    {sub==='purchasesExpenses'&&<>
      <div className="editor-actions">
        <button onClick={()=>addPurchase()}>＋ Add one-time purchase</button>
        <button onClick={()=>addPurchase(true)}>＋ Add monthly purchase</button>
        <button onClick={addLoan}>＋ Add loan</button>
      </div>
      {local.purchases.length+local.longTermPurchases.length+local.loans.length===0&&<p className="empty-state">No purchases or loans yet. Add one to map a future commitment.</p>}
      {local.purchases.map(purchase=>
        <article className="managed-item" key={purchase.id}>
          <div className="item-actions">
            <button onClick={()=>updateLocal(data=>({...data,purchases:[...data.purchases,{...purchase,id:createCommandId('purchase'),label:`${purchase.label} copy`}]}))}>Duplicate</button>
            <button onClick={()=>updateLocal(data=>({...data,purchases:data.purchases.filter(x=>x.id!==purchase.id)}))}>Remove</button>
          </div>
          <PurchaseEditor purchase={purchase} accounts={scenario.netWorth.accounts} categories={scenario.purchaseCategories.map(category=>({id:category.id,label:category.label}))} onChange={next=>localWrite('purchases',local.purchases.map(item=>item.id===next.id?next as typeof item:item))}/>
          <PurchaseFundingResults outcomes={report.outcomes.filter(outcome=>outcome.definitionId===`spending:purchase:${purchase.id}`)} accounts={scenario.netWorth.accounts} fallbackOccurrences={report.fallback.occurrences.filter(item=>item.definitionId===`spending:purchase:${purchase.id}`)}/>
        </article>
      )}
      {local.longTermPurchases.map(purchase=>
        <article className="managed-item" key={purchase.id}>
          <div className="item-actions">
            <button onClick={()=>updateLocal(data=>({...data,longTermPurchases:[...data.longTermPurchases,{...purchase,id:createCommandId('monthly-purchase'),label:`${purchase.label} copy`}]}))}>Duplicate</button>
            <button onClick={()=>updateLocal(data=>({...data,longTermPurchases:data.longTermPurchases.filter(x=>x.id!==purchase.id)}))}>Remove</button>
          </div>
          <PurchaseEditor purchase={purchase} accounts={scenario.netWorth.accounts} categories={scenario.purchaseCategories.map(category=>({id:category.id,label:category.label}))} onChange={next=>localWrite('longTermPurchases',local.longTermPurchases.map(item=>item.id===next.id?next as typeof item:item))}/>
          <PurchaseFundingResults outcomes={report.outcomes.filter(outcome=>outcome.definitionId===`spending:longterm:${purchase.id}`)} accounts={scenario.netWorth.accounts} fallbackOccurrences={report.fallback.occurrences.filter(item=>item.definitionId===`spending:longterm:${purchase.id}`)}/>
        </article>
      )}
      {local.loans.map(loan=>{
        const liability=(scenario.liabilities??[]).find(item=>item.sourceConfigId===loan.id)??null;
        return <article className="managed-item" key={loan.id}>
          <div className="item-actions">
            <button onClick={()=>duplicateLoan(loan.id)}>Duplicate</button>
            <button onClick={()=>updateLocal(data=>({...data,loans:data.loans.filter(x=>x.id!==loan.id)}))}>Remove loan</button>
          </div>
           <LoanEditor loan={loan} accounts={scenario.netWorth.accounts} dateMarkers={scenario.dateMarkers} liability={liability} observedOpeningBalance={liability?scenario.netWorth.openingSnapshot?.liabilities.find(item=>item.liabilityId===liability.id)?.balance:undefined} onChange={updateLoan} onChangeLiability={next=>applyGlobal(draft=>{draft.liabilities=(draft.liabilities??[]).map(item=>item.id===next.id?next:item)})} onCreateLiability={()=>createLoanLiability(loan.id)}/>
           <LoanResults loan={loan} liability={liability} report={report}/>
        </article>
      })}
      {(scenario.liabilities??[]).filter(liability=>liability.kind==='loan'&&liability.sourceConfigId&&![scenario.loans,...(scenario.timelines??[]).map(timeline=>timeline.loans)].some(loans=>loans.some(loan=>loan.id===liability.sourceConfigId))).map(liability=>
        <p className="orphan-liability-note" key={liability.id}>Unlinked debt retained: {liability.label??liability.id} · configured ${liability.openingBalance.toLocaleString()}. Its balance and any opening observation were kept when the loan contract was removed.</p>
      )}
    </>}
    {sub==='housing'&&<HousingEditor housing={local.housing} selectedHousingId={local.housing.some(entry=>entry.id===selectedHousingId)?selectedHousingId:local.housing[0]?.id??''} onSelectHousing={setSelectedHousingId} onChangeHousing={entry=>updateHousing(local.housing.map(x=>x.id===entry.id?entry:x))} onReorderHousing={(from,to)=>{const a=local.housing.findIndex(x=>x.id===from),b=local.housing.findIndex(x=>x.id===to);if(a<0||b<0)return;const copy=[...local.housing];copy.splice(b,0,...copy.splice(a,1));updateHousing(copy)}} onAddHousing={type=>{const entry=type==='mortgage'?createDefaultHousingEntry(scenario.profile.currentAge,scenario.options.dateOfBirth,refDate):createDefaultRentalEntry(scenario.profile.currentAge,scenario.options.dateOfBirth,refDate);if(type==='mortgage'){const liabilityId=createCommandId('mortgage-liability');const property:PropertyDefinition={id:createCommandId('property'),sourceConfigId:entry.id,label:entry.label,kind:'primaryResidence',value:0,debtLink:liabilityId,requiredDownPayment:entry.downPayment,status:'pending',acquisitionYearMonth:entry.startYearMonth,fundingEvents:[]};const liability:LiabilityDefinition={id:liabilityId,kind:'mortgage',label:`${entry.label} mortgage`,openingBalance:0,sourceConfigId:entry.id,linkedPropertyId:property.id};const withGlobal=commands.applyGlobal(scenario,draft=>({...draft,properties:[...(draft.properties??[]),property],liabilities:[...(draft.liabilities??[]),liability]}));update(commands.applyToActiveTimeline(withGlobal,data=>({...data,housing:[...data.housing,entry]})))}else updateHousing([...local.housing,entry]);setSelectedHousingId(entry.id)}} onDuplicateHousing={duplicateHousing} onRemoveHousing={id=>{updateHousing(local.housing.filter(x=>x.id!==id));if(selectedHousingId===id)setSelectedHousingId('')}} accountOptions={scenario.netWorth.accounts.map(a=>({value:a.id,label:a.label}))} orderedBankAccounts={scenario.netWorth.accounts} careerOptions={local.careerPlan.entries.map(c=>({id:c.id,label:c.label}))} dateMarkers={scenario.dateMarkers} referenceDate={scenario.netWorth.asOfDate} properties={(scenario.properties??[]).map(propertyForHousing)} liabilities={scenario.liabilities??[]} onChangeProperty={updateHousingProperty} onChangeLiability={liability=>applyGlobal(draft=>{draft.liabilities=(draft.liabilities??[]).map(x=>x.id===liability.id?liability:x)})} globalFundingPolicy={scenario.fundingPolicy ?? { primaryAccountId: null, fallbackAccountIds: [] }}/>}
     {sub==='housing'&&(()=>{const selected=local.housing.find(entry=>entry.id===(local.housing.some(item=>item.id===selectedHousingId)?selectedHousingId:local.housing[0]?.id));if(!selected)return null;const property=(scenario.properties??[]).find(item=>item.sourceConfigId===selected.id)??(scenario.properties??[]).find(item=>item.id===selected.id);return <HousingResults housing={selected} property={property} report={report}/>})()}
     {sub==='warnings'&&<section className="warning-panel"><h3>Plan checks</h3>{reportWarnings.length?reportWarnings.map(w=><p className={`warning-${w.severity}`} key={w.key}><span>{w.severity==='error'?'Needs attention':w.severity==='warning'?'Fallback used':'Information'}</span>{w.text}</p>):<p>No funding warnings in this plan.</p>}{context.diagnostics.map((d,i)=><p className="warning-info" key={i}><span>Projection note</span>{d}</p>)}</section>}
    {sub==='dateMarkers'&&<DateMarkersEditor markers={scenario.dateMarkers} onAdd={()=>applyGlobal(draft=>{draft.dateMarkers=[...draft.dateMarkers,{id:createCommandId('marker'),label:'New marker',date:scenario.netWorth.asOfDate}]})} onChange={marker=>update(commands.resolveMarkerReferences(commands.applyGlobal(scenario,draft=>{draft.dateMarkers=draft.dateMarkers.map(item=>item.id===marker.id?marker:item);return draft}),{dateOfBirth:scenario.options.dateOfBirth,currentAge:scenario.profile.currentAge}))} onRemove={id=>update(commands.removeDateMarker(scenario,id))}/>}
    {sub==='trajectory'&&<><TrajectoryManager snapshots={scenario.trajectorySnapshots} selectedId={selectedTrajectoryId} namedContextLabel={context.metadata.timelineLabel} createSnapshot={(label,frozenDate)=>createCanonicalTrajectorySnapshot({id:createCommandId('trajectory'),label,frozenDate,report},context.metadata)} onSave={snapshot=>applyGlobal(draft=>{draft.trajectorySnapshots=[...draft.trajectorySnapshots,snapshot]})} onRename={(id,label)=>applyGlobal(draft=>{draft.trajectorySnapshots=draft.trajectorySnapshots.map(item=>item.id===id?{...item,label}:item)})} onRemove={id=>applyGlobal(draft=>{draft.trajectorySnapshots=draft.trajectorySnapshots.filter(item=>item.id!==id)})} onSelect={setSelectedTrajectoryId}/><TrajectoryComparisonChart currentReport={report} currentContext={canonicalContextFromRunMetadata(context.metadata)} selected={scenario.trajectorySnapshots.find(item=>item.id===selectedTrajectoryId) ?? null} historyPoints={signedHistoryPoints}/></>}
     {sub==='planning'&&<AccountExpensesPlanner expenses={scenario.expenses} accounts={scenario.netWorth.accounts} report={context.report} onChange={expenses=>applyGlobal(draft=>{draft.expenses=expenses})}/>}
     {sub==='tracking'&&<section className="warning-panel"><h3>Expense history</h3><p>Recorded and imported expenses are kept separate from the projection plan.</p><AccountExpensesPlanner expenses={scenario.expenses} accounts={scenario.netWorth.accounts} report={context.report} onChange={expenses=>applyGlobal(draft=>{draft.expenses=expenses})}/></section>}
    {sub==='creditCards'&&<section className="cards-workspace"><header className="cards-workspace__intro"><div><span className="eyebrow">TIMELINE-SPECIFIC PLANS</span><h2>Card plans</h2><p>Expected payments are expenses; 0% payoff plans link to a single observed liability. No APR or card-balance simulation is shown.</p></div><div className="editor-actions"><button onClick={()=>addCardPlan('expectedPayment')}>＋ Add expected payment</button><button onClick={()=>addCardPlan('zeroInterestPayoff')}>＋ Add permanent 0% payoff</button></div></header>
      {!local.cardPlans.length&&<p className="empty-state">No card plans in this scenario. Add a payment schedule or a permanent 0% payoff plan.</p>}
      {local.cardPlans.length>0&&<label className="card-select">Choose a plan<select aria-label="Selected card plan" value={local.cardPlans.some(plan=>plan.id===selectedCardPlanId)?selectedCardPlanId:local.cardPlans[0].id} onChange={e=>setSelectedCardPlanId(e.target.value)}>{local.cardPlans.map(plan=><option key={plan.id} value={plan.id}>{plan.label || (plan.kind==='expectedPayment'?'Expected payment':'0% payoff')}</option>)}</select></label>}
      {local.cardPlans.map(plan=>{
        const active = (local.cardPlans.some(item=>item.id===selectedCardPlanId)?selectedCardPlanId:local.cardPlans[0]?.id)===plan.id;
        if(!active)return null;
        const ids = plan.kind==='zeroInterestPayoff' ? [cardDefinitionId(plan),cardPayoffDefinitionId(plan)] : [cardDefinitionId(plan)];
        const outcomes = report.outcomes.filter(outcome=>ids.includes(outcome.definitionId));
        const schedules = report.schedules.filter(schedule=>ids.includes(schedule.definitionId));
        return <div className="card-plan-managed" key={plan.id}>
          <div className="item-actions"><button onClick={()=>{if(plan.kind==='zeroInterestPayoff'){const liability: LiabilityDefinition={id:createCommandId('zero-interest-liability'),kind:'zeroInterestCard',label:`${plan.label} copy`,openingBalance:0};const withLiability=commands.applyGlobal(scenario,draft=>({...draft,liabilities:[...(draft.liabilities??[]),liability]}));const copy={...plan,id:createCommandId('card-plan'),label:`${plan.label} copy`,liabilityId:liability.id,initialBalance:0};update(commands.applyToActiveTimeline(withLiability,data=>({...data,cardPlans:[...data.cardPlans,copy]})));setSelectedCardPlanId(copy.id)}else{const copy={...plan,id:createCommandId('card-plan'),label:`${plan.label} copy`};updateLocal(data=>({...data,cardPlans:[...data.cardPlans,copy]}));setSelectedCardPlanId(copy.id)}}}>Duplicate plan</button><button onClick={()=>{updateLocal(data=>({...data,cardPlans:data.cardPlans.filter(item=>item.id!==plan.id)}));setSelectedCardPlanId('')}}>Remove plan</button></div>
          <CardPlanEditor plan={plan} accounts={scenario.netWorth.accounts} liabilities={scenario.liabilities??[]} markers={scenario.dateMarkers} referenceDate={refDate} onChange={writeCardPlan}/>
          {plan.kind==='zeroInterestPayoff'&&(()=>{const liability=(scenario.liabilities??[]).find(item=>item.id===plan.liabilityId);if(!liability)return null;const observed=scenario.netWorth.openingSnapshot?.liabilities.find(item=>item.liabilityId===liability.id);return <section className="opening-liability-editor"><h3>Opening debt observation</h3><label>Configured liability balance ($)<input type="number" min="0" step="0.01" value={liability.openingBalance} onChange={e=>applyGlobal(draft=>{draft.liabilities=(draft.liabilities??[]).map(item=>item.id===liability.id?{...item,openingBalance:e.target.value===''?0:Number(e.target.value)}:item)})}/></label><p>{observed?`Opening snapshot on ${scenario.netWorth.openingSnapshot?.date} records ${money(Math.round(observed.balance*100))} of debt. This observed value takes precedence, including $0; changing the configured balance will not replace it.`:'No liability balance is recorded in the opening snapshot. The configured balance above is used.'}</p></section>})()}
          <section className="card-results"><h3>Observed projection results</h3>{schedules.length===0&&outcomes.length===0?<p>No scheduled card activity appears in this projection.</p>:<>{schedules.map(schedule=><p key={schedule.definitionId}><strong>{schedule.purpose}</strong> · requested {money(schedule.requestedCents)} · paid {money(schedule.executedCents)} · unpaid {money(schedule.shortfallCents)}{schedule.payoffYearMonth?` · payoff ${schedule.payoffYearMonth}`:''}</p>)}{outcomes.filter(outcome=>outcome.shortfallCents>0).map(outcome=><p className="warning-error" key={outcome.occurrenceId}>Some scheduled payments could not be fully funded, beginning in {outcome.yearMonth}. Unpaid {money(outcome.shortfallCents)}.</p>)}</>}{report.fallback.occurrences.filter(occurrence=>ids.includes(occurrence.definitionId)).map(occurrence=><p className="warning-warning" key={occurrence.occurrenceId}>Funding fell back to a secondary source — {occurrence.yearMonth}.</p>)}</section>
        </div>;
      })}
    </section>}
    {sub==='history'&&<>{liabilityNotice&&<p className="orphan-liability-note" role="alert">{liabilityNotice}</p>}<AccountManagementEditor netWorth={scenario.netWorth} fundingPolicy={scenario.fundingPolicy ?? { primaryAccountId: null, fallbackAccountIds: [] }} liabilities={scenario.liabilities??[]} properties={scenario.properties??[]} onAddAccount={account=>update(commands.addAccount(scenario,account))} onUpdateAccount={account=>update(commands.updateAccount(scenario,account))} onReorderAccounts={accounts=>applyGlobal(draft=>{draft.netWorth.accounts=accounts})} onRemoveAccount={id=>update(commands.removeAccount(scenario,id))} onFundingPolicyChange={fundingPolicy=>applyGlobal(draft=>{draft.fundingPolicy=fundingPolicy})} onOpeningSnapshotChange={snapshot=>applyGlobal(draft=>{draft.netWorth.openingSnapshot=snapshot})} onAddLiability={liability=>applyGlobal(draft=>{draft.liabilities=[...(draft.liabilities??[]),liability]})} onUpdateLiability={liability=>applyGlobal(draft=>{draft.liabilities=(draft.liabilities??[]).map(item=>item.id===liability.id?liability:item)})} onRemoveLiability={removeLiability}/><NetWorthHistoryChart entries={scenario.netWorth.history ?? []} measurement="assetsMinusLiabilities"/></>}
    {tab==='options'&&sub==='retirement'&&<div className="projection-summary"><span>{context.complete?'COMPLETE PROJECTION':'PARTIAL PROJECTION'}</span><strong>{report.months.length ? money(report.months[report.months.length-1].closing.netWorthCents) : '$0'}</strong><small>Projected net worth at the end of this view</small></div>}
    </section></div></main><footer className="app-footer">Your plan stays on this device. <button onClick={()=>setResetConfirm(true)}>Reset plan</button></footer>
    {resetConfirm&&<div className="reset-overlay" role="presentation"><section className="reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description"><h2 id="reset-title">Reset this plan?</h2><p id="reset-description">This replaces the plan saved on this device. This cannot be undone.</p><div><button onClick={()=>setResetConfirm(false)}>Keep my plan</button><button className="reset-confirm" onClick={()=>{autosaveRef.current?.controller.flush();const fresh=createDefaultScenario(new Date());const next={...state,scenario:fresh};setState(next);saveAppState(next,{reset:true,explicitCanonical:true});const status=getStorageStatus();setSaveStatus(status);setSavePending(false);setSaveComplete(!status.blocked&&!status.corrupt&&!status.diagnostics.some(diagnostic=>diagnostic.code==='save-failed'));setResetConfirm(false)}}>Reset plan</button></div></section></div>}
    {saveStatus.diagnostics.map((d,i)=><div className="storage-notice" role="status" key={`${d.code}-${i}`}>{d.message}</div>)}
  </div>;
}
