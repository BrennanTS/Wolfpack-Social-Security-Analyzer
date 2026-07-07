import type { ReactNode } from 'react';

interface ToggleChartSectionProps {
  title: string;
  description: string;
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: ReactNode;
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-10-8-10-8a18.45 18.45 0 015.06-5.94"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 10 8 10 8a18.5 18.5 0 01-2.16 3.19"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M1 1l22 22"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M9.88 9.88a3 3 0 104.24 4.24"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ToggleChartSection({
  title,
  description,
  visible,
  onToggle,
  disabled = false,
  children,
}: ToggleChartSectionProps) {
  return (
    <div className={`toggle-chart-section ${visible ? 'is-visible' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <div className="toggle-chart-header">
        <div className="toggle-chart-titles">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className={`btn-eye ${visible ? 'btn-eye-on' : ''}`}
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${title}` : `Show ${title}`}
          title={visible ? 'Hide chart' : 'Show chart'}
        >
          <EyeIcon open={!visible} />
        </button>
      </div>
      {visible && !disabled && <div className="toggle-chart-body">{children}</div>}
    </div>
  );
}
