import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportThemeEditor } from './ReportThemeEditor';
import { DEFAULT_REPORT_THEME_ID, REPORT_THEMES, reportTheme, type ReportTheme } from '../lib/reportTheme';

const house = () => reportTheme(DEFAULT_REPORT_THEME_ID);

function base() {
  return {
    themes: [...REPORT_THEMES] as ReportTheme[],
    theme: house(),
    selectedId: house().id,
    draft: null as ReportTheme | null,
    setDraft: vi.fn(),
    select: vi.fn(),
    change: vi.fn(),
    isPreset: (id: string) => REPORT_THEMES.some((t) => t.id === id),
    saveAs: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    importTheme: vi.fn(),
  };
}

const store = (overrides: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...overrides });

/**
 * Renders against a store that really holds the edit.
 *
 * The theme being edited lives in the hook, not the component — that is what
 * makes the preview and the export show the same thing — so a stub with a
 * frozen `theme` would never re-render and every assertion about a changed
 * field would be about nothing.
 */
function Harness(props: ReturnType<typeof store>) {
  const [stored, setTheme] = useState(props.theme);
  const [draft, setDraft] = useState(props.draft);
  // What the hook does: a draft, if there is one, is what is being edited.
  const theme = draft ?? stored;
  return (
    <ReportThemeEditor
      {...props}
      theme={theme}
      draft={draft}
      selectedId={theme.id}
      change={(next) => {
        props.change(next);
        setTheme(next);
        if (props.isPreset(next.id)) setDraft(next);
      }}
      setDraft={setDraft}
    />
  );
}

const renderEditor = (s: ReturnType<typeof store> = store()) => render(<Harness {...s} />);

describe('ReportThemeEditor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edits the firm the report is printed under', async () => {
    const s = store();
    renderEditor(s);
    const firm = screen.getByRole('textbox', { name: /firm/i });
    await userEvent.clear(firm);
    await userEvent.type(firm, 'Northgate');
    expect(s.change).toHaveBeenLastCalledWith(expect.objectContaining({ firm: 'Northgate' }));
  });

  it('drops an adviser line that is left empty', async () => {
    // Absent rather than blank, so an unused line does not print an empty one
    // under the firm on the cover.
    const s = store({ theme: { ...house(), adviser: 'Dana Whitfield' } });
    renderEditor(s);
    await userEvent.clear(screen.getByRole('textbox', { name: /adviser/i }));
    expect(s.change).toHaveBeenLastCalledWith(expect.objectContaining({ adviser: undefined }));
  });

  it('offers a well and a hex box for every color a theme has', () => {
    // The well is how a color is picked; the box is how a firm's brand hex is
    // pasted in, which is how a palette actually arrives.
    renderEditor();
    expect(screen.getByLabelText('Brand')).toHaveAttribute('type', 'color');
    expect(screen.getByLabelText('Brand hex')).toHaveValue('#8f6d2c');
  });

  it('can be typed in, and only commits a complete hex', async () => {
    // Bound straight to the theme, every keystroke short of a full #rrggbb
    // would be reverted and the field could only be pasted into.
    const s = store();
    renderEditor(s);
    const hex = screen.getByLabelText('Brand hex');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#1f4');
    expect(hex).toHaveValue('#1f4');
    expect(s.change).not.toHaveBeenCalled();
    await userEvent.type(hex, 'e79');
    expect(s.change).toHaveBeenLastCalledWith(expect.objectContaining({ brand: '#1f4e79' }));
  });

  it('puts the current color back when a half-typed one is abandoned', async () => {
    const s = store();
    renderEditor(s);
    const hex = screen.getByLabelText('Brand hex');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#1f4');
    await userEvent.tab();
    expect(hex).toHaveValue('#8f6d2c');
  });

  it('warns when a color will print faint, without refusing it', async () => {
    // A firm's own brand color is not ours to reject; printing it without
    // saying it will come out washed out is what would be unhelpful.
    renderEditor(store({ theme: { ...house(), muted: '#cccccc' } }));
    expect(screen.getByText(/below 4\.5:1/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Muted hex')).toHaveValue('#cccccc');
  });

  it('will not write an edit back into a preset', async () => {
    const s = store();
    renderEditor(s);
    await userEvent.type(screen.getByRole('textbox', { name: /firm/i }), '!');
    expect(screen.getByText(/presets can’t be changed/i)).toBeInTheDocument();
  });

  it('saves an edited preset under a new name', async () => {
    const s = store({ draft: { ...house(), firm: 'Northgate' } });
    renderEditor(s);
    await userEvent.clear(screen.getByLabelText(/theme name/i));
    await userEvent.type(screen.getByLabelText(/theme name/i), 'Northgate');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(s.saveAs).toHaveBeenCalledWith('Northgate', expect.objectContaining({ firm: 'Northgate' }));
  });

  it('offers rename and delete only for a theme of your own', () => {
    renderEditor();
    expect(screen.queryByRole('button', { name: /rename/i })).not.toBeInTheDocument();
    const mine: ReportTheme = { ...house(), id: 'mine', name: 'Mine' };
    renderEditor(store({ theme: mine, selectedId: 'mine', themes: [...REPORT_THEMES, mine] }));
    expect(screen.getByRole('button', { name: /rename/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('offers to remove a logo only once there is one', () => {
    renderEditor();
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument();
    renderEditor(store({ theme: { ...house(), logo: 'data:image/png;base64,iVBORw0KGgo=' } }));
    expect(screen.getByRole('button', { name: /^remove$/i })).toBeInTheDocument();
  });
});
