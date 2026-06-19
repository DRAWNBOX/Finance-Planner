# Session Changes — June 19, 2026

## 1. Taxes & Penalties Tracking in Results Table
- Added `taxesPaid` and `penaltiesPaid` fields to `ProjectionYear` (types.ts)
- Engine tracks tax/penalty amounts from ALL withdrawal types (retirement, purchases, loans, career monthly, housing)
- New "Taxes" and "Penalties" columns in ResultsTable after "Withdrawal"
- Tax/penalty split proportional to pool's `taxRate` / `penaltyRate`

## 2. Merged Extra Cashflow Column
- Removed "Extra Cashflow" column from ResultsTable
- Withdrawal column now shows `year.withdrawal + year.extraCashflow` combined

## 3. Display Values in Current Dollars
- Checkbox above ResultsTable toggles inflation-adjusted display
- All monetary columns deflated by cumulative inflation factor from baseline year
- No engine changes — pure display transformation via `adjustedTableYears`

## 4. Tax Rate Lock in Career Timeline
- Lock/unlock button on Tax Rate % input
- When locked: editing other fields recalculates leftoverIncome from locked rate
- `taxRateLocked: boolean` on TaxInfo type

## 5. Housing Expenses Feature
- New `HousingEntry` type supporting mortgages and rentals
- "Housing Expenses" sub-tab under Finances Prediction
- Engine processes: mortgage amortization, PMI auto-drop (80% LTV), property tax, insurance, HOA, maintenance
- Rental income deposits to specified account via reusable `applyAccountDeposit()`
- Sell proceeds at sell date with account selection
- Rental End Date field for apartment leases
- Split into separate Mortgage and Rental tables for cleaner UI

## 6. Inflation Simplification
- Removed `ReturnMode` (manual/historical) — manual is now the only mode
- Removed `HistoricalYear` type and `src/data/historicalReturns.ts`
- Removed `inflationAdjusted` from CashflowItem, LifeEvent, WithdrawalPlan
- Removed per-item "Adjust for inflation" checkboxes
- Inflation now controlled exclusively by global "Enable inflation" toggle
- "Inflation" panel moved to Options tab (after Age Options)
- Removed `equityAllocation`, `fixedIncomeAllocation`, `fixedIncomeDuration` from PortfolioConfig
- Portfolio return rate now balance-weighted average of pool rates
- Removed `fixedIncomeReturn`, `preRetirementEquityReturn`, `postRetirementEquityReturn` from ManualReturnModel
- PoolDefinition split into `preRetirementReturnRate` / `postRetirementReturnRate`
- Net Worth tab shows Pre-Ret %, Retirement Spending shows Post-Ret %
- Removed Portfolio Returns panel from Options tab

## 7. Retirement Withdrawal Pool Fallback
- When a retirement withdrawal source pool is exhausted, engine falls back to other pools in priority order
- Automatically covers gap from next available pool
- Prevents false "plan runs out of money" due to pool-level shortfall

## 8. Housing Income Status Tracking
- Added `incomeFundedItemStatuses[housing.id]` tracking for all housing income paths
- Housing rows now show yellow (fallback) / red (shortfall) highlighting
- Hover tooltip shows income usage breakdown and fallback account details

## 9. Funding Source Normalization Fix
- `fundingSource` now defaults to `'income'` instead of `undefined` in storage normalization
- Added missing `fundingSource` to long-term purchase normalization
- Engine added defensive `?? 'income'` on all purchase funding checks

## 10. Fallback Account Warning
- Engine emits warning when income-funded items exceed available income without fallback accounts configured
- Hint text added below Income Fallback Accounts dropdowns in Career Timeline

## 11. Monthly Income Processing for Purchases
- Income-funded and account-funded large purchases now processed per-month (not per-year)
- Each month gets its own `monthlyTakeHome` pool instead of annual pool
- Long-term income-funded purchases also processed monthly
- Fixes bug where $2,000 purchase appeared covered by $1,389/mo income (was using annual pool)
- Column shows per-month post-purchase account balances

## 12. Purchase Tooltip
- Rich tooltip on ALL purchase rows (not just non-viable ones)
- Shows: funding source breakdown, income vs fallback split, all items competing that month
- Arrow (→) marks current purchase in the items list

## 13. Removed Housing Costs & Leftover Income Fields
- Removed "Housing Costs (monthly)" input from Career Tax Info
- Removed "Leftover Income (monthly)" input — tax rate now drives leftover income exclusively
- Added "Monthly Savings" display field (dollar amount saved per month)
- Fixed AGENTS.md formula: `monthlyTakeHome = max(0, leftoverIncome/12 - otherExpenses)`

## 14. Null Check for Shortfall Test
- Fixed shortfall detection test to verify `fallbackDetails` array length instead of just status
- Added proper null-check assertions for fallback account balances

## 15. Correct Account Balance Column for Income Purchases
- Changed "Account Balance After Purchase" from text labels to dollar amounts
- Shows remaining monthly income from `incomeUsageByMonth` data
- Shows fallback account post-debit balance when fallback was used
