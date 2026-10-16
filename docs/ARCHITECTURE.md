# Architecture

> **Scope.** This describes the **current `src/` runtime** — the account-only
> Phase-5 integrated candidate. Phase 5 is a runnable candidate for Phase-6
> measurement, **not a release** (ADR-022). Phase-6 browser/performance
> measurement and Phase-8 release verification are still open. "Implemented"
> below means the code exists in `src/`; it is not a claim that any GUI-A/G or
> CA matrix is certified.

## High-Level Flow

1. **Load.** `loadAppState()` (`src/storage.ts`) reads the localStorage key
   `finance-planner-state` and hands the raw bytes to the schema-v3 codec
   (`decodeAppState` in `src/codec.ts`). The storage guard records whether the
   bytes were unreadable/corrupt or written by a newer schema.
2. **Compose.** `src/App.tsx` is the composition root. It owns React state and
   routes every scenario edit through canonical commands
   (`createConfigurationCommands` in `src/commands.ts`): `applyToActiveTimeline`
   for timeline-local domains and `applyGlobal` for global configuration.
3. **Project once.** `projectFeatureScenario` (`src/engine/featureHandlers.ts`)
   selects exactly one named timeline, compiles one context, composes the four
   feature streams, delegates to the `projectScenario` kernel facade, and
   attaches exactly one immutable `ProjectionReport`.
4. **Render.** Views read that one report only.
5. **Save.** A coalesced autosave controller (`src/autosave.ts`) funnels every
   write through the guarded `saveAppState`.

## Layers

- **Kernel** (deterministic, cents-only, side-effect-free): `dates.ts`,
  `money.ts`, `state.ts` (the sole mutation route, `state.commitChanges`),
  `taxes.ts`, `funding.ts`, `scheduler.ts`, `valuation.ts`, `opening.ts`,
  `journal.ts`, `contracts.ts` — all in `src/engine/`.
- **Feature streams:** `income.ts`; `spending.ts` / `planner.ts` /
  `retirement.ts`; `cards.ts` / `loans.ts` / `housing.ts`.
- **Composition + reporting:** `configuration.ts` (named-context compiler),
  `projection.ts` (`projectScenario` facade), `featureHandlers.ts` (composition
  seam), `reporting.ts` (read-only `ProjectionReport`).
- **Persistence:** `codec.ts` (allowlist-only schema-v3 encode/decode),
  `storage.ts` (localStorage key + save guard), `autosave.ts` (coalesced writes).
- **Commands:** `commands.ts` (the single canonical write/read surface).
- **Domain + defaults:** `types.ts`, `defaultScenario.ts`, `paycheck.ts`
  (compiles the granular `CareerEntry.paycheck`).

## Projection Contract

- **One projection, one report.** `projectFeatureScenario` selects one timeline,
  compiles one context, composes all four streams, and builds exactly one report.
  There is no second projection call and no preview loop.
- The raw `projectScenario` facade is **kernel-only**: it returns a cents-only
  `ProjectionRun`. Its `complete` flag stays `false` unless a call site claims
  full coverage **and** the run covered the whole requested horizon with nothing
  blocked.
- Runtime account math is integer cents. Mutation happens only through
  `state.commitChanges` (revision-checked, all-or-none, with a declared
  `expectedNetWorthDeltaCents`).
- Dates and horizons are explicit inputs; the engine never reads the wall clock.

## Tabs and Intent

- `Options` (tab id `options`): Profile & assumptions, plus the shared summary.
- `Finances Prediction` (tab id `careers`): sub-tabs `retirement`, `careers`,
  `timeline`, `purchasesExpenses`, `housing`, `trajectory`, `warnings`,
  `dateMarkers`.
- `Net Worth` (tab id `netWorth`): accounts/liabilities/properties, opening
  snapshot, history.
- `Expenses` (tab id `expenses`): sub-tabs `planning`, `tracking`, `creditCards`.

## Related Docs

- `docs/INDEX.md` lists the doc set; `docs/TEST_MAP.md` lists test entry points.
- `refactor/phase5_handoff.md` records the current engineering state and explicit
  non-claims.
- The historical documents `docs/LegacyRemoval.md`,
  `docs/ManualContributionLeakPlan.md` and `docs/PLAN_DATE_BASED_CAREERS.md`
  record past plans and are labeled superseded.
