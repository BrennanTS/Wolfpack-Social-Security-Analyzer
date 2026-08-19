import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pdf } from '@react-pdf/renderer';
import { analyzeHousehold, type Household } from '../../lib/household';
import type { Person } from '../../lib/personAnalysis';
import { buildMethodPairs, MethodologyAppendix, ReportDocument } from './ReportDocument';
import { WidowedSection } from './WidowedSection';
import { HouseholdSection } from './HouseholdSection';
import { PersonSection } from './PersonSection';
import { unprintableInPdf } from '../../lib/pdfSafeText';

/**
 * Durable smoke coverage for the whole PDF pipeline (Task 20's five-module
 * split, ultimately rendered through `pdf()`). `@react-pdf/renderer`
 * failures often only surface at render time — a bad SVG prop, a missing
 * style key, a `NaN` slipped into a chart scale — none of which `tsc` or
 * `oxlint` would catch. This exercises both report shapes end to end so a
 * regression here fails `npm run test`, not just a one-off manual check.
 *
 * Fixture values (`dan`/`sarah`, `asOf`, `assumptions`) mirror
 * `household.test.ts` exactly, rather than inventing new ones.
 */

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public');

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

const asOf = new Date(2026, 0, 15);
const assumptions = { annualCola: 2.5, discountRate: 0.025 };

const dan: Person = {
  id: 'a', name: 'Dan', birthYear: 1962, birthMonth: 4,
  gender: 'male', piaMonthly: 2400, lifeExpectancy: 85,
};
const sarah: Person = {
  id: 'b', name: 'Sarah', birthYear: 1964, birthMonth: 2,
  gender: 'female', piaMonthly: 2100, lifeExpectancy: 88,
};

/**
 * jsdom's `Blob` polyfill has no `arrayBuffer()`/`text()`, so read it back
 * via `FileReader` instead — supported in jsdom and sufficient for the
 * best-effort page-count scrape below.
 */
function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsBinaryString(blob);
  });
}

/**
 * Best-effort page count from the PDF's `/Pages` object. PDFKit (which
 * react-pdf renders through) deflates each page's *content* stream but
 * leaves the object structure — including `/Type /Pages /Count N` — as
 * plain text, so this is a cheap, if informal, way to check the document
 * isn't empty or wildly over/under-paginated. Not a substitute for a real
 * PDF parser; only used here for a sanity bound.
 */
function pdfPageCount(text: string): number {
  const match = text.match(/\/Type\s*\/Pages[\s\S]{0,80}?\/Count\s+(\d+)/);
  return match ? Number(match[1]) : NaN;
}

describe('ReportDocument renders', () => {
  it('renders a single-claimant report without throwing, as one growing section', async () => {
    const household: Household = { status: 'single', people: [dan] };
    const analysis = await analyzeHousehold(household, assumptions, asOf);

    const blob = await pdf(<ReportDocument analysis={analysis} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);

    const pageCount = pdfPageCount(await readBlobAsText(blob));
    // A single claimant's PersonSection carries everything the old 3-page
    // report held (no household page to share the load), so it commonly
    // overflows onto more than one physical page — but shouldn't run away.
    expect(pageCount).toBeGreaterThanOrEqual(1);
    expect(pageCount).toBeLessThan(10);
  });

  it('renders a married-household report without throwing, with more pages than a single', async () => {
    const household: Household = { status: 'married', people: [dan, sarah] };
    const analysis = await analyzeHousehold(household, assumptions, asOf);

    const blob = await pdf(<ReportDocument analysis={analysis} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);

    const pageCount = pdfPageCount(await readBlobAsText(blob));
    expect(pageCount).toBeGreaterThanOrEqual(2);
    expect(pageCount).toBeLessThan(15);

    // Married adds a whole extra household section (recommendation, strategy
    // table, combined income chart) on top of two full person sections, so
    // it should always page out longer than the single-claimant report.
    const singleAnalysis = await analyzeHousehold(
      { status: 'single', people: [dan] },
      assumptions,
      asOf,
    );
    const singleBlob = await pdf(<ReportDocument analysis={singleAnalysis} />).toBlob();
    const singlePageCount = pdfPageCount(await readBlobAsText(singleBlob));
    expect(pageCount).toBeGreaterThan(singlePageCount);
  });

  /**
   * The rendered element tree's text. `readBlobAsText` sees only the
   * compressed PDF stream, so a `toContain` against it silently passes for
   * any string at all — the same walk `HouseholdSection.test.tsx` uses.
   */
  function collectText(node: unknown): string[] {
    if (node === null || node === undefined || typeof node === 'boolean') return [];
    if (typeof node === 'string' || typeof node === 'number') return [String(node)];
    if (Array.isArray(node)) return node.flatMap(collectText);
    const element = node as { props?: { children?: unknown } };
    if (typeof element === 'object' && 'props' in element) {
      return collectText(element.props?.children);
    }
    return [];
  }

  const widowedHousehold: Household = {
    status: 'widowed',
    people: [sarah],
    deceased: {
      birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
      record: { kind: 'pia', piaMonthly: 3000, filed: null },
    },
    alreadyClaimed: { survivorSince: null, ownSince: null },
  };

  /**
   * Every character the report prints has to be one the standard-14 fonts
   * carry — see `unprintableInPdf`. This is asserted over the assembled
   * sections rather than a curated list of strings, because the arrow that
   * motivated it lived in a component nobody thought to check.
   *
   * Married and widowed both: they share almost no copy, and the widowed
   * surfaces were written last and reviewed least.
   */
  /**
   * The client-facing pages must not need a glossary.
   *
   * Asserted over the assembled sections rather than a list of strings, for
   * the same reason `unprintableInPdf` is: the sentence that reintroduces a
   * term will be in a component nobody thought to check. The methodology
   * appendix is deliberately exempt — it IS the technical page, and the rule
   * has always been that caveats move there rather than disappear.
   */
  it('keeps the client-facing pages free of terms that need teaching', async () => {
    const married = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );

    const clientPages = [
      collectText(HouseholdSection({ analysis: married, footerText: 'f' })),
      ...married.people.map((rep, i) =>
        collectText(
          PersonSection({
            analysis: rep,
            index: i === 0 ? 0 : 1,
            annualCola: assumptions.annualCola,
            footerText: 'f',
          }),
        ),
      ),
    ]
      .flat()
      .join(' ');

    // Guard: an empty walk would make every assertion below vacuous.
    expect(clientPages.length).toBeGreaterThan(2000);

    for (const term of [
      'present value',
      'optimizer',
      'discounted',
      'mortality-weighted',
      'undiscounted',
      'PIA',
    ]) {
      expect(clientPages, `"${term}" on a client-facing page`).not.toContain(term);
    }
    // "FRA" survives only inside "Full Retirement Age", which is spelled out.
    expect(clientPages).not.toMatch(/\bFRA\b/);
  });

  it('prints no character the standard-14 fonts cannot render', async () => {
    const married = await analyzeHousehold(
      { status: 'married', people: [dan, sarah] },
      assumptions,
      asOf,
    );
    const widowed = await analyzeHousehold(widowedHousehold, assumptions, asOf);

    const surfaces = [
      collectText(HouseholdSection({ analysis: married, footerText: 'f' })),
      // `index` is a 0 | 1 slot, not an arbitrary number — a married
      // household has exactly two people.
      ...married.people.map((rep, i) =>
        collectText(
          PersonSection({
            analysis: rep,
            index: i === 0 ? 0 : 1,
            annualCola: assumptions.annualCola,
            footerText: 'f',
          }),
        ),
      ),
      collectText(MethodologyAppendix({ analysis: married })),
      collectText(WidowedSection({ analysis: widowed, footerText: 'f' })),
      collectText(MethodologyAppendix({ analysis: widowed })),
    ];

    // Guard: an empty walk would make the assertion below vacuous, which is
    // exactly the failure mode this file's own comments warn about.
    const text = surfaces.flat().join(' ');
    expect(text.length).toBeGreaterThan(2000);
    expect(unprintableInPdf(text)).toEqual([]);
  });

  it('prints the widowed report, not the single-claimant one', async () => {
    // `analysis.status === 'married'` is a BOOLEAN test in both this module's
    // call sites (the document's `isMarried`, and `MethodologyAppendix`'s
    // `hasSpouse`), so a widowed analysis used to print a report that never
    // mentions the survivor benefit — the larger half of most widows' income
    // — and carried the single-claimant disclosure note saying so was
    // correct. This used to assert a throw, which was honest while there was
    // no widowed report. Now there is one.
    const analysis = await analyzeHousehold(widowedHousehold, assumptions, asOf);

    // Called as a plain function, like `HouseholdSection.test.tsx` does: an
    // unrendered `<WidowedSection />` element has no children to walk, so a
    // walk over `ReportDocument`'s own tree comes back empty and every
    // `toContain` against it would pass for any string at all.
    const page = collectText(WidowedSection({ analysis, footerText: 'f' })).join(' ');
    // Both dates named, and the money column labelled for what it is.
    expect(page).toContain('Survivor benefit at');
    expect(page).toContain('Own record at');
    expect(page).toContain('Lifetime total');
    expect(page).not.toContain('Combined PV');
    expect(page).toContain('The deceased spouse’s record');

    // Never the single-claimant disclosure, which says survivor benefits are
    // not modeled — on a report built around one.
    const appendix = collectText(MethodologyAppendix({ analysis })).join(' ');
    expect(appendix).not.toContain('neither is modeled for a single claimant');
    expect(appendix).toContain('Both benefits are modeled');

    // Both entry points render without throwing: `MethodologyAppendix` is
    // exported and rendered on its own by HouseholdSection.test.tsx, so a
    // widowed household reaching it directly must work too. Its two
    // claiming-reduction cards are built from `claimingOptions`, which
    // `analyzeWidowed` empties — a `!` there threw on the first export.
    expect(() => ReportDocument({ analysis })).not.toThrow();
    expect(() => MethodologyAppendix({ analysis })).not.toThrow();
  });

  it('replaces the own-record method cards a widow(er) has no use for', async () => {
    const analysis = await analyzeHousehold(widowedHousehold, assumptions, asOf);
    const titles = buildMethodPairs(analysis).flat().map((item) => item.title);

    expect(titles).toContain('Two Independent Dates');
    expect(titles).toContain('Survivor Full Retirement Age');
    // The two they replace quote an age-62 and an age-70 percentage of PIA,
    // which for a widow(er) come from an empty array — `!` on that lookup
    // threw on the first widowed export.
    expect(titles).not.toContain('Early Claiming Reduction');
    expect(titles).not.toContain('Delayed Retirement Credits');
    // And the spousal card, which for a widow(er) named a benefit nobody in
    // this household can receive.
    expect(titles).toContain('Survivor Benefit');
    expect(titles).not.toContain('Spousal Benefit');
  });
});
