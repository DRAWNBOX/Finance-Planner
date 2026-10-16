/**
 * Phase 5 P5.4 — Q-owned App integration acceptance (GUI-A01–A10 / G01–G40).
 *
 * These are independent RTL flows over the Stage-2 canonical `App` shell:
 * canonical `createConfigurationCommands` writes, one `projectFeatureScenario`
 * projection, controlled localStorage, and a fixed reference date.
 *
 * Scope + honesty notes:
 * - The historical 83 pool-era tests are intentionally replaced; the originals
 *   remain in Git HEAD. No assertion depends on removed pool controls, negative
 *   hypothetical purchase balances, or legacy card modes.
 * - GUI-A05/A06 card-plan acceptance is covered end-to-end against the real
 *   `CardPlanEditor` mount: ordinary add/edit/duplicate/remove with base-vs-timeline
 *   isolation and save/reload, the one linked global 0%-card liability with zero
 *   opening debt (and a pinned `initialBalance`, never double-counted), the funded
 *   `$100`/3-installment and partial-shortfall schedules read back from the one
 *   `projectFeatureScenario(...).report`, marker-linked dates, and account-source
 *   fallback with no pool aliases.
 * - GUI-A10 canonical signed-cents save/compare and legacy incompatibility are
 *   tested against the mounted `TrajectoryComparisonChart`; this focused RTL suite
 *   does not certify the entire GUI-A01–A10/G01–G40 browser matrix.
 * - Shortfall/exhaustion/fallback language is asserted verbatim from the engine
 *   selector (`projectFeatureScenario(...).report`) with no invented strings.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import {
  createDefaultHousingEntry,
  createDefaultOrdinaryCardSchedule,
  createDefaultRentalEntry,
  createDefaultScenario,
  createDefaultZeroInterestCardPlan
} from './defaultScenario';
import { createCareerPayPlan, createDefaultPaycheck } from './paycheck';
import { decodeAppState, encodeAppState, createDefaultUiState } from './storage';
import { projectFeatureScenario } from './engine/featureHandlers';
import { createCanonicalTrajectorySnapshot } from './trajectoryFreeze';
import { canonicalAnnualPointsFromReport } from './trajectoryReportAdapter';
import type { CanonicalTrajectorySnapshot, ExpenseEntry, Scenario, TrajectorySnapshot } from './types';

const KEY = 'finance-planner-state';
const FIXED_DATE = new Date('2026-06-15T12:00:00.000Z');
const CHECKING = 'checking-account-default';
const EMERGENCY = 'emergencyFund-account-default';
const INVESTMENTS = 'investments-account-default';
const displayCents = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);

const freshScenario = (mutate: (scenario: Scenario) => void = () => {}) => {
  const scenario = createDefaultScenario(FIXED_DATE);
  mutate(scenario);
  return scenario;
};

/** Write controlled canonical bytes before the App mounts (App reads on mount). */
const persistScenario = (scenario: Scenario) => {
  const { json } = encodeAppState({ scenario, ui: createDefaultUiState() }, FIXED_DATE);
  window.localStorage.setItem(KEY, json);
};

/** The exact scenario the App hydrates from, so expected numbers are not invented. */
const decodeStored = (): Scenario => decodeAppState(window.localStorage.getItem(KEY), FIXED_DATE).scenario;

const renderApp = () => render(<App />);
const clickButton = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('App integration (Phase 5 GUI acceptance)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_DATE);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // GUI-A09 / G39 — navigation, section mount, timeline manager -----------------
  it('renders the four top sections and switches each section sub-tab', () => {
    persistScenario(freshScenario());
    renderApp();

    for (const name of ['Options', 'Finances Prediction', 'Net Worth', 'Expenses']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }

    clickButton('Net Worth');
    expect(screen.getByRole('heading', { name: 'Accounts & funding' })).toBeInTheDocument();

    clickButton('Expenses');
    expect(screen.getByRole('heading', { name: 'Plan expenses by account' })).toBeInTheDocument();

    clickButton('Finances Prediction');
    expect(screen.getByRole('heading', { name: 'Career plan' })).toBeInTheDocument();
    clickButton('Timeline');
    expect(screen.getByRole('region', { name: 'Projection results' })).toBeInTheDocument();
    clickButton('Warnings');
    expect(screen.getByRole('heading', { name: 'Plan checks' })).toBeInTheDocument();
    clickButton('Trajectory');
    expect(screen.getByRole('heading', { name: 'Trajectory manager' })).toBeInTheDocument();
    expect(screen.getByText('No trajectories saved yet')).toBeInTheDocument();
    clickButton('Date markers');
    expect(screen.getByText(/No date markers yet/)).toBeInTheDocument();
  });

  it('adds, renames, confirms deletion, and isolates a named timeline', () => {
    persistScenario(freshScenario());
    renderApp();

    expect(screen.getByText(/One plan, with room to explore/)).toBeInTheDocument();
    clickButton('＋ Add timeline');
    expect(screen.getByText('Showing Timeline 1')).toBeInTheDocument();

    clickButton('Rename Timeline 1');
    fireEvent.change(screen.getByLabelText('Timeline name'), { target: { value: 'Aggressive' } });
    clickButton('Save');
    expect(screen.getByText('Showing Aggressive')).toBeInTheDocument();

    // Cancelling the confirmation keeps the timeline.
    clickButton('Delete Aggressive');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    clickButton('Keep timeline');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Showing Aggressive')).toBeInTheDocument();

    // Explicit delete returns to the original plan and the empty state.
    clickButton('Delete Aggressive');
    clickButton('Delete timeline');
    expect(screen.getByText('Showing the original plan')).toBeInTheDocument();
    expect(screen.getByText(/One plan, with room to explore/)).toBeInTheDocument();
  });

  it('writes purchases to the active timeline without touching the base plan', () => {
    persistScenario(freshScenario());
    renderApp();

    clickButton('Finances Prediction');
    clickButton('＋ Add timeline');
    clickButton('Purchases & expenses');
    clickButton('＋ Add one-time purchase');
    expect(screen.queryByText(/No purchases or loans yet/)).not.toBeInTheDocument();

    const timelineValue = (within(screen.getByLabelText('Selected timeline') as HTMLSelectElement).getByRole('option', { name: 'Timeline 1' }) as HTMLOptionElement).value;

    // Switch to the base plan: its purchases are untouched.
    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: '' } });
    expect(screen.getByText(/No purchases or loans yet/)).toBeInTheDocument();

    // Switch back: the timeline edit is preserved.
    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: timelineValue } });
    expect(screen.queryByText(/No purchases or loans yet/)).not.toBeInTheDocument();
  });

  // GUI-A02 — valid no-career plans still project ------------------------------
  it('renders chart, table and warnings with no enabled careers', () => {
    persistScenario(freshScenario((scenario) => {
      scenario.careerPlan = { ...scenario.careerPlan, enabled: false, entries: [] };
    }));
    renderApp();

    clickButton('Finances Prediction');
    expect(screen.getByText('No careers are needed for a valid plan. Add one whenever you want to include pay and deposits.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start with a career' })).toBeInTheDocument();

    clickButton('Timeline');
    expect(screen.getByRole('region', { name: 'Projection chart' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Projection results' })).toBeInTheDocument();

    clickButton('Warnings');
    expect(screen.getByRole('heading', { name: 'Plan checks' })).toBeInTheDocument();
  });

  // GUI-A01 / G04 — first-launch zeros, account CRUD, reset --------------------
  it('starts every account at $0 opening, 0% return and no retirement override', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Net Worth');

    const openings = screen.getAllByLabelText(/Opening balance/);
    const returns = screen.getAllByLabelText(/Annual return/);
    const retirement = screen.getAllByLabelText(/Retirement return/);
    expect(openings).toHaveLength(5);
    openings.forEach((input) => expect(input).toHaveValue(0));
    returns.forEach((input) => expect(input).toHaveValue(0));
    retirement.forEach((input) => expect(input).toHaveValue(null));
  });

  it('preserves an account rate through an unrelated edit and a reload', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Net Worth');

    fireEvent.change(screen.getAllByLabelText(/Annual return/)[0], { target: { value: '6.5' } });
    fireEvent.change(screen.getAllByLabelText('Account name')[0], { target: { value: 'Main' } });
    window.dispatchEvent(new Event('pagehide'));

    cleanup();
    renderApp();
    clickButton('Net Worth');

    expect(screen.getAllByLabelText(/Annual return/)[0]).toHaveValue(6.5);
    expect(screen.getAllByLabelText('Account name')[0]).toHaveValue('Main');
    expect(screen.getAllByLabelText(/Retirement return/)[0]).toHaveValue(null);
  });

  it('adds and removes an account, then resets the plan to first-launch zeros', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Net Worth');

    expect(screen.getAllByLabelText('Account name')).toHaveLength(5);
    clickButton('＋ Add account');
    expect(screen.getAllByLabelText('Account name')).toHaveLength(6);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove account' })[0]);
    const confirmation = screen.getByRole('alert');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Remove account' }));
    expect(screen.getAllByLabelText('Account name')).toHaveLength(5);

    fireEvent.change(screen.getAllByLabelText(/Annual return/)[0], { target: { value: '6.5' } });
    // Flush the debounced edit so the "preserved bytes" assertion is stable.
    window.dispatchEvent(new Event('pagehide'));
    const beforeReset = window.localStorage.getItem(KEY);

    // GUI-A01 — cancelling the reset keeps the edited plan and the exact stored bytes.
    clickButton('Reset plan');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep my plan' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/Annual return/)[0]).toHaveValue(6.5);
    expect(window.localStorage.getItem(KEY)).toBe(beforeReset);

    // Confirming the reset restores first-launch zeros.
    clickButton('Reset plan');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset plan' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/Annual return/)[0]).toHaveValue(0);
    expect(screen.getAllByLabelText('Account name')[0]).toHaveValue('Checking');
  });

  // GUI-A09 / G14 — orphaned funding reference is never silently redirected -----
  it('keeps an orphaned global funding reference visible without redirecting it', () => {
    persistScenario(freshScenario((scenario) => {
      scenario.fundingPolicy = { primaryAccountId: 'ghost', fallbackAccountIds: ['also-ghost'] };
    }));
    renderApp();
    clickButton('Net Worth');

    expect(screen.getByRole('combobox', { name: 'Primary account' })).toHaveValue('ghost');
    expect(screen.getByText(/will not be redirected automatically/i)).toBeInTheDocument();
  });

  // GUI-A03 / G09–G11 — granular paycheck owns the plan and reloads -------------
  it('persists a granular paycheck amount on the initial plan across a reload', () => {
    persistScenario(freshScenario());
    renderApp();

    clickButton('Finances Prediction');
    clickButton('Edit paycheck');
    const modal = screen.getByRole('heading', { name: 'Configure Paycheck' }).closest('.paycheck-modal') as HTMLElement;
    fireEvent.change(within(modal).getAllByRole('spinbutton')[2], { target: { value: '6000' } });
    clickButton('Save Paycheck');
    expect(screen.queryByRole('heading', { name: 'Configure Paycheck' })).not.toBeInTheDocument();
    window.dispatchEvent(new Event('pagehide'));

    cleanup();
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Edit paycheck');
    const reloaded = screen.getByRole('heading', { name: 'Configure Paycheck' }).closest('.paycheck-modal') as HTMLElement;
    expect(within(reloaded).getAllByRole('spinbutton')[2]).toHaveValue(6000);
  });

  it('edits and reloads a dated pay plan allocation without changing the initial plan', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Finances Prediction');

    clickButton('＋ Pay plan');
    const planTab = screen.getByRole('tab', { name: 'Plan 2' });
    fireEvent.click(planTab);
    const effectiveMonth = document.querySelector('input[type="month"]') as HTMLInputElement;
    fireEvent.change(effectiveMonth, { target: { value: '2026-04' } });
    clickButton('＋ Add destination');

    const allocationAccount = screen.getByLabelText('Allocation account 1');
    const distinctAccount = freshScenario().netWorth.accounts.find(account => account.id !== CHECKING)!;
    fireEvent.change(allocationAccount, { target: { value: distinctAccount.id } });
    fireEvent.change(screen.getByLabelText('Allocation type 1'), { target: { value: 'fixedAmount' } });
    fireEvent.change(screen.getByLabelText('Allocation amount 1'), { target: { value: '125' } });
    fireEvent.change(screen.getByLabelText('Maximum account balance 1'), { target: { value: '500' } });
    const overflowAccount = freshScenario().netWorth.accounts.find(account => account.id !== distinctAccount.id && account.id !== CHECKING)!;
    fireEvent.change(screen.getByLabelText('Overflow account 1'), { target: { value: overflowAccount.id } });
    fireEvent.change(screen.getByRole('combobox', { name: /remainder account/i }), { target: { value: CHECKING } });

    fireEvent.click(screen.getByRole('tab', { name: 'Initial' }));
    expect(screen.getByLabelText('Allocation amount 1')).not.toHaveValue(125);
    fireEvent.click(screen.getByRole('tab', { name: 'Plan 2' }));
    expect(screen.getByLabelText('Allocation account 1')).toHaveValue(distinctAccount.id);
    expect(screen.getByLabelText('Allocation amount 1')).toHaveValue(125);

    window.dispatchEvent(new Event('pagehide'));
    const storedCareer = decodeStored().careerPlan.entries[0];
    const datedPlan = storedCareer.payPlans?.find(plan => plan.label === 'Plan 2');
    expect(datedPlan?.effectiveYearMonth).toBe('2026-04');
    expect(datedPlan?.depositPlan).toMatchObject({ remainderAccountId: CHECKING });
    expect(datedPlan?.depositPlan?.allocations).toContainEqual(expect.objectContaining({
      sourceId: distinctAccount.id,
      mode: 'fixedAmount',
      fixedAmount: 125,
      maxBalance: 500,
      overflowFallbackAccountId: overflowAccount.id
    }));
    expect(storedCareer.depositPlan?.allocations).not.toContainEqual(expect.objectContaining({ sourceId: distinctAccount.id, fixedAmount: 125 }));

    cleanup();
    renderApp();
    clickButton('Finances Prediction');
    fireEvent.click(screen.getByRole('tab', { name: 'Plan 2' }));
    expect(document.querySelector('input[type="month"]')).toHaveValue('2026-04');
    expect(screen.getByLabelText('Allocation account 1')).toHaveValue(distinctAccount.id);
    expect(screen.getByLabelText('Allocation amount 1')).toHaveValue(125);
    expect(screen.getByLabelText('Maximum account balance 1')).toHaveValue(500);
    expect(screen.getByLabelText('Overflow account 1')).toHaveValue(overflowAccount.id);
    expect(screen.getByRole('combobox', { name: /remainder account/i })).toHaveValue(CHECKING);

    fireEvent.change(screen.getByLabelText('Maximum account balance 1'), { target: { value: '' } });
    window.dispatchEvent(new Event('pagehide'));
    const clearedAllocation = decodeStored().careerPlan.entries[0].payPlans?.find(item => item.label === 'Plan 2')?.depositPlan?.allocations[0];
    expect(clearedAllocation).toBeDefined();
    expect(clearedAllocation).not.toHaveProperty('maxBalance');
    expect(clearedAllocation?.overflowFallbackAccountId).toBe(overflowAccount.id);

    cleanup();
    renderApp();
    clickButton('Finances Prediction');
    fireEvent.click(screen.getByRole('tab', { name: 'Plan 2' }));
    expect(screen.getByLabelText('Maximum account balance 1')).toHaveValue(null);
    expect(screen.getByLabelText('Overflow account 1')).toHaveValue(overflowAccount.id);

    fireEvent.change(screen.getByLabelText('Maximum account balance 1'), { target: { value: '0' } });
    window.dispatchEvent(new Event('pagehide'));
    const zeroAllocation = decodeStored().careerPlan.entries[0].payPlans?.find(item => item.label === 'Plan 2')?.depositPlan?.allocations[0];
    expect(zeroAllocation?.maxBalance).toBe(0);
    expect(zeroAllocation?.overflowFallbackAccountId).toBe(overflowAccount.id);

    cleanup();
    renderApp();
    clickButton('Finances Prediction');
    fireEvent.click(screen.getByRole('tab', { name: 'Plan 2' }));
    expect(screen.getByLabelText('Maximum account balance 1')).toHaveValue(0);
    expect(screen.getByLabelText('Overflow account 1')).toHaveValue(overflowAccount.id);
  }, 15000);

  // GUI-A03 / G12–G13 — real-render duplicate career isolation with a nested
  // pay plan + allocation cap. This is a config/save-path test: it asserts the
  // canonical command writes two independent careers and reloads them separately.
  // It makes no projection/math claim about overlapping enabled careers.
  it('duplicates a career into an isolated clone whose nested pay-plan edits never reach the original', () => {
    const datedPlan = createCareerPayPlan('Dated Plan', '2026-08', createDefaultPaycheck(0), []);
    datedPlan.depositPlan = {
      allocations: [{
        id: 'dated-alloc', enabled: true, sourceType: 'account', sourceId: EMERGENCY,
        contributionRate: 3, savingsMonthly: false, monthlyWithdrawal: 0, mode: 'percentOfSalary', fixedAmount: 0
      }],
      remainderAccountId: CHECKING,
      postingDay: 1
    };
    const scenario = freshScenario((next) => {
      const career = next.careerPlan.entries[0];
      // Initial plan allocation: fixed amount with a $500 cap and an overflow account.
      career.depositPlan = {
        allocations: [{
          id: 'initial-alloc', enabled: true, sourceType: 'account', sourceId: CHECKING,
          contributionRate: 5, savingsMonthly: false, monthlyWithdrawal: 0,
          mode: 'fixedAmount', fixedAmount: 125, maxBalance: 500, overflowFallbackAccountId: EMERGENCY
        }],
        remainderAccountId: CHECKING,
        postingDay: 1
      };
      career.paycheck = createDefaultPaycheck(0);
      career.payPlans = [datedPlan];
    });
    persistScenario(scenario);
    // The exact stored source the App hydrates, so the id comparison is not invented.
    const source = decodeStored().careerPlan.entries[0];

    renderApp();
    clickButton('Finances Prediction');

    // The single career is the selected source; duplicate it through the real editor.
    expect(screen.getByRole('button', { name: 'Current Career' })).toBeInTheDocument();
    clickButton('Duplicate career');

    // Two careers now exist with distinct top-level labels; the clone is selected.
    expect(screen.getByRole('button', { name: 'Current Career' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current Career copy' })).toBeInTheDocument();

    // Edit the clone's dated plan: rename it, then set a new cap + overflow account.
    fireEvent.click(screen.getByRole('tab', { name: 'Dated Plan' }));
    fireEvent.change(screen.getByDisplayValue('Dated Plan'), { target: { value: 'Dated Plan renamed' } });
    fireEvent.change(screen.getByLabelText('Maximum account balance 1'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Overflow account 1'), { target: { value: INVESTMENTS } });

    // Switching back to the original shows its own untouched Initial cap/overflow.
    clickButton('Current Career');
    expect(screen.getByLabelText('Maximum account balance 1')).toHaveValue(500);
    expect(screen.getByLabelText('Overflow account 1')).toHaveValue(EMERGENCY);

    window.dispatchEvent(new Event('pagehide'));
    const stored = decodeStored();
    expect(stored.careerPlan.entries).toHaveLength(2);
    const original = stored.careerPlan.entries.find((entry) => entry.id === source.id);
    const clone = stored.careerPlan.entries.find((entry) => entry.id !== source.id);
    expect(original).toBeDefined();
    expect(clone).toBeDefined();

    // Distinct top-level ids; nested Initial values are preserved by the deep clone.
    expect(clone!.id).not.toBe(original!.id);
    expect(clone!.depositPlan).toEqual(original!.depositPlan);
    expect(clone!.depositPlan?.allocations[0]).toMatchObject({ maxBalance: 500, overflowFallbackAccountId: EMERGENCY });
    expect(clone!.paycheck).toEqual(original!.paycheck);

    // The clone's dated-plan edit persisted; the original stayed untouched.
    const cloneDated = clone!.payPlans?.find((plan) => plan.id === datedPlan.id);
    const originalDated = original!.payPlans?.find((plan) => plan.id === datedPlan.id);
    expect(cloneDated).toMatchObject({ label: 'Dated Plan renamed' });
    expect(cloneDated!.depositPlan?.allocations[0]).toMatchObject({ maxBalance: 900, overflowFallbackAccountId: INVESTMENTS });
    expect(originalDated).toMatchObject({ label: 'Dated Plan' });
    expect(originalDated!.depositPlan?.allocations[0].maxBalance).toBeUndefined();
    expect(originalDated!.depositPlan?.allocations[0].overflowFallbackAccountId ?? null).toBeNull();
    expect(cloneDated!.paycheck).toEqual(originalDated!.paycheck);

    // Reload re-hydrates both careers separately from the stored bytes.
    cleanup();
    renderApp();
    clickButton('Finances Prediction');
    expect(screen.getByRole('button', { name: 'Current Career' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current Career copy' })).toBeInTheDocument();
    const reloadedClone = decodeStored().careerPlan.entries.find((entry) => entry.id !== source.id);
    expect(reloadedClone?.payPlans?.[0]).toMatchObject({ label: 'Dated Plan renamed' });
  });

  // GUI-A09 / G38 — marker add/remove -----------------------------------------
  it('adds and removes a date marker through the canonical registry', () => {
    persistScenario(freshScenario());
    renderApp();

    clickButton('Finances Prediction');
    clickButton('Date markers');
    expect(screen.getByText(/No date markers yet/)).toBeInTheDocument();

    clickButton('+ Date Marker');
    expect(screen.queryByText(/No date markers yet/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('New marker');

    clickButton('Remove');
    expect(screen.getByText(/No date markers yet/)).toBeInTheDocument();
  });

  // GUI-A04 / G16–G17 — no invented source or negative hypothetical balance -----
  it('renders purchase and loan editors with truthful no-preview status', () => {
    persistScenario(freshScenario());
    renderApp();

    clickButton('Finances Prediction');
    clickButton('Purchases & expenses');
    clickButton('＋ Add one-time purchase');
    expect(screen.getByLabelText('Purchase month')).toBeInTheDocument();
    expect(screen.getByText(/No projected or hypothetical balance is shown/)).toBeInTheDocument();
    expect(screen.getByText(/does not invent an income source or simulate a negative balance/)).toBeInTheDocument();

    clickButton('＋ Add loan');
    // The canonical LoanEditor states its no-preview contract; the positive
    // linked-liability debt control is asserted once the App writer wires it.
    expect(screen.getByText(/Set the terms and payment sources\. This editor does not estimate a balance or payment outcome\./)).toBeInTheDocument();
    expect(screen.getAllByText(/applied to interest first, then principal/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/estimated payment/i)).not.toBeInTheDocument();
  });

  it('shows only observed loan funding and the signed closing debt from the shared report', () => {
    const scenario = freshScenario(next => {
      next.careerPlan = { enabled: false, entries: [] };
      next.netWorth.accounts = next.netWorth.accounts.map(account => ({ ...account, openingBalance: account.id === CHECKING ? 100 : 0 }));
      const loan = { id: 'loan-observed', label: 'Observed loan', enabled: true, showOnGraph: true, startYearMonth: '2100-12', originalAmount: 1000, downPayment: 0, currentBalance: 1000, annualInterestRate: 0, minimumMonthlyPayment: 200, extraMonthlyPayment: 0, paymentSourceAccount: CHECKING, paymentSource: `account:${CHECKING}` as const };
      next.loans = [loan];
      next.liabilities = [{ id: 'liability-observed', kind: 'loan', label: 'Observed loan', openingBalance: 1000, sourceConfigId: loan.id, annualInterestRate: 0, minimumMonthlyPayment: 200, extraMonthlyPayment: 0 }];
    });
    const report = projectFeatureScenario(scenario, { timelineId: null }).report;
    const outcome = report.outcomes.find(item => item.definitionId === 'loan:loan-observed:installment');
    const finalClose = report.months[report.months.length - 1];
    const debt = finalClose.liabilities.find(item => item.liabilityId === 'liability-observed');
    expect(outcome).toBeDefined();
    // Independent cents math: $100 cash funds a $200 request, leaving $100 unpaid;
    // APR is 0%, so the $1,000 principal closes at $900 and never goes negative.
    expect(outcome?.requestedCents).toBe(20_000);
    expect(outcome?.executedCents).toBe(10_000);
    expect(outcome?.shortfallCents).toBe(10_000);
    expect(debt?.closingPrincipalCents).toBe(90_000);
    expect(debt?.closingInterestCents).toBe(0);
    expect(finalClose.closing.netWorthCents).toBe(-90_000);

    persistScenario(scenario);
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Purchases & expenses');
    const results = screen.getByRole('region', { name: 'Observed results for Observed loan' });
    expect(within(results).getByText(/Requested \$200\.00 · paid \$100\.00 · unpaid \$100\.00/)).toBeInTheDocument();
    expect(within(results).getByText(/Remaining debt at projection close/)).toBeInTheDocument();
    expect(within(results).getByText('$900.00')).toBeInTheDocument();
    expect(within(results).queryByText(/payoff/)).not.toBeInTheDocument();
    expect(within(results).getByText(/Principal \$900\.00 · interest \$0\.00 · fees \$0\.00/)).toBeInTheDocument();
  });

  it('shows committed purchase funding across the configured primary and ordered fallbacks', () => {
    const scenario = freshScenario(next => {
      next.careerPlan = { enabled: false, entries: [] };
      next.netWorth.accounts = next.netWorth.accounts.map(account => ({ ...account, openingBalance: account.id === CHECKING ? 100 : account.id === EMERGENCY ? 60 : account.id === 'investments-account-default' ? 40 : 0, capitalGainsTaxRate: 0 }));
      next.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY, 'investments-account-default'] };
      next.largePurchases = [{ id: 'purchase-three-sources', label: 'Three-source purchase', enabled: true, showOnGraph: true, flagColor: '#abc', yearMonth: '2026-07', age: 40, amount: 200, fundingSource: undefined, categoryId: null }];
    });
    const stored = decodeAppState(encodeAppState({ scenario, ui: createDefaultUiState() }, FIXED_DATE).json, FIXED_DATE).scenario;
    persistScenario(scenario); renderApp(); clickButton('Finances Prediction'); clickButton('Purchases & expenses');
    const details = screen.getByRole('region', { name: 'Observed purchase funding' }).querySelector('details')!;
    fireEvent.click(within(details).getByText(/Funded · 2026-07/));
    expect(within(details).getByText(/Requested \$200\.00 · executed \$200\.00 · shortfall \$0\.00/)).toBeInTheDocument();
    expect(within(details).getByText(/Eligible account order at quote:/).textContent).toContain('Checking → Emergency Fund → Investments');
    const allocations = [...details.querySelectorAll('li')].map(item => item.textContent ?? '');
    expect(allocations[0]).toContain('Checking · net $100.00 · gross $100.00 · tax $0.00 · penalty $0.00');
    expect(allocations[1]).toContain('Emergency Fund · net $60.00 · gross $60.00');
    expect(allocations[2]).toContain('Investments · net $40.00 · gross $40.00');
    // The report fallback selector resolves the primary from the quote-time
    // resolved order (the global funding policy), so only the two sources drawn
    // beyond the configured primary — Emergency Fund and Investments — are
    // badged; the primary itself is not a fallback.
    expect(within(details).getAllByText('Fallback used')).toHaveLength(2);
    expect(within(details).queryByText(/Unfunded/)).not.toBeInTheDocument();
    expect(stored.netWorth.accounts.map(account => account.openingBalance)).toEqual([100, 60, 0, 40, 0]);
  });

  it('shows a zero-debit skipped purchase as unfunded without inventing a negative balance', () => {
    const scenario = freshScenario(next => {
      next.careerPlan = { enabled: false, entries: [] };
      next.netWorth.accounts = next.netWorth.accounts.map(account => ({ ...account, openingBalance: 0 }));
      next.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY] };
      next.largePurchases = [{ id: 'purchase-unfunded', label: 'Unfunded purchase', enabled: true, showOnGraph: true, flagColor: '#abc', yearMonth: '2026-07', age: 40, amount: 500, fundingSource: undefined, categoryId: null }];
    });
    persistScenario(scenario); renderApp(); clickButton('Finances Prediction'); clickButton('Purchases & expenses');
    const detail = screen.getByRole('region', { name: 'Observed purchase funding' }).querySelector('details')!;
    fireEvent.click(within(detail).getByText(/Skipped · no funds debited/));
    expect(within(detail).getByText(/Requested \$500\.00 · no debit posted · shortfall \$500\.00/)).toBeInTheDocument();
    expect(within(detail).getByText(/Skipped or unfunded/)).toBeInTheDocument();
    expect(within(detail).getByText(/No account debit was committed/)).toBeInTheDocument();
    expect(within(detail).queryByText(/-\$500/)).not.toBeInTheDocument();
    expect(detail.querySelector('summary')).toHaveClass('purchase-funding__shortfall');
  });

  it('does not apply global funding policy to an explicitly unresolved income purchase', () => {
    const scenario = freshScenario(next => {
      next.careerPlan = { enabled: false, entries: [] };
      next.netWorth.accounts = next.netWorth.accounts.map(account => ({ ...account, openingBalance: account.id === CHECKING ? 1000 : 0 }));
      next.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
      next.largePurchases = [{ id: 'purchase-income-unresolved', label: 'Income source purchase', enabled: true, showOnGraph: true, flagColor: '#abc', yearMonth: '2026-07', age: 40, amount: 500, fundingSource: 'income', categoryId: null }];
    });
    persistScenario(scenario); renderApp(); clickButton('Finances Prediction'); clickButton('Purchases & expenses');
    const detail = screen.getByRole('region', { name: 'Observed purchase funding' }).querySelector('details')!;
    fireEvent.click(detail.querySelector('summary')!);
    expect(detail.querySelector('summary')).toHaveClass('purchase-funding__shortfall');
    expect(detail.textContent).toContain('Requested $500.00 · no debit posted · shortfall $500.00');
    expect(detail.textContent).toContain('No eligible accounts');
    expect(detail.textContent).toContain('Skipped or unfunded');
    expect(detail.textContent).not.toContain('Checking →');
    expect(detail.textContent).not.toContain('Fallback used');
    expect(detail.textContent).toContain('No account debit was committed');
  });

  // GUI-A05 / G20 — housing canonical property/debt section renders -------------
  it('mounts the housing editor with its canonical property and debt section', () => {
    persistScenario(freshScenario((scenario) => {
      const home = createDefaultHousingEntry(40, '1986-06-15', FIXED_DATE);
      scenario.housing = [{ ...home, id: 'home' }];
    }));
    renderApp();

    clickButton('Finances Prediction');
    clickButton('Housing');
    expect(screen.getAllByRole('region', { name: 'Canonical property and debt' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: /results/ })).toBeInTheDocument();
  });

  it('shows an underfunded acquisition as pending from the observed close, without ownership costs', () => {
    const scenario = freshScenario(next => {
      const home = { ...createDefaultHousingEntry(next.profile.currentAge, next.options.dateOfBirth, FIXED_DATE), id: 'pending-home', label: 'Unfunded home', propertyTaxYearly: 12000, homeInsuranceYearly: 1200 };
      home.startYearMonth = '2026-07';
      next.housing = [home];
      next.properties = [{ id: 'pending-property', sourceConfigId: home.id, label: home.label, kind: 'primaryResidence', value: 0, debtLink: 'pending-mortgage', requiredDownPayment: 80000, status: 'pending', acquisitionYearMonth: '2026-07', fundingEvents: [{ id: 'fe-pending', date: '2026-07-01', amount: 80000, accountId: CHECKING }] }];
      next.liabilities = [{ id: 'pending-mortgage', kind: 'mortgage', label: 'Pending mortgage', openingBalance: 0, sourceConfigId: home.id, linkedPropertyId: 'pending-property' }];
    });
    const report = projectFeatureScenario(scenario, { timelineId: null }).report;
    const close = report.months[report.months.length - 1].properties.find(item => item.propertyId === 'pending-property');
    const costs = report.schedules.filter(item => item.definitionId.includes('housing:pending-property:') && ['housingTaxesInsurance','housingMortgagePayment'].includes(item.purpose));
    expect(close?.closingValueCents).toBe(0);
    expect(costs).toHaveLength(0);
    persistScenario(scenario);
    renderApp(); clickButton('Finances Prediction'); clickButton('Housing');
    expect(screen.getByText('Acquisition still pending')).toBeInTheDocument();
    expect(screen.getByText(`Observed property value ${displayCents(close!.closingValueCents)} · held deposit ${displayCents(close!.closingDepositCents)}`)).toBeInTheDocument();
    expect(screen.getByText('No housing obligations were observed in this projection window.')).toBeInTheDocument();
  });

  it('shows an underwater sale from its retained closing deficiency and signed report net worth', () => {
    const scenario = freshScenario(next => {
      next.netWorth.accounts = next.netWorth.accounts.map(account => ({ ...account, balance: 0 }));
      const home = { ...createDefaultHousingEntry(next.profile.currentAge, next.options.dateOfBirth, FIXED_DATE), id: 'underwater-home', label: 'Underwater home', startYearMonth: '2026-06', sellYearMonth: '2026-07' };
      next.housing = [home];
      next.properties = [{ id: 'underwater-property', sourceConfigId: home.id, label: home.label, kind: 'primaryResidence', value: 10000, debtLink: 'underwater-mortgage', requiredDownPayment: 0, status: 'owned', acquisitionYearMonth: '2020-01', sellingCostsRate: 0 }];
      next.liabilities = [{ id: 'underwater-mortgage', kind: 'mortgage', label: 'Underwater mortgage', openingBalance: 10000000, sourceConfigId: home.id, linkedPropertyId: 'underwater-property' }];
    });
    const report = projectFeatureScenario(scenario, { timelineId: null }).report;
    const close = report.months[report.months.length - 1];
    const retained = close.liabilities.find(item => item.liabilityId === 'housing:underwater-property:saleDeficiency');
    expect(retained).toBeDefined();
    expect(retained!.closingPrincipalCents + retained!.closingInterestCents + retained!.closingFeesCents).toBeGreaterThan(0);
    expect(close.closing.netWorthCents).toBeLessThan(0);
    persistScenario(scenario); renderApp(); clickButton('Finances Prediction'); clickButton('Housing');
    const deficiencyCents = retained!.closingPrincipalCents + retained!.closingInterestCents + retained!.closingFeesCents;
    expect(screen.getByText(`Sale deficiency retained as debt: ${displayCents(deficiencyCents)}. Signed net worth at projection close: ${displayCents(close.closing.netWorthCents)}.`)).toBeInTheDocument();
  });

  // GUI-A07 / G27–G28 — occurred imports stay view-only and scoped --------------
  it('keeps an occurred import view-only and removes only its source entries', () => {
    persistScenario(freshScenario((scenario) => {
      const accountId = scenario.netWorth.accounts[0].id;
      scenario.expenses = {
        ...scenario.expenses,
        activePlanningAccountId: accountId,
        categoriesByAccountId: { [accountId]: [{ id: 'food', label: 'Food' }] },
        entries: [{
          id: 'imp-1', label: 'Old train', amount: 20, startDate: '2026-06-15', endDate: '2026-06-15',
          accountId, notes: '', originType: 'imported', importSourceId: 'src', importBatchId: 'batch',
          createdAt: '2026-01-01', updatedAt: '2026-01-01', categoryId: 'food',
          provenance: 'imported', planningStatus: 'occurred', sourceDate: '2025-04-02', sourceSign: 'debit', asOf: '2025-04-30'
        }],
        imports: [{
          id: 'src', batchId: 'batch', fileName: 'statement.csv', fileType: 'csv', previewText: '',
          status: 'ready', parseNotes: [], confidence: 0.8, importedAt: '2026-06-01', appliedAt: '', entryIds: ['imp-1']
        }]
      };
    }));
    renderApp();

    clickButton('Expenses');
    expect(screen.getByText('Occurred · view only')).toBeInTheDocument();
    expect(screen.getByText('statement.csv')).toBeInTheDocument();

    clickButton('Remove source');
    expect(screen.queryByText('Occurred · view only')).not.toBeInTheDocument();
    expect(screen.queryByText('statement.csv')).not.toBeInTheDocument();
  });

  // GUI-A08 / G31–G35 — chart/table render and current-dollar toggle wires ------
  it("renders the projection chart and table and wires today's-dollars", () => {
    persistScenario(freshScenario());
    renderApp();

    clickButton('Finances Prediction');
    clickButton('Timeline');
    expect(screen.getByRole('region', { name: 'Projection chart' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Projection results' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Closing net worth' })).toBeInTheDocument();

    const toggle = screen.getByRole('checkbox', { name: /Display values in today/ });
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByRole('region', { name: 'Projection chart' })).toBeInTheDocument();
  });

  // D25 — exact engine shortfall language is rendered verbatim ------------------
  it('renders the exact engine shortfall warning for an unfunded purchase', () => {
    const scenario = freshScenario((next) => {
      const investments = next.netWorth.accounts.find((account) => account.accountType === 'taxable');
      next.largePurchases = [{
        id: 'p1', label: 'Big spend', enabled: true, showOnGraph: true, flagColor: '#abc',
        yearMonth: '2026-08', age: 0, amount: 250_000,
        fundingSource: `account:${investments?.id ?? 'missing'}`, categoryId: null
      }];
    });
    const expected = projectFeatureScenario(scenario, { timelineId: null }).report.shortfall.warning;
    expect(expected).toBeTruthy();

    persistScenario(scenario);
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Warnings');
    expect(screen.getByText(expected as string)).toBeInTheDocument();
  });

  // D24 — save lifecycle (future version / corrupt / quota / flush) -------------
  it('preserves newer-version bytes and never overwrites them from an edit', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 999, scenario: {}, ui: {} }));
    const preserved = window.localStorage.getItem(KEY);
    renderApp();

    expect(screen.getByText('Newer plan preserved')).toBeInTheDocument();
    clickButton('Net Worth');
    fireEvent.change(screen.getAllByLabelText(/Annual return/)[0], { target: { value: '3' } });
    window.dispatchEvent(new Event('pagehide'));
    expect(window.localStorage.getItem(KEY)).toBe(preserved);
  });

  it('preserves corrupt bytes on automatic saves and replaces them only on reset', () => {
    window.localStorage.setItem(KEY, 'not-json');
    renderApp();

    expect(screen.getByText('Plan needs attention')).toBeInTheDocument();
    clickButton('Net Worth');
    fireEvent.change(screen.getAllByLabelText(/Annual return/)[0], { target: { value: '3' } });
    window.dispatchEvent(new Event('pagehide'));
    expect(window.localStorage.getItem(KEY)).toBe('not-json');

    clickButton('Reset plan');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset plan' }));
    const after = window.localStorage.getItem(KEY) as string;
    expect(after).not.toBe('not-json');
    expect(JSON.parse(after)).toHaveProperty('scenario');
  });

  it('surfaces a storage-full diagnostic when a write fails', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Net Worth');

    // jsdom's localStorage is a Proxy, so prototype/instance spies are shadowed.
    // A fake Storage with a throwing setItem is swapped in for this test only.
    const realStorage = window.localStorage;
    const failingStorage = {
      length: 0,
      getItem: (key: string) => realStorage.getItem(key),
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: (key: string) => realStorage.removeItem(key),
      clear: () => realStorage.clear(),
      key: () => null
    } as unknown as Storage;

    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: failingStorage });
      fireEvent.change(screen.getAllByLabelText(/Annual return/)[0], { target: { value: '3' } });
      // `fireEvent` wraps the dispatch in `act`, so the save-status re-render flushes.
      fireEvent(window, new Event('pagehide'));
      expect(screen.getByText('Storage is full')).toBeInTheDocument();
      expect(screen.getByText('Could not write the plan to local storage.')).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: realStorage });
    }
  });

  it('flushes a debounced edit on pagehide before the delay elapses', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Net Worth');

    fireEvent.change(screen.getAllByLabelText(/Annual return/)[0], { target: { value: '4.25' } });
    window.dispatchEvent(new Event('pagehide'));

    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(stored.scenario.netWorth.accounts[0].annualReturnRate).toBe(4.25);
  });

  // GUI-A05 / G20–G22 — ordinary card add/edit/duplicate/remove + reload --------
  it('adds, edits, duplicates and removes an ordinary card payment, then reloads it', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Expenses');
    clickButton('Credit cards');

    expect(screen.getByText('No card plans in this scenario. Add a payment schedule or a permanent 0% payoff plan.')).toBeInTheDocument();

    clickButton('＋ Add expected payment');
    expect(screen.queryByText('No card plans in this scenario. Add a payment schedule or a permanent 0% payoff plan.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Streaming' } });
    fireEvent.change(screen.getByLabelText('Expected monthly payment ($)'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('First payment month'), { target: { value: '2026-08' } });
    fireEvent.change(screen.getByLabelText('Last payment month (inclusive)'), { target: { value: '2026-10' } });

    clickButton('Duplicate plan');
    expect(within(screen.getByLabelText('Selected card plan')).getByRole('option', { name: 'Streaming copy' })).toBeInTheDocument();
    expect(screen.getByLabelText('Plan name')).toHaveValue('Streaming copy');

    clickButton('Remove plan');
    expect(screen.getByLabelText('Plan name')).toHaveValue('Streaming');
    expect(within(screen.getByLabelText('Selected card plan')).getAllByRole('option')).toHaveLength(1);

    window.dispatchEvent(new Event('pagehide'));
    cleanup();
    renderApp();
    clickButton('Expenses');
    clickButton('Credit cards');
    expect(screen.getByLabelText('Plan name')).toHaveValue('Streaming');
    expect(screen.getByLabelText('Expected monthly payment ($)')).toHaveValue(15);
    expect(screen.getByLabelText('First payment month')).toHaveValue('2026-08');
  });

  // GUI-A05 / G23 — card plans are timeline-local (base vs named timeline) ------
  it('isolates an ordinary card plan between the base plan and a named timeline', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Expenses');
    clickButton('Credit cards');

    clickButton('＋ Add expected payment');
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Base card' } });

    clickButton('＋ Add timeline');
    expect(screen.getByText('Showing Timeline 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Plan name')).toHaveValue('Base card');
    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Timeline card' } });

    const timelineValue = (within(screen.getByLabelText('Selected timeline')).getByRole('option', { name: 'Timeline 1' }) as HTMLOptionElement).value;

    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: '' } });
    expect(screen.getByLabelText('Plan name')).toHaveValue('Base card');

    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: timelineValue } });
    expect(screen.getByLabelText('Plan name')).toHaveValue('Timeline card');

    window.dispatchEvent(new Event('pagehide'));
    cleanup();
    renderApp();
    clickButton('Expenses');
    clickButton('Credit cards');
    // The persisted active timeline re-opens on its own copy; the base plan is intact.
    expect(screen.getByLabelText('Plan name')).toHaveValue('Timeline card');
    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: '' } });
    expect(screen.getByLabelText('Plan name')).toHaveValue('Base card');
  });

  // GUI-A06 / G24 — permanent 0% card creates one linked global liability -------
  it('creates exactly one linked 0% liability with zero opening debt and no double-counted balance', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Expenses');
    clickButton('Credit cards');

    clickButton('＋ Add permanent 0% payoff');

    const liabilitySelect = screen.getByLabelText(/^Linked liability/);
    expect(within(liabilitySelect).getAllByRole('option')).toHaveLength(2);
    expect(within(liabilitySelect).getByRole('option', { name: 'New 0% card' })).toBeInTheDocument();

    const openingDebt = screen.getByLabelText(/^Linked opening debt/);
    expect(openingDebt).toHaveValue(0);
    expect(openingDebt).toHaveAttribute('readonly');

    // Zero opening debt means no scheduled card activity was fabricated.
    expect(screen.getByText('No scheduled card activity appears in this projection.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Plan name'), { target: { value: 'Store card' } });
    window.dispatchEvent(new Event('pagehide'));

    const stored = JSON.parse(window.localStorage.getItem(KEY) as string).scenario;
    expect(stored.liabilities).toHaveLength(1);
    expect(stored.liabilities[0]).toMatchObject({ kind: 'zeroInterestCard', openingBalance: 0 });
    expect(stored.cardPlans).toHaveLength(1);
    // The plan's own `initialBalance` is pinned to 0 so it can never double-count.
    expect(stored.cardPlans[0]).toMatchObject({ kind: 'zeroInterestPayoff', initialBalance: 0, label: 'Store card' });
    expect(stored.cardPlans[0].liabilityId).toBe(stored.liabilities[0].id);
  });

  // GUI-A06 / CA06 — funded permanent-0% payoff, real report, no APR/charges -----
  it('renders a fully funded $100 permanent-0% payoff from the real report with no APR or charge controls', () => {
    const scenario = freshScenario((next) => {
      next.careerPlan = { enabled: false, entries: [] };
      next.netWorth.accounts = next.netWorth.accounts.map((account) => ({ ...account, openingBalance: account.id === CHECKING ? 100 : 0 }));
      next.liabilities = [{ id: 'liab-zero', kind: 'zeroInterestCard', openingBalance: 100 }];
      next.cardPlans = [
        createDefaultZeroInterestCardPlan(FIXED_DATE, {
          id: 'cp-zero',
          liabilityId: 'liab-zero',
          initialBalance: 0,
          startYearMonth: '2026-07',
          targetYearMonth: '2026-09',
          paymentDay: 1,
          funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] }
        })
      ];
    });
    persistScenario(scenario);

    const expected = projectFeatureScenario(decodeStored(), { timelineId: null }).report;
    const schedule = expected.schedules.find((entry) => entry.definitionId === 'card:cp-zero');
    expect(schedule).toBeDefined();
    expect(schedule?.requestedCents).toBe(10_000);
    expect(schedule?.executedCents).toBe(10_000);
    expect(schedule?.shortfallCents).toBe(0);

    renderApp();
    clickButton('Expenses');
    clickButton('Credit cards');
    expect(screen.getByText(/requested \$100 · paid \$100 · unpaid \$0/)).toBeInTheDocument();
    // The removed APR/interest/recurring-charge card modes expose no control here.
    expect(screen.queryByLabelText(/apr|interest|charge/i)).not.toBeInTheDocument();
  });

  // GUI-A06 / D16 — partial card shortfall surfaces the exact engine warning -----
  it('renders a partial permanent-0% shortfall and the exact D16 warning from the real report', () => {
    const scenario = freshScenario((next) => {
      next.careerPlan = { enabled: false, entries: [] };
      next.netWorth.accounts = next.netWorth.accounts.map((account) => ({ ...account, openingBalance: account.id === CHECKING ? 30 : 0 }));
      next.liabilities = [{ id: 'liab-zero', kind: 'zeroInterestCard', openingBalance: 100 }];
      next.cardPlans = [
        createDefaultZeroInterestCardPlan(FIXED_DATE, {
          id: 'cp-zero',
          liabilityId: 'liab-zero',
          initialBalance: 0,
          startYearMonth: '2026-07',
          targetYearMonth: '2026-09',
          paymentDay: 1,
          funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] }
        })
      ];
    });
    persistScenario(scenario);

    const expected = projectFeatureScenario(decodeStored(), { timelineId: null }).report;
    expect(expected.shortfall.warning).toBeTruthy();
    const shortOutcome = expected.outcomes.find((outcome) => outcome.shortfallCents > 0);
    expect(shortOutcome?.definitionId).toBe('card:cp-zero');

    renderApp();
    clickButton('Expenses');
    clickButton('Credit cards');
    expect(
      screen.getByText(new RegExp(`could not be fully funded, beginning in ${shortOutcome?.yearMonth}\\. Unpaid \\$`))
    ).toBeInTheDocument();

    clickButton('Finances Prediction');
    clickButton('Warnings');
    expect(screen.getByText(expected.shortfall.warning as string)).toBeInTheDocument();
  });

  // GUI-A05 / G25–G26 — marker-linked dates + account source fallback ------------
  it('links a card date to a marker and records an account source fallback without pool aliases', () => {
    const scenario = freshScenario((next) => {
      next.careerPlan = { enabled: false, entries: [] };
      next.dateMarkers = [{ id: 'm1', label: 'Move date', date: '2026-08-15' }];
      next.netWorth.accounts = next.netWorth.accounts.map((account) => ({ ...account, openingBalance: account.id === EMERGENCY ? 60 : 0 }));
      next.cardPlans = [
        createDefaultOrdinaryCardSchedule(FIXED_DATE, {
          id: 'cp-ordinary',
          amount: 50,
          startYearMonth: '2026-07',
          endYearMonth: '2026-07',
          paymentDay: 1,
          funding: { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY] }
        })
      ];
    });
    persistScenario(scenario);

    const expected = projectFeatureScenario(decodeStored(), { timelineId: null }).report;
    expect(expected.fallback.occurrences.some((occurrence) => occurrence.definitionId === 'card:cp-ordinary')).toBe(true);

    renderApp();
    clickButton('Expenses');
    clickButton('Credit cards');
    expect(screen.getByText(/Funding fell back to a secondary source — 2026-07\./)).toBeInTheDocument();

    // Every funding option is a real account id — never a removed pool alias.
    const accountIds = new Set(freshScenario().netWorth.accounts.map((account) => account.id));
    for (const option of within(screen.getByLabelText('Primary account')).getAllByRole('option') as HTMLOptionElement[]) {
      if (option.value === '') continue;
      expect(accountIds.has(option.value)).toBe(true);
      expect(['cash', 'retirement', 'taxable', 'income']).not.toContain(option.value);
    }

    fireEvent.change(screen.getByLabelText('First payment month marker'), { target: { value: 'm1' } });
    expect(screen.getByLabelText('First payment month')).toHaveValue('2026-08');

    window.dispatchEvent(new Event('pagehide'));
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string).scenario;
    expect(stored.cardPlans[0].startMarkerId).toBe('m1');
    expect(stored.cardPlans[0].startYearMonth).toBe('2026-08');
  });

  // GUI-A05 / G20 — duplication mints a distinct pending property + $0 liability.
  it('duplicates a mortgage into a distinct pending property and $0 liability, leaving the original untouched', () => {
    const scenario = freshScenario((next) => {
      const home = { ...createDefaultHousingEntry(next.profile.currentAge, next.options.dateOfBirth, FIXED_DATE), id: 'home' };
      next.housing = [home];
      next.properties = [{
        id: 'prop-home', sourceConfigId: 'home', label: 'Future home', kind: 'primaryResidence',
        value: 300000, debtLink: 'mort-home', requiredDownPayment: 60000, status: 'pending',
        acquisitionYearMonth: home.startYearMonth,
        fundingEvents: [{ id: 'fe-home', date: `${home.startYearMonth}-01`, amount: 60000, accountId: CHECKING }]
      }];
      next.liabilities = [{ id: 'mort-home', kind: 'mortgage', label: 'My Home mortgage', openingBalance: 0, sourceConfigId: 'home', linkedPropertyId: 'prop-home' }];
    });
    persistScenario(scenario);
    const original = decodeStored();

    renderApp();
    clickButton('Finances Prediction');
    clickButton('Housing');
    clickButton('Duplicate Housing');
    window.dispatchEvent(new Event('pagehide'));

    const stored = decodeStored();
    expect(stored.housing).toHaveLength(2);
    expect(stored.properties).toHaveLength(2);
    expect(stored.liabilities).toHaveLength(2);

    const originalHousing = stored.housing.find((entry) => entry.id === 'home');
    const copyHousing = stored.housing.find((entry) => entry.id !== 'home');
    expect(originalHousing?.label).toBe('My Home');
    expect(copyHousing?.label).toBe('My Home copy');

    // Original property and liability are byte-identical to the pre-duplicate bytes.
    expect(stored.properties?.find((property) => property.id === 'prop-home')).toEqual(original.properties?.find((property) => property.id === 'prop-home'));
    expect(stored.liabilities?.find((liability) => liability.id === 'mort-home')).toEqual(original.liabilities?.find((liability) => liability.id === 'mort-home'));

    const copyProperty = stored.properties?.find((property) => property.sourceConfigId === copyHousing?.id);
    const copyLiability = stored.liabilities?.find((liability) => liability.id === copyProperty?.debtLink);
    expect(copyProperty).toBeDefined();
    expect(copyLiability).toBeDefined();
    expect(copyProperty?.id).not.toBe('prop-home');
    expect(copyProperty).toMatchObject({ status: 'pending', value: 0, requiredDownPayment: 60000 });
    expect(copyLiability).toMatchObject({ kind: 'mortgage', openingBalance: 0, sourceConfigId: copyHousing?.id, linkedPropertyId: copyProperty?.id });
    expect(copyLiability?.id).not.toBe('mort-home');
  });

  // GUI-A05 / G20 — a property-free rental is rent/income only, never a property or debt.
  it('adds and duplicates a property-free rental, reading rent and rental income from the real report', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Housing');

    clickButton('+ Rental');
    window.dispatchEvent(new Event('pagehide'));
    let stored = decodeStored();
    expect(stored.housing).toHaveLength(1);
    expect(stored.housing[0].housingType).toBe('rental');
    expect(stored.properties ?? []).toHaveLength(0);
    expect(stored.liabilities ?? []).toHaveLength(0);

    // Commit an explicit monthly rent + rental income destination through the editor.
    fireEvent.change(screen.getByLabelText('Monthly Rent'), { target: { value: '1500' } });
    fireEvent.blur(screen.getByLabelText('Monthly Rent'));
    fireEvent.change(screen.getByLabelText('Rental Income/mo'), { target: { value: '500' } });
    fireEvent.blur(screen.getByLabelText('Rental Income/mo'));
    fireEvent.change(screen.getByLabelText('Rental Income Account'), { target: { value: CHECKING } });
    window.dispatchEvent(new Event('pagehide'));
    stored = decodeStored();

    const report = projectFeatureScenario(stored, { timelineId: null }).report;
    const rentSchedule = report.schedules.find((schedule) => schedule.purpose === 'housingRent');
    expect(rentSchedule).toBeDefined();
    expect(rentSchedule?.definitionId).toContain('housing:rental:');
    expect(rentSchedule?.requestedCents).toBe(150000 * (rentSchedule?.occurrenceCount ?? 0));
    expect(screen.getByRole('region', { name: 'Apartment results' })).toBeInTheDocument();
    expect(screen.getByText('Rental costs are included below. This rental has no linked property or mortgage.')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: `Rent ${displayCents(rentSchedule!.requestedCents)} ${displayCents(rentSchedule!.executedCents)} ${displayCents(rentSchedule!.shortfallCents)}` })).toBeInTheDocument();
    const inflow = report.audit.find((row) => row.purpose === 'housingRentalIncome');
    expect(inflow).toBeDefined();
    expect(inflow?.accountChanges.some((change) => change.accountId === CHECKING && change.deltaCents === 50000)).toBe(true);

    clickButton('Duplicate Housing');
    window.dispatchEvent(new Event('pagehide'));
    const duplicated = decodeStored();
    expect(duplicated.housing).toHaveLength(2);
    expect(duplicated.housing.every((entry) => entry.housingType === 'rental')).toBe(true);
    expect(duplicated.properties ?? []).toHaveLength(0);
    expect(duplicated.liabilities ?? []).toHaveLength(0);
    const duplicateReport = projectFeatureScenario(duplicated, { timelineId: null }).report;
    const rentSchedules = duplicateReport.schedules.filter((schedule) => schedule.purpose === 'housingRent');
    expect(rentSchedules).toHaveLength(2);
    expect(new Set(rentSchedules.map((schedule) => schedule.definitionId)).size).toBe(2);
  });

  // GUI-A05 / G23 — selected-timeline housing funding events isolate base / A / B.
  it('isolates timeline-local housing funding events across base, A and B and reloads them', () => {
    const scenario = freshScenario((next) => {
      const home = { ...createDefaultHousingEntry(next.profile.currentAge, next.options.dateOfBirth, FIXED_DATE), id: 'home' };
      next.housing = [home];
      next.properties = [{
        id: 'prop-home', sourceConfigId: 'home', label: 'Future home', kind: 'primaryResidence',
        value: 300000, debtLink: 'mort-home', requiredDownPayment: 60000, status: 'pending',
        acquisitionYearMonth: home.startYearMonth,
        fundingEvents: [{ id: 'fe-home', date: `${home.startYearMonth}-01`, amount: 60000, accountId: CHECKING }]
      }];
      next.liabilities = [{ id: 'mort-home', kind: 'mortgage', label: 'My Home mortgage', openingBalance: 0, sourceConfigId: 'home', linkedPropertyId: 'prop-home' }];
    });
    persistScenario(scenario);
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Housing');

    const amount = () => screen.getByLabelText('Amount');
    expect(amount()).toHaveValue(60000);

    clickButton('＋ Add timeline');
    expect(screen.getByText('Showing Timeline 1')).toBeInTheDocument();
    // A base clone seeds its own editable copy of the base funding event.
    expect(amount()).toHaveValue(60000);
    fireEvent.change(amount(), { target: { value: '99000' } });
    fireEvent.blur(amount());
    expect(amount()).toHaveValue(99000);

    const timeline1 = (within(screen.getByLabelText('Selected timeline')).getByRole('option', { name: 'Timeline 1' }) as HTMLOptionElement).value;

    // Base is untouched by timeline A's edit.
    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: '' } });
    expect(amount()).toHaveValue(60000);

    clickButton('＋ Add timeline');
    expect(screen.getByText('Showing Timeline 2')).toBeInTheDocument();
    expect(amount()).toHaveValue(60000);

    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: timeline1 } });
    expect(amount()).toHaveValue(99000);

    window.dispatchEvent(new Event('pagehide'));
    const stored = decodeStored();
    expect(stored.properties?.find((property) => property.id === 'prop-home')?.fundingEvents?.[0].amount).toBe(60000);
    const timelineA = stored.timelines?.find((timeline) => timeline.label === 'Timeline 1');
    const timelineB = stored.timelines?.find((timeline) => timeline.label === 'Timeline 2');
    expect(timelineA?.housing[0].fundingEvents?.[0].amount).toBe(99000);
    expect(timelineB?.housing[0].fundingEvents?.[0].amount).toBe(60000);

    // Reload re-opens the last-selected timeline (A) with its own edited list.
    cleanup();
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Housing');
    expect(amount()).toHaveValue(99000);
    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: '' } });
    expect(amount()).toHaveValue(60000);
  });

  // GUI-A06 / CA06 — an observed $0 opening wins over a positive configured balance.
  it('lets an observed $0 liability opening win over a positive configured balance', () => {
    const scenario = freshScenario((next) => {
      next.careerPlan = { enabled: false, entries: [] };
      next.liabilities = [{ id: 'liab-zero', kind: 'zeroInterestCard', label: 'Store card', openingBalance: 100 }];
      next.netWorth.openingSnapshot = {
        date: next.netWorth.asOfDate,
        measurement: 'assetsMinusLiabilities',
        accounts: [],
        liabilities: [{ liabilityId: 'liab-zero', balance: 0 }]
      };
      next.cardPlans = [
        createDefaultZeroInterestCardPlan(FIXED_DATE, {
          id: 'cp-zero', liabilityId: 'liab-zero', initialBalance: 0,
          startYearMonth: '2026-07', targetYearMonth: '2026-09', paymentDay: 1,
          funding: { primaryAccountId: CHECKING, fallbackAccountIds: [] }
        })
      ];
    });
    persistScenario(scenario);

    // The observed $0 is authoritative: no scheduled card activity is fabricated.
    const expected = projectFeatureScenario(decodeStored(), { timelineId: null }).report;
    expect(expected.schedules.some((schedule) => schedule.definitionId === 'card:cp-zero')).toBe(false);
    expect(expected.outcomes.some((outcome) => outcome.definitionId === 'card:cp-zero' && outcome.requestedCents > 0)).toBe(false);

    renderApp();
    clickButton('Expenses');
    clickButton('Credit cards');
    const configured = screen.getByLabelText('Configured liability balance ($)');
    expect(configured).toHaveValue(100);
    expect(screen.getByText(/records \$0 of debt\. This observed value takes precedence, including \$0/)).toBeInTheDocument();
    expect(screen.getByText('No scheduled card activity appears in this projection.')).toBeInTheDocument();

    // Raising the configured balance never overrides the observed $0.
    fireEvent.change(configured, { target: { value: '500' } });
    expect(screen.getByText(/records \$0 of debt\. This observed value takes precedence, including \$0/)).toBeInTheDocument();
    expect(screen.getByText('No scheduled card activity appears in this projection.')).toBeInTheDocument();
    window.dispatchEvent(new Event('pagehide'));
    expect(decodeStored().liabilities?.[0].openingBalance).toBe(500);
  });

  // GUI-A10 / D20 — canonical signed-cents trajectory save/rename/compare/delete/reload.
  it('saves, renames, compares, deletes and reloads a canonical signed-cents trajectory', () => {
    persistScenario(freshScenario());
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Trajectory');
    expect(screen.getByText('No trajectories saved yet')).toBeInTheDocument();

    vi.stubGlobal('confirm', vi.fn(() => true));

    fireEvent.change(screen.getByLabelText('Snapshot name'), { target: { value: 'Spring' } });
    fireEvent.change(screen.getByLabelText('Freeze date'), { target: { value: '2026-06-15' } });
    clickButton('Save measured trajectory');

    fireEvent.change(screen.getByLabelText('Snapshot name'), { target: { value: 'Summer' } });
    fireEvent.change(screen.getByLabelText('Freeze date'), { target: { value: '2026-06-15' } });
    clickButton('Save measured trajectory');
    expect(screen.getByText('2 saved')).toBeInTheDocument();

    // Both snapshots froze the same run context, so a like-for-like comparison is offered.
    fireEvent.click(screen.getAllByRole('radio')[0]);
    expect(screen.getByText(/Ready to compare/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Rename Spring' }), { target: { value: 'Spring renamed' } });
    expect(screen.getByRole('textbox', { name: 'Rename Spring renamed' })).toHaveValue('Spring renamed');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Spring renamed' }));
    expect(screen.getByText('1 saved')).toBeInTheDocument();

    window.dispatchEvent(new Event('pagehide'));
    const stored = decodeStored();
    expect(stored.trajectorySnapshots).toHaveLength(1);

    const projection = projectFeatureScenario(stored, { timelineId: null });
    const saved = stored.trajectorySnapshots[0] as CanonicalTrajectorySnapshot;
    expect(saved.formatVersion).toBe(2);
    expect(saved.context.measurement).toBe(projection.metadata.measurement);
    // The stored cents are the actual report's reconciled year-close stocks.
    expect(saved.annualPoints).toEqual(canonicalAnnualPointsFromReport(projection.report));
    expect(saved.annualPoints[0].netWorthCents).toBe(projection.report.years[0].closing.netWorthCents);

    cleanup();
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Trajectory');
    expect(screen.getByText('1 saved')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Rename Summer' })).toHaveValue('Summer');
  });

  // GUI-A10 / D20 — a legacy snapshot stays archived and is refused cross-format.
  it('keeps a legacy trajectory archived and refuses to compare it with a canonical snapshot', () => {
    const scenario = freshScenario((next) => {
      const projection = projectFeatureScenario(next, { timelineId: null });
      const canonical = createCanonicalTrajectorySnapshot(
        { id: 'canon', label: 'Canonical', frozenDate: '2026-06-15', report: projection.report },
        projection.metadata
      );
      const legacy: TrajectorySnapshot = {
        id: 'legacy', label: 'Legacy', createdAt: '2025-01-01', survivesToEnd: true, depletedAge: null,
        endAge: 90, endingBalance: 0, summary: '', years: []
      };
      next.trajectorySnapshots = [canonical, legacy];
    });
    persistScenario(scenario);
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Trajectory');

    // Selecting the legacy entry refuses the cross-format pair (never assumed equal).
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(screen.getByText(/incompatible: format-version-mismatch/)).toBeInTheDocument();
    expect(screen.getByText(/Legacy · asset-only · not comparable/)).toBeInTheDocument();
    expect(screen.getByText(/legacy snapshot is archived as asset-only/)).toBeInTheDocument();
    expect(screen.getAllByText(/Legacy asset-only data is archived and never overlaid with signed net worth/).length).toBeGreaterThan(0);
  });

  // GUI-A05 / G20–G22 — the App injects `scenario.fundingPolicy` and an explicit
  // income-independent group override orders a payment across primary + fallback.
  it('funds a $150 income-independent housing payment as 100 + 50 and reports a fallback, not a shortfall', () => {
    const scenario = freshScenario((next) => {
      next.careerPlan = { enabled: false, entries: [] };
      next.fundingPolicy = { primaryAccountId: EMERGENCY, fallbackAccountIds: [] };
      next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
        ...account,
        openingBalance: account.id === CHECKING || account.id === EMERGENCY ? 100 : 0
      }));
      next.housing = [{
        ...createDefaultRentalEntry(next.profile.currentAge, next.options.dateOfBirth, FIXED_DATE),
        id: 'apt-1',
        startYearMonth: '2026-07',
        endYearMonth: '2026-07',
        monthlyRent: 150,
        propertyTaxYearly: 0,
        homeInsuranceYearly: 0,
        hoaMonthly: 0,
        maintenanceMonthly: 0,
        paymentSource: undefined,
        fundingPolicies: { payment: { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY] } }
      }];
    });
    persistScenario(scenario);

    const context = projectFeatureScenario(decodeStored(), { timelineId: null });
    const { report } = context;
    const rent = report.schedules.find((schedule) => schedule.definitionId.includes('housing:rental:apt-1'));
    expect(rent?.requestedCents).toBe(15_000);
    expect(rent?.executedCents).toBe(15_000);
    expect(rent?.shortfallCents).toBe(0);

    // One funded quote (primary + one fallback) and one committed posting.
    const outcomes = context.fundingOutcomes.filter((outcome) => outcome.definitionId.includes('housing:rental:apt-1'));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.committed).toBe(true);
    expect(outcomes[0]?.plan.status).toBe('funded');
    expect(outcomes[0]?.plan.executedCents).toBe(15_000);
    expect(context.postings.filter((posting) => posting.posting.definitionId?.includes('housing:rental:apt-1'))).toHaveLength(1);

    // Lower-severity fallback only: no shortfall and no eligible-account exhaustion.
    const occurrence = report.fallback.occurrences.find((entry) => entry.definitionId.includes('housing:rental:apt-1'));
    expect(occurrence).toBeDefined();
    expect(report.shortfall.warning).toBeNull();
    expect(report.exhaustion.exhausted).toBe(false);

    renderApp();
    clickButton('Finances Prediction');
    clickButton('Housing');

    const fundingOrder = within(screen.getByRole('region', { name: 'Housing funding order' }));
    // A non-overridden group reads the injected scenario.fundingPolicy (Emergency Fund)…
    expect(fundingOrder.getAllByLabelText('Primary account')[1]).toHaveValue(EMERGENCY);
    // …while the payment group shows its explicit, controlled override.
    expect(screen.getByLabelText('Override Mortgage payment / rent funding')).toBeChecked();
    expect(fundingOrder.getAllByLabelText('Primary account')[0]).toHaveValue(CHECKING);
    expect(fundingOrder.getAllByLabelText('Fallback 1')[0]).toHaveValue(EMERGENCY);

    clickButton('Warnings');
    const fallbackNote = document.querySelector('p.warning-warning');
    expect(fallbackNote?.textContent).toContain(`Funding fell back to a secondary source — ${occurrence?.yearMonth}.`);
    expect(document.querySelector('p.warning-error')).toBeNull();
  });

  // GUI-A05 / G22 — an explicit empty override stays unmet and never borrows the global default.
  it('leaves an explicit empty funding override unmet even when the global default could pay', () => {
    const scenario = freshScenario((next) => {
      next.careerPlan = { enabled: false, entries: [] };
      next.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
      next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
        ...account,
        openingBalance: account.id === CHECKING ? 150 : 0
      }));
      next.housing = [{
        ...createDefaultRentalEntry(next.profile.currentAge, next.options.dateOfBirth, FIXED_DATE),
        id: 'apt-1',
        startYearMonth: '2026-07',
        endYearMonth: '2026-07',
        monthlyRent: 150,
        propertyTaxYearly: 0,
        homeInsuranceYearly: 0,
        hoaMonthly: 0,
        maintenanceMonthly: 0,
        paymentSource: undefined,
        fundingPolicies: { payment: { primaryAccountId: CHECKING, fallbackAccountIds: [] } }
      }];
    });
    persistScenario(scenario);

    // Before the edit the global-sourced group is fully funded from the selected account.
    const before = projectFeatureScenario(decodeStored(), { timelineId: null }).report;
    expect(before.schedules.find((schedule) => schedule.definitionId.includes('housing:rental:apt-1'))?.shortfallCents).toBe(0);

    renderApp();
    clickButton('Finances Prediction');
    clickButton('Housing');
    // Clearing the override's primary leaves an explicit null-primary, empty-fallback order.
    clickButton('Remove Primary account');
    window.dispatchEvent(new Event('pagehide'));

    const stored = decodeStored();
    expect(stored.housing[0].fundingPolicies?.payment).toEqual({ primaryAccountId: null, fallbackAccountIds: [] });
    // The group override edit never mutates the global default policy.
    expect(stored.fundingPolicy).toEqual({ primaryAccountId: CHECKING, fallbackAccountIds: [] });

    const after = projectFeatureScenario(stored, { timelineId: null });
    const rent = after.report.schedules.find((schedule) => schedule.definitionId.includes('housing:rental:apt-1'));
    expect(rent?.requestedCents).toBe(15_000);
    expect(rent?.executedCents).toBe(0);
    expect(rent?.shortfallCents).toBe(15_000);
    expect(after.report.shortfall.warning).toBeTruthy();
    expect(after.report.exhaustion.exhausted).toBe(false);

    clickButton('Warnings');
    expect(screen.getByText(after.report.shortfall.warning as string)).toBeInTheDocument();
  });

  // GUI-A05 / G22–G23 — the grouped policy is timeline-local and survives save/reload.
  it('keeps a distinct grouped housing funding override per timeline across base switches and reload', () => {
    const scenario = freshScenario((next) => {
      next.housing = [{
        ...createDefaultRentalEntry(next.profile.currentAge, next.options.dateOfBirth, FIXED_DATE),
        id: 'apt-1',
        startYearMonth: '2026-07',
        endYearMonth: '2026-07',
        monthlyRent: 150,
        propertyTaxYearly: 0,
        homeInsuranceYearly: 0,
        hoaMonthly: 0,
        maintenanceMonthly: 0,
        paymentSource: undefined,
        fundingPolicies: { payment: { primaryAccountId: CHECKING, fallbackAccountIds: [] } }
      }];
    });
    persistScenario(scenario);
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Housing');

    const primary = () => within(screen.getByRole('region', { name: 'Housing funding order' })).getAllByLabelText('Primary account')[0];
    expect(primary()).toHaveValue(CHECKING);

    clickButton('＋ Add timeline');
    expect(screen.getByText('Showing Timeline 1')).toBeInTheDocument();
    // The new timeline owns an editable copy of the base override.
    expect(primary()).toHaveValue(CHECKING);
    fireEvent.change(primary(), { target: { value: EMERGENCY } });
    expect(primary()).toHaveValue(EMERGENCY);

    const timelineValue = (within(screen.getByLabelText('Selected timeline')).getByRole('option', { name: 'Timeline 1' }) as HTMLOptionElement).value;

    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: '' } });
    expect(primary()).toHaveValue(CHECKING);

    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: timelineValue } });
    expect(primary()).toHaveValue(EMERGENCY);

    window.dispatchEvent(new Event('pagehide'));
    const stored = decodeStored();
    expect(stored.housing[0].fundingPolicies?.payment?.primaryAccountId).toBe(CHECKING);
    const timeline = stored.timelines?.find((entry) => entry.label === 'Timeline 1');
    expect(timeline?.housing[0].fundingPolicies?.payment?.primaryAccountId).toBe(EMERGENCY);

    cleanup();
    renderApp();
    clickButton('Finances Prediction');
    clickButton('Housing');
    // Reload re-opens the last-selected timeline with its own grouped policy…
    expect(primary()).toHaveValue(EMERGENCY);
    // …and the base plan keeps its distinct one.
    fireEvent.change(screen.getByLabelText('Selected timeline'), { target: { value: '' } });
    expect(primary()).toHaveValue(CHECKING);
  });

  // GUI-A05 / G18–G22 — deterministic partial mortgage PI, real render.
  it('renders a report-backed partial mortgage PI with interest-first funding and a retained balance', () => {
    // Independent cent anchors, hand-calculated from the fixture (never read back
    // from report output): 6% nominal APR/12 on a $240,000 principal is $1,200/mo
    // of interest, and the standard 30-year installment is $1,438.92.
    const openingPrincipalCents = 24_000_000;
    const accruedInterestPerMonthCents = 120_000; // 24_000_000 * 0.06 / 12
    const standardInstallmentCents = 143_892; // closed-form PMT at 6%/12 over 360 months
    const availableCheckingCents = 100_000; // the only eligible account funds
    const retainedInterestCents = accruedInterestPerMonthCents * 360 - availableCheckingCents;
    const closingMortgageCents = openingPrincipalCents + retainedInterestCents;
    const expectedCloseNetWorthCents = 30_000_000 - closingMortgageCents; // $300k property − retained debt

    const scenario = freshScenario((next) => {
      next.careerPlan = { enabled: false, entries: [] };
      next.netWorth.asOfDate = '2026-06-01';
      next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
        ...account,
        openingBalance: account.id === CHECKING ? 1000 : 0
      }));
      const home = {
        ...createDefaultHousingEntry(next.profile.currentAge, next.options.dateOfBirth, FIXED_DATE),
        id: 'pi-home',
        label: 'PI Home',
        startYearMonth: '2026-06',
        sellYearMonth: '',
        purchasePrice: 300000,
        downPayment: 60000,
        annualInterestRate: 6,
        loanTermYears: 30,
        extraMonthlyPayment: 0,
        propertyTaxYearly: 0,
        homeInsuranceYearly: 0,
        hoaMonthly: 0,
        maintenanceMonthly: 0,
        pmiMonthly: 0,
        appreciationRate: 0,
        sellingCostsRate: 0,
        paymentSource: undefined,
        fundingPolicies: { payment: { primaryAccountId: CHECKING, fallbackAccountIds: [] } }
      };
      next.housing = [home];
      next.properties = [{
        id: 'pi-property', sourceConfigId: home.id, label: home.label, kind: 'primaryResidence',
        value: 300000, debtLink: 'pi-mortgage', requiredDownPayment: 0, status: 'owned',
        acquisitionYearMonth: '2020-01', appreciationRate: 0, sellingCostsRate: 0
      }];
      next.liabilities = [{
        id: 'pi-mortgage', kind: 'mortgage', label: 'PI mortgage', openingBalance: 240000,
        annualInterestRate: 6, minimumMonthlyPayment: 0, endYearMonth: '2056-05', paymentDay: 1,
        sourceConfigId: home.id, linkedPropertyId: 'pi-property'
      }];
    });
    persistScenario(scenario);

    const report = projectFeatureScenario(decodeStored(), { timelineId: null }).report;
    const schedule = report.schedules.find((row) => row.definitionId === 'housing:pi-property:mortgage');
    const firstQuote = report.outcomes.find(
      (row) => row.definitionId === 'housing:pi-property:mortgage' && row.yearMonth === '2026-06'
    );
    const close = report.months[report.months.length - 1];
    const retained = close.liabilities.find((row) => row.liabilityId === 'pi-mortgage');
    expect(schedule).toBeDefined();
    expect(firstQuote).toBeDefined();
    expect(retained).toBeDefined();

    // The first monthly PI request is the standard installment, larger than the
    // only eligible account, and is paid interest-first: $1,000 all to interest.
    expect(firstQuote?.requestedCents).toBe(standardInstallmentCents);
    expect(firstQuote?.requestedCents).toBeGreaterThan(availableCheckingCents);
    expect(firstQuote?.executedCents).toBe(availableCheckingCents);
    expect(firstQuote?.shortfallCents).toBe(standardInstallmentCents - availableCheckingCents);

    // Aggregated schedule: requested > paid > 0, shortfall is exactly the difference.
    expect(schedule!.executedCents).toBe(availableCheckingCents);
    expect(schedule!.requestedCents).toBeGreaterThan(schedule!.executedCents);
    expect(schedule!.executedCents).toBeGreaterThan(0);
    expect(schedule!.shortfallCents).toBe(schedule!.requestedCents - schedule!.executedCents);

    // The liability is retained, never written off: principal is untouched and the
    // hand-calculated accrued interest is retained.
    expect(retained!.closingPrincipalCents).toBe(openingPrincipalCents);
    expect(retained!.closingInterestCents).toBe(retainedInterestCents);
    expect(retained!.closingPrincipalCents + retained!.closingInterestCents).toBeGreaterThan(0);

    // Signed net worth stays consistent with the retained liability.
    expect(close.closing.netWorthCents).toBe(expectedCloseNetWorthCents);

    renderApp();
    clickButton('Finances Prediction');
    clickButton('Housing');

    // The selected HousingResults renders the report's requested/paid/unpaid verbatim.
    expect(screen.getByRole('row', {
      name: `Mortgage Payment ${displayCents(schedule!.requestedCents)} ${displayCents(schedule!.executedCents)} ${displayCents(schedule!.shortfallCents)}`
    })).toBeInTheDocument();
    // The month-close balance is the real retained principal + interest, not a fake estimate.
    expect(screen.getByText(`Mortgage balance at projection close: ${displayCents(closingMortgageCents)}`)).toBeInTheDocument();
    expect(screen.getByText('Some housing costs were only partly paid or went unpaid. The amounts above are from observed funding results.')).toBeInTheDocument();
    expect(screen.queryByText(/estimated payment/i)).not.toBeInTheDocument();
  });

  // GUI-A07 / G26 — the mounted App renders the weekly planner outcome summary
  // ("This week · observed planner outcomes") from the single real report, with
  // an occurred imported sibling excluded and an outside-horizon week honestly
  // labeled incomplete. The UI clock is faked to the event week only; the engine
  // start date stays explicit (`netWorth.asOfDate` = 2026-06-15).
  it('renders the weekly planner outcome summary from the real report with an occurred sibling excluded', () => {
    vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0)); // local noon, Wed 2026-10-14

    // The component formats with the ambient locale; mirror it so the expected
    // strings are the same formatting path, not an invented one.
    const usd = (cents: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);

    const plannedEntry: ExpenseEntry = {
      id: 'plan-week-25', label: 'Week groceries', amount: 25,
      startDate: '2026-10-14', endDate: '2026-10-14', accountId: CHECKING,
      notes: '', originType: 'manual', importSourceId: null, importBatchId: null,
      createdAt: '2026-06-01', updatedAt: '2026-06-01', categoryId: 'food',
      provenance: 'planner', planningStatus: 'planned',
      // Explicit ordered source: Emergency Fund ($10) primary, Checking ($15) fallback.
      fundingSource: `account:${EMERGENCY}`
    };
    const occurredEntry: ExpenseEntry = {
      id: 'imp-week-99', label: 'Imported meal', amount: 99,
      startDate: '2026-10-13', endDate: '2026-10-13', accountId: CHECKING,
      notes: '', originType: 'imported', importSourceId: 'src', importBatchId: 'batch',
      createdAt: '2026-06-01', updatedAt: '2026-06-01', categoryId: 'food',
      provenance: 'imported', planningStatus: 'occurred',
      sourceDate: '2026-10-13', sourceSign: 'debit', asOf: '2026-10-20'
    };
    const scenario = freshScenario((next) => {
      next.careerPlan = { enabled: false, entries: [] };
      next.netWorth.accounts = next.netWorth.accounts.map((account) => ({
        ...account,
        // 0% growth (first-launch default). Checking $100, Emergency Fund $10, else $0.
        openingBalance: account.id === CHECKING ? 100 : account.id === EMERGENCY ? 10 : 0
      }));
      next.expenses = {
        ...next.expenses,
        activePlanningAccountId: CHECKING,
        categoriesByAccountId: { [CHECKING]: [{ id: 'food', label: 'Food' }] },
        entries: [plannedEntry, occurredEntry]
      };
    });
    persistScenario(scenario);

    // The one real report the App composes and the mounted summary reads.
    const report = projectFeatureScenario(decodeStored(), { timelineId: null }).report;
    const planned = report.outcomes.find((outcome) => outcome.definitionId === 'planner:plan-week-25');

    // Hand-calculated anchors (never read back from report output): $25.00
    // requested, $25.00 paid across all accounts, $15.00 paid from the selected
    // Checking account, Checking close 100.00 − 15.00 = $85.00.
    expect(planned).toBeDefined();
    expect(planned?.date).toBe('2026-10-14');
    expect(planned?.committed).toBe(true);
    expect(planned?.requestedCents).toBe(2_500);
    expect(planned?.executedCents).toBe(2_500);
    expect(planned?.plan.allocations.map((allocation) => [allocation.accountId, allocation.netFundedCents]))
      .toEqual([[EMERGENCY, 1_000], [CHECKING, 1_500]]);
    // The occurred imported sibling is never a scheduled outcome.
    expect(report.outcomes.some((outcome) => outcome.definitionId === 'planner:imp-week-99')).toBe(false);

    const october = report.months.find((month) => month.yearMonth === '2026-10');
    expect(october?.accounts.find((account) => account.accountId === CHECKING)?.closingCents).toBe(8_500);

    renderApp();
    clickButton('Expenses'); // opens the default Planning sub-tab
    expect(screen.getByRole('heading', { name: 'Plan expenses by account' })).toBeInTheDocument();

    const outcomesRegion = screen.getByRole('region', { name: 'This week observed planner outcomes' });
    expect(within(outcomesRegion).getByText('This week · observed planner outcomes')).toBeInTheDocument();
    expect(within(outcomesRegion).getByText('2026-10-11 – 2026-10-17')).toBeInTheDocument();
    const outcomeValue = (label: string) => within(outcomesRegion).getByText(label).nextElementSibling?.textContent;
    expect(outcomeValue('Requested')).toBe(usd(2_500));
    expect(outcomeValue('Paid · all accounts')).toBe(usd(2_500));
    expect(outcomeValue('Paid from selected account')).toBe(usd(1_500));
    expect(within(outcomesRegion).getByText(/Occurred imports are excluded/)).toBeInTheDocument();

    // The monthly funded balance is labeled monthly and reads the real close.
    const balanceRegion = screen.getByRole('region', { name: 'Monthly funded balance' });
    expect(within(balanceRegion).getByText('Monthly · event-date engine')).toBeInTheDocument();
    // The October row carries the hand-calculated $85.00 Checking close. The
    // balance is flat afterwards (0% growth, no further activity), so the value
    // repeats across the twelve-month window — read the specific month row.
    const octoberRow = within(balanceRegion).getByText('Oct 2026').closest('li') as HTMLElement;
    expect(within(octoberRow).getByText(usd(8_500))).toBeInTheDocument();

    // The occurred sibling renders view-only; its $99 never joins the summary.
    expect(screen.getByText('Imported meal')).toBeInTheDocument();
    expect(screen.getByText('Occurred · view only')).toBeInTheDocument();
    expect(screen.getByText(usd(9_900))).toBeInTheDocument();

    // An outside-horizon week shows the incomplete label and no invented weekly
    // balance: every outcome bucket is a real $0.00.
    for (let i = 0; i < 18; i += 1) clickButton('← Previous');
    const outsideRegion = screen.getByRole('region', { name: 'This week observed planner outcomes' });
    expect(within(outsideRegion).getByText(/incomplete: outside or crossing the report window/)).toBeInTheDocument();
    expect(within(outsideRegion).getAllByText(usd(0))).toHaveLength(3);
  }, 15000);
});
