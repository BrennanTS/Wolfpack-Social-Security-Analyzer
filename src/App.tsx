import { Analyzer } from './components/Analyzer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useDarkMode } from './hooks/useDarkMode';
import './App.css';

function App() {
  const { darkMode, toggleDarkMode } = useDarkMode();
  // Outside `Analyzer`, deliberately: a crash in the analyzer's own render
  // is exactly what this catches, and a boundary inside the thing that
  // throws catches nothing.
  return (
    <ErrorBoundary>
      <Analyzer darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
    </ErrorBoundary>
  );
}

export default App;
