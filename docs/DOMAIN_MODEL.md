# Domain Model

Primary interfaces live in `src/types.ts`. Persisted configuration is in
dollars; runtime postings/balances are integer cents.

## Scenario

`Scenario` is the top-level planning object:

- `profile` (`PersonProfile`): current age, retirement age, retirement years —
  configured directly (`profile.currentAge` is a separate input, not derived).
- `options` (`AgeOptions`): date of birth. The birth date is the date anchor used
  to convert ages to/from month dates; it is not the sole source of current age.
- `portfolio`, `manualReturns`: return/inflation assumptions.
- `careerPlan` (`CareerPlan`): the base timeline's career entries.
- `netWorth` (`NetWorthConfig`): accounts, as-of date, history, opening snapshot.
- `futureRetirement`, `withdrawal` (`WithdrawalPlan`): retirement spending.
- `purchaseCategories`, `dateMarkers`.
- `timelines` + `activeTimelineId`: named timelines (below).
- `trajectorySnapshots`: frozen saved projections (canonical, cents money).
- Base-timeline domains: `largePurchases`, `longTermPurchases`, `loans`,
  `creditCards`, `cardPlans`, `housing`.
- Global configuration: `cashflowItems`, `lifeEvents`, `expenses`,
  `incomeFallbackAccountId` / `incomeFallbackAccountId2`, `fundingPolicy`,
  `liabilities`, `properties`.

## Timeline

`Timeline` is a named, independent copy of seven timeline-local domains:

- `purchases` (`LargePurchase[]`), `longTermPurchases`, `loans`, `creditCards`,
- `cardPlans` (ordinary expected-payment / permanent-0% payoff),
- `careerPlan` (`CareerPlan`), `housing`.

Global configuration (accounts, rates, policies, liabilities, properties,
markers, withdrawal) stays on the base `Scenario`. `activeTimelineId` selects the
timeline; the base timeline uses the `scenario.*` fields.
`compileScenarioContext` compiles only the selected timeline; inactive timelines
are validated, never simulated.

## CareerEntry and paycheck

`CareerEntry` is a dated career segment (`startYearMonth` / `endYearMonth`, with
`startAge` / `endAge` as display/derivation). The **granular `paycheck` is the
engine authority**, compiled by `src/paycheck.ts`. The flat `paycheckInfo` is a
derived/legacy shape that is **not persisted** (it is re-derived on load). Ordered
net-pay allocations and the remainder live in `depositPlan` / `sourceLines`; a
`CareerSourceLine` with `maxBalance > 0` caps an account and routes incoming
overflow to its explicit `overflowFallbackAccountId`.

## Housing, Loans, Credit Cards, Card Plans

- `HousingEntry`: mortgages and rentals. Per-group funding sources
  (`paymentSource` for P&I+extra / rent, plus `taxesInsuranceSource`,
  `hoaMaintenanceSource`, `pmiSource`) with an ordered per-group
  `fundingPolicies` override map; `usePreviousEndAsStart` chains the start to the
  previous entry's end; `linkedCareerStartId` / `linkedCareerEndId` link dates.
- `Loan`: amortized debt configuration. The live debt is the linked
  `LiabilityDefinition`; runtime authority is kernel state, not the config scalar.
- `CreditCard`: revolving debt configuration.
- `CardPlan`: `OrdinaryCardSchedule` (a scheduled expense with no debt tracking)
  or `ZeroInterestCardPlan` (a permanent-0% liability).

## Cashflow Items & Life Events

- `CashflowItem` / `LifeEvent` carry `accountId` (deposit/withdraw target) and
  date fields (`startYearMonth` / `endYearMonth`, or `startAge` / `endAge`
  resolved through the explicit date anchor). Recurring items run monthly;
  one-time items fire at their exact date. Occurred imports are view-only and are
  never scheduled.

## Accounts and runtime money

- `AccountDefinition` (`netWorth.accounts`) is the persisted account list.
- `accountBalancesById` remains on the legacy `ProjectionYear` /
  `MonthlySnapshot` / `TrajectoryYear` shapes (retained for old saved snapshots),
  but the runtime projection no longer emits those shapes.

## Projection Outputs

The runtime output is `FeatureProjectionRun` (`src/engine/featureHandlers.ts`):
the cents-only `ProjectionRun` plus one immutable `ProjectionReport`
(`src/engine/reporting.ts`).

- `ProjectionReport.months[].accounts[]` and `accountCloses(id)` give per-account
  opening/closing cents; `report.months[].closing` holds the reconciled
  `netWorthCents` (signed, so an underwater balance stays negative).
- `report.audit` is the committed posting journal; `report.outcomes` is every
  funding quote (committed or not).
- `report.shortfall`, `report.exhaustion` and `report.fallback` are the D16
  selectors rendered by the Warnings tab.
- Legacy `ProjectionYear`, `MonthlySnapshot` and `ProjectionResult` types remain
  in `src/types.ts` for old snapshots but are not produced by the engine.
