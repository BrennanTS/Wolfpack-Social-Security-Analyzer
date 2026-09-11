import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeHousehold, type Household, type HouseholdAnalysis } from '../../lib/household';
import { WidowedSection } from './WidowedSection';
import { WIDOWED_COMPARISON_HEADING, WIDOWED_DECEASED_HEADING } from '../widowedCopy';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public');

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
});
afterAll(() => vi.unstubAllGlobals());

/** Every string this page would print. Called, not mounted, like its siblings. */
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

const printed = (analysis: HouseholdAnalysis) =>
  collectText(WidowedSection({ analysis, footerText: 'f' })).join(' ');

const asOf = new Date(2026, 0, 15);
const assumptions = { annualCola: 2.5, discountRate: 0.025 };

/**
 * A widow(er) whose deceased spouse HAD filed, before their own FRA — the
 * case where the widow's limit can bind.
 */
function widowed(overrides: Partial<Household> = {}): Household {
  return {
    status: 'widowed',
    people: [
      {
        id: 'a',
        name: 'Jane',
        birthYear: 1961,
        birthMonth: 5,
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
      record: { kind: 'pia', piaMonthly: 2600, filed: { year: 2022, month: 1 } },
    },
    alreadyClaimed: { survivorSince: null, ownSince: null },
    ...overrides,
  } as Household;
}

/**
 * The widowed report page.
 *
 * The least-trodden path in the app and the most complex in the domain: two
 * independent claiming dates, a survivor benefit the vendored engine does not
 * model natively, and the widow's limit. The golden fixtures cover the ENGINE
 * for these households thoroughly — and the rendered page sat at 6.7%,
 * because the Playwright form driver cannot enter a widowed household at all
 * (it only clicks Married or Single), so nothing reached this file end to
 * end. Everything below is what that combination left unguarded.
 */
describe('the widowed report page', () => {
  let analysis: HouseholdAnalysis;

  beforeAll(async () => {
    analysis = await analyzeHousehold(widowed(), assumptions, asOf);
  });

  it('renders without a household the single-claimant page would need', () => {
    // `analyzeWidowed` deliberately empties `claimingOptions`; a page built
    // around it would throw or print a table of nothing.
    expect(() => printed(analysis)).not.toThrow();
    expect(analysis.people[0].claimingOptions).toHaveLength(0);
  });

  it('names the survivor, not "Client"', () => {
    expect(printed(analysis)).toContain('Jane');
  });

  it('shows both claiming dates, which is the whole shape of this decision', () => {
    // A widow(er) chooses twice: when to take the survivor benefit and when
    // to take their own. A page showing one age is describing a different
    // decision.
    const text = printed(analysis);
    expect(text).toContain(WIDOWED_COMPARISON_HEADING);
    const rows = analysis.comparisons;
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      if (row.survivorClaimDate !== null) expect(text).toContain(row.survivorClaimDate.age);
      expect(text).toContain(row.filingAges[0].label);
    }
  });

  it('prints the lifetime total, never an expected present value', () => {
    // `lifetimeTotal` is an undiscounted sum and `expectedNpv` is not an NPV
    // for these households — calling one the other is the exact shape of
    // defect this project has shipped repeatedly.
    const text = printed(analysis);
    for (const row of analysis.comparisons) {
      expect(row.lifetimeTotal, 'a widowed row carries a lifetime total').not.toBeNull();
      const shown = Math.round(row.lifetimeTotal!).toLocaleString('en-US');
      expect(text).toContain(shown);
    }
  });

  it('marks exactly one row as the best', () => {
    const text = printed(analysis);
    expect(analysis.comparisons.filter((r) => r.isOptimal)).toHaveLength(1);
    expect(text.split('BEST').length - 1).toBe(1);
  });

  it('describes the deceased, since every figure here depends on them', () => {
    const text = printed(analysis);
    expect(text).toContain(WIDOWED_DECEASED_HEADING);
    // The filing date is what decides whether the widow's limit applies.
    expect(text).toContain('Filed');
    expect(text).toContain('2,600.00');
  });

  it('says "Had not filed" rather than leaving a blank, when they had not', async () => {
    // A blank here reads as missing data. It is a fact, and it changes the
    // answer: an unfiled record means no early-filing reduction to inherit.
    const never = await analyzeHousehold(
      widowed({
        deceased: {
          birthYear: 1960,
          birthMonth: 1,
          birthDay: 15,
          deathYear: 2023,
          deathMonth: 3,
          record: { kind: 'pia', piaMonthly: 2600, filed: null },
        },
      } as Partial<Household>),
      assumptions,
      asOf,
    );
    const text = printed(never);
    expect(text).toContain('Had not filed');
  });

  it('flags a PIA recovered from a check amount as an estimate', async () => {
    // A current check carries every COLA since filing, which the engine's
    // PIA does not — so the recovered figure is in that year's dollars and
    // must not be presented as a known benefit.
    const recovered = await analyzeHousehold(
      widowed({
        deceased: {
          birthYear: 1960,
          birthMonth: 1,
          birthDay: 15,
          deathYear: 2023,
          deathMonth: 3,
          record: { kind: 'checkAmount', monthlyAmount: 1820, filed: { year: 2022, month: 1 } },
        },
      } as Partial<Household>),
      assumptions,
      asOf,
    );
    expect(recovered.piaEstimated).toBe(true);
    expect(printed(recovered).toLowerCase()).toContain('estimate');
  });

  it('carries the appendix when one is placed on it', () => {
    const withAppendix = collectText(
      WidowedSection({
        analysis,
        footerText: 'f',
        appendix: 'THE-APPENDIX' as unknown as React.ReactNode,
      }),
    ).join(' ');
    expect(withAppendix).toContain('THE-APPENDIX');
  });

  it('prints every character its fonts can render', async () => {
    // The standard-14 fonts stop past Latin-1 and substitute silently. This
    // page assembles strings from four copy modules and the engine.
    const { unprintableInPdf } = await import('../../lib/pdfSafeText');
    expect(unprintableInPdf(printed(analysis))).toEqual([]);
  });
});
