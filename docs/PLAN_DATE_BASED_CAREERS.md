# PLAN — Date-based careers & full age→date migration

Status: Phase 1 complete (date-based career selection + per-month `careerEndSavingsBalances`). Phase 2 not started.
Created from the "income usage budget is wrong" investigation.

## 0. Confirmed root cause (from the user's saved JSON)

Two careers overlap at the SAME age but different months:

| Career         | startAge | endAge | startYearMonth | endYearMonth |
|----------------|----------|--------|----------------|--------------|
| Panduit        | 25       | 27     | 2025-11        | 2028-04      |
| End Game Job   | 27       | 53     | 2028-05        | 2053-11      |

`projection.ts` selects the active career per **age-year** via `getCareerEntryForAge`
(`projection.ts:399`): `age >= startAge && age <= endAge`, returning the LAST matching
entry. At age 27 BOTH match, so **End Game Job** (listed last) wins for the entire age-27
year (≈2027-11 → 2028-10), even though it should not start until 2028-05.

Evidence the engine used End Game Job for 2027-11…2028-10:

- Budget `$1,783/mo` = End Game Job net: `(42060 − 10094.4 − 2744.04 − 4626.6 − 3200.04) ÷ 12 = 1782.91`
- "Career savings $730" = End Game Job sourceLines (investments 5.12% + emergency 35.84% = 40.96%) × `1782.91 = 730.3`
- The plan the user inspected (Panduit "Move Out", net `$991/wk ≈ $4,296/mo`) is not the one the engine used.

The net-pay **plan** is already resolved per month; the **career** is still resolved
per year (`careerEntry = getCareerEntryForAge(scenario, age)` at `projection.ts:717`,
used inside the month loop at `:804-865`).

---

## Phase 1 — Career selection by DATE (immediate bug fix)

### 1.1 New helper `getCareerEntryForMonth`

Add in `src/engine/projection.ts` (needs `projectionStartSerial`, `currentAge`, `dateOfBirth`):

```ts
const getCareerEntryForMonth = (scenario, monthSerial, age): CareerEntry | undefined => {
  const enabled = scenario.careerPlan.entries.filter((e) => e.enabled);
  const matching = enabled.filter((entry) => {
    const startSerial = entry.startYearMonth
      ? parseYearMonthToSerial(entry.startYearMonth)
      : projectionStartSerial + (entry.startAge - currentAge) * 12;
    const endSerial = entry.endYearMonth
      ? parseYearMonthToSerial(entry.endYearMonth)
      : projectionStartSerial + (entry.endAge - currentAge) * 12 + 11;
    return startSerial !== null && endSerial !== null &&
           monthSerial >= startSerial && monthSerial <= endSerial;
  });
  // Prefer the most recently started; fall back to age-based selection.
  return matching.length ? matching[matching.length - 1] : getCareerEntryForAge(scenario, age);
};
```

(Assumes entries are ordered by start; otherwise sort by startSerial.)

### 1.2 Use it in the month loop

In the month loop replace the year-scoped `careerEntry` with a per-month career:

```ts
const monthCareer = getCareerEntryForMonth(scenario, currentMonthSerial, age);
const activePlan  = resolveActiveCareerPayPlan(monthCareer, currentMonthSerial);
const planPaycheck = activePlan?.paycheck ?? monthCareer?.paycheck;
const pi = activePlan ? resolvePaycheckInfo({ paycheck: activePlan.paycheck })
                      : resolvePaycheckInfo(monthCareer ?? undefined);
const careerSourceLines = (activePlan?.sourceLines ?? monthCareer?.sourceLines ?? []).filter((l) => l.enabled);
const planStartAge = activePlan ? (ageFromYearMonth(...) ?? monthCareer?.startAge ?? age)
                                : (monthCareer?.startAge ?? age);
const planRaiseRate = activePlan?.annualRaiseRate ?? monthCareer?.annualRaiseRate ?? 0;
salary = ... (use monthCareer instead of careerEntry) ...
```

Also update the negative-net-pay label (`:861-865`) to use `monthCareer`.

### 1.3 `careerEndSavingsBalances` (INCLUDED)

Current bug: `if (careerEntry && age === careerEntry.endAge) careerEndSavingsBalances[careerEntry.id] = poolTotals;`
(`projection.ts:1860`) keys off the year-scoped career and misfires with overlapping ages.

Change to record at the career's **end month**, per month:

- Precompute per-career end serial (`endYearMonth` or age fallback) before the loop.
- Inside the month loop, when `currentMonthSerial === endSerialFor(monthCareer)`, set
  `careerEndSavingsBalances[monthCareer.id] = { ...poolTotals }` (overwrite so the true end wins;
  or keep last-seen). If a career has no explicit end, fall back to `endAge`-derived month.
- Update the "Retirement assets from careers" consumer in `App.tsx`
  (`retirementAssetsFromCareers`, `:964-973`) — keying stays by career id, so no signature change.

### 1.4 Tests (Phase 1)

- Engine: two enabled careers with overlapping ages but distinct month ranges → each month's
  `salary`/`netIncome`/source-line deposits and `careerEndSavingsBalances` use the correct career.
  Assert the `2027-11`..`2028-04` months use career A's net and `2028-05`+ use career B's.
- Engine: single-career scenarios unchanged.
- App: the income-usage warning for the user's shape no longer misattributes months.

---

## Phase 2 — ALL age-derived logic becomes DATE-based; age = display only

Rule: **the engine must never branch on an integer age.** For any month,
`age = ageFromYearMonth(currentYearMonth, dateOfBirth)` is used only for display.
All scheduling, growth, thresholds, and selection are by year-month.

### 2.1 Simulation loop (core change)

- Iterate **month by month** from `projectionStartSerial` to `endSerial`
  (instead of `for offset < totalYears { age = currentAge + offset }`).
- Define dates once:
  - `simulationStartYearMonth`
  - `retirementYearMonth = formatYearMonthFromAge(profile.retirementAge, dob)`
  - `endYearMonth = addMonthsToYearMonth(retirementYearMonth, profile.retirementYears * 12)`
- Group monthly results into **projection years on birthday boundaries** (preserve the
  table's "one row per age" meaning) OR calendar years — DECISION NEEDED (see §4).
  `ProjectionYear.age` / `MonthlySnapshot.age` remain display-only, derived from the month/date.
- Replace `isBaselineNow`/`displayAge` logic with date-derived equivalents.

### 2.2 Retirement

- `age >= retirementAge` → `currentMonthSerial >= retirementYearMonthSerial`.
- `firstYearByLegacy`, `previousPlannedRetirementLines`, min/max thresholds, HSA penalty-free
  (age 65) checks: convert to date comparisons or `ageFromYearMonth` (display/legal age).
- `useRetirementAgeAsWithdrawalStartAge` and `SourceLine.startAge` → start dates
  (derive a `startYearMonth` from `startAge` via DOB when migrating).

### 2.3 Careers / pay plans

- Remove `getCareerEntryForAge` from the runtime path (keep as a migration helper only).
- `raiseFactor = (1 + rate) ^ yearsBetween(planStartDate, currentDate)` where
  `yearsBetween(a,b) = (bSerial - aSerial) / 12`.
- `annualRaiseRate` growth, `annualSalaryGrowthOverride` (job_change) → elapsed years.

### 2.4 Items

- **Large purchases**: require/derive `yearMonth`; drop `purchase.age` runtime use
  (`:1539`, `:1569`).
- **Loans**: already `startYearMonth`; keep monthly.
- **Housing**: already date-based (`startYearMonth`/`sellYearMonth`/`endYearMonth`, `monthsSinceStart`).
- **Cashflow items / life events**: use `startYearMonth`/`endYearMonth`; remove age fallbacks
  (`:978-1031`); inflation `yearsFromStart = (currentSerial - startSerial)/12`.
- **Job change / career break** life events: `startAge`/`endAge` → start/end dates.
- **Contribution plan**: `(1 + yearlyIncreaseRate) ^ yearsSinceStart` (from dates).

### 2.5 Types / schema (`src/types.ts`)

Add explicit date fields, keep age fields only as display/derivation:

- `CareerEntry`: `startYearMonth`/`endYearMonth` authoritative; `startAge`/`endAge` become
  derived (or removed from persisted shape).
- `LargePurchase`: `yearMonth` authoritative (drop `age`).
- `CashflowItem` / `LifeEvent` / job-change: add `startYearMonth`/`endYearMonth`, drop age runtime.
- `WithdrawalPlan.sourceLines[].startAge` → `startYearMonth`.
- `Profile.retirementAge`/`retirementYears` → keep as the source of the retirement DATE
  (converted once via DOB), or introduce explicit retirement date fields — DECISION NEEDED.
- `FutureRetirementPlan`/`AgeOptions` similarly.

### 2.6 Storage (`src/storage.ts`) — schema playbook

- Normalize every new/changed date field (type + default + load normalization).
- Migrate legacy age-only fields → dates using `formatYearMonthFromAge(age, dob, currentAge)`.
- Keep `ageFromYearMonth` round-trips so existing saves load.

### 2.7 Defaults (`src/defaultScenario.ts`)

- Seed date fields; keep age inputs only where still configured (retirement age).

### 2.8 UI (`src/App.tsx`, `src/components/*`)

- Career editor: Start/End already use `DateOrMarkerInput`; make them the primary inputs and
  show the derived age as text. Retire `useBirthdayBasedStartAge` / `usePreviousCareerStartAge`
  as *age* toggles in favor of date semantics (they already manipulate year-months).
- Purchases / cashflow / life events: require dates (Year-Month), show derived age.
- Charts: x-axis/flags already use `yearMonth` where present; ensure all flags anchor by date.
- `normalizeCareerTimeline` age↔month conversion (`App.tsx:136-176`) becomes migration-only.
- `getCareerDerivedRetirementAge`, `birthdayBasedCareerStartAge`, `currentAge` → derived.

### 2.9 Tests

- Engine: convert age-based fixtures to date-based; add cross-boundary cases
  (career change mid-year, retirement mid-year, raise mid-year, purchase/cashflow by date).
- App: date inputs + derived-age display; charts/tables consistent.
- Large surface: many existing tests assert `year.age`; keep `age` as a display field so
  `.age` assertions still work, but assert date-derived selection where relevant.

---

## 3. Files touched (inventory)

- `src/engine/projection.ts` — selection, loop, retirement, growth, items, `careerEndSavingsBalances`.
- `src/types.ts` — date fields; age fields demoted to display.
- `src/storage.ts` — normalization + migration.
- `src/defaultScenario.ts` — defaults.
- `src/App.tsx` — editor inputs, derived age, `retirementAssetsFromCareers`, flags.
- `src/components/CareerPlanEditor.tsx`, `HousingEditor.tsx`, `CashflowItemEditor.tsx`,
  `YearMonthInput.tsx`, `DateOrMarkerInput.tsx`.
- `src/utils/ageDate.ts` — helpers (`yearsBetween`, serial helpers), keep `ageFromYearMonth`.
- `src/utils/dateMarkers.ts` — resolve all date fields (careers already covered).
- Tests: `src/engine/projection.test.ts`, `src/App.test.tsx`, `src/utils/dateMarkers.test.ts`.

## 4. DECISIONS NEEDED (ask before Phase 2)

1. **Projection-year grouping** once monthly: keep one row per *age-year* (birthday→birthday) or
   per *calendar year*? (Tables/charts currently assume age-year.)
2. **Retirement config**: keep `retirementAge`/`retirementYears` numbers (converted to dates via DOB)
   or add explicit `retirementYearMonth` / `retirementEndYearMonth` fields?
3. **Age-only fields without months** (legacy): auto-derive dates from DOB, or require the user to
   set dates (with a migration default)?
4. **Remove vs keep** `startAge`/`endAge` on persisted items (keep as derived/display, or delete and
   shorten the schema)?
5. **`useBirthdayBasedStartAge` / `usePreviousCareerStartAge`**: keep as conveniences that write
   year-months, or remove and rely purely on date fields?

## 5. Risks / notes

- Phase 2 is a large, cross-cutting refactor (engine + schema + storage + UI + many tests).
  Land Phase 1 first (fixes the reported bug independently).
- Keep `ProjectionYear.age`/`MonthlySnapshot.age` as **display-only** to avoid breaking the
  results table, charts, and a large number of `.age` assertions.
- Preserve determinism and side-effect-free engine invariants (see AGENTS.md).
- Update `AGENTS.md` invariants and `CHANGES.md` before any commit/push.
