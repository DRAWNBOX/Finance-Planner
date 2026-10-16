# Phase 5 P5.5 — B01–B09 target before/after table

Owner: Q (P5.5). Status: documented acceptance artifact. This table does **not**
modify or refresh any snapshot and does **not** re-run the archived scenarios
against the new engine.

**Canonical B-numbering:** the fixture IDs follow the archived snapshot's export
order (the order of `exports[...]` blocks in
`refactor/fixtures/projection.pre-refactor.snap`), **not** the descriptive order
in `feature_specification.md`. Each row cites the archived export block, the
archived scenario input block, the archived `startDate`, and the closest HEAD
historical-test builder line.

## Preservation

The original evidence is preserved byte-for-byte and is **not** edited:

- `refactor/fixtures/projection.pre-refactor.snap`
  - SHA-256 `98B57CECE90F7EA40E6E140DBE4C1C821FBD02FE01E60EE377162E501354747C`
  - size `321548` bytes
- Historical input builders recoverable read-only from
  `git show HEAD:src/engine/projection.characterization.test.ts`
  (`startDate = '2026-01-01T00:00:00'` at line 11; the `scenarios` map at line 49).
- Every archived export serializes `{ result, scenario, startDate }`; the
  archived input lives inside each export block (scenario block start + the
  trailing `"startDate"` line) at the fixture line numbers cited below.

All "before" numbers are the archived fixture values. No "after" number is
fabricated: a target cell is either an **independently computed** expectation for
the analogous fixture in `src/engine/phase5CrossFeature.test.ts` (a **new**
fixture, not a replay of the archived scenario), or it is explicitly classified
`non-equivalent old modes; target CA case`.

## Table

| Fixture (canonical) | Archived snapshot test title & export | Archived before (metric lines) | Archived scenario / startDate (fixture) | HEAD historical-test builder | Target analogous fixture | Target expectation / classification |
|---|---|---|---|---|---|---|
| **B01** | `all credit card modes with interest, intro period and shortfalls` (`snap:4`) | `depletedAge: 45` (`:23`); `endingBalance: 0` (`:25`) | scenario `:1098`; `startDate` `:1364` | `characterization.test.ts:81` | `phase5CrossFeature.test.ts` → **CA06** "pays a $100 permanent-0% balance as 33.34/33.33/33.33" + ordinary-card case | **Classification:** APR / recurring-charges / intro-period card modes are removed → `non-equivalent old modes; target CA06`. **Computed (new fixture):** 0% installments `[3334, 3333, 3333]¢` (Σ `10_000¢`), closing debt `0`; ordinary card = 12 × `1_000¢`, ending cash `88_000¢`, no debt. |
| **B02** | `manual contribution is reported without an account deposit` (`snap:1368`) | `depletedAge: null` (`:1375`); `endingBalance: 10_000` (`:1377`); `yearlyContribution: 1200` (`:2415`) | scenario `:2407`; `startDate` `:2572` | `characterization.test.ts:113` (post-removal analogue) | — (feature removed under F21/R03) | **Classification:** `non-equivalent old modes; target CA11`. The archived scenario predates the approved standalone-contribution removal, so its exact input is preserved in the fixture (`:2407`, with `yearlyContribution: 1200` at `:2415`); the HEAD builder at `:113` is the post-removal analogue. The field is pruned on save/load (reference only — `src/codec.test.ts` / `src/storage.test.ts`; not duplicated). **No after number is asserted** because the feature no longer exists. |
| **B03** | `monthly and annual spending use independent income budgets` (`snap:2576`) | `depletedAge: null` (`:2592`); `endingBalance: 10_000` (`:2594`) | scenario `:3824`; `startDate` `:4109` | `characterization.test.ts:67` | `phase5CrossFeature.test.ts` → **CA01/CA02** "reconciles a multi-month close grid" | **Classification:** the archived annual-`extraCashflow` reuse is a removed old mode → `non-equivalent old modes; target CA02`. **Computed (new fixture):** monthly closing **stocks** `[100_000, 150_000, 250_000]¢`; **Σ actual monthly net flows** = `+100_000` (Jan) `+50_000` (Feb) `+100_000` (Mar) = `250_000¢`. The flow sum equals the final closing stock **only because opening stock is 0** — the invariant is flow-vs-flow, not "annual = last closing balance". `executedNetCents` is `50_000¢` (only funded planner debits are plans; payroll is a direct commit, not counted here). |
| **B04** | `mortgage funding failure, rental income and home sale` (`snap:4113`) | `depletedAge: null` (`:4120`); `endingBalance: 4_050` (`:4122`) | scenario `:5206`; `startDate` `:5402` | `characterization.test.ts:91` | `phase5CrossFeature.test.ts` → **CA09** "held-deposit acquisition" | **Classification:** the archived scheduled-amortization / rental / sale modes are `non-equivalent old modes; target CA09`. **Computed (new fixture):** each held funding event is `3_000_000¢` (`$30k`, **not** `30_000¢`); Jan pending deposit `3_000_000¢`, cash `3_000_000¢`, no mortgage; Feb completes atomically → property `30_000_000¢`, mortgage `24_000_000¢`, cash `0`, ending net worth `6_000_000¢` (the `$60k` down payment), no second down-payment expense. |
| **B05** | `opening balances and exact APY` (`snap:5406`) | `depletedAge: null` (`:5413`); `endingBalance: 11342.249999999978` (`:5415`) | scenario `:6445`; `startDate` `:6610` | `characterization.test.ts:50` | `phase5CrossFeature.test.ts` → **CA08** "compounds a stated 6.5% APY exactly" | **Computed (new fixture):** 1-month growth `5262¢` → `$10,052.62`; 24-month close `1_134_226¢` = `$11,342.26`. The archived `$11,342.2499…` reflects unrounded intermediate compounding; the target rounds once per month (documented exact-APY HAFZ) — an intentional before/after difference, not a blind refresh. |
| **B06** | `partial first period and effective pay plan` (`snap:6614`) | `depletedAge: null` (`:6628`); `endingBalance: 10_000` (`:6630`) | scenario `:7438`; `startDate` `:7711` | `characterization.test.ts:105` | `phase5CrossFeature.test.ts` → **CA08** "clipped partial-month exponent" | **Classification:** the archived "annual income uses the last monthly rate, not actual period total" behaviour is a removed defect → `non-equivalent old modes; target CA08` (pay-plan selection is covered by `income.test.ts`). **Computed (new fixture):** `startDate '2026-01-16'` → `monthFraction 16/31`; growth `2712¢` → `$10,027.12`. |
| **B07** | `payroll deposits, matching, capped savings and monthly expenses` (`snap:7715`) | `depletedAge: null` (`:7729`); `endingBalance: 11_680` (`:7731`) | scenario `:8965`; `startDate` `:9269` | `characterization.test.ts:55` | `phase5CrossFeature.test.ts` → **CA01** "posts payroll once to distinct destinations" (payroll/deposit subset) | **Computed (new fixture):** gross `100_000¢`, tax `10_000¢`, employee retirement `5_000¢`, net `85_000¢`; 10%-of-net allocation `8_500¢` → emergency; remainder `76_500¢` → checking; retirement account `5_000¢`. **Classification:** employer-match and cap-overflow portions are `non-equivalent old modes; target CA01` (cap policy covered by `income.test.ts`). |
| **B08** | `scheduled purchases, cashflow and life events` (`snap:9273`) | `depletedAge: null` (`:9280`); `endingBalance: 10_125` (`:9282`) | scenario `:10429`; `startDate` `:10669` | `characterization.test.ts:97` | `phase5CrossFeature.test.ts` → **CA10** (occurrence identity) + **CA03** (split/no-op) | **Classification:** archived cashflow/recurrence handling is `non-equivalent old modes; target CA10/CA03`. **Computed (new fixtures):** exactly one occurrence per dated record (`['planner:plan-one:2026-01-01']`; occurred record unscheduled; checking `90_000¢`); monthly day-31 clamps to `2026-02-28` (never `2026-02-31`); primary-first split `10_000¢`/`20_000¢` (balances `40_000¢`/`30_000¢`); unfunded request is an atomic no-op (0 postings, shortfall `30_000¢`). |
| **B09** | `split fallback and tax-aware retirement exhaustion` (`snap:10673`) | `depletedAge: 65` (`:10680`); `endingBalance: 0` (`:10682`) | scenario `:11260`; `startDate` `:11434` | `characterization.test.ts:73` | `phase5CrossFeature.test.ts` → **CA04** (identity/HSA), **CA03** (split), **CA07** (basis) | **Classification:** pool-era 20%-withholding retirement-exhaustion config is `non-equivalent old modes; target CA04/CA03/CA07`. **Computed (new fixtures):** 3% income tax on `$1,000` gross → tax `3_000¢`, net `97_000¢` (identity holds); non-qualified HSA 20% penalty `12_000¢` on `$600` gross → net `48_000¢` (end-to-end gross-up: penalty `2_500¢`, gross debit `12_500¢`, HSA `100_000→87_500¢`); 4% basis frozen at `33333¢` first month, Σ `400_000¢`; primary-first purchase split `10_000¢`/`20_000¢`. |

## Notes

- B01–B09 archived snapshots are change-detection evidence, not target financial
  truth (`refactor/testing_correctness_audit.md` TC04). Corrections above are
  documented, not blanket-refreshed.
- The archived scenario is never replayed against the new engine here; target
  cells describe the **new** analogous fixtures only.
- The historical loan-row failure referenced by TC01–TC03 is a **legacy
  `App.test.tsx`** failure (App-owned); it is outside this file's engine scope
  and is not reproduced or masked here. Restoring owner: integration owner
  (P5.2/P5.4 App acceptance).
- CA11 is intentionally reference-only in the new suite; canonical save/load is
  covered by the P1 codec suite.
