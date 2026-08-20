import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuPanel } from './MenuPanel';
import { REPORT_THEMES } from '../lib/reportTheme';

function renderMenu(overrides: Partial<Parameters<typeof MenuPanel>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    themeId: 'wolfpack',
    onThemeChange: vi.fn(),
    onOpenAbout: vi.fn(),
    onOpenResources: vi.fn(),
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
