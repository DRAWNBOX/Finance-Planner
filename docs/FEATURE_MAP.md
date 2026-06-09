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
- Source-line/account helpers: `src/financeModel.ts` (`normalizePurchaseFundingSource`)

## Career Timeline Editor

- Main editor: `src/components/CareerPlanEditor.tsx`
- Integrates:
  - start/end age handling
  - salary/savings rates
  - Tax Info section (untaxed benefits, tax rate, expenses, available monthly)
  - start balance source modes
  - per-account monthly expenses
  - duplicate/remove/reorder

## Dynamic Account and Pool Model

- Types/defaults/normalization: `src/types.ts`, `src/defaultScenario.ts`, `src/storage.ts`
- Projection account balances: `src/engine/projection.ts`
