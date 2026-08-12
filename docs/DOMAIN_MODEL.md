# Domain Model

Primary interfaces live in `src/types.ts`.

## Scenario

`Scenario` is the top-level planning object. It includes:

- `profile`: current age, retirement age, retirement years
- `options`: date-based age options
- `portfolio`: base portfolio settings
- `contribution`: non-career yearly contribution plan
- `careerPlan`: timeline entries
- `netWorth`: starting balances + as-of date
- `futureRetirement`, `withdrawal`, `manualReturns`
- `cashflowItems`, `lifeEvents`
- `largePurchases`, `longTermPurchases`, `loans`, `housing`, `creditCards`

## CareerEntry

Each career entry represents a timeline segment:

- Ages and label: `startAge`, `endAge`, `label`, `enabled`
- Income: `annualRaiseRate` applied to `paycheckInfo.grossSalary`
- Account source lines (`sourceLines`) define contribution/withdrawal behavior for dynamic pools/accounts.
- `paycheckInfo` drives income-funded purchases/loans:
  - `grossSalary`, `taxes`, `healthBenefits`, `otherBenefits` — gross income minus deductions
  - `retirement`, `retirementMatch` — retirement contribution (employee + employer)
  - `hsaContribution`, `hsaEmployerMatch` — HSA contribution (employee + employer)
  - `retirementAccountId`, `hsaAccountId` — target accounts for deposits
  - `livingExpenses` — subtracted from monthly take-home
  - Only the employee portion of retirement/HSA is subtracted from take-home pay
  - Each field has a `period` toggle (monthly/yearly) for display/input conversion
- `incomeFallbackAccountId`, `incomeFallbackAccountId2` — fallback accounts when income is insufficient

## Housing, Loans, Credit Cards

- `HousingEntry`: mortgages (with PMI, sell proceeds) and rentals
- `Loan`: amortized debt with interest, down payment, payment source
- `CreditCard`: revolving debt with autopay or fixed-plus-lump payment modes

## Projection Outputs

- `ProjectionYear`: per-age computed data (balances, salary, withdrawals, account balances, returns)
- `MonthlySnapshot`: per-month engine state including per-account activity (`accountActivity`)
- `ProjectionResult`: list of years + monthly snapshots, summary, depletion info, end-age, and per-career ending account balances
- `ProjectionYear.accountBalancesById` is the primary runtime account output map.