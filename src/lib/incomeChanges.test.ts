import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeHousehold, type Household } from './household';
import { incomeChanges } from './incomeChanges';

const asOf = new Date(2026, 7, 18);
const assumptions = { annualCola: 2.54, discountRate: 0.025 };

const married: Household = {
  status: 'married',
  people: [
    { id: 'a', name: 'Dan', birthYear: 1978, birthMonth: 12, gender: 'male', piaMonthly: 3962, lifeExpectancy: 79 },
    { id: 'b', name: 'Sarah', birthYear: 1974, birthMonth: 2, gender: 'female', piaMonthly: 2000, lifeExpectancy: 95 },
  ],
};

beforeAll(() => {
  globalThis.fetch = (async (url: string) => {
    const contents = await readFile(
      path.join(process.cwd(), 'public', String(url).replace(/^\//, '')),
      'utf8',
    );
    return { ok: true, json: async () => JSON.parse(contents) } as Response;
  }) as typeof fetch;
});

describe('incomeChanges', () => {
  it('lists each filing and the first death, in order, with a reason', async () => {
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const changes = incomeChanges(analysis);

    expect(changes.length).toBeGreaterThanOrEqual(3);
    expect(changes.map((c) => c.monthIndex)).toEqual(
      [...changes.map((c) => c.monthIndex)].sort((x, y) => x - y),
    );
    expect(changes.every((c) => c.reason.length > 0)).toBe(true);
    // Somebody starting, and the death, both named in the client's words.
    expect(changes.some((c) => /starts their own benefit/.test(c.reason))).toBe(true);
    expect(changes.some((c) => /first death/.test(c.reason))).toBe(true);
  });

  it('reports the household total as the sum of the two people', async () => {
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    for (const change of incomeChanges(analysis)) {
      const summed = change.byPerson.reduce((a, b) => a + b, 0);
      expect(change.total).toBeCloseTo(summed, 6);
    }
  });

  it('drops a change that moves nothing', async () => {
    // The engine splits a personal band in two at the January delayed-credit
    // bump. Both halves are band starts, so both are candidates, and the
    // second one pays exactly what the first did — a row reading "nothing
    // changed" beside a repeated figure.
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    const changes = incomeChanges(analysis);
    for (let i = 1; i < changes.length; i++) {
      const moved =
        Math.abs(changes[i].total - changes[i - 1].total) > 0.005 ||
        changes[i].byPerson.some((v, p) => Math.abs(v - changes[i - 1].byPerson[p]) > 0.005);
      expect(moved).toBe(true);
    }
  });

  it('never opens on a month paying nothing', async () => {
    // The first row is the headline of page one. A leading $0 row would say
    // the household's income "changes" to nothing at all.
    const analysis = await analyzeHousehold(married, assumptions, asOf);
    expect(incomeChanges(analysis)[0].total).toBeGreaterThan(0);
  });

  it('has no first-death row for a single claimant', async () => {
    const analysis = await analyzeHousehold(
      { status: 'single', people: [married.people[0]] },
      assumptions,
      asOf,
    );
    const changes = incomeChanges(analysis);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => /first death/.test(c.reason))).toBe(false);
  });
});
