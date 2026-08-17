/**
 * Finds households that reach a named branch, for authoring golden fixtures.
 *
 * Skipped unless `SWEEP_FIND` is set — it is a tool, not an assertion.
 *
 *     SWEEP_FIND=survivor-no-band SWEEP_COUNT=6000 npm run sweep -- find-candidates
 *
 * This exists because of a specific failure: a plan once specified a golden
 * fixture by reusing the parameters a unit test proved produce a gain, and
 * those parameters return `null` through the real pipeline. Forced filing ages
 * are not optimizer-chosen filing ages. The only reliable way to author a
 * fixture that reaches a branch is to search the space with the SAME pipeline
 * the fixture will run through — which is what this does.
 */
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { householdAt } from './households';
import { analyze, stubLifeTableFetch } from './harness';

const WANTED = process.env.SWEEP_FIND;
const COUNT = Number(process.env.SWEEP_COUNT ?? 4000);
const LIMIT = Number(process.env.SWEEP_FIND_LIMIT ?? 8);

beforeAll(() => vi.stubGlobal('fetch', stubLifeTableFetch()));
afterAll(() => vi.unstubAllGlobals());

/** Each predicate names a branch the golden corpus may not be able to see. */
const PREDICATES: Record<string, (a: Awaited<ReturnType<typeof analyze>>) => boolean> = {
  // The population Phase 3A's spec amendment was about: a real age-60
  // entitlement the chart shows nothing of.
  'survivor-no-band': (a) => !!a.survivorClaim && !a.survivorClaim.baselineHasSurvivorBand,
  'survivor-claim': (a) => !!a.survivorClaim,
  'survivor-gap': (a) => !!a.survivorGap,
  // An exact PIA tie — the shape behind the order-independence saga.
  'pia-tie': (a) => !!a.spousalTopUp && a.spousalTopUp.lowerEarnerLabel === null,
  // A spousal entitlement that never actually begins.
  'spousal-never-starts': (a) => !!a.spousalTopUp && a.spousalTopUp.startsAtSpouseAge === null,
  'survivor-under-60': (a) => !!a.survivorGap && a.survivorGap.survivorUnder60,
};

describe.skipIf(!WANTED)('candidate search', () => {
  it(`finds households matching "${WANTED}"`, async () => {
    const predicate = PREDICATES[WANTED ?? ''];
    if (!predicate) {
      throw new Error(`Unknown SWEEP_FIND "${WANTED}". Known: ${Object.keys(PREDICATES).join(', ')}`);
    }

    const hits: string[] = [];
    for (let index = 0; index < COUNT && hits.length < LIMIT; index++) {
      const { household, label } = householdAt(index);
      const analysis = await analyze(household);
      if (!predicate(analysis)) continue;

      const people = household.people
        .map(
          (p) =>
            `{birthYear: ${p.birthYear}, birthMonth: ${p.birthMonth}, gender: '${p.gender}', ` +
            `pia: ${p.piaMonthly}, life: ${p.lifeExpectancy}}`,
        )
        .join(', ');
      const claim = analysis.survivorClaim;
      hits.push(
        `${label}\n    people: [${people}]\n` +
          `    filingAges: ${analysis.optimal.filingAges.map((f) => f.label).join(' / ')}\n` +
          (claim
            ? `    survivorClaim: {claimAge: '${claim.claimAge}', gain: ${claim.gain}, ` +
              `baselineHasSurvivorBand: ${claim.baselineHasSurvivorBand}}`
            : '    survivorClaim: null'),
      );
    }

    console.log(
      hits.length
        ? `Found ${hits.length} household(s) matching "${WANTED}" in the first ${COUNT}:\n` +
            hits.map((h, i) => `  [${i + 1}] ${h}`).join('\n')
        : `No household matching "${WANTED}" in the first ${COUNT}.`,
    );
  });
});
