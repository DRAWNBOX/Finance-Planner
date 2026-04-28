# Code Map

## Entry Points

- `src/main.tsx`: React app bootstrap.
- `src/App.tsx`: Application composition root.

## Domain and Defaults

- `src/types.ts`: Shared interfaces/types.
- `src/defaultScenario.ts`: Default scenario + item creators.

## Calculation Engine

- `src/engine/projection.ts`: Simulation engine and formatting helpers.
- `src/data/historicalReturns.ts`: Historical return series.

## Persistence

- `src/storage.ts`: Load/save + normalization/migration.

## Components

- `src/components/BufferedNumberInput.tsx`: Buffered numeric input utility.
- `src/components/CareerPlanEditor.tsx`: Career timeline editor and account controls.
- `src/components/CashflowItemEditor.tsx`: Cashflow add-on editor.
- `src/components/LifeEventEditor.tsx`: Life event editor.
- `src/components/ChartPanel.tsx`: Portfolio line/area chart.
- `src/components/SavingsStackedChart.tsx`: Savings stacked chart with filtering.
- `src/components/ResultsTable.tsx`: Yearly results table.

## Styling

- `src/styles.css`: Global styles and component styling.

## Tests

- `src/App.test.tsx`
- `src/engine/projection.test.ts`

## Fast-Path For Common Changes

- Change financial formulas: `src/engine/projection.ts`
- Change career UI/editor: `src/components/CareerPlanEditor.tsx`
- Change graph sourcing per tab: `src/App.tsx`
- Change persisted schema/defaults:
  - `src/types.ts`
  - `src/defaultScenario.ts`
  - `src/storage.ts`
