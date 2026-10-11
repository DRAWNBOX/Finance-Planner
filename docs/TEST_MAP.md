# Test Map

## Test Files

- `src/engine/projection.test.ts`
- `src/App.test.tsx`

## Engine Coverage (`projection.test.ts`)

Validates core projection behavior, including:

- pre-retirement growth mechanics
- exact-APY monthly compounding
- take-home and `percentOfSalary` retirement growth with annual raises
- withdrawal modes (4% rule and specified)
- inflation-adjusted withdrawal progression
- recurring/one-time cashflow behavior (incl. monthly deposit to the selected account)
- job change and career break effects
- historical mode determinism
- depletion detection
- account tracking and per-career ending balances
- monthly account withdrawal handling
- large purchase, long-term purchase, and loan funding effects
- dynamic account/pool source-line behavior
- housing grouped payment sources (each expense group drawn from its own account)

## App Coverage (`App.test.tsx`)

Validates integration/UI behaviors, including:

- chart and table rendering
- Options sharing Finances Prediction graph/table/summary behavior
- options persistence (DOB age mode)
- tab migration behavior from older UI states
- career timeline normalization and controls
- duplicate/remove workflow
- timeline copy (duplicate) from the manage modal
- stacked savings graph controls
- net worth persistence behavior
- purchases and loans viability highlighting
- expenses tab visibility, planning UI, import traceability, and rollback
- net worth imports, account remap, and history chart controls
- housing chip editor (mixed mortgages/rentals, duplicate, reorder, use-previous-end gating, per-expense payment source selectors)
- housing/timeline independence
- trajectory snapshots (save/name, compare metrics + per-account diffs, selection persistence, delete)

## Suggested New Tests For Future Work

- regression test for age-25 account row math with custom inputs
