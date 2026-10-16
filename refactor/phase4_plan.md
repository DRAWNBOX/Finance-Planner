# Phase 4 — Authoritative Audit, Reports and Display Adapters (authorized breakdown)

Implementation authorized by [ADR-022](architecture_decisions.md#adr-022--incremental-implementation-authorized-intermediate-breakage-permitted). Builds on `frozen_contracts.md` (P0.3.1 item 11 audit / P0.3.4 cents / P0.5), ADR-021/ADR-022, `phase1_handoff.md` (codec/commands/history), `phase2_handoff.md` (kernel + `ProjectionRun`), and `phase3_handoff.md` (four feature streams + `projectFeatureScenario`). Scope: replace every competing financial preview with a view of **one** known, cents-exact result — a complete posting audit, monthly/annual reconciliation, outcome/warning selectors, a display-dollars adapter, and migrated chart/table components. The App (P5) still integrates these; GUI-A08/A10 and combined cross-feature behavior remain downstream and are recorded, never treated as passing.

Owner legend: S=Schema/config, K=Kernel, I=Income, O=Obligations, R=Reporting, U=UI, P=Performance, Q=Quality. R owns `reporting` and the audit; the integration owner serializes the facade/`App.tsx` and the postings journal seam.

Inputs (frozen): `frozen_contracts.md` P0.3.1 item 11 (audit rows: source/date/phase/occurrence, requested/executed/unpaid, gross/net/tax/penalty, touched deltas), P0.3.4 (cents/cumulative rounding), P0.5.1–P0.5.5, and the P5 warning language in `implementation_plan.md` §Phase 5. Kernel/feature API: `phase2_handoff.md` §3 + `phase3_handoff.md` §5 (`projectFeatureScenario`, `ProjectionRun`, `MonthlyClose`, `ExecutedPlanAudit`, `StateChangeSet`/`commitChanges`, `StateTotals`).

---

## 0. Locked engineering decisions

### D15 — Complete posting journal at the sole mutation point

The current `commitChanges` mutates in place and bumps a revision but records **no posting history**; the facade records only funding `plans` and account-APY `monthlyCloses`. P4.1 needs a complete, non-truncated trace of every touched account/liability/property/deposit delta. **Adopted:** journal postings at `state.commitChanges`:

- `StateChangeSet` gains `posting: PostingContext` for every **nonempty** change set — `{ occurrenceId?: string; definitionId?: string; purpose: string; date: DateOnly; phase: EventPhase | 'close' | 'opening' }`. `commitChanges` rejects an unstamped nonempty set without mutation; empty/zero-delta sets do not advance the revision or journal a row.
- Handlers stamp the posting context on every commit (funding commits via `funding.ts`, and the direct no-plan commits for income deposits, debt accrual, property appreciation, sale, rental income). The facade's month-close APY commit stamps `{ purpose: 'valuation', phase: 'close' }`.
- On a committed set, state appends one `PostingRecord` (`revision`, `sequence`, the `PostingContext`, and the sparse account/liability/property deltas + `expectedNetWorthDeltaCents`) and exposes `getPostings(): readonly PostingRecord[]`.
- The facade copies `state.getPostings()` into a new `ProjectionRun.postings` field (frozen). `run.plans` remains the funding-plan audit (requested/gross/net/tax/penalty), linked to postings by `occurrenceId`.
- Payroll is the one mixed commit whose gross/net/employee/employer legs cannot be recovered from net account deltas. Its `PostingContext.facts?` carries actual executed `grossEarningsCents`, `netPayCents`, `payrollTaxCents`, `otherDeductionsCents`, employee retirement/HSA deposits, employer retirement/HSA deposits, unresolved employee deductions retained in the remainder, and per-line requested/executed net allocations. Gross reconciles to net pay + payroll taxes + other external deductions + deposited employee contributions + unresolved retained employee deductions; employer deposits are external. Funding/other direct postings leave `facts` absent; withdrawal tax/penalty are sourced **only** from `FundingAllocation`, never payroll-tax facts.

Rejected changes journal nothing (no mutation). `PostingRecord` reuses the existing sparse delta shapes (`AccountChange`/`LiabilityChange`/`PropertyChange`); no whole-ledger copies, no truncation. (Phase 6 measures audit bytes — PS07 — but P4.1 keeps the trace complete.)

### D16 — Shortfall vs eligible-exhaustion predicate (warning language)

Two independent conditions (P0.3/P5 exact language):

- **Completeness shortfall** — any executed plan with `status !== 'funded'` (`shortfallCents > 0`). Warning: `"Some scheduled payments could not be fully funded, beginning in [month]."` (first month with a shortfall).
- **Eligible exhaustion** — a month where at least one request was short, **and** after that month's funding every *eligible* source account (per the funding policy, incl. the pinned retirement list) has balance `0`. Only then emit `"eligible funding accounts exhausted"`. A shortfall caused by policy (ineligible/restricted source, per-source quota) is **not** exhaustion. Funding plans record the ordered eligible account IDs and skipped-source reasons at quote time, so reporting selects from actual evidence rather than re-running eligibility or inferring it from allocations. Signed net worth, restrictions and property equity never prove cash exhaustion.

Fallback usage (a source beyond the primary was used) is a separate, lower-severity signal ("fell back"), never conflated with completeness or exhaustion.

### D17 — Reporting module and adapter layout

One file per single responsibility, same-named `.test.ts`; runtime reporting is integer cents; dollars/deflation is UI-only.

| Module | Test | Owner | Owns |
|---|---|---|---|
| `src/engine/reporting.ts` | `reporting.test.ts` | R | read-only audit join (plans+postings), stable indexes, monthly/annual closes, signed net worth, outcomes/warnings/selectors |
| `src/utils/viewAdapters.ts` | `viewAdapters.test.ts` | R+U | cents→dollars, current-dollar deflation factor, signed-series helpers |
| `src/components/ChartPanel.tsx` | `ChartPanel.test.tsx` | U | migrate to selectors (net-worth default / optional assets, aligned monthly debt, account-keyed series) |
| `src/components/SavingsStackedChart.tsx` | `SavingsStackedChart.test.tsx` | U | migrate to account-keyed stack/colors/legend + per-account tooltip |
| `src/components/ResultsTable.tsx` | `ResultsTable.test.tsx` | U | migrate to yearly/monthly selectors, signed axes, actual-funded columns |
| `src/components/NetWorthHistoryChart.tsx` / `TrajectoryComparisonChart.tsx` | (P4.6 tests) | R+U | signed history + frozen trajectory comparisons (D20) |

### D18 — Current-dollar deflation factor (one date-based factor)

The display-dollars adapter applies **one** date-based factor per period: `factor(t) = (1 + annualInflationRate)^(t/12)` from the opening observation date to the closing observation date (including the clipped first/last month fraction), so `currentDollars = nominalCents / factor(t)`. `annualInflationRate` is the configured inflation rate (resolved from `types.ts` at P4.4); `0`/disabled ⇒ factor `1`. Monthly, annual, tooltip, debt, property, activity and comparison values sharing a closing date use exactly that factor; nominal results are immutable and the adapter returns a parallel deflated view (it never mutates or re-runs the projection). View-only edits (labels/colors/ranges/units) never invalidate finance.

### D19 — Component migration scope (App wiring deferred)

P4.5 migrates the chart/table/summary components to consume `reporting.ts` selectors + `viewAdapters.ts`, each with a focused test. `App.tsx` wiring, tab rendering, and the full GUI-A01–A10 flows are **P5.2/P5.4**, not P4. The migrated components must not import legacy `ProjectionResult`/pool-era types; they accept `ProjectionRun` + selector output as props.

### D20 — Trajectory/history freeze metadata

Frozen trajectories carry `{ schemaVersion, engineRevision, measurement, date }`; `netWorth.history` entries remain **asset-only** and labeled (P1.5), new signed net-worth history is a distinct series, and comparisons only run between compatible `measurement`/`engineRevision`/`schemaVersion`. Never reinterpret old asset-only history as signed net worth.

---

## P4.1 (R) — Complete posting audit and indexes

**Prereqs:** P2.2/P2.6 (state/scheduler) + P3 handlers. **Deliverable:** D15 posting journal wired end-to-end; `reporting.ts` joins `run.plans` (requested/gross/net/tax/penalty/proxy metadata) with `run.postings` (touched account/debt/property/deposit deltas) by `occurrenceId`, exposing queryable indexes by source/occurrence/account/month/window. No repeated global copies; no truncated trace; only actually-committed postings.

**Files:** `src/engine/state.ts` (+journal), `src/engine/funding.ts`/stream handlers (stamp `posting`), `src/engine/projection.ts` (expose `postings`), `src/engine/reporting.ts`. **Acceptance:** every committed delta appears exactly once; funding plans link to their postings; rejected commits leave no posting.

## P4.2 (R) — Monthly/annual closes and reconciliation

**Prereqs:** P4.1. **Deliverable:** extend `MonthlyClose` (or a parallel `reporting.ts` close) to carry per-month account, property, held-deposit and liability balances plus `StateTotals` (assets/liabilities/signed net worth). Reconcile `closing = opening + Σ postings` per entity. Aggregate annual calendar sums (net income, employee/employer deposits, career savings, executed expenses, principal, interest, taxes/penalties, shortfalls) from actual months; start/close balances are first/last observations, never sums; optional age grouping is separately labeled.

**Files:** `src/engine/reporting.ts` (+ `projection.ts` close capture). **Acceptance:** CA02 (account closing = opening + postings; annual = Σ months; assets − liabilities = net worth every month).

## P4.3 (R) — Outcome, warning and funding selectors

**Prereqs:** P4.1/P4.2. **Deliverable:** selectors over the audit: shortfall vs eligible-exhaustion vs fallback (D16); first-failure month; requested-vs-executed budgets by `periodKind` (monthly/yearly); career boundaries; retirement by account; card/loan/housing/planner schedules and payoff states; scheduled-vs-executed occurrence counts. No financial calculation — pure selection over the frozen run.

**Files:** `src/engine/reporting.ts`. **Acceptance:** exact warning language (D16); exhaustion fires only when eligible sources hit zero; fallback never reported as shortfall.

## P4.4 (R + U) — Display-dollars and current-dollar adapter

**Prereqs:** P4.2/P4.3. **Deliverable:** `viewAdapters.ts` — named-context `{ measurement, startDate, endDate, engineRevision }` metadata; `toDollars(cents)`, the D18 deflation factor per period, and signed-series helpers (assets/liabilities/net worth). Nominal run immutable; deflated view derived without re-running finance.

**Files:** `src/utils/viewAdapters.ts`. **Acceptance:** factor `(1+r)^(t/12)`; disabled inflation ⇒ identity; tooltip/table/chart share the same basis and cents.

## P4.5 (U) — Migrate chart/table/summary/tooltips/warnings

**Prereqs:** P4.4. **Deliverable:** adapt `ChartPanel`, `SavingsStackedChart`, `ResultsTable` (and the summary/tooltip/warning rendering they host) to consume reporting selectors + adapters: net-worth default with optional account-assets view; aligned monthly debt line; signed axes; account-keyed stacks/colors/legend; event flags/ranges; no-career/empty transitions; warning boxes from P4.3 selectors. Retain buffered input and accessible interaction.

**Files:** the three components (+ focused `.test.tsx`). **Acceptance:** components render from `ProjectionRun` + selectors without legacy types; no local financial simulation.

## P4.6 (S + R + U) — Frozen trajectories and signed history

**Prereqs:** P1.3/P4.4. **Deliverable:** D20 freeze metadata on trajectories; retain asset-only history labels; add signed net-worth history as a distinct series; compatible measure/time comparisons only.

**Files:** `src/components/NetWorthHistoryChart.tsx`, `TrajectoryComparisonChart.tsx` (+ reporting selectors). **Acceptance:** frozen values unchanged; old assets never reinterpreted as net worth.

## P4.7 (Q) — CA02/CA12 reporting subset and reconciliation checks

**Prereqs:** P4.1–P4.6. **Deliverable:** focused reporting acceptance — annual = Σ months; account closing = opening + postings; principal-neutral net worth (debt decreases only by funded principal); withholding not double-spent; current-dollar consistency; frozen snapshots byte-stable. **CA02** fully; **CA12** at the reporting/selector level (net-worth default, account-assets view, exact shortfall-vs-exhaustion, actual-funded previews, current-dollar tooltip consistency). Full GUI-A08/A10 and App-mounted CA12 acceptance are **P5.4**.

**Files:** `reporting.test.ts`, `viewAdapters.test.ts`, component tests. **Acceptance:** CA02; CA12 reporting subset; GUI-A08/A10 recorded as P5.4-owned (not claimed here).

---

## Exit criteria

1. Focused reporting/adapter/component suites pass in isolation (`reporting`, `viewAdapters`, the three migrated chart/table components).
2. One complete, non-truncated audit: every committed posting appears exactly once and joins to its funding plan; `closing = opening + Σ postings`; assets − liabilities = signed net worth each month.
3. Warning language is exact (D16); shortfall, eligible-exhaustion and fallback are distinct selectors.
4. All previews expose the same context/units/date/actual-funded result; no account/debt/deposit double-counting; current-dollar factor consistent across table/chart/tooltip.
5. Removed/impaired consumers (App, `SavingsStackedChart`/`financeModel`, legacy result aliases) and restoring owners (P5.2/P5.4, P7) are recorded, never treated as passing.

Phase 4 exit does **not** assert a runnable App, full suite, build, GUI-A08/A10, or combined cross-feature behavior (P5) — ADR-022.

## Parallelism

P4.1 is the gating dependency (D15 journal); P4.2 and P4.3 build on it and can run in parallel once P4.1 lands (separately owned `reporting.ts` sections). P4.4 follows P4.2/P4.3; P4.5 and P4.6 follow P4.4 and are independent of each other (different component files); P4.7 runs last. Shared edits to `state.ts`/`projection.ts`/`reporting.ts` serialize through K/R/integration owner. No two tasks rewrite the same module.
