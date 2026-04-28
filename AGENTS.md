# AGENTS

This repository supports AI-assisted development. Use this as a fast working guide.

## Quick Start

1. Read `docs/INDEX.md`.
2. For behavior bugs, read:
   - `src/App.tsx`
   - `src/engine/projection.ts`
3. For schema updates, always update:
   - `src/types.ts`
   - `src/defaultScenario.ts`
   - `src/storage.ts`

## Commands

- Run tests: `npm run test -- --run`
- Build: `npm run build`

## Editing Rules

- Keep calculations deterministic and side-effect free.
- Favor explicit normalization for backward compatibility.
- For account math changes, verify both:
  - engine tests
  - UI behavior via app tests

## High-Risk Areas

- Retirement withdrawal funding logic
- Monthly-vs-yearly account conversion paths
- Career graph source switching
- Local storage migrations/normalizers

## PR/Change Checklist

1. Types/defaults/storage aligned for new fields.
2. Engine formula changes covered by tests.
3. UI still builds and chart/table paths are consistent.
4. `npm run test -- --run` and `npm run build` both pass.
