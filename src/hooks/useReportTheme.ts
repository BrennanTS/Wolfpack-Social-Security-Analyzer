import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_REPORT_THEME_ID, reportTheme } from '../lib/reportTheme';

const STORAGE_KEY = 'ssa-report-theme';

function readStored(): string {
  try {
    // Through `reportTheme` rather than trusted as-is: whatever is in storage
    // reaches the PDF palette, and a stale or hand-edited id would otherwise
    // take the export down at the moment an adviser clicks Export.
    return reportTheme(localStorage.getItem(STORAGE_KEY)).id;
  } catch {
    return DEFAULT_REPORT_THEME_ID;
  }
}

/**
 * Which palette the PDF is printed in.
 *
 * Separate from `useDarkMode` on purpose: dark mode is a working preference
 * for the adviser's own screen, and this is a property of the document the
 * client is handed. They are stored apart so neither can drag the other with
 * it.
 */
export function useReportTheme() {
  const [themeId, setThemeId] = useState(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
      /* storage unavailable */
    }
  }, [themeId]);

  const chooseTheme = useCallback((id: string) => {
    setThemeId(reportTheme(id).id);
  }, []);

  return { themeId, chooseTheme };
}
