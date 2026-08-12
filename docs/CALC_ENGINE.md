# Calculation Engine

Core logic lives in `src/engine/projection.ts`.

## Main Entry

- `projectScenario(scenario)` simulates ages from current age through retirement end age.
- Retirement end age = `retirementAge + retirementYears`.

## Per-Year Pipeline

For each age:

1. Compute portfolio return rate as balance-weighted average of per-pool `preRetirementReturnRate` / `postRetirementReturnRate`.
2. Resolve active career entry and relevant life events.
3. Compute salary from `paycheckInfo.grossSalary * (1 + annualRaiseRate)^years` (pre-retirement only).
4. Compute career contribution from source line contribution rates on salary.
5. Compute account contributions from dynamic source lines (pool/account targets).
6. Compute account withdrawals from dynamic source lines (monthly values from career entry).
7. Apply account evolution with monthly simulation:
   - Monthly contribution/deposit, monthly withdrawal, monthly growth (pool APY / 12)
   - Retirement and HSA deposits via `applyAccountDeposit` to their respective accounts
   - Iterate `periodMonths` months
8. Compute per-month `availableIncome` from career paycheck info:
   `monthlyTakeHome = max(0, (gross - taxes - health - other - max(0, retirement - retirementMatch) - max(0, hsa - hsaMatch)) / 12 - livingExpenses)`
9. Process income waterfall per-month: credit cards → housing → loans → large purchases → long-term purchases. Each month gets its own income pool.
10. Compute additional cashflow items/life event cashflow.
11. Compute retirement spending withdrawal from configured dynamic sources (4% rule or specified mode) with pool-priority fallback.
12. Push `MonthlySnapshot` (actual engine state) and aggregate into `ProjectionYear`.

## Important Behaviors

- Dynamic account balances (`accountBalancesById`) are the runtime source of truth for account-led math.
- `MonthlySnapshot` records actual per-month engine state including per-account activity.
- Per-month income pool: each month gets its own `monthlyTakeHome` for income waterfall processing.
- Retirement and HSA contributions are deposited per-month to their respective accounts.
- HSA penalty-free after retirement age 65.
- Housing expenses (mortgage/rent) processed per-month with PMI auto-drop at 80% LTV.
- Credit card payments processed per-month with autopay and lump sum support.
- Retirement withdrawal falls back to other pools by priority when primary source is exhausted.
- Depletion can occur from portfolio exhaustion, retirement-floor breach, or minimum withdrawal not met.
- Income waterfall processes credit cards, housing, and loans before purchases each month.
- `firstFallbackYearMonth` uses the purchase's `yearMonth` for accurate date display.

## Known Touchpoints For Future Changes

- Withdrawal funding source: adjust retirement spending logic section.
- Monthly vs yearly account semantics live in dynamic source-line contribution/withdrawal flows.
- Salary behavior: salary resolution block (annual raises, job changes).
