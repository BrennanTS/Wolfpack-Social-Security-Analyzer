# Shareable URL parameters

- **Date:** 2026-08-15
- **Branch:** `feat/share-links`
- **Status:** Approved for planning

## Context

Reproducing a specific analysis today means describing the inputs in prose or
sending a screenshot. That is slow, and it loses precision — a screenshot of a
chart cannot tell you which birth month or discount rate produced it. Advisers
need to hand a configuration to a colleague, and a bug report needs to carry the
exact inputs that triggered it.

The fix is a link that encodes the form state.

## Privacy posture

This is the constraint that shapes the rest of the design. The analyzer holds a
client's name, date of birth, gender and benefit amount — and links leak, into
browser history, chat logs, screenshots and `Referer` headers.

Two decisions follow:

1. **Names are never encoded.** They are display-only and touch no calculation
   (`personLabel` already falls back to "You" / "Spouse"). Excluding them means a
   link reads as a *scenario* rather than a client record: a date of birth and a
   dollar figure with no name attached is far weaker as identifying information.
   An adviser who wants a name on screen types it in two seconds.
2. **The URL is produced on demand, never live.** The address bar does not track
   the form as it is edited, so nothing client-related is written to the address
   bar or session history unless the adviser deliberately asks for a link.

## What is encoded

| Param | Field | Validation |
|---|---|---|
| `ay` | person A birth year | must appear in the form's offered birth-year list |
| `am` | person A birth month | integer 1–12 |
| `ag` | person A gender | `m` or `f` |
| `ab` | person A benefit | 500–5000 |
| `m` | married | `1` (married) or `0` (single) |
| `by` | person B birth year | as `ay` |
| `bm` | person B birth month | as `am` |
| `bg` | person B gender | as `ag` |
| `bb` | person B benefit | 0–5000 (a spouse with no work record is valid) |
| `le` | life expectancy | 75–100 (the `#life` slider's own range) |
| `cola` | annual COLA | 0–8 (the `#cola` slider's own range) |
| `dr` | discount rate | 0–6 (the `#discount` slider's own range) |

The three assumption ranges are the sliders' actual `min`/`max` in
`AssumptionsPanel.tsx`, read from the component rather than assumed. If a slider
range changes, these must change with it — the implementation should import the
bounds from a shared constant rather than duplicating the numbers, so the two
cannot drift.

Person B's params are omitted entirely when `m=0`.

Parameters are short but **readable**, not an encoded blob. An opaque string
would create a false impression of protection — the data is equally present
either way — while making the feature harder to debug and harder for a reader to
audit.

The benefit ranges are the same ones the form itself enforces. Person A's $500
floor is deliberate: Phase 1 made the UI's declared validity and the submission
gate agree, and the link must not become a back door around that.

## The parsing rule

**Everything arriving from a URL is untrusted input.** A malformed or
out-of-range value is **dropped, not clamped**.

This is the single most important behavioral decision here. Clamping would
silently substitute a plausible value that the recipient never notices, and this
is a tool whose output informs a financial decision. Dropping leaves the field
empty, so the form visibly asks for it and the recipient supplies it knowingly.

A link with no valid parameters at all behaves exactly as a normal visit: the
blank form, no error.

## Architecture

A single pure module, `src/lib/shareLink.ts`:

```ts
export function toShareParams(form: AnalyzerFormState): URLSearchParams;
export function fromShareParams(params: URLSearchParams): AnalyzerFormState;
```

`fromShareParams` merges onto `BLANK_FORM`, so any absent or rejected field
retains its blank default. Keeping both functions pure and free of React makes
the round trip unit-testable without rendering, matching how `formState.ts` is
already structured, and keeps the module at the bottom of the dependency graph
alongside `format.ts`.

The round-trip property that must hold:
`fromShareParams(toShareParams(f))` equals `f` with both name fields blanked.

## Behavior

**Copying.** A "Copy link" button sits beside Export PDF in the header, enabled
on the same condition (a complete form). It writes the URL to the clipboard and
confirms briefly. If the Clipboard API is unavailable — an insecure context, or a
denied permission — it falls back to displaying the URL in a selectable field
rather than failing silently.

**Loading.** On mount, present parameters hydrate the form, and the query string
is then stripped from the address bar with `history.replaceState`.

Stripping un-leaks nothing by itself — the recipient already holds the link — but
it keeps a client's date of birth and benefit out of the address bar for the rest
of a meeting, which is the realistic exposure in advisory work: a shared screen
or a glance over the shoulder. The cost is that refreshing the page clears the
form. That trade is accepted deliberately.

**The password gate.** The gate keys off `sessionStorage` and renders before the
analyzer without navigating, so parameters survive sign-in and hydrate once the
analyzer mounts. This needs a test, because it is exactly the kind of interaction
that breaks silently.

**Referrer.** `index.html` gains a referrer meta tag, since the Resources panel
links out to ssa.gov and a query string must not ride along in the `Referer`
header.

## Testing

- **Unit** (`shareLink.test.ts`): the round-trip property; person B omitted when
  single; and a rejection case per parameter — out-of-range benefit, month 13,
  unknown gender, a birth year outside the offered list, non-numeric junk —
  each asserting the field is left blank rather than coerced.
- **Component:** the Copy link button's enabled/disabled condition, the success
  path, and the clipboard-failure fallback.
- **End-to-end:** loading a populated URL renders the expected analysis, and the
  query string is gone from the address bar afterwards.

## Success criteria

1. A link produced from a complete form reproduces the same analysis on another
   machine, with names blank.
2. No name appears in a generated URL under any circumstance.
3. Every invalid parameter leaves its field blank; none is clamped into a
   plausible value.
4. The address bar carries no client data except in the moment a link is
   deliberately copied, and is cleared after a link is loaded.
5. A link arriving at the password gate still hydrates after sign-in.
6. `npm run lint`, the unit/component suite, `npm run build` and the e2e suite
   all pass.

## Out of scope

Saving or naming scenarios, server-side storage, short links, and any encoding
intended to obscure the contents. Each would need its own design, and the last
would be security theatre.
