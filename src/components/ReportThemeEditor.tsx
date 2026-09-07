import { useCallback, useId, useRef, useState } from 'react';
import {
  DEFAULT_DISCLOSURE,
  MAX_DISCLOSURE_CHARS,
  MAX_LOGO_CHARS,
  THEME_COLORS,
  disclosureHasPlaceholder,
  parseThemeFile,
  serializeTheme,
  themeColorWarning,
  type ReportTheme,
} from '../lib/reportTheme';
import { readLogoFile } from '../lib/logoImage';
import type { useReportThemes } from '../hooks/useReportThemes';

/**
 * The palette and the name a report is printed with.
 *
 * Built on the same bones as `ReportLayoutEditor` — a picker, a working area,
 * a row of CRUD buttons — because they are the same job: an adviser arranging
 * what a client is handed. A preset cannot be edited in place; touching one
 * starts a working copy that has to be named, so a firm cannot quietly change
 * what "Wolfpack" means for everyone who picks it.
 *
 * The contrast warnings are advice, not a gate. A firm's own brand color is
 * not ours to reject; printing it without saying it will come out faint is
 * what would be unhelpful.
 */
export function ReportThemeEditor({
  themes,
  theme,
  selectedId,
  draft,
  setDraft,
  select,
  change,
  isPreset,
  saveAs,
  rename,
  remove,
  importTheme,
}: ReturnType<typeof useReportThemes>) {
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const nameFieldId = useId();

  const dirty = draft !== null;
  const editingPreset = isPreset(selectedId);

  /** One field of the theme, edited. */
  const set = useCallback(
    (patch: Partial<ReportTheme>) => {
      change({ ...theme, ...patch });
    },
    [theme, change],
  );

  const onExport = useCallback(() => {
    const blob = new Blob([serializeTheme(theme)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${theme.name.replace(/[^\w -]/g, '').trim() || 'report-theme'}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [theme]);

  const onImportFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const parsed = parseThemeFile(await file.text());
      if (parsed === null) {
        setNote("That file isn't a report theme.");
        return;
      }
      importTheme(parsed);
      setNote(`Imported “${parsed.name}”.`);
    },
    [importTheme],
  );

  const onLogoFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const result = await readLogoFile(file);
      if (result === null) {
        setNote('That image could not be read. PNG, JPEG or WebP, please.');
        return;
      }
      if (result.length > MAX_LOGO_CHARS) {
        setNote('That image is too large to store, even scaled down.');
        return;
      }
      set({ logo: result });
      setNote('Logo added.');
    },
    [set],
  );

  return (
    <div className="theme-editor">
      <div className="layout-picker">
        <label className="layout-picker-label" htmlFor={nameFieldId}>
          Theme
        </label>
        <select
          id={nameFieldId}
          value={selectedId}
          onChange={(e) => {
            setNote(null);
            select(e.target.value);
          }}
        >
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {isPreset(t.id) ? ' (preset)' : ''}
            </option>
          ))}
        </select>
      </div>

      {dirty && (
        <p className="layout-dirty">
          {editingPreset
            ? 'Presets can’t be changed. Save this as your own theme to keep it.'
            : 'Unsaved changes.'}
          <SaveAs
            defaultName={editingPreset ? `${theme.name} (mine)` : theme.name}
            onSave={(name) => {
              saveAs(name, theme);
              setNote(`Saved “${name}”.`);
            }}
          />
        </p>
      )}

      <div className="theme-fields">
        <h3 className="theme-group-heading">Branding</h3>
        {/* The hint sits outside the label deliberately: inside it, every
            field's accessible name would carry its own explanation, and
            "Adviser — a second line under the firm" answers to "firm". */}
        <div className="theme-field">
          <label className="theme-field-label" htmlFor={`${nameFieldId}-firm`}>
            Firm
          </label>
          <input
            id={`${nameFieldId}-firm`}
            type="text"
            value={theme.firm}
            maxLength={80}
            aria-describedby={`${nameFieldId}-firm-hint`}
            onChange={(e) => set({ firm: e.target.value })}
          />
          <span className="theme-field-hint" id={`${nameFieldId}-firm-hint`}>
            Prints on the cover, in the page footer, and in the disclosures.
          </span>
        </div>
        <div className="theme-field">
          <label className="theme-field-label" htmlFor={`${nameFieldId}-adviser`}>
            Adviser
          </label>
          <input
            id={`${nameFieldId}-adviser`}
            type="text"
            value={theme.adviser ?? ''}
            maxLength={80}
            placeholder="Optional"
            aria-describedby={`${nameFieldId}-adviser-hint`}
            onChange={(e) => {
              const next = e.target.value;
              // Absent rather than empty, so an unused line does not print a
              // blank one under the firm.
              set({ adviser: next.trim() === '' ? undefined : next });
            }}
          />
          <span className="theme-field-hint" id={`${nameFieldId}-adviser-hint`}>
            A second line under the firm, on the cover.
          </span>
        </div>

        <div className="theme-field">
          <span className="theme-field-label">Logo</span>
          <div className="theme-logo-row">
            {theme.logo !== undefined && (
              <img className="theme-logo-preview" src={theme.logo} alt="" />
            )}
            <button type="button" onClick={() => logoInput.current?.click()}>
              {theme.logo === undefined ? 'Choose image…' : 'Replace…'}
            </button>
            {theme.logo !== undefined && (
              <button type="button" onClick={() => set({ logo: undefined })}>
                Remove
              </button>
            )}
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                void onLogoFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <span className="theme-field-hint">
            Stored inside the theme and scaled down, so it travels with an exported file and
            prints without a network.
          </span>
        </div>

        <h3 className="theme-group-heading">Disclosures</h3>
        <div className="theme-field">
          <label className="theme-field-label" htmlFor={`${nameFieldId}-disclosure`}>
            Printed at the end of the report
          </label>
          <textarea
            id={`${nameFieldId}-disclosure`}
            rows={10}
            value={theme.disclosure}
            maxLength={MAX_DISCLOSURE_CHARS}
            spellCheck
            aria-describedby={`${nameFieldId}-disclosure-hint`}
            onChange={(e) => set({ disclosure: e.target.value })}
          />
          {/* A report with the placeholder still in it would print square
              brackets on a client's copy. Said here, where the text is, rather
              than at export, where there is nothing to be done about it. */}
          {disclosureHasPlaceholder(theme.disclosure) && (
            <span className="theme-field-warning" role="status">
              Replace the text in square brackets with your firm’s own regulatory wording
              before a report goes to a client.
            </span>
          )}
          <span className="theme-field-hint" id={`${nameFieldId}-disclosure-hint`}>
            The wording your compliance review approves, one paragraph per blank line. It
            prints as its own section wherever the layout places it.{' '}
            <button
              type="button"
              className="clients-inline-action"
              onClick={() => set({ disclosure: DEFAULT_DISCLOSURE })}
              disabled={theme.disclosure === DEFAULT_DISCLOSURE}
            >
              Restore the standard wording
            </button>
          </span>
        </div>

        <h3 className="theme-group-heading">Colors</h3>
        <div className="theme-colors">
          {THEME_COLORS.map((field) => {
            const value = theme[field.key];
            const warning = themeColorWarning(field, value);
            return (
              <div key={field.key} className="theme-color">
                <label className="theme-color-main">
                  {/* Two controls, one value: the well is how a color is
                      picked and the text box is how a brand hex is pasted in,
                      which is how a firm's palette actually arrives. */}
                  <input
                    type="color"
                    value={value}
                    aria-label={field.label}
                    onChange={(e) => set({ [field.key]: e.target.value })}
                  />
                  <span className="theme-color-text">
                    <span className="theme-color-name">{field.label}</span>
                    <span className="theme-color-blurb">{field.blurb}</span>
                  </span>
                </label>
                <HexInput
                  label={field.label}
                  value={value}
                  onCommit={(next) => set({ [field.key]: next })}
                />
                {warning !== null && <span className="theme-color-warning">{warning}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="layout-actions">
        <button
          type="button"
          onClick={() => {
            const name = window.prompt('Name for the copy', `${theme.name} copy`);
            if (name === null) return;
            saveAs(name, theme);
            setNote(`Saved “${name}”.`);
          }}
        >
          Duplicate
        </button>
        <button type="button" onClick={onExport}>
          Export…
        </button>
        <button type="button" onClick={() => fileInput.current?.click()}>
          Import…
        </button>
        {!editingPreset && (
          <>
            <button
              type="button"
              onClick={() => {
                const name = window.prompt('Rename theme', theme.name);
                if (name !== null) rename(selectedId, name);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Delete “${theme.name}”?`)) {
                  remove(selectedId);
                  setDraft(null);
                }
              }}
            >
              Delete
            </button>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            void onImportFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {note && <p className="layout-note">{note}</p>}
    </div>
  );
}

/**
 * A hex box that can be typed in.
 *
 * It keeps its own text while it is being edited, because the theme only
 * accepts a complete `#rrggbb`: bound straight to the theme, every keystroke
 * that had not yet formed one would be reverted, and the field could only be
 * pasted into. The text is handed back to the theme's value on blur, so an
 * abandoned half-edit does not sit there looking like the current color.
 */
function HexInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  return (
    <input
      className="theme-color-hex"
      type="text"
      value={editing ? text : value}
      spellCheck={false}
      maxLength={7}
      aria-label={`${label} hex`}
      onFocus={() => {
        setText(value);
        setEditing(true);
      }}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        const next = e.target.value.trim();
        setText(next);
        setEditing(true);
        if (/^#[0-9a-f]{6}$/i.test(next)) onCommit(next.toLowerCase());
      }}
    />
  );
}

/** Name-and-save, inline rather than a prompt so the name can be seen first. */
function SaveAs({ defaultName, onSave }: { defaultName: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(defaultName);
  return (
    <span className="layout-saveas">
      <input
        type="text"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        aria-label="Theme name"
      />
      <button type="button" onClick={() => onSave(name)} disabled={!name.trim()}>
        Save
      </button>
    </span>
  );
}
