# Calculation Engine

The engine is deterministic and side-effect-free. It lives in `src/engine/` and
is driven by two entry points:

- `projectFeatureScenario(scenario, options?)` (`src/engine/featureHandlers.ts`)
  — the one runtime path the app uses.
- `projectScenario(scenario, options?)` (`src/engine/projection.ts`) — the
  kernel-only facade.

## One Projection Path

`projectFeatureScenario`:

1. Selects exactly one named timeline (`options.timelineId`, else
   `scenario.activeTimelineId`, else base).
2. Compiles one `CompiledScenarioContext` (`compileScenarioContext` in
   `configuration.ts`).
3. Assembles all four streams' event definitions and handlers.
4. Delegates to `projectScenario` with an explicit call-site coverage claim.
5. Builds exactly one immutable `ProjectionReport` and attaches it.

The four streams are:

- **Income** (`income.ts`) — payroll, ordered net allocations, other income.
- **Spending / planner / retirement** (`spending.ts`, `planner.ts`,
  `retirement.ts`).
- **Cards / loans** (`cards.ts`, `loans.ts`).
- **Housing** (`housing.ts`).

Within the `mandatory` phase the composer bands the streams into the frozen order
`loan/mortgage → housing → cards → planner/living → retirement`
(`FEATURE_MANDATORY_BANDS`); intra-stream order survives inside each band.

## Kernel Facade Pipeline

`projectScenario` is thin and owns no financial rules of its own:

1. `compileScenarioContext` → `buildState` (from the opening observation).
2. `createScheduler` produces lazy month batches in the frozen same-date phase
   order: `accrual → income → cap → mandatory → discretionary → close`.
3. Injected handlers execute each occurrence: `quoteFunding` first, then
   `commitFunding` → one `state.commitChanges` call.
4. Month-close account APY valuation runs at `close`.
5. A cents-only `ProjectionRun` is returned.

## Determinism and Invariants

- **Dates are explicit.** No wall clock; the default start is the opening
  observation date. Day-31 targets clamp to the last valid day of a short month.
- **Cents.** Persisted configuration is dollars; runtime postings/balances are
  integer cents, converted once at the posting boundary. Account growth uses the
  exact effective annual yield `(1 + rate)^(1/12) − 1`; a clipped first month
  uses the fractional exponent. Debt interest accrues at the nominal
  `annualRate / 12`.
- **Atomic mutation.** `state.commitChanges` validates revision, ownership and
  conservation, and applies a sparse change set all-or-none. Every nonempty
  commit declares `expectedNetWorthDeltaCents`.
- **Ordered partial funding.** `quoteFunding` never mutates state; it funds
  primary-first over the configured ordered account list, deduplicated, with each
  source used at most once and never overdrawn. `executedCents` is the sum of
  funded nets and `shortfallCents = requested − executed`. Tax and penalty are
  withheld from gross exactly once. There is no implicit sweep, borrowing, or
  retry.
- **One report.** `reporting.ts` builds the immutable report by reading the frozen
  run once; it never re-runs the projection. Every month close reconciles
  `closing = opening + Σ committed deltas`; a mismatch is reported as a
  diagnostic, never silently clamped or rounded.
- **D16 selectors.** `report.shortfall.warning` is the first completeness
  shortfall; `report.exhaustion` is eligible-funded exhaustion (a policy/quota
  shortfall is never exhaustion); `report.fallback.occurrences` records a
  secondary source actually drawn from a committed plan. Fallback is never
  reported as shortfall or exhaustion.

## Implemented vs Proposed

The pipeline above is implemented and test-covered in `src/engine/`. Phase-6
browser/performance measurement and Phase-8 release verification are **proposed
work, not implemented**; nothing here certifies a GUI-A/G or CA matrix.

## Known Touchpoints

- Account growth, debt accrual and appreciation: `valuation.ts`.
- Ordered funding and the quota-vs-exhaustion split: `funding.ts`.
- Warning selectors: `reporting.ts`.
- Timeline isolation and the named-context compile: `configuration.ts`.
