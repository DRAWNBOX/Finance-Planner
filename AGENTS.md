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
- Finances Prediction sub-tabs: `retirement`, `careers`, `timeline`, `purchasesExpenses`, `housing`.
- Expenses sub-tabs: `planning`, `tracking`, `creditCards`.
- Projection outputs drive:
  - `src/components/ChartPanel.tsx` (portfolio line + credit card debt line)
  - `src/components/SavingsStackedChart.tsx`
  - `src/components/ResultsTable.tsx`
- Monthly results table supports per-month rows via `MonthlySnapshot` data.
- Credit card management:
  - `src/components/CareerPlanEditor.tsx` (paycheck editor with retirement/HSA mode toggles)
  - Credit card debt line on portfolio chart via `ChartPanel.tsx`
  - Payment Schedule Projection with account balance tracking in expenses tab
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
- Depletion detection uses `currentLedgerSum <= 0` (ledger-based), not synthetic `rawEndBalance <= 0`.
- `PaycheckInfo` on `CareerEntry` drives `monthlyTakeHome`:
  ```
  monthlyTakeHome = max(0, (grossSalary - taxes - healthBenefits - otherBenefits - retirement - hsaContribution - livingExpenses) / 12)
  ```
  All fields are yearly. `retirement` and `hsaContribution` are the employee-paid portions (deducted in full). Employer match is deposited separately and NOT deducted from take-home.
- Retirement and HSA contributions are deposited per-month via `applyAccountDeposit` to their respective accounts. Employer match deposited separately.
- `PaycheckInfo` fields support mode toggles for percentage-based inputs:
  - `retirementMode`: `'amount'` | `'percentOfSalary'`
  - `retirementMatchMode`: `'amount'` | `'percentOfRetirement'`
  - `hsaContributionMode`: `'amount'` | `'percentOfSalary'`
  - `hsaEmployerMatchMode`: `'amount'` | `'percentOfHsaContribution'`
  - `employerHsaDepositMode`: `'amount'` | `'percentOfSalary'`
- `employerMaxMatchPercent` caps retirement match at a percentage of gross salary.
- `employerHsaDeposit` is a separate flat/percentage employer HSA contribution (not tied to employee match).
- Credit card payments process monthly in the income waterfall after career contributions, before purchases.
- Credit card lump sums (`fixedPlusLump` mode) pay off remaining balance in the last month of the 0% intro period.
- SourceLine contributions (percentage-based savings) are deducted from `monthAvailableIncome`.
- Income-funded credit card balance reductions use actual `ccResult.covered`, not desired `paymentTarget`.
- `financeModel.ts` contains only active business logic (no migration helpers). All migration code has been removed — this version breaks backward compatibility with pre-2026-05 saved data.

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
- Loan, purchase, housing, and credit card funding shortfall math.
- Income waterfall (`processIncomeWaterfall`) — per-month processing order: career contributions, credit cards, housing, loans, large purchases, long-term purchases. Each month gets its own `monthAvailableIncome` pool.
- `PaycheckInfo` formula for `monthlyTakeHome` — all fields yearly; retirement/HSA match math: employee pays full `retirement`/`hsaContribution`, employer match added separately to accounts.
- `MonthlySnapshot` / per-account `accountActivity` recording integrity.
- Pool-weighted portfolio return rate via `getManualRates`.
- `fundingSource` normalization (defaults to `'income'` when missing).
- `purchaseCategoryFilter` — ephemeral UI state; `sortedLargePurchases` useMemo applies category filter before sort.
- Credit card `introEnabled` + `introEndYearMonth` logic for 0% APR periods.
- Credit card `fixedPlusLump` mode and `lumpSumPaymentSource` routing.
- Depletion detection: `currentLedgerSum` is the authoritative account total; `balance` synced to it yearly.
- Purchase post-purchase balance display: simplified override only applies when `requestedSources.length === 0`.
- Large Purchases table sorting (Year-Month, Amount, Pay From) with `purchaseSort` state.

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
