# AGENTS

This repository supports AI-assisted development. Use this as a fast, practical jumpstart.

## Quick Start

1. Read `docs/INDEX.md` for the doc map.
2. Read runtime entry points:
   - `src/App.tsx` (composition root + tab orchestration)
   - `src/engine/projection.ts` (core deterministic simulation)
   - `src/financeModel.ts` (pool/account/source-line compatibility helpers)
   - `src/storage.ts` (localStorage load/save + migrations/normalizers)
3. Confirm current schema defaults and normalization:
   - `src/types.ts`
   - `src/defaultScenario.ts`
   - `src/storage.ts`

## Current Project Shape

- Stack: React 19 + TypeScript + Vite + Vitest.
- Main tabs/state: `options`, `careers`, `netWorth`, `expenses`.
- Projection outputs drive:
  - `src/components/ChartPanel.tsx`
  - `src/components/SavingsStackedChart.tsx`
  - `src/components/ResultsTable.tsx`
- Net worth import/history path:
  - `src/importers/bankImport.ts`
  - `src/components/NetWorthHistoryChart.tsx`
- Expenses planning/tracking path:
  - `src/components/ExpensesPlanner.tsx`
  - `src/importers/expenseImport.ts`

## Commands

- Dev server: `npm run dev`
- Run all tests: `npm run test -- --run`
- Run engine tests: `npm run test -- --run src/engine/projection.test.ts`
- Run app integration tests: `npm run test -- --run src/App.test.tsx`
- Build: `npm run build`

## Core Invariants

- Keep projection/account math deterministic and side-effect free.
- Runtime source of truth for account-led math is `accountBalancesById` (not legacy pool-only fields).
- Preserve backward compatibility by normalizing saved state in `storage.ts`.
- Treat migrations as pure transforms; avoid implicit behavior tied to render timing.

## Schema Change Playbook

For any persisted field addition or shape change:

1. Add/adjust types in `src/types.ts`.
2. Add defaults in `src/defaultScenario.ts`.
3. Add load-time normalization/migration in `src/storage.ts`.
4. Ensure runtime usage in `src/App.tsx` and/or `src/engine/projection.ts`.
5. Add or update tests for both engine and UI flow when behavior changes.

## High-Risk Areas

- Retirement withdrawal funding source-line logic.
- Monthly vs yearly contribution/withdrawal conversion.
- Career timeline/source-line normalization and graph source switching.
- Loan and purchase funding shortfall math.
- Local storage migration paths (legacy tabs/legacy fields/new dynamic accounts).

## Test Focus Map

- Engine behavior: `src/engine/projection.test.ts`
- UI integration/regressions: `src/App.test.tsx`
- Import parsing: `src/importers/bankImport.test.ts`

When changing account math, funding, careers, or retirement logic, run at least engine + app tests. Also create new tests as needed to test any new logic added.

## Notes On Docs Consistency

- `docs/` is the primary onboarding source, but verify file references against `src/components` before editing.
- Some docs may reference older component names; treat runtime files as source of truth.

## Change Checklist

1. Types/defaults/storage stay aligned for all new or changed persisted fields.
2. Engine formula changes are covered by/validated with tests.
3. UI still renders chart/table paths correctly for Options and Finances flows.
4. `npm run test -- --run` and `npm run build` pass before handoff.
