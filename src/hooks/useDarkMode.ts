import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'ssa-dark-mode';
const LEGACY_KEY = 'ssa-migraine-mode';

function readStored(): boolean {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'true') return true;
    return localStorage.getItem(LEGACY_KEY) === 'true';
  } catch {
    return false;
  }
}

function applyDarkMode(active: boolean): void {
  document.documentElement.dataset.theme = active ? 'dark' : 'light';
  document.documentElement.style.colorScheme = active ? 'dark' : 'light';

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', active ? '#0d0d0d' : '#f7f4ee');
  }
}

export function useDarkMode() {
  const [darkMode, setDarkMode] = useState(readStored);

  useEffect(() => {
    applyDarkMode(darkMode);
    try {
      localStorage.setItem(STORAGE_KEY, String(darkMode));
    } catch {
      /* storage unavailable */
    }
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((on) => !on);
  }, []);

  return { darkMode, toggleDarkMode };
}

if (typeof document !== 'undefined') {
  applyDarkMode(readStored());
}
