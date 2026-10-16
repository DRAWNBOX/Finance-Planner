# Test Map

Two local test layers. Vitest owns unit/integration per-item coverage; Playwright owns a
bounded Chromium browser gate. Neither certifies the GUI-A01–A10 / G01–G40 or
CA01–CA13 matrices row by row — see `refactor/phase5_handoff.md` and
`refactor/coverage_register.md` for current status and evidence.

## Commands

- Unit/integration: `npm run test -- --run` (script is `vitest run`).
- Single file: `npm run test -- --run src/engine/projection.test.ts`.
- Browser gate: `npm run test:e2e -- --project=chromium` (one-time `npx playwright install chromium`).

## Vitest Groups

### Engine kernel (`src/engine/*.test.ts`)

- `state.test.ts`, `money.test.ts`, `dates.test.ts`, `taxes.test.ts`, `funding.test.ts`,
  `valuation.test.ts`, `reporting.test.ts`, `scheduler.test.ts`, `opening.test.ts`,
  `configuration.test.ts` — state atomics, integer-cent money, tax/penalty solver, ordered
  funding, exact-APY valuation, reconciliation + D16 selectors, scheduling, opening
  observations, named-context compilation.
- `projection.test.ts`, `featureHandlers.test.ts` — kernel facade and the one composition seam.
- `income.test.ts`, `spending.test.ts`, `planner.test.ts`, `retirement.test.ts`,
  `cards.test.ts`, `loans.test.ts`, `housing.test.ts` — feature streams.
- `phase5Acceptance.test.ts`, `phase5CrossFeature.test.ts` — Phase-5 integration: coverage
  claims, the D26 contention fixture, timeline isolation, and headless cross-feature slices.

### Root integration / schema (`src/*.test.ts(x)`)

- `App.test.tsx` — real-render integration/UI flows over the one projection.
- `codec.test.ts`, `storage.test.ts`, `autosave.test.ts` — schema-v3 save/load/normalization,
  the save guard, and autosave coalescing/flush.
- `commands.test.ts` — canonical write surface and marker/timeline CRUD.
- `paycheck.test.ts` — paycheck compile and precision round-trip.
- `trajectoryFreeze.test.ts`, `trajectoryReportAdapter.test.ts` — canonical trajectory
  snapshots and report mapping.

### Components (`src/components/*.test.tsx`)

- Editors: `AccountCareerPlanEditor`, `AccountExpensesPlanner`, `AccountManagementEditor`,
  `CardPlanEditor`, `DateMarkersEditor`, `HousingEditor`, `LoanEditor`, `PurchaseEditor`,
  `RetirementSpendingEditor`, `TimelineManager`, `TrajectoryManager`, `FundingPolicyEditor`.
- Inputs: `BufferedNumberInput`, `DateOrMarkerInput`.
- Views/result panels: `ChartPanel`, `SavingsStackedChart`, `ResultsTable`,
  `NetWorthHistoryChart`, `TrajectoryComparisonChart`, `HousingResults`, `LoanResults`,
  `RetirementWithdrawalResults`, `ReportDisplayConsistency`.

### Utilities and importers

- `src/utils/`: `dateMarkers.test.ts`, `colorPalette.test.ts`, `viewAdapters.test.ts`.
- `src/importers/expenseImport.test.ts` — CSV/expense parsing.

## Browser Gate (`e2e/*.spec.ts`)

Playwright (Chromium only) drives the real app over the Vite dev server on
`127.0.0.1:4173` in a fresh isolated context per test. Specs cover: first launch/smoke,
accounts/careers, trajectory accessibility and legacy refusal, obligations/planner,
cards/D16, display consistency, housing outcomes and grouped policy, markers/timelines,
account-reference guards, card CRUD, signed net worth, partial purchases, planner editing,
account policy order, career payroll destinations, retirement controls/outcomes, loan
results and interest/payoff, funding order editor, opening snapshot history, and
report/account activity. Shared helpers live in `e2e/fixtures.ts`.

This suite is a bounded local smoke/flow gate — **not** CI-wired and **not** a
GUI/CA matrix certification.
