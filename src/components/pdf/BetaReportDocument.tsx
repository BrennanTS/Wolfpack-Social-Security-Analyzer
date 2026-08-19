import { Document } from '@react-pdf/renderer';
import { BRAND_NAME } from '../../lib/brand';
import { householdDisplayShape, type HouseholdAnalysis } from '../../lib/household';
import type { ClaimingRow } from '../../lib/claimingRows';
import type { LongevitySensitivity } from '../../lib/longevity';
import { formatVersionLabel } from '../../lib/version';
import {
  formatReportDate,
  MethodologyAppendix,
  PageFooter,
  ReportHeader,
} from './ReportDocument';
import { HouseholdSection } from './HouseholdSection';
import { PersonSection } from './PersonSection';
import { WidowedSection } from './WidowedSection';
import {
  BetaActionSection,
  BetaAnswerSection,
  BetaLongevitySection,
  BetaAppendixSection,
  BetaSurvivorSection,
  BetaTermsSection,
} from './BetaSections';

/**
 * The beta report.
 *
 * Same analysis, same engine, same figures as `ReportDocument` — what differs
 * is the order and the voice. The client-facing pages come first and answer
 * the questions a client walked in with; the existing household, person and
 * methodology pages follow unchanged, because they are the evidence rather
 * than the argument.
 *
 * A second document rather than a rewrite of the first. The existing report
 * keeps working and keeps its tests, and this one can be wrong in public
 * without costing anything. When the beta wins, the old one is deleted.
 *
 * Widowed households get the beta's terms page and their existing section,
 * and nothing else: every new page here is built around two living claimants
 * choosing between filing ages, and a widow(er) has already had that decided
 * for them.
 */
export function BetaReportDocument({
  analysis,
  claimingRowsByPerson = {},
  gridTarget,
  sensitivity,
}: {
  analysis: HouseholdAnalysis;
  claimingRowsByPerson?: Record<string, ClaimingRow[]>;
  gridTarget?: { on: boolean; percent: number };
  /**
   * Every strategy priced at three lifespans. Computed by the caller because
   * it needs the household and the assumptions, which the analysis does not
   * carry — and it is async, which a render is not. Undefined simply omits
   * the page.
   */
  sensitivity?: LongevitySensitivity | null;
}) {
  const shape = householdDisplayShape(analysis.status);
  const reportDate = formatReportDate();
  const footerText = `${BRAND_NAME} · ${formatVersionLabel()} · Beta · ${reportDate}`;
  const footer = <PageFooter text={footerText} />;
  const leadingHeader = <ReportHeader dateLabel={reportDate} />;
  const appendix = <MethodologyAppendix analysis={analysis} />;
  const isWidowed = shape === 'widowed';

  return (
    <Document
      title="Social Security Claiming Analysis (beta)"
      author={BRAND_NAME}
      subject="Social Security Claiming Analysis"
    >
      {!isWidowed && (
        <BetaAnswerSection analysis={analysis} footer={footer} header={leadingHeader} />
      )}
      {shape === 'twoClaimants' && <BetaSurvivorSection analysis={analysis} footer={footer} />}
      {!isWidowed && sensitivity && (
        <BetaLongevitySection sensitivity={sensitivity} footer={footer} />
      )}
      {!isWidowed && <BetaActionSection analysis={analysis} footer={footer} />}

      {isWidowed && (
        <WidowedSection
          analysis={analysis}
          footerText={footerText}
          leadingHeader={leadingHeader}
        />
      )}
      {shape === 'twoClaimants' && (
        <HouseholdSection analysis={analysis} footerText={footerText} gridTarget={gridTarget} />
      )}
      {!isWidowed &&
        analysis.people.map((rep, i) => (
          <PersonSection
            key={rep.person.id}
            analysis={rep}
            index={i === 0 ? 0 : 1}
            annualCola={analysis.assumptions.annualCola}
            isBest={analysis.scenarioIsBest}
            claimingRows={claimingRowsByPerson[rep.person.id]}
            footerText={footerText}
          />
        ))}

      {/* Terms and assumptions last, with the methodology appendix attached —
          the reader who wants them will look, and the reader who does not is
          no longer made to walk past them. */}
      <BetaTermsSection analysis={analysis} footer={footer} />
      <BetaAppendixSection appendix={appendix} footer={footer} />
    </Document>
  );
}
