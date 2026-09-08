import type { DollarsMode } from './dollarsMode';
import {
  COLA_BOUNDS,
  DEFAULT_PLAN_TO_AGE,
  isBenefitInRange,
  isDiscountRateInBounds,
  isInBounds,
  LIFE_EXPECTANCY_BOUNDS,
} from './formBounds';
import { BLANK_FORM, type AnalyzerFormState, type PersonFormFields } from './formState';
import {
  claimingRowId,
  type ClaimingPrefsByPerson,
  type ClaimingTablePrefs,
} from './claimingRows';
import { DEFAULT_TARGET_RANGE, MAX_TARGET_PERCENT, type TargetRange } from './gridTarget';
import {
  SOLVENCY_PAYABLE_BOUNDS,
  SOLVENCY_YEAR_BOUNDS,
  type SolvencyAssumption,
} from './solvency';
import type { Gender } from './personAnalysis';
import {
  addScenario,
  selectScenario,
  toggleScenarioHidden,
  BEST_ROW_ID,
  DEFAULT_SCENARIO_SET,
  resetScenarios,
  type FilingAgeChoice,
  type ScenarioSet,
} from './scenario';
import {
  BLANK_ALREADY_CLAIMED,
  BLANK_DECEASED,
  type AlreadyClaimedFormFields,
  type DeceasedFormFields,
} from './widowedForm';

/**
 * Encodes the analyzer's form state into a shareable query string, and back.
 *
 * Two rules shape everything here.
 *
 * FIRST NAMES ARE ENCODED, since 2026-09-07, by product decision. They were
 * not, and the reasoning still stands on its own terms: a date of birth and a
 * dollar figure with no name attached is weaker as identifying information,
 * and links leak into history, chat logs, screenshots and Referer headers.
 * What changed is the use — a link is now also how a saved client travels
 * between an adviser's own devices and colleagues, and one that arrived
 * showing "Client" and "Spouse" made the recipient retype the two things they
 * were most sure of.
 *
 * So: first names only, capped at 40 characters, and never a surname because
 * the app has nowhere to type one. `Analyzer` still strips the query string
 * from the address bar on arrival, which is what keeps a name off a shared
 * screen for the rest of a meeting.
 *
 * Everything arriving from a URL is untrusted, and an invalid value is
 * DROPPED, not clamped. Clamping would silently substitute a plausible number
 * that the recipient never notices, in a tool whose output informs a financial
 * decision. A dropped field stays blank, so the form visibly asks for it.
 */

const CURRENT_YEAR = new Date().getFullYear();
// Mirrors the range `PersonFields` offers in its birth-year select:
// `Array.from({ length: 70 }, (_, i) => CURRENT_YEAR - 18 - i)` spans
// CURRENT_YEAR - 18 down to CURRENT_YEAR - 87.
const BIRTH_YEAR_BOUNDS = { min: CURRENT_YEAR - 87, max: CURRENT_YEAR - 18 };

function num(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function intInBounds(
  params: URLSearchParams,
  key: string,
  bounds: { min: number; max: number },
): number | '' {
  const value = num(params, key);
  if (value === null || !Number.isInteger(value) || !isInBounds(value, bounds)) return '';
  return value;
}

function readGender(params: URLSearchParams, key: string): Gender | null {
  const raw = params.get(key);
  if (raw === 'm') return 'male';
  if (raw === 'f') return 'female';
  return null;
}

function readBenefit(params: URLSearchParams, key: string): number | '' {
  const value = num(params, key);
  if (value === null || !isBenefitInRange(value)) return '';
  return value;
}

function readLifeExpectancy(params: URLSearchParams, key: string): number | null {
  const value = num(params, key);
  if (value === null || !isInBounds(value, LIFE_EXPECTANCY_BOUNDS)) return null;
  return value;
}

/**
 * `dollars=nominal` is the only value that changes anything; everything
 * else — absent, `real`, or garbage — leaves the default. Unlike the
 * numeric fields above, there is no bounds check to fail: this is dropped
 * rather than clamped by recognizing exactly one non-default spelling
 * instead of rejecting a range.
 */
function readDollarsMode(params: URLSearchParams): DollarsMode {
  return params.get('dollars') === 'nominal' ? 'nominal' : BLANK_FORM.dollarsMode;
}

/**
 * The filing ages the link's analysis is built on, as `62-1` or `65-0.67-6` —
 * one `years-months` pair per person, joined by a period, person A first.
 *
 * Only the SELECTED scenario travels, not the adviser's whole list. A link is
 * a view of one analysis, and the recipient's own comparison rows are theirs;
 * a link that replaced them would be editing the recipient's workspace to
 * show them a number. The recipient sees the four built-ins plus one row
 * carrying the sender's ages, already selected — enough to reproduce every
 * figure the sender was looking at.
 *
 * Absent means the optimizer's own answer, which is by far the commonest
 * link. It is deliberately NOT written as an explicit "best" token: a link
 * that pinned ages would keep showing them after the recipient edited a birth
 * year, whereas `best` has to stay a re-resolved answer rather than a
 * remembered one (see `Scenario`).
 *
 * Dropped, not clamped, like every other field here — but the drop only has
 * to catch syntax. A syntactically valid age this household cannot attain
 * (62 for someone already 66) survives into `analyzeHousehold`, which clamps
 * it to the nearest attainable age and shows the clamped value in the
 * scenario table. That is the same handling a scenario gets when the reader
 * edits inputs under it, so a stale link and a stale form behave identically
 * rather than one silently dropping to the optimum.
 */
/**
 * The four rows that are always present, addressed by the token an adviser's
 * saved view uses for them. Custom rows are `c0`, `c1`… in `sc` order, which
 * is positional because their real ids are minted at runtime and would mean
 * nothing to a link written by another browser.
 */
const DERIVED_TOKENS = ['optimal', 'earliest', 'fra', 'latest'] as const;

/** One custom row as it travels: its ages, and its label if it was renamed. */
function readCustomRow(part: string): { ages: FilingAgeChoice[]; label?: string } | null {
  const [agesPart, ...labelParts] = part.split('~');
  const ages: FilingAgeChoice[] = [];
  for (const piece of agesPart.split('.')) {
    const match = /^(\d{1,3})-(\d{1,2})$/.exec(piece);
    if (match === null) return null;
    const years = Number(match[1]);
    const months = Number(match[2]);
    // Bounds are generous on purpose: this only has to reject nonsense, not
    // decide attainability, which the engine's own ranked set settles.
    if (years < 50 || years > 100 || months > 11) return null;
    ages.push({ years, months });
  }
  if (ages.length === 0 || ages.length > 2) return null;
  const label = labelParts.join('~').trim().slice(0, 40);
  return label.length > 0 ? { ages, label } : { ages };
}

function readScenarios(params: URLSearchParams): ScenarioSet {
  const raw = params.get('sc');
  let set = resetScenarios();
  const custom: string[] = [];

  if (raw !== null && raw.trim() !== '') {
    // Rows are separated by `_`; a link written before there was more than
    // one row carries a single row and parses unchanged.
    for (const part of raw.split('_')) {
      const row = readCustomRow(part);
      // One malformed row drops the whole parameter, as before: a partially
      // restored comparison is a set of rows the adviser did not build.
      if (row === null) return DEFAULT_SCENARIO_SET;
      set = addScenario(set, row.ages);
      const added = set.rows[set.rows.length - 1];
      custom.push(added.id);
      if (row.label !== undefined) {
        set = { ...set, rows: set.rows.map((r) => (r.id === added.id ? { ...r, label: row.label! } : r)) };
      }
    }
  }

  /** A token from a link, resolved against the set just built. */
  const idFor = (token: string): string | undefined => {
    if ((DERIVED_TOKENS as readonly string[]).includes(token)) return token;
    const match = /^c(\d+)$/.exec(token);
    return match === null ? undefined : custom[Number(match[1])];
  };

  for (const token of (params.get('sch') ?? '').split(',')) {
    const id = idFor(token.trim());
    // Optimal is never hideable — `toggleScenarioHidden` refuses it, and this
    // goes through that rule rather than around it.
    if (id !== undefined) set = toggleScenarioHidden(set, id);
  }

  const selected = params.get('scs');
  if (selected !== null) {
    const id = idFor(selected.trim());
    if (id !== undefined) return selectScenario(set, id);
    return set;
  }
  // No explicit selection: a link written before `scs` existed carried one
  // custom row precisely because that row was what its sender was looking at.
  if (custom.length > 0) return selectScenario(set, custom[custom.length - 1]);
  return set;
}

function writeScenarios(params: URLSearchParams, scenarios: ScenarioSet): void {
  const custom = scenarios.rows.filter((row) => row.scenario.kind === 'custom');
  const tokenFor = (id: string): string | undefined => {
    if ((DERIVED_TOKENS as readonly string[]).includes(id)) return id;
    const index = custom.findIndex((row) => row.id === id);
    return index < 0 ? undefined : `c${index}`;
  };

  const parts = custom.flatMap((row) => {
    if (row.scenario.kind !== 'custom' || row.scenario.ages.length === 0) return [];
    const ages = row.scenario.ages.map((a) => `${a.years}-${a.months}`).join('.');
    // The label travels only when it is not the one `addScenario` would mint
    // anyway, so an untouched comparison keeps a short link.
    const minted = /^Scenario \d+$/.test(row.label);
    return [minted ? ages : `${ages}~${row.label.slice(0, 40)}`];
  });
  if (parts.length > 0) params.set('sc', parts.join('_'));

  const hidden = scenarios.rows
    .filter((row) => row.hidden === true)
    .flatMap((row) => {
      const token = tokenFor(row.id);
      return token === undefined ? [] : [token];
    });
  if (hidden.length > 0) params.set('sch', hidden.join(','));

  // Written whenever it is not the default, which now includes a derived row
  // — selecting "Delay to 70" and sharing used to hand the reader Best — and
  // ALWAYS once a custom row travels, because a reader with rows and no
  // selection falls back to selecting the last of them.
  const selected = tokenFor(scenarios.selectedId);
  if (selected !== undefined && (selected !== BEST_ROW_ID || parts.length > 0)) {
    params.set('scs', selected);
  }
}

/** The longest first name a link or a saved record carries. */
const MAX_NAME = 40;

function readName(params: URLSearchParams, prefix: 'a' | 'b'): string {
  const raw = params.get(`${prefix}n`);
  if (raw === null) return '';
  // Trimmed and capped rather than rejected: a name is display text, and the
  // only thing that could be wrong with it is its length.
  return raw.trim().slice(0, MAX_NAME);
}

function readPerson(params: URLSearchParams, prefix: 'a' | 'b'): PersonFormFields {
  return {
    name: readName(params, prefix),
    birthYear: intInBounds(params, `${prefix}y`, BIRTH_YEAR_BOUNDS),
    birthMonth: intInBounds(params, `${prefix}m`, { min: 1, max: 12 }),
    gender: readGender(params, `${prefix}g`),
    monthlyBenefit: readBenefit(params, `${prefix}b`),
    lifeExpectancy: readLifeExpectancy(params, `${prefix}le`),
  };
}

function writePerson(
  params: URLSearchParams,
  prefix: 'a' | 'b',
  person: PersonFormFields,
): void {
  const name = person.name.trim().slice(0, MAX_NAME);
  if (name !== '') params.set(`${prefix}n`, name);
  if (person.birthYear !== '') params.set(`${prefix}y`, String(person.birthYear));
  if (person.birthMonth !== '') params.set(`${prefix}m`, String(person.birthMonth));
  if (person.gender !== null) params.set(`${prefix}g`, person.gender === 'male' ? 'm' : 'f');
  if (person.monthlyBenefit !== '') params.set(`${prefix}b`, String(person.monthlyBenefit));
  if (person.lifeExpectancy !== null) params.set(`${prefix}le`, String(person.lifeExpectancy));
}

/**
 * Widowed parameters. Prefixed `d` for the deceased and `c` for what the
 * survivor has already claimed, so none can collide with the `a`/`b` person
 * prefixes already in use.
 */
function writeWidowed(params: URLSearchParams, form: AnalyzerFormState): void {
  const d = form.deceased;
  if (d.birthYear !== '') params.set('dy', String(d.birthYear));
  if (d.birthMonth !== '') params.set('dm', String(d.birthMonth));
  if (d.deathYear !== '') params.set('ddy', String(d.deathYear));
  if (d.deathMonth !== '') params.set('ddm', String(d.deathMonth));
  params.set('dk', d.recordKind === 'checkAmount' ? 'c' : 'p');
  if (d.piaMonthly !== '') params.set('dp', String(d.piaMonthly));
  if (d.checkAmount !== '') params.set('dc', String(d.checkAmount));
  if (d.hadFiled !== null) params.set('df', d.hadFiled ? '1' : '0');
  if (d.filedYear !== '') params.set('dfy', String(d.filedYear));
  if (d.filedMonth !== '') params.set('dfm', String(d.filedMonth));

  const a = form.alreadyClaimed;
  if (a.survivorSinceYear !== '') params.set('csy', String(a.survivorSinceYear));
  if (a.survivorSinceMonth !== '') params.set('csm', String(a.survivorSinceMonth));
  if (a.ownSinceYear !== '') params.set('coy', String(a.ownSinceYear));
  if (a.ownSinceMonth !== '') params.set('com', String(a.ownSinceMonth));
}

function readWidowed(params: URLSearchParams): {
  deceased: DeceasedFormFields;
  alreadyClaimed: AlreadyClaimedFormFields;
} {
  const hadFiled = params.get('df');
  const MONTH_BOUNDS = { min: 1, max: 12 };
  return {
    deceased: {
      birthYear: num(params, 'dy') ?? '',
      birthMonth: intInBounds(params, 'dm', MONTH_BOUNDS),
      deathYear: num(params, 'ddy') ?? '',
      deathMonth: intInBounds(params, 'ddm', MONTH_BOUNDS),
      recordKind: params.get('dk') === 'c' ? 'checkAmount' : 'pia',
      piaMonthly: num(params, 'dp') ?? '',
      hadFiled: hadFiled === '1' ? true : hadFiled === '0' ? false : null,
      checkAmount: num(params, 'dc') ?? '',
      filedYear: num(params, 'dfy') ?? '',
      filedMonth: intInBounds(params, 'dfm', MONTH_BOUNDS),
    },
    alreadyClaimed: {
      survivorSinceYear: num(params, 'csy') ?? '',
      survivorSinceMonth: intInBounds(params, 'csm', MONTH_BOUNDS),
      ownSinceYear: num(params, 'coy') ?? '',
      ownSinceMonth: intInBounds(params, 'com', MONTH_BOUNDS),
    },
  };
}

export function toShareParams(form: AnalyzerFormState): URLSearchParams {
  const params = new URLSearchParams();
  writePerson(params, 'a', form.personA);
  if (form.maritalStatus !== null) {
    params.set(
      'm',
      form.maritalStatus === 'married' ? '1' : form.maritalStatus === 'widowed' ? 'w' : '0',
    );
  }
  if (form.maritalStatus === 'married') writePerson(params, 'b', form.personB);
  if (form.maritalStatus === 'widowed') writeWidowed(params, form);
  params.set('cola', String(form.annualCola));
  // `dr` travels as a PERCENT so the link is human-readable and matches the
  // slider; the form stores a fraction. Convert on both sides.
  params.set('dr', String(form.discountRate * 100));
  params.set('dollars', form.dollarsMode);
  writeScenarios(params, form.scenarios);
  return params;
}

export function fromShareParams(params: URLSearchParams): AnalyzerFormState {
  // `m=1` and `m=0` predate the widowed status and MUST keep their meaning:
  // links already in circulation carry them, and their recipient cannot see
  // that a parameter changed meaning. `w` is a third value on the same key
  // rather than a new key, for exactly that reason.
  const statusParam = params.get('m');
  const maritalStatus: AnalyzerFormState['maritalStatus'] =
    statusParam === '1'
      ? 'married'
      : statusParam === '0'
        ? 'single'
        : statusParam === 'w'
          ? 'widowed'
          : null;

  const cola = num(params, 'cola');

  // `dr` travels as a percent; the form stores a fraction. Convert FIRST, then
  // validate the fraction — so the value that is checked is the exact value
  // that reaches state, rather than a percent that is checked and then
  // transformed into something else. That is what `isDiscountRateInBounds`
  // exists for; validating the pre-conversion percent instead left the
  // fraction path unguarded, and left a reader of `formBounds.ts` believing
  // otherwise.
  const dr = num(params, 'dr');
  const discountFraction = dr === null ? null : dr / 100;

  // `le` predates the per-person split, where it meant person A's value. Honour
  // it so links already in circulation reproduce the same analysis rather than
  // silently losing a parameter the recipient cannot see is missing. `ale` wins
  // when both are present — it is the newer, more specific key.
  //
  // This fallback cannot distinguish "ale absent" from "ale present but out of
  // bounds" — both leave personA.lifeExpectancy null here, so an invalid `ale`
  // silently falls through to a valid `le`, e.g. `?ale=200&le=88` yields 88
  // rather than dropping to null. That is a quiet exception to this module's
  // "dropped, not clamped, independently per person" rule. It is tolerated
  // because new links never write `le`, so the combination is near-unreachable
  // in practice, and distinguishing the two cases would add real complexity to
  // a fallback that exists only for old links.
  const personA = readPerson(params, 'a');
  if (personA.lifeExpectancy === null) {
    personA.lifeExpectancy = readLifeExpectancy(params, 'le');
  }
  // A link that carries no plan-to age gets the default, not null. This is
  // the one field where "dropped, not clamped" cannot mean "left blank so the
  // form visibly asks for it" — the slider always shows a number, and since
  // the optimizer takes its horizon from this one, null would mean no
  // analysis at all. Same treatment `annualCola` and `discountRate` get.
  const withDefaultHorizon = (p: PersonFormFields): PersonFormFields =>
    p.lifeExpectancy === null ? { ...p, lifeExpectancy: DEFAULT_PLAN_TO_AGE } : p;

  return {
    personA: withDefaultHorizon(personA),
    personB:
      maritalStatus === 'married'
        ? withDefaultHorizon(readPerson(params, 'b'))
        : BLANK_FORM.personB,
    maritalStatus,
    ...(maritalStatus === 'widowed'
      ? readWidowed(params)
      : { deceased: BLANK_DECEASED, alreadyClaimed: BLANK_ALREADY_CLAIMED }),
    annualCola: cola !== null && isInBounds(cola, COLA_BOUNDS) ? cola : BLANK_FORM.annualCola,
    discountRate:
      discountFraction !== null && isDiscountRateInBounds(discountFraction)
        ? discountFraction
        : BLANK_FORM.discountRate,
    dollarsMode: readDollarsMode(params),
    scenarios: readScenarios(params),
  };
}

/* ------------------------------------------------------------------ *
 * The rest of the view
 * ------------------------------------------------------------------ *
 *
 * Two pieces of what an adviser set up live beside the form rather than in
 * it: which rows of each person's claiming table they hid or added, and how
 * wide the claiming grid's near-best region is. Both are display choices, and
 * both are printed in the report — so a link, or a saved client, that leaves
 * them behind reopens something the adviser did not set up.
 */

/** Everything on screen that is not the form itself. */
export interface ViewExtras {
  claimingPrefs: ClaimingPrefsByPerson;
  gridTarget: TargetRange;
  /**
   * The benefit reduction the "what if benefits are reduced" page prices.
   *
   * Travels because switching it on is a judgment an adviser made, and a
   * saved client or a shared link that quietly dropped it would open a
   * different report from the one they were looking at. Absent means off,
   * which is what almost every link says.
   */
  solvency?: SolvencyAssumption;
  /**
   * Which theme and layout the report is built with.
   *
   * Carried since 2026-09-07, by product decision: a saved client remembers
   * the look it is presented in, so a household that gets the short client
   * report in one firm's colors opens that way next time rather than in
   * whatever was last used for someone else.
   *
   * Ids only, and a preset's id is the same in every browser. One naming a
   * custom theme reaches a colleague who does not have it and resolves to
   * nothing, which the pickers already treat as "use the default" — the
   * alternative, shipping the whole theme in the query string, would put a
   * base64 logo in a URL.
   */
  themeId?: string;
  layoutId?: string;
}

export const BLANK_VIEW_EXTRAS: ViewExtras = {
  claimingPrefs: {},
  gridTarget: DEFAULT_TARGET_RANGE,
};

/** An id from a URL: short, and made of the characters this app mints. */
function readId(params: URLSearchParams, key: string): string | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const id = raw.trim();
  return /^[\w-]{1,60}$/.test(id) ? id : undefined;
}

/** `67` or `69-1` — the shape `claimingRowId` mints. */
const ROW_ID = /^(\d{1,3})(?:-(\d{1,2}))?$/;

function readRowIds(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (raw === null) return [];
  const ids: string[] = [];
  for (const piece of raw.split(',')) {
    const token = piece.trim();
    const match = ROW_ID.exec(token);
    if (match === null) continue;
    const years = Number(match[1]);
    const months = match[2] === undefined ? 0 : Number(match[2]);
    // The same generous bounds the scenario ages get: reject nonsense, leave
    // attainability to the engine.
    if (years < 50 || years > 100 || months > 11) continue;
    if (!ids.includes(token)) ids.push(token);
  }
  return ids;
}

function readAddedAges(params: URLSearchParams, key: string): FilingAgeChoice[] {
  return readRowIds(params, key).map((id) => {
    const [years, months] = id.split('-');
    return { years: Number(years), months: months === undefined ? 0 : Number(months) };
  });
}

function readPrefs(params: URLSearchParams, prefix: 'a' | 'b'): ClaimingTablePrefs | null {
  const hidden = readRowIds(params, `p${prefix}h`);
  const added = readAddedAges(params, `p${prefix}a`);
  if (hidden.length === 0 && added.length === 0) return null;
  return { hidden, added };
}

function writePrefs(
  params: URLSearchParams,
  prefix: 'a' | 'b',
  prefs: ClaimingTablePrefs | undefined,
): void {
  if (prefs === undefined) return;
  if (prefs.hidden.length > 0) params.set(`p${prefix}h`, prefs.hidden.join(','));
  if (prefs.added.length > 0) {
    params.set(`p${prefix}a`, prefs.added.map((age) => claimingRowId(age)).join(','));
  }
}

/**
 * The form's parameters, plus everything else on screen.
 *
 * Separate from `toShareParams` because the form is what that function has
 * always meant, and every caller of it — including the tests that pin this
 * module's encoding — passes a form and nothing else.
 */
export function toViewParams(form: AnalyzerFormState, extras: ViewExtras): URLSearchParams {
  const params = toShareParams(form);
  // Person ids are `a` and `b` in display order, which is what the form
  // collects and what these parameters are named for.
  writePrefs(params, 'a', extras.claimingPrefs.a);
  if (form.maritalStatus === 'married') writePrefs(params, 'b', extras.claimingPrefs.b);
  // `2032-78`: the year benefits are reduced from, and the percent payable.
  // Present means the reduction scenario is ON, which is the whole of what
  // the parameter says — an absent `sv` is the off state every link has
  // unless an adviser switched the scenario on, and the figures beside it
  // are meaningless while it is off.
  const solvency = extras.solvency;
  if (solvency !== undefined && solvency.enabled) {
    params.set('sv', `${solvency.fromYear}-${solvency.payablePercent}`);
  }
  if (extras.themeId !== undefined) params.set('th', extras.themeId);
  if (extras.layoutId !== undefined) params.set('ly', extras.layoutId);
  const { on, percent } = extras.gridTarget;
  // `off` rather than an absent parameter: absent has to mean "a link written
  // before this existed", which gets the default, and the default is on.
  if (!on) params.set('gt', 'off');
  else if (percent !== DEFAULT_TARGET_RANGE.percent) params.set('gt', String(percent));
  return params;
}

export function readViewExtras(params: URLSearchParams): ViewExtras {
  const claimingPrefs: ClaimingPrefsByPerson = {};
  const a = readPrefs(params, 'a');
  if (a !== null) claimingPrefs.a = a;
  const b = readPrefs(params, 'b');
  if (b !== null) claimingPrefs.b = b;

  const raw = params.get('gt');
  const percent = raw === null ? null : Number(raw);
  const gridTarget: TargetRange =
    raw === 'off'
      ? { on: false, percent: DEFAULT_TARGET_RANGE.percent }
      : percent !== null && Number.isFinite(percent) && percent > 0 && percent <= MAX_TARGET_PERCENT
        ? { on: true, percent }
        : DEFAULT_TARGET_RANGE;

  const themeId = readId(params, 'th');
  const layoutId = readId(params, 'ly');
  const solvency = readSolvency(params);
  return {
    claimingPrefs,
    gridTarget,
    ...(solvency === null ? {} : { solvency }),
    ...(themeId === undefined ? {} : { themeId }),
    ...(layoutId === undefined ? {} : { layoutId }),
  };
}

/**
 * `sv=2032-78`, dropped rather than clamped like every other field here.
 *
 * A reduction outside the bounds is not a plausible typo to be rescued, it is
 * a hand-edited link, and leaving the scenario off is a better answer than
 * pricing a number nobody chose.
 */
function readSolvency(params: URLSearchParams): SolvencyAssumption | null {
  const raw = params.get('sv');
  if (raw === null) return null;
  const match = /^(\d{4})-(\d{1,3})$/.exec(raw.trim());
  if (match === null) return null;
  const fromYear = Number(match[1]);
  const payablePercent = Number(match[2]);
  if (!isInBounds(fromYear, SOLVENCY_YEAR_BOUNDS)) return null;
  if (!isInBounds(payablePercent, SOLVENCY_PAYABLE_BOUNDS)) return null;
  return { enabled: true, fromYear, payablePercent };
}

export function buildShareUrl(
  form: AnalyzerFormState,
  origin: string,
  pathname: string,
  extras: ViewExtras = BLANK_VIEW_EXTRAS,
): string {
  return `${origin}${pathname}?${toViewParams(form, extras).toString()}`;
}
