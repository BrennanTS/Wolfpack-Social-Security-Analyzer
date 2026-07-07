import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'ssa-migraine-mode';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function applyMigraineMode(active: boolean): void {
  document.documentElement.dataset.migraine = active ? 'true' : 'false';
  document.documentElement.style.colorScheme = active ? 'dark' : 'light';

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', active ? '#0e0e0e' : '#f7f5f0');
  }
}

export function useMigraineMode() {
  const [migraineMode, setMigraineMode] = useState(readStored);

  useEffect(() => {
    applyMigraineMode(migraineMode);
    try {
      localStorage.setItem(STORAGE_KEY, String(migraineMode));
    } catch {
      /* storage unavailable */
    }
  }, [migraineMode]);

  const toggleMigraineMode = useCallback(() => {
    setMigraineMode((on) => !on);
  }, []);

  return { migraineMode, toggleMigraineMode };
}

if (typeof document !== 'undefined') {
  applyMigraineMode(readStored());
}
