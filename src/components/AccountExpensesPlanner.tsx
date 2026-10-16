import { Fragment, useMemo, useState } from 'react';
import type { AccountDefinition, ExpenseCategory, ExpenseEntry, ExpensesConfig, RecurringExpenseEvent } from '../types';
import type { ProjectionReport } from '../engine/reporting';
import { parseExpenseImportFiles } from '../importers/expenseImport';
import './AccountExpensesPlanner.css';

type Props = { expenses: ExpensesConfig; accounts: AccountDefinition[]; report: ProjectionReport; onChange: (next: ExpensesConfig) => void };
const dateText = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const isoToday = () => dateText(new Date());
const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const weekStart = (date: Date) => { const d = new Date(date); d.setDate(d.getDate() - d.getDay()); return d; };
const addDays = (date: Date, count: number) => { const d = new Date(date); d.setDate(d.getDate() + count); return d; };
const isOccurred = (entry: ExpenseEntry) => entry.planningStatus === 'occurred' || (entry.planningStatus !== 'planned' && (entry.originType === 'imported' || entry.provenance === 'imported'));

/** Canonical account-only expense planner. Outcomes/balances belong to the projection, not this editor. */
export function AccountExpensesPlanner({ expenses, accounts, report, onChange }: Props) {
  const [accountId, setAccountId] = useState(expenses.activePlanningAccountId ?? accounts[0]?.id ?? '');
  const [week, setWeek] = useState(() => weekStart(new Date()));
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [copied, setCopied] = useState<ExpenseEntry | null>(null);
  const [moving, setMoving] = useState<ExpenseEntry | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'category' | 'flag'>('date');
  const [flagColor, setFlagColor] = useState('#c06b36');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(isoToday());
  const [spanEnd, setSpanEnd] = useState(isoToday());
  const [categoryId, setCategoryId] = useState('');
  const [kind, setKind] = useState<'once' | 'recurring'>('once');
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>('weekly');
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [editingRecurrence, setEditingRecurrence] = useState<string | null>(null);
  const categories = expenses.categoriesByAccountId[accountId] ?? [];
  const selectedWeekMonth = dateText(week).slice(0, 7);
  const closingMonths = report.months.flatMap(month => {
    const close = month.accounts.find(account => account.accountId === accountId);
    return close ? [{ date: month.closingDate, yearMonth: month.yearMonth, cents: close.closingCents }] : [];
  });
  const selectedMonthIndex = closingMonths.findIndex(close => close.yearMonth === selectedWeekMonth);
  const monthlyCloses = selectedMonthIndex < 0 ? [] : closingMonths.slice(selectedMonthIndex, selectedMonthIndex + 12);
  const weekEnd = dateText(addDays(week, 6));
  const weekOutcomeDefinitions = new Set([
    ...expenses.entries.filter(entry => entry.accountId === accountId && !isOccurred(entry)).map(entry => `planner:${entry.id}`),
    ...expenses.recurringEvents.filter(event => event.accountId === accountId && event.enabled && event.planningStatus !== 'occurred').map(event => `recurrence:${event.id}`)
  ]);
  const weekOutcomes = report.outcomes.filter(outcome => outcome.purpose === 'planner' && weekOutcomeDefinitions.has(outcome.definitionId) && outcome.date >= dateText(week) && outcome.date <= weekEnd);
  const uniqueWeekOutcomes = [...new Map(weekOutcomes.map(outcome => [outcome.occurrenceId, outcome])).values()];
  const weekRequested = uniqueWeekOutcomes.reduce((sum, outcome) => sum + outcome.requestedCents, 0);
  const weekPaid = uniqueWeekOutcomes.reduce((sum, outcome) => sum + (outcome.committed ? outcome.executedCents : 0), 0);
  const weekAccountPaid = uniqueWeekOutcomes.reduce((sum, outcome) => sum + (outcome.committed ? outcome.plan.allocations.filter(allocation => allocation.accountId === accountId).reduce((total, allocation) => total + allocation.netFundedCents, 0) : 0), 0);
  const weekOutsideProjection = dateText(week) < report.metadata.startDate || weekEnd > report.metadata.endDate;
  const maxBalance = expenses.maxBalanceByAccountId[accountId];
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => dateText(addDays(week, i))), [week]);
  const update = (changes: Partial<ExpensesConfig>) => onChange({ ...expenses, ...changes });
  const entries = expenses.entries.filter(e => e.accountId === accountId && (categoryFilter === 'all' || e.categoryId === categoryFilter)).sort((a,b) => sortBy === 'amount' ? a.amount-b.amount : sortBy === 'category' ? (a.categoryId ?? '').localeCompare(b.categoryId ?? '') : sortBy === 'flag' ? Number(Boolean(b.color))-Number(Boolean(a.color)) : a.startDate.localeCompare(b.startDate));
  const recur = (event: RecurringExpenseEvent, day: string) => {
    if (day < event.startDate || day > event.endDate) return false;
    const d = new Date(`${day}T12:00:00`); const start = new Date(`${event.startDate}T12:00:00`);
    if (event.cadence === 'weekly') return d.getDay() === start.getDay();
    const targetDay = event.dayOfMonth ?? start.getDate();
    const finalDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(targetDay, finalDay);
  };
  const add = () => {
    if (!label.trim() || !Number.isFinite(Number(amount)) || !date) return;
    const id = newId(kind === 'once' ? 'expense' : 'recurring');
    if (kind === 'once') {
      const entry: ExpenseEntry = { id, label: label.trim(), amount: Math.max(0, Number(amount)), startDate: date, endDate: spanEnd < date ? date : spanEnd, accountId: accountId || null, notes: '', originType: 'manual', importSourceId: null, importBatchId: null, createdAt: isoToday(), updatedAt: isoToday(), categoryId: categoryId || null, planningStatus: 'planned', provenance: 'planner' };
      update({ entries: [...expenses.entries, entry] });
    } else {
      const event: RecurringExpenseEvent = { id, label: label.trim(), amount: Math.max(0, Number(amount)), accountId, paymentAccountId: accountId, categoryId: categoryId || null, cadence, rule: 'on_date', startDate: date, endDate: spanEnd < date ? date : spanEnd, dayOfMonth: new Date(`${date}T12:00:00`).getDate(), enabled: true, planningStatus: 'planned', provenance: 'recurrence' };
      update({ recurringEvents: [...expenses.recurringEvents, event] });
    }
    setLabel(''); setAmount(''); setStatus('Planned expense added.');
  };
  const move = (entry: ExpenseEntry, target: string) => {
    if (isOccurred(entry)) return;
    update({ entries: expenses.entries.map(e => e.id === entry.id ? { ...e, startDate: target, endDate: target, updatedAt: isoToday() } : e) });
  };
  const copyTo = (target: string, category: string | null) => {
    if (!copied) return;
    const clone: ExpenseEntry = { ...copied, id: newId('expense'), startDate: target, endDate: target, categoryId: category, originType: 'manual', provenance: 'planner', planningStatus: 'planned', sourceDate: null, sourceSign: null, asOf: null, importSourceId: null, importBatchId: null, createdAt: isoToday(), updatedAt: isoToday() };
    update({ entries: [...expenses.entries, clone] }); setStatus('A separate planned copy was added.');
  };
  const planFromImport = (entry: ExpenseEntry) => {
    const clone: ExpenseEntry = { ...entry, id: newId('expense-plan'), originType: 'manual', provenance: 'planner', planningStatus: 'planned', startDate: date, endDate: date, sourceDate: null, sourceSign: null, asOf: null, importSourceId: null, importBatchId: null, createdAt: isoToday(), updatedAt: isoToday() };
    update({ entries: [...expenses.entries, clone] }); setStatus('A new planned expense was created; the imported observation is unchanged.');
  };
  const addCategory = () => { const name = window.prompt('Category name'); if (!name?.trim()) return; const category: ExpenseCategory = { id: newId('category'), label: name.trim() }; update({ categoriesByAccountId: { ...expenses.categoriesByAccountId, [accountId]: [...categories, category] } }); };
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);
    try {
      const parsed = await parseExpenseImportFiles(Array.from(files), accounts, expenses.categoriesByAccountId);
      update({ entries: [...expenses.entries, ...parsed.flatMap(result => result.entries)], imports: [...expenses.imports, ...parsed.map(result => result.source)] });
      setStatus(`${parsed.length} import source${parsed.length === 1 ? '' : 's'} added. Review source notes below.`);
    } catch (error) { setStatus(`Import could not be read: ${error instanceof Error ? error.message : 'unknown file error'}`); }
    finally { setImporting(false); }
  };
  const removeSource = (sourceId: string) => update({ entries: expenses.entries.filter(entry => entry.importSourceId !== sourceId), imports: expenses.imports.filter(source => source.id !== sourceId) });
  const updateRecurrence = (event: RecurringExpenseEvent, changes: Partial<RecurringExpenseEvent>) => update({ recurringEvents: expenses.recurringEvents.map(item => item.id === event.id ? { ...item, ...changes } : item) });

  return <section className="aep" aria-label="Account expense planner">
    <header className="aep-head"><div><p className="aep-kicker">SPENDING PLAN · ACCOUNT VIEW</p><h2>Plan expenses by account</h2><p>Plan dated expenses by account and category. Projection outcomes appear elsewhere.</p></div><label>Account<select value={accountId} onChange={e => { setAccountId(e.target.value); update({ activePlanningAccountId: e.target.value }); }}><option value="">Choose account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}{!accounts.some(a => a.id === accountId) && accountId && <option value={accountId}>Missing account · {accountId}</option>}</select></label></header>
     <div className="aep-toolbar"><button onClick={() => setWeek(addDays(week, -7))}>← Previous</button><strong>{week.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><button onClick={() => setWeek(addDays(week, 7))}>Next →</button><label>Category<select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="all">All categories</option>{categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label>Sort<select aria-label="Sort expenses" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}><option value="date">Date</option><option value="category">Category</option><option value="amount">Amount</option><option value="flag">Flagged first</option></select></label><label className="aep-color">Flag color<input aria-label="Flag color" type="color" value={flagColor} onChange={e => setFlagColor(e.target.value)} /></label><button onClick={addCategory}>＋ Category</button></div>
      <section className="aep-balance" aria-labelledby="aep-balance-title"><div className="aep-balance-head"><div><p className="aep-kicker">OBSERVED PROJECTION CLOSES</p><h3 id="aep-balance-title">Monthly funded balance</h3><p>Selected account · monthly resolution from the shared projection. Window follows the week shown below. The weekly grid is a planned schedule, not a balance forecast.</p></div><span className="aep-resolution">Monthly · event-date engine</span></div>{monthlyCloses.length ? <ol className="aep-balance-list">{monthlyCloses.map(close => { const above = Number.isFinite(maxBalance) && close.cents / 100 > maxBalance!; return <li key={`${close.date}-${close.yearMonth}`} className={above ? 'above-threshold' : ''}><span>{new Date(`${close.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span><strong>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(close.cents / 100)}</strong><small>{close.date}{above ? ' · above display threshold' : ''}</small></li>; })}</ol> : <p className="aep-balance-empty">No monthly closing balance is available for this account in the projection window.</p>}{Number.isFinite(maxBalance) && <small className="aep-threshold-note">Display threshold: {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(maxBalance!)}</small>}</section>
      <section className="aep-week-outcomes" aria-label="This week observed planner outcomes"><div><p className="aep-kicker">REPORT-BASED RESULTS</p><h3>This week · observed planner outcomes</h3><p>{dateText(week)} – {weekEnd}{weekOutsideProjection ? ' · incomplete: outside or crossing the report window' : ''}</p></div><dl><div><dt>Requested</dt><dd>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(weekRequested / 100)}</dd></div><div><dt>Paid · all accounts</dt><dd>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(weekPaid / 100)}</dd></div><div><dt>Paid from selected account</dt><dd>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(weekAccountPaid / 100)}</dd></div></dl><small>Scheduled outcomes only; paid amounts count committed funding. This is not a weekly balance forecast. Occurred imports are excluded.</small></section>
      <div className="aep-grid" role="grid" aria-label="Weekly planned expense schedule"><div className="aep-corner">Planned expense / date</div>{dates.map(day => <div className="aep-day" key={day}>{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</div>)}
      {categories.filter(c => categoryFilter === 'all' || c.id === categoryFilter).map(category => <Fragment key={category.id}><div className="aep-category">{category.label}</div>{dates.map(day => <div className="aep-cell" key={`${category.id}-${day}`} tabIndex={0} aria-label={`${category.label}, ${day}`} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (moving && !isOccurred(moving)) { move(moving, day); setMoving(null); setStatus(`Moved to ${day}.`); } else if (copied && !isOccurred(copied)) copyTo(day, category.id); } if (ev.key === 'Escape') { setCopied(null); setMoving(null); } }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); const entry = entries.find(x => x.id === id); if (entry && !isOccurred(entry)) move(entry, day); else copyTo(day, category.id); }}>{entries.filter(e => e.categoryId === category.id && e.startDate === day).map(e => <article className={`aep-card ${isOccurred(e) ? 'occurred' : ''}`} key={e.id} style={{ borderLeftColor: e.color || undefined }} draggable={!isOccurred(e)} onDragStart={ev => !isOccurred(e) && ev.dataTransfer.setData('text/plain', e.id)} tabIndex={0} onKeyDown={ev => { if (ev.key.toLowerCase() === 'c' && !isOccurred(e)) { setCopied(e); setMoving(null); setStatus('Copy ready. Focus a date cell and press Enter to paste.'); } if (ev.key.toLowerCase() === 'm' && !isOccurred(e)) { setMoving(e); setCopied(null); setStatus('Move ready. Focus a date cell and press Enter to move.'); } }}><b>{e.label}</b><span>${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>{e.color && <small className="aep-flag"><i style={{ backgroundColor: e.color }} /> Flag</small>}{isOccurred(e) ? <><small>Occurred · view only</small><button onClick={() => planFromImport(e)}>Plan from import</button></> : <div className="aep-actions"><button aria-label={`Copy ${e.label}`} onClick={() => { setCopied(e); setMoving(null); }}>Copy</button><button aria-label={`Move ${e.label} to ${dateText(addDays(new Date(`${day}T12:00:00`), 1))}`} onClick={() => move(e, dateText(addDays(new Date(`${day}T12:00:00`), 1)))}>Move +1 day</button><button aria-label={`Edit ${e.label}`} onClick={() => { setLabel(e.label); setAmount(String(e.amount)); setDate(e.startDate); setSpanEnd(e.endDate); setCategoryId(e.categoryId ?? ''); }}>Edit</button><button aria-label={`Flag ${e.label}`} onClick={() => update({ entries: expenses.entries.map(x => x.id === e.id ? { ...x, color: x.color ? undefined : flagColor } : x) })}>{e.color ? 'Clear flag' : 'Flag'}</button></div>}</article>)}{expenses.recurringEvents.filter(e => e.accountId === accountId && e.categoryId === category.id && e.enabled && recur(e, day)).map(e => <article className="aep-card aep-repeat" key={`${e.id}-${day}`}><b>{e.label}</b><span>${e.amount.toLocaleString()}</span><small>{e.cadence} · planned occurrence</small></article>)}</div>)}</Fragment>)}</div>
    {!accountId && <div className="aep-empty"><strong>Start with an account</strong><p>Select an account to see its weekly plan, or add one from your account settings.</p></div>}
    {accountId && !entries.length && !expenses.recurringEvents.some(e => e.accountId === accountId) && <div className="aep-empty"><strong>A clear week is a useful starting point.</strong><p>Add a planned expense below; nothing here estimates a balance.</p></div>}
    <form className="aep-form" onSubmit={e => { e.preventDefault(); add(); }}><div><p className="aep-kicker">ADD TO YOUR PLAN</p><h3>New expense</h3></div><label>What for?<input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Weekly groceries" required /></label><label>Amount<input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required /></label><label>First date<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label>Display through<input type="date" value={spanEnd} onChange={e => setSpanEnd(e.target.value)} /></label><label>Category<select value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Uncategorized</option>{categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label>Type<select value={kind} onChange={e => setKind(e.target.value as 'once' | 'recurring')}><option value="once">One time</option><option value="recurring">Recurring</option></select></label>{kind === 'recurring' && <label>Repeats<select value={cadence} onChange={e => setCadence(e.target.value as 'weekly' | 'monthly')}><option value="weekly">Weekly on this weekday</option><option value="monthly">Monthly on this day</option></select></label>}<button className="aep-primary" type="submit">Add to plan</button></form>
    <section className="aep-import"><div><p className="aep-kicker">IMPORT HISTORY</p><h3>Bring in transactions</h3><p>Imported transactions stay occurred and view-only, including future-dated rows.</p></div><label>CSV or PDF<input aria-label="Import expense files" type="file" accept=".csv,.pdf" multiple disabled={importing} onChange={e => { void importFiles(e.target.files); e.currentTarget.value = ''; }} /></label>{importing && <span>Reading files…</span>}{expenses.imports.map(source => <article className="aep-source" key={source.id}><div><strong>{source.fileName}</strong><small>{source.status} · {source.entryIds.length} entries · {Math.round(source.confidence * 100)}% confidence</small>{source.parseNotes.map((note, index) => <small key={`${source.id}-${index}`}>{note}</small>)}</div><button onClick={() => removeSource(source.id)}>Remove source</button></article>)}</section>
    <section className="aep-recurrences"><p className="aep-kicker">RECURRING PLANS</p><h3>Edit a schedule</h3>{expenses.recurringEvents.filter(event => event.accountId === accountId).map(event => <article key={event.id} className="aep-recurrence"><strong>{event.label} · ${event.amount.toLocaleString()}</strong>{editingRecurrence === event.id ? <div className="aep-recurrence-fields"><label>Start<input type="date" aria-label={`${event.label} start`} value={event.startDate} onChange={e => updateRecurrence(event, { startDate: e.target.value })} /></label><label>End<input type="date" aria-label={`${event.label} end`} value={event.endDate} onChange={e => updateRecurrence(event, { endDate: e.target.value })} /></label><label>Cadence<select aria-label={`${event.label} cadence`} value={event.cadence} onChange={e => updateRecurrence(event, { cadence: e.target.value as RecurringExpenseEvent['cadence'] })}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>Day of month<input type="number" min="1" max="31" aria-label={`${event.label} day of month`} value={event.dayOfMonth ?? 1} onChange={e => updateRecurrence(event, { dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value))) })} /></label><button onClick={() => setEditingRecurrence(null)}>Done</button></div> : <button onClick={() => setEditingRecurrence(event.id)}>Edit schedule</button>}</article>)}</section>
    <p className="aep-status" role="status">{status || (copied ? 'Copy ready · focus a date cell and press Enter to paste; Escape cancels.' : moving ? 'Move ready · focus a date cell and press Enter; Escape cancels.' : 'Keyboard: focus a planned expense and press C to copy or M to move; focus a date cell and press Enter.')}</p>
  </section>;
}
