import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Analyzer } from './Analyzer';
import { ABOUT_CARDS } from '../lib/about';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

function renderAnalyzer() {
  return render(<Analyzer darkMode={false} onToggleDarkMode={vi.fn()} />);
}

function maritalGroup() {
  return screen.getByRole('group', { name: 'Marital status' });
}

// `Analyzer`'s lazy `useState` initializer reads `window.location.search`
// once, at mount — before any strip effect runs — so seeding it via
// `pushState` ahead of `render()` is how a shared-link scenario is driven at
// the component level, same as `?...` in the e2e suite's `page.goto` calls.
afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('Analyzer', () => {
  describe('marital status', () => {
    it('pins the marital-status hint verbatim', () => {
      renderAnalyzer();
      expect(
        screen.getByText(
          'Married optimizes both filing dates jointly. Widowed models the survivor ' +
            'benefit and your own, claimed on separate dates.',
        ),
      ).toBeInTheDocument();
    });

    // Mutating `maritalStatus === 'widowed'` to `maritalStatus !== 'married'`
    // at the `DeceasedFields` call site left 872/872 vitest and 39/39 e2e
    // green, because no test asserted the deceased fields were ABSENT for
    // single or married — only that they appeared for widowed. `!== 'married'`
    // is true for single too (and for the initial `null` state), so this
    // guards the other two branches explicitly.
    it('does not render the deceased fields for a single claimant', async () => {
      renderAnalyzer();
      await userEvent.click(within(maritalGroup()).getByRole('button', { name: 'Single' }));
      expect(document.querySelector('#dec-birth')).toBeNull();
    });

    it('does not render the deceased fields for a married household', async () => {
      renderAnalyzer();
      await userEvent.click(within(maritalGroup()).getByRole('button', { name: 'Married' }));
      expect(document.querySelector('#dec-birth')).toBeNull();
    });

    it('renders the deceased fields for a widowed household', async () => {
      renderAnalyzer();
      await userEvent.click(within(maritalGroup()).getByRole('button', { name: 'Widowed' }));
      expect(document.querySelector('#dec-birth')).not.toBeNull();
    });
  });

  // A complete widowed household now renders its own display (Phase
  // 3B-ii-b). Before that it showed a placeholder, and before THAT the
  // `householdDisplayShape` throw was uncaught: with no error boundary
  // anywhere in the app the entire React tree unmounted — header, settings
  // drawer, every typed value, gone, with no way back short of a reload (the
  // share params are already stripped from the URL).
  //
  // These tests drive the same "complete widowed household" state via a
  // seeded URL (the share-link params) and assert the real display renders,
  // that it is NOT the single-claimant one, and that the two ways the old
  // placeholder gate could have been got wrong stay closed.
  describe('a complete widowed household', () => {
    const WIDOWED_URL =
      '/?ay=1964&am=4&ag=f&ab=1200&le=90&m=w&dy=1960&dm=3&ddy=2024&ddm=1&dk=p&dp=2000&df=0';

    it('renders the widowed display, not the single-claimant one', async () => {
      window.history.pushState({}, '', WIDOWED_URL);
      renderAnalyzer();

      expect(
        await screen.findByTestId('widowed-strategy-table', {}, { timeout: 10000 }),
      ).toBeInTheDocument();

      // Never the single-claimant view: its claiming-age table and its
      // age-62 summary card are the two markers, and the second used to
      // throw outright on a widow's emptied `claimingOptions`.
      expect(screen.queryByTestId('benefit-table')).not.toBeInTheDocument();
      expect(screen.queryByTestId('summary-age62')).not.toBeInTheDocument();
      // Nor the married one.
      expect(screen.queryByTestId('strategy-table')).not.toBeInTheDocument();

      // The rest of the app is intact.
      expect(screen.getByRole('heading', { name: 'Social Security Analyzer' })).toBeInTheDocument();
      expect(screen.getByLabelText(/date of death/i)).toBeInTheDocument();
    });

    it('names both dates, not just the own-record one', async () => {
      window.history.pushState({}, '', WIDOWED_URL);
      renderAnalyzer();

      const title = await screen.findByTestId('recommendation-title', {}, { timeout: 10000 });
      // The defect this whole phase exists to prevent: a widow shown her own
      // retirement benefit alone, with no mention of the survivor benefit
      // that is usually the larger half of her income.
      expect(title).toHaveTextContent(/survivor benefit/i);
      expect(title).toHaveTextContent(/own record/i);
    });

    it('offers Export PDF and Copy Link, which were dead ends before', async () => {
      window.history.pushState({}, '', WIDOWED_URL);
      renderAnalyzer();

      await screen.findByTestId('widowed-strategy-table', {}, { timeout: 10000 });

      expect(screen.getByTestId('export-report')).toBeEnabled();
      expect(screen.getByRole('button', { name: /copy link/i })).toBeEnabled();
    });

    it('drops the spousal methodology block, which contradicts what it just showed', async () => {
      window.history.pushState({}, '', WIDOWED_URL);
      renderAnalyzer();

      await screen.findByTestId('widowed-strategy-table', {}, { timeout: 10000 });
      // `spousalMethodologyCopy` falls back to the single-claimant note,
      // which says survivor benefits are not modeled — on the same screen as
      // a survivor benefit.
      expect(screen.queryByTestId('methodology-spousal')).not.toBeInTheDocument();
    });

    // Clicking Single flips `maritalStatus` SYNCHRONOUSLY, while `analysis`
    // still holds the widowed result until the effect re-runs and
    // `analyzeIfComplete` resolves. Every widowed surface must therefore key
    // off `analysis.status`, never off form state — a render where the two
    // disagree used to unmount the whole tree.
    it('survives switching to Single while the widowed analysis is still held', async () => {
      window.history.pushState({}, '', WIDOWED_URL);
      renderAnalyzer();

      await screen.findByTestId('widowed-strategy-table', {}, { timeout: 10000 });

      await userEvent.click(within(maritalGroup()).getByRole('button', { name: 'Single' }));

      // The tree is still mounted: the header survived that render.
      expect(screen.getByRole('heading', { name: 'Social Security Analyzer' })).toBeInTheDocument();
      expect(within(maritalGroup()).getByRole('button', { name: 'Single' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  /**
   * The plan-to age now drives the recommendation, so where it comes from on
   * a fresh load is a correctness question rather than a convenience one.
   */
  describe('remembering the plan-to age', () => {
    const KEY = 'wolfpack.planToAge.v1';

    function memoryStorage(seed?: unknown): Storage {
      const map = new Map<string, string>();
      if (seed !== undefined) map.set(KEY, JSON.stringify(seed));
      return {
        get length() {
          return map.size;
        },
        clear: () => map.clear(),
        getItem: (k: string) => map.get(k) ?? null,
        key: (i: number) => [...map.keys()][i] ?? null,
        removeItem: (k: string) => map.delete(k),
        setItem: (k: string, v: string) => void map.set(k, v),
      } as Storage;
    }

    /** jsdom here has no `localStorage`, so one is supplied per test. */
    function useStorage(seed?: unknown): Storage {
      const store = memoryStorage(seed);
      Object.defineProperty(window, 'localStorage', {
        value: store,
        configurable: true,
        writable: true,
      });
      return store;
    }

    const planToLabel = () => screen.getByText(/plan to age/i).textContent ?? '';

    it('starts a fresh form at the remembered age', () => {
      useStorage({ a: 88 });
      window.history.pushState({}, '', '/');
      renderAnalyzer();
      expect(planToLabel()).toContain('88');
    });

    it('starts at the default when nothing has been remembered', () => {
      useStorage();
      window.history.pushState({}, '', '/');
      renderAnalyzer();
      expect(planToLabel()).toContain('95');
    });

    it('lets a shared link win over the remembered age', async () => {
      // The rule this feature exists under. Two people opening one link must
      // see one analysis, and the plan-to age drives the recommendation — a
      // remembered value overriding a link would show the sender and the
      // recipient different filing ages for the same household.
      useStorage({ a: 88 });
      window.history.pushState({}, '', '/?ay=1962&am=4&ag=m&ab=2400&ale=79&m=0');
      renderAnalyzer();
      expect(planToLabel()).toContain('79');
      expect(planToLabel()).not.toContain('88');
    });

    it('does not record an age that a link merely showed', () => {
      // Writing happens in the slider's change handler, not in an effect over
      // the value. An effect would quietly adopt a colleague's assumption the
      // moment their link was opened.
      const store = useStorage();
      window.history.pushState({}, '', '/?ay=1962&am=4&ag=m&ab=2400&ale=79&m=0');
      renderAnalyzer();
      expect(store.getItem(KEY)).toBeNull();
    });

    it('records the age the adviser actually sets', async () => {
      const store = useStorage();
      window.history.pushState({}, '', '/');
      renderAnalyzer();

      const slider = screen.getByLabelText(/plan to age/i);
      fireEvent.change(slider, { target: { value: '81' } });

      expect(JSON.parse(store.getItem(KEY)!)).toEqual({ a: 81 });
    });

    it('survives a DOM with no storage at all', () => {
      // An uncaught throw here would happen inside the state initializer,
      // taking the app down before first paint.
      Object.defineProperty(window, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      window.history.pushState({}, '', '/');
      expect(() => renderAnalyzer()).not.toThrow();
      expect(planToLabel()).toContain('95');
    });
  });

  describe('the About panel', () => {
    /**
     * About and Resources are reached through the right-hand menu now — the
     * header carries only what an adviser touches during a meeting. Routed
     * through a helper so these tests keep asserting drawer behavior rather
     * than turning into assertions about the menu.
     */
    async function openFromMenu(name: RegExp) {
      await userEvent.click(screen.getByRole('button', { name: /^menu$/i }));
      await userEvent.click(screen.getByRole('button', { name }));
    }

    // A completed married household, so the main-surface methodology block
    // actually mounts. A blank form leaves `analysis` null and the whole
    // `.methodology` div never renders — asserting absence against a blank
    // form would pass whether or not the static cards had been moved at all.
    const MARRIED_URL =
      '/?ay=1958&am=6&ag=m&ab=2400&ale=78&by=1968&bm=6&bg=f&bb=1200&ble=90&m=1';

    // A married analysis runs the real ssa.tools couple optimizer, which
    // fetches SSA life-table JSON on demand (`lib/vendor/ssa-tools/life-
    // tables.ts`). jsdom's global `fetch` cannot resolve that relative path
    // to anything, so serve the real files from `public/` instead — the same
    // pattern `household.test.ts` and `ssaTools.test.ts` use to run the real
    // engine without a network.
    beforeAll(() => {
      vi.stubGlobal('fetch', async (url: string) => {
        const contents = await readFile(
          path.join(publicDir, String(url).replace(/^\//, '')),
          'utf8',
        );
        return { ok: true, json: async () => JSON.parse(contents) } as Response;
      });
    });

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    it('opens from the menu and is closed by default', async () => {
      renderAnalyzer();
      expect(screen.queryByRole('heading', { name: 'About' })).not.toBeInTheDocument();
      await openFromMenu(/^about this analysis$/i);
      // Scoped to the panel itself, not a bare page-wide text query — so this
      // cannot pass by matching a same-named heading somewhere else on the
      // page (the main surface briefly carried its own "How This Works"
      // heading before it was retitled to avoid exactly that collision).
      const panel = screen.getByRole('heading', { name: 'About' }).closest('aside') as HTMLElement;
      expect(within(panel).getByText(/How This Works/i)).toBeInTheDocument();
    });

    it('closes when its own close button is used', async () => {
      renderAnalyzer();
      await openFromMenu(/^about this analysis$/i);
      const panel = screen.getByRole('heading', { name: 'About' }).closest('aside') as HTMLElement;
      await userEvent.click(within(panel).getByRole('button', { name: /^close$/i }));
      expect(screen.queryByRole('heading', { name: 'About' })).not.toBeInTheDocument();
    });

    // Both drawers render `.resources-panel.is-open` at the same fixed
    // position and z-index, and the header sits above the backdrop, so both
    // toggles stay clickable while either drawer is open. Held independently,
    // the second drawer paints exactly over the first and closing it reveals
    // the first still sitting there — reading as a drawer that ignored the
    // close. Only one may be open at a time, in both directions.
    it('opens one drawer at a time, whichever was open first', async () => {
      renderAnalyzer();

      await openFromMenu(/^resources$/i);
      expect(screen.getByRole('heading', { name: 'Resources' })).toBeInTheDocument();

      await openFromMenu(/^about this analysis$/i);
      expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Resources' })).not.toBeInTheDocument();

      await openFromMenu(/^resources$/i);
      expect(screen.getByRole('heading', { name: 'Resources' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'About' })).not.toBeInTheDocument();
      // And the menu itself stepped aside rather than stacking on top.
      expect(screen.queryByRole('complementary', { name: 'Menu' })).not.toBeInTheDocument();
    });

    it(
      'no longer renders the static reference cards on the main surface once an analysis exists',
      async () => {
        window.history.pushState({}, '', MARRIED_URL);
        renderAnalyzer();
        // Wait for the real analysis, so the methodology block has actually
        // mounted before checking what it does and doesn't contain. The
        // married couple optimizer runs a real search, so this needs more
        // than vitest's default 5s test timeout.
        await screen.findByTestId('methodology-spousal', {}, { timeout: 10000 });
        // All four cards that moved to About — not just one of them.
        // Checking a single title left a partial regression undetected: a
        // card left behind or reintroduced would pass so long as it wasn't
        // the one title this test happened to check. Sourced from
        // `ABOUT_CARDS` itself so this list cannot drift out of sync with
        // what actually moved.
        for (const card of ABOUT_CARDS) {
          expect(screen.queryByText(card.title)).not.toBeInTheDocument();
        }
        // And the one card that's supposed to stay actually did — an
        // implementation that deleted the spousal card too would otherwise
        // satisfy the absence checks above just as well. Pinned by its heading
        // and its live copy rather than by a "Spousal benefits" label: the
        // label was removed as a stutter under a heading that already says it,
        // so the card's own sentence is what proves it is still on screen.
        expect(screen.getByRole('heading', { name: /spousal benefit/i })).toBeInTheDocument();
        expect(screen.getByTestId('methodology-spousal').textContent).toMatch(/spousal/i);
        // And the label stays gone. It read as a card title when there were
        // five cards; under a heading that already says "spousal benefit" it
        // is the same phrase twice in two lines.
        expect(screen.queryByText('Spousal benefits')).not.toBeInTheDocument();
      },
      15000,
    );

    it(
      "keeps its own heading distinct from About's, even with both visible at once",
      async () => {
        // The main surface's own methodology card used to share the literal
        // heading "How This Works" with the About panel's section of the
        // same name — a real collision once a completed household's card and
        // an opened About panel could both be on screen together.
        window.history.pushState({}, '', MARRIED_URL);
        renderAnalyzer();
        await screen.findByTestId('methodology-spousal', {}, { timeout: 10000 });
        expect(screen.getByRole('heading', { name: /spousal benefit/i })).toBeInTheDocument();

        await openFromMenu(/^about this analysis$/i);
        // Exactly one "How This Works" heading on the page — About's — even
        // with the main surface's own methodology card also rendered.
        expect(screen.getAllByText(/How This Works/i)).toHaveLength(1);
      },
      15000,
    );
  });
});

/**
 * Starting a new client, and hydrating a saved one.
 *
 * `startNewClient` and `applyView` are the same shape of code: a flat list of
 * a dozen setters that has to stay in step with the state above it. Nothing
 * in the type system connects them — a field added to the view and forgotten
 * in the reset compiles, passes every other test, and leaks the previous
 * client's screen into the next one. `setCharts` had to be added to both by
 * hand the day optional-chart visibility started travelling.
 *
 * So these assert the INVARIANT rather than a list of fields, because a list
 * drifts exactly the way the code does: no parameter belonging to one
 * household may survive into the next.
 *
 * The remembered view is the observable. `Analyzer` writes the whole
 * serialized screen to `localStorage` on every edit, which is the same string
 * a copied link and a saved client carry.
 */
describe('the client list', () => {
  it('opens straight from the header, without the menu in the way', async () => {
    // It was two clicks and a drawer behind the menu button, which is where
    // everything an adviser touches once a month lives. This is the one thing
    // in there they reach for between meetings.
    renderAnalyzer();
    await userEvent.click(screen.getByRole('button', { name: /^clients$/i }));
    expect(screen.getByRole('dialog', { name: 'Clients' })).toBeInTheDocument();
    // And the menu was never opened to get there.
    expect(screen.queryByRole('complementary', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('says nothing about a count until there is something saved', () => {
    // The drawer's sentence about how many are saved went with the section.
    // A "0" badge on the button would be that sentence, only harder to read.
    renderAnalyzer();
    expect(screen.getByRole('button', { name: /^clients$/i })).toHaveTextContent(/^Clients$/);
  });
});

describe('starting a new client', () => {
  const KEY = 'ssa-current-view';

  function useStorage(): Storage {
    const map = new Map<string, string>();
    const store = {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k: string) => map.get(k) ?? null,
      key: (i: number) => [...map.keys()][i] ?? null,
      removeItem: (k: string) => map.delete(k),
      setItem: (k: string, v: string) => void map.set(k, v),
    } as Storage;
    Object.defineProperty(window, 'localStorage', {
      value: store,
      configurable: true,
      writable: true,
    });
    return store;
  }

  /** Everything on screen, as the app itself serializes it. */
  function remembered(store: Storage): URLSearchParams {
    const raw = store.getItem(KEY);
    return new URLSearchParams(raw === null ? '' : (JSON.parse(raw) as { params: string }).params);
  }

  /**
   * A household with something set in every corner the reset has to reach:
   * a spouse, hidden claiming rows, optional charts, a switched-off grid
   * target, and the benefit-reduction scenario.
   */
  const RICH =
    '/?ay=1962&am=4&ad=15&ag=m&ab=2400&ale=85&an=John' +
    '&m=1&by=1964&bm=2&bd=15&bg=f&bb=2100&ble=88&bn=Jane' +
    '&pah=63,64&ca=lifetimeHeatmap,monthlyRamp&cb=opportunityCost' +
    '&gt=off&sv=2040-90&cola=3&dr=3';

  it('hydrates every corner of a shared view', async () => {
    // `applyView`'s other half: a field the URL carries but the hydration
    // drops would reopen a client the adviser did not set up.
    const store = useStorage();
    window.history.pushState({}, '', RICH);
    renderAnalyzer();
    await screen.findByTestId('strategy-table', {}, { timeout: 10000 });

    const params = remembered(store);
    expect(params.get('an')).toBe('John');
    expect(params.get('bn')).toBe('Jane');
    expect(params.get('pah')).toBe('63,64');
    expect(params.get('ca')).toBe('lifetimeHeatmap,monthlyRamp');
    expect(params.get('cb')).toBe('opportunityCost');
    expect(params.get('gt')).toBe('off');
    expect(params.get('sv')).toBe('2040-90');
    expect(params.get('cola')).toBe('3');
  }, 20000);

  it('leaves nothing of one household behind in the next', async () => {
    // The whole point. Not a list of fields to keep in step with the reset —
    // an assertion that the reset reached everything the view can carry.
    const store = useStorage();
    window.history.pushState({}, '', RICH);
    renderAnalyzer();
    await screen.findByTestId('strategy-table', {}, { timeout: 10000 });
    const before = [...remembered(store).keys()];
    expect(before.length, 'the rich view should carry a lot').toBeGreaterThan(12);

    await userEvent.click(screen.getByRole('button', { name: 'New client' }));
    // The form has unsaved work, so it asks first.
    await userEvent.click(screen.getByRole('button', { name: /Discard and start new/i }));

    // Nothing remembered at all: an empty form is not a view of its own.
    expect(store.getItem(KEY)).toBeNull();
    expect(screen.getByLabelText('Client date of birth')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'New client' })).toBeDisabled();

    // The assertion that matters, and it has to come AFTER the next
    // household starts. While the form is empty the app remembers nothing at
    // all, so state the reset forgot is invisible — it surfaces the moment
    // an adviser types the next client's name, and then it is in their link
    // and their saved record. Checked by introducing the real drift
    // (removing `setCharts({})` from `startNewClient`): the assertion above
    // stayed green, this one does not.
    await userEvent.type(screen.getByLabelText('Name (optional)'), 'Next');
    const after = remembered(store);
    expect(after.get('an')).toBe('Next');
    for (const leaked of ['ca', 'cb', 'pah', 'paa', 'pbh', 'gt', 'sv', 'bn', 'by', 'bb']) {
      expect(after.get(leaked), `${leaked} survived into the next client`).toBeNull();
    }
    // And the assumptions are back at their defaults rather than the last
    // client's, which a link would otherwise carry silently.
    expect(after.get('cola')).not.toBe('3');
    expect(after.get('dr')).not.toBe('3');
  }, 20000);

  it('asks before discarding, and cancelling changes nothing', async () => {
    const store = useStorage();
    window.history.pushState({}, '', RICH);
    renderAnalyzer();
    await screen.findByTestId('strategy-table', {}, { timeout: 10000 });
    const before = store.getItem(KEY);

    await userEvent.click(screen.getByRole('button', { name: 'New client' }));
    expect(screen.getByText(/Start a new client\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    expect(store.getItem(KEY)).toBe(before);
    // Labelled by the person's NAME once they have one, which is also how a
    // reader knows which of two date fields they are in.
    expect(screen.getByLabelText('John date of birth')).toHaveValue('1962-04-15');
  }, 20000);

  it('cannot be started from an already-empty form', () => {
    // Guarded rather than hidden, so the button's absence never reads as a
    // missing feature — and `requestNewClient` returns early regardless.
    useStorage();
    window.history.pushState({}, '', '/');
    renderAnalyzer();
    expect(screen.getByRole('button', { name: 'New client' })).toBeDisabled();
  });
});

