import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, type Household } from '../../src/lib/household';
import { CLIENT_LAYOUT } from '../../src/lib/reportLayout';
import { DEFAULT_REPORT_THEME_ID, reportTheme } from '../../src/lib/reportTheme';
import { ReportDocument } from '../../src/components/pdf/ReportDocument';
import { setActiveReportTheme } from '../../src/components/pdf/theme';
import * as reportCopy from '../../src/components/pdf/reportCopy';
import { stubLifeTableFetch } from './harness';

/** Every string the document would print. Called, not mounted. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((c) => collectText(c, out));
    return out;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  const el = node as { props?: { children?: unknown } };
  if (el.props?.children !== undefined) collectText(el.props.children, out);
  return out;
}

/**
 * Writes three sample client reports to `validation/copy/samples/`.
 *
 * The companion to `copy-schedule.docx`. The schedule proves the WORDING is
 * complete — every sentence each section can print; these show it in context,
 * with the layout, the figures and the disclosures in place. A reviewer needs
 * both: the schedule alone is a list, and a single PDF alone is one
 * household's wording presented as if it were the report's.
 *
 * Three households, chosen to reach copy the others cannot rather than to
 * look representative:
 *
 *  - SINGLE: no spouse, so no survivor section and a four-question
 *    introduction rather than five.
 *  - COUPLE: a real spousal top-up (half the higher earner's benefit exceeds
 *    the lower earner's own), which is the branch that prints the top-up
 *    sentences and the survivor comparison.
 *  - WIDOW: the widow(er)'s limit BINDING. The deceased filed at 62, so his
 *    own benefit was 70% of his full benefit — below the 82.5% floor — and
 *    the survivor is paid $2,145, which is 82.5% of his $2,600 and MORE than
 *    the $1,819 he was receiving. Worth a reviewer's attention because the
 *    figures show a survivor out-earning the deceased with no note beside
 *    them saying why: the explanation is the glossary entry "The widow's
 *    limit" on the terms page. That is structural rather than an oversight
 *    (a widowed household has no deceased band for the survivor's to rise
 *    above, so the contextual note a married report would print has nothing
 *    to attach to), and it is exactly the kind of thing a schedule of
 *    sentences cannot show and a sample report can.
 *
 * Everything uses the CLIENT layout and the shipped default theme, because
 * that is what is being approved. `asOf` is pinned so re-running produces the
 * same reports rather than drifting with the calendar.
 *
 *   npm run copy:samples
 */

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../copy/samples');
const AS_OF = new Date(2026, 0, 15);
const ASSUMPTIONS = { annualCola: 2.5, discountRate: 0.025 };

const single: Household = {
  status: 'single',
  people: [
    {
      id: 'a',
      name: 'John',
      birthYear: 1962,
      birthMonth: 4,
      birthDay: 15,
      gender: 'male',
      piaMonthly: 2400,
      lifeExpectancy: 85,
    },
  ],
};

const couple: Household = {
  status: 'married',
  people: [
    {
      id: 'a',
      name: 'John',
      birthYear: 1962,
      birthMonth: 4,
      birthDay: 15,
      gender: 'male',
      piaMonthly: 2400,
      lifeExpectancy: 85,
    },
    // $900 against John's $2,400: half of his is $1,200, which exceeds her
    // own, so a spousal top-up of $300/mo genuinely applies.
    {
      id: 'b',
      name: 'Jane',
      birthYear: 1964,
      birthMonth: 2,
      birthDay: 15,
      gender: 'female',
      piaMonthly: 900,
      lifeExpectancy: 88,
    },
  ],
};

const widowed: Household = {
  status: 'widowed',
  people: [
    {
      id: 'a',
      name: 'Jane',
      birthYear: 1961,
      birthMonth: 6,
      birthDay: 15,
      gender: 'female',
      piaMonthly: 1500,
      lifeExpectancy: 90,
    },
  ],
  deceased: {
    birthYear: 1960,
    birthMonth: 1,
    birthDay: 15,
    deathYear: 2023,
    deathMonth: 3,
    // Filed at exactly 62, so his own benefit is 70% of his full benefit —
    // below the 82.5% floor, which is what makes the limit bind.
    record: { kind: 'pia', piaMonthly: 2600, filed: { year: 2022, month: 1 } },
  },
  alreadyClaimed: { survivorSince: null, ownSince: null },
} as Household;

interface Sample {
  file: string;
  label: string;
  household: Household;
  /** A string the report must contain, proving this sample earns its place. */
  shows?: string;
  /** Whether the survivor section belongs in this report at all. */
  survivorSection: boolean;
  /** Steps this household's action plan must carry, beyond the common ones. */
  actionSteps?: string[];
}

const SAMPLES: Sample[] = [
  {
    file: 'sample-1-single-claimant.pdf',
    label: 'a single claimant',
    household: single,
    survivorSection: false,
  },
  {
    file: 'sample-2-couple-with-spousal-top-up.pdf',
    label: 'a couple with a spousal top-up',
    household: couple,
    shows: 'spousal',
    survivorSection: true,
    // A couple plans against a death neither has had, in the future tense.
    actionSteps: [reportCopy.ACTION_DEATH_STEP],
  },
  {
    file: 'sample-3-widow-widows-limit-binds.pdf',
    label: 'a widow whose widow’s limit binds',
    household: widowed,
    // The glossary entry that explains the counter-intuitive figures.
    shows: 'The widow’s limit',
    survivorSection: false,
    // A widow(er) claims twice, and the death has already happened, so both
    // of those have to be on the page: the survivor claim as its own dated
    // step, and the death step in the past tense with the lump-sum deadline.
    actionSteps: [reportCopy.ACTION_WIDOWED_DEATH_STEP, 'Claim the survivor benefit'],
  },
];

beforeAll(() => {
  vi.stubGlobal('fetch', stubLifeTableFetch());
  mkdirSync(OUT_DIR, { recursive: true });
});
afterAll(() => vi.unstubAllGlobals());

describe('sample client reports', () => {
  it('writes three PDFs for review', async () => {
    // The shipped default, so the disclosures in these files are the ones an
    // unedited install prints — the same ones the schedule lists.
    setActiveReportTheme(reportTheme(DEFAULT_REPORT_THEME_ID)!);
    const { pdf } = await import('@react-pdf/renderer');

    for (const sample of SAMPLES) {
      const analysis = await analyzeHousehold(sample.household, ASSUMPTIONS, AS_OF);
      const stream = await pdf(
        <ReportDocument analysis={analysis} layout={CLIENT_LAYOUT} />,
      ).toBuffer();
      const chunks: Buffer[] = [];
      for await (const chunk of stream as unknown as AsyncIterable<Buffer>) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);

      // Checked on CONTENT, not on byte count. A near-empty PDF is a valid
      // PDF, and the first version of this guard asserted 20KB purely as a
      // guess — which failed the single-claimant report, a perfectly good
      // four-page document that is simply shorter than a couple's.
      const printed = collectText(
        ReportDocument({ analysis, layout: CLIENT_LAYOUT }),
      ).join(' ');
      for (const required of [
        reportCopy.COVER_TITLE,
        reportCopy.LIMITS_TITLE,
        'not affiliated with, endorsed by, or approved by',
      ]) {
        expect(printed, `${sample.file} is missing: ${required}`).toContain(required);
      }

      // Every household gets an action plan. A widowed report carried none
      // until the compliance samples were built and the page was noticed
      // missing — while the block's own copy was written partly for a
      // widow(er), and the one step with a deadline attached (the $255 lump
      // sum, claimable within two years of the death) reached only the
      // households where nobody had died.
      expect(printed, `${sample.file} is missing the action plan`).toContain(
        reportCopy.ACTION_TITLE,
      );
      for (const step of sample.actionSteps ?? []) {
        expect(printed, `${sample.file} is missing an action step`).toContain(step);
      }

      // Each sample has to demonstrate the thing it was chosen for, or it is
      // a sample of nothing in particular.
      if (sample.shows !== undefined) {
        expect(printed, `${sample.file} does not show ${sample.label}`).toContain(sample.shows);
      }
      // A single claimant has no surviving spouse, so the section must be
      // absent rather than present and empty — the difference between a
      // report that does not apply and one that looks unfinished.
      const message = `${sample.file}: survivor section`;
      if (sample.survivorSection) {
        expect(printed, message).toContain(reportCopy.SURVIVOR_TITLE);
      } else {
        expect(printed, message).not.toContain(reportCopy.SURVIVOR_TITLE);
      }

      writeFileSync(path.join(OUT_DIR, sample.file), bytes);
      console.log(`  ${sample.file} (${sample.label}, ${Math.round(bytes.length / 1024)}KB)`);
    }
  }, 600_000);
});
