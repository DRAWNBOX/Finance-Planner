# Phase 3 — Parallel Financial Feature Streams and Paired Editors (authorized breakdown)

Implementation authorized by [ADR-022](architecture_decisions.md#adr-022--incremental-implementation-authorized-intermediate-breakage-permitted). Builds on `frozen_contracts.md` (P0.5 product contracts), ADR-021/ADR-022, `phase1_handoff.md` (canonical config/codec/commands) and `phase2_handoff.md` (kernel: `dates/money/state/taxes/funding/configuration/scheduler/valuation/projection`). Scope: the four feature streams — payroll/income, spending/retirement/planner, cards/loans, and housing/property — implemented as injected `ProjectionEventHandler`s on the kernel, plus the paired editor write-paths. Reporting (Phase 4) and full App integration (Phase 5) are downstream; the App/build/full suite remain broken and are recorded, never treated as passing.

Owner legend: S=Schema/config, K=Kernel, I=Income, O=Obligations, R=Reporting, U=UI, P=Performance, Q=Quality. O owns `obligations`/feature processors; I owns `income`/payroll; the integration owner serializes `App.tsx` and the handler-factory composition.

Inputs (frozen): `frozen_contracts.md` P0.5.1–P0.5.5 (withdrawal basis, 0% payoff, held deposit, HSA age, career breaks); P0.3.2 event phases; P0.3.3 funding/partial policy; P0.3.4 cents rounding; ADR-021. Kernel API: `phase2_handoff.md` §3 (`quoteFunding`/`commitFunding`, `solveGrossForNet`, `createScheduler`, `compileScenarioContext`, `buildState`/`commitChanges`, `EventDefinition`/`ScheduledEvent`, `ProjectionHandlerFactory`/`ProjectionEventHandler`).

---

## 0. Locked engineering decisions

### D8 — Retirement fallback flag policy (resolution of `phase2_handoff.md` §7.1)

**Confirmed by user: explicit pin overrides `allowAutomaticFallback`.** A user-pinned `retirementOrderedList` is explicit consent, so every listed source is eligible regardless of its `allowAutomaticFallback` flag. The flag governs only the **automatic** global fallback (`purpose !== 'retirement'`), never an explicitly pinned retirement list. This matches P0.3.3 item 2 — "retirement separate list (**fully pinned**)". Concretely: in `funding.ts` `resolveSourceOrder`, a `purpose === 'retirement'` request uses the pinned list **without** the `allowAutomaticFallback === false` position gate; the empty-list-means-no-sources rule is unchanged. `P3S.2` supplies the list and pins this in a test (pinned fallback with `allowAutomaticFallback === false` still funds).

### D9 — Single paycheck authority (granular `Paycheck`)

The granular `CareerEntry.paycheck` is the **sole engine authority**; `paycheck.ts` is the shared payroll compiler. `compilePaycheck`/`getPaycheckTotals` (frequency annualization, per-line per-period amounts, `percentOfGross` modes, employer vs employee buckets) are reused unchanged. The flat `PaycheckInfo` becomes **derived-only** — the engine never reads it; `resolvePaycheckInfo` stops being a runtime read point for the projection (it remains only as the legacy-editor synthesis path until P5.2 migrates the editor). `storage.ts` keeps `paycheck`/`paycheckInfo` in sync on load through Phase 3; the persisted `paycheckInfo` field is removed in a later schema bump (recorded as a P5.3/P7 follow-up, not a Phase-3 blocker). No competing flat authority is introduced.

### D10 — Handler-seam contract per stream

Each stream exports **both** the recurring `EventDefinition`s it schedules and the `ProjectionEventHandler`s that execute them; the facade (`projection.ts`) already drives the real scheduler and routes `event.handlerId` → handler. Per-stream contract:

- Handlers post **only** through `state.commitChanges` via `quoteFunding`/`commitFunding` (P2.4) and `solveGrossForNet`/`quoteWithdrawal` (P2.3); they never mutate state directly.
- Each handler returns `{ committed, plan?, diagnostics? }`; a zero/unfunded target never fabricates a plan row.
- Phase placement follows `EVENT_PHASES` (P0.3.2): `accrual` (debt interest, D13) → `income` (payroll/other income) → `cap` (account cap overflow) → `mandatory` (loan/mortgage installment, housing groups, ordinary card + 0% payoff, recurring living, retirement spending) → `discretionary` (purchases, extra debt payment) → `close` (valuation).
- A single `createFeatureHandlerFactory` (integration owner) composes the stream handlers; `DEFERRED_FEATURE_DOMAINS` shrinks per completed stream, and `featureCoverage.processors` flips to `true` only at P5 when all streams + reporting are wired.

### D11 — Single valuation owner (property appreciation + debt accrual)

`valuation.ts` is the **single owner** of all non-payment valuation postings: account APY (done, P2.7), property appreciation, and contractual debt-interest accrual (D13). P3D.3 and P3H.1 call it; no stream duplicates the formula. Account APY stays effective `(1 + r)^(1/12) − 1`; property appreciation and debt APR use their own distinct rates (D13).

### D12 — Module/test layout

One file per single responsibility, same-named `.test.ts`; runtime money is integer cents (`contracts.ts`).

| Stream | Module | Test | Owns |
|---|---|---|---|
| I | `src/engine/income.ts` | `income.test.ts` | career/pay-plan/month selection, payroll compile+post, allocations/remainder, cap overflow, other income/cashflow/life events |
| S | `src/engine/spending.ts` | `spending.test.ts` | large/long-term purchases, career monthly expenses, one-time/recurring cashflow outflows |
| S | `src/engine/retirement.ts` | `retirement.test.ts` | retirement withdrawal source lines (amount / percentOfInitialBalance) |
| S | `src/engine/planner.ts` | `planner.test.ts` | manual one-time/recurrence adapters, occurrence identity |
| D | `src/engine/cards.ts` | `cards.test.ts` | ordinary expected-payment + permanent-0% payoff |
| D | `src/engine/loans.ts` | `loans.test.ts` | loan/mortgage installment, interest/principal split, extra/down payment |
| H | `src/engine/housing.ts` | `housing.test.ts` | held-deposit acquisition, PI/tax/HOA/PMI/rent groups, sale/disposition |
| O+K | extend `src/engine/valuation.ts` | `valuation.test.ts` | property appreciation + debt-interest accrual (D11/D13) |
| K+O | `src/engine/featureHandlers.ts` | `featureHandlers.test.ts` | `createFeatureHandlerFactory` composition + coverage flags |
| K+Q | extend `src/engine/projection.ts` | `projection.test.ts` | wired-handler integration (feature CA acceptance) |

`src/paycheck.ts` is reused (not rewritten) as the payroll compiler; `src/financeModel.ts` (pool helpers) is not consumed by any stream and is removed in P7.

### D13 — Debt accrual and required-installment formula (pin for confirmation)

**Confirmed by user:** debt (loan/mortgage/0% card) accrues monthly at **nominal APR/12** (distinct from the account effective-APY rule). Required installment for amortizing debt is **max(standard amortized payment over the remaining term, configured `minimumMonthlyPayment`)**, capped at outstanding debt; no undocumented lower-rate clamp. A funded payment is allocated **interest first, then principal**; unfunded amounts retain unpaid interest/principal and missed-payment info. 0% cards accrue no interest (ADR-021). No fabricated fees/proceeds/late-payment penalties. The exact PMT fixture values must be independently computed per P0.6, not back-derived from the implementation.

### D14 — Date-based careers reconciliation

Career selection is **date-based** (month-scoped), consistent with `docs/PLAN_DATE_BASED_CAREERS.md` Phase 1 and the intended Phase 2 ("age = display only"). P3I.1 owns month-scoped selection in the compiler/handler; no age-only fallback through explicit date gaps; `resolveCurrentAge` removal (already done in P2) is intentional and its display replacement is a P4/P5.2 concern, not a Phase-3 runtime dependency. No engine code reintroduces age-derived money.

---

## Stream I — Payroll, career plans and other income

### P3I.1 (I) — Month-scoped career/pay-plan selection

**Prereqs:** P2.5/P2.6. **Deliverable:** `income.ts` selects the active `CareerEntry`/`CareerPayPlan` per month by explicit `startYearMonth`/`endYearMonth` (else the derived month; prefer most-recently-started), resolves gaps/overlaps/ties deterministically, and exposes active boundaries to the scheduler. No age-only fallback through date gaps; no ordinary deposits outside employment (salary `0` → no deposits).

### P3I.2 (I) — Payroll compilation and posting

**Prereqs:** P3I.1/P2.2. **Deliverable:** compile the granular `Paycheck` (via `paycheck.ts`) for the active plan at the effective date; scale by `raiseFactor = (1 + raiseRate)^(age − planStartAge)`; post each employee/employer retirement/HSA destination **separately** through `commitChanges`; net pay = gross − taxes − healthBenefits − otherBenefits − retirement − hsaContribution − livingExpenses (all raised), floored at 0. Employer match/deposit posted separately, never deducted from net. Deductions exceeding gross → net `$0` + diagnostic.

### P3I.3 (I) — Ordered net allocations, remainder, caps

**Prereqs:** P3I.2/P2.4. **Deliverable:** ordered bounded %-of-net / fixed-per-pay-period allocations (each with account id), `raiseFactor` scaling for fixed lines with `increaseWithPaycheck`, explicit `remainderAccountId`, and unmet allocations that stay visibly unresolved. Cap overflow posts as a direct allocation (P3I.4). No invented/duplicate deposits.

### P3I.4 (I) — Incoming cap policy

**Prereqs:** P3I.3/P2.2. **Deliverable:** incoming cap overflow → direct allocation; explicit existing-excess policy with separate audit; missing/self/cycle/restriction validation. No general transfer editor.

### P3I.5 (I + O) — Other income and month-scoped overrides

**Prereqs:** P2.6/P2.2. **Deliverable:** dated cashflow/life-event/rent/pension/benefit inflows; property sale handled by P3H, growth by valuation — never mislabeled as salary.

### P3I.6 (U + Q) — Paycheck/career/pay-plan editor write-paths

**Prereqs:** P1.6/P3I.1–P3I.5. **Deliverable:** adapt paycheck/career/pay-plan editors to canonical commands + factories; remainder/day/allocation requested-posted-unmet controls; copy/duplicate; account-only savings/expense grids. Numeric preview panels wait for P4 selectors. **Acceptance:** CA01, GUI-A03; salary-zero, multiple destinations, cap, plan changes.

**CA01 fixture (pin exact values; independently verify):** monthly paycheck, gross `$10,000`/mo, taxes `$2,000`/mo (amount), employee retirement `$500`/mo (amount, retirement account), no health/living/other benefits. Net = `$7,500`. Ordered allocations: 10%-of-net → retirement account (`$750`), fixed `$100`/period → HSA; remainder → checking (`$6,650`). Verify: gross income posted once; retirement account receives employee `$500` + allocation `$750`; HSA receives `$100`; checking `$6,650`; no double count; net = gross − deductions.

---

## Stream S — Spending, retirement, planner and imports

### P3S.1 (O) — Purchases, career expenses, cashflow outflows

**Prereqs:** P2.4/P2.6. **Deliverable:** large/long-term purchases, source quotas, career monthly expenses, recurring/one-time cashflow and generic life-event outflows, each as a funding request. Requested/paid/unpaid once; no automatic arrears debt/retry.

### P3S.2 (O) — Retirement withdrawal sources

**Prereqs:** P2.4/P2.6/P1.5. **Deliverable:** account rows with amount or `percentOfInitialBalance` mode (`initialWithdrawalRatePercent`, new-item 4%, editable 0–100), per-source `firstWithdrawalDate`/`paymentDay`, optional retirement/marker link, min/max/inflation, separate ordered retirement fallback (D8), and source-specific `initialWithdrawalValuationDate` (defaults to the source's own first withdrawal date). Net additional living spending; gross/tax/penalty separate via P2.3; cumulative per-line rounding for periodic targets (P0.3.4).

### P3S.3 (O + S) — Manual planner and recurrence

**Prereqs:** P2.6/P1.4. **Deliverable:** manual one-time/recurrence adapters; stable occurrence ids (`planner:<entryId>:<date>` / `recurrence:<eventId>:<date>`); explicit same-obligation links; one-time `endDate` is a display span; parent + occurrence never double-charge.

### P3S.4 (S + U) — Expense import adapters

**Prereqs:** P1.3/P3S.3. **Deliverable:** adapt `expenseImport.ts` to accounts/categories; preserve original `sourceDate`/`sourceSign`/`asOf`/batches/confidence/source-removal; occurred imports remain view-only; future plans use explicit status/new identity; add meaningful parser fixtures.

### P3S.5 (U + Q) — Retirement/funding/expense/planner editor write-paths

**Prereqs:** P1.6/P3S.1–P3S.4. **Deliverable:** account retirement/funding/expense/planner controls, shared recurrence previews, requested-vs-paid views, common statuses; retain drag/copy/paste/categories/sorting/flags. Numeric previews wait for P4. **Acceptance:** CA07/CA10, GUI-A02/A04/A07; no tracker scope expansion.

**CA07 fixture (from ADR-021, verbatim):** per-source rate new-item 4%, editable 0/6%, `$100k` observed balance → `$4k`/`$6k` initial target; later-start source uses its own selected-date balance; min/max/inflation; warning vs depletion.

**CA10 fixture:** one obligation per dated manual/recurring occurrence, inclusive day-31 dates, partial unpaid; occurred imports view-only with older anchor or moved display date.

---

## Stream D — Ordinary cards, permanent-0% liabilities and loans

### P3D.1 (O) — Ordinary expected-payment schedules

**Prereqs:** P2.4/P2.6. **Deliverable:** explicit start/day, inclusive end, twelve-payment factory (`end = start + 11`); executes even without card debt; no charges/APR/balance simulation.

### P3D.2 (O) — Permanent-0% liability payoff

**Prereqs:** P1.5/P2.4/P2.6. **Deliverable:** opening liability initialized once; per scheduled month `ceil(remaining principal / remaining count)` recalculated after **funded** payments; funded-only reduction/early stop; explicit residual payoff date/source; overdue retained principal; one coincident final installment+payoff (ADR-021).

### P3D.3 (O) — Loan/mortgage accrual and installment

**Prereqs:** P2.4/P2.6/D13. **Deliverable:** monthly contractual accrual (D13, via `valuation.ts`) + required installment/extra/down-payment requests; funded payment allocates interest-first then principal, caps at outstanding; retains unpaid debt + missed-payment info; no fabricated fees/proceeds.

### P3D.4 (U + Q) — Card/loan editors

**Prereqs:** P1.6/P3D.1–P3D.3. **Deliverable:** two-type card editor/date links; loan contract and opening-liability inputs; actual-funded schedule/payoff views; common status. Remove old card modes only when replacements are integrated. **Acceptance:** CA05/CA06, GUI-A05/A06; fixed-date loan-row regression.

**CA06 fixture (from ADR-021, verbatim):** ordinary `start` through `start+11` = twelve expenses/no debt; `$100` 0% over three fully funded dates = `$33.34`/`$33.33`/`$33.33`, recompute after partial payment, residual payoff once, retained debt.

**CA05 fixture (pin exact values; independently compute PMT):** fixed-date loan with full/partial/zero funding; interest accrues monthly (D13); funded principal reduces cash and debt equally; interest remains due; excess payment capped.

---

## Stream H — Housing, property valuation, acquisition and sale

### P3H.1 (O) — Opening property/mortgage + appreciation

**Prereqs:** P1.5/P2.2/P2.6/D11. **Deliverable:** observed opening property/mortgage identities; one consistent appreciation model via `valuation.ts`; contractual debt APR separate (D13). No duplicate accrual formula.

### P3H.2 (O) — Held-deposit acquisition

**Prereqs:** P2.4/P2.6. **Deliverable:** required down payment + explicit dated funding events; funded net held as non-liquid deposit; no ownership costs/PMI/appreciation/full home/mortgage while pending; completion atomically exchanges deposit for configured property/debt; cover zero-down/zero-fund/invalid completion.

### P3H.3 (O) — Housing payment groups

**Prereqs:** P3H.1/P3H.2/P3D.3. **Deliverable:** PI/extra, tax-insurance, HOA-maintenance, PMI, rent, and rental-income groups with distinct policies; funded-only debt reduction; actual principal/value drives PMI; ancillary costs persist after payoff until end/sale.

### P3H.4 (O) — Sale/disposition

**Prereqs:** P3H.1/P2.2. **Deliverable:** atomic sale: costs, linked debt settlement, actual proceeds destination, retained deficiency; configured same-date sale/purchase order; no guessed past amortization or silent underwater clearing.

### P3H.5 (U + Q) — Housing editor write-paths

**Prereqs:** P1.6/P3H.1–P3H.4. **Deliverable:** mixed mortgage/rental editor, opening observations, deposit/funding/completion status, grouped funding, sale deficiency, actual PMI/cost/payoff views; preserve reorder/duplicate/previous-end/career links. **Acceptance:** CA08/CA09, GUI-A05.

**CA09 fixture (from ADR-020, verbatim):** `$30k` held toward `$60k` → deposit `$30k`, no home/mortgage/PMI/appreciation pending; later `$30k` → atomically remove `$60k` deposit, create `$300k` property/`$240k` mortgage; no second down-payment expense; retained sale deficiency.

---

## Exit criteria

1. Each stream's focused suite passes in isolation (`income`/`spending`/`retirement`/`planner`/`cards`/`loans`/`housing` + extended `valuation`/`featureHandlers`).
2. Every handler posts only through `commitChanges`/`quoteFunding`/`commitFunding`; no separate ledgers, no fabricated income, no negative cash, no future-income spending.
3. CA01/CA05/CA06/CA07/CA09/CA10 focused acceptance passes with independently computed fixtures; CA09 demonstrates the held-deposit completion without a second down-payment expense.
4. D8–D14 are pinned in tests (retirement fallback override; granular-paycheck authority; single valuation owner; APR/12 accrual; date-based career selection).
5. Removed/impaired consumers, broken App/build/full-suite, and their restoring owners (P4 reporting, P5.2/P5.4 UI, P7 cleanup) are recorded, never treated as passing.

Phase 3 exit does **not** assert a runnable App, full suite, build, combined cross-feature behavior (P5), or reporting (P4) — ADR-022.

## Parallelism

The four streams are independently assignable once P2.6 + P2.4 exist (they do): Stream I and Stream D start immediately; Stream S and Stream H start in parallel (Stream H depends on P3D.3's accrual contract via D13). Within a stream, tasks are sequential (e.g., P3I.1 → P3I.2 → P3I.3 → P3I.4 → P3I.5 → P3I.6); editor tasks (P3I.6/P3S.5/P3D.4/P3H.5) build against canonical commands/factories now and defer numeric previews to P4. No two tasks rewrite the same module; shared edits to `valuation.ts`/`projection.ts`/`featureHandlers.ts` serialize through their owners (K/O/integration).
