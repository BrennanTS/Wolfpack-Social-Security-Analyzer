# ssa.tools Engine Audit

An audit of the vendored calculation engine at `src/vendor/ssa-tools/` (a copy of
[Gregable/social-security-tools](https://github.com/Gregable/social-security-tools), MIT licensed;
~6,600 lines). Read this instead of re-reading the engine.

**Method.** Every claim below is grounded in the vendored source and cites `file:line`. Where an SSA
rule is described, ssa.gov is cited only to explain the rule; the claim that *this engine implements
it* always comes from the code. Absences were established by exhaustive search over
`src/vendor/ssa-tools/**/*.ts`, not by assumption. Nothing under `src/vendor/ssa-tools/` was
modified. Test suites were not run.

Paths are relative to the repo root. The engine is aliased to `$lib` for app code
(`vite.config.ts:13`, `tsconfig.app.json:13`), so `$lib/month-time` is
`src/vendor/ssa-tools/month-time.ts`.

---

## 1. Summary

### What the engine models

| | Where the amount is computed |
|---|---|
| **Personal** (own retirement) benefit, with early-claim reduction, delayed retirement credits, and the "delayed January bump" | `benefit-calculator.ts:41` (`benefitAtAge`), `benefit-calculator.ts:182` (`benefitOnDateCore`) |
| **Spousal** top-up, with its own early-claim schedule and the 50%-of-PIA combined cap | `benefit-calculator.ts:289` (`spousalBenefitOnDate`) |
| **Survivor** benefit, with RIB-LIM, the separate survivor FRA schedule, and the 71.5% floor | `benefit-calculator.ts:444` (`survivorBenefit`) |
| PIA from earnings: wage indexing, bend points, 90/32/15 brackets, COLA chain | `pia.ts:33` (`PrimaryInsuranceAmount`) |
| Lifetime NPV and filing-age optimization, mortality-weighted | `strategy/calculations/strategy-calc.ts`, `strategy/calculations/expected-npv.ts` |

### What it does not model

Divorced-spouse benefits, divorced-survivor benefits, child benefits, disabled-adult-child benefits,
the **family maximum**, the **retirement earnings test**, **WEP**, **GPO**, SSDI-to-retirement
conversion, and restricted applications. None of these appear anywhere in the vendored source
(§3 gives the search evidence). The engine also does not model taxation of benefits, and it does not
project future COLAs — all amounts are constant **today's dollars** (§2.4).

### The three things most likely to bite an implementer

1. **A Survivor period replaces the Personal period; a Spousal period stacks on top of it.** Summing
   all of a recipient's periods is correct for Personal+Spousal and *wrong* for Personal+Survivor —
   except the engine already guarantees Personal and Survivor never overlap, so a naive sum happens
   to be safe. See §5.2 and §5.3 for the exact overlap rules.
2. **`recipientIndex` follows the caller's input order**, but *which* index receives Spousal and
   Survivor periods is decided by a PIA comparison inside the engine, with a `>` tie-break that puts
   `recipients[1]` in the earner role on an exact tie (§4.4). On a tie that makes the engine's whole
   output — recommended filing ages included — a function of the argument order (§6.4).
3. **`strategySumPeriodsOptimized` does not apply the zero-PIA filing-date bump that its own NPV
   caller applies**, so calling it directly can silently disagree with `strategySumPeriodsCouple`
   (§4.2).

---

## 2. Benefit types and the rules implemented for each

### 2.0 The type enum

The starting observation is **confirmed**. `strategy/calculations/benefit-period.ts:8-12`:

```ts
export enum BenefitType {
  Personal = 'Personal',
  Spousal = 'Spousal',
  Survivor = 'Survivor',
}
```

`BenefitPeriod` (`benefit-period.ts:17-26`) carries `startDate`, `endDate` (both **inclusive**,
per the comment at line 18), `amount: Money`, `recipientIndex: number`, and `benefitType`.

There is no fourth type and no subtype discriminator, so divorced-spouse, child, and
disabled-adult-child benefits could not be represented in the output even if the arithmetic existed.
The couple APIs are typed `[Recipient, Recipient]` (`strategy-calc.ts:25`, `expected-npv.ts:357`),
so a third beneficiary cannot be passed in at all.

### 2.1 Personal benefit

**Amount.** `benefitAtAge` (`benefit-calculator.ts:41-59`):

```ts
return recipient
  .pia()
  .primaryInsuranceAmount(throughColaYear)
  .floorToDollar()
  .times(1 + benefitMultiplierAtAge(...))
  .floorToDollar();
```

Note the **double floor**: PIA is floored to whole dollars *before* the multiplier and the product is
floored again. `Money.times` rounds to the nearest cent first (`money.ts:97-99`), so the composite is
`floor(round(floor(pia) × (1+m)))`.

**Early-claim reduction — implemented.** `benefitMultiplierAtAge`
(`benefit-calculator.ts:14-32`), the operative lines 19-26:

```ts
if (nra.greaterThan(age)) {
  const before = nra.subtract(age);
  return (
    -1.0 *
    ((Math.min(36, before.asMonths()) * 5) / 900 +
      (Math.max(0, before.asMonths() - 36) * 5) / 1200)
  );
}
```

`5/900` = 5/9 of 1% per month for the first 36 months before NRA; `5/1200` = 5/12 of 1% per month
beyond that. This is SSA's retirement-benefit schedule
(<https://www.ssa.gov/benefits/retirement/planner/agereduction.html>) and is **different from** the
spousal schedule in §2.2 and the survivor schedule in §2.3.

**Delayed retirement credits — implemented; the age-70 ceiling is NOT enforced here.**
`benefit-calculator.ts:28-31`:

```ts
const after = age.subtract(nra);
return (delayedRetirementIncrease / 12) * after.asMonths();
```

The annual rate is cohort-dependent (0.065 to 0.08), read from
`constants.FULL_RETIREMENT_AGE[].delayedIncreaseAnnual` (`constants.ts:507-611`) via
`recipient.delayedRetirementIncrease()` (`recipient.ts:437-439`). `benefitMultiplierAtAge` will
happily extrapolate past age 70 if handed an age above 840 months — **the ceiling is enforced only
by callers**:

- Optimizer loop bounds `i <= 70 * 12` — `strategy-calc.ts:711-712`, `strategy-calc.ts:792-793`,
  `strategy-calc.ts:988-991`, `expected-npv.ts:84`, `expected-npv.ts:470`, `expected-npv.ts:863`.
- `clampZeroPiaDepStrategy` caps at `70 * 12` — `strategy-calc.ts:663-664`.
- `survivorBenefit` explicitly caps the deceased's effective filing date at age 70 —
  `benefit-calculator.ts:471-475`.

Anyone calling `benefitAtAge` directly with an age past 70 gets an over-credited number with no
error. Our adapter's `ssaMonthlyBenefitAtAge` (`src/lib/ssaTools.ts:77-83`) is such a caller; it is
safe only because `MAX_CLAIM_AGE` is 70 (`src/lib/benefitMath.ts:11`).

**"Delayed January bump" — implemented.** `benefitOnDateCore` (`benefit-calculator.ts:182-225`).
A recipient who files after NRA and before 70 in a non-January month gets delayed credits only
through the previous January until the following January. The operative branch is lines 206-224:

```ts
if (filingDate.monthIndex() === 0)
  return benefitAtAge(recipient, filingAge, throughColaYear);

const thisJan = MonthDate.initFromYearsMonths({ years: filingDate.year(), months: 0 });
const benefitComputationDate = normalRetirementDate.greaterThan(thisJan)
  ? normalRetirementDate : thisJan;
return benefitAtAge(recipient, recipient.birthdate.ageAtSsaDate(benefitComputationDate), ...);
```

Age exactly 70 is an explicit exception (`benefit-calculator.ts:199-203`). This is why
`PersonalBenefitPeriods` can emit **two** Personal periods for one filing (§5.2).

**Validation asymmetry.** `benefitOnDate` throws for a filing age under 62
(`benefit-calculator.ts:75-84`); `benefitOnDateOptimized` skips that check by design
(`benefit-calculator.ts:96-103`) and is what the period builder uses
(`recipient-personal-benefits.ts:75-80`). So an under-62 filing age produces a silently over-reduced
number in the period path rather than an error.

### 2.2 Spousal benefit

**Eligibility.** `baseSpousalBenefit(higher, lower)` = `higher.PIA/2 − lower.PIA`, floored at $0
(`benefit-calculator.ts:247-254`); `eligibleForSpousalBenefit(recipient, spouse)` is that value
being strictly positive (`benefit-calculator.ts:259-265`). Note the **argument order reverses**
between the two functions — `baseSpousalBenefit` takes `(higher, lower)`,
`eligibleForSpousalBenefit` takes `(claimant, higher-earner)`.

**Amount.** `spousalBenefitOnDate` (`benefit-calculator.ts:289-378`). The benefit is keyed to
`startDate = max(spouseFilingDate, filingDate)` (`benefit-calculator.ts:298-300`) — i.e. **the
spousal benefit cannot begin until the higher earner has also filed.** Returns `$0` if the claimant
is the higher earner (line 303) or if `startDate` is in the future (line 306).

**Early-claim reduction — implemented, and it is a different schedule.**
`benefit-calculator.ts:359-377`:

```ts
let monthsBeforeNra: number =
  normalRetirementDate.monthsSinceEpoch() - startDate.monthsSinceEpoch();
if (monthsBeforeNra <= 36) {
  // 25 / 36 of one percent for each month:
  return Money.fromCents(spousalCents * (1 - monthsBeforeNra / 144)).floorToDollar();
} else {
  const firstReductionCents: number = spousalCents * 0.25;
  monthsBeforeNra = monthsBeforeNra - 36;
  // 5 / 12 of one percent for each additional month:
  const secondReductionCents: number = spousalCents * (monthsBeforeNra / 240);
  return Money.fromCents(spousalCents - firstReductionCents - secondReductionCents).floorToDollar();
}
```

25/36 of 1% per month for the first 36 months, 5/12 of 1% per month beyond
(<https://www.ssa.gov/benefits/retirement/planner/applying7.html>). The reduction is measured
against the **claimant's own** NRA (`recipient.normalRetirementDate()`, line 323), and against
`startDate` — not against the claimant's own filing date.

**No delayed retirement credits on spousal — implemented correctly.** When
`startDate >= normalRetirementDate` and the claimant filed at or before their own NRA, the full
unreduced `spousalCents` is returned (`benefit-calculator.ts:326-329`). There is no `+DRC` branch.

**Combined 50%-of-PIA cap — implemented.** When the claimant filed *after* their own NRA
(`benefit-calculator.ts:330-356`), the spousal top-up is recomputed against the claimant's
DRC-inflated *actual benefit* rather than their PIA:

```ts
const personalBenefit = benefitOnDateCore(recipient, filingDate, atDate, ...);
const spouseBenefitCents = spousePiaAmountCents / 2 - personalBenefit.cents();
```

The code cites POMS <https://secure.ssa.gov/apps10/poms.nsf/lnx/0300615694>. This shrinks the
spousal top-up for a late-filing lower earner, and is the rule our adapter omits (§6.3).

### 2.3 Survivor benefit

**Amount.** `survivorBenefit(survivor, deceased, deceasedFilingDate, deceasedDeathDate,
survivorFilingDate)` — `benefit-calculator.ts:444-537`. Throws if the survivor files on or before
the death month (lines 455-459).

**Base amount — three cases, all implemented** (`benefit-calculator.ts:461-501`):

1. Deceased had not filed and died **before** their NRA → base = deceased's PIA (line 466).
2. Deceased had not filed and died **after** NRA → base = the deceased's benefit as if they had
   filed on the death date, with the filing date capped at age 70 (lines 471-482):
   ```ts
   const age70Date = deceased.birthdate.dateAtSsaAge(
     MonthDuration.initFromYearsMonths({ years: 70, months: 0 }));
   const effectiveFilingDate = MonthDate.min(deceasedDeathDate, age70Date);
   ```
3. Deceased **had filed** → **RIB-LIM**, lines 488-500:
   ```ts
   baseSurvivorBenefit = Money.max(
     deceased.pia().primaryInsuranceAmount().times(0.825),
     benefitOnDate(deceased, deceasedFilingDate, /* age 71 */ ...)
   );
   ```
   This is the RIB-LIM widow(er) limit (<https://secure.ssa.gov/poms.nsf/lnx/0300615300>): the
   survivor inherits the deceased's *actual reduced* benefit, but never less than 82.5% of the
   deceased's PIA. Note the `atDate` is age 71, which forces all delayed credits to be fully applied
   — so a deceased who filed late passes their full DRCs to the survivor, which is correct.

**Survivor early-claim reduction — implemented, and it is a third distinct schedule.**
`benefit-calculator.ts:510-536`. If the survivor has reached their survivor-FRA, the base is paid in
full (lines 512-517). Otherwise the base is scaled linearly between 71.5% at age 60 and 100% at
survivor-FRA:

```ts
const reductionRatio = Math.max(0, monthsBetweenAge60AndSurvivorAge / monthsBetween60AndNRA);
const minSurvivorBenefitRatio = 0.715;
const result = baseSurvivorBenefit.times(
  minSurvivorBenefitRatio + (1 - minSurvivorBenefitRatio) * reductionRatio);
```

**Separate survivor full-retirement-age schedule — implemented.**
`constants.FULL_RETIREMENT_AGE_SURVIVOR` (`constants.ts:620-708`) is a distinct table from
`FULL_RETIREMENT_AGE` (`constants.ts:507-611`) — different cohort boundaries, topping out at 67 for
birth year 1962+ vs 1960+ for retirement. It is selected by
`Recipient.survivorRetirementAgeBracket()` (`recipient.ts:426-428`) and exposed as
`survivorNormalRetirementAge()` / `survivorNormalRetirementDate()` (`recipient.ts:453-464`). The
source comment at `constants.ts:617-618` notes the author's understanding that these are simply
retirement FRA + 2 years of cohort shift.

**Not modeled for survivors:** the age-60 floor is not enforced (a survivor age below 60 clamps to
71.5% via `Math.max(0, ...)` at line 527 rather than erroring), disabled-widow(er) benefits at 50,
child-in-care survivor benefits, and the one-time lump-sum death payment.

**Nor is the age-60 START.** The amount arithmetic above is only reached once a survivor period
exists, and `strategy-calc.ts:71-77` will not begin one before the survivor's own filing date, where
SSA pays a widow(er) from 60 regardless of it. That produces $0 household income for months a
survivor would really be paid, and it is visible in the strategy table's survivor-income column —
see §5.2.

### 2.4 COLA and wage-indexing machinery — implemented

All in `pia.ts` and `earnings-manager.ts`:

- **Wage indexing.** `wageRatio()` (`pia.ts:48-58`) is `WAGE_INDICES[indexingYear] /
  WAGE_INDICES[1977]`, with `indexingYear` = the year the recipient turns SSA-age 60
  (`recipient.ts:498-502`), clamped to `MAX_WAGE_INDEX_YEAR` (`constants.ts:386`).
- **Bend points.** `firstBendPoint()` / `secondBendPoint()` (`pia.ts:69-83`) scale the 1977
  constants `$180` and `$1,085` (`constants.ts:287-289`) by that ratio, rounded to the dollar.
- **Brackets.** 90% / 32% / 15% (`constants.ts:291-296`) applied in
  `primaryInsuranceAmountByBracket` (`pia.ts:98-128`), summed and floored to the dime
  (`pia.ts:139-149`).
- **Top-35 selection and AIME.** `EarningsManager.reindex` (`earnings-manager.ts:60-90`) sorts by
  indexed earnings, keeps `SSA_EARNINGS_YEARS = 35` (`constants.ts:457`);
  `monthlyIndexedEarnings()` (`earnings-manager.ts:102-107`) divides by 12 × 35 and floors.
- **COLA chain.** `applyColaAdjustments` (`pia.ts:235-252`) multiplies from the year the recipient
  turns SSA-age 62 through `CURRENT_YEAR - 1`, flooring to the dime each year. The COLA table runs
  1975-2025 (`constants.ts:394-447`).
- **40-credit eligibility.** `EarningsManager.isEligible()` (`earnings-manager.ts:155-157`),
  surfaced via `Recipient.isEligible()` (`recipient.ts:323-329`); an ineligible recipient's PIA is
  `$0` (`pia.ts:106-108`).

**No future COLAs are projected.** The chain stops at `CURRENT_YEAR - 1` (`pia.ts:220-222`), so
every `BenefitPeriod.amount` is in **constant today's dollars**. A chart plotting periods over 30
years is plotting real, not nominal, dollars.

There is a separate *display-only* nominal path — `benefitOnDateNominal` (`benefit-calculator.ts:146-172`),
`allBenefitsOnDateNominal` (`benefit-calculator.ts:413-431`), `colaYearForDisplayDate`
(`benefit-calculator.ts:115-121`) — that re-expresses a *past* month in the dollars payable then.
The comment at `benefit-calculator.ts:410-411` states survivor benefits are **not** covered by it.

**All of §2.4 is dead code for our app** because we run in PIA-only mode (§6.8).

### 2.5 Deemed filing — modeled structurally, not as a rule

There is **no** occurrence of the string `deem` anywhere in the vendored source (§3). But the
behavior is baked into the data model: each recipient has exactly one filing age
(`strats: [MonthDuration, MonthDuration]`, `strategy-calc.ts:27`), and the dependent's Personal
period (`strategy-calc.ts:124-130`) and Spousal period (`strategy-calc.ts:144-170`) are both
generated from that single date. There is no way to express "file for spousal only" or "file for
personal only."

Two consequences:

- **Restricted applications are structurally impossible**, which is why they are also absent from
  §3's search (a restricted application is exactly the thing this model cannot express).
- **Deemed filing is applied universally**, including to cohorts born before Jan 2, 1954 who are
  legally exempt from it (<https://www.ssa.gov/benefits/retirement/planner/claiming.html>). The
  engine has no birth-date test for this. For a 2026-vintage client base — everyone reaching 62 was
  born in 1964 or later — this is moot, but it is a real modeling simplification.

---

## 3. What the engine does NOT model, and how that was determined

Method: case-insensitive regex search across every `.ts` file under `src/vendor/ssa-tools/`
(20 files, 6,596 lines). Match counts:

| Concept | Search term(s) | Matches | Verdict |
|---|---|---|---|
| Divorced-spouse benefits | `divorc` | **0** | Not modeled |
| Divorced-survivor benefits | `divorc` | **0** | Not modeled |
| Child benefits | `child` | **0** | Not modeled |
| Disabled-adult-child benefits | `child`, `disab` | **0**, **0** | Not modeled |
| Family maximum | `famil` | **0** | Not modeled |
| Retirement earnings test | `earnings.test` | **0** | Not modeled |
| WEP (Windfall Elimination) | `WEP`, `windfall` | **0**, **0** | Not modeled |
| GPO (Government Pension Offset) | `GPO`, `pension` | **0**, **0** | Not modeled |
| SSDI → retirement conversion | `SSDI`, `disab` | **0**, **0** | Not modeled |
| Restricted application | `restricted` | **0** | Not modeled |
| Deemed filing (as an explicit rule) | `deem` | **0** | See §2.5 — implicit, not explicit |

The only symbol containing "MAXIMUM" is `MAXIMUM_EARNINGS` (`constants.ts:98-100`), which is the
**annual taxable wage base**, not the family maximum. Its sole use is capping simulated future wages
in `EarningsManager.capWageForYear_` (`earnings-manager.ts:183-191`). Confirmed by reading all 27
`maximum` matches.

Two structural confirmations reinforce the searches:

- `BenefitType` has exactly three members (`benefit-period.ts:8-12`), so child / DAC / divorced
  benefits have no representation in the output.
- Every couple entry point is typed `[Recipient, Recipient]` (`strategy-calc.ts:25`,
  `strategy-calc.ts:257`, `expected-npv.ts:357`, `expected-npv.ts:854`), so an ex-spouse or child
  cannot be supplied. The family maximum, which by definition aggregates over three or more
  beneficiaries, has nothing to aggregate.

Also absent, though not on the list: taxation of benefits (no `tax` logic beyond
`taxedEarnings`/`taxedMedicareEarnings` field names in `earning-record.ts`), Medicare premium
deduction, the special minimum PIA, and the "months of eligibility before FRA" recomputation.

---

## 4. Entry points that expose the per-period decomposition

Three functions return `BenefitPeriod[]`. None of them sort the result.

### 4.1 `strategySumPeriodsCouple`

`strategy-calc.ts:24-173`. Exported from the barrel at
`strategy/calculations/index.ts:27`.

```ts
export function strategySumPeriodsCouple(
  recipients: [Recipient, Recipient],
  finalDates: [MonthDate, MonthDate],   // death months, inclusive
  strats: [MonthDuration, MonthDuration] // filing AGES, not dates
): BenefitPeriod[]
```

**What the caller must supply.** Two fully-constructed `Recipient`s (birthdate set, and either
earnings records or `setPia`), a death month for each, and a filing age for each. `finalDates` and
`strats` are indexed in the **caller's order**, matching `recipients` — the engine re-indexes them
internally at `strategy-calc.ts:54-59`.

**What it returns.** Up to six periods, pushed in this fixed order:

1. Earner's Personal — one or two periods (`strategy-calc.ts:105-111` → `PersonalBenefitPeriods`).
2. Dependent's Personal — one or two periods (`strategy-calc.ts:124-130`), truncated at
   `survivorStartDate - 1` if a survivor switch occurs (`strategy-calc.ts:114-122`).
3. Dependent's Survivor — at most one (`strategy-calc.ts:133-141`).
4. Dependent's Spousal — at most one (`strategy-calc.ts:144-170`).

The array is therefore **neither chronological nor grouped by recipient**. Callers must sort.

**Preconditions and ordering assumptions.**

- Filing ages should be ≥ 62. Enforcement is inconsistent: the Personal path uses
  `benefitOnDateOptimized`, which does not validate (`benefit-calculator.ts:96-103`), while the
  survivor-comparison call at `strategy-calc.ts:92-97` uses `benefitOnDate`, which throws
  (`benefit-calculator.ts:80-84`) — but only when the survivor branch is reached. **Do not rely on
  an exception for out-of-range ages.**
- Filing ages should be ≤ 70. Not enforced anywhere in this function (§2.1).
- The zero-PIA dependent's filing date is bumped up to the earner's if it would be earlier
  (`strategy-calc.ts:63-69`), because a $0-PIA spouse cannot collect anything until the earner files.
- The survivor start date is `max(earnerDeath + 1 month, dependentFilingDate)`
  (`strategy-calc.ts:74-77`), which guarantees `survivorBenefit`'s own precondition
  (`benefit-calculator.ts:455-459`) holds.
- **The survivor start date is never earlier than the dependent's filing date, and filing dates are
  ≥ 62.** A widow(er) claiming a survivor benefit at 60 or 61 — legal under SSA rules — cannot be
  represented by this function. This is a genuine modeling gap for a widow-focused chart.

### 4.2 `strategySumPeriodsOptimized`

`strategy-calc.ts:527-638`. **Not** in the barrel (`strategy/calculations/index.ts:20-31` omits it),
so it must be imported directly from `$lib/strategy/calculations/strategy-calc`.

```ts
export function strategySumPeriodsOptimized(
  context: OptimizationContext,
  earnerStratDate: MonthDate,      // filing DATE, in the earner role
  dependentStratDate: MonthDate    // filing DATE, in the dependent role
): BenefitPeriod[]
```

The context is built once by `createOptimizationContext(recipients, finalDates, currentDate,
monthlyDiscountRate)` (`strategy-calc.ts:411-446`), which stores `earner`, `dependent`,
`earnerFinalDate`, `dependentFinalDate`, `earnerIndex`, `dependentIndex`, `dependentHasZeroPia`,
`isSpousalBenefitEligible`, the discount rate, and memo caches (`strategy-calc.ts:394-406`).

It produces the same periods as `strategySumPeriodsCouple` — the bodies are line-for-line parallel
(compare `strategy-calc.ts:71-172` with `strategy-calc.ts:534-637`) — with three preconditions the
couple version handles for you:

1. **Filing dates, not ages, and already in earner/dependent role order.** You must resolve the role
   mapping yourself before calling. `strategySumCentsOptimized` shows the intended pattern
   (`strategy-calc.ts:456-463`).
2. **⚠ The zero-PIA filing-date bump is the caller's job.** `strategySumCentsOptimized` applies it at
   `strategy-calc.ts:466-472`; `strategySumPeriodsOptimized` itself does **not**. Calling it
   directly with an unbumped dependent filing date and a $0-PIA dependent yields periods that differ
   from `strategySumPeriodsCouple` for the same inputs. This is the sharpest footgun in the file.
3. **The discount rate must already be monthly.** `createOptimizationContext` takes
   `monthlyDiscountRate`, not an annual one; convert with `calculateMonthlyDiscountRate`
   (`strategy-calc.ts:181-189`). This does not affect the periods (amounts are rate-independent) but
   silently corrupts any NPV computed from the same context.
4. Death dates are baked into the context. Changing a death date requires a new context.

### 4.3 `strategySumPeriodsSingle`

`strategy-calc.ts:846-863`. Personal periods only; `recipientIndex` is hard-coded to `0`
(`strategy-calc.ts:859`). No spousal or survivor logic exists on this path.

### 4.4 `recipientIndex` semantics — the thing that has bitten us

**`recipientIndex` follows the caller's input order.** `classifyEarnerDependent`
(`earner-dependent.ts:12-29`) returns `earnerIndex` / `dependentIndex` as indices *into the input
array*, and those are exactly what get written to `period.recipientIndex`
(`strategy-calc.ts:110`, `:129`, `:138`, `:166`; and `:573`, `:594`, `:603`, `:631` in the optimized
variant). So `recipientIndex === 0` always means `recipients[0]`.

**But the earner/dependent *classification* is by PIA, not by position**, and it decides which index
receives Spousal and Survivor periods. The comparison is `higherEarningsThan`
(`benefit-calculator.ts:231-236`), a strict `>`:

```ts
if (higherEarningsThan(recipients[0], recipients[1])) {
  return { earner: recipients[0], ..., earnerIndex: 0, dependentIndex: 1 };
}
return { earner: recipients[1], ..., earnerIndex: 1, dependentIndex: 0 };
```

**On an exact PIA tie, `recipients[1]` is the earner and `recipients[0]` is the dependent**
(`earner-dependent.ts:23-28`) — a positional default, not a fact about either person. The spousal
amount is $0 either way, but the *Survivor* period is assigned to `recipients[0]`, and the
optimizer's chosen filing ages move with it: on a tie the ARGUMENT ORDER changes the recommendation.
Measured evidence and how the app canonicalizes around it are in §6.4.

`expectedNPVCoupleOptimized` returns `filingAges` in **original recipient order** — the docstring
says so at `expected-npv.ts:349-353`, and the push at `expected-npv.ts:816-819` uses the loop
variables `f0`/`f1` that index `recipients[0]`/`recipients[1]` (see the role mapping at
`expected-npv.ts:638-644`). Our adapter relies on this correctly, and maps that order back to
display order after canonicalizing the pair (§6.4).

---

## 5. Edge cases and conventions worth knowing

### 5.1 The "attained age the day before your birthday" rule, and the Jan 1/2 boundary

SSA follows the common-law rule that a person attains an age on the day *before* their birthday
(explained at `birthday.ts:8-18`). The engine implements it by subtracting 24 hours
(`birthday.ts:57-64`):

```ts
this.ssaBirthdate_ = new Date(this.layBirthdate_.getTime() - 24 * 60 * 60 * 1000);
```

Every age and date computation in the strategy code goes through `dateAtSsaAge` / `ageAtSsaDate`
(`birthday.ts:178-187`), which use `ssaBirthMonthDate_`.

**Consequences at the boundary:**

- Someone born on the **1st of a month** has an SSA birth *month* one month earlier. Born Jan 1 →
  SSA birthdate Dec 31 of the previous year → `ssaBirthYear()` is a year earlier. Because
  `findAgeBracket` keys on `ssaBirthYear()` (`recipient.ts:405`), **a person born Jan 1, 1960 gets
  the 1959 FRA bracket (66y 10m), not the 1960 bracket (67y)** — and likewise a different survivor
  FRA bracket. This is correct SSA behavior, and it is invisible unless you are testing Jan 1.
- **A second, different convention governs earliest filing.** `earliestFilingMonth()`
  (`birthday.ts:207-213`) uses the **lay** day of month:
  ```ts
  const month = MonthDuration.initFromYearsMonths({ years: 62, months: 0 });
  if (this.layBirthDayOfMonth() > 2) { month.increment(); }
  ```
  Born on the 1st or 2nd → can file at SSA-age 62y 0m; born on the 3rd or later → 62y 1m, i.e. the
  month *after* the 62nd birthday, because SSA requires being 62 for an entire month. The code cites
  <https://ssa.tools/guides/1st-and-2nd-of-month>.

So the class mixes lay-day and SSA-year conventions in adjacent methods. `currentAge()`
(`birthday.ts:225-237`) is a third convention — a plain **lay** age in whole years, used for display
and life-table lookup, not for benefit math.

### 5.2 How a person switching from own benefit to survivor benefit is represented

As **two adjacent, non-overlapping periods with different `benefitType`**, not as a top-up.

- The dependent's Personal period end date is pulled back to `survivorStartDate - 1`
  (`strategy-calc.ts:114-122`):
  ```ts
  if (isSurvivorBenefitApplicable && dependentFinalDate.greaterThanOrEqual(survivorStartDate)) {
    dependentFinalPersonalDate = survivorStartDate.subtractDuration(new MonthDuration(1));
  }
  ```
- The Survivor period runs `survivorStartDate` → `dependentFinalDate`
  (`strategy-calc.ts:134-140`).

**The Survivor amount is the total monthly benefit, not an increment.** `survivorBenefit`
(§2.3) returns the full survivor amount derived from the deceased's record. Contrast Spousal, which
*is* an increment: `spousalCents = spousePIA/2 − recipientPIA` (`benefit-calculator.ts:318`), paid
*alongside* the recipient's Personal period.

**The switch is conditional and evaluated once, not month-by-month** (`strategy-calc.ts:92-100`):

```ts
const dependentFinalPersonalBenefit = benefitOnDate(
  dependent, dependentStratDate,
  // Add a year to include all late filing credits.
  dependentStratDate.addDuration(MonthDuration.OneYear()));
if (dependentFinalPersonalBenefit.cents() < survivorBenefitAmount.cents()) {
  isSurvivorBenefitApplicable = true;
}
```

If the survivor's own (fully-credited) benefit is greater or equal, **no Survivor period is emitted
at all** and the dependent keeps their Personal benefit for life. Note the comparison deliberately
uses the post-January-bump amount even though the actual month of the switch might be earlier.

**The survivor benefit cannot start before the survivor's OWN filing date — and that is a
divergence from SSA's rule.** `strategy-calc.ts:71-77`:

```ts
// Determine the start date for survivor benefits. This is the later of:
// 1. The month after the earner's death date.
// 2. The dependent's filing date.
const survivorStartDate = MonthDate.max(
  earnerFinalDate.addDuration(new MonthDuration(1)),
  dependentStratDate
);
```

SSA pays a widow(er) benefit from **age 60** (50 if disabled), independent of whether the widow(er)
has filed on their own retirement record — indeed the standard planning move is to take one benefit
first and switch to the other later. The engine instead pays nothing until the survivor's own filing
date, so a household in which the survivor files late shows **$0 of household income for every month
between the death and that filing**, even when the survivor is well past 60.

**This is visible in the product**, in the strategy table's survivor-income column: for an older
higher earner with a much younger spouse (PIA 2400 plan-to 78 / PIA 1200 plan-to 90), the "both
delay to 70" row reads $0 while the optimum reads $36,480. The survivor is 69 in that year — SSA
would be paying her a widow's benefit; the model is not. **The $0 is a model artifact, not a
planning result.**

**Ruled ship-as-is; Phase 3 item.** Nothing in the app currently corrects for it, and the
`survivorIncomeCaption` sentence that explains the $0 ("a strategy under which the survivor's own
benefit has not started by then shows $0") describes *the model*, correctly, and is **not** a
statement of SSA's rule. A Phase 3 fix has to decide whether to model the age-60 start itself
(a benefit rule the app would then own, which this codebase has so far refused to do) or to
disclose the divergence in copy. Until then, do not read the column as advice to file early.

### 5.3 Can periods overlap?

Yes — in exactly one place.

| Pair | Overlap? | Why |
|---|---|---|
| Personal × Personal (same recipient) | No | `PersonalBenefitPeriods` splits at the January boundary into disjoint spans (`recipient-personal-benefits.ts:102-127`) |
| Dependent's Personal × Spousal | **Yes, by design** | Spousal runs `max(filing dates)` → `min(survivorStart − 1, depDeath)` (`strategy-calc.ts:147-156`), fully inside the Personal span. This is correct: the top-up is paid on top. |
| Personal × Survivor | No | Personal is truncated to `survivorStart − 1` (`strategy-calc.ts:119-121`) |
| Spousal × Survivor | No | Spousal ends at `survivorStart − 1` (`strategy-calc.ts:153-155`) |
| Earner's periods × Dependent's periods | N/A | Different `recipientIndex` |

So: to get a recipient's total monthly income in a month, **sum every period of theirs covering that
month.** That is correct for Personal+Spousal, and safe for Survivor because the engine has already
guaranteed no overlap with Personal.

One subtlety: when `isSurvivorBenefitApplicable` is false but the dependent outlives the earner, the
Spousal period still ends at `survivorStartDate − 1` = the earner's death month
(`strategy-calc.ts:153-155`). That is correct — the spousal top-up ends when the worker dies — and it
means the dependent's income *drops* at the earner's death and never recovers. An honest widow chart
must show this case too.

### 5.4 What happens at a zero PIA

- **$0 periods are emitted, not skipped.** `PersonalBenefitPeriods` is called unconditionally
  (`strategy-calc.ts:124-130`); with a $0 PIA, `firstAmount.equals(secondAmount)` at
  `recipient-personal-benefits.ts:84-85` so a single $0-amount Personal period is pushed. **Consumers
  must not assume every returned period has a positive amount.**
- The dependent's filing date is forced up to the earner's if it would be earlier
  (`strategy-calc.ts:63-69`), and the optimizer separately corrects the *reported* filing age with
  `clampZeroPiaDepStrategy` (`strategy-calc.ts:646-672`) so the answer is not misleading. That
  clamp caps at age 70 (`strategy-calc.ts:663-664`).
- A $0-PIA dependent **is** spousal-eligible: `baseSpousalBenefit = earnerPIA/2 − 0 > 0`
  (`benefit-calculator.ts:247-254`).
- If **both** PIAs are $0, `higherEarningsThan` is false, so `recipients[1]` becomes the earner
  (`earner-dependent.ts:15-28`), no spousal is eligible, no survivor exceeds $0, and every period is
  $0.
- In the fast path, a zero-PIA dependent's personal NPV table is skipped entirely
  (`expected-npv.ts:526-527`) and `dfy`/`dpj` are forced to 0 (`expected-npv.ts:656-657`) —
  consistent with the object path.
- Our app's break-even code has already been bitten by $0 benefits; see the comment at
  `src/lib/benefitMath.ts:68-77`.

### 5.5 Month-indexing conventions

Collected here because they are inconsistent enough to cause bugs:

| Thing | Convention | Cite |
|---|---|---|
| `MonthDate` internal | months since **January of year 0**; `year() = floor(epoch/12)`; January ⟺ `epoch % 12 === 0` | `month-time.ts:16-21`, `:96-98` |
| `MonthDate.monthIndex()` | **0 = January**, 11 = December | `month-time.ts:111-113` |
| `MonthDate.initFromYearsMonths({months})` | **0-11**, validated | `month-time.ts:34-48` |
| `Birthdate.FromYMD(year, month, day)` | month **0-indexed**, day **1-indexed** | `birthday.ts:71-74` |
| `MonthDuration.initFromYearsMonths({months})` | **-11..11**, an *offset*, not a calendar month | `month-time.ts:249-268` |
| `MonthDuration.modMonths()` | plain `%`, so a **negative** duration yields a negative remainder | `month-time.ts:296-298` |
| `MonthDuration.roundedYears()` | ≥ 6 months rounds up | `month-time.ts:304-308` |

Additional hazards:

- `MonthDate.initFromYearsMonths` validates, but the bare `MonthDate` constructor and all arithmetic
  do **not** — `subtractDuration` can produce a negative epoch silently (`month-time.ts:141-143`).
- `MonthDate.increment()` / `decrement()` **mutate in place** (`month-time.ts:197-206`), while
  `addDuration` / `subtractDuration` return new objects. `MonthDate.max` / `min` return the
  *argument object*, not a copy (`month-time.ts:183-191`), so `MonthDate.max(a, b).increment()`
  mutates `a` or `b`. The engine's own code never does this, but a consumer could.
- Our app converts a JS `Date` at `src/lib/ssaTools.ts:29-34` using `getMonth()` (0-indexed) into
  `initFromYearsMonths({months})` (0-indexed) — correct.

### 5.6 Payment timing vs. benefit month

`BenefitPeriod.startDate` / `endDate` are the **benefit months**. The NPV code separately assumes
the payment for month M arrives in month M+1 (`strategy-calc.ts:268-271`):

```ts
const firstPaymentDate = period.startDate.addDuration(new MonthDuration(1));
const lastPaymentDate = period.endDate.addDuration(new MonthDuration(1));
```

A chart plotting periods directly plots benefit months; the engine's own NPV totals are shifted one
month later. Pick one and say which.

### 5.7 Lay vs. SSA age for death dates

Death dates in the optimizer use `dateAtLayAge(deathAge, months: 6)` — a **lay** age with a mid-year
offset (`expected-npv.ts:96-101`, `:428-434`, `:869-873`), while filing dates use `dateAtSsaAge`.
Two conventions inside one calculation. It is internally consistent, but any caller supplying its
own `finalDate` must decide deliberately which convention to match. Ours does not (§6.6).

### 5.8 `CURRENT_YEAR` reads the wall clock

`constants.ts:462`: `export const CURRENT_YEAR: number = new Date().getFullYear();`. This is a
module-level constant evaluated at import time and feeds the COLA cutoff (`pia.ts:220-222`) and
`EarningsManager.futureEarningsStartYear` (`earnings-manager.ts:163-178`). Passing an `asOf` date to
the engine does **not** move `CURRENT_YEAR`, so historical or forward-dated fixtures are only
partially deterministic. Irrelevant to us today because PIA-only mode bypasses the COLA chain (§6.8),
but it would matter the moment we accept earnings records.

---

## 6. Where our adapter diverges from the engine

Read alongside `src/lib/ssaTools.ts`, `src/lib/personAnalysis.ts`, `src/lib/household.ts`.

### 6.1 The app never uses the period decomposition at all

A search of `src/` excluding `src/vendor/` finds **zero** references to `BenefitPeriod`,
`BenefitType`, `strategySumPeriodsCouple`, `strategySumPeriodsOptimized`, `strategySumPeriodsSingle`,
`survivorBenefit`, `spousalBenefitOnDate`, or `allBenefitsOnDate`. The only mentions are two prose
references inside a docstring at `src/lib/ssaTools.ts:125,128`.

What the app *does* consume from the engine: `expectedNPVCoupleOptimized` / `expectedNPVSingle` for
the optimizer (`src/lib/ssaTools.ts:11-14`), `benefitAtAge` for the per-age monthly amount
(`src/lib/ssaTools.ts:90`), `baseSpousalBenefit` (`src/lib/ssaTools.ts:135`),
`strategySumCentsSingle` for the lifetime column (`src/lib/ssaTools.ts:160`), and
`getDeathProbabilityDistribution`.

Note that `expectedNPVCoupleOptimized` is not in the barrel either
(`strategy/calculations/index.ts:9-14` exports only `expectedNPVCouple` and `expectedNPVSingle`), so
the direct module import at `src/lib/ssaTools.ts:11-14` is the only way to reach it. Same will be
true for `strategySumPeriodsOptimized` (§4.2).

### 6.2 `buildCombinedTimeline` is the substituted model — and is the widow bug

`src/lib/household.ts:143-163`. Each person contributes `recommendedMonthly × 12` in every year from
their filing year to their life-expectancy year, and `0` outside it:

```ts
const filingYear = (p) => p.person.birthYear + p.recommendedFilingAge.years;
const finalYear  = (p) => p.person.birthYear + p.person.lifeExpectancy;
...
const active = year >= filingYear(p) && year <= finalYear(p);
const amount = active ? Math.round(p.recommendedMonthly * 12 * 100) / 100 : 0;
```

Assumptions the engine does not make, all in eleven lines:

- **No survivor step-up.** When the higher earner's `finalYear` passes, their column goes to `0` and
  the survivor's column stays at *their own* benefit. The engine would emit a Survivor period worth
  up to 100% of the deceased's benefit (§2.3). This is the mechanism of the understated widow income.
- **No spousal top-up in the household total.** `spousalTopUp` is computed separately
  (`src/lib/household.ts:213-221`) and never enters `combinedTimeline`.
- **Annual granularity keyed on `birthYear + age`**, ignoring birth month entirely — the engine works
  in months throughout.
- **A single flat monthly amount per person**, so the January-bump first-year amount that
  `PersonalBenefitPeriods` models (§2.1) is invisible.
- **Life expectancy as a hard cutoff**, whereas the optimizer that produced `recommendedFilingAge`
  weighted across the whole mortality distribution (`expected-npv.ts:92-116`). The chart and the
  recommendation are built on different mortality models.

`src/components/methodologyCopy.ts:26` currently discloses this ("Survivor benefits are not modeled
in this version"), so the gap is documented in the product, not hidden — but the engine has the data.

### 6.3 `spousalTopUp` re-implements a rule the engine already has, and drops two others

`src/lib/ssaTools.ts:130-148`. The docstring (lines 111-128) honestly explains the motive: the engine
exposes no age-based spousal helper — `baseSpousalBenefit` is unreduced, `spousalBenefitOnDate` needs
filing *dates* for both people. Three concrete divergences follow:

1. **Rounding.** `Math.round(base * (1 - reduction) * 100) / 100` (`src/lib/ssaTools.ts:147`) keeps
   cents; the engine calls `.floorToDollar()` (`benefit-calculator.ts:366`, `:376`). Our figure can
   sit up to a dollar above the engine's and shows cents where SSA shows whole dollars.
2. **RESOLVED by `fix/spousal-start-date`.** ~~The higher earner's filing date is ignored.~~
   `spousalTopUp` now takes both filing ages and keys the start — and the reduction — to
   `startDate = max(spouseFilingAge, workerFilingAge)` (`src/lib/ssaTools.ts:151-161`), matching the
   engine's `startDate = max(spouseFilingDate, filingDate)` (`benefit-calculator.ts:298-300`) and
   returning `$0` before the higher earner has filed. `src/lib/household.ts` now passes both ages
   through. Verified against the vendored engine across 11,640 combinations.
3. **RESOLVED by `fix/spousal-start-date`, with a correction to this item's headline.** The headline
   as originally written — "the combined 50%-of-PIA cap is missing" — was imprecise:
   `baseSpousalBenefit` (`src/vendor/ssa-tools/benefit-calculator.ts:247-254`) already *is* the
   50%-of-PIA cap, and `spousalTopUp` always applied it via `spousalEntitlement`. The item's body,
   however, correctly identified a narrower missing branch: a spouse who files **past her own FRA**
   must have the cap netted against her DRC-inflated *actual benefit*, not her PIA
   (`benefit-calculator.ts:326-356`). `spousalTopUp` now implements that branch
   (`src/lib/ssaTools.ts:169-182`): when there's no early-filing reduction and the spouse's own filing
   age is past her FRA, it nets `halfWorkerPia` against `benefitAtAge(spouse, spouseFilingAge)`
   instead of against `base`.

Argument order is correct: `baseSpousalBenefit(higher, lower)` per `benefit-calculator.ts:247`, and
`src/lib/household.ts:214` passes `(higher, lower)`.

### 6.4 On an exact PIA tie the engine's output depends on argument order — the app canonicalizes around it

**This is an engine-side order dependence, not an app tie-break bug.** The original form of this
section described the app's own `personA.piaMonthly >= personB.piaMonthly` tie-break at
`src/lib/household.ts:199`. That line no longer exists — the app now calls the engine's own
`classifyEarnerDependent` — but the underlying warning was never resolved by that change and is
still live, so it is restated here against the engine.

`higherEarningsThan` is a strict `>` (`benefit-calculator.ts:231-236`), so on an exact tie it is
false **both ways** and `classifyEarnerDependent` falls through to a fixed positional default:
`recipients[1]` becomes the earner, `recipients[0]` the dependent (`earner-dependent.ts:15-28`).
The dependent slot is the only one that can hold a Spousal or Survivor period at all
(`strategy-calc.ts:104`), and that default reaches the engine through **both**
`rankedCoupleStrategies` (via `expectedNPVCoupleOptimized`) and `strategySumPeriodsCouple`. So on a
tie the argument order decides the recommended filing ages, not only who is labeled what.

Measured on a two-PIA-2200 household (Dan b. 1962-04 plan-to 85, Sarah b. 1964-02 plan-to 88,
`asOf` 2026-01-15):

| | passed as `[Dan, Sarah]` | passed as `[Sarah, Dan]` |
|---|---|---|
| Recommended ages | Dan 63y9m, Sarah 70 | Dan 70, Sarah 62y1m |
| Survivor period | none emitted | `survivor: $1,179/mo` to Sarah |
| Income cliff | $53,520 → $32,736 (−38.8%) | $51,324 → $32,736 (−36.2%) |

Two recommendations, two charts, two cliff percentages, for one household — and no disclosure,
since `survivorGap` is null both ways.

**How the app handles it.** The engine cannot be changed (vendored), so the app makes the argument
order a function of the household rather than of data entry. `compareForEngine`
(`src/lib/household.ts`) canonicalizes the pair once, at the single point it enters the engine, and
maps the two-element results back to display order; everything else is keyed by `personId` and needs
no mapping. The keys are PIA descending, then projected final month descending (so the person the
household's own plan-to inputs say outlives the other occupies the dependent slot, the only slot the
engine can pay a survivor benefit to), then birth date descending, gender and name for determinism.
`analyzeHousehold`'s equal-PIA tests assert the WHOLE analysis is equal under a swap — periods,
timeline, cliff, filing ages, row order, survivor gap — not a hand-listed subset, which is how the
defect above survived a pass that fixed only the "lower earner" label.

The residual, unfixable part: **which** of the two engine-admissible framings a tie household is
shown is still a choice the app makes, and the alternative choice yields different filing ages. The
choice is documented at `compareForEngine`; it is not a benefit rule, and every amount in either
framing is the engine's own.

### 6.5 The displayed monthly is the eventual amount, not the first-year amount

`ssaMonthlyBenefitAtAge` / `ssaMonthlyBenefitAtFilingAge` (`src/lib/ssaTools.ts:77-99`) call
`benefitAtAge` (`src/lib/ssaTools.ts:90`), which applies the multiplier with no January-bump logic
and no age-70 ceiling (`benefit-calculator.ts:41-59`). For a filing age past FRA, the engine's own
period decomposition would show a *lower* amount for the remainder of the filing year (§2.1). Our
"recommended monthly" figure is the post-bump amount from month one. Safe from the 70 ceiling only
because `MAX_CLAIM_AGE = 70` (`src/lib/benefitMath.ts:11`).

### 6.6 Two different money conventions and two different horizons on one screen

- **Discount rate.** `analyzePerson` passes `0` as the discount rate to `lifetimeNpvToAge`
  (`src/lib/personAnalysis.ts:96`), so the "lifetime benefits" column is an **undiscounted** sum,
  while the strategy comparison table uses `assumptions.discountRate`
  (`src/lib/household.ts:175-180`, default `0.025` at `src/lib/ssaTools.ts:22`).
- **Horizon.** `lifetimeNpvToAge` builds the final date as `dateAtLayAge({years: lifeExpectancy,
  months: 0})` (`src/lib/ssaTools.ts:156-159`). The engine's optimizer uses `months: 6`
  (`expected-npv.ts:97-101`). For the same stated life expectancy our horizon is **six months
  shorter** than the one the recommendation was optimized against.

### 6.7 A flat COLA slider is layered on top of already-real dollars

`src/lib/benefitMath.ts:38-57` grows engine amounts by a flat `annualCola`. The engine's amounts are
COLA-adjusted **to today** and contain no future COLA (`pia.ts:220-252`, §2.4) — they are constant
real dollars. `src/lib/benefitMath.ts:1-8` acknowledges this in prose. The result is that the
cumulative/heat-map charts (`src/lib/chartData.ts:36-56`) are in nominal dollars while the NPV
comparison table is in real dollars. Nothing double-counts, but the two are not comparable and the
UI does not distinguish them.

### 6.8 Every recipient is PIA-only, so half the engine is unreachable

`createPiaRecipient` always calls `setPia` (`src/lib/ssaTools.ts:44-55`), setting `isPiaOnly = true`
(`recipient.ts:186-196`). Consequences:

- `primaryInsuranceAmount()` returns the override **verbatim, with no COLA applied**
  (`pia.ts:165-171`). All of §2.4's wage-indexing, bend-point, top-35 and COLA-chain machinery is
  dead code for us — as is the `throughColaYear` / nominal-display path.
- `isEligible()` is hard-coded `true` and `earnedCredits()` returns `40` (`recipient.ts:300-329`), so
  the 40-credit test never runs. A person with no work history is modeled as fully insured on
  whatever PIA we supply.
- `primaryInsuranceAmountByBracket` and `primaryInsuranceAmountUnadjusted` **throw** for our
  recipients (`pia.ts:102-104`, `:140-142`). Any future "show the PIA breakdown" feature needs
  earnings records, not a PIA.

### 6.9 Birth day is hard-coded to the 15th, which erases the Jan 1/2 rule

`DEFAULT_BIRTH_DAY = 15` (`src/lib/ssaTools.ts:19`), used at `src/lib/ssaTools.ts:51` and
`src/lib/ssaTools.ts:59`. Because day 15 never crosses a month boundary, `ssaBirthMonth` always
equals `layBirthMonth`, and `earliestFilingMonth()` always returns 62y 1m (`birthday.ts:209-212`).
So the app can never represent either boundary case from §5.1: a real client born Jan 1 would be
assigned the *previous* year's FRA bracket by the engine, and a client born on the 1st or 2nd can
legitimately file a month earlier than we allow. This is a deliberate simplification (the UI only
collects month and year) but it is a silent one.

### 6.10 Smaller items

- `getCurrentAge` (`src/lib/personAnalysis.ts:56-69`) hand-rolls month arithmetic that
  `Birthdate.currentAge()` (`birthday.ts:225-237`) and `ageAtSsaDate` (`birthday.ts:185-187`) already
  provide, and uses a **1-indexed** `birthMonth` against the engine's 0-indexed convention (§5.5).
- `fraFromBirthYear` (`src/lib/ssaTools.ts:57-62`) constructs a throwaway `Recipient` pinned to June
  15 to read the FRA table (`constants.ts:507`). It works, and it is internally consistent with
  §6.9's day-15 choice, but the "Both claim at FRA" comparison row it feeds
  (`src/lib/household.ts:83-89`) would mismatch the engine's own `normalRetirementAge()` for any
  Jan-1-born recipient.
- `createPiaRecipient` maps gender to `'male'`/`'female'` only (`src/lib/ssaTools.ts:53`), never the
  engine's `'blended'` option (`life-tables.ts:8`), and never sets `healthMultiplier` (defaults to
  1.0 at `recipient.ts:47`).
- `nearestWholeClaimAge` (`src/lib/ssaTools.ts:239-241`) is exported but has no callers outside its
  own definition. It also clamps to whole years 62-70, which can name an age the optimizer never
  offered — `earliestFiling` can return 62y 1m or a person's current age
  (`strategy-calc.ts:316-341`).
- Both `rankedSingleStrategies` and `rankedCoupleStrategies` correctly pin the survival curve to
  `asOf.getFullYear()` rather than the wall clock (`src/lib/ssaTools.ts:186-215`); the reasoning in
  those comments is right and matches `getDeathProbabilityDistribution`'s default
  (`life-tables.ts:189`). Note `CURRENT_YEAR` is still wall-clock (§5.8), but PIA-only mode makes
  that inert.

---

## 7. Things I could not determine from the source

- **Whether the engine's survivor treatment is complete with respect to RIB-LIM's "reduced by the
  survivor's own age" interaction.** `survivorBenefit` computes the base (RIB-LIM) and then applies
  the survivor's own early-filing reduction multiplicatively (`benefit-calculator.ts:503-536`). SSA's
  POMS applies the widow(er) limit at a specific point in a longer sequence. The code is
  self-consistent and internally documented, but I cannot verify from this source alone that the
  ordering matches POMS in every case. The repo has a golden-fixture harness cross-checked against
  live ssa.tools (commit `8165a5c`) — that, not this document, is the evidence for numeric fidelity.
- **Whether `survivorNormalRetirementAge` is intended to differ from FRA + 2 cohort years in any
  case.** The author's own comment hedges: `constants.ts:617-618` says "My understanding is that
  these dates are all just +2 years from the corresponding retirement age." The tables at
  `constants.ts:620-708` are hand-entered and I did not verify each row against
  <https://www.ssa.gov/benefits/survivors/survivorchartred.html>.
- **Why the survivor-switch test uses `dependentStratDate + 12 months`** as the comparison date
  (`strategy-calc.ts:92-97`). The comment says "Add a year to include all late filing credits," but
  whether comparing the *fully-credited* personal benefit against the survivor benefit — rather than
  the benefit actually payable in the switch month — is intentional policy or an approximation is not
  determinable from the source.
- **The exact provenance of the `@ts-nocheck` on every vendored file** (line 1 of all 20). It
  suppresses type checking across the whole engine, so TypeScript will not catch a signature
  mismatch at our call sites into it. Whether that is a vendoring artefact or deliberate is not
  recorded here.
