import { Document } from '@react-pdf/renderer';
import { householdDisplayShape, type HouseholdAnalysis } from '../../lib/household';
import { formatVersionLabel } from '../../lib/version';
import { HouseholdSection } from './HouseholdSection';
import { PersonSection } from './PersonSection';
import { WidowedSection } from './WidowedSection';
import { FIRM } from './theme';
import { formatReportDate, MethodologyAppendix, ReportHeader } from './reportChrome';

/**
 * The report this app printed before layouts, kept while advisers move
 * across. Nothing composes it: the order is fixed in this file, which is
 * what the layout editor replaced.
 *
 * Composes the printable report. Print has no tabs, so this linearizes what
 * the app shows as tabs on screen: for a married household, the household
 * page first, then one page per person; for a single claimant, just their
 * page. The shared methodology/disclosures block attaches to whichever
 * section is last in that flow, so it appears exactly once regardless of
 * household shape; the cover `ReportHeader` attaches to whichever section is
 * first, for the same reason. Page numbers use react-pdf's own
 * `pageNumber`/`totalPages` (see `PageFooter`) rather than a pre-computed
 * count, so they stay correct even if a section's content wraps onto more
 * than one physical page.
 */
export function LegacyReportDocument({
  analysis,
  claimingRowsByPerson = {},
  gridTarget,
}: {
  analysis: HouseholdAnalysis;
  /**
   * Each person's benefit-by-claiming-age rows, keyed by person id — the same
   * arrays the screen renders. Defaulting to `{}` keeps every existing caller
   * (and the report tests) on the whole-year rows `PersonSection` derives for
   * itself.
   */
  claimingRowsByPerson?: Record<string, import('../../lib/claimingRows').ClaimingRow[]>;
  /** The claiming grid's near-best region, as shown on screen. */
  gridTarget?: { on: boolean; percent: number };
}) {
  // Exhaustive rather than `=== 'married'`: a widowed household used to fall
  // through to the single-claimant layout, printing a report that never
  // mentions the survivor benefit. See `householdDisplayShape`.
  const shape = householdDisplayShape(analysis.status);
  const isMarried = shape === 'twoClaimants';
  const reportDate = formatReportDate();
  const footerText = `${FIRM} · ${formatVersionLabel()} · Confidential · ${reportDate}`;
  const appendix = <MethodologyAppendix analysis={analysis} />;
  const leadingHeader = <ReportHeader dateLabel={reportDate} />;

  return (
    <Document
      title="Social Security Claiming Analysis"
      author={FIRM}
      subject="Social Security Claiming Analysis"
    >
      {shape === 'widowed' && (
        <WidowedSection
          analysis={analysis}
          footerText={footerText}
          appendix={appendix}
          leadingHeader={leadingHeader}
        />
      )}
      {isMarried && (
        <HouseholdSection
          analysis={analysis}
          footerText={footerText}
          appendix={appendix}
          leadingHeader={leadingHeader}
          gridTarget={gridTarget}
        />
      )}
      {/* A widow(er)'s own page IS the widowed section — `PersonSection` is
          built around `claimingOptions`, which is empty for them. */}
      {shape !== 'widowed' &&
        analysis.people.map((p, i) => (
        <PersonSection
          key={p.person.id}
          analysis={p}
          index={i as 0 | 1}
          annualCola={analysis.assumptions.annualCola}
          isBest={analysis.scenarioIsBest}
          claimingRows={claimingRowsByPerson[p.person.id]}
          footerText={footerText}
          appendix={isMarried ? undefined : appendix}
          leadingHeader={!isMarried && i === 0 ? leadingHeader : undefined}
        />
      ))}
    </Document>
  );
}
