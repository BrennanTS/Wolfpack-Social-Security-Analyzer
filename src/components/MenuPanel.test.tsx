import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuPanel } from './MenuPanel';
import { REPORT_THEMES } from '../lib/reportTheme';
import { CLIENT_LAYOUT, PRESETS } from '../lib/reportLayout';

/** A layout store that behaves, so these tests stay about the menu. */
const stubLayouts = () => ({
  layouts: [...PRESETS],
  layout: CLIENT_LAYOUT,
  selectedId: CLIENT_LAYOUT.id,
  select: vi.fn(),
  isPreset: (id: string) => PRESETS.some((p) => p.id === id),
  saveAs: vi.fn(),
  update: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  importLayout: vi.fn(),
    draftItems: null,
    setDraftItems: vi.fn(),
});

function renderMenu(overrides: Partial<Parameters<typeof MenuPanel>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    themeId: 'wolfpack',
    onThemeChange: vi.fn(),
    onOpenAbout: vi.fn(),
    onOpenResources: vi.fn(),
    layouts: stubLayouts(),
    onEditLayout: vi.fn(),
    onExportLegacy: vi.fn(),
    exportingLegacy: false,
    canExport: true,
    ...overrides,
  };
  render(<MenuPanel {...props} />);
  return props;
}

describe('MenuPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers every theme, sourced from the theme list itself', () => {
    // From `REPORT_THEMES` rather than a hardcoded list: a theme added to the
    // presets and forgotten in the picker is exactly the failure this guards.
    renderMenu();
    for (const theme of REPORT_THEMES) {
      expect(screen.getByRole('radio', { name: new RegExp(theme.name, 'i') })).toBeInTheDocument();
    }
  });

  it('marks exactly one theme as chosen, and it is the one passed in', () => {
    renderMenu({ themeId: 'midnight' });
    const chosen = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(chosen).toHaveLength(1);
    expect(chosen[0]).toHaveAccessibleName(/midnight/i);
  });

  it('reports the theme the adviser picked', async () => {
    const props = renderMenu();
    await userEvent.click(screen.getByRole('radio', { name: /slate/i }));
    expect(props.onThemeChange).toHaveBeenCalledWith('slate');
  });

  it('says the theme applies to the report and not to the app', () => {
    // An adviser who picks Mono and watches the screen stay bronze should
    // have been told that is what happens, or they will file it as a bug.
    renderMenu();
    const panel = screen.getByRole('heading', { name: 'Menu' }).closest('aside') as HTMLElement;
    expect(within(panel).getByText(/applies to the exported pdf/i)).toBeInTheDocument();
  });

  it('opens the layout editor rather than holding it in the drawer', async () => {
    // Fifteen blocks in a 420px column pushed the palette below the fold.
    const props = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /edit layout/i }));
    expect(props.onEditLayout).toHaveBeenCalled();
    // And the editor itself is not also sitting in here.
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('summarizes the chosen layout, so the drawer still says what will print', () => {
    renderMenu();
    expect(screen.getByText(/“Client”/)).toBeInTheDocument();
    expect(screen.getByText(/section/)).toBeInTheDocument();
  });

  it('offers the legacy report here rather than in the header', async () => {
    // It is on its way out; an adviser reaching for "Export PDF" should land
    // on the current report, not choose between two buttons a few pixels apart.
    const props = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Export legacy PDF' }));
    expect(props.onExportLegacy).toHaveBeenCalled();
  });

  it('will not export the legacy report before the inputs are complete', () => {
    renderMenu({ canExport: false });
    expect(screen.getByRole('button', { name: 'Export legacy PDF' })).toBeDisabled();
  });

  it('closes itself as it hands over to another drawer', async () => {
    // Menu and the panel it opens are both `.resources-panel.is-open` at the
    // same fixed position — left open, the menu would sit under the new panel
    // and reappear when that one closed.
    const props = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /about this analysis/i }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onOpenAbout).toHaveBeenCalled();
  });

  it('renders nothing at all when closed', () => {
    renderMenu({ open: false });
    expect(screen.queryByRole('heading', { name: 'Menu' })).not.toBeInTheDocument();
  });
});
