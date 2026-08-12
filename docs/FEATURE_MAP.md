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

## Purchases and Loans

- Purchases UI and viability highlighting: `src/App.tsx`
- Loan UI and account-funding shortfall highlighting: `src/App.tsx`
- Funding simulation: `src/engine/projection.ts`
- Source-line/account helpers: `src/financeModel.ts` (`normalizePurchaseFundingSource`)
- Income-funded purchases processed per-month

## Housing Expenses

- Mortgage and Rental tables: `src/App.tsx` (`renderHousingTab`)
- Engine: per-month mortgage/rental processing, PMI auto-drop, sell proceeds, rental income
- Types: `HousingEntry` in `src/types.ts`

## Credit Cards

- UI: `src/App.tsx` (credit card table in purchases & expenses)
- Engine: per-month credit card processing, autopay, fixed-plus-lump payment modes
- Types: `CreditCard` in `src/types.ts`

## Results Display

- Portfolio graph: `src/components/ChartPanel.tsx`
- Stacked savings graph: `src/components/SavingsStackedChart.tsx`
- Results table: `src/components/ResultsTable.tsx`
- Monthly snapshots toggle: per-month rows with per-account activity tooltips
- Age range slider: filter graph by age range
- Flag visibility toggles: purchases/expenses + housing flags

## Inflation Controls

- Global toggle: Options tab → Inflation panel
- Display values in current dollars: checkbox above results table (deflates by cumulative inflation)
- No per-item inflation toggles — all items follow global toggle