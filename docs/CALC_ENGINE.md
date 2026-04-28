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
4. Compute career contribution from savings rates, employer match, and bonus-saved portion.
5. Compute account contributions by account.
6. Compute account withdrawals by account (monthly values from career entry).
7. Apply account evolution with monthly simulation:
   - monthly contribution = annual contribution / 12
   - monthly withdrawal = configured monthly withdrawal
   - monthly rate = APY / 12
   - iterate 12 months with floor at zero
8. Compute additional cashflow items/life event cashflow.
9. Compute retirement spending withdrawal (4% rule or specified mode; currently funded from 401K).
10. Update portfolio balance and append `ProjectionYear`.

## Important Behaviors

- Account balances (`savingsBalances`) are independent from portfolio line-item columns.
- Career-end account snapshots are stored in `careerEndSavingsBalances`.
- Depletion can occur from portfolio exhaustion and retirement-funding shortfall.

## Known Touchpoints For Future Changes

- Withdrawal funding source: adjust retirement spending logic section.
- Monthly vs yearly account semantics: `getSavingsContributions`, `getSavingsWithdrawals`, `projectSavingsBalancesForYear`.
- Salary behavior: `getCareerContribution` and salary resolution block.
