import { useCallback, useState } from 'react';
import { Analyzer } from './components/Analyzer';
import { PasswordGate } from './components/PasswordGate';
import { isAuthenticated, logout } from './lib/auth';
import { useDarkMode } from './hooks/useDarkMode';
import './App.css';

const TRANSITION_MS = 620;

function App() {
  const [view, setView] = useState<'gate' | 'app'>(isAuthenticated() ? 'app' : 'gate');
  const [gateExiting, setGateExiting] = useState(false);
  const [appEntering, setAppEntering] = useState(false);
  const { darkMode, toggleDarkMode } = useDarkMode();

  const handleAuthenticated = useCallback(() => {
    setGateExiting(true);
    window.setTimeout(() => {
      setView('app');
      setGateExiting(false);
      setAppEntering(true);
      window.setTimeout(() => setAppEntering(false), TRANSITION_MS);
    }, TRANSITION_MS);
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    setView('gate');
    setGateExiting(false);
    setAppEntering(false);
  }, []);

  return (
    <div className="app-root">
      {view === 'gate' && (
        <div className={`view-layer view-gate${gateExiting ? ' is-exiting' : ''}`}>
          <PasswordGate
            onAuthenticated={handleAuthenticated}
            darkMode={darkMode}
            onToggleDarkMode={toggleDarkMode}
          />
        </div>
      )}

      {view === 'app' && (
        <>
          <div
            className={`transition-curtain${appEntering ? ' is-active' : ''}`}
            aria-hidden="true"
          />
          <div className={`view-layer view-app${appEntering ? ' is-entering' : ''}`}>
            <Analyzer
              darkMode={darkMode}
              onToggleDarkMode={toggleDarkMode}
              onLogout={handleLogout}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default App;
