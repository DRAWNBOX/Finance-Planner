# Feature Map

Map of visible features to implementation files.

## Retirement Calculator Panel

- UI/controls: `src/App.tsx` (`renderRetirementTab`)
- Projection effects: `src/engine/projection.ts`

## Options

- UI/controls: `src/App.tsx` (`renderOptionsTab`)
- Results display: shares the Finances Prediction graph, table, and summary path in `src/App.tsx`

## Career Timeline Editor

- Main editor: `src/components/CareerPlanEditor.tsx`
- Integrates:
  - start/end age handling
  - salary/savings rates
  - start balance source modes
  - per-account monthly expenses
  - duplicate/remove/reorder

## Purchases and Loans

- Purchases UI and viability highlighting: `src/App.tsx`
- Loan UI and account-funding shortfall highlighting: `src/App.tsx`
- Funding simulation: `src/engine/projection.ts`
- Source-line/account helpers: `src/financeModel.ts`

## Charts

- Portfolio graph: `src/components/ChartPanel.tsx`
- Stacked savings graph: `src/components/SavingsStackedChart.tsx`
- Graph source selection and tab-specific projection variants: `src/App.tsx`

## Results Table

- Table rendering: `src/components/ResultsTable.tsx`
- Data source: `projection.years` from `src/App.tsx`

## Add-ons and Events

- Cashflow editors: `src/components/CashflowItemEditor.tsx`
- Life event editors: `src/components/LifeEventEditor.tsx`
- Data handling: `src/App.tsx` + `src/engine/projection.ts`

## Net Worth

- UI: `src/App.tsx` (`renderNetWorthTab`)
- Storage payload: `src/storage.ts`
- Import parsing: `src/importers/bankImport.ts`
- History chart: `src/components/NetWorthHistoryChart.tsx`

## Expenses

- Workspace UI: `src/components/ExpensesPlanner.tsx`
- Import parsing: `src/importers/expenseImport.ts`
- Storage/default schema: `src/types.ts`, `src/defaultScenario.ts`, `src/storage.ts`

## Dynamic Account and Pool Model

- Types/defaults/normalization: `src/types.ts`, `src/defaultScenario.ts`, `src/storage.ts`
- Compatibility helpers: `src/financeModel.ts`
- Projection account balances: `src/engine/projection.ts`
