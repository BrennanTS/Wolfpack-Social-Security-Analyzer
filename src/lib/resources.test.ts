import { describe, expect, it } from 'vitest';
import { RESOURCE_SECTIONS } from './resources';

const LINKS = RESOURCE_SECTIONS.flatMap((s) => s.links);

/**
 * The Reference panel's links.
 *
 * These are the one place the app sends a reader somewhere else, often to
 * check a figure it produced — so a broken or wrong-looking one costs more
 * than a dead link usually does. What a test can check offline is structure:
 * that every entry is a real absolute https URL, that nothing is duplicated
 * or blank, and that the official sources really are the official domains
 * rather than a lookalike.
 *
 * What it deliberately does NOT check is whether a URL still resolves. That
 * needs the network, and a unit suite that fails because ssa.gov is briefly
 * down is a suite people learn to ignore. Link liveness belongs with the
 * other on-demand network checks (`npm run crosscheck:ssatools`).
 */
describe('the Reference links', () => {
  it('has sections, each with links', () => {
    expect(RESOURCE_SECTIONS.length).toBeGreaterThan(0);
    for (const section of RESOURCE_SECTIONS) {
      expect(section.title.trim(), 'a section needs a title').not.toBe('');
      expect(section.links.length, `${section.title} has no links`).toBeGreaterThan(0);
    }
  });

  it('gives every link a title and a description', () => {
    // The panel renders both. A blank description leaves a title floating
    // over empty space rather than failing visibly.
    for (const link of LINKS) {
      expect(link.title.trim(), link.href).not.toBe('');
      expect(link.description.trim(), link.href).not.toBe('');
    }
  });

  it('uses absolute https URLs, never http or a relative path', () => {
    // These open in a new tab from a page an adviser is presenting. A plain
    // http link is an interstitial warning in front of a client; a relative
    // one silently resolves against this app.
    for (const link of LINKS) {
      expect(link.href, link.title).toMatch(/^https:\/\//);
      expect(() => new URL(link.href), link.title).not.toThrow();
    }
  });

  it('lists no URL twice', () => {
    // A duplicate is the shape a copy-paste edit leaves behind: two titles
    // pointing at the same page, one of which is wrong.
    const hrefs = LINKS.map((l) => l.href);
    expect(new Set(hrefs).size, `duplicates in ${hrefs.join(', ')}`).toBe(hrefs.length);
  });

  it('names each link once', () => {
    const titles = LINKS.map((l) => l.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('points official sources at the official domains', () => {
    // A lookalike domain in a panel headed "Social Security Administration"
    // is the worst link this app could carry. Asserted on the HOST, not on a
    // substring: "ssa.gov.example.com" contains "ssa.gov".
    const official = RESOURCE_SECTIONS.find((s) => /Social Security Administration/i.test(s.title));
    expect(official, 'the SSA section should exist').toBeDefined();
    for (const link of official!.links) {
      expect(new URL(link.href).host, link.title).toMatch(/(^|\.)ssa\.gov$/);
    }
  });

  it('keeps every host to a known reference source', () => {
    // Not a general allowlist of the web: an entry pointing somewhere new is
    // a deliberate act, and this makes it one.
    const allowed = new Set(['www.ssa.gov', 'ssa.gov', 'ssa.tools', 'github.com', 'www.bls.gov']);
    for (const link of LINKS) {
      expect(allowed.has(new URL(link.href).host), `${link.title} -> ${link.href}`).toBe(true);
    }
  });

  it('carries the two sources the report itself cites', () => {
    // `dataVintage` and the methodology appendix name the SSA period life
    // table and BLS CPI-U by URL. A reader following the report to the panel
    // should find them.
    const hrefs = LINKS.map((l) => l.href);
    expect(hrefs).toContain('https://www.ssa.gov/oact/STATS/table4c6.html');
    expect(hrefs).toContain('https://www.bls.gov/cpi/');
  });
});
