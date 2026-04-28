# Feature Map

Map of visible features to implementation files.

## Retirement Calculator Panel

- UI/controls: `src/App.tsx` (`renderRetirementTab`)
- Projection effects: `src/engine/projection.ts`

## Career Timeline Editor

- Main editor: `src/components/CareerPlanEditor.tsx`
- Integrates:
  - start/end age handling
  - salary/savings rates
  - start balance source modes
  - per-account monthly expenses
  - duplicate/remove/reorder

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
