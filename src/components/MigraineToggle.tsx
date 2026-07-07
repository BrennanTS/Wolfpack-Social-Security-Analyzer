interface MigraineToggleProps {
  active: boolean;
  onToggle: () => void;
}

export function MigraineToggle({ active, onToggle }: MigraineToggleProps) {
  return (
    <button
      type="button"
      className={`btn-migraine${active ? ' btn-migraine-on' : ''}`}
      onClick={onToggle}
      aria-pressed={active}
      title={
        active
          ? 'Migraine Effect is on — softer dark mode for sensitive eyes'
          : 'Enable Migraine Effect — dark mode for migraine sufferers (and the rest of us)'
      }
    >
      <span className="btn-migraine-icon" aria-hidden="true">
        {active ? '😮‍💨' : '🧠'}
      </span>
      <span className="btn-migraine-label">
        {active ? 'Migraine Effect' : 'Migraine Effect'}
      </span>
      {active && <span className="btn-migraine-badge">on</span>}
    </button>
  );
}
