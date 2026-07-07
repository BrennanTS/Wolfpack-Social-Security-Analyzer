import { useState } from 'react';
import type { FormEvent } from 'react';
import { DarkModeToggle } from './DarkModeToggle';
import { BRAND_NAME } from '../lib/brand';
import { DEMO_PASSWORD, signIn } from '../lib/auth';

interface PasswordGateProps {
  onAuthenticated: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function PasswordGate({ onAuthenticated, darkMode, onToggleDarkMode }: PasswordGateProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password === DEMO_PASSWORD) {
      signIn();
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
        <DarkModeToggle active={darkMode} onToggle={onToggleDarkMode} />
      </div>

      <div className="gate-layout">
        <aside className="gate-panel-brand" aria-hidden="false">
          <div className="gate-monogram" aria-hidden="true">
            W
          </div>
          <p className="gate-eyebrow">{BRAND_NAME}</p>
          <h1 className="gate-title">
            Social Security
            <span>Analyzer</span>
          </h1>
          <div className="gate-gold-rule" aria-hidden="true" />
          <p className="gate-tagline">
            Precise, SSA-aligned claiming analysis for thoughtful retirement planning.
          </p>
        </aside>

        <main className="gate-panel-form">
          <div className={`gate-card ${shaking ? 'shake' : ''}`}>
            <p className="gate-form-eyebrow">Private access</p>
            <h2 className="gate-form-title">Welcome back</h2>
            <p className="gate-form-desc">
              Enter your credentials to view benefit projections and client-ready reports.
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
                placeholder="••••••••"
                autoFocus
                autoComplete="off"
              />
              {error && <p className="gate-error">Incorrect password. Please try again.</p>}
              <button type="submit">
                <span>Continue</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </form>

            <p className="gate-footer">Confidential demo · Planning purposes only</p>
          </div>
        </main>
      </div>
    </div>
  );
}
