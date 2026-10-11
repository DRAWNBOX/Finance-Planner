# Feature Map

Map of visible features to implementation files.

## Retirement Calculator Panel

- UI/controls: `src/App.tsx` (`renderRetirementTab`)
- Projection effects: `src/engine/projection.ts`

## Options

- UI/controls: `src/App.tsx` (`renderOptionsTab`)
- Inflation panel: global enable/disable + rate
- Results display: shares the Finances Prediction graph, table, and summary path in `src/App.tsx`

## Career Timeline Editor

- Main editor: `src/components/CareerPlanEditor.tsx`
- Integrates:
  - start/end age handling
  - Income & Deductions section (gross salary, taxes, health benefits, retirement + match, HSA + match, living expenses)
  - Monthly/Yearly period toggles per field
  - Take Home Pay computation
  - Income Fallback Accounts configuration
  - per-account savings rates, withdrawals, caps, overflow fallback
  - duplicate/remove/reorder

## Timelines (Universal)

- Multiple named timelines, each holding independent copies of large purchases, long-term purchases, loans, credit cards, career plan, and housing.
- UI: `src/App.tsx` (`addTimeline`, `switchTimeline`, `renameTimeline`, `duplicateTimeline`, `deleteTimeline`).
- Timeline chips in the timeline bar switch the active timeline; the "Manage Timelines" modal supports rename, copy, and remove.
- Type: `Timeline` in `src/types.ts`; persisted on `Scenario.timelines`, normalized in `src/storage.ts`.

## Purchases and Loans

- Purchases UI and viability highlighting: `src/App.tsx`
- Loan UI and account-funding shortfall highlighting: `src/App.tsx`
- Funding simulation: `src/engine/projection.ts`
- Source-line/account helpers: `src/financeModel.ts` (`normalizePurchaseFundingSource`)
- Income-funded purchases processed per-month

## Housing Expenses

- Chip-based editor: `src/components/HousingEditor.tsx` (mortgages + rentals in one draggable list, inline property form for the selected chip, duplicate/remove/reorder, "use previous housing end date as start date")
- Grouped payment sources per entry: P&I+extra / rent (`paymentSource`), taxes+insurance, HOA+maintenance, PMI
- Engine: per-month mortgage/rental processing, PMI auto-drop, sell proceeds, rental income
- Types: `HousingEntry` in `src/types.ts`

## Warnings

- UI: `Warnings` sub-tab in `src/App.tsx` (`renderWarningsTab`) — income-usage validation periods plus other engine warnings
- Validation data: `ProjectionResult.incomeValidation` (recorded per pool via `incomePoolUsage` in `src/engine/projection.ts`)
- Sub-tab id: `warnings` (`src/storage.ts`)

## Trajectory

- UI: `Trajectory` sub-tab in `src/App.tsx` (`renderTrajectoryTab`) — save/name immutable trajectory snapshots, pick one to compare, and view metric + per-account diffs against the live projection
- Overlay chart: `src/components/TrajectoryComparisonChart.tsx` (current projection vs selected snapshot vs actual net-worth history)
- Snapshots freeze the projection output (`TrajectorySnapshot` / `TrajectoryYear` in `src/types.ts`); persisted in `Scenario.trajectorySnapshots`; compare selection in `AppUiState.compareTrajectoryId`
- Sub-tab id: `trajectory` (`src/storage.ts`)

## Credit Cards

- UI: `src/App.tsx` (credit card table in purchases & expenses)
- Engine: per-month credit card processing, autopay, fixed-plus-lump payment modes
- Types: `CreditCard` in `src/types.ts`

## Net Worth & Simulation Start

- `Net Worth` tab: account/pool balances, "Save Account Balance" snapshot (`netWorth.history`), and history chart.
- Projections start from the most recent saved balance snapshot: its date anchors `projectScenario`'s start and its balances seed the ledger (App.tsx). Pre-start costs are ignored and an in-progress mortgage is amortized to the anchor. A "Simulating from <date>" note appears on the Finances Prediction graph.
- Current age is always derived from the date of birth (no manual age mode; `profile.currentAge` is only a fallback when the birth date is invalid).

## Results Display

- Portfolio graph: `src/components/ChartPanel.tsx` (monthly line + credit card debt line + monthly hover tooltip)
- Stacked savings graph: `src/components/SavingsStackedChart.tsx` (monthly stacked areas + per-pool hover tooltip)
- Results table: `src/components/ResultsTable.tsx`
- Monthly snapshots toggle: per-month rows with per-account activity tooltips
- Age range slider: filter graph by age range
- Flag visibility toggles: purchases/expenses + housing flags

## Inflation Controls

- Global toggle: Options tab → Inflation panel
- Display values in current dollars: checkbox above results table (deflates graphs, summary, and table by cumulative inflation)
- No per-item inflation toggles — all items follow global toggle