/**
 * Invariants 5, 6 and 7 — rendered copy, and the branches nothing reaches.
 *
 * This project shipped sixteen copy defects and zero arithmetic defects. The
 * shapes that got through: an em-dash sentinel printing "beginning at age — —"
 * in a client PDF, a fabricated present-tense dollar figure, a caption made
 * false by a change beneath it, and a fix that produced a verbatim duplicate
 * sentence in consecutive paragraphs. Every one was found by a human reading
 * the output.
 *
 * Copy is single-sourced in `methodologyCopy.ts` by design, so calling those
 * functions against real analyzes covers the same strings both surfaces
 * render — cheaply enough to run over thousands of households. `surfaces.ts`
 * models WHICH strings land in front of the same reader, which is what makes
 * the duplicate check meaningful rather than noisy.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { incomeCliff } from '../../src/lib/incomeCliff';
import type { DollarsMode } from '../../src/lib/dollarsMode';
import { householdAt, widowedHouseholdAt } from './households';
import { analyze, stubLifeTableFetch, summarize, sweepCorpus, type Finding } from './harness';
import {
  pdfSurface,
  personPdfSurface,
  personScreenSurface,
  screenSurface,
  type Line,
} from './surfaces';

const COUNT = Number(process.env.SWEEP_COUNT ?? 2000);
/**
 * The widowed corpus runs at a quarter of the main one. It is a separate
 * generator with its own index space (see `households.ts`), and its surfaces
 * carry a fifth of the sentences, so the same coverage costs far fewer runs.
 */
const WIDOWED_COUNT = Number(process.env.SWEEP_WIDOWED_COUNT ?? Math.ceil(COUNT / 4));
const MODES: DollarsMode[] = ['real', 'nominal'];

/** Both corpora. Every copy invariant below runs over all of them. */
const corpus = () => sweepCorpus(COUNT, WIDOWED_COUNT);

beforeAll(() => vi.stubGlobal('fetch', stubLifeTableFetch()));
afterAll(() => vi.unstubAllGlobals());

/**
 * Patterns that are never intentional in rendered prose. Each is here because
 * a defect of that exact shape reached a surface, or because the type that
 * produces it (`string | null`, `number | null`) is live in the copy layer
 * today.
 */
const SENTINELS: { name: string; re: RegExp }[] = [
  { name: 'undefined', re: /\bundefined\b/ },
  { name: 'null', re: /\bnull\b/ },
  { name: 'NaN', re: /NaN/ },
  { name: 'Infinity', re: /Infinity/ },
  { name: 'object Object', re: /\[object/ },
  // "beginning at age — —": an em dash where a value belongs. A spaced em
  // dash is legitimate punctuation; two in a row, or one straight after a
  // word that introduces a value, is a hole where a figure should be.
  { name: 'double em dash', re: /—\s*—/ },
  { name: 'em dash as value', re: /\b(age|at|of|to)\s+—/ },
  { name: 'empty currency', re: /\$(?![\d(])/ },
  { name: 'double space', re: /\S {2,}\S/ },
  { name: 'space before punctuation', re: / [.,;%]/ },
  { name: 'empty parens', re: /\(\s*\)/ },
  { name: 'doubled punctuation', re: /[.,]{2,}/ },
  // "62 years, 1 months". Every year/month label in the app interpolates a
  // bare plural, and 62y1m is the EARLIEST claim age — the single most
  // commonly recommended filing age there is.
  { name: 'plural of one', re: /\b1 (months|years)\b/ },
];

/**
 * Duplicates the sweep found, reported to the user and awaiting a decision on
 * WHICH copy to drop — a page-design call, not a mechanical one. Listed by the
 * pair of sources that render the same sentence, so any NEW duplicate still
 * fails while these two stay visible rather than silently suppressed.
 *
 * See `docs/reference/invariant-sweep.md` §Parked.
 */
const PARKED_DUPLICATES: [string, string][] = [
  // The PDF renders the identical spousal paragraph twice on one physical
  // page: once in the household section, once in the methodology appendix
  // that `ReportDocument` places on that same page for a married report.
  ['pdf/HouseholdSection.spousalSummary', 'pdf/MethodologyAppendix.spousalSummary'],
  // On screen, `spousalMethodologyCopy` embeds `survivorGapNote`, and the
  // combined-income chart on the same scrolling page renders it too.
  ['CombinedIncomeChart.survivorGapNote', 'Analyzer.spousalMethodologyCopy'],
];

const isParked = (a: string, b: string) =>
  PARKED_DUPLICATES.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

/** Splits prose into sentences for the duplicate check. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Whole sentences appearing twice on one surface. Short fragments are not the
 * defect — a repeated "These are in today's dollars." clause is deliberate
 * single-sourcing — so this only reports substantial sentences.
 */
function duplicatesIn(lines: Line[]): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const line of lines) {
    for (const sentence of sentences(line.text)) {
      if (sentence.length < 60) continue;
      const previous = seen.get(sentence);
      if (previous) {
        if (!isParked(previous, line.source)) {
          out.push(`"${sentence}" — rendered by both ${previous} and ${line.source}`);
        }
      } else {
        seen.set(sentence, line.source);
      }
    }
  }
  return out;
}

describe('rendered copy', () => {
  it(`carries no sentinel or empty substitution across ${COUNT} + ${WIDOWED_COUNT} households`, async () => {
    const findings: Finding[] = [];

    for (const { index, household, label } of corpus()) {
      const analysis = await analyze(household);

      for (const mode of MODES) {
        const lines = [
          ...screenSurface(analysis, mode),
          ...pdfSurface(analysis),
          // Each person's own tab and page, which no household surface
          // covers — see `personScreenSurface`.
          ...analysis.people.flatMap((_, i) => [
            ...personScreenSurface(analysis, i),
            ...personPdfSurface(analysis, i),
          ]),
        ];
        for (const line of lines) {
          for (const { name, re } of SENTINELS) {
            if (re.test(line.text)) {
              findings.push({
                index,
                label,
                detail: `[${mode}] ${line.source} — ${name}: "${line.text}"`,
              });
            }
          }
        }
      }
    }

    console.log(summarize('copy sentinels', findings));
    expect(findings).toEqual([]);
  });

  it(`repeats no sentence within one surface across ${COUNT} + ${WIDOWED_COUNT} households`, async () => {
    const findings: Finding[] = [];

    for (const { index, household, label } of corpus()) {
      const analysis = await analyze(household);

      for (const mode of MODES) {
        for (const dup of duplicatesIn(screenSurface(analysis, mode))) {
          findings.push({ index, label, detail: `[screen/${mode}] ${dup}` });
        }
      }
      for (const dup of duplicatesIn(pdfSurface(analysis))) {
        findings.push({ index, label, detail: `[pdf] ${dup}` });
      }
      // Per person, never pooled: one reader sees one tab and one page.
      analysis.people.forEach((_, i) => {
        for (const dup of duplicatesIn(personScreenSurface(analysis, i))) {
          findings.push({ index, label, detail: `[person ${i}/screen] ${dup}` });
        }
        for (const dup of duplicatesIn(personPdfSurface(analysis, i))) {
          findings.push({ index, label, detail: `[person ${i}/pdf] ${dup}` });
        }
      });
    }

    console.log(summarize('duplicate sentences on one surface', findings));
    expect(findings).toEqual([]);
  });
});

/**
 * Sentences both surfaces render, keyed by the component that renders each.
 * In REAL dollars the two must be byte-identical: the PDF hardcodes 'real'
 * and the screen defaults to it, and both read the same analysis.
 *
 * This is the invariant the on-screen spousal top-up broke once, when
 * `Analyzer.tsx` called the engine directly and got a person-A-anchored
 * figure while the PDF stayed lower-earner-anchored — $0 on screen and a
 * positive figure in print, for the same household.
 *
 * Only sentences COMPUTED per household are listed. `COMBINED_INCOME_SUBTITLE`
 * and `INCOME_CLIFF_HEADING` are shared constants, and `surfaces.ts` reads the
 * constant for both surfaces — comparing them here would compare a value to
 * itself and could never fail, whatever the components did. Their real risk is
 * a component hardcoding a literal instead of importing the constant, which
 * this model cannot see and which is not worth pretending to check.
 */
const SHARED: [screen: string, pdf: string][] = [
  ['StrategyComparisonTable.householdValueCaption', 'pdf/HouseholdSection.householdValueCaption'],
  ['StrategyComparisonTable.survivorIncomeCaption', 'pdf/HouseholdSection.survivorIncomeCaption'],
  ['CombinedIncomeChart.combinedIncomeCaption', 'pdf/HouseholdSection.combinedIncomeCaption'],
  ['CombinedIncomeChart.survivorGapNote', 'pdf/HouseholdSection.survivorGapNote'],
  ['CombinedIncomeChart.survivorFloorNote', 'pdf/HouseholdSection.survivorFloorNote'],
  ['IncomeCliffCallout.incomeCliffSentence', 'pdf/HouseholdSection.incomeCliffSentence'],
  ['SurvivorClaimNote.survivorClaimNote', 'pdf/HouseholdSection.survivorClaimNote'],
];

/**
 * The widowed pair. Every sentence on that page is computed per household —
 * there are no shared constants to compare against themselves — so all five
 * are here.
 *
 * `piaEstimateNote` is the one worth naming: it is null unless the deceased's
 * PIA was recovered from a check amount, so most households compare absent to
 * absent. The generator reaches both (see `households.sweep.ts`).
 */
const WIDOWED_SHARED: [screen: string, pdf: string][] = [
  ['WidowedPanel.recommendation', 'pdf/WidowedSection.recommendation'],
  ['WidowedPanel.recommendationDetail', 'pdf/WidowedSection.recommendationDetail'],
  ['WidowedPanel.widowedLifetimeCaption', 'pdf/WidowedSection.widowedLifetimeCaption'],
  ['CombinedIncomeChart.widowedIncomeCaption', 'pdf/WidowedSection.widowedIncomeCaption'],
  ['WidowedPanel.piaEstimateNote', 'pdf/WidowedSection.piaEstimateNote'],
];

describe('screen and print agree', () => {
  it(`state the same sentences in real dollars across ${COUNT} + ${WIDOWED_COUNT} households`, async () => {
    const findings: Finding[] = [];

    for (const { index, household, label } of corpus()) {
      // Single claimants have no shared household page at all; married and
      // widowed each have their own pair list.
      if (household.status === 'single') continue;
      const analysis = await analyze(household);
      const pairs = household.status === 'widowed' ? WIDOWED_SHARED : SHARED;

      const screen = new Map(screenSurface(analysis, 'real').map((l) => [l.source, l.text]));
      const pdf = new Map(pdfSurface(analysis).map((l) => [l.source, l.text]));

      // Each person's tab against their own printed page.
      analysis.people.forEach((_, i) => {
        const onScreen = personScreenSurface(analysis, i);
        const inPrint = personPdfSurface(analysis, i);
        if (onScreen.length !== inPrint.length) {
          findings.push({
            index,
            label,
            detail: `person ${i}: ${onScreen.length} screen lines vs ${inPrint.length} in print`,
          });
          return;
        }
        onScreen.forEach((line, n) => {
          if (line.text !== inPrint[n].text) {
            findings.push({
              index,
              label,
              detail: `person ${i} ${line.source}:\n  "${line.text}"\n  "${inPrint[n].text}"`,
            });
          }
        });
      });

      for (const [screenKey, pdfKey] of pairs) {
        const a = screen.get(screenKey);
        const b = pdf.get(pdfKey);
        // Absent on both is agreement — the section renders on neither.
        if (a === undefined && b === undefined) continue;
        if (a === undefined || b === undefined) {
          findings.push({
            index,
            label,
            detail: `${screenKey} ${a === undefined ? 'absent' : 'present'} but ${pdfKey} ${b === undefined ? 'absent' : 'present'}`,
          });
          continue;
        }
        if (a !== b) {
          findings.push({ index, label, detail: `${screenKey} != ${pdfKey}:\n  "${a}"\n  "${b}"` });
        }
      }
    }

    console.log(summarize('screen vs print', findings));
    expect(findings).toEqual([]);
  });

  it(`names no calculation engine on the analysis surface across ${COUNT} + ${WIDOWED_COUNT} households`, async () => {
    // One assertion holding a twenty-site cleanup in place. The engine is
    // named once, in the About panel, and linked twice from Resources — both
    // outside the analysis surface these two builders cover. A parenthetical
    // creeping back onto a heading is the realistic regression, and asserting
    // each of the twenty sites individually would not catch a twenty-first.
    const findings: Finding[] = [];

    for (const { index, household, label } of corpus()) {
      const analysis = await analyze(household);

      for (const mode of MODES) {
        for (const line of [...screenSurface(analysis, mode), ...pdfSurface(analysis)]) {
          if (/ssa\.tools/i.test(line.text)) {
            findings.push({ index, label, detail: `[${mode}] ${line.source}: "${line.text}"` });
          }
        }
      }
    }

    console.log(summarize('engine brand on the analysis surface', findings));
    expect(findings).toEqual([]);
  });
});

describe('branch reachability', () => {
  it(`reports which copy branches and comparison rows ${COUNT} households reach`, async () => {
    const strategyKeys = new Set<string>();
    const branches = new Set<string>();
    let married = 0;

    for (let index = 0; index < COUNT; index++) {
      const { household } = householdAt(index);
      const analysis = await analyze(household);
      if (analysis.status === 'married') married++;

      for (const c of analysis.comparisons) strategyKeys.add(c.key);

      const mark = (name: string, value: unknown) => branches.add(`${name}:${value}`);
      mark('survivorGap', analysis.survivorGap ? 'set' : 'null');
      mark('survivorFloor', analysis.survivorFloor ? 'set' : 'null');
      mark('spousalTopUp', analysis.spousalTopUp ? 'present' : 'absent');
      if (analysis.spousalTopUp) {
        const s = analysis.spousalTopUp;
        mark('spousalTopUp.startsAtSpouseAge', s.startsAtSpouseAge === null ? 'null' : 'dated');
        mark('spousalTopUp.lowerEarnerLabel', s.lowerEarnerLabel === null ? 'null(tie)' : 'named');
        mark('spousalTopUp.atFra', s.atFra > 0 ? 'positive' : 'zero');
      }
      mark('survivorClaim', analysis.survivorClaim ? 'present' : 'null');
      if (analysis.survivorClaim) {
        mark(
          'survivorClaim.baselineHasSurvivorBand',
          analysis.survivorClaim.baselineHasSurvivorBand,
        );
      }
      if (analysis.survivorGap) {
        const g = analysis.survivorGap;
        mark('survivorGap.survivorOwnMonthly', g.survivorOwnMonthly === null ? 'null' : 'amount');
        mark('survivorGap.survivorUnder60', g.survivorUnder60);
      }

      const cliff = incomeCliff(analysis);
      mark('incomeCliff', cliff ? 'present' : 'null');
      if (cliff) mark('incomeCliff.dropPercent', cliff.dropPercent > 0 ? 'falls' : 'flat');
      mark(
        'survivorIncome',
        analysis.comparisons.some((c) => c.survivorIncome != null) ? 'some' : 'none',
      );
      for (const band of analysis.periods) mark('band.type', band.type);
    }

    console.log(
      `Reachability over ${COUNT} households (${married} married):\n` +
        `  strategy row keys reached: ${[...strategyKeys].sort().join(', ')}\n` +
        [...branches]
          .sort()
          .map((b) => `  ${b}`)
          .join('\n'),
    );

    // Every comparison row the table can display is reachable by SOME
    // household — including `earliest`, which for the whole life of this
    // assertion was reachable by none.
    //
    // It used to pin that as a PARKED DEFECT: `buildComparisons` asked
    // `findStrategyByAges` for exactly `{years: 62, months: 0}`, SSA
    // entitlement needs a full month at 62, so the engine's grid starts at
    // 62y1m and the row was silently dropped by `if (!match) continue`.
    // `resolveScenario` now reads both extremes off the engine's own
    // attainable ages, so the row resolves for every household — and for
    // someone already past 62, whose floor is higher still.
    //
    // The pin is inverted rather than deleted: a regression that drops
    // `earliest` again would otherwise be invisible, which is exactly how it
    // went unnoticed the first time.
    expect([...strategyKeys].sort()).toEqual(['earliest', 'fra', 'latest', 'optimal']);
  });

  it(`reports which widowed branches ${WIDOWED_COUNT} households reach`, async () => {
    // Its own test rather than a widening of the one above: that assertion
    // pins the `earliest` row as UNREACHABLE, which is a deliberate tripwire,
    // and folding a second corpus into it would change what the pin means.
    const strategyKeys = new Set<string>();
    const branches = new Set<string>();

    for (let index = 0; index < WIDOWED_COUNT; index++) {
      const { household } = widowedHouseholdAt(index);
      const analysis = await analyze(household);

      for (const c of analysis.comparisons) strategyKeys.add(c.key);

      const mark = (name: string, value: unknown) => branches.add(`${name}:${value}`);
      mark('piaEstimated', analysis.piaEstimated);
      mark('deceased', analysis.deceased === null ? 'null' : 'present');
      if (analysis.deceased) {
        mark('deceased.filed', analysis.deceased.filed === null ? 'never' : 'dated');
      }
      // The two fields only a widowed row carries. `lifetimeTotal` is the
      // discriminator both surfaces branch on before naming the money column,
      // and `survivorClaimDate` is the second of the two dates — without it
      // `survivorFirst` and `ownFirst` differ only by their label.
      for (const c of analysis.comparisons) {
        mark('row.lifetimeTotal', c.lifetimeTotal === null ? 'null' : 'set');
        mark('row.survivorClaimDate', c.survivorClaimDate === null ? 'null' : 'set');
      }
      mark('filingAgeOptions', analysis.filingAgeOptions.every((o) => o.length === 0) ? 'empty' : 'offered');
      for (const band of analysis.periods) mark('band.type', band.type);
      mark('periods', analysis.periods.length === 0 ? 'none' : 'some');
    }

    console.log(
      `Widowed reachability over ${WIDOWED_COUNT} households:\n` +
        `  strategy row keys reached: ${[...strategyKeys].sort().join(', ')}\n` +
        [...branches].sort().map((b) => `  ${b}`).join('\n'),
    );

    // Every widowed row must carry both widowed-only fields, on every
    // household. A null `lifetimeTotal` would send the display layer down the
    // "this is a present value" branch, which for these rows it is not.
    expect([...branches]).toContain('row.lifetimeTotal:set');
    expect([...branches]).not.toContain('row.lifetimeTotal:null');
    expect([...branches]).not.toContain('row.survivorClaimDate:null');
    // The scenario picker must never be offered one of these households.
    expect([...branches]).toEqual(expect.arrayContaining(['filingAgeOptions:empty']));
    expect([...branches]).not.toContain('filingAgeOptions:offered');
    // And both estimate branches are reached, so `piaEstimateNote` is
    // exercised in each direction rather than being dead one way.
    expect([...branches]).toEqual(
      expect.arrayContaining(['piaEstimated:true', 'piaEstimated:false']),
    );
  });
});
