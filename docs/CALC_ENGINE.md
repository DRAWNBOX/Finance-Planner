# Calculation Engine

Core logic lives in `src/engine/projection.ts`.

## Main Entry

- `projectScenario(scenario, options?)` simulates ages from current age through retirement end age.
- Retirement end age = `retirementAge + retirementYears`.
- Current age is always derived from `options.dateOfBirth` (falling back to `profile.currentAge` only when the birth date is missing/invalid); there is no manual age mode.
- `options.startDate` (ISO `YYYY-MM-DD`) anchors the simulation: it sets the start year-month, the baseline/projected `calendarYear`, and the reference date for current age / birthday stub. The app passes the date of the most recent `netWorth.history` snapshot as the start date and seeds account balances from that snapshot. Costs scheduled before the start month are ignored (large purchases with a prior `yearMonth` are skipped; range-based items only run from the start month; an in-progress mortgage is amortized forward from its start to the anchor; loans/credit cards seed from their stored `currentBalance`).
- `result.simulationStartDate` / `result.simulationStartYearMonth` expose the resolved anchor.

## Per-Year Pipeline

For each age:

1. Compute portfolio return rate as balance-weighted average of per-pool `preRetirementReturnRate` / `postRetirementReturnRate`.
2. Resolve active career entry and relevant life events.
3. Compute salary from `paycheckInfo.grossSalary * (1 + annualRaiseRate)^years` (pre-retirement only).
4. Compute career contribution from source line contribution rates on salary.
5. Compute account contributions from dynamic source lines (pool/account targets).
6. Compute account withdrawals from dynamic source lines (monthly values from career entry).
7. Apply account evolution with monthly simulation:
   - Monthly contribution/deposit, monthly withdrawal, monthly growth at exact APY ((1 + rate)^(1/12) - 1)
   - Retirement and HSA deposits via `applyAccountDeposit` to their respective accounts
   - Iterate `periodMonths` months
8. Compute per-month `availableIncome` from career paycheck info:
   `monthlyTakeHome = max(0, (salary - taxes - healthBenefits - otherBenefits - retirement - hsaContribution - livingExpenses) / 12)`
   where `salary` is the raised salary from step 3, and `retirement` / `hsaContribution` are the employee-paid portions (deducted in full).
9. Process income waterfall per-month: cashflow add-ons + life-event income/expense (deposit/withdraw to their `accountId`) → credit cards → housing → loans → large purchases → long-term purchases. Each month gets its own income pool.
10. Housing payments split into grouped sources (P&I+extra / rent, taxes+insurance, HOA+maintenance, PMI), each paid from its own account/income source with `paymentSource` as fallback.
11. Compute retirement spending withdrawal from configured dynamic sources (4% rule or specified mode) with pool-priority fallback, spread monthly (`planned / periodMonths`); min/max thresholds enforced as a yearly cumulative check.
12. Push `MonthlySnapshot` (actual engine state, including real per-month `withdrawal`/`taxesPaid`/`penaltiesPaid`) and aggregate into `ProjectionYear`.

## Important Behaviors

- Dynamic account balances (`accountBalancesById`) are the runtime source of truth for account-led math.
- `MonthlySnapshot` records actual per-month engine state including per-account activity.
- Per-month income pool: each month gets its own `monthlyTakeHome` for income waterfall processing.
- Retirement and HSA contributions are deposited per-month to their respective accounts.
- HSA penalty-free after retirement age 65.
- Housing expenses (mortgage/rent) processed per-month with PMI auto-drop at 80% LTV and grouped payment sources.
- Credit card payments processed per-month with autopay and lump sum support.
- Cashflow add-ons and life-event income/expense applied monthly (recurring spread `amount/12`; one-time at the exact `startYearMonth`).
- Retirement withdrawal falls back to other pools by priority when primary source is exhausted.
- Depletion can occur from portfolio exhaustion, retirement-floor breach, or minimum withdrawal not met.
- Income waterfall processes cashflow/life events, credit cards, housing, and loans before purchases each month.
- `firstFallbackYearMonth` uses the purchase's `yearMonth` for accurate date display.
- Housing entries can chain their start to the previous entry's end via `usePreviousEndAsStart` (start becomes the month after the previous end).
- Careers can chain their start to the previous career's end via `usePreviousCareerStartAge` (start becomes the month after the previous end; the start age is derived from that month).

## Known Touchpoints For Future Changes

- Withdrawal funding source: adjust retirement spending logic section.
- Monthly vs yearly account semantics live in dynamic source-line contribution/withdrawal flows.
- Salary behavior: salary resolution block (annual raises, job changes).
