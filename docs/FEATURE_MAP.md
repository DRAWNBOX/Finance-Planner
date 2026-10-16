# Feature Map

Map of visible features to implementation files. All views read the single
`ProjectionReport` produced by `projectFeatureScenario`
(`src/engine/featureHandlers.ts`).

## Retirement Panel

- UI/controls: `src/App.tsx` (Finances Prediction → `retirement` sub-tab)
- Editor: `src/components/RetirementSpendingEditor.tsx`
- Observed results: `src/components/RetirementWithdrawalResults.tsx`
- Engine: `src/engine/retirement.ts`

## Options

- UI/controls: `src/App.tsx` (`options` tab → `profile` sub-tab)
- Inflation panel: global enable/disable and rate
- Results display: shares the Finances Prediction summary path

## Career Timeline Editor

- Editor: `src/components/AccountCareerPlanEditor.tsx`
- Paycheck modal: `src/components/PaycheckEditorModal.tsx`
- Date inputs: `src/components/DateOrMarkerInput.tsx`
- Integrates start/end dates and derived ages, the granular paycheck
  (gross, taxes, benefits, retirement/HSA + match, living expenses), ordered
  net-pay allocations + remainder, per-allocation max-balance caps and overflow
  accounts, income fallback accounts, and duplicate/remove/reorder.
- Paycheck compilation: `src/paycheck.ts`
- Engine: `src/engine/income.ts`

## Timelines (Universal)

- Multiple named timelines, each holding independent copies of large purchases,
  long-term purchases, loans, credit cards, card plans, career plan and housing.
- UI: `src/App.tsx`; `src/components/TimelineManager.tsx`
- Writes route through `applyToActiveTimeline` / the timeline CRUD commands in
  `src/commands.ts`.
- Type: `Timeline` in `src/types.ts`; normalized in `src/codec.ts`.

## Purchases and Loans

- Purchase editor: `src/components/PurchaseEditor.tsx`
- Loan editor: `src/components/LoanEditor.tsx`
- Observed funding detail: `src/components/PurchaseFundingResults.tsx`
- Observed loan detail: `src/components/LoanResults.tsx`
- Engine: `src/engine/spending.ts` (purchases), `src/engine/loans.ts` (loans)
- Funding kernel: `src/engine/funding.ts`

## Housing Expenses

- Chip-based editor: `src/components/HousingEditor.tsx` (mortgages + rentals in
  one draggable list, inline property form, duplicate/remove/reorder,
  "use previous housing end date as start date")
- Grouped payment sources per entry: P&I+extra / rent (`paymentSource`),
  taxes+insurance, HOA+maintenance, PMI, with an ordered per-group
  `fundingPolicies` override map
- Observed results: `src/components/HousingResults.tsx`
- Engine: `src/engine/housing.ts` (per-month mortgage/rental processing, held
  acquisition deposit, PMI by actual LTV, rental income, sale proceeds)
- Type: `HousingEntry` in `src/types.ts`

## Warnings

- UI: `src/App.tsx` (`warnings` sub-tab). It renders the D16 selectors verbatim
  plus `context.diagnostics`; it never re-runs funding.
- Selectors: `report.shortfall`, `report.exhaustion`, `report.fallback` in
  `src/engine/reporting.ts`
- Sub-tab id: `warnings` (`src/codec.ts`)

## Trajectory

- UI: `src/components/TrajectoryManager.tsx` (save/name immutable snapshots)
- Overlay chart: `src/components/TrajectoryComparisonChart.tsx`
- Snapshots freeze the projection output (`TrajectorySnapshot` /
  `TrajectoryYear` in `src/types.ts`); compare selection lives in the UI state.
- Adapters: `src/trajectoryFreeze.ts`, `src/trajectoryReportAdapter.ts`

## Credit Cards

- UI: `src/components/CardPlanEditor.tsx` (ordinary expected-payment and
  permanent-0% payoff plans)
- Engine: `src/engine/cards.ts`
- Types: `CardPlan` / `OrdinaryCardSchedule` / `ZeroInterestCardPlan` in
  `src/types.ts`

## Net Worth & Simulation Start

- `Net Worth` tab: accounts/liabilities/properties, "Save Account Balance"
  snapshot, and history chart.
- UI: `src/components/AccountManagementEditor.tsx`,
  `src/components/NetWorthHistoryChart.tsx`
- Projections start from the **opening observation**: `netWorth.openingSnapshot`
  (an explicit observed date plus account/liability/property values) when
  present, otherwise configured values anchored to `netWorth.asOfDate`. Observed
  debt wins, including an observed `0`. Historical `netWorth.history` entries are
  asset-only observations and are never used as the opening balance.
- Current age (`profile.currentAge`) and date of birth (`options.dateOfBirth`) are
  separate configured fields; the birth date is the date anchor. Opening/start
  resolution lives in `src/engine/opening.ts` and `src/engine/configuration.ts`.

## Results Display

- Portfolio graph: `src/components/ChartPanel.tsx`
- Stacked savings graph: `src/components/SavingsStackedChart.tsx`
- Results table: `src/components/ResultsTable.tsx`
- Current-dollars deflation adapters: `src/utils/viewAdapters.ts`
- Age range slider and flag visibility toggles live in the app shell.

## Expenses

- Planner/tracking UI: `src/components/AccountExpensesPlanner.tsx`
  (`planning` / `tracking` sub-tabs)
- Credit-card sub-tab: `creditCards`
- Import parsing: `src/importers/expenseImport.ts`; occurred imports stay
  view-only and are never scheduled.
- Engine: `src/engine/planner.ts` (manual planner + recurrences)

## Inflation Controls

- Global toggle: Options tab → Inflation panel
- "Display values in today's dollars": deflates graphs, summary and table through
  the report adapters; display-only, never changes the projection.
