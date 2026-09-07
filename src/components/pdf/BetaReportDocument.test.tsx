import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from '../../lib/household';
import type { Person } from '../../lib/personAnalysis';
import { BetaReportDocument } from './BetaReportDocument';
import {
  ADVISER_LAYOUT,
  CLIENT_LAYOUT,
  type LayoutItem,
  type ReportLayout,
} from '../../lib/reportLayout';

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
 * Every `<Page>` the document returns.
 *
 * Walks the element tree without a renderer — the same technique
 * `ReportDocument.test.tsx` uses — because the thing under test is which
 * blocks land on which sheet, and that is decided before react-pdf runs.
 */
function pageGroups(node: unknown): unknown[] {
  const found: unknown[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return void n.forEach(walk);
    if (n === null || typeof n !== 'object') return;
    const el = n as { type?: unknown; props?: { children?: unknown } };
    // react-pdf's Page is a host component; its type carries the tag name.
    const type = el.type;
    const name = typeof type === 'string' ? type : (type as { displayName?: string })?.displayName;
    if (name === 'PAGE' || name === 'Page') found.push(n);
    if (el.props?.children !== undefined) walk(el.props.children);
  };
  walk(node);
  return found;
}

/** Every string the document would print. */
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

const build = (analysis: HouseholdAnalysis, layout?: ReportLayout) =>
  BetaReportDocument({ analysis, layout, gridTarget: { on: true, percent: 1 } });

describe('BetaReportDocument composition', () => {
  let married: HouseholdAnalysis;
  let widowed: HouseholdAnalysis;

  beforeAll(async () => {
    married = await analyzeHousehold({ status: 'married', people: [dan, sarah] }, assumptions, asOf);
    widowed = await analyzeHousehold(widowedHousehold, assumptions, asOf);
  });

  it('puts a break-free layout on a single page group', () => {
    // The white-space fix, pinned. The client layout's five blocks used to be
    // five sheets because each block rendered its own `<Page>`; they now share
    // one group and let react-pdf paginate.
    expect(pageGroups(build(married, CLIENT_LAYOUT))).toHaveLength(1);
  });

  it('opens a new page group at each break', () => {
    // Three breaks in the adviser layout, so four groups.
    expect(pageGroups(build(married, ADVISER_LAYOUT))).toHaveLength(4);
  });

  it('prints only the blocks the layout asks for', () => {
    const text = collectText(build(married, CLIENT_LAYOUT)).join(' ');
    expect(text).toContain('Your action plan');
    // The client layout omits the grid and the methodology appendix.
    expect(text).not.toContain('Claiming Age Grid');
    expect(text).not.toContain('Methodology & Assumptions');
  });

  it('follows the order the layout gives, not the order the code declares', () => {
    const reversed: ReportLayout = {
      ...CLIENT_LAYOUT,
      items: [...CLIENT_LAYOUT.items].reverse() as LayoutItem[],
    };
    const text = collectText(build(married, reversed)).join(' ');
    expect(text.indexOf('Your action plan')).toBeLessThan(
      text.indexOf('Your Social Security decision'),
    );
  });

  it('never emits an empty page group, whatever the layout asks for', () => {
    // A break between two blocks that do not apply to this household would
    // otherwise print a sheet carrying nothing but a footer.
    const stranded: ReportLayout = {
      id: 'x',
      name: 'Stranded',
      items: [
        { kind: 'block', id: 'terms' },
        { kind: 'break' },
        { kind: 'block', id: 'survivor' },
        { kind: 'break' },
        { kind: 'block', id: 'household' },
      ],
    };
    // A single claimant has neither a survivor block nor a household one.
    const single = pageGroups(build({ ...married, status: 'single' } as HouseholdAnalysis, stranded));
    expect(single).toHaveLength(1);
  });

  it('gives a widowed household its own section and none of the couple blocks', () => {
    const text = collectText(build(widowed, ADVISER_LAYOUT)).join(' ');
    expect(text).toContain('Words used in this report');
    expect(text).not.toContain('Your Social Security decision');
    expect(text).not.toContain('If one of you is left alone');
  });

  it('prints only the person parts the layout asks for', () => {
    const detailOnly: ReportLayout = {
      id: 'x', name: 'Detail only',
      items: [{ kind: 'block', id: 'personDetails' }],
    };
    const text = collectText(build(married, detailOnly)).join(' ');
    expect(text).toContain('Full Retirement Age');
    // The six charts are separate blocks now, and none was asked for.
    expect(text).not.toContain('Break-Even Analysis');
    expect(text).not.toContain('Lifetime Benefit Heatmap');
    expect(text).not.toContain('Monthly Benefit Ramp');
  });

  it('keeps the report person-major when several person blocks are chosen', () => {
    // Grouped, a couple reads "Dan: these charts, then Sarah: these charts".
    // Rendered a block at a time it would be every chart twice in a row under
    // alternating names, with cards sitting under nobody's heading.
    const twoParts: ReportLayout = {
      id: 'x', name: 'Two parts',
      items: [
        { kind: 'block', id: 'personDetails' },
        { kind: 'block', id: 'personBreakeven' },
      ],
    };
    const text = collectText(build(married, twoParts)).join(' ');
    const dan = text.indexOf('Dan');
    const sarah = text.indexOf('Sarah');
    const firstBreakEven = text.indexOf('Break-Even Analysis');
    const lastBreakEven = text.lastIndexOf('Break-Even Analysis');
    expect(dan).toBeLessThan(sarah);
    // Dan's break-even falls between the two names; Sarah's after hers.
    expect(firstBreakEven).toBeGreaterThan(dan);
    expect(firstBreakEven).toBeLessThan(sarah);
    expect(lastBreakEven).toBeGreaterThan(sarah);
  });

  it('omits the longevity block when the caller did not price it', () => {
    // `sensitivity` is async and computed by the caller; a layout naming the
    // block must not fail the export when it is missing.
    const withLongevity: ReportLayout = {
      id: 'x', name: 'L', items: [{ kind: 'block', id: 'longevity' }, { kind: 'block', id: 'terms' }],
    };
    const text = collectText(
      BetaReportDocument({ analysis: married, layout: withLongevity, sensitivity: null }),
    ).join(' ');
    expect(text).toContain('Words used in this report');
    expect(text).not.toContain('What if we are wrong');
  });
});
