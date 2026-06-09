# Calculation Engine

Core logic lives in `src/engine/projection.ts`.

## Main Entry

- `projectScenario(scenario)` simulates ages from current age through retirement end age.
- Retirement end age = `retirementAge + retirementYears`.

## Per-Year Pipeline

For each age:

1. Resolve applicable return/inflation rates (manual or historical).
2. Resolve active career entry and relevant life events.
3. Compute salary (pre-retirement only, unless interrupted by career break).
4. Compute career contribution from savings rates (employer match/bonus savings excluded).
5. Compute account contributions from dynamic source lines (pool/account targets).
6. Compute account withdrawals from dynamic source lines (monthly values from career entry).
7. Apply account evolution with monthly simulation:
   - monthly contribution = annual contribution / 12
   - monthly withdrawal = configured monthly withdrawal
   - monthly rate = pool APY / 12
   - iterate 12 months with floor at zero
8. Compute `availableIncome` from career tax info:
   `monthlyTakeHome = max(0, (leftoverIncome - otherExpenses) / 12)`
9. Process income waterfall: loans from income → purchases from income → fallback accounts (fb1, fb2)
10. Compute additional cashflow items/life event cashflow.
11. Compute retirement spending withdrawal from configured dynamic sources (4% rule or specified mode).
12. Update portfolio balance and append `ProjectionYear`.

## Important Behaviors

- Dynamic account balances (`accountBalancesById`) are the runtime source of truth for account-led math.
- `savingsBalances` is populated as a flat `Record<string, number>` from pool totals.
- Career-end account snapshots are stored in `careerEndSavingsBalances`.
- Depletion can occur from portfolio exhaustion and retirement-funding shortfall.
- Income waterfall processes loans before purchases each year.
- `firstFallbackYearMonth` uses the purchase's `yearMonth` (or loan's start date) for accurate date display.

## Known Touchpoints For Future Changes

- Withdrawal funding source: adjust retirement spending logic section.
- Monthly vs yearly account semantics live in dynamic source-line contribution/withdrawal flows.
- Salary behavior: salary resolution block (annual raises, job changes).
