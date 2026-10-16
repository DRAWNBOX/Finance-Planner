# AGENTS

This repository supports AI-assisted development. Use this as a fast, practical jumpstart.

> **Architecture state.** `src/` is the account-only, Phase-5 integrated candidate: a
> deterministic kernel + feature streams + read-only reporting behind one projection
> facade, with a versioned save codec. Phase 5 is **a runnable candidate for Phase-6
> measurement, not a release** (ADR-022). Current authority: `refactor/phase5_handoff.md`,
> `refactor/coverage_register.md`, `refactor/frozen_contracts.md`; the runtime files are
> the final source of truth. Do **not** present the GUI-A01–A10/G01–G40 or CA01–CA13
> matrices as certified by the passing test run.

## Quick Start

1. Read the Phase-5 source of truth:
   - `refactor/phase5_handoff.md` — state, local gates and explicit non-claims.
   - `refactor/coverage_register.md` — per-item evidence and status.
   - `refactor/gui_browser_coverage.md` — per-G01–G40 Chromium browser coverage ledger.
2. Read runtime entry points:
   - `src/App.tsx` — composition root: canonical commands + one selected projection + rendering (no local scenario rebuild).
   - `src/commands.ts` — the single canonical write/read surface (`createConfigurationCommands`, `applyToActiveTimeline`, `applyGlobal`, timeline/career/account/marker CRUD).
   - `src/engine/featureHandlers.ts` — `projectFeatureScenario`, the one projection path (selects one timeline, composes all four streams, builds exactly one report).
   - `src/engine/projection.ts` — the `projectScenario` kernel facade (scheduler + `state.commitChanges` + month-close APY).
   - `src/codec.ts` + `src/storage.ts` — schema-v3 allowlisted codec and the localStorage load/save guard.
3. Confirm current schema defaults and normalization:
   - `src/types.ts`
   - `src/defaultScenario.ts`
   - `src/codec.ts` (`CURRENT_SCHEMA_VERSION = 3`, `CANONICAL_TRAJECTORY_FORMAT_VERSION = 2`)
   - `src/storage.ts` (load + save guard)

## Current Project Shape

- Stack: React 19 + TypeScript + Vite + Vitest.
- Main tabs: `options`, `careers` ("Finances Prediction"), `netWorth`, `expenses`.
- Finances Prediction sub-tabs: `retirement`, `careers`, `timeline`, `purchasesExpenses`, `housing`, `trajectory`, `warnings`, `dateMarkers`.
- Expenses sub-tabs: `planning`, `tracking`, `creditCards`; Options: `profile`; Net Worth: `history`.
- Deterministic engine (`src/engine/`), one owner per rule:
  - Kernel: `dates.ts`, `money.ts`, `state.ts`, `taxes.ts`, `funding.ts`, `scheduler.ts`, `valuation.ts`, plus `opening.ts` (opening-observation resolver), `journal.ts` (posting journal), `contracts.ts` (funding request/allocation/plan).
  - Feature streams: `income.ts` (payroll + ordered net allocations); `spending.ts` / `planner.ts` / `retirement.ts`; `cards.ts` / `loans.ts` / `housing.ts`.
  - Composition + reporting: `configuration.ts` (named-context compiler), `projection.ts` (facade), `featureHandlers.ts` (composition seam), `reporting.ts` (read-only report).
- `src/paycheck.ts` compiles the granular `CareerEntry.paycheck` into the flat `PaycheckInfo`.
- Views read the single `ProjectionReport` only:
  - `src/components/ChartPanel.tsx`, `src/components/SavingsStackedChart.tsx`, `src/components/ResultsTable.tsx`, `src/components/NetWorthHistoryChart.tsx`, `src/components/TrajectoryComparisonChart.tsx`, `src/components/HousingResults.tsx`, `src/components/LoanResults.tsx`, `src/components/RetirementWithdrawalResults.tsx`.
- Standalone editors mount at their tab placements: `AccountManagementEditor`, `AccountCareerPlanEditor`, `AccountExpensesPlanner`, `RetirementSpendingEditor`, `PurchaseEditor`, `LoanEditor`, `HousingEditor`, `CardPlanEditor`, `CashflowItemEditor`, `TimelineManager`, `TrajectoryManager`, `DateMarkersEditor`.
- Timelines: `Scenario.timelines` + `activeTimelineId` snapshot seven timeline-local domains (`purchases`, `longTermPurchases`, `loans`, `creditCards`, `cardPlans`, `careerPlan`, `housing`); global configuration (accounts/rates/policies/liabilities/properties/markers/withdrawal) lives on the base scenario.
- Imports/planning: `src/importers/expenseImport.ts` (occurred imports stay view-only); `AccountExpensesPlanner` displays a selected-account, selected-week **monthly-resolution** report close alongside its planned weekly grid, plus exact-date quoted planner-week requested/committed-paid totals from the same report (not a fabricated weekly funded balance).
- Browser harness: `e2e/**` Playwright specs + `playwright.config.ts` (isolated Chromium, strict port `4173`, 2 workers, trace-on-first-retry) driven by `npm run test:e2e`; Vitest excludes `e2e/**`. Currently **26 specs / 45 tests** pass locally. A bounded smoke/flow gate over the real dev server — not a GUI/CA certification and not wired into CI.

## Commands

- Dev server: `npm run dev`
- Run all tests: `npm run test -- --run`
- Run engine tests: `npm run test -- --run src/engine/projection.test.ts`
- Run app integration tests: `npm run test -- --run src/App.test.tsx`
- Build: `npm run build`
- Browser end-to-end (Playwright/Chromium): `npm run test:e2e -- --project=chromium`
- One-time browser install before the first e2e run: `npx playwright install chromium`

The Playwright specs live in `e2e/**` and are driven by `playwright test`, **not** Vitest (`vite.config.ts` excludes `e2e/**` while keeping Vitest's default excludes). They run against the real Vite dev server on `127.0.0.1:4173` in a fresh, isolated Chromium context and require the `@playwright/test` devDependency plus an installed Chromium. This is a **bounded local browser gate** only — it is **not** wired into any CI, and it does **not** certify the GUI-A/G or CA matrices (those remain Vitest's per-item owner).

## Core Invariants

- Keep projection/account math deterministic and side-effect free. The engine kernel state (`src/engine/state.ts`, integer cents) is the runtime source of truth for account/liability/property/deposit math; mutation happens **only** through `state.commitChanges` (revision-checked, all-or-none, with a declared `expectedNetWorthDeltaCents`). No wall clock — dates and horizons are explicit inputs.
- Unit rule: persisted configuration is dollars; runtime postings/balances are integer cents, converted once at the posting boundary (half-away-from-zero). Rate math keeps high-precision intermediates and rounds only at the final posting (`src/engine/money.ts`).
- Exact APY: account growth uses `monthlyRate = Math.pow(1 + rate, 1 / 12) - 1`, so `(1 + monthlyRate)^12 === 1 + rate` (a stated 6.5% rate yields exactly 6.5% per year). A month clipped by the valuation window uses the fractional exponent. Debt interest accrues at the **nominal** `annualRate / 12`; property appreciation uses the effective rate — all in `src/engine/valuation.ts`.
- Signed net worth: `netWorthCents = accountAssets − liabilities` (may be negative). Every month close reconciles `closing = opening + Σ committed deltas` per account/liability/property/deposit; a mismatch is a reported diagnostic, never silently clamped or rounded (`src/engine/reporting.ts`).
- Same-date phases: `accrual → income → cap → mandatory → discretionary → close`. Mandatory obligations band in the frozen order `loan/mortgage → housing → cards → planner/living → retirement` (`FEATURE_MANDATORY_BANDS`); intra-stream order is preserved inside a band.
- Funding: primary-first, ordered, eligible split, deduplicated; every obligation is partial (`executedCents = Σ netFundedCents`, `shortfallCents = requested − executed`). Zero-fund/invalid plans debit nothing. Tax and penalty are withheld from gross exactly once (`gross = net + tax + penalty`). No pool/type sweep, no implicit borrowing or retry (`src/engine/funding.ts`).
- Reporting selectors (D16): `report.shortfall.warning` is the first completeness shortfall; `report.exhaustion` is eligible-funded exhaustion (a policy/quota shortfall is **never** exhaustion); `report.fallback.occurrences` records a secondary source actually drawn from a **committed** plan. The funding plan retains its quote-time `resolvedSourceOrder`, so a global-default primary is not mislabeled fallback even when the raw request primary is null. Fallback is never reported as shortfall or exhaustion. Warnings are warning-only and never change projection math.
- One projection, one report: `projectFeatureScenario` selects exactly one named timeline, compiles one context, composes all four streams, and attaches exactly one immutable `buildProjectionReport(run)` (D21/D23/D25). The raw `projectScenario` facade is kernel-only: `complete` stays `false` unless a call site claims full coverage **and** the run covered the whole requested horizon with nothing blocked (a partial `scheduleWindow` or a dropped handler stays incomplete).
- Save lifecycle (D24): schema v3. The codec is allowlist-only — obsolete/derived fields (e.g. the flat `CareerEntry.paycheckInfo` cache, canvas caches, calculated balances) are pruned by construction. A newer-version payload blocks writes; corrupt bytes are preserved on automatic saves; only a user reset performs an explicit canonical replace. Autosave coalesces writes and flushes on `pagehide`.
- Expense-import provenance is view-only: a planned copy with explicitly cleared `sourceSign: null` stays `null` on save/load (never fabricated as `'debit'`), while an imported sibling retains its actual sign.
- A missing `CareerSourceLine.maxBalance` means no cap and stays **absent** on save/load; an explicit `0` stays `0` (also cap off). Positive persisted dollar caps can route payroll overflow to an explicit account; never manufacture a cap or silently reassign an unresolved overflow account.
- Paycheck: the granular `CareerEntry.paycheck` is the authority; `resolvePaycheckInfo` / `compilePaycheck` (`src/paycheck.ts`) derive the flat `PaycheckInfo` on read, and the codec keeps them in sync on load/save.
- Dollar display: "Display values in today's dollars" deflates graphs, summary and table through the report adapters (`src/utils/viewAdapters.ts`); the toggle is display-only and never changes the projection.

### Timelines
- `Scenario.timelines: Timeline[]` + `activeTimelineId: string | null`. A timeline holds independent copies of `purchases`, `longTermPurchases`, `loans`, `creditCards`, `cardPlans`, `careerPlan` and `housing`; global configuration stays on the base scenario.
- All purchase/career/housing/credit-card/card-plan CRUD writes through `applyToActiveTimeline`; global config writes through `applyGlobal` (both in `src/commands.ts`).
- `compileScenarioContext` compiles the **selected** timeline only; inactive timelines are validated, never eagerly simulated.

### Cents funding and gross-net
- `quoteFunding` never mutates state; `commitFunding` mutates only through one `state.commitChanges` call. Eligibility, ordered fallback, quota vs eligible exhaustion, and the exact bounded gross→net / net→gross tax+penalty solver live in `src/engine/funding.ts` + `src/engine/taxes.ts`.

### Reported warnings
- The Warnings tab renders the D16 selectors verbatim (`report.shortfall.warning`, `report.exhaustion`, `report.fallback.occurrences`) plus `context.diagnostics`. It never re-runs funding or re-derives eligibility.

## Schema Change Playbook

For any persisted field addition or shape change:

1. Add/adjust types in `src/types.ts`.
2. Add defaults in `src/defaultScenario.ts`.
3. Add load-time normalization in `src/codec.ts` (the storage boundary) and, if needed, prune obsolete fields by allowlist.
4. Ensure runtime usage in `src/commands.ts` and/or the engine (`src/engine/configuration.ts` compile step and the owning feature stream).
5. Add or update tests for both engine and UI flow when behavior changes.

## High-Risk Areas

- Kernel state atomics: `state.commitChanges` revision/ownership/conservation checks and sparse all-or-none change sets.
- Exact-APY valuation, clipped partial-month exponent, debt accrual (`annualRate / 12`), and property appreciation (`src/engine/valuation.ts`).
- Ordered partial funding, eligibility, de-duplication, and the quota-vs-exhaustion distinction (`src/engine/funding.ts`).
- Reporting reconciliation and the shortfall/exhaustion/fallback selectors (D16), plus the honest `complete` coverage claim (D23).
- Named-context compilation and timeline isolation (`src/engine/configuration.ts`) — one selected timeline; inactive timelines are validated but never simulated.
- `projectFeatureScenario` is the only projection path — do not add a second projection call or a preview loop.
- Codec schema versioning and the save guard: never persist derived/canvas/calculated data; never overwrite newer-version/corrupt bytes on automatic saves.
- Paycheck compile and the `paycheckFromPaycheckInfo` full-cent precision round-trip.
- Timeline resolution: editing must hit the active timeline (`applyToActiveTimeline`), not the base `scenario.*` fields.
- Housing grouped funding policies (`HousingEntry.fundingPolicies`) ordered overrides with the legacy scalar `*Source` read fallback.
- Current-dollars deflation adapters (`src/utils/viewAdapters.ts`) must use each report month's actual `closingDate` consistently across chart, stacked series, summary and table (including clipped months).
- Marker resolution and career/housing date chains (`resolveDateMarkers`; the career/housing chain resolvers in `src/commands.ts`).

## Test Focus Map

- Whole suite: `npm run test -- --run` (the Phase-5 handoff records an independently reproduced **57 files / 1084 tests** pass).
- Browser end-to-end: `npm run test:e2e -- --project=chromium` (Playwright over the real dev server; `e2e/*.spec.ts`; currently **26 specs / 45 tests** pass locally). Bounded local gate — no CI wiring and not row-by-row GUI/CA certification (see `refactor/gui_browser_coverage.md`).
- Engine kernel + facade: `src/engine/*.test.ts` (e.g. `projection.test.ts`, `state.test.ts`, `funding.test.ts`, `valuation.test.ts`, `reporting.test.ts`, `housing.test.ts`).
- Phase-5 integration: `src/engine/phase5Acceptance.test.ts`, `src/engine/phase5CrossFeature.test.ts`.
- UI integration/regressions: `src/App.test.tsx`.
- Schema/commands: `src/codec.test.ts`, `src/commands.test.ts`, `src/storage.test.ts`, `src/paycheck.test.ts`.
- Import parsing: `src/importers/expenseImport.test.ts`.

When changing account math, funding, careers, housing, cards, or retirement logic, run at least engine + app tests. Also create new tests as needed to test any new logic added. These are local gate results — the GUI-A/G and CA matrices are not independently certified.

## Notes On Docs Consistency

- `docs/` and `refactor/README.md` are partly historical or describe the **target** architecture; several still reference removed modules (`src/financeModel.ts`, `src/components/CareerPlanEditor.tsx`, `src/components/ExpensesPlanner.tsx`). Treat `src/` and `refactor/phase5_handoff.md` as source of truth.
- `refactor/README.md` mentions an `engine/obligations.ts` that does not exist; the implemented streams are `cards.ts`/`loans.ts`/`housing.ts`/`planner.ts`/`spending.ts`/`retirement.ts`.
- `CHANGES.md` at the project root is the tracked session changelog — **update it before every commit/push**.
- `gitchanges.md` at the project root tracks all session changes chronologically (gitignored).

## Change Checklist

1. Types/defaults/codec stay aligned for all new or changed persisted fields.
2. Engine rule changes are covered by/validated with tests.
3. UI renders chart/table paths from the single report.
4. `npm run test -- --run` and `npm run build` pass before handoff.
5. `CHANGES.md` is updated with the session's changes before any commit/push to GitHub.
