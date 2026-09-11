# What the app's copy has to be

The standard a reviewer holds `corpus.md` to. Versioned here rather than
living in a prompt, so a change to the standard is a commit somebody can
disagree with.

Context: every line in the corpus is read by a **client** — someone who does
not work in finance, is making a decision worth six figures, and is often in
the room while an adviser talks. A few lines are read by the adviser or by a
compliance reviewer instead; the corpus says which component rendered each.

## 1. Correct about Social Security

The most expensive kind of error, and the one a reader cannot catch.

- Rules stated must match current SSA rules. The Social Security Fairness Act
  repealed WEP and GPO in January 2025 — copy must not say they apply.
- A benefit amount, an age and a date must be described as what they are.
  A lifetime **sum** is not a **present value**; calling one the other is the
  exact defect this project has shipped more than once.
- The widow(er)'s limit genuinely lets a survivor be paid more than the
  deceased was receiving. Copy must not "correct" that into something that
  sounds more sensible.
- Anything the report does not model (taxes, the earnings test, benefits for
  children or a former spouse) must not be implied to be included.

## 2. Not advice

A firm hands this to a client. It analyses; it does not instruct.

- No sentence should tell a reader when to claim as a settled matter. The
  report shows what each filing age pays and what else bears on the choice.
- Claims about checking, accuracy or validation must be scoped and dated, and
  must never imply endorsement by SSA.
- "Best", "optimal" and "recommended" are acceptable INSIDE a comparison
  whose measure is stated. They are not acceptable as instructions.

## 3. Understandable without a glossary

- Second person. "You file at 70", not "Client files at age 70".
- No term a reader would have to look up. `PIA`, `FRA`, `discount rate`,
  `mortality-weighted`, `RIB-LIM` and `optimizer` appear only on the terms
  page, where each is introduced in plain words first.
- `present value` is the exception, and it is permitted anywhere. It names a
  distinction the report genuinely has to draw — a lifetime sum and a
  discounted figure are different quantities and must not be confused — and
  the alternatives were a wrong word or a paragraph. The terms page
  introduces it under "Lifetime value". Barring it did not work: the same
  words reached the printed report from three components while a test
  asserted the term was banned, because that test read one module and the
  sentences were assembled in others.
- The per-surface half of this rule is enforced by
  `validation/sweep/copy.sweep.ts`, which reads what actually renders.
  Methodology surfaces are exempt by source: explaining the method is their
  job.
- Every figure carries a unit and a horizon: a month, a year, over your
  lifetimes.
- Prefer a short sentence to a subordinate clause. If a sentence needs two
  readings, it needs rewriting.

## 4. House style

- **US English.** Not British. This has been raised more than once.
- **No em dashes** anywhere a client reads. They are the clearest tell of
  machine-written prose, and this project removed them deliberately.
- No rhetorical scaffolding: no "it's important to note", no "simply", no
  "of course", no three-item lists for their own sake.
- Sentences beside each other must not repeat: a caption and the note under
  it saying the same thing in different words is a defect, not emphasis.

## 5. Honest about absence

- A figure that does not exist is stated as absent, in words. Never an
  em dash, a zero, or a blank. A sentinel once printed as
  "beginning at age — —" in a client PDF.
- A caveat belongs beside the figure it qualifies, not only on a later page.

## What a finding looks like

Name the **source** from the corpus heading, quote the line, say which rule it
breaks and why it matters to the reader, then propose a replacement. Rank by
consequence to the client, not by how easy the fix is. Say plainly when the
corpus is clean on a rule rather than manufacturing a finding.
