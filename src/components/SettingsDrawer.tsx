import type { ReactNode } from 'react';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function SettingsDrawer({ open, onClose, children }: SettingsDrawerProps) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="drawer-backdrop drawer-backdrop-settings"
        onClick={onClose}
        aria-label="Close settings panel"
      />

      <aside id="settings-drawer" className="settings-drawer is-open" aria-labelledby="settings-title">
        {children}
      </aside>
    </>
  );
}

interface SettingsDrawerToggleProps {
  open: boolean;
  onToggle: () => void;
}

export function SettingsDrawerToggle({ open, onToggle }: SettingsDrawerToggleProps) {
  return (
    <button
      type="button"
      className="btn-drawer-toggle"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="settings-drawer"
      title={open ? 'Hide settings panel' : 'Show settings panel'}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 4h12M2 8h12M2 12h8"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
      <span className="btn-drawer-label">{open ? 'Hide settings' : 'Settings'}</span>
    </button>
  );
}
