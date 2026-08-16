// Registers jest-dom matchers (toHaveAttribute, etc.) on Vitest's expect
// for the jsdom "components" test project.
import '@testing-library/jest-dom/vitest';

// React Testing Library auto-registers its afterEach(cleanup) only when it
// finds a global `afterEach` — this project imports test hooks explicitly
// rather than enabling Vitest's `globals` option, so that detection never
// fires. Without an explicit unmount, every render() in a multi-test file
// piles onto the same jsdom document and later queries see prior tests'
// leftover DOM. Wire cleanup up directly instead.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
