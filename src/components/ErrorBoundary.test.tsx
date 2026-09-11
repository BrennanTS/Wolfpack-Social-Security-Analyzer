import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ when }: { when: boolean }): React.ReactElement {
  if (when) throw new Error('the sky fell');
  return <p>all fine</p>;
}

/** jsdom here has no `localStorage`, so one is supplied per test. */
function useStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  const store = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
  Object.defineProperty(window, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
  return store;
}

// React logs the caught error itself, on top of the boundary's own log. Both
// are noise here, and silencing them keeps a passing run readable.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom when={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('all fine')).toBeInTheDocument();
  });

  it('shows a message instead of a blank page when a render throws', () => {
    // The whole point. Without a boundary React unmounts the tree and the
    // adviser is left looking at white, mid-meeting, with nothing to report.
    render(
      <ErrorBoundary>
        <Boom when={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it('shows the error text, so the failure can be described', () => {
    render(
      <ErrorBoundary>
        <Boom when={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('the sky fell')).toBeInTheDocument();
  });

  it('tells the reader to copy the address bar before reloading', () => {
    // This app keeps the whole household in the query string, so the work is
    // usually still recoverable — but only if nobody reloads first.
    render(
      <ErrorBoundary>
        <Boom when={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/copy the address/i)).toBeInTheDocument();
  });

  it('clears the remembered view on "Start fresh", and nothing else', async () => {
    // State persisted to localStorage that causes a crash would re-crash on
    // every reload without this — an app permanently bricked for anyone who
    // does not know to clear site data. Saved clients, themes and layouts are
    // work the adviser chose to keep, so they survive.
    const store = useStorage({
      'ssa-current-view': 'ay=1875&am=12',
      'ssa-clients': '[{"name":"kept"}]',
      'ssa-report-themes': '[{"id":"kept"}]',
    });
    render(
      <ErrorBoundary>
        <Boom when={true} />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: /start fresh/i }));
    expect(store.getItem('ssa-current-view')).toBeNull();
    expect(store.getItem('ssa-clients')).toBe('[{"name":"kept"}]');
    expect(store.getItem('ssa-report-themes')).toBe('[{"id":"kept"}]');
  });
});
