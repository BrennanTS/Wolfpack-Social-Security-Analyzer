import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuPanel } from './MenuPanel';
import { REPORT_THEMES, reportTheme } from '../lib/reportTheme';
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

/** A theme store that behaves, for the same reason. */
const stubThemes = (id = 'wolfpack') => ({
  themes: [...REPORT_THEMES],
  theme: reportTheme(id),
  selectedId: id,
  draft: null,
  setDraft: vi.fn(),
  select: vi.fn(),
  change: vi.fn(),
  isPreset: (themeId: string) => REPORT_THEMES.some((t) => t.id === themeId),
  saveAs: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  importTheme: vi.fn(),
});

function renderMenu(overrides: Partial<Parameters<typeof MenuPanel>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    clientCount: 0,
    onOpenClients: vi.fn(),
    themes: stubThemes(),
    onEditTheme: vi.fn(),
    onOpenAbout: vi.fn(),
    onOpenResources: vi.fn(),
    layouts: stubLayouts(),
    onEditLayout: vi.fn(),
    ...overrides,
  };
  render(<MenuPanel {...props} />);
  return props;
}

describe('MenuPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the client list, which is the one section used during a meeting', async () => {
    const props = renderMenu({ clientCount: 3 });
    expect(screen.getByText(/3 saved in this browser/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /open clients/i }));
    expect(props.onOpenClients).toHaveBeenCalled();
  });

  it('says so plainly when nothing has been saved', () => {
    renderMenu({ clientCount: 0 });
    expect(screen.getByText(/nothing saved yet/i)).toBeInTheDocument();
  });

  it('says when the disclosures still carry the firm’s placeholder', () => {
    renderMenu();
    expect(screen.getByRole('status')).toHaveTextContent(/placeholder/i);
  });

  it('says nothing about disclosures a firm has written', () => {
    const themes = stubThemes();
    themes.theme = { ...themes.theme, disclosure: 'Advisory services are offered through Northgate.' };
    renderMenu({ themes });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('names the chosen theme and the firm it prints', () => {
    // The picker itself moved into the dialog; what stays here is enough to
    // tell an adviser which identity the next export carries.
    renderMenu({ themes: stubThemes('midnight') });
    expect(screen.getByText(/“Midnight”/)).toBeInTheDocument();
    expect(screen.getByText(/Wolfpack \| Planning Team/)).toBeInTheDocument();
  });

  it('opens the theme editor rather than holding the picker in the drawer', async () => {
    const props = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /edit theme/i }));
    expect(props.onEditTheme).toHaveBeenCalled();
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
