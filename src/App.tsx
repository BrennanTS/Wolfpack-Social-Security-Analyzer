import { Analyzer } from './components/Analyzer';
import { useDarkMode } from './hooks/useDarkMode';
import './App.css';

function App() {
  const { darkMode, toggleDarkMode } = useDarkMode();
  return <Analyzer darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />;
}

export default App;
