/**
 * Generates src/lib/validationSummary.json from the golden fixtures.
 *
 * The app is a static build: it cannot run a test suite, so the validation
 * panel it shows an adviser has to render an artifact produced here. Written
 * by a script rather than by hand for the reason this project already learned
 * the expensive way — a panel once told readers "The PDF report includes the
 * heatmap and summary charts", which layouts had made false, because the
 * sentence was typed rather than derived. A claim the app cannot check is a
 * claim it must not make.
 *
 * Compact on purpose. `scenarios.json` is three thousand lines, most of it
 * derivation notes for whoever maintains a fixture; none of that belongs in a
 * client bundle. Only what the panel displays is carried across, and
 * `validationSummary.test.ts` fails if the two drift apart.
 *
 *   node validation/scripts/gen-validation-summary.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const fixturesPath = new URL('../fixtures/scenarios.json', import.meta.url);
const outPath = new URL('../../src/lib/validationSummary.json', import.meta.url);

const { scenarios } = JSON.parse(readFileSync(fixturesPath, 'utf8'));

/** The claim-age rows the panel shows. Three is enough to read a shape. */
const SHOWN_AGES = ['62', '67', '70'];

/**
 * A plain-language label for a scenario, from its id.
 *
 * The fixture descriptions are written for maintainers and run to several
 * hundred words each. An adviser wants to know which household this is.
 */
function label(scenario) {
  const [first] = scenario.inputs.people;
  const status =
    scenario.inputs.status === 'married'
      ? 'Married couple'
      : scenario.inputs.status === 'widowed'
        ? 'Widow(er)'
        : 'Single claimant';
  const born = `${first.birthMonth}/${first.birthDay ?? 15}/${first.birthYear}`;
  return `${status}, born ${born}`;
}

const summary = {
  /**
   * The version these figures were generated from, so a panel rendered by an
   * older build cannot claim to describe a newer fixture set.
   */
  generatedFrom: JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    .version,
  scenarios: scenarios
    .filter((s) => s.mode === 'full')
    .map((s) => ({
      id: s.id,
      label: label(s),
      status: s.inputs.status,
      people: s.inputs.people.map((p) => ({
        birthYear: p.birthYear,
        birthMonth: p.birthMonth,
        ...(p.birthDay === undefined ? {} : { birthDay: p.birthDay }),
        piaMonthly: p.piaMonthly,
      })),
      fra: s.expected.fraByPerson.map((f) => f.label),
      // The first person's table only: it is the one the cross-check diffs
      // against ssa.tools, and the one an adviser can verify by following
      // the link beside it.
      monthly: Object.fromEntries(
        SHOWN_AGES.map((age) => [age, s.expected.monthlyByClaimAgeByPerson[0][age]]),
      ),
    })),
};

writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote ${summary.scenarios.length} scenarios to src/lib/validationSummary.json`);
