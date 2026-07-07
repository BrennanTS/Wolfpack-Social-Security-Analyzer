import { useState } from 'react';
import { Analyzer } from './components/Analyzer';
import { isAuthenticated, logout, PasswordGate } from './components/PasswordGate';
import { useMigraineMode } from './hooks/useMigraineMode';
import './App.css';

function App() {
  const [authed, setAuthed] = useState(isAuthenticated);
  const { migraineMode, toggleMigraineMode } = useMigraineMode();

  if (!authed) {
    return (
      <PasswordGate
        onAuthenticated={() => setAuthed(true)}
        migraineMode={migraineMode}
        onToggleMigraineMode={toggleMigraineMode}
      />
    );
  }

  return (
    <Analyzer
      migraineMode={migraineMode}
      onToggleMigraineMode={toggleMigraineMode}
      onLogout={() => {
        logout();
        setAuthed(false);
      }}
    />
  );
}

export default App;
