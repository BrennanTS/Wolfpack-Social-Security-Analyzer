interface DarkModeToggleProps {
  active: boolean;
  onToggle: () => void;
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.2 9.4a5.5 5.5 0 01-7.1-7.1 5.5 5.5 0 107.1 7.1z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.75" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DarkModeToggle({ active, onToggle }: DarkModeToggleProps) {
  return (
    <button
      type="button"
      className={`btn-theme${active ? ' btn-theme-on' : ''}`}
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? 'Switch to light mode' : 'Switch to dark mode'}
      title={active ? 'Light mode' : 'Dark mode'}
    >
      {active ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
