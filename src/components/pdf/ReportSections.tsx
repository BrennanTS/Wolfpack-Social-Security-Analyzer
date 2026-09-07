import { Text, View } from '@react-pdf/renderer';
import type { HouseholdAnalysis } from '../../lib/household';
import { BRAND_NAME } from '../../lib/brand';
import type { LongevitySensitivity } from '../../lib/longevity';
import { incomeChanges } from '../../lib/incomeChanges';
import { monthDateAt } from '../../lib/benefitPeriods';
import {
  applyMonth,
  filingMonth,
  monthYearLabel,
  shortMonthYearLabel,
  type CalendarMonth,
} from '../../lib/filingDates';
import {
  compactUnitFor,
  formatCompactCurrency,
  formatCurrency,
  formatCurrencyPrecise,
  personLabel,
} from '../../lib/format';
import { firstDeath } from '../../lib/incomeCliff';
import { styles } from './theme';
import * as copy from './reportCopy';

/** A month index on the band convention, as a calendar month. */
function calendarAt(monthIndex: number): CalendarMonth {
  const date = monthDateAt(monthIndex);
  return { year: date.year(), month: date.monthIndex() + 1 };
}

/* ------------------------------------------------------------------ *
 * Page 1 — the answer
 * ------------------------------------------------------------------ */

/**
 * The page a client reads first, and often the only one they read.
 *
 * Deliberately answers four questions and no others: when do I file, what
 * do I get, what do we get together, and what happens to whoever is left.
 * The current report opens on a five-column comparison of present values,
 * which is an adviser's working surface rather than an answer.
 */
export function AnswerBlock({
  analysis,
  header,
}: {
  analysis: HouseholdAnalysis;
  header?: React.ReactNode;
}) {
  const people = analysis.people.map((p) => p.person);
  const names = people.map((p, i) => personLabel(p.name, i));
  const selected = analysis.selected;
  const changes = incomeChanges(analysis);

  // Measured against the WORST plan on the comparison table, whatever it is
  // — see `versusWorstNote`. Naming "as early as you can" would compare
  // against a row that is missing from exactly the households whose optimum
  // is early.
  const worst = analysis.comparisons.reduce<typeof selected | null>(
    (low, c) => (low === null || c.expectedNpv < low.expectedNpv ? c : low),
    null,
  );
  const gain = worst ? selected.expectedNpv - worst.expectedNpv : 0;
  const gainNote = worst ? copy.versusWorstNote(gain, formatCurrency(gain), worst.label) : null;

  const peak = changes.reduce((most, c) => Math.max(most, c.total), 0);
  const death =
    people.length === 2
      ? firstDeath([people[0].id, people[1].id], analysis.finalIndexByPersonId)
      : null;
  const afterDeath = death === null ? null : changes.find((c) => c.monthIndex > death.deathMonthIndex);

  return (
    <>
      {header}
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{copy.ANSWER_TITLE}</Text>

      <View style={styles.heroRow}>
        <View style={styles.heroFacts}>
          {people.map((person, i) => (
            <View key={person.id} style={styles.heroFactRow}>
              <Text style={styles.heroFactLabel}>
                {people.length === 1 ? 'You file at' : `${names[i]} files at`}
              </Text>
              <Text style={styles.heroFactValue}>
                {selected.filingAges[i].label} — {shortMonthYearLabel(
                  filingMonth(person, selected.filingAges[i]),
                )}
              </Text>
            </View>
          ))}
          <View style={styles.heroFactRow}>
            <Text style={styles.heroFactLabel}>Together, at most</Text>
            <Text style={styles.heroFactValue}>{formatCurrencyPrecise(peak)}/mo</Text>
          </View>
          {afterDeath && (
            <View style={styles.heroFactRow}>
              <Text style={styles.heroFactLabel}>If one of you is left alone</Text>
              <Text style={styles.heroFactValue}>
                {formatCurrencyPrecise(afterDeath.total)}/mo
              </Text>
            </View>
          )}
        </View>

        <View style={styles.heroBig}>
          <Text style={styles.heroBigCap}>{copy.LIFETIME_CAPTION}</Text>
          <Text style={styles.heroBigNum}>
            {formatCompactCurrency(selected.expectedNpv, compactUnitFor(selected.expectedNpv))}
          </Text>
          {gainNote && <Text style={styles.heroBigSub}>{gainNote}</Text>}
        </View>
      </View>

    </>
  );
}

/**
 * Every month the household's income moves, and what moved it.
 *
 * Its own block rather than the tail of the answer: it is the one part of the
 * opening page whose length depends on the household — two filings and a
 * death for most, more for a household with spousal and survivor steps — so
 * it is also the part an adviser is most likely to cut for a short report.
 */
export function ChangesBlock({ analysis }: { analysis: HouseholdAnalysis }) {
  const people = analysis.people.map((p) => p.person);
  const names = people.map((p, i) => personLabel(p.name, i));
  const changes = incomeChanges(analysis);

  return (
    <>
      <Text style={styles.sectionTitle}>{copy.CHANGE_TABLE_TITLE}</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: 74 }]}>When</Text>
        <Text style={[styles.th, { flex: 1 }]}>What changes</Text>
        {names.map((name) => (
          <Text key={name} style={[styles.th, styles.thRight, { width: 74 }]}>
            {name}
          </Text>
        ))}
        <Text style={[styles.th, styles.thRight, { width: 74 }]}>Together</Text>
      </View>
      {/* `wrap={false}` on every row in this file. A row is one fact, and
          react-pdf will otherwise leave its first cells on one page and the
          sentence they belong to on the next — which is what the action
          plan's last row did the first time these blocks shared a sheet. */}
      {changes.map((change) => (
        <View key={change.monthIndex} style={styles.tableRow} wrap={false}>
          <Text style={[styles.td, { width: 74 }]}>
            {monthYearLabel(calendarAt(change.monthIndex))}
          </Text>
          <Text style={[styles.td, { flex: 1 }]}>{change.reason}</Text>
          {change.byPerson.map((amount, i) => (
            <Text key={names[i]} style={[styles.td, styles.tdRight, { width: 74 }]}>
              {amount > 0 ? formatCurrencyPrecise(amount) : '—'}
            </Text>
          ))}
          <Text style={[styles.td, styles.tdRight, styles.tdBold, { width: 74 }]}>
            {formatCurrencyPrecise(change.total)}
          </Text>
        </View>
      ))}
      <Text style={[styles.sectionDesc, { marginTop: 8 }]}>{copy.CHANGE_TABLE_NOTE}</Text>

    </>
  );
}

/* ------------------------------------------------------------------ *
 * Survivor
 * ------------------------------------------------------------------ */

/** Horizontal bars: household income in the first full year alone. */
export function SurvivorBlock({
  analysis,
}: {
  analysis: HouseholdAnalysis;
}) {
  const rows = analysis.comparisons.filter(
    (c) => typeof c.survivorIncome === 'number' && c.survivorIncome > 0,
  );
  if (rows.length < 2) return null;

  const max = Math.max(...rows.map((r) => r.survivorIncome as number));
  const worst = rows.reduce((low, r) =>
    (r.survivorIncome as number) < (low.survivorIncome as number) ? r : low,
  );
  const selected = analysis.selected.survivorIncome as number | null;

  const death =
    analysis.people.length === 2
      ? firstDeath(
          [analysis.people[0].person.id, analysis.people[1].person.id],
          analysis.finalIndexByPersonId,
        )
      : null;
  const survivorYears =
    death === null
      ? 0
      : Math.round(
          (Math.max(...Object.values(analysis.finalIndexByPersonId)) - death.deathMonthIndex) / 12,
        );

  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{copy.SURVIVOR_TITLE}</Text>
      <Text style={styles.sectionDesc}>{copy.SURVIVOR_INTRO}</Text>

      <View style={[styles.chartBox, { marginTop: 10 }]} wrap={false}>
        {rows.map((row) => {
          const value = row.survivorIncome as number;
          const isSelected = row.key === analysis.selected.key;
          return (
            <View key={row.key} style={styles.barRow} wrap={false}>
              <Text style={styles.barLabel}>{row.label}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${Math.max(2, (value / max) * 100)}%` },
                    isSelected ? {} : styles.barFillDim,
                  ]}
                />
              </View>
              <Text style={styles.barValue}>{formatCurrency(value)}</Text>
            </View>
          );
        })}
      </View>
      <Text style={[styles.sectionDesc, { marginTop: 6 }]}>{copy.SURVIVOR_CHART_CAPTION}</Text>

      {/* `wrap={false}` on both callouts: they are bordered boxes. Flowed
          after the survivor bars, this one split at the foot of a page — its
          left rule on one sheet and its sentence on the next — exactly as the
          disclaimer box once did. */}
      {selected !== null && selected > (worst.survivorIncome as number) && (
        <View style={styles.callout} wrap={false}>
          <Text style={styles.calloutText}>
            {copy.survivorGainNote(
              formatCurrency(selected - (worst.survivorIncome as number)),
              worst.label,
              survivorYears,
            )}
          </Text>
        </View>
      )}

    </>
  );
}

/* ------------------------------------------------------------------ *
 * Longevity
 * ------------------------------------------------------------------ */

/** Every plan priced at three lifespans — see `longevitySensitivity`. */
export function LongevityBlock({
  sensitivity,
}: {
  sensitivity: LongevitySensitivity;
}) {
  const { rows, strategies } = sensitivity;
  if (strategies.length === 0) return null;
  // Thousands, not whatever `compactUnitFor` picks from the maximum.
  //
  // A household's lifetime value crosses a million and the millions unit
  // resolves to about $10,000, which is coarser than the gaps this table
  // exists to show: two strategies $4,000 apart both printed $0.47m on the
  // same row, directly under a verdict saying one of them wins every row.
  // The table is three columns wide and can afford the digits.
  const unit = 'thousands' as const;
  const winnerLabel =
    strategies.find((s) => s.key === sensitivity.winsEveryRow)?.label ?? null;
  const dropped = copy.longevityDroppedNote(sensitivity.droppedKeys);

  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{copy.LONGEVITY_TITLE}</Text>
      <Text style={styles.sectionDesc}>{copy.LONGEVITY_INTRO}</Text>

      <View style={[styles.tableHeader, { marginTop: 10 }]}>
        <Text style={[styles.th, { flex: 1 }]}>If you live to</Text>
        {strategies.map((s) => (
          <Text key={s.key} style={[styles.th, styles.thRight, { width: 104 }]}>
            {s.label}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <View
          key={row.label}
          style={[styles.tableRow, row.isPlanned ? styles.tableRowOptimal : {}]}
          wrap={false}
        >
          <Text style={[styles.td, { flex: 1 }, row.isPlanned ? styles.tdBold : {}]}>
            {row.label}
          </Text>
          {strategies.map((s) => (
            <Text
              key={s.key}
              style={[
                styles.td,
                styles.tdRight,
                { width: 104 },
                row.bestKey === s.key ? styles.winnerText : {},
              ]}
            >
              {formatCompactCurrency(row.valueByKey[s.key], unit)}
            </Text>
          ))}
        </View>
      ))}

      <View style={styles.callout} wrap={false}>
        <Text style={styles.calloutText}>
          {copy.longevityVerdict(winnerLabel, sensitivity.tiedEveryRow)}
        </Text>
      </View>
      {dropped && <Text style={[styles.sectionDesc, { marginTop: 8 }]}>{dropped}</Text>}

    </>
  );
}

/* ------------------------------------------------------------------ *
 * Action plan
 * ------------------------------------------------------------------ */

/** Dated steps with tick boxes — the page a client can act on. */
export function ActionBlock({
  analysis,
}: {
  analysis: HouseholdAnalysis;
}) {
  const people = analysis.people.map((p) => p.person);
  const names = people.map((p, i) => personLabel(p.name, i));

  const filings = people
    .map((person, i) => ({
      person,
      who: names[i],
      apply: applyMonth(filingMonth(person, analysis.selected.filingAges[i])),
      starts: filingMonth(person, analysis.selected.filingAges[i]),
    }))
    .sort((a, b) => a.apply.year * 12 + a.apply.month - (b.apply.year * 12 + b.apply.month));

  const steps: { when: string; who: string; what: string }[] = [
    ...filings.map((f) => ({
      when: monthYearLabel(f.apply),
      who: f.who,
      what: `Apply, so payments start in ${monthYearLabel(f.starts)}.`,
    })),
    {
      when: 'After applying',
      who: people.length === 2 ? 'Each of you' : 'You',
      what: copy.ACTION_VERIFY_STEP,
    },
    { when: 'Every year', who: people.length === 2 ? 'Both of you' : 'You', what: copy.ACTION_CHECK_EARNINGS },
  ];
  if (people.length === 2) {
    steps.push({ when: 'If one of you dies', who: 'The survivor', what: copy.ACTION_DEATH_STEP });
  }

  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{copy.ACTION_TITLE}</Text>
      <Text style={styles.sectionDesc}>
        {copy.ACTION_INTRO} {copy.ACTION_APPLY_NOTE}
      </Text>

      <View style={[styles.tableHeader, { marginTop: 10 }]}>
        <Text style={[styles.th, { width: 18 }]}> </Text>
        <Text style={[styles.th, { width: 92 }]}>When</Text>
        <Text style={[styles.th, { width: 84 }]}>Who</Text>
        <Text style={[styles.th, { flex: 1 }]}>What to do</Text>
      </View>
      {steps.map((step) => (
        <View key={`${step.when}-${step.who}`} style={styles.tableRow} wrap={false}>
          <View style={{ width: 18, paddingTop: 2 }}>
            <View style={styles.checkbox} />
          </View>
          <Text style={[styles.td, styles.tdBold, { width: 92 }]}>{step.when}</Text>
          <Text style={[styles.td, { width: 84 }]}>{step.who}</Text>
          <Text style={[styles.td, { flex: 1 }]}>{step.what}</Text>
        </View>
      ))}

      <Text style={[styles.sectionDesc, { marginTop: 10 }]}>{copy.ACTION_REVIEW_NOTE}</Text>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Terms
 * ------------------------------------------------------------------ */

/** The glossary five of the six competing reports carry and ours does not. */
export function TermsBlock({
  analysis,
}: {
  analysis: HouseholdAnalysis;
}) {
  const names = analysis.people.map((p, i) => personLabel(p.person.name, i));
  const ages = analysis.people.map((p) => p.person.lifeExpectancy);

  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>Words used in this report</Text>
      {copy.KEY_TERMS.map((term) => (
        <View key={term.term} style={styles.termRow} wrap={false}>
          <Text style={styles.termName}>{term.term}</Text>
          <Text style={styles.termBody}>{term.body}</Text>
        </View>
      ))}

      {/* Heading, intro and the one paragraph move as ONE block. Left to
          flow, the heading printed alone at the foot of page 3 with its body
          on page 4 — the same orphan the claiming grid's heading once was. */}
      <View wrap={false}>
        <Text style={styles.sectionTitle}>{copy.ASSUMPTIONS_TITLE}</Text>
        <Text style={styles.sectionDesc}>{copy.ASSUMPTIONS_INTRO}</Text>
        <View style={styles.termRow}>
          <Text style={styles.termBody}>{copy.planToNote(names, ages)}</Text>
        </View>
      </View>
    </>
  );
}

/**
 * The methodology appendix on a page of its own.
 *
 * `MethodologyAppendix` is a FRAGMENT of `Text` and `View`, not a `Page` —
 * as a direct child of `Document` it breaks pagination outright, and tacked
 * onto the end of the terms page it filled that page to the last point and
 * spilled an empty twelfth page carrying nothing but a footer. Its own page
 * is also the better reading: the terms are for the client, this is not.
 */
export function MethodologyBlock({
  appendix,
}: {
  appendix: React.ReactNode;
}) {
  return (
    <>
      {appendix}
    </>
  );
}


/* ------------------------------------------------------------------ *
 * Cover
 * ------------------------------------------------------------------ */

/**
 * The first sheet, when the layout asks for one.
 *
 * Every one of the six competing reports opens on a cover naming the client;
 * ours opened on a table. A block rather than a fixed page so an adviser
 * printing a two-page summary for their own desk can leave it out.
 */
export function CoverBlock({
  analysis,
  dateLabel,
}: {
  analysis: HouseholdAnalysis;
  dateLabel: string;
}) {
  const names = analysis.people.map((p, i) => personLabel(p.person.name, i));
  const hasSpouse = analysis.people.length === 2;
  return (
    <>
      <View style={styles.coverBand}>
        <Text style={styles.coverTitle}>{copy.COVER_TITLE}</Text>
        <Text style={styles.coverSub}>{copy.coverSubtitle(hasSpouse)}</Text>
      </View>
      <Text style={styles.coverLabel}>{copy.COVER_PREPARED_FOR}</Text>
      <Text style={styles.coverName}>{names.join(' and ')}</Text>
      <Text style={styles.coverDate}>{dateLabel}</Text>
      <Text style={styles.coverLabel}>{copy.COVER_PREPARED_BY}</Text>
      <Text style={styles.coverFirm}>{BRAND_NAME}</Text>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Introduction
 * ------------------------------------------------------------------ */

/** The trade-off in one sentence, then the questions the report answers. */
export function IntroBlock({ analysis }: { analysis: HouseholdAnalysis }) {
  const hasSpouse = analysis.people.length === 2;
  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{copy.INTRO_TITLE}</Text>
      <Text style={styles.calloutText}>{copy.INTRO_LEAD}</Text>
      <View style={{ marginTop: 10, marginBottom: 6 }}>
        {copy.introQuestions(hasSpouse).map((q, i) => (
          <View key={q} style={styles.questionRow} wrap={false}>
            <Text style={styles.questionMark}>{i + 1}.</Text>
            <Text style={styles.questionText}>{q}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.sectionDesc}>{copy.INTRO_HOW_TO_READ}</Text>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * What this report does not include
 * ------------------------------------------------------------------ */

/** The edges of the report, named — the most trustworthy page a report can carry. */
export function LimitsBlock() {
  return (
    <>
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{copy.LIMITS_TITLE}</Text>
      <Text style={styles.sectionDesc}>{copy.LIMITS_INTRO}</Text>
      {copy.LIMITS.map((limit) => (
        <View key={limit.term} style={styles.termRow} wrap={false}>
          <Text style={styles.termName}>{limit.term}</Text>
          <Text style={styles.termBody}>{limit.body}</Text>
        </View>
      ))}
    </>
  );
}
