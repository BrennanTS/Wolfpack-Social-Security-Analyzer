import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pdf } from '@react-pdf/renderer';
import { analyzeHousehold, type Household } from '../../lib/household';
import type { Person } from '../../lib/personAnalysis';
import { MethodologyAppendix, ReportDocument } from './ReportDocument';

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

  it('refuses a widowed household rather than printing the single-claimant report', async () => {
    // `analysis.status === 'married'` is a BOOLEAN test in both this module's
    // call sites (the document's `isMarried`, and `MethodologyAppendix`'s
    // `hasSpouse`), so a widowed analysis used to print a report that never
    // mentions the survivor benefit — the larger half of most widows' income
    // — and carried the single-claimant disclosure note saying so was
    // correct. There is no widowed report until Phase 3B-ii; failing loudly
    // is the only honest behaviour until there is.
    const household: Household = {
      status: 'widowed',
      people: [sarah],
      deceased: {
        birthYear: 1960, birthMonth: 3, deathYear: 2024, deathMonth: 3,
        record: { kind: 'pia', piaMonthly: 3000, filed: null },
      },
      alreadyClaimed: { survivorSince: null, ownSince: null },
    };
    const analysis = await analyzeHousehold(household, assumptions, asOf);

    // Both entry points, called as plain functions: `MethodologyAppendix` is
    // exported and rendered on its own by HouseholdSection.test.tsx, so a
    // guard only on `ReportDocument` would leave it reachable.
    expect(() => ReportDocument({ analysis })).toThrow(/widowed/i);
    expect(() => MethodologyAppendix({ analysis })).toThrow(/widowed/i);
  });
});
