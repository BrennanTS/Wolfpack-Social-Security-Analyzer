import { describe, expect, it } from 'vitest';
import {
  ADVISER_LAYOUT,
  BLOCKS,
  CLIENT_LAYOUT,
  DEFAULT_LAYOUT_ID,
  PRESETS,
  layoutBlockIds,
  layoutRuns,
  SPACE,
  spaceIgnored,
  omittedBlocks,
  blockScope,
  parseLayout,
  parseLayoutFile,
  serializeLayout,
  type LayoutItem,
  type ReportBlockId,
  type ReportLayout,
} from './reportLayout';

describe('presets', () => {
  it('name a default that exists', () => {
    expect(PRESETS.map((p) => p.id)).toContain(DEFAULT_LAYOUT_ID);
  });

  it('only reference blocks that exist', () => {
    const known = new Set(BLOCKS.map((b) => b.id));
    for (const preset of PRESETS) {
      for (const id of layoutBlockIds(preset)) expect(known).toContain(id);
    }
  });

  it('never repeat a block', () => {
    for (const preset of PRESETS) {
      const ids = layoutBlockIds(preset);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gives the client strictly less than the adviser', () => {
    // The whole point of two presets: one is the short one. If they drift to
    // the same content the picker stops meaning anything.
    const client = new Set(layoutBlockIds(CLIENT_LAYOUT));
    const adviser = new Set(layoutBlockIds(ADVISER_LAYOUT));
    expect(client.size).toBeLessThan(adviser.size);
    for (const id of client) expect(adviser).toContain(id);
  });

  it('offers the adviser every block there is', () => {
    expect(new Set(layoutBlockIds(ADVISER_LAYOUT))).toEqual(new Set(BLOCKS.map((b) => b.id)));
  });
});

describe('layoutRuns', () => {
  it('keeps everything after the cover on shared pages', () => {
    // This is the white-space fix: five small blocks used to be five sheets.
    // The cover is the one block that earns a sheet of its own.
    const runs = layoutRuns(CLIENT_LAYOUT, 'twoClaimants');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual(['cover']);
    expect(runs[1].length).toBeGreaterThan(4);
  });

  it('starts a new run at each break', () => {
    const runs = layoutRuns(ADVISER_LAYOUT, 'twoClaimants');
    expect(runs.length).toBe(5);
    expect(runs[2][0]).toBe('household');
  });

  it('drops blocks that say nothing about this household', () => {
    // `survivor` is about a couple; a single claimant has no survivor.
    expect(layoutRuns(CLIENT_LAYOUT, 'oneClaimant').flat()).not.toContain('survivor');
    expect(layoutRuns(CLIENT_LAYOUT, 'twoClaimants').flat()).toContain('survivor');
  });

  it('never yields an empty run, however many blocks were skipped', () => {
    // A break stranded between two skipped blocks would otherwise become a
    // page with a footer and nothing above it — the blank page the old fixed
    // sequence printed for widowed households.
    for (const shape of ['oneClaimant', 'twoClaimants', 'widowed'] as const) {
      for (const preset of PRESETS) {
        for (const run of layoutRuns(preset, shape)) expect(run.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives a widowed household only what applies to it', () => {
    const ids = layoutRuns(ADVISER_LAYOUT, 'widowed').flat();
    expect(ids).not.toContain('answer');
    expect(ids).not.toContain('household');
    // The intro's questions are about two living claimants choosing.
    expect(ids).not.toContain('intro');
    // A cover and the honesty page apply to anyone.
    expect(ids).toContain('cover');
    expect(ids).toContain('limits');
    expect(ids).toContain('terms');
  });
});

describe('spaces', () => {
  const items = (...list: LayoutItem[]) => ({ id: 'x', name: 'x', items: list });
  const space: LayoutItem = { kind: 'space' };
  const brk: LayoutItem = { kind: 'break' };
  const block = (id: ReportBlockId): LayoutItem => ({ kind: 'block', id });

  it('cannot be mistaken for a block', () => {
    // Runs are a flat list of ids and spaces. A block id equal to the space
    // marker would print as a gap and vanish from the report.
    expect(BLOCKS.map((b) => b.id)).not.toContain(SPACE);
  });

  it('travels in the run, between the blocks it separates', () => {
    const runs = layoutRuns(items(block('answer'), space, block('terms')), 'twoClaimants');
    expect(runs).toEqual([['answer', SPACE, 'terms']]);
  });

  it('stacks, because that is how a bigger gap is asked for', () => {
    const runs = layoutRuns(items(block('answer'), space, space, block('terms')), 'twoClaimants');
    expect(runs[0]).toEqual(['answer', SPACE, SPACE, 'terms']);
  });

  it('is trimmed at both ends of a page, where the margin already sits', () => {
    const runs = layoutRuns(
      items(space, block('answer'), space, brk, space, block('terms'), space),
      'twoClaimants',
    );
    expect(runs).toEqual([['answer'], ['terms']]);
  });

  it('is trimmed when the block beside it is dropped for this household', () => {
    // `survivor` says nothing to a single claimant. The space that separated
    // it would otherwise be left first in the run, padding a margin.
    const layout = items(block('survivor'), space, block('terms'));
    expect(layoutRuns(layout, 'twoClaimants')[0]).toEqual(['survivor', SPACE, 'terms']);
    expect(layoutRuns(layout, 'oneClaimant')[0]).toEqual(['terms']);
  });

  it('never makes a page of its own', () => {
    // Spaces around a block that this household does not get would leave a
    // run holding nothing but gaps — a sheet carrying a footer and air.
    const runs = layoutRuns(items(block('terms'), brk, space, block('survivor'), space), 'oneClaimant');
    expect(runs).toEqual([['terms']]);
  });

  it('survives export and import', () => {
    const layout = items(block('answer'), space, space, block('terms'));
    expect(parseLayoutFile(serializeLayout(layout))?.items).toEqual(layout.items);
  });

  it('is dropped by import where a page edge would eat it anyway', () => {
    const parsed = parseLayout({
      items: [space, block('answer'), space, brk, space, block('terms'), space],
    });
    expect(parsed?.items).toEqual([block('answer'), brk, block('terms')]);
  });

  it('is not recoverable on its own', () => {
    expect(parseLayout({ items: [space, space] })).toBeNull();
  });
});

describe('spaceIgnored', () => {
  const space: LayoutItem = { kind: 'space' };
  const brk: LayoutItem = { kind: 'break' };
  const block = (id: ReportBlockId): LayoutItem => ({ kind: 'block', id });

  it('says nothing about anything that is not a space', () => {
    expect(spaceIgnored([block('answer')], 0, 'twoClaimants')).toBeNull();
  });

  it('passes a space that has a block on either side', () => {
    expect(spaceIgnored([block('answer'), space, block('terms')], 1, 'twoClaimants')).toBeNull();
  });

  it('flags one against a page edge, break or end of report', () => {
    expect(spaceIgnored([space, block('answer')], 0, 'twoClaimants')).toBe('edge');
    expect(spaceIgnored([block('answer'), space], 1, 'twoClaimants')).toBe('edge');
    expect(spaceIgnored([block('answer'), space, brk, block('terms')], 1, 'twoClaimants')).toBe(
      'edge',
    );
  });

  it('flags one whose only neighbor prints for another household', () => {
    // The adviser sees why it does nothing here without exporting to find out.
    expect(spaceIgnored([block('survivor'), space, block('terms')], 1, 'oneClaimant')).toBe('edge');
  });

  it('flags one between two per-person sections, which travel together', () => {
    expect(
      spaceIgnored([block('personDetails'), space, block('personRamp')], 1, 'twoClaimants'),
    ).toBe('person');
  });

  it('passes one between a person section and a household block', () => {
    expect(
      spaceIgnored([block('personDetails'), space, block('terms')], 1, 'twoClaimants'),
    ).toBeNull();
  });
});

describe('omittedBlocks', () => {
  it('lists exactly what the layout leaves out', () => {
    const omitted = omittedBlocks(CLIENT_LAYOUT).map((b) => b.id);
    const included = layoutBlockIds(CLIENT_LAYOUT);
    expect(omitted).toHaveLength(BLOCKS.length - included.length);
    for (const id of omitted) expect(included).not.toContain(id);
  });

  it('is empty for a layout holding everything', () => {
    expect(omittedBlocks(ADVISER_LAYOUT)).toHaveLength(0);
  });
});

describe('round trip', () => {
  it('survives export and import unchanged', () => {
    const back = parseLayoutFile(serializeLayout(ADVISER_LAYOUT));
    expect(back).toEqual(ADVISER_LAYOUT);
  });

  it('accepts a bare layout object as well as a wrapped file', () => {
    // A teammate pasting just the layout out of a file should still work.
    expect(parseLayout(JSON.parse(JSON.stringify(CLIENT_LAYOUT)))?.items).toEqual(
      CLIENT_LAYOUT.items,
    );
  });
});

describe('parseLayout repairs rather than trusts', () => {
  const items = (layout: ReportLayout | null) => layout?.items ?? [];

  it('returns null for things that are not layouts at all', () => {
    for (const junk of [null, undefined, 42, 'layout', {}, { items: 'nope' }, []]) {
      expect(parseLayout(junk)).toBeNull();
    }
  });

  it('drops a block id this version does not know, keeping the rest', () => {
    // A colleague on a newer build must not hand you a file you cannot open.
    const layout = parseLayout({
      name: 'From the future',
      items: [{ kind: 'block', id: 'answer' }, { kind: 'block', id: 'tax-page' }],
    });
    expect(items(layout)).toEqual([{ kind: 'block', id: 'answer' }]);
  });

  it('drops a repeated block, which would print its content twice', () => {
    const layout = parseLayout({
      items: [
        { kind: 'block', id: 'answer' },
        { kind: 'block', id: 'answer' },
        { kind: 'block', id: 'terms' },
      ],
    });
    expect(items(layout)).toEqual([
      { kind: 'block', id: 'answer' },
      { kind: 'block', id: 'terms' },
    ]);
  });

  it('collapses doubled breaks and trims them from both ends', () => {
    // A leading break puts a blank page at the front of the report; two in a
    // row put one in the middle.
    const layout = parseLayout({
      items: [
        { kind: 'break' },
        { kind: 'block', id: 'answer' },
        { kind: 'break' },
        { kind: 'break' },
        { kind: 'block', id: 'terms' },
        { kind: 'break' },
      ],
    });
    expect(items(layout)).toEqual([
      { kind: 'block', id: 'answer' },
      { kind: 'break' },
      { kind: 'block', id: 'terms' },
    ]);
  });

  it('returns null when nothing recoverable is left', () => {
    expect(parseLayout({ items: [{ kind: 'block', id: 'nope' }, { kind: 'break' }] })).toBeNull();
  });

  it('supplies a name and id when the file has none', () => {
    const layout = parseLayout({ items: [{ kind: 'block', id: 'answer' }] });
    expect(layout?.name).toBeTruthy();
    expect(layout?.id).toBeTruthy();
  });

  it('caps a pathological name rather than letting it into the picker', () => {
    const layout = parseLayout({ name: 'x'.repeat(500), items: [{ kind: 'block', id: 'answer' }] });
    expect(layout?.name.length).toBeLessThanOrEqual(60);
  });

  it('does not throw on malformed json', () => {
    expect(parseLayoutFile('{not json')).toBeNull();
    expect(parseLayoutFile('')).toBeNull();
  });
});

describe('person-scoped blocks', () => {
  it('marks exactly the per-person blocks', () => {
    const person = BLOCKS.filter((b) => b.scope === 'person').map((b) => b.id);
    expect(person).toEqual([
      'personDetails',
      'personComparison',
      'personCumulative',
      'personBreakeven',
      'personHeatmap',
      'personOpportunity',
      'personRamp',
    ]);
    expect(blockScope('terms')).toBe('household');
    expect(blockScope('personRamp')).toBe('person');
  });

  it('lets the detail card be kept while the charts are dropped', () => {
    // The point of the split: the profile and recommendation are what an
    // adviser keeps for a client, and four of the charts are what they cut.
    const layout = parseLayout({
      items: [{ kind: 'block', id: 'personDetails' }, { kind: 'block', id: 'personBreakeven' }],
    });
    expect(layoutBlockIds(layout!)).toEqual(['personDetails', 'personBreakeven']);
  });

  it('expands a layout saved before the split, rather than dropping its person pages', () => {
    // `people` was one block. A saved layout naming it must not come back
    // silently missing every person page.
    const layout = parseLayout({
      items: [{ kind: 'block', id: 'answer' }, { kind: 'block', id: 'people' }],
    });
    expect(layoutBlockIds(layout!)).toEqual([
      'answer',
      'personDetails',
      'personComparison',
      'personCumulative',
      'personBreakeven',
      'personHeatmap',
      'personOpportunity',
      'personRamp',
    ]);
  });

  it('does not duplicate a block the legacy expansion already added', () => {
    const layout = parseLayout({
      items: [{ kind: 'block', id: 'personRamp' }, { kind: 'block', id: 'people' }],
    });
    const ids = layoutBlockIds(layout!);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
