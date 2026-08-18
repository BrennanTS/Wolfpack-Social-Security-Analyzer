import type { ReactNode } from 'react';
import { Page, Text, View } from '@react-pdf/renderer';
import {
  buildMonthlyIncomeSeries,
  type HouseholdAnalysis,
} from '../../lib/household';
import { formatCurrency, formatCurrencyPrecise, fraLabel, personLabel } from '../../lib/format';
import {
  monthYear,
  piaEstimateNote,
  WIDOWED_COMPARISON_HEADING,
  WIDOWED_DECEASED_HEADING,
  WIDOWED_HEADERS,
  widowedIncomeCaption,
  widowedLifetimeCaption,
} from '../widowedCopy';
import { widowedBenefitsOverlap, widowedStages } from '../../lib/widowedStages';
import { CombinedIncomeBars } from './HouseholdSection';
import { MONTHS, styles } from './theme';
import { PageFooter } from './ReportDocument';

/** Shared with `WidowedPanel` in spirit; see its own note on why a stage is not an increment. */
function stageLabel(types: readonly string[]): string {
  if (types.length > 1) return 'Both benefits';
  return types[0] === 'survivor' ? 'Survivor benefit' : 'Own record';
}

interface Props {
  analysis: HouseholdAnalysis;
  footerText: string;
  appendix?: ReactNode;
  leadingHeader?: ReactNode;
}

/** Widowed comparison columns (must sum to CONTENT_W). */
const WCOL = { label: 168, survivor: 92, own: 92, lifetime: 90, delta: 94 };

/**
 * The printed report for a widow(er): the same four things the screen shows,
 * in the same order, from the same copy module.
 *
 * A separate page rather than a branch inside `PersonSection` for the reason
 * `WidowedPanel` is separate from `PersonPanel`: that section is built around
 * `claimingOptions`, which `analyzeWidowed` deliberately empties, and its
 * benefit table, its four charts and its break-even block all read it. The
 * two surfaces are twins of each other, not of the single-claimant report.
 */
export function WidowedSection({ analysis, footerText, appendix, leadingHeader }: Props) {
  const [person] = analysis.people;
  const label = personLabel(person.person.name, 0);
  const { deceased } = analysis;
  const monthlySeries = buildMonthlyIncomeSeries(analysis.periods, [person.person]);

  // The same stages the screen shows, from the same function — see
  // `widowedStages` for why this is not a three-figure component split.
  const stages = widowedStages(analysis.periods, person.person);

  const estimateNote =
    deceased === null ? null : piaEstimateNote(deceased, analysis.piaEstimated === true);

  return (
    <Page size="LETTER" style={styles.page}>
      {leadingHeader}
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{label}</Text>

      <View style={styles.profileGrid}>
        {[
          ['Date of Birth', `${MONTHS[person.person.birthMonth - 1]} ${person.person.birthYear}`],
          ['Full Retirement Age', fraLabel(person.fra)],
          ['Own Benefit at FRA', `${formatCurrencyPrecise(person.person.piaMonthly)}/mo`],
          ['Life Expectancy', `Age ${person.person.lifeExpectancy}`],
        ].map(([k, v]) => (
          <View key={k} style={styles.profileItem}>
            <Text style={styles.profileLabel}>{k}</Text>
            <Text style={styles.profileValue}>{v}</Text>
          </View>
        ))}
      </View>

      <View style={styles.recBox}>
        <Text style={styles.recEyebrow}>Recommended Strategy</Text>
        <Text style={styles.recHeadline}>{analysis.recommendation}</Text>
        <Text style={styles.recBody}>{analysis.recommendationDetail}</Text>
        <View style={styles.recMetrics}>
          {stages.map((stage) => (
            <View key={stage.startIndex} style={styles.recMetricBlock}>
              <Text style={styles.recMetricValue}>{formatCurrencyPrecise(stage.monthly)}</Text>
              <Text style={styles.recMetricLabel}>
                {stageLabel(stage.types)}, from {stage.ageLabel}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={styles.sectionTitle}>{WIDOWED_COMPARISON_HEADING}</Text>
      <View>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { width: WCOL.label }]}>{WIDOWED_HEADERS.strategy}</Text>
          <Text style={[styles.th, { width: WCOL.survivor }]}>{WIDOWED_HEADERS.survivorAge}</Text>
          <Text style={[styles.th, { width: WCOL.own }]}>{WIDOWED_HEADERS.ownAge}</Text>
          <Text style={[styles.th, { width: WCOL.lifetime }]}>{WIDOWED_HEADERS.lifetime}</Text>
          <Text style={[styles.th, { width: WCOL.delta }]}>{WIDOWED_HEADERS.delta}</Text>
        </View>
        {analysis.comparisons.map((row) => (
          <View
            key={row.key}
            style={[styles.tableRow, row.isOptimal ? styles.tableRowOptimal : {}]}
          >
            <View style={[styles.tdAge, { width: WCOL.label }]}>
              <Text style={styles.tdBold}>{row.label}</Text>
              {row.isOptimal && <Text style={styles.badge}>BEST</Text>}
            </View>
            <Text style={[styles.td, { width: WCOL.survivor }]}>
              {row.survivorClaimDate?.age ?? '—'}
            </Text>
            <Text style={[styles.td, { width: WCOL.own }]}>{row.filingAges[0].label}</Text>
            <Text style={[styles.td, { width: WCOL.lifetime }]}>
              {/* `lifetimeTotal`, never `expectedNpv` — see `WidowedPanel`. */}
              {row.lifetimeTotal === null ? '—' : formatCurrency(row.lifetimeTotal)}
            </Text>
            <Text
              style={[styles.td, { width: WCOL.delta }, row.deltaVsOptimal < 0 ? styles.negative : {}]}
            >
              {row.deltaVsOptimal === 0 ? '—' : formatCurrency(row.deltaVsOptimal)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={[styles.sectionDesc, { marginTop: 6 }]}>
        {widowedLifetimeCaption(person.person.lifeExpectancy)}
      </Text>

      <Text style={styles.sectionTitle}>Income Over Time</Text>
      <View style={styles.chartBox} wrap={false}>
        <CombinedIncomeBars monthlySeries={monthlySeries} people={[person.person]} />
      </View>
      <Text style={styles.sectionDesc}>
        {widowedIncomeCaption('real', widowedBenefitsOverlap(analysis.periods))}
      </Text>

      {deceased !== null && (
        <>
          <Text style={styles.sectionTitle}>{WIDOWED_DECEASED_HEADING}</Text>
          <View style={styles.profileGrid}>
            {[
              ['Date of Birth', monthYear(deceased.birthYear, deceased.birthMonth)],
              ['Date of Death', monthYear(deceased.deathYear, deceased.deathMonth)],
              [
                deceased.filed ? 'Filed' : 'Had Not Filed',
                deceased.filed ? monthYear(deceased.filed.year, deceased.filed.month) : '—',
              ],
              ['Benefit at FRA', `${formatCurrencyPrecise(deceased.piaMonthly)}/mo`],
            ].map(([k, v]) => (
              <View key={k} style={styles.profileItem}>
                <Text style={styles.profileLabel}>{k}</Text>
                <Text style={styles.profileValue}>{v}</Text>
              </View>
            ))}
          </View>
          {estimateNote !== null && (
            <Text style={[styles.sectionDesc, { marginTop: 6 }]}>{estimateNote}</Text>
          )}
        </>
      )}

      {appendix}

      <PageFooter text={footerText} />
    </Page>
  );
}
