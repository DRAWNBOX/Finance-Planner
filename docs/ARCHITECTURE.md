# Architecture

## High-Level Flow

1. UI state is loaded from local storage (`loadAppState` in `src/storage.ts`).
2. `src/App.tsx` owns app state and builds scenario variants for tabs/graphs.
3. Projections are computed by `projectScenario` in `src/engine/projection.ts`.
4. Results render through:
   - `ChartPanel` (portfolio line/area)
   - `SavingsStackedChart` (account stacked areas)
   - `ResultsTable` (year-by-year table)
5. Net worth history and expenses planning use dedicated UI paths.
6. State changes are persisted through `saveAppState`.

## Main Modules

- `src/App.tsx`: Composition root and orchestration.
- `src/engine/projection.ts`: Core financial simulation.
- `src/financeModel.ts`: Pool/account/source-line compatibility helpers.
- `src/components/*`: Editing and visualization UI.
- `src/components/ExpensesPlanner.tsx`: Expense planning/tracking workspace.
- `src/storage.ts`: Persistence + backward compatibility normalization.
- `src/defaultScenario.ts`: Default scenario object and default creators.
- `src/types.ts`: Shared domain contracts.

## Tabs and Intent

- `Options`: Date of birth/global options with the same graph, table, and summary as Finances Prediction.
- `Finances Prediction`: Sub-tabs for Retirement, Careers, Timeline Management, Purchases and expenses, and Loans.
- `Net Worth`: Account/pool balances, import staging, history, and as-of date baseline.
- `Expenses`: Full-width expense planning/tracking workspace; graph/results panels are hidden.
