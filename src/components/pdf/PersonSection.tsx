import type { ReactNode } from 'react';
import { Page, Text, View } from '@react-pdf/renderer';
import { computeBreakEvens } from '../../lib/benefitMath';
import {
  formatCurrency,
  formatCurrencyPrecise,
  fraLabel,
  personLabel,
  yearsMonthsLabel,
} from '../../lib/format';
import type { PersonAnalysis } from '../../lib/personAnalysis';
import { visibleClaimingRows, type ClaimingRow } from '../../lib/claimingRows';
import { scenarioEyebrow } from '../../lib/scenario';
import { soloVsHouseholdNote } from '../methodologyCopy';
import { nearestWholeClaimAge } from '../../lib/ssaTools';
import { PdfChart, PdfHeatmap, PdfMonthlyRamp, PdfOpportunityCost } from './charts';
import { COL, MONTHS, styles } from './theme';
import { PageFooter } from './ReportDocument';

interface Props {
  analysis: PersonAnalysis;
  index: 0 | 1;
  annualCola: number;
  /**
   * Whether this person's `filingAge` is the optimizer's own pick. Threaded
   * down from `ReportDocument` rather than read off `PersonAnalysis`, which
   * carries the filing age but not the reason for it. Defaults to true — what
   * every call site meant before scenarios existed.
   */
  isBest?: boolean;
  /**
   * The rows of this person's benefit table, hidden ones included and flagged
   * — the SAME array the screen renders, built once in `Analyzer`. Hiding a
   * row on screen therefore hides it here too, which is the whole point of a
   * single eye control per row.
   *
   * Optional: without it this falls back to the whole-year claiming options,
   * which is exactly what the report printed before the table became
   * editable.
   */
  claimingRows?: ClaimingRow[];
  footerText: string;
  appendix?: ReactNode;
  leadingHeader?: ReactNode;
}

function BenefitTable({
  rows,
  optimalLifetime,
  baselineAge,
  optimalRowId,
  soloRowId,
  shownRowId,
}: {
  rows: ClaimingRow[];
  optimalLifetime: number;
  /**
   * The age every `vs.` figure is measured FROM — the shown scenario, which
   * is what `optimalLifetime` above is the lifetime of. Named in the header
   * rather than left as "vs. Optimal", which claimed the baseline was the
   * optimizer's answer while six of nine rows printed a positive number
   * against it.
   */
  baselineAge: number;
  optimalRowId: string;
  /**
   * The row this person would file at ALONE. Empty only for a lone claimant,
   * who has no household answer to be contrasted with; a married person whose
   * two answers coincide still gets it, on the same row as TOGETHER.
   */
  soloRowId: string;
  /** The row the page's figures come from, when that is not the optimum. */
  shownRowId: string;
}) {
  return (
    <View>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: COL.age }]}>Age</Text>
        <Text style={[styles.th, { width: COL.monthly }]}>Monthly</Text>
        <Text style={[styles.th, { width: COL.pia }]}>% PIA</Text>
        <Text style={[styles.th, { width: COL.life }]}>Lifetime</Text>
        <Text style={[styles.th, { width: COL.diff }]}>vs. Age {baselineAge}</Text>
      </View>
      {rows.map((row) => {
        const diff = row.lifetimeBenefits - optimalLifetime;
        const isOptimal = row.id === optimalRowId;
        return (
          <View key={row.id} style={[styles.tableRow, isOptimal ? styles.tableRowOptimal : {}]}>
            <View style={[styles.tdAge, { width: COL.age }]}>
              <Text style={styles.tdBold}>{row.label}</Text>
              {/* Same rule as the screen: TOGETHER whenever this person has
                  a spouse, so the pair with ALONE stays legible even where
                  both land on one row. OPT for a lone claimant, who has no
                  second answer to be distinguished from. */}
              {isOptimal && (
                <Text style={styles.badge}>{soloRowId === '' ? 'OPT' : 'TOGETHER'}</Text>
              )}
              {soloRowId !== '' && row.id === soloRowId && (
                <Text style={styles.badgeShown}>ALONE</Text>
              )}
              {shownRowId !== '' && row.id === shownRowId && (
                <Text style={styles.badgeShown}>SHOWN</Text>
              )}
            </View>
            <Text style={[styles.td, { width: COL.monthly }]}>
              {formatCurrencyPrecise(row.monthlyBenefit)}
            </Text>
            <Text style={[styles.td, { width: COL.pia }]}>{row.percentOfPia}%</Text>
            <Text style={[styles.td, { width: COL.life }]}>
              {formatCurrency(row.lifetimeBenefits)}
            </Text>
            <Text style={[styles.td, { width: COL.diff }, diff < 0 ? styles.negative : {}]}>
              {diff === 0 ? '—' : formatCurrency(diff)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * One person's full claiming breakdown: profile summary, recommendation,
 * benefit-by-age table, and the four supporting charts. This is the entire
 * report for a single claimant (no `HouseholdSection` precedes it), and one
 * of two per-person pages for a married household — so it stays
 * self-contained rather than assuming a household header already ran.
 */
export function PersonSection({ analysis, index, annualCola, isBest = true, claimingRows, footerText, appendix, leadingHeader }: Props) {
  const { person, fra, currentAge, claimingOptions, filingAge, monthlyAtFilingAge, ssaSuggestedLifeExpectancy } =
    analysis;
  const name = personLabel(person.name, index);
  // `shownAge`, not `optimalAge`. It is the SELECTED scenario rounded to a
  // whole claiming age, and it was named for the optimizer's answer — which
  // is how five labels on this page came to call the adviser's own choice
  // "optimal", on the same page as a note saying the optimizer chose
  // something else. See `householdBestFilingAge` for the three ages.
  const shownAge = nearestWholeClaimAge(filingAge.decimalYears);
  const optimal = claimingOptions.find((o) => o.age === shownAge) ?? claimingOptions[0];
  const dob = `${MONTHS[person.birthMonth - 1]} ${person.birthYear}`;
  const breakEvens = computeBreakEvens(claimingOptions, annualCola);

  // The table's own rows. `claimingOptions` still drives every chart below —
  // hiding a table row is a table decision, not a change to the analysis.
  const tableRows = visibleClaimingRows(
    claimingRows ??
      claimingOptions.map((o) => ({
        id: String(o.age),
        years: o.age,
        months: 0,
        label: String(o.age),
        monthlyBenefit: o.monthlyBenefit,
        percentOfPia: o.percentOfPia,
        lifetimeBenefits: o.lifetimeBenefits,
        isEligible: o.isEligible,
        added: false,
        hidden: false,
      })),
  );
  // An added row sitting exactly on the filing age wins the badge over the
  // rounded whole year, the same rule the screen table applies.
  const exactRow = tableRows.find(
    (r) => r.years === analysis.filingAge.years && r.months === analysis.filingAge.months,
  );
  const optimalRow = exactRow ?? tableRows.find((r) => r.months === 0 && r.years === shownAge);

  // `== null` — an analysis built before this field existed carries
  // `undefined`, not `null`. See `PersonPanel` for the same convention.
  // Three ages, as on screen — see `householdBestFilingAge`. `shownAge`
  // above is the SHOWN scenario's, which is what the charts mark.
  const bestTogetherAge = nearestWholeClaimAge(
    (analysis.householdBestFilingAge ?? analysis.filingAge).decimalYears,
  );
  const bestTogetherRow = tableRows.find(
    (r) => r.months === 0 && r.years === bestTogetherAge,
  );
  const soloAge =
    analysis.soloFilingAge == null
      ? null
      : nearestWholeClaimAge(analysis.soloFilingAge.decimalYears);
  // Found whenever this person has a solo answer at all, even where it lands
  // on the same row as the household's — see `PersonPanel` for why the pair
  // of badges is worth more than the one. `soloRowId` non-empty is therefore
  // "this person has a spouse", which is what picks TOGETHER over OPT.
  const soloRow =
    soloAge === null ? undefined : tableRows.find((r) => r.months === 0 && r.years === soloAge);
  const soloDiffers = soloAge !== null && soloAge !== bestTogetherAge;
  const shownDiffers = shownAge !== bestTogetherAge;

  return (
    <Page size="LETTER" style={styles.page}>
      {leadingHeader}
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>{name}</Text>

      <View style={styles.profileGrid}>
        {[
          ['Date of Birth', dob],
          ['Current Age', yearsMonthsLabel(currentAge.years, currentAge.months)],
          ['Full Retirement Age', fraLabel(fra)],
          ['PIA (Benefit at FRA)', `${formatCurrencyPrecise(person.piaMonthly)}/mo`],
          ['Life Expectancy', `Age ${person.lifeExpectancy}`],
          ['SSA Suggested Age', `Age ${ssaSuggestedLifeExpectancy}`],
        ].map(([label, value]) => (
          <View key={label} style={styles.profileItem}>
            <Text style={styles.profileLabel}>{label}</Text>
            <Text style={styles.profileValue}>{value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.recBox}>
        <Text style={styles.recEyebrow}>{scenarioEyebrow(isBest)}</Text>
        <Text style={styles.recHeadline}>File at age {filingAge.label}</Text>
        <Text style={styles.recBody}>
          {name} filing at age {filingAge.label} yields {formatCurrency(monthlyAtFilingAge)}
          /month, {optimal.percentOfPia}% of PIA.
        </Text>
        <View style={styles.recMetrics}>
          <View style={styles.recMetricBlock}>
            <Text style={styles.recMetricValue}>{formatCurrency(monthlyAtFilingAge)}</Text>
            <Text style={styles.recMetricLabel}>Monthly at age {filingAge.label}</Text>
          </View>
          <View style={styles.recMetricBlock}>
            <Text style={styles.recMetricValue}>{formatCurrency(optimal.lifetimeBenefits)}</Text>
            <Text style={styles.recMetricLabel}>Lifetime through age {person.lifeExpectancy}</Text>
          </View>
          <View style={styles.recMetricBlock}>
            <Text style={styles.recMetricValue}>{optimal.percentOfPia}%</Text>
            <Text style={styles.recMetricLabel}>Of PIA</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Benefit Comparison by Claiming Age</Text>
      <Text style={styles.sectionDesc}>
        Monthly benefit and lifetime total through age {person.lifeExpectancy}, in
        today&rsquo;s dollars before any future cost-of-living adjustment, undiscounted
      </Text>
      <BenefitTable
        rows={tableRows}
        optimalLifetime={optimalRow?.lifetimeBenefits ?? optimal.lifetimeBenefits}
        baselineAge={shownAge}
        optimalRowId={bestTogetherRow?.id ?? ''}
        soloRowId={soloRow?.id ?? ''}
        shownRowId={shownDiffers ? (optimalRow?.id ?? '') : ''}
      />
      {(soloDiffers || shownDiffers) && (
        <Text style={[styles.sectionDesc, { marginTop: 6 }]}>
          {soloVsHouseholdNote(
            name,
            (analysis.householdBestFilingAge ?? analysis.filingAge).label,
            soloDiffers ? (analysis.soloFilingAge?.label ?? null) : null,
            shownDiffers ? analysis.filingAge.label : null,
          )}
        </Text>
      )}

      <Text style={styles.sectionTitle}>Cumulative Lifetime Benefits</Text>
      <Text style={styles.sectionDesc}>
        Comparing claim-at-62, 67, and 70. Red dashed line = life expectancy (age{' '}
        {person.lifeExpectancy}).
      </Text>
      <View style={styles.chartSection}>
        <View style={styles.chartBox} wrap={false}>
          <PdfChart
            options={claimingOptions}
            lifeExpectancy={person.lifeExpectancy}
            optimalAge={shownAge}
            annualCola={annualCola}
          />
        </View>
      </View>

      {breakEvens.length > 0 && (
        <View style={styles.beSection}>
          <Text style={styles.sectionTitle}>Break-Even Analysis</Text>
          <Text style={styles.sectionDesc}>
            Age when a later claiming strategy surpasses an earlier one in total benefits
          </Text>
          <View style={styles.beRow}>
            {breakEvens.map((be, i) => {
              const favorsLater = person.lifeExpectancy >= be.breakEvenAge;
              const isLast = i === breakEvens.length - 1;
              return (
                <View
                  key={`${be.earlierAge}-${be.laterAge}`}
                  style={[styles.beCard, isLast ? styles.beCardLast : {}]}
                >
                  {/* "vs." rather than the screen's arrow: react-pdf's built-in
                      Helvetica has no U+2192 glyph, and printed it as a stray
                      apostrophe that also swallowed the space after it —
                      "Age 62 ' Age67". Every character this report prints has
                      to be one the standard-14 fonts carry; see
                      `pdfSafeText.ts`. */}
                  <Text style={styles.bePair}>
                    Age {be.earlierAge} vs. Age {be.laterAge}
                  </Text>
                  <Text style={styles.beAge}>{be.breakEvenAge}</Text>
                  <Text style={styles.beLabel}>Break-even age</Text>
                  <Text style={favorsLater ? styles.beVerdictLater : styles.beVerdictEarlier}>
                    {favorsLater
                      ? `Delaying to ${be.laterAge} is favorable`
                      : `Claiming at ${be.earlierAge} is favorable`}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Lifetime Benefit Heatmap</Text>
      <Text style={styles.sectionDesc}>
        Cumulative benefits by claiming age (rows) and living age (columns). Gold row = age{' '}
        {shownAge}, the age shown.
      </Text>
      <View style={styles.chartBox} wrap={false}>
        <PdfHeatmap
          options={claimingOptions}
          lifeExpectancy={person.lifeExpectancy}
          optimalAge={shownAge}
          annualCola={annualCola}
        />
      </View>

      <Text style={styles.sectionTitle}>Opportunity Cost vs. Age {shownAge}</Text>
      <Text style={styles.sectionDesc}>
        Lifetime income shortfall compared to claiming at age {shownAge}.
      </Text>
      <View style={styles.chartBox} wrap={false}>
        <PdfOpportunityCost options={claimingOptions} optimalAge={shownAge} />
      </View>

      <Text style={styles.sectionTitle}>Monthly Benefit Ramp (Ages 62–70)</Text>
      <Text style={styles.sectionDesc}>
        Monthly check at each claiming age. Gold marker = age {shownAge}, the age shown.
      </Text>
      <View style={styles.chartBox} wrap={false}>
        <PdfMonthlyRamp options={claimingOptions} optimalAge={shownAge} />
      </View>

      {appendix}

      <PageFooter text={footerText} />
    </Page>
  );
}
