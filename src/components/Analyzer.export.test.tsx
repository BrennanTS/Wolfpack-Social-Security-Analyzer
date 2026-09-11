import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted so the mock factory below can reach it — `vi.mock` is lifted above
// every import, so a plain `const` here would not exist yet when it runs.
const { downloadPdfReport } = vi.hoisted(() => ({ downloadPdfReport: vi.fn() }));
vi.mock('../lib/printReport', () => ({ downloadPdfReport }));

import { Analyzer } from './Analyzer';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const contents = await readFile(path.join(publicDir, String(url).replace(/^\//, '')), 'utf8');
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  });
  Object.defineProperty(window, 'localStorage', {
    value: (() => {
      const map = new Map<string, string>();
      return {
        get length() {
          return map.size;
        },
        clear: () => map.clear(),
        getItem: (k: string) => map.get(k) ?? null,
        key: (i: number) => [...map.keys()][i] ?? null,
        removeItem: (k: string) => map.delete(k),
        setItem: (k: string, v: string) => void map.set(k, v),
      } as Storage;
    })(),
    configurable: true,
    writable: true,
  });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  downloadPdfReport.mockReset();
  window.history.pushState({}, '', '/');
});

const SINGLE = '/?ay=1962&am=4&ad=15&ag=m&ab=2400&ale=85&m=0';

async function readyAnalyzer() {
  window.history.pushState({}, '', SINGLE);
  render(<Analyzer darkMode={false} onToggleDarkMode={vi.fn()} />);
  await screen.findByTestId('export-report', {}, { timeout: 10000 });
  // The button is disabled until the analysis lands.
  await vi.waitFor(() => expect(screen.getByTestId('export-report')).toBeEnabled(), {
    timeout: 10000,
  });
}

/**
 * What an adviser is told when an export does not happen.
 *
 * The failure path was the uncovered half of `handleExportPdf`, and it is the
 * half that matters in a meeting: a click that produces no file and no
 * message reads as an app that ignored you, and the natural response is to
 * click again. Both the message and the button returning to its normal state
 * are asserted, because a button stuck on "Generating…" after a failure is
 * the same dead end by a different route.
 */
describe('when the PDF export fails', () => {
  it('says so, and lets the adviser try again', async () => {
    downloadPdfReport.mockRejectedValue(new Error('renderer exploded'));
    await readyAnalyzer();

    await userEvent.click(screen.getByTestId('export-report'));

    expect(await screen.findByText(/PDF export failed/i)).toBeInTheDocument();
    // Not stuck mid-flight: the button has to come back, or the only way out
    // is a reload that loses the household.
    await vi.waitFor(() => expect(screen.getByTestId('export-report')).toBeEnabled());
  }, 20000);

  it('shows no error when the export succeeds', async () => {
    downloadPdfReport.mockResolvedValue(undefined);
    await readyAnalyzer();

    await userEvent.click(screen.getByTestId('export-report'));

    await vi.waitFor(() => expect(downloadPdfReport).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/PDF export failed/i)).not.toBeInTheDocument();
  }, 20000);

  it('hands the report everything it needs to draw itself', async () => {
    // A missing argument here is a report that silently loses a page — the
    // theme, the layout and the two computed sensitivities all arrive by
    // this one call.
    downloadPdfReport.mockResolvedValue(undefined);
    await readyAnalyzer();
    await userEvent.click(screen.getByTestId('export-report'));
    await vi.waitFor(() => expect(downloadPdfReport).toHaveBeenCalledTimes(1));

    const [args] = downloadPdfReport.mock.calls[0] as [Record<string, unknown>];
    expect(args.analysis, 'the analysis').toBeDefined();
    expect(args.theme, 'the report theme').toBeDefined();
    expect(args.layout, 'the chosen layout').toBeDefined();
    expect(args).toHaveProperty('claimingRowsByPerson');
    expect(args).toHaveProperty('gridTarget');
    // Both may legitimately be null — a household with nothing to compare,
    // or a scenario switched off — but the KEY must be there, or the
    // relevant block is dropped from the report without anyone asking.
    expect(args).toHaveProperty('sensitivity');
    expect(args).toHaveProperty('solvency');
  }, 20000);
});
