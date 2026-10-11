# AGENTS

This repository supports AI-assisted development. Use this as a fast, practical jumpstart.

## Quick Start

1. Read `docs/INDEX.md` for the doc map.
2. Read runtime entry points:
   - `src/App.tsx` (composition root + tab orchestration)
   - `src/engine/projection.ts` (core deterministic simulation)
   - `src/financeModel.ts` (small helper set: ~35 lines, `normalizePurchaseFundingSource` + `getDefaultBankAccountIdForPool`)
   - `src/storage.ts` (localStorage load/save + normalizers)
3. Confirm current schema defaults and normalization:
   - `src/types.ts`
   - `src/defaultScenario.ts`
   - `src/storage.ts`

## Current Project Shape

- Stack: React 19 + TypeScript + Vite + Vitest.
- Main tabs/state: `options`, `careers`, `netWorth`, `expenses`.
- Finances Prediction sub-tabs: `retirement`, `careers`, `timeline`, `purchasesExpenses`, `housing`, `trajectory`, `warnings`.
- Expenses sub-tabs: `planning`, `tracking`, `creditCards`.
- Projection outputs drive:
  - `src/components/ChartPanel.tsx` (monthly portfolio line + credit card debt line + hover tooltip)
  - `src/components/SavingsStackedChart.tsx` (monthly stacked areas + per-pool hover tooltip)
  - `src/components/ResultsTable.tsx`
- Monthly results table supports per-month rows via `MonthlySnapshot` data (which now carries real per-month `withdrawal`/`taxesPaid`/`penaltiesPaid`).
- Universal Timelines: a global timeline bar (`addTimeline`/`switchTimeline`/`renameTimeline`/`duplicateTimeline`/`deleteTimeline`, `activeTimelineId`) snapshots purchases + long-term purchases + loans + credit cards + career plan + housing. All CRUD routes through `applyToActiveTimeline`.
- Careers: `src/components/CareerPlanEditor.tsx` (paycheck editor with retirement/HSA mode toggles).
- Housing: `src/components/HousingEditor.tsx` (chip-based editor — mortgages + rentals mixed, draggable/reorder/duplicate, inline property form, "use previous housing end date as start date").
- Credit cards: credit card debt line on portfolio chart via `ChartPanel.tsx`; Payment Schedule Projection with account balance tracking in the expenses tab.
- "Display values in current dollars" deflates graphs + summary + results table (yearly and monthly) to match.
- Net worth import/history path:
  - `src/importers/bankImport.ts`
  - `src/components/NetWorthHistoryChart.tsx`
- Expenses planning/tracking path:
  - `src/components/ExpensesPlanner.tsx`
  - `src/importers/expenseImport.ts`

## Commands

- Dev server: `npm run dev`
- Run all tests: `npm run test -- --run`
- Run engine tests: `npm run test -- --run src/engine/projection.test.ts`
- Run app integration tests: `npm run test -- --run src/App.test.tsx`
- Build: `npm run build`

## Core Invariants

- Keep projection/account math deterministic and side-effect free.
- Runtime source of truth for account-led math is `accountBalancesById`.
- Account growth compounds monthly using exact APY: `monthlyRate = Math.pow(1 + rate, 1/12) - 1`, so `(1 + monthlyRate)^12 === 1 + rate` (a stated 6.5% rate yields exactly 6.5% annually).
- Depletion detection uses `currentLedgerSum <= 0` (ledger-based), not synthetic `rawEndBalance <= 0`.
- `PaycheckInfo` on `CareerEntry` drives `monthlyTakeHome`:
  ```
  monthlyTakeHome = max(0, (salary - taxes - healthBenefits - otherBenefits - retirement - hsaContribution - livingExpenses) / 12)
  ```
  `salary` is the raised salary (`grossSalary * (1 + annualRaiseRate)^(age - startAge)`). All fields are yearly. `retirement` and `hsaContribution` are the employee-paid portions (deducted in full). Employer match is deposited separately and NOT deducted from take-home. `percentOfSalary` retirement/HSA (and the `employerMaxMatchPercent` cap) also use the raised `salary`.
- Retirement and HSA contributions are deposited per-month via `applyAccountDeposit` to their respective accounts. Employer match deposited separately.
- `PaycheckInfo` fields support mode toggles for percentage-based inputs:
  - `retirementMode`: `'amount'` | `'percentOfSalary'`
  - `retirementMatchMode`: `'amount'` | `'percentOfRetirement'`
  - `hsaContributionMode`: `'amount'` | `'percentOfSalary'`
  - `hsaEmployerMatchMode`: `'amount'` | `'percentOfHsaContribution'`
  - `employerHsaDepositMode`: `'amount'` | `'percentOfSalary'`
- `employerMaxMatchPercent` caps retirement match at a percentage of the raised salary.
- `employerHsaDeposit` is a separate flat/percentage employer HSA contribution (not tied to employee match).
- Credit card payments process monthly in the income waterfall after career contributions, before purchases.
- Credit card lump sums (`fixedPlusLump` mode) pay off remaining balance in the last month of the 0% intro period.
- SourceLine contributions (percentage-based savings) are deducted from `monthAvailableIncome`.
- Income-funded credit card balance reductions use actual `ccResult.covered`, not desired `paymentTarget`.
- `financeModel.ts` contains only active business logic (no migration helpers). All migration code has been removed — this version breaks backward compatibility with pre-2026-05 saved data.
- Income-usage validation lives in `ProjectionResult.incomeValidation`. Income-funded spends are recorded per pool inside `processIncomeWaterfall` via `recordIncomePoolUsage` (`monthly` = credit cards / monthly large + long-term purchases / housing; `yearly` = loans / age-only purchases). Each `IncomePoolUsagePeriod` carries `exceedsIncome` (`totalRequested > budget`) and `hasUnmet` (`totalShortfall > 0`). Career source-line contributions are recorded manually as the `career-source-contributions` item. This is the single choke point: any new income-funded withdrawal routed through `processIncomeWaterfall` is validated automatically. Warning-only — it never changes projection math. `incomeValidation.groups` consolidates periods with the same cause via `groupIncomeValidationPeriods` (shared item ids + requested amounts + overage, each rounded to the nearest $10 bucket); warnings and the Warnings tab render one box per group.

### Timelines
- `Scenario.timelines: Timeline[]` + `activeTimelineId: string | null`. A timeline holds independent copies of `purchases`, `longTermPurchases`, `loans`, `creditCards`, `careerPlan`, and `housing`; categories are universal.
- `activeLargePurchases`/`activeLongTermPurchases`/`activeLoans`/`activeCreditCards`/`activeCareerPlan`/`activeHousing` resolve the active timeline (or the base `scenario.*` fields when none is active).
- All purchase/career/housing/credit-card CRUD writes through `applyToActiveTimeline(transform)`.
- `addTimeline` deep-copies the active set (careers cloned with `sourceLines`/`paycheckInfo`) and activates it.

### Monthly application
- Cashflow add-ons (`cashflowItems`) and life-event income/expense are applied **monthly** (deposit/withdraw to `accountId`), not as a yearly `extraCashflow` sum. One-time items fire at their exact `startYearMonth`.
- Retirement withdrawals are spread `planned / periodMonths` per month; min/max thresholds remain a yearly cumulative check.

### Housing payment sources
- `HousingEntry` grouped sources: P&I+extra / rent (`paymentSource`), taxes+insurance (`taxesInsuranceSource`), HOA+maintenance (`hoaMaintenanceSource`), PMI (`pmiSource`); each falls back to `paymentSource`.
- `usePreviousEndAsStart` chains a housing entry's `startYearMonth` to the month after the previous entry's end (mortgage `sellYearMonth` / rental `endYearMonth`), resolved in `updateScenario`.
- Career date links (one-way housing → career): `linkedCareerStartId` drives `startYearMonth`, `linkedCareerEndId` drives `sellYearMonth` (mortgage) / `endYearMonth` (rental). Resolved in `normalizeHousingChain`, using the career's stored year-month with an age-derived fallback. The start link is mutually exclusive with `usePreviousEndAsStart`; removing a career clears links referencing it.

### Career date chaining
- `usePreviousCareerStartAge` chains a career's start to the month after the previous career's end. The start age is derived from that month (`ageFromYearMonth`), so a birthday boundary rolls the start into the next age. Resolved in `normalizeCareerEntries` for the base scenario and every timeline (`updateScenario`), in `src/storage.ts` on load, and reflected in the `CareerPlanEditor` display/onChange.

### Current-dollars deflation
- "Display values in current dollars" deflates graphs, summary, and the results table via `adjustedYears`, `adjustedMonthlySnapshots`, and `adjustedIncomeUsageByMonth` (rate = `inflationEnabled ? manualReturns.inflationRate/100 : 0`).

## Schema Change Playbook

For any persisted field addition or shape change:

1. Add/adjust types in `src/types.ts`.
2. Add defaults in `src/defaultScenario.ts`.
3. Add load-time normalization in `src/storage.ts`.
4. Ensure runtime usage in `src/App.tsx` and/or `src/engine/projection.ts`.
5. Add or update tests for both engine and UI flow when behavior changes.

## High-Risk Areas

- Retirement withdrawal funding source-line logic.
- Monthly vs yearly contribution/withdrawal conversion.
- Career timeline/source-line normalization and graph source switching.
- Career date chaining (`usePreviousCareerStartAge`) — month-after start + derived start age, normalized for base + timelines (`normalizeCareerEntries`, `updateScenario`, `storage.ts`).
- Loan, purchase, housing, and credit card funding shortfall math.
- Income-pool validation (`incomeValidation`) — two independent budgets (monthly `monthAvailableIncome` vs yearly `availableIncome`); new income-funded withdrawals must route through `processIncomeWaterfall` with the pool context (`monthly`/`yearly`, period key, label, budget) or they won't be validated.
- Income waterfall (`processIncomeWaterfall`) — per-month processing order: career contributions, credit cards, housing, loans, large purchases, long-term purchases. Each month gets its own `monthAvailableIncome` pool.
- `PaycheckInfo` formula for `monthlyTakeHome` — all fields yearly; uses the raised `salary`; retirement/HSA match math: employee pays full `retirement`/`hsaContribution`, employer match added separately to accounts.
- `MonthlySnapshot` / per-account `accountActivity` recording integrity.
- Pool-weighted portfolio return rate via `getManualRates`.
- `fundingSource` normalization (defaults to `'income'` when missing).
- `purchaseCategoryFilter` — ephemeral UI state; `sortedLargePurchases` useMemo applies category filter before sort.
- Credit card `introEnabled` + `introEndYearMonth` logic for 0% APR periods.
- Credit card `fixedPlusLump` mode and `lumpSumPaymentSource` routing.
- Depletion detection: `currentLedgerSum` is the authoritative account total; `balance` synced to it yearly.
- Purchase post-purchase balance display: simplified override only applies when `requestedSources.length === 0`.
- Large Purchases table sorting (Year-Month, Amount, Pay From) with `purchaseSort` state.
- Timeline resolution: `applyToActiveTimeline` and the `active*` derived values — editing must hit the active timeline, not the base `scenario.*` fields.
- Monthly cashflow/life-event/withdrawal application: `monthlyRetirementLines`, the cashflow/life-event monthly blocks, and per-month snapshot deltas.
- Housing grouped payment sources + `usePreviousEndAsStart` / career date links (`linkedCareerStartId`/`linkedCareerEndId`) chain normalization (base + timelines).
- Current-dollars deflation (`adjustedYears` / `adjustedMonthlySnapshots` / `adjustedIncomeUsageByMonth`) — must stay consistent across graphs, summary, and table.

## Test Focus Map

- Engine behavior: `src/engine/projection.test.ts`
- UI integration/regressions: `src/App.test.tsx`
- Import parsing: `src/importers/bankImport.test.ts`

When changing account math, funding, careers, housing, credit cards, or retirement logic, run at least engine + app tests. Also create new tests as needed to test any new logic added.

## Notes On Docs Consistency

- `docs/` is the primary onboarding source, but verify file references against `src/components` before editing.
- Some docs may reference older component names; treat runtime files as source of truth.
- `gitchanges.md` at the project root tracks all session changes chronologically.
- `testplanfix.md` at the project root tracks the test fix plan and status.

## Change Checklist

1. Types/defaults/storage stay aligned for all new or changed persisted fields.
2. Engine formula changes are covered by/validated with tests.
3. UI still renders chart/table paths correctly for Options and Finances flows.
4. `npm run test -- --run` and `npm run build` pass before handoff.
