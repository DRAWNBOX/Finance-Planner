# Architecture

## High-Level Flow

1. UI state is loaded from local storage (`loadAppState` in `src/storage.ts`).
2. `src/App.tsx` owns app state and builds scenario variants for tabs/graphs.
3. Projections are computed by `projectScenario` in `src/engine/projection.ts`.
4. Results render through:
   - `ChartPanel` (portfolio line/area)
   - `SavingsStackedChart` (account stacked areas)
   - `ResultsTable` (year-by-year table)
5. State changes are persisted through `saveAppState`.

## Main Modules

- `src/App.tsx`: Composition root and orchestration.
- `src/engine/projection.ts`: Core financial simulation.
- `src/components/*`: Editing and visualization UI.
- `src/storage.ts`: Persistence + backward compatibility normalization.
- `src/defaultScenario.ts`: Default scenario object and default creators.
- `src/types.ts`: Shared domain contracts.

## Tabs and Intent

- `Retirement`: Retirement-focused settings and independent retirement graph behavior.
- `Options`: Date of birth and global options.
- `Careers`: Career timeline, account contribution/expense controls, career-driven graph behavior.
- `Net Worth`: Account balances and as-of date baseline.
