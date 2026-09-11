---
description: Review every client-facing sentence against the copy rubric
---

Review this app's client-facing copy and report what is wrong with it.

## What to read

1. `validation/copy/RUBRIC.md` — the standard. Read it first and in full;
   it is the only definition of "wrong" that applies here.
2. `validation/copy/corpus.md` — every distinct sentence the app can render,
   grouped by the component that renders it, with real figures in it.

If `corpus.md` is missing or older than the copy modules it came from,
regenerate it first with `npm run copy:corpus`, and say that you did.

## How to review

Read the corpus **as a client would** — someone who does not work in finance,
is making a six-figure decision, and may be reading it while an adviser talks.

Work rule by rule from the rubric rather than file by file. A defect class
shows itself across components; going file by file finds one instance and
misses the pattern.

Check what the corpus does NOT contain as well as what it does. A caveat that
should sit beside a figure and appears nowhere is a finding, and it is
invisible if you only read what is there.

The count in brackets is roughly how many households produce that sentence.
Use it to rank, not to dismiss: a line seen by one household in a hundred
still reaches a real client.

## What NOT to do

- Do not rewrite the corpus. It is generated; edits there are discarded.
- Do not flag the mechanical faults already covered by `validation/sweep/copy.sweep.ts`
  — duplicate sentences on one surface, banned jargon, screen and print
  disagreeing. Those are deterministic tests. Report what a test cannot judge:
  whether a sentence is clear, correct, and safe to hand to a client.
- Do not invent findings to fill a report. Saying a rule is clean is a
  result, and a more useful one than a padded list.
- Do not change any source file. This command produces a report; a human
  decides what to act on.

## Output

Write the report to `validation/copy/review-<today's date>.md`, and give a
short summary in chat — how many findings, at what severity, and the single
most important one.

Structure each finding as:

```
### <short claim of what is wrong>

- **Source:** <the corpus heading, e.g. HouseholdPanel.recommendationDetail>
- **Rule:** <which rubric rule, by number and name>
- **Line:** "<the sentence, quoted>"
- **Why it matters:** <what the reader concludes, wrongly, and what it costs>
- **Suggested:** "<a replacement sentence>"
```

Order findings by consequence to the client. Put a one-paragraph summary at
the top saying what the copy is doing well, so the report is usable as a
review rather than only as a defect list.
