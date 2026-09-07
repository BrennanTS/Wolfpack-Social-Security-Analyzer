import { Fragment } from 'react';
import { Document, Page, View } from '@react-pdf/renderer';
import { BRAND_NAME } from '../../lib/brand';
import { householdDisplayShape, type HouseholdAnalysis } from '../../lib/household';
import type { ClaimingRow } from '../../lib/claimingRows';
import type { LongevitySensitivity } from '../../lib/longevity';
import {
  ADVISER_LAYOUT,
  layoutRuns,
  type ReportBlockId,
  type ReportLayout,
} from '../../lib/reportLayout';
import { formatVersionLabel } from '../../lib/version';
import { styles } from './theme';
import {
  formatReportDate,
  MethodologyAppendix,
  PageFooter,
  ReportHeader,
} from './ReportDocument';
import { ClaimingGridBlock, HouseholdBlock } from './HouseholdSection';
import { PersonBlock } from './PersonSection';
import { WidowedSection } from './WidowedSection';
import {
  ActionBlock,
  AnswerBlock,
  ChangesBlock,
  LongevityBlock,
  MethodologyBlock,
  SurvivorBlock,
  TermsBlock,
} from './BetaSections';

/**
 * The beta report, composed from a layout.
 *
 * Every block used to render its own `<Page>`, which is why the report
 * printed at about 5% ink: a block holding a third of a page still consumed
 * a whole sheet. Blocks are now content, and the document groups them into
 * pages — one `<Page>` per run of blocks between the adviser's page breaks,
 * inside which react-pdf paginates on its own. A run that overflows spills
 * onto another sheet; a run that underfills simply ends.
 *
 * A second document rather than a rewrite of the first. The existing report
 * keeps working and keeps its tests, and this one can be wrong in public
 * without costing anything.
 *
 * Widowed households keep their own section: every block built for two
 * living claimants choosing between filing ages has already been decided for
 * a widow(er), and `layoutRuns` drops them.
 */
export function BetaReportDocument({
  analysis,
  claimingRowsByPerson = {},
  gridTarget,
  sensitivity,
  layout = ADVISER_LAYOUT,
}: {
  analysis: HouseholdAnalysis;
  claimingRowsByPerson?: Record<string, ClaimingRow[]>;
  gridTarget?: { on: boolean; percent: number };
  /**
   * Every strategy priced at three lifespans. Computed by the caller because
   * it needs the household and the assumptions, which the analysis does not
   * carry — and it is async, which a render is not. Undefined simply omits
   * the block.
   */
  sensitivity?: LongevitySensitivity | null;
  /** What to include, in what order, and where the pages break. */
  layout?: ReportLayout;
}) {
  const shape = householdDisplayShape(analysis.status);
  const reportDate = formatReportDate();
  const footerText = `${BRAND_NAME} · ${formatVersionLabel()} · Beta · ${reportDate}`;
  const isWidowed = shape === 'widowed';

  /**
   * One block's content.
   *
   * Called rather than mounted, like the sections it draws on, so the tests
   * that walk this document's element tree without a renderer can see inside
   * each block.
   */
  const renderBlock = (id: ReportBlockId): React.ReactNode => {
    switch (id) {
      case 'answer':
        return AnswerBlock({ analysis });
      case 'changes':
        return ChangesBlock({ analysis });
      case 'survivor':
        return SurvivorBlock({ analysis });
      case 'longevity':
        // The one block whose data the caller may not have computed.
        return sensitivity ? LongevityBlock({ sensitivity }) : null;
      case 'action':
        return ActionBlock({ analysis });
      case 'household':
        return HouseholdBlock({ analysis });
      case 'grid':
        return ClaimingGridBlock({ analysis, gridTarget });
      case 'people':
        return analysis.people.map((rep, i) => (
          <View key={rep.person.id} break={i > 0}>
            {PersonBlock({
              analysis: rep,
              index: i === 0 ? 0 : 1,
              annualCola: analysis.assumptions.annualCola,
              isBest: analysis.scenarioIsBest,
              claimingRows: claimingRowsByPerson[rep.person.id],
            })}
          </View>
        ));
      case 'terms':
        return TermsBlock({ analysis });
      case 'methodology':
        return MethodologyBlock({ appendix: <MethodologyAppendix analysis={analysis} /> });
      default:
        return null;
    }
  };

  const runs = layoutRuns(layout, shape);

  return (
    <Document
      title="Social Security Claiming Analysis (beta)"
      author={BRAND_NAME}
      subject="Social Security Claiming Analysis"
    >
      {isWidowed ? (
        <WidowedSection
          analysis={analysis}
          footerText={footerText}
          leadingHeader={<ReportHeader dateLabel={reportDate} />}
        />
      ) : null}

      {runs.map((run, runIndex) => (
        <Page key={run.join('-')} size="LETTER" style={styles.page}>
          {/* The document title sits on the first sheet only. */}
          {runIndex === 0 && !isWidowed && <ReportHeader dateLabel={reportDate} />}
          {run.map((id, i) =>
            // The first block on a sheet sits against the top margin; every
            // one after it needs the gap its own heading deliberately does
            // not carry. A plain Fragment for the first, so nothing adds a
            // layout box where no spacing is wanted.
            i === 0 ? (
              <Fragment key={id}>{renderBlock(id)}</Fragment>
            ) : (
              <View key={id} style={styles.blockGap}>
                {renderBlock(id)}
              </View>
            ),
          )}
          <PageFooter text={footerText} />
        </Page>
      ))}
    </Document>
  );
}
