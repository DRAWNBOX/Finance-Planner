# Pending Changes — Handoff

This document lists the remaining work to implement. It was written to be handed to another session.

## Background

The engine (`src/engine/projection.ts`) was validated. Findings:

- **Correct (no change needed):** `applyAccountDeposit` (plain add), `applySourceContributions` (`salary/12 × rate/100` monthly), and the deposit/growth ordering (one growth pass per month, no double-counting).
- **Issue A — growth convention:** `applyMonthlyGrowth` uses `monthlyRate = rate / 12`, which makes the effective annual return slightly *higher* than the stated rate (e.g. 6.5% → ~6.70%). Decision: change to **exact APY**.
- **Issue B — salary inconsistency:** source-line contributions use the raised `salary`, but `monthlyTakeHome` and the `percentOfSalary`-based retirement/HSA helpers use the base `pi.grossSalary`. Decision: use the raised `salary` everywhere.

## Task 1 — Growth: exact APY

**File:** `src/engine/projection.ts` — function `applyMonthlyGrowth` (around line 180).

Change:

```ts
const monthlyRate = rate / 12;
```

to:

```ts
const monthlyRate = Math.pow(1 + rate, 1 / 12) - 1;
```

(`rate` is already a decimal fraction via `toRate()`, e.g. `0.065`. With the new formula, `(1 + monthlyRate)^12 === 1 + rate`.)

## Task 2 — Salary consistency

**File:** `src/engine/projection.ts`, inside the yearly loop (after `const salary = ...` at ~line 562, which is already in scope).

Use the raised `salary` instead of `pi.grossSalary` in these five spots:

1. `monthlyTakeHome` (~line 611):

```ts
const monthlyTakeHome = pi
  ? Math.max(0, (salary - pi.taxes - pi.healthBenefits - pi.otherBenefits - getYearlyRetirement() - getYearlyHsaContribution() - (pi.livingExpenses ?? 0)) / 12)
  : 0;
```

2. `getYearlyRetirement` — `percentOfSalary` branch (~line 584):

```ts
if (pi.retirementMode === 'percentOfSalary') return salary * (pi.retirement ?? 0) / 100;
```

3. `getYearlyRetirementMatch` — employer max-match cap (~line 591):

```ts
const maxMatch = salary * (pi.employerMaxMatchPercent ?? 0) / 100;
```

4. `getYearlyHsaContribution` — `percentOfSalary` branch (~line 598):

```ts
if (pi.hsaContributionMode === 'percentOfSalary') return salary * (pi.hsaContribution ?? 0) / 100;
```

5. `getYearlyEmployerHsaDeposit` — `percentOfSalary` branch (~line 608):

```ts
if (pi.employerHsaDepositMode === 'percentOfSalary') return salary * (pi.employerHsaDeposit ?? 0) / 100;
```

Notes:
- "amount" modes intentionally stay fixed.
- `getYearlyHsaEmployerMatch` (`percentOfHsaContribution`) and `getYearlyRetirementMatch` (`percentOfRetirement`) automatically inherit the fix because they call the fixed `getYearlyHsaContribution` / `getYearlyRetirement`.

## Task 3 — Tests

**File:** `src/engine/projection.test.ts`

### 3a. Fix the existing "compounds monthly while APY input remains annual" test (~line 2270)

It currently uses the legacy pool field `annualReturnRate` (which the engine ignores — the engine reads `preRetirementReturnRate`), and asserts APR/12 compounding.

- Change the pool override from `annualReturnRate: ...` to `preRetirementReturnRate: ...`:

```ts
pools: defaultScenario.netWorth.pools?.map(p => ({ ...p, preRetirementReturnRate: p.id === 'emergencyFund' ? 12 : 0 }))
```

- Change the expected value to exact APY:

```ts
const expected = 1000 * (1 + 0.12); // 1120
```

### 3b. Add a test: take-home grows with the raise

Scenario with a non-zero `annualRaiseRate` and no source-line contributions; assert that a later year's `monthlyTakeHome`-driven income (or the resulting account balance) reflects the raised salary rather than the frozen base. (Simplest observable: an income-funded purchase is covered in a later year because take-home grew.)

### 3c. Add a test: `percentOfSalary` retirement grows with the raise

Career with `paycheckInfo.retirementMode = 'percentOfSalary'` and `annualRaiseRate > 0`; assert the retirement account's yearly deposit grows between two ages.

## Task 4 — Recalibration

The APY change lowers effective growth vs. today, so many engine tests will shift. After Tasks 1–3, run:

```
npm run build
npm run test -- --run
```

and update any now-failing engine expectations (they should fail in a *predictable* direction — slightly lower balances).

## Reference: current line map (may drift slightly)

| Item | Location |
|------|----------|
| `toRate` | `projection.ts:~15` |
| `applyAccountDeposit` | `projection.ts:117-127` |
| `applyMonthlyGrowth` | `projection.ts:180-193` |
| `applySourceContributions` | `projection.ts:227-264` |
| raised `salary` | `projection.ts:562-569` |
| `getYearlyRetirement` | `projection.ts:582-586` |
| `getYearlyRetirementMatch` | `projection.ts:587-595` |
| `getYearlyHsaContribution` | `projection.ts:596-600` |
| `getYearlyHsaEmployerMatch` | `projection.ts:601-605` |
| `getYearlyEmployerHsaDeposit` | `projection.ts:606-610` |
| `monthlyTakeHome` | `projection.ts:611-613` |
| `applyMonthlyGrowth` call | `projection.ts:741` |
| APY test | `projection.test.ts:~2270` |
