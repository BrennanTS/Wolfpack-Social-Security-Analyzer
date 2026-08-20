# Survivor-start correction: measured impact

How large a piece of work is it to start a widow(er) benefit at SSA age 60 rather than at the
survivor's own filing date? This measures the proposed correction; it does **not** implement it. No
file under `src/vendor/ssa-tools/` was modified, and nothing outside this document was written.

**Method.** Every amount below comes from the engine's own functions — `survivorBenefit`
(`benefit-calculator.ts:444`), `benefitOnDate` (`benefit-calculator.ts:182`), `spousalBenefitOnDate`
(`benefit-calculator.ts:289`), `PersonalBenefitPeriods`
(`strategy/calculations/recipient-personal-benefits.ts`), and the date arithmetic on
`Birthdate`/`MonthDate`. The measurement harness is a line-for-line replication of
`strategySumPeriodsCouple` (`strategy-calc.ts:24-173`) parameterized on one expression, the survivor
start date. The replication was checked against the vendored function over **20,736** distinct
(birth year × PIA × plan-to age × filing age) configurations and is bit-identical on every period
and every cent; the harness's NPV routine likewise reproduces `strategySumCentsCouple`
(`strategy-calc.ts:820`) exactly on the same 20,736 cases. No benefit rule is reimplemented anywhere
in this work; the only input supplied is the age-60 date, via the engine's own `dateAtSsaAge`
(`birthday.ts:178`).

Read alongside `docs/reference/ssa-tools-engine-audit.md` §2.3, §5.2 and §6.2, which describe the
defect. Where this document says "measured" it means computed over the households and strategies
named; where it says "inferred" it means argued from code, not run.

---

## Summary — footnote or redesign?

**Neither, and the framing in the brief needs one correction before the size can be judged.** The
correction is a *no-op for the entire golden fixture suite* — bit-exact across all 61,823 filing-age
combinations of all 11 married full-mode scenarios (§3), so no fixture value moves and the suite
cannot see the change at all. Over a 9,360-household synthetic sweep it changes nothing for 75.0% of
households and changes something displayed for 25.0%, concentrated in the comparison rows the user
reads rather than in the recommendation: 8.5% of households are affected at the *recommended* filing
ages, but 25.0% are affected on "both delay to 70", where the survivor-income
column currently prints **$0** for 11.5% of all households swept and would print a real figure
instead. So far, footnote-sized. What makes it more than a footnote is that **the start date is the
amount**: `survivorBenefit` keys its 71.5%-to-100% reduction to the date passed as
`survivorFilingDate` (`benefit-calculator.ts:510-536`), so moving the start earlier permanently
lowers the benefit. Applied literally, the correction *reduces* lifetime household income in exactly
half the households it touches at the recommended ages (400 of 800, by up to $48,532), and in 308
households it makes the reduced survivor amount fall below the dependent's own benefit, at which
point the engine's single evaluation (`strategy-calc.ts:92-100`) deletes the survivor period
outright and the household loses up to $292,092. Modeling the choice SSA actually gives a widow —
claim the survivor benefit and your own benefit on separate dates, and be paid the larger each month
— removes every one of those losses and is worth up to **$149,907** more than the best plan the
engine's model can express (§4). **The start-date fix alone is not safe to ship; the unit of work is
the two-date survivor model, not a one-line date change.**

---

## 0. What was measured, and against what

| | |
|---|---|
| **Current** (`T0`, `N0`) | the vendored engine, unmodified: `survivorStart = max(earnerDeath + 1, dependentFilingDate)` (`strategy-calc.ts:74-77`) |
| **Literal correction** (`T1`, `N1`) | the brief's proposal verbatim: `survivorStart = max(earnerDeath + 1, dependent's SSA age 60)`. Everything else — the applicability test, the truncation of the dependent's personal period, the spousal end date — left exactly as the engine has it |
| **Dual entitlement** (`T2`, `N2`) | SSA's administration: the widow(er) keeps their own retirement benefit and the survivor benefit tops it up, so each month pays `max(own, survivor)`. Survivor claimed as early as allowed |
| **Two-decision plan** (§4) | dual entitlement, with the survivor claim month *and* the dependent's own filing age both chosen freely |

`T` is an undiscounted lifetime household total in constant dollars, counted from `asOf`. `N` is the
deterministic NPV at the scenario's own discount rate and its own plan-to ages — the same arithmetic
as `strategySumTotalPeriodsCouple` (`strategy-calc.ts:255-303`), verified against it.

**The sweep.** 9,360 married households, each run through the app's own pipeline:

- person A birth year ∈ {1958, 1961, 1964, 1967, 1970}; person B born A ± {0, 2, 5, 10, 15, 20}
  years (B constrained to 1957–1990, i.e. under 70 at `asOf`)
- PIA A ∈ {$1,200, $2,400, $3,600}; PIA B ∈ {$0, $900, $1,800, $2,700, $3,400}
- plan-to age ∈ {72, 78, 84, 90} for each person, independently
- birth months fixed (A April, B September), genders male/female, `asOf` 2026-01-15, discount 2.5%
- households where either plan-to year is ≤ 2028 are dropped (the optimizer has no filing age to
  offer)

Each household was ranked by `rankedCoupleStrategies` (`src/lib/ssaTools.ts:166-184`) — the same
mortality-weighted call the app makes — and then every returned candidate was evaluated under both
models: **66,123,360 filing-age combinations** in total, plus the four rows the app displays
(`earliest` 62/62, `fra`, `optimal`, `latest` 70/70; `src/lib/household.ts:161-171`).

Two structural facts, measured across all 37,440 (household × displayed row) pairs and stated here
because everything below depends on them:

- The correction **never** starts the benefit later (0 rows), because a filing age is ≥ 62 and the
  age-60 date is always earlier.
- The correction **never** changes a Spousal band (0 households). The engine already ends spousal at
  `survivorStart − 1` (`strategy-calc.ts:153-155`) and starts it at `max(earnerFiling, depFiling)`,
  so whenever the survivor start moves the spousal period was already empty.

---

## 1. How much income does the correction add, and to how many households?

### 1.1 Fixtures: none, and not one cent

All 11 married full-mode scenarios in `validation/fixtures/scenarios.json` are **unaffected**, and
not merely at their recommended ages: across **every one of the 61,823 filing-age combinations** the
optimizer considers for them, the corrected and current models produce identical periods, identical
survivor start dates and identical totals. Maximum start shift: 0 months, in every scenario.

The reason is structural and is worth recording: **every scenario in the file gives both people a
plan-to age of 85.** The correction can only bite when the dependent has *not yet filed* when the
earner dies. With both people planning to 85 and age gaps of 0–13 years, the first death lands 15 to
20 years after the dependent's filing:

| scenario | earner dies | dependent files | survivor start (current = corrected) |
|---|---|---|---|
| `married-1960-spouse-no-record` | 2045-06 | 2029-03 | 2045-07 |
| `married-1960-partial-topup` | 2045-06 | 2026-02 | 2045-07 |
| `married-1964-dual-high-earners` | 2049-02 | 2026-08 | 2049-03 |
| `married-1962-spouse-higher-earner` | 2045-08 | 2026-01 | 2045-09 |
| `married-1965-younger-spouse-no-record` | 2050-03 | 2034-09 | 2050-04 |
| `married-1962-same-sex-both-male` | 2047-04 | 2026-03 | 2047-05 |
| `married-1963-spouse-claims-early` | 2048-01 | 2028-09 | 2048-02 |
| `sample-hh2-married-1960-dual-high-earners` | 2045-02 | 2026-02 | 2045-03 |
| `sample-hh3-married-1959-reduced-spousal` | 2044-07 | 2026-01 | 2044-08 |
| `sample-hh4-married-1955-wide-age-gap` | 2040-03 | 2030-07 | 2040-04 |
| `sample-hh13-married-1962-two-max-earners` | 2047-04 | 2026-01 | 2047-05 |

The 19 single-claimant scenarios have no survivor at all. This is the blind spot already recorded in
the project's own notes about life expectancy in the fixtures, and it is exact here: **"no fixture
moved" is not evidence about this correction.**

### 1.2 Sweep: 25% of households, almost all of it in the comparison rows

Measured over 9,360 households.

| | affected | displayed survivor-income cell goes $0 → nonzero |
|---|---|---|
| dependent (lower PIA) outlives the earner at all | 5,210 (55.7%) | — |
| `earliest` (62/62) | 800 (8.5%) | 0 (0.0%) |
| `fra` | 1,440 (15.4%) | 572 (6.1%) |
| `optimal` (the recommendation) | 800 (8.5%) | 0 (0.0%) |
| `latest` (70/70) | 2,340 (25.0%) | 1,072 (11.5%) |
| **at least one displayed row** | **2,340 (25.0%)** | 1,072 (11.5%) |
| **no displayed row** | **7,020 (75.0%)** | — |

"Affected" means the survivor start moves earlier and the dependent lives to see it. The 75.0%
majority is the uninteresting one the brief expected: the survivor filed years before the death, so
`max(death + 1, filing)` and `max(death + 1, age 60)` are the same month.

**Gap length.** At the recommended ages the gap is 5–25 months (median 25). On "both delay to 70" it
is 4–120 months (p25 16, median 76, p75 120) — the optimizer files the dependent at ~62 in almost
every household, so the window in which the survivor is unfiled is short at the optimum and long on
the delay rows.

**Money, at the recommended ages** (800 affected households):

| | min | median | max | negative in |
|---|---|---|---|---|
| lifetime delta, literal correction (`T1 − T0`) | **−$48,532** | +$828 | +$35,060 | **400 of 800** |
| lifetime delta, dual entitlement (`T2 − T0`) | −$48,532 | +$828 | +$35,060 | 400 of 800 |
| displayed survivor-income cell (`Y1 − Y0`) | **−$936** | $0 | $0 | — |

**Money, on "both delay to 70"** (2,340 affected households):

| | min | median | max | negative in |
|---|---|---|---|---|
| lifetime delta, literal correction (`T1 − T0`) | **−$292,092** | +$76,127 | +$358,700 | **308 of 2,340** |
| lifetime delta, dual entitlement (`T2 − T0`) | **+$5,952** | +$107,519 | +$382,600 | **0** |
| displayed survivor-income cell (`Y1 − Y0`) | $0 | +$14,700 | +$54,720 | 0 |

### 1.3 The brief's premise that only the start date is wrong is not right

`survivorBenefit` computes the survivor's age **at `survivorFilingDate`** and scales the base
between 71.5% and 100% on that age (`benefit-calculator.ts:510-536`). The start date and the amount
are the same parameter. Two consequences, both measured:

**(a) An earlier start is a permanently smaller cheque.** Worked by hand and confirmed against the
engine, on `A 1958-04 PIA $2,400 plan-to 72 / B 1968-09 PIA $0 plan-to 90` at the recommended ages
(A files 70, B files 62y1m):

- A's FRA is 66y8m (`constants.ts` `FULL_RETIREMENT_AGE`, 1958 cohort); filing at 70 is 40 months of
  delayed credits at 8%/yr = 2/3%/mo → 26.667%, so A's own benefit is `2400 × 1.26667 = $3,040`.
- A filed (2028-04) before dying (2030-04), so RIB-LIM applies: base =
  `max(0.825 × 2400, 3040) = $3,040` (`benefit-calculator.ts:488-500`).
- B's **survivor** FRA is 67 (`FULL_RETIREMENT_AGE_SURVIVOR`, 1962+, `constants.ts:702-707`) — a
  different table from the retirement FRA, and for this cohort the same number.
- Current start 2030-10 (B's own filing month), B aged 62y1m = 25 months past 60 of the 84 between
  60 and survivor-FRA: `0.715 + 0.285 × 25/84 = 0.799821`; `× 3040 = 2431.5` → floored to
  **$2,431**. Engine: $2,431. ✔
- Corrected start `max(2030-05, B's age-60 month 2028-09) = 2030-05` — B turned 60 two years before
  the death, so the month after the death binds. B is 61y8m, i.e. 20 months past 60:
  `0.715 + 0.285 × 20/84 = 0.782857`; `× 3040 = 2379.9` → floored to **$2,379**. Engine: $2,379. ✔
- Net: 5 extra months at $2,379 = +$11,895, against a permanent −$52/mo over the remaining 336
  months = −$17,472. **Lifetime total falls by $5,577**, and the displayed survivor-income cell falls
  from $29,172 (`12 × 2431`) to $28,548 (`12 × 2379`).

**(b) The correction can delete the survivor benefit entirely.** `strategy-calc.ts:92-100` compares
the dependent's own fully-credited benefit against the survivor amount and emits **no Survivor
period at all** if the own benefit wins. Feeding it a smaller (early-claimed) survivor amount flips
that test in **308 of 9,360 households** (3.3%) on the `fra` and `latest` rows — never on `earliest`
or `optimal`. Those 308 are exactly the 308 households where the literal correction loses money on
the delay row, and the loss is the whole survivor step-up: median −$58,136, worst **−$292,092**.
Under dual entitlement the same households gain (median +$107,519), because the widow keeps her own
benefit and receives the difference rather than choosing between them.

---

## 2. Would the recommendation move?

### 2.1 What this can and cannot establish

The optimizer ranks by **mortality-weighted expected NPV** — `expectedNPVCoupleOptimized`
(`expected-npv.ts`), reached through `rankedCoupleStrategies` (`src/lib/ssaTools.ts:166-184`). That
objective integrates over the whole death-probability distribution for both people and cannot be
recomputed under a corrected survivor start without rewriting ~900 lines of vendored, hand-optimized
code. It was not rewritten.

**What was computed instead is a proxy**: for every candidate strategy the app already ranks, the
household's lifetime outcome under *that scenario's own plan-to ages*, in two forms — an undiscounted
total (`T`, what the brief asked for) and a deterministic NPV at the scenario's own discount rate
(`N`, which differs from the optimizer's objective only by the mortality weighting and is therefore
the closer of the two). Each is then ranked under the current model and under the corrected model,
and the argmax compared.

**This is not the optimizer's objective.** A reordering under the proxy does not prove the
mortality-weighted optimum moves; no reordering under the proxy does not prove it does not. Two
households can share a proxy ranking and differ under mortality weighting, and vice versa. What the
proxy does establish is whether the correction is large enough, relative to the differences between
adjacent strategies, to plausibly matter — and where in the input space it could.

### 2.2 Measured

| | reorders | of |
|---|---|---|
| argmax of undiscounted lifetime total (`T0` → `T1`) | **521 (5.6%)** | 9,360 |
| argmax of deterministic NPV (`N0` → `N1`) | **339 (3.6%)** | 9,360 |
| …restricted to the 2,340 households affected on some displayed row | 521 (22.3%) / 339 (14.5%) | 2,340 |
| …restricted to the 7,020 households affected on no displayed row | **0 / 0** | 7,020 |
| all 11 married fixtures | **0 / 0** | 11 |

The reordering is entirely confined to the affected set, which is the expected shape and a useful
consistency check on the harness.

### 2.3 A household where it reorders

`A 1958-04, male, PIA $2,400, plan-to 72 · B 1968-09, female, PIA $0, plan-to 90`, `asOf`
2026-01-15, discount 2.5%. 3,264 candidate strategies.

| | argmax under current | argmax under corrected |
|---|---|---|
| undiscounted lifetime total | **70y0m / 66y3m** — $918,842 | **70y0m / 62y1m** — $887,239 |
| deterministic NPV | **70y0m / 62y6m** — $592,881 | **70y0m / 62y1m** — $592,066 |

The dependent's filing age moves 50 months under the total proxy and 5 months under the NPV proxy.
The mechanism is worth stating because it is a design signal, not noise: under the current model the
dependent's own filing date is *also* the survivor start, so filing later buys a larger widow's
benefit and the optimizer trades own-benefit months for it. Under the literal correction that lever
disappears — the survivor benefit starts at age 60 regardless and the dependent's personal period is
truncated to `survivorStart − 1` (`strategy-calc.ts:114-122`), which for this household is *before*
they ever file — so their own filing age becomes very nearly irrelevant to the model and the argmax
collapses to the earliest age. That collapse is an artifact of keeping the single-evaluation
replacement semantics, and it is the same defect §4 is about.

The app's own archetype household (`src/lib/household.test.ts:833-841` — Dan b. 1958-04 PIA $2,400
plan-to 78, Sarah b. 1968-02 PIA $1,200 plan-to 90) does **not** reorder under either proxy: both
argmaxes stay at 70y0m / 62y1m. Its displayed figures do change; see §3.3.

---

## 3. Which fixtures would move?

### 3.1 None

Zero of the 30 scenarios in `validation/fixtures/scenarios.json` change any recorded value. No
`spousalTopUpAtFilingAge`, no `startsAtSpouseAge`, no `recommendedFilingAgeByPerson`, no
`spousalTopUpAtFra`, no `monthlyByClaimAgeByPerson`, no `percentOfPiaByClaimAgeByPerson`, no
`breakEvensByPerson`, no `fraByPerson`, no `optimalAgeRangeByPerson`. There is nothing to
re-derive, so there is no hand-derivation table in this section.

The evidence is stronger than "the recommended strategy is unaffected". For each married scenario,
every filing-age combination in the app's own candidate set was evaluated under both models:

| scenario | combinations | differing | max start shift |
|---|---|---|---|
| `married-1960-spouse-no-record` | 4,050 | 0 | 0 mo |
| `married-1960-partial-topup` | 3,510 | 0 | 0 mo |
| `married-1964-dual-high-earners` | 9,216 | 0 | 0 mo |
| `married-1962-spouse-higher-earner` | 4,592 | 0 | 0 mo |
| `married-1965-younger-spouse-no-record` | 9,216 | 0 | 0 mo |
| `married-1962-same-sex-both-male` | 7,296 | 0 | 0 mo |
| `married-1963-spouse-claims-early` | 8,160 | 0 | 0 mo |
| `sample-hh2-married-1960-dual-high-earners` | 3,450 | 0 | 0 mo |
| `sample-hh3-married-1959-reduced-spousal` | 4,085 | 0 | 0 mo |
| `sample-hh4-married-1955-wide-age-gap` | 2,016 | 0 | 0 mo |
| `sample-hh13-married-1962-two-max-earners` | 6,232 | 0 | 0 mo |
| **total** | **61,823** | **0** | **0 mo** |

Since the recommended ages cannot move, nothing downstream of them (`spousalTopUpAtFilingAge`,
`startsAtSpouseAge`) can move either — and independently of that, Spousal bands are untouched by the
correction in every household measured (§0).

### 3.2 The fixtures record no survivor figure at all

`ScenarioExpected` (`validation/fixtures/scenarios.ts:41-91`) has no survivor field. The only place
survivor behavior is asserted in the golden suite is a structural check —
`validation/engine/golden.test.ts:343-358`, that a Spousal band always ends before a Survivor band
for the same person. That invariant continues to hold under the correction by construction: spousal
ends at `survivorStart − 1` and survivor starts at `survivorStart`, whichever rule sets the date.

So a correction shipped today would leave the golden suite entirely green, and that greenness would
carry no information. **If this work goes ahead, at least one married fixture needs a plan-to age
that is not 85** — the whole file uses 85 for every person, and that single choice is what makes the
suite blind here.

### 3.3 Non-fixture tests that would move

Outside `validation/`, three assertions pin the defect's output directly and would need re-deriving:

- `src/lib/household.test.ts:842-858` asserts the Dan/Sarah household pays the survivor **$0** under
  "both delay to 70" and $36,480 under the optimum. Under the correction that $0 becomes
  **$36,480** — measured, and derived below.
- `src/components/methodologyCopy.ts:542` and `src/components/methodologyCopy.test.ts:558-562`
  describe the same $0 as a live example in user-facing copy.
- `src/lib/household.ts:372-402` (`survivorIncomeRisesWithDelay`) documents that household as the
  permanent counter-example to a caption claiming survivor income rises with delay.

Hand-derivation for Dan/Sarah under "both delay to 70", confirmed against the engine:

- Dan b. 1958-04 → SSA birth month 1958-04; retirement FRA 66y8m; files at 70 → 2028-04; plan-to 78
  → dies 2036-04.
- Delayed credits: 40 months × 2/3%/mo = 26.667% → own benefit `2400 × 1.26667 = $3,040`.
- He filed before death, so RIB-LIM: base = `max(0.825 × 2400 = 1980, 3040) = $3,040`.
- Sarah b. 1968-02 → survivor FRA **67** (`constants.ts:702-707`); SSA age 60 in 2028-02; files at 70
  → 2038-02; plan-to 90 → dies 2058-02.
- Current survivor start = `max(2036-05, 2038-02) = 2038-02`. Sarah is 70 — past her survivor FRA —
  so the base is paid in full: **$3,040** (`benefit-calculator.ts:512-517`).
- Corrected survivor start = `max(2036-05, 2028-02) = 2036-05`. Sarah is 68y3m — **also past her
  survivor FRA** — so the base is *still* paid in full: **$3,040**. No reduction, because she was
  already past 67 when Dan died.
- Gap: 21 months × $3,040 = **+$63,840** lifetime, with no offsetting permanent cut. Engine
  confirms: `T0 = $1,027,520`, `T1 = $1,091,360`, difference $63,840 exactly.
- The survivor-income column reads calendar year 2037 (`src/lib/household.ts:266-278`): currently
  $0, corrected `12 × 3040 = ` **$36,480** — the same figure the optimum row already shows.

One nuance for whoever rewrites the copy: after the correction the column for that household reads
$36,480 on both its rows, so `survivorIncomeRisesWithDelay` (`src/lib/household.ts:404-422`) still
returns `false` — it requires at least one strictly increasing comparable pair. The column stops
*falling*; it does not start *rising*. The caption's branch is unchanged, its example is not.

---

## 4. Does the correction create a decision the model does not represent?

**Yes, and it is material.** This is the finding that changes the size of the job.

### 4.1 The decision

Once a widow(er) can be paid from age 60 independently of their own filing, SSA gives them two
dates, not one: when to claim the survivor benefit (any month from 60, permanently reduced if before
survivor-FRA) and when to claim their own retirement benefit (62–70, permanently increased if
delayed). They are paid the larger each month. The standard planning move is to take the reduced
survivor benefit immediately and let one's own benefit grow to 70.

The engine has one date. `strats` is `[MonthDuration, MonthDuration]` — one filing age per person
(`strategy-calc.ts:27`) — the switch is evaluated **once** (`strategy-calc.ts:92-100`), it pays
whichever is larger for life, and the dependent's own period is *replaced*, not topped up
(`strategy-calc.ts:114-122`). There is no expression in this data model for "claim survivor now,
own later."

### 4.2 Measured

390 households were sampled (every 6th) from the 2,340 affected on some displayed row. For each,
holding the earner's recommended filing age fixed:

- **best the engine's model can reach**: maximize the undiscounted household total over the
  dependent's filing age, under the current rules;
- **best two-decision plan**: maximize the same total over *both* the dependent's own filing age and
  the survivor claim month (from the earliest allowed month up to survivor-FRA — deferring past
  survivor-FRA never raises the amount, `benefit-calculator.ts:512-517`).

| | |
|---|---|
| two-decision plan strictly beats the engine's best | **171 of 390 (43.8%)** |
| median gain over all 390 | $0 |
| p90 gain | **+$45,950** |
| maximum gain | **+$149,907** |
| optimal plan defers the survivor claim past age 60 | 114 of 390 |
| optimal plan files the dependent's own benefit *later* than the engine's best | 30 |
| …*earlier* | 66 |

That 114 defer the survivor claim matters as much as the headline: the right answer is not always
"claim at 60". A correction that hard-codes age 60 as the start is a different wrong answer from the
one it replaces, just a smaller one.

### 4.3 A worked example

`A 1958-04, male, PIA $3,600, plan-to 72 · B 1973-09, female, PIA $3,400, plan-to 84`, `asOf`
2026-01-15. A (the earner) files at 70, the optimizer's choice. Every figure below is hand-derived
from SSA's rules and then confirmed against the engine to the dollar.

- A's FRA 66y8m; filing at 70 = 40 months × 2/3% = 26.667% → own benefit `3600 × 1.26667 = $4,560`;
  paid 2028-04 to 2030-04, 25 months = **$114,000**.
- A filed before death, so RIB-LIM base = `max(0.825 × 3600 = 2970, 4560) = $4,560`.
- B's survivor FRA is 67 (2040-09); B reaches SSA age 60 in 2033-09; B's retirement FRA is 67.

**What the engine's model can do at best** — B files at 63y4m (2037-01):

- Survivor start = `max(2030-05, 2037-01) = 2037-01`; B is 63y4m, i.e. 40 months past 60 of the 84
  between 60 and survivor-FRA: `0.715 + 0.285 × 40/84 = 0.850714`; `× 4560 = 3879.3` → **$3,879**.
- B's own at 63y4m is 44 months early: `36 × 5/9% + 8 × 5/12% = 20% + 3.333% = 23.333%` →
  `3400 × 0.76667 = 2606.7` → $2,606. That is less than $3,879, so the Survivor period is emitted and
  B's personal period is truncated to 2036-12 — i.e. out of existence.
- B receives $3,879 from 2037-01 to 2057-09, 249 months = **$965,871**.
- Household total = 114,000 + 965,871 = **$1,079,871**. Engine: $1,079,871. ✔

**The two-decision plan** — B claims the survivor benefit at 60 and her own at 70:

- Survivor at 2033-09, B exactly 60: factor 0.715; `× 4560 = 3260.4` → **$3,260**, paid 2033-09 to
  2043-08, 120 months = **$391,200**.
- B's own at 70 (2043-09): 36 months of credits at 8%/yr → `3400 × 1.24 = $4,216`. From 2043-09 she
  is paid the larger of the two, `max(4216, 3260) = $4,216`, to 2057-09, 169 months = **$712,504**.
- Household total = 114,000 + 391,200 + 712,504 = **$1,217,704**. Engine-sourced amounts, same
  arithmetic: $1,217,704. ✔

**Gain: +$137,833**, or 12.8% of the best lifetime total the engine's model can express. For
reference, the literal correction at the recommended ages gives this household **$1,056,140** —
*worse* than the current model's $1,079,871, because it takes the 71.5% reduction and still throws
away B's own benefit.

### 4.4 What that means for the design

The three models rank, for this household: two-decision $1,217,704 > current $1,079,871 > literal
correction $1,056,140. A start-date fix that keeps the single evaluation lands on the worst of the
three. The pieces the design has to add are:

1. **A second date per person.** `strats: [MonthDuration, MonthDuration]` cannot carry it, and that
   type is threaded through `strategySumPeriodsCouple`, `optimalStrategyCouple`,
   `expectedNPVCouple*` and `optimal-strategy-fast.ts`.
2. **Top-up rather than replacement**, so the dependent keeps their own benefit. The app already
   does this transformation for display — `splitDualEntitlement`
   (`src/lib/benefitPeriods.ts:164-191`) — but only as a re-composition of the engine's total, which
   is exactly why it cannot recover the money above.
3. **A larger search space for the optimizer**, since the second date is a decision variable and not
   a constant.

Point 3 is where the cost is: the optimizer already sweeps ~3,000–9,400 filing-age pairs per
household, and adding a survivor claim month multiplies that by up to 85.

---

## 5. Corrections to the brief

1. **"Only the *start date* is wrong."** The start date *is* the amount:
   `benefit-calculator.ts:510-536` derives the reduction from `survivorFilingDate`. Applying the
   proposed rule literally lowers lifetime household income in 400 of the 800 households it touches
   at the recommended ages (up to −$48,532) and in 308 of 2,340 on the delay row (up to −$292,092).
   §1.3.
2. **The amount feeds the applicability test.** `strategy-calc.ts:92-100` decides whether a Survivor
   period exists at all by comparing the survivor amount against the dependent's own benefit. A
   smaller (early) survivor amount deletes the period in 308 households. This is not a start-date
   change with a start-date-sized blast radius. §1.3(b).
3. **The defect is in four places, not two.** The brief names `strategy-calc.ts:71-77` and
   `expected-npv.ts:708`. There are two more: `strategy-calc.ts:537-540`
   (`strategySumPeriodsOptimized`, the same expression again) and `optimal-strategy-fast.ts:418`
   (`const svStart = eDeath + 1 > dFile ? eDeath + 1 : dFile;`). Only `strategy-calc.ts:74-77` and
   `expected-npv.ts:708` are on the app's live paths (`src/lib/benefitPeriods.ts:299` and
   `src/lib/ssaTools.ts:177` respectively), but a fix that misses the other two leaves the vendored
   tree internally inconsistent.
4. **The fixtures cannot detect this.** Everything in `scenarios.json` uses plan-to age 85 for every
   person, and the correction is a bit-exact no-op across all 61,823 of their filing-age
   combinations. §3.1.
5. Everything else in the brief checked out: `strategy-calc.ts:71-77`, `benefit-calculator.ts:444-537`,
   `expected-npv.ts:708`, `constants.ts:620-708`, and the description of the reduction schedule and
   of the separate survivor-FRA table are all accurate as written.

---

## 6. What was not measured

- **The optimizer's own objective.** Mortality-weighted expected NPV was never recomputed under a
  corrected survivor start; §2 is a proxy and says so. Whether the *recommended filing ages* move for
  any particular household is therefore not established, in either direction.
- **Discounting in §1 and §4.** The dollar deltas in those sections are undiscounted constant-dollar
  totals. The deterministic-NPV column in §2 is discounted; the §4 comparison is not, because it is a
  like-for-like maximization of the same quantity under two models.
- **The dependent-dies-first direction.** The engine never pays the higher earner a survivor benefit
  (`strategy-calc.ts:103-111`); that gap is separate, already disclosed by `detectSurvivorGap`
  (`src/lib/benefitPeriods.ts:243-280`), and untouched by this correction.
- **Remarriage, disabled-widow(er) benefits at 50, child-in-care survivor benefits, the family
  maximum, and the lump-sum death payment.** None are modeled by the engine (audit §2.3, §3) and
  none were added here. In particular the age-60 rule this correction implements has an eligibility
  condition — unmarried, or remarried after 60 — that the app collects no input for.
- **Anything nominal.** Every figure is in constant today's dollars, as the engine produces them
  (audit §2.4).
