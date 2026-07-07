import { useState } from 'react';
import type { FormEvent } from 'react';
import { MigraineToggle } from './MigraineToggle';

const DEMO_PASSWORD = 'wolfpack';
const AUTH_KEY = 'ssa-demo-auth';

export function isAuthenticated(): boolean {
  return sessionStorage.getItem(AUTH_KEY) === 'true';
}

export function logout(): void {
  sessionStorage.removeItem(AUTH_KEY);
}

interface PasswordGateProps {
  onAuthenticated: () => void;
  migraineMode: boolean;
  onToggleMigraineMode: () => void;
}

export function PasswordGate({ onAuthenticated, migraineMode, onToggleMigraineMode }: PasswordGateProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password === DEMO_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, 'true');
      onAuthenticated();
      return;
    }
    setError(true);
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  }

  return (
    <div className="gate">
      <div className="gate-toolbar">
        <MigraineToggle active={migraineMode} onToggle={onToggleMigraineMode} />
      </div>
      <div className={`gate-card ${shaking ? 'shake' : ''}`}>
        <div className="gate-brand">
          <div className="gate-app-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 18V6l8-3 8 3v12l-8 3-8-3z"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M12 3v18M4 6l8 3 8-3" stroke="white" strokeWidth="1.5" />
            </svg>
          </div>
          <h1>Social Security Analyzer</h1>
          <p className="gate-subtitle">Wolfpack Planning Team</p>
        </div>

        <p className="gate-desc">
          Find your optimal claiming age with precise, SSA-aligned benefit projections.
        </p>

        <form onSubmit={handleSubmit} className="gate-form">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            placeholder="Enter demo password"
            autoFocus
            autoComplete="off"
          />
          {error && <p className="gate-error">Incorrect password. Please try again.</p>}
          <button type="submit">Continue</button>
        </form>

        <p className="gate-footer">Private demo · Planning purposes only</p>
      </div>
    </div>
  );
}
