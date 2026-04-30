# Test Map

## Test Files

- `src/engine/projection.test.ts`
- `src/App.test.tsx`
- `src/importers/bankImport.test.ts`

## Engine Coverage (`projection.test.ts`)

Validates core projection behavior, including:

- pre-retirement growth mechanics
- withdrawal modes (4% rule and specified)
- inflation-adjusted withdrawal progression
- recurring/one-time cashflow behavior
- job change and career break effects
- historical mode determinism
- depletion detection
- account tracking and per-career ending balances
- monthly account withdrawal handling
- large purchase, long-term purchase, and loan funding effects
- dynamic account/pool source-line behavior

## App Coverage (`App.test.tsx`)

Validates integration/UI behaviors, including:

- chart and table rendering
- Options sharing Finances Prediction graph/table/summary behavior
- options persistence (DOB age mode)
- tab migration behavior from older UI states
- career timeline normalization and controls
- duplicate/remove workflow
- stacked savings graph controls
- net worth persistence behavior
- purchases and loans viability highlighting
- expenses tab visibility, planning UI, import traceability, and rollback
- net worth imports, account remap, and history chart controls

## Importer Coverage (`bankImport.test.ts`)

Validates bank statement parsing behavior, including:

- account detection
- statement date parsing
- imported balance extraction

## Suggested New Tests For Future Work

- regression test for age-25 account row math with custom inputs
