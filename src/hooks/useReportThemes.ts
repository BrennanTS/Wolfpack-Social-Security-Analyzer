import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_REPORT_THEME_ID,
  REPORT_THEMES,
  parseTheme,
  reportTheme,
  type ReportTheme,
} from '../lib/reportTheme';

const SAVED_KEY = 'ssa-report-themes';
/** The same key the picker has always used, so an existing choice survives. */
const SELECTED_KEY = 'ssa-report-theme';

/**
 * The adviser's saved themes, and which one the report is printed in.
 *
 * The shape `useReportLayouts` established, for the same reasons: presets
 * stay in code so a later version can improve them, only what someone saved
 * themselves is stored, and a draft lives here rather than in the editor so
 * the export and the preview can never show a different theme from the one
 * on screen.
 */
export function useReportThemes() {
  const [saved, setSaved] = useState<ReportTheme[]>(readSaved);
  const [selectedId, setSelectedId] = useState<string>(readSelected);
  const [draft, setDraft] = useState<ReportTheme | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch {
      /* storage unavailable, or full — see MAX_LOGO_CHARS */
    }
  }, [saved]);

  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_KEY, selectedId);
    } catch {
      /* storage unavailable */
    }
  }, [selectedId]);

  const themes = useMemo(() => [...REPORT_THEMES, ...saved], [saved]);

  const stored = useMemo(
    () => themes.find((t) => t.id === selectedId) ?? reportTheme(DEFAULT_REPORT_THEME_ID),
    [themes, selectedId],
  );

  /** What the report is printed in: the draft if there is one, else what is saved. */
  const theme = useMemo(() => draft ?? stored, [draft, stored]);

  const isPreset = useCallback(
    (id: string) => REPORT_THEMES.some((t) => t.id === id),
    [],
  );

  /** Edit in place for a theme of your own; start a draft for a preset. */
  const change = useCallback(
    (next: ReportTheme) => {
      if (isPreset(next.id)) setDraft(next);
      else setSaved((list) => list.map((t) => (t.id === next.id ? next : t)));
    },
    [isPreset],
  );

  const saveAs = useCallback((name: string, from: ReportTheme) => {
    const next: ReportTheme = {
      ...from,
      id: `theme-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim().slice(0, 60) || 'Untitled theme',
      blurb: from.blurb || 'Saved by you',
    };
    setSaved((list) => [...list, next]);
    setSelectedId(next.id);
    setDraft(null);
    return next;
  }, []);

  const rename = useCallback(
    (id: string, name: string) => {
      if (isPreset(id)) return;
      setSaved((list) =>
        list.map((t) => (t.id === id ? { ...t, name: name.trim().slice(0, 60) || t.name } : t)),
      );
    },
    [isPreset],
  );

  const remove = useCallback(
    (id: string) => {
      if (isPreset(id)) return;
      setSaved((list) => list.filter((t) => t.id !== id));
      setSelectedId((current) => (current === id ? DEFAULT_REPORT_THEME_ID : current));
      setDraft(null);
    },
    [isPreset],
  );

  const importTheme = useCallback((incoming: ReportTheme) => {
    const next: ReportTheme = {
      ...incoming,
      id: `theme-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    setSaved((list) => [...list, next]);
    setSelectedId(next.id);
    setDraft(null);
    return next;
  }, []);

  /** Picking another theme abandons the draft — it belonged to the other one. */
  const select = useCallback((id: string) => {
    setDraft(null);
    setSelectedId(id);
  }, []);

  return {
    themes,
    theme,
    selectedId: theme.id,
    draft,
    setDraft,
    select,
    change,
    isPreset,
    saveAs,
    rename,
    remove,
    importTheme,
  };
}

function readSaved(): ReportTheme[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Through `parseTheme`, not trusted: one bad entry must not cost the rest,
    // and whatever is here reaches the PDF palette.
    return parsed.flatMap((entry) => {
      const theme = parseTheme(entry);
      return theme === null ? [] : [theme];
    });
  } catch {
    return [];
  }
}

function readSelected(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? DEFAULT_REPORT_THEME_ID;
  } catch {
    return DEFAULT_REPORT_THEME_ID;
  }
}
