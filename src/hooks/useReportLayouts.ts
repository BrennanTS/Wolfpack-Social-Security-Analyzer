import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LAYOUT_ID,
  PRESETS,
  parseLayout,
  type ReportLayout,
} from '../lib/reportLayout';

const SAVED_KEY = 'ssa-report-layouts';
const SELECTED_KEY = 'ssa-report-layout-id';

/**
 * The adviser's saved layouts, and which one the report is built from.
 *
 * Presets are not stored — they are code, so a later version can improve them
 * and every adviser gets the improvement. Only layouts someone saved
 * themselves live in storage, which also means a corrupt store costs a
 * custom layout rather than the ability to export at all.
 */
export function useReportLayouts() {
  const [saved, setSaved] = useState<ReportLayout[]>(readSaved);
  const [selectedId, setSelectedId] = useState<string>(readSelected);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch {
      /* storage unavailable */
    }
  }, [saved]);

  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_KEY, selectedId);
    } catch {
      /* storage unavailable */
    }
  }, [selectedId]);

  const all = useMemo(() => [...PRESETS, ...saved], [saved]);

  /**
   * The layout the report is built from.
   *
   * Falls back to a preset rather than to undefined: the id comes from
   * storage and can name a layout since deleted, and an export is the worst
   * moment to discover that.
   */
  const layout = useMemo(
    () => all.find((l) => l.id === selectedId) ?? all.find((l) => l.id === DEFAULT_LAYOUT_ID) ?? PRESETS[0],
    [all, selectedId],
  );

  const isPreset = useCallback((id: string) => PRESETS.some((p) => p.id === id), []);

  /** Save the given items as a new named layout, and select it. */
  const saveAs = useCallback((name: string, items: ReportLayout['items']) => {
    const next: ReportLayout = {
      id: `layout-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim().slice(0, 60) || 'Untitled layout',
      items,
    };
    setSaved((list) => [...list, next]);
    setSelectedId(next.id);
    return next;
  }, []);

  /** Overwrite a saved layout in place. Presets cannot be overwritten. */
  const update = useCallback(
    (id: string, items: ReportLayout['items']) => {
      if (isPreset(id)) return;
      setSaved((list) => list.map((l) => (l.id === id ? { ...l, items } : l)));
    },
    [isPreset],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      if (isPreset(id)) return;
      setSaved((list) =>
        list.map((l) => (l.id === id ? { ...l, name: name.trim().slice(0, 60) || l.name } : l)),
      );
    },
    [isPreset],
  );

  const remove = useCallback(
    (id: string) => {
      if (isPreset(id)) return;
      setSaved((list) => list.filter((l) => l.id !== id));
      setSelectedId((current) => (current === id ? DEFAULT_LAYOUT_ID : current));
    },
    [isPreset],
  );

  /** Add an imported layout under a fresh id, so it cannot collide. */
  const importLayout = useCallback((incoming: ReportLayout) => {
    const next: ReportLayout = {
      ...incoming,
      id: `layout-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    setSaved((list) => [...list, next]);
    setSelectedId(next.id);
    return next;
  }, []);

  return {
    layouts: all,
    layout,
    selectedId: layout.id,
    select: setSelectedId,
    isPreset,
    saveAs,
    update,
    rename,
    remove,
    importLayout,
  };
}

function readSaved(): ReportLayout[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Through `parseLayout`, not trusted: what is in storage was written by
    // an older version of this app, and one bad entry must not cost the rest.
    return parsed.flatMap((entry) => {
      const layout = parseLayout(entry);
      return layout === null ? [] : [layout];
    });
  } catch {
    return [];
  }
}

function readSelected(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? DEFAULT_LAYOUT_ID;
  } catch {
    return DEFAULT_LAYOUT_ID;
  }
}
