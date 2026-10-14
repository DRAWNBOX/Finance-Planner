# Session Changes — October 14, 2026

## Accepted account-only finance rules (planning only)
- Recorded the user's acceptance of a provably bounded minimal-gross quote, separately rounded gross-based tax and penalty, per-line cumulative allocation rounding, funded-only ceiling-cent 0% repayment, and the non-qualified HSA extra penalty waived at age 65 regardless of retirement.
- Specified a per-source user-configurable initial-balance withdrawal percentage (4% new-item default) and source-specific first-withdrawal valuation date; aligned ADR-021, review, frozen contracts, implementation/Phase-1 plans, architecture/save/account-only specs, and CA coverage targets.
- No finance code or test assertions changed in this documentation update; financial implementation and numeric validation remain pending.

## Phase 1+ implementation authorization and transition policy
- Recorded explicit permission in ADR-022/review.md to implement the account-only refactor and delete current consumers before their replacements are wired; intermediate App, build and existing tests may fail until all phases are completed. Final release still requires target behavior, tests/build, browser/80-year evidence and manual sign-off.
- Updated Phase 1/implementation/save/GUI/architecture plans: run focused checks on executable target modules, record exact intermediate failures and restoring owners, and make Phase 7 the final leftover-legacy sweep rather than the first removal point. Phase 1 can start with P1.1; no account-only runtime implementation is claimed by these documentation edits.
- Pre-commit verification: `npm run test -- --run` produced **207 passed / 1 failed** (unchanged `src/App.test.tsx:519` loan-row assertion); `npm run build` and `git diff --check` passed. The failing assertion remains tracked for the integrated account-only engine; no test was skipped or relabeled as passing.

---

# Session Changes — October 13, 2026

## 1. README Architecture & Feature Inventory
- Added three Mermaid diagrams to `README.md`: **code architecture** (module dependencies),
  **money-flow architecture** (per-month engine flow), and **GUI architecture**
  (tabs/sub-tabs/components), each with a "reading the diagram" note.
- Added an **Existing Features** section (grouped by area) and a **Known Bugs & Issues**
  section (confirmed / suspected defects / documentation drift) with runtime file references,
  grounded in `src/` and the `refactor/` audits.
- Corrected the GUI diagram's Expense Tracking route to the placeholder view
  (`src/App.tsx:4768`), which does not use `ExpensesPlanner`.
- Verification: docs-only change; test suite unchanged at 207/208 (pre-existing loan-row
  failure recorded in `refactor/testing_correctness_audit.md`); build passed.

## 2. Refactor Phase 0 — Readiness, baseline triage, contract freeze
- Executed Phase 0 of `refactor/implementation_plan.md` (tasks P0.1–P0.7): baseline triage, contract freeze, coverage register. No financial math replaced.
- Reproduced the pre-existing App loan-row failure (App.test.tsx:519) with a fixed fixture: income-funded loan draws from the annual income reservoir (R01/ADR-001); requested 500000 capped to 25135.42, fully covered, shortfall 0. Left unresolved (Phase 5).
- P0.6 test edits in `src/engine/projection.test.ts`: "uses 4 percent" now genuinely executes the four_percent source-line branch (sentinel amount:999999, toBeCloseTo(4000,6)); minimum-warning test retitled and now asserts the exact warning ("...below the configured minimum yearly amount from age 65."). Engine/schema/storage math untouched.
- New `refactor/coverage_register.md` (167 rows across F/R/G/GUI-A/TC/CA/MD/PS/B-P with owner/task/evidence/status).
- New `refactor/frozen_contracts.md` (P0.3/P0.4/P0.5/P0.7 frozen contracts; 9 remaining blockers).
- Recorded Phase 0 authorization in `refactor/architecture_decisions.md` (Gate B) and `refactor/review.md`.
- Verification: `npm run test -- --run` → 207/208 (same pre-existing loan-row failure, reproduced not fixed); `npm run build` passes; `src/engine/projection.test.ts` 90/90.

---

# Session Changes — October 12, 2026

## Standalone Manual Contribution Removal (Approved)
- Removed Yearly Contribution / Yearly % Increase controls, `ContributionPlan`, `Scenario.contribution`, defaults, and the unposted annual contribution/scalar fallback calculation.
- Load/save prune obsolete standalone contribution configuration without converting it into income. Career savings allocations and cashflow/life-event income remain the contribution paths.
- Added storage/UI coverage for removal/pruning; updated current characterization expectations while archiving original Pre-Step 0 snapshots under `refactor/fixtures/projection.pre-refactor.snap`.
- ADR-005 and feature F21/R03 now record approved removal; remaining architecture proposals stay pending review.
- Verification: full suite 207/208 passed (same pre-existing loan-row highlighting failure); all new UI/storage/characterization tests passed, build and whitespace checks passed.

## 1. Money Flow Documentation
- New `docs/MONEY_FLOW.md`: a Mermaid block diagram of how money moves through the engine (sources → reservoirs → routing → destinations) with a blocks-to-code legend and notes on the two-reservoir model (income pools vs `ledgerAccounts`)
- Linked from `docs/INDEX.md` ("Start Here")

---

# Session Changes — October 11, 2026

## Date-Based Career Selection (Phase 1 of PLAN_DATE_BASED_CAREERS.md)
- `projection.ts` now selects the active career **per month by date** (`getCareerEntryForMonth` + `careerBoundarySerial`) instead of per age-year (`getCareerEntryForAge` stays only as the year-label/legacy fallback). Fixes overlapping careers at the same age but different months misattributing income, source-line deposits, and the monthly income budget.
- Month loop uses a per-month `monthCareer` for the paycheck, net-pay plan, source lines, raise base, salary, and negative-net-pay label; monthly snapshot/waterfall `careerLabel` follows the month.
- `careerEndSavingsBalances` now records at each career's **end month** (explicit `endYearMonth`, else the age-derived last month) rather than the year-scoped `age === endAge` check, so overlapping ages no longer misfire.
- Tests: engine test with two careers overlapping at age 27 but split across months asserts per-month net income/take-home and per-career end balances; existing tests unchanged.

## 8. Date Markers
- New `DateMarker` (`id`, `label`, `date`) on `Scenario.dateMarkers`; configured in a new "Date Markers" sub-tab to the right of Warnings
- Every editable year-month field gained an optional companion `*MarkerId` (`CareerEntry`, `LargePurchase`, `LongTermPurchase`, `Loan`, `CreditCard`, `HousingEntry`, `CashflowItem`, `LifeEvent`) and every editable full-date field on `ExpenseEntry` / `RecurringExpenseEvent`
- `src/utils/dateMarkers.ts`: `resolveDateMarkers` overwrites each literal from its marker (year-month fields use `date.slice(0,7)`, expense fields use the full date), derives age-coupled fields (careers/add-ons/life events) from the resolved month, and clears dangling references while keeping the last literal
- Resolution runs at the top of `updateScenario` (before career/housing chaining) and after load in `storage.ts`, so changing a marker moves every referencing field together
- Housing chaining honors markers with highest priority (`startMarkerId` > career link > previous-end; end markers > career end link)
- New `DateOrMarkerInput` (Date/Marker mode toggle) replaces all `YearMonthInput` call sites (App purchases/long-term/loan/credit-card, `CareerPlanEditor`, `CashflowItemEditor`, `HousingEditor`) and the expense entry/recurring/one-time date inputs; choosing a marker clears conflicting chain flags
- New `DateMarkersEditor` component + `renderDateMarkersTab`; deleting a referenced marker warns with the referencing fields and clears references on confirm
- Storage: `dateMarkers` normalizer (`DateMarker`), marker-id normalization for every collection, and post-load marker resolution; also fixed `normalizeExpensesSubTab` to accept `'creditCards'`
- Tests: `src/utils/dateMarkers.test.ts` (resolution, cascade, age coupling, dangling cleanup, no-op) + App tests for the tab and a housing start linked to a marker

## 1. Career Duplicate-ID Fix
- `createDefaultCareerEntry(index, currentAge, retirementAge, id?)` now accepts an explicit id (defaultScenario.ts)
- `addCareer` assigns a unique `makeCareerId()` so re-adding after a removal can no longer reuse an existing id (App.tsx)
- `ensureUniqueCareerIds` deterministic de-duplication applied in `normalizeCareerEntries` (App.tsx) and storage load (storage.ts)

## 2. Paystub Paycheck Model + Modal Editor
- New `Paycheck` / `PaycheckCategory` / `PaycheckLine` on `CareerEntry.paycheck`: categories of lines by `kind` (earning/tax/pretax/posttax/employer), per-period amount or `percentOfGross`, optional deposit `accountId`/`bucket`, and YTD (types.ts)
- `src/paycheck.ts`: `compilePaycheck` (frequency 52/26/24/12), `getPaycheckTotals`, `resolvePaycheckInfo`, `createDefaultPaycheck`, `paycheckFromPaycheckInfo`
- `PaycheckEditorModal.tsx`: pay frequency, earnings (rate/hours/period/YTD), statutory taxes, other deductions, employer benefits; add/remove line items; live totals
- `CareerPlanEditor` shows a paycheck summary card + "Configure Paycheck" button (replaces the old Income & Deductions grid)
- Storage auto-migrates: a saved `paycheck` compiles into `paycheckInfo`; a legacy-only `paycheckInfo` synthesizes a `paycheck`

## 3. Paycheck Net Pay Drives Engine Income
- `monthlyTakeHome` is now the paycheck's net pay, with every paycheck amount scaled by `raiseFactor = (1 + annualRaiseRate)^(age − startAge)` (projection.ts)
- It drives the monthly income pool, the yearly budget, Timeline take-home, fallback thresholds, and income validation
- Source-line contributions are a percentage of **net income** (not gross)
- `netIncome` added to `ProjectionYear` / `MonthlySnapshot` / `TrajectoryYear`; results table "Salary" column replaced with "Net income"; career savings grid + summary compute against net income

## 4. Fixed-Deposit "Increase with Paycheck" Toggle
- `CareerSourceLine.increaseWithPaycheck` scales fixed `fixedAmount` deposits by the raise (projection.ts)
- Toggle added to the career savings grid; App + storage normalizers now preserve `mode` / `fixedAmount` / `increaseWithPaycheck` (previously stripped by the App normalizer)

## 5. Monthly-Withdrawal Shortfalls + Growth
- `ProjectionResult.careerWithdrawalShortfalls` tracks unfunded "Expenses (Monthly Withdrawals by Account)" withdrawals; aggregated engine warning + red row indicator with tooltip
- `CareerSourceLine.increaseWithdrawalWithPaycheck` optional growth toggle; monthly withdrawals remain account-funded

## 6. Runtime Income-Fallback Validation
- `updateScenario` re-validates `incomeFallbackAccountId` / `incomeFallbackAccountId2` against the current bank accounts and clears missing ones (App.tsx)
- Dismissible `incomeFallbackNotice` shown in the Income Fallback Accounts section

## 7. Paycheck Modal Polish
- Backdrop click no longer closes the paycheck modal
- Removed the category name input and the add-category controls

## 8. Net Pay Plans (per-career dated pay changes)
- New `CareerPayPlan` (`id`, `label`, `effectiveYearMonth`, `effectiveMarkerId`, full `paycheck` + `sourceLines`, optional `annualRaiseRate`) on `CareerEntry.payPlans`; the career's own paycheck/sourceLines are the Initial plan (types.ts)
- Editor: a "Net pay plan" **chip selector** below the "Estimate income from this career" checkbox with add/remove/rename and a `DateOrMarkerInput` effective date; the paycheck modal and the savings/expenses grids edit the selected plan (CareerPlanEditor.tsx)
- Engine resolves the active plan **per month** (`resolveActiveCareerPayPlan`) so income, deposits, and monthly withdrawals switch at the exact effective month; a plan's salary grows by the career raise from its effective date (projection.ts)
- `src/paycheck.ts`: `clonePaycheck`, `cloneSourceLines`, `createCareerPayPlan`
- Date markers: `resolveDateMarkers` resolves each plan's `effectiveMarkerId` → `effectiveYearMonth` (base + timelines); `describeMarkerReferences` lists plan references (utils/dateMarkers.ts, App.tsx)
- Storage normalizes `payPlans` (paycheck + sourceLines); `cloneCareer` and the App source-line normalizer handle plans (storage.ts, App.tsx)

## 9. Income Verification Warnings
- Engine warns when a paycheck/plan's deductions exceed its gross pay (net pay would be negative and is treated as `$0`) — per career/plan, surfaced in the Warnings tab (projection.ts)
- Housing chips now show yellow (fallback) / red (shortfall) income indicators with a tooltip (and a note in the editor), mirroring purchases/loans; income-funded housing usage was already recorded in `incomeValidation` (HousingEditor.tsx, App.tsx, styles.css)
- Career paycheck summary marks "Net pay / period" red with a hint when deductions exceed gross (CareerPlanEditor.tsx)
- Confirmed: income-funded purchases/housing draw from the active net-pay plan's monthly net pay, and the pool is clamped at 0 (never negative)

## 10. Credit Card Income Verification
- Autopay income-funded credit card payments now record `incomeFundedItemStatuses` (fallback/shortfall), matching the fixed/minimum/pay-in-full/fixedPlusLump modes (projection.ts)
- Credit-card list rows show a yellow (fallback) / red (shortfall) indicator with a tooltip, and account-funded cards surface `creditCardFundingShortfalls`; the Payment Schedule Projection shows a per-card income notice (App.tsx)
- Account-funded credit-card funding shortfalls now also emit an engine warning, so credit cards appear in the Warnings tab in every payment mode (projection.ts)
- Income-funded credit cards were already included in the income-usage warnings calculation (`incomeValidation`), which the Warnings tab renders

## 11. Credit Card Autopay End Date
- `CreditCard.autopayEndYearMonth` + `autopayEndMarkerId`: autopay now pays through and including the end month and stops after (types.ts, projection.ts)
- Storage normalizes the new fields; date markers resolve `autopayEndMarkerId` → `autopayEndYearMonth` and `describeMarkerReferences` lists it (storage.ts, utils/dateMarkers.ts, App.tsx)
- Editor: an "Autopay Ends" `DateOrMarkerInput` (required; auto-filled to current month + 12 when switching a card to autopay) and the card row shows `until YYYY-MM` (App.tsx)

## 12. Summed Housing Expense in Income Warnings
- Income-funded housing (down payment + P&I/rent, taxes & insurance, HOA/maintenance, PMI) is now drawn from income in a single `processIncomeWaterfall` call per housing entry per month, so the Warnings tab lists one summed "housing expense" line instead of each sub-item separately (projection.ts)

## 13. Depletion Detection Only on Actual $0
- Removed the hard-coded `$100k` net-worth floor heuristic; `depleted` is now `currentLedgerSum <= 0` only, so "runs out of money at age X" (and the ending balance) reflect the real ledger (projection.ts)
- `withdrawal < requiredMinimumWithdrawalForPeriod` is now a Warnings-tab entry instead of a depletion trigger (projection.ts)
- Fixes the reported case where the summary said "runs out at 54" while the graph/table still showed positive balances

---

# Session Changes — June 19, 2026

## 1. Taxes & Penalties Tracking in Results Table
- Added `taxesPaid` and `penaltiesPaid` fields to `ProjectionYear` (types.ts)
- Engine tracks tax/penalty amounts from ALL withdrawal types (retirement, purchases, loans, career monthly, housing)
- New "Taxes" and "Penalties" columns in ResultsTable after "Withdrawal"
- Tax/penalty split proportional to pool's `taxRate` / `penaltyRate`

## 2. Merged Extra Cashflow Column
- Removed "Extra Cashflow" column from ResultsTable
- Withdrawal column now shows `year.withdrawal + year.extraCashflow` combined

## 3. Display Values in Current Dollars
- Checkbox above ResultsTable toggles inflation-adjusted display
- All monetary columns deflated by cumulative inflation factor from baseline year
- No engine changes — pure display transformation via `adjustedTableYears`

## 4. Tax Rate Lock in Career Timeline
- Lock/unlock button on Tax Rate % input
- When locked: editing other fields recalculates leftoverIncome from locked rate
- `taxRateLocked: boolean` on TaxInfo type

## 5. Housing Expenses Feature
- New `HousingEntry` type supporting mortgages and rentals
- "Housing Expenses" sub-tab under Finances Prediction
- Engine processes: mortgage amortization, PMI auto-drop (80% LTV), property tax, insurance, HOA, maintenance
- Rental income deposits to specified account via reusable `applyAccountDeposit()`
- Sell proceeds at sell date with account selection
- Rental End Date field for apartment leases
- Split into separate Mortgage and Rental tables for cleaner UI

## 6. Inflation Simplification
- Removed `ReturnMode` (manual/historical) — manual is now the only mode
- Removed `HistoricalYear` type and `src/data/historicalReturns.ts`
- Removed `inflationAdjusted` from CashflowItem, LifeEvent, WithdrawalPlan
- Removed per-item "Adjust for inflation" checkboxes
- Inflation now controlled exclusively by global "Enable inflation" toggle
- "Inflation" panel moved to Options tab (after Age Options)
- Removed `equityAllocation`, `fixedIncomeAllocation`, `fixedIncomeDuration` from PortfolioConfig
- Portfolio return rate now balance-weighted average of pool rates
- Removed `fixedIncomeReturn`, `preRetirementEquityReturn`, `postRetirementEquityReturn` from ManualReturnModel
- PoolDefinition split into `preRetirementReturnRate` / `postRetirementReturnRate`
- Net Worth tab shows Pre-Ret %, Retirement Spending shows Post-Ret %
- Removed Portfolio Returns panel from Options tab

## 7. Retirement Withdrawal Pool Fallback
- When a retirement withdrawal source pool is exhausted, engine falls back to other pools in priority order
- Automatically covers gap from next available pool
- Prevents false "plan runs out of money" due to pool-level shortfall

## 8. Housing Income Status Tracking
- Added `incomeFundedItemStatuses[housing.id]` tracking for all housing income paths
- Housing rows now show yellow (fallback) / red (shortfall) highlighting
- Hover tooltip shows income usage breakdown and fallback account details

## 9. Funding Source Normalization Fix
- `fundingSource` now defaults to `'income'` instead of `undefined` in storage normalization
- Added missing `fundingSource` to long-term purchase normalization
- Engine added defensive `?? 'income'` on all purchase funding checks

## 10. Fallback Account Warning
- Engine emits warning when income-funded items exceed available income without fallback accounts configured
- Hint text added below Income Fallback Accounts dropdowns in Career Timeline

## 11. Monthly Income Processing for Purchases
- Income-funded and account-funded large purchases now processed per-month (not per-year)
- Each month gets its own `monthlyTakeHome` pool instead of annual pool
- Long-term income-funded purchases also processed monthly
- Fixes bug where $2,000 purchase appeared covered by $1,389/mo income (was using annual pool)
- Column shows per-month post-purchase account balances

## 12. Purchase Tooltip
- Rich tooltip on ALL purchase rows (not just non-viable ones)
- Shows: funding source breakdown, income vs fallback split, all items competing that month
- Arrow (→) marks current purchase in the items list

## 13. Removed Housing Costs & Leftover Income Fields
- Removed "Housing Costs (monthly)" input from Career Tax Info
- Removed "Leftover Income (monthly)" input — tax rate now drives leftover income exclusively
- Added "Monthly Savings" display field (dollar amount saved per month)
- Fixed AGENTS.md formula: `monthlyTakeHome = max(0, leftoverIncome/12 - otherExpenses)`

## 14. Null Check for Shortfall Test
- Fixed shortfall detection test to verify `fallbackDetails` array length instead of just status
- Added proper null-check assertions for fallback account balances

## 15. Correct Account Balance Column for Income Purchases
- Changed "Account Balance After Purchase" from text labels to dollar amounts
- Shows remaining monthly income from `incomeUsageByMonth` data
- Shows fallback account post-debit balance when fallback was used
