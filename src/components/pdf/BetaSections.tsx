import { Page, Text, View } from '@react-pdf/renderer';
import type { HouseholdAnalysis } from '../../lib/household';
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
import { styles, BORDER, CHART_INNER_W, GOLD, INK, MUTED } from './theme';
import * as copy from './betaCopy';

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
export function BetaAnswerSection({
  analysis,
  footer,
  header,
}: {
  analysis: HouseholdAnalysis;
  footer: React.ReactNode;
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
    <Page size="LETTER" style={styles.page}>
      {header}
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{copy.ANSWER_TITLE}</Text>

      <View style={styles.betaHero}>
        <View style={styles.betaFacts}>
          {people.map((person, i) => (
            <View key={person.id} style={styles.betaFactRow}>
              <Text style={styles.betaFactLabel}>
                {people.length === 1 ? 'You file at' : `${names[i]} files at`}
              </Text>
              <Text style={styles.betaFactValue}>
                {selected.filingAges[i].label} — {shortMonthYearLabel(
                  filingMonth(person, selected.filingAges[i]),
                )}
              </Text>
            </View>
          ))}
          <View style={styles.betaFactRow}>
            <Text style={styles.betaFactLabel}>Together, at most</Text>
            <Text style={styles.betaFactValue}>{formatCurrencyPrecise(peak)}/mo</Text>
          </View>
          {afterDeath && (
            <View style={styles.betaFactRow}>
              <Text style={styles.betaFactLabel}>If one of you is left alone</Text>
              <Text style={styles.betaFactValue}>
                {formatCurrencyPrecise(afterDeath.total)}/mo
              </Text>
            </View>
          )}
        </View>

        <View style={styles.betaBig}>
          <Text style={styles.betaBigCap}>{copy.LIFETIME_CAPTION}</Text>
          <Text style={styles.betaBigNum}>
            {formatCompactCurrency(selected.expectedNpv, compactUnitFor(selected.expectedNpv))}
          </Text>
          {gainNote && <Text style={styles.betaBigSub}>{gainNote}</Text>}
        </View>
      </View>

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
      {changes.map((change) => (
        <View key={change.monthIndex} style={styles.tableRow}>
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

      {footer}
    </Page>
  );
}

/* ------------------------------------------------------------------ *
 * Survivor
 * ------------------------------------------------------------------ */

/** Horizontal bars: household income in the first full year alone. */
export function BetaSurvivorSection({
  analysis,
  footer,
}: {
  analysis: HouseholdAnalysis;
  footer: React.ReactNode;
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
    <Page size="LETTER" style={styles.page}>
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{copy.SURVIVOR_TITLE}</Text>
      <Text style={styles.sectionDesc}>{copy.SURVIVOR_INTRO}</Text>

      <View style={[styles.chartBox, { marginTop: 10 }]} wrap={false}>
        {rows.map((row) => {
          const value = row.survivorIncome as number;
          const isSelected = row.key === analysis.selected.key;
          return (
            <View key={row.key} style={styles.betaBarRow}>
              <Text style={styles.betaBarLabel}>{row.label}</Text>
              <View style={styles.betaBarTrack}>
                <View
                  style={[
                    styles.betaBarFill,
                    { width: `${Math.max(2, (value / max) * 100)}%` },
                    isSelected ? {} : styles.betaBarFillDim,
                  ]}
                />
              </View>
              <Text style={styles.betaBarValue}>{formatCurrency(value)}</Text>
            </View>
          );
        })}
      </View>
      <Text style={[styles.sectionDesc, { marginTop: 6 }]}>{copy.SURVIVOR_CHART_CAPTION}</Text>

      {selected !== null && selected > (worst.survivorIncome as number) && (
        <View style={styles.betaCallout}>
          <Text style={styles.betaCalloutText}>
            {copy.survivorGainNote(
              formatCurrency(selected - (worst.survivorIncome as number)),
              worst.label,
              survivorYears,
            )}
          </Text>
        </View>
      )}

      {footer}
    </Page>
  );
}

/* ------------------------------------------------------------------ *
 * Longevity
 * ------------------------------------------------------------------ */

/** Every plan priced at three lifespans — see `longevitySensitivity`. */
export function BetaLongevitySection({
  sensitivity,
  footer,
}: {
  sensitivity: LongevitySensitivity;
  footer: React.ReactNode;
}) {
  const { rows, strategies } = sensitivity;
  if (strategies.length === 0) return null;
  const unit = compactUnitFor(
    Math.max(...rows.flatMap((r) => strategies.map((s) => r.valueByKey[s.key]))),
  );
  const winnerLabel =
    strategies.find((s) => s.key === sensitivity.winsEveryRow)?.label ?? null;
  const dropped = copy.longevityDroppedNote(sensitivity.droppedKeys);

  return (
    <Page size="LETTER" style={styles.page}>
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
                row.bestKey === s.key ? styles.betaWinner : {},
              ]}
            >
              {formatCompactCurrency(row.valueByKey[s.key], unit)}
            </Text>
          ))}
        </View>
      ))}

      <View style={styles.betaCallout}>
        <Text style={styles.betaCalloutText}>{copy.longevityVerdict(winnerLabel)}</Text>
      </View>
      {dropped && <Text style={[styles.sectionDesc, { marginTop: 8 }]}>{dropped}</Text>}

      {footer}
    </Page>
  );
}

/* ------------------------------------------------------------------ *
 * Action plan
 * ------------------------------------------------------------------ */

/** Dated steps with tick boxes — the page a client can act on. */
export function BetaActionSection({
  analysis,
  footer,
}: {
  analysis: HouseholdAnalysis;
  footer: React.ReactNode;
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
    { when: 'Every year', who: 'Both of you', what: copy.ACTION_CHECK_EARNINGS },
  ];
  if (people.length === 2) {
    steps.push({ when: 'If one of you dies', who: 'The survivor', what: copy.ACTION_DEATH_STEP });
  }

  return (
    <Page size="LETTER" style={styles.page}>
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
        <View key={`${step.when}-${step.who}`} style={styles.tableRow}>
          <View style={{ width: 18, paddingTop: 2 }}>
            <View style={styles.betaCheckbox} />
          </View>
          <Text style={[styles.td, styles.tdBold, { width: 92 }]}>{step.when}</Text>
          <Text style={[styles.td, { width: 84 }]}>{step.who}</Text>
          <Text style={[styles.td, { flex: 1 }]}>{step.what}</Text>
        </View>
      ))}

      <Text style={[styles.sectionDesc, { marginTop: 10 }]}>{copy.ACTION_REVIEW_NOTE}</Text>
      {footer}
    </Page>
  );
}

/* ------------------------------------------------------------------ *
 * Terms
 * ------------------------------------------------------------------ */

/** The glossary five of the six competing reports carry and ours does not. */
export function BetaTermsSection({
  analysis,
  footer,
  appendix,
}: {
  analysis: HouseholdAnalysis;
  footer: React.ReactNode;
  /**
   * `MethodologyAppendix`, which is a FRAGMENT of `Text` and `View` rather
   * than a `Page` — it has to be rendered inside one. Passing it as a direct
   * child of `Document` breaks pagination outright, with an error that names
   * neither the component nor the reason.
   */
  appendix?: React.ReactNode;
}) {
  const names = analysis.people.map((p, i) => personLabel(p.person.name, i));
  const ages = analysis.people.map((p) => p.person.lifeExpectancy);

  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>Words used in this report</Text>
      {copy.KEY_TERMS.map((term) => (
        <View key={term.term} style={styles.betaTerm} wrap={false}>
          <Text style={styles.betaTermName}>{term.term}</Text>
          <Text style={styles.betaTermBody}>{term.body}</Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>{copy.ASSUMPTIONS_TITLE}</Text>
      <Text style={styles.sectionDesc}>{copy.ASSUMPTIONS_INTRO}</Text>
      <View style={styles.betaTerm}>
        <Text style={styles.betaTermBody}>{copy.planToNote(names, ages)}</Text>
      </View>
      {appendix}
      {footer}
    </Page>
  );
}

export const BETA_CHART_WIDTH = CHART_INNER_W;
export const BETA_TOKENS = { BORDER, GOLD, INK, MUTED };
