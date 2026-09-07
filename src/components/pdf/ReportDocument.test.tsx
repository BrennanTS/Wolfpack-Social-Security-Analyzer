import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from '../../lib/household';
import type { Person } from '../../lib/personAnalysis';
import { ReportDocument } from './ReportDocument';
import {
  ADVISER_LAYOUT,
  CLIENT_LAYOUT,
  type LayoutItem,
  type ReportLayout,
} from '../../lib/reportLayout';
import { setActiveReportTheme, styles } from './theme';
import { DEFAULT_REPORT_THEME_ID, reportTheme } from '../../lib/reportTheme';

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

/**
 * Every gap the layout's space items put on the page.
 *
 * Counted by the style object itself rather than by height, so the gap can be
 * retuned without rewriting the tests that say where it lands.
 */
function spacers(node: unknown, out: unknown[] = []): unknown[] {
  return byStyle(node, styles.spacer, out);
}

/** The zero-height markers that report page numbers to the preview. */
function markers(node: unknown, out: unknown[] = []): unknown[] {
  return byStyle(node, styles.pageMark, out);
}

function byStyle(node: unknown, style: unknown, out: unknown[]): unknown[] {
  if (Array.isArray(node)) {
    node.forEach((c) => byStyle(c, style, out));
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  const el = node as { props?: { style?: unknown; children?: unknown } };
  if (el.props?.style === style) out.push(node);
  if (el.props?.children !== undefined) byStyle(el.props.children, style, out);
  return out;
}

const build = (analysis: HouseholdAnalysis, layout?: ReportLayout) =>
  ReportDocument({ analysis, layout, gridTarget: { on: true, percent: 1 } });

describe('ReportDocument composition', () => {
  let married: HouseholdAnalysis;
  let widowed: HouseholdAnalysis;

  beforeAll(async () => {
    married = await analyzeHousehold({ status: 'married', people: [dan, sarah] }, assumptions, asOf);
    widowed = await analyzeHousehold(widowedHousehold, assumptions, asOf);
  });

  it('puts a break-free layout on a single page group', () => {
    // The white-space fix, pinned. Small blocks used to be a sheet each
    // because each rendered its own `<Page>`; they now share one group and
    // let react-pdf paginate.
    const breakFree: ReportLayout = {
      ...CLIENT_LAYOUT,
      items: CLIENT_LAYOUT.items.filter((i) => i.kind === 'block' && i.id !== 'cover'),
    };
    expect(pageGroups(build(married, breakFree))).toHaveLength(1);
  });

  it('opens a new page group at each break', () => {
    // Four breaks in the adviser layout, so five groups.
    expect(pageGroups(build(married, ADVISER_LAYOUT))).toHaveLength(5);
  });

  it('prints the document title once, on the first sheet after the cover', () => {
    // A cover carries the title already; the running header on the same page
    // would print it twice.
    const doc = build(married, CLIENT_LAYOUT);
    const groups = pageGroups(doc);
    const coverText = collectText(groups[0]).join(' ');
    const nextText = collectText(groups[1]).join(' ');
    expect(coverText.match(/Social Security Claiming Analysis/g)).toHaveLength(1);
    expect(nextText).toContain('Social Security Claiming Analysis');
  });

  it('opens on a cover that names the household and the firm', () => {
    const text = collectText(build(married, CLIENT_LAYOUT)).join(' ');
    expect(text).toContain('Prepared for');
    expect(text).toContain('Dan and Sarah');
    expect(text).toContain('Prepared by');
  });

  it('tells the client where the report stops', () => {
    const text = collectText(build(married, CLIENT_LAYOUT)).join(' ');
    expect(text).toContain('What this report does not include');
    expect(text).toContain('Taxes');
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

  it('prints a gap where the layout asks for a space', () => {
    const spaced: ReportLayout = {
      id: 'x', name: 'Spaced',
      items: [
        { kind: 'block', id: 'answer' },
        { kind: 'space' },
        { kind: 'block', id: 'terms' },
      ],
    };
    expect(spacers(build(married, spaced))).toHaveLength(1);
  });

  it('prints one gap per space, so two mean twice as much room', () => {
    const spaced: ReportLayout = {
      id: 'x', name: 'Spaced twice',
      items: [
        { kind: 'block', id: 'answer' },
        { kind: 'space' },
        { kind: 'space' },
        { kind: 'block', id: 'terms' },
      ],
    };
    expect(spacers(build(married, spaced))).toHaveLength(2);
  });

  it('drops a space between two per-person blocks, which print together', () => {
    // Honoring it would mean splitting the person group, which is what makes
    // the report person-major. The editor says so on the row instead.
    const spaced: ReportLayout = {
      id: 'x', name: 'Person spaced',
      items: [
        { kind: 'block', id: 'personDetails' },
        { kind: 'space' },
        { kind: 'block', id: 'personBreakeven' },
      ],
    };
    const doc = build(married, spaced);
    expect(spacers(doc)).toHaveLength(0);
    const text = collectText(doc).join(' ');
    expect(text.indexOf('Break-Even Analysis')).toBeLessThan(text.indexOf('Sarah'));
  });

  it('never lets a space alone hold a page', () => {
    const spaced: ReportLayout = {
      id: 'x', name: 'Stranded space',
      items: [
        { kind: 'block', id: 'terms' },
        { kind: 'break' },
        { kind: 'space' },
        { kind: 'block', id: 'survivor' },
        { kind: 'space' },
      ],
    };
    const single = pageGroups(build({ ...married, status: 'single' } as HouseholdAnalysis, spaced));
    expect(single).toHaveLength(1);
    expect(spacers(single)).toHaveLength(0);
  });

  it('reports which page each block landed on, when asked', async () => {
    // Which sheet a block ends up on is decided by the layout pass, not by
    // the list — a long table above moves everything after it. The preview
    // has no other way to ask, so this is rendered for real rather than
    // walked: the page numbers only exist once react-pdf has paginated.
    const { pdf } = await import('@react-pdf/renderer');
    const landed = new Map<string, number>();
    const layout: ReportLayout = {
      id: 'x', name: 'Paged',
      items: [
        { kind: 'block', id: 'cover' },
        { kind: 'break' },
        { kind: 'block', id: 'answer' },
        { kind: 'block', id: 'terms' },
      ],
    };
    await pdf(
      <ReportDocument
        analysis={married}
        layout={layout}
        onBlockPage={(id, page) => landed.set(id, page)}
      />,
    ).toBuffer();
    expect(landed.get('cover')).toBe(1);
    expect(landed.get('answer')).toBe(2);
    // Both on the second sheet, in order — not that it matters which, only
    // that a block never reports a page before the one before it.
    expect(landed.get('terms')!).toBeGreaterThanOrEqual(landed.get('answer')!);
  }, 30000);

  it('renders no markers at all for the export', () => {
    // The marker exists to answer the preview. An exported file carries
    // nothing that was put there for the editor's benefit.
    expect(markers(build(married, CLIENT_LAYOUT))).toHaveLength(0);
    expect(
      markers(ReportDocument({ analysis: married, layout: CLIENT_LAYOUT, onBlockPage: () => {} })),
    ).not.toHaveLength(0);
  });

  it('prints the firm from the active theme, not a constant', () => {
    // The firm is part of the theme so that one install can serve two
    // advisers. It has to reach the cover, the running footer and the
    // disclosures, which are three different files.
    setActiveReportTheme({
      ...reportTheme(DEFAULT_REPORT_THEME_ID),
      firm: 'Northgate Wealth',
      adviser: 'Dana Whitfield',
    });
    try {
      const full: ReportLayout = {
        id: 'x', name: 'Full',
        items: [
          { kind: 'block', id: 'cover' },
          { kind: 'block', id: 'terms' },
          { kind: 'block', id: 'methodology' },
        ],
      };
      const text = collectText(build(married, full)).join(' ');
      expect(text).toContain('Northgate Wealth');
      expect(text).toContain('Dana Whitfield');
      expect(text).not.toContain('Wolfpack');
    } finally {
      setActiveReportTheme(reportTheme(DEFAULT_REPORT_THEME_ID));
    }
  });

  it('leaves the adviser line off the cover when there is none', () => {
    const cover: ReportLayout = { id: 'x', name: 'Cover', items: [{ kind: 'block', id: 'cover' }] };
    const text = collectText(build(married, cover)).join(' ');
    expect(text).toContain('Wolfpack | Planning Team');
    // Nothing between the firm and the end but the firm itself.
    expect(text.trim().endsWith('Wolfpack | Planning Team')).toBe(true);
  });

  it('omits the longevity block when the caller did not price it', () => {
    // `sensitivity` is async and computed by the caller; a layout naming the
    // block must not fail the export when it is missing.
    const withLongevity: ReportLayout = {
      id: 'x', name: 'L', items: [{ kind: 'block', id: 'longevity' }, { kind: 'block', id: 'terms' }],
    };
    const text = collectText(
      ReportDocument({ analysis: married, layout: withLongevity, sensitivity: null }),
    ).join(' ');
    expect(text).toContain('Words used in this report');
    expect(text).not.toContain('What if we are wrong');
  });
});
