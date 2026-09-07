import { Fragment } from 'react';
import { Document, Page, View } from '@react-pdf/renderer';
import { BRAND_NAME } from '../../lib/brand';
import { householdDisplayShape, type HouseholdAnalysis } from '../../lib/household';
import type { ClaimingRow } from '../../lib/claimingRows';
import type { LongevitySensitivity } from '../../lib/longevity';
import {
  ADVISER_LAYOUT,
  blockScope,
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
import { PersonBlock, type PersonPart } from './PersonSection';
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
/**
 * A run of blocks, collapsed so consecutive person blocks travel together.
 *
 * Household blocks stay one to a group; person blocks gather into one, which
 * is what keeps the report person-major when a layout interleaves them.
 */
function groupRun(run: ReportBlockId[]): { scope: 'household' | 'person'; ids: ReportBlockId[] }[] {
  const groups: { scope: 'household' | 'person'; ids: ReportBlockId[] }[] = [];
  for (const id of run) {
    const scope = blockScope(id);
    const last = groups[groups.length - 1];
    if (scope === 'person' && last?.scope === 'person') last.ids.push(id);
    else groups.push({ scope, ids: [id] });
  }
  return groups;
}

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
  /** Which part of a person's detail each person-scoped block prints. */
  const PART_OF: Partial<Record<ReportBlockId, PersonPart>> = {
    personDetails: 'details',
    personComparison: 'comparison',
    personCumulative: 'cumulative',
    personBreakeven: 'breakeven',
    personHeatmap: 'heatmap',
    personOpportunity: 'opportunity',
    personRamp: 'ramp',
  };

  /**
   * One run of consecutive person blocks, printed for each claimant in turn.
   *
   * Grouped rather than rendered one block at a time so the report stays
   * person-major: a couple gets the client's charts, then the spouse's, under
   * one name each. Block-at-a-time would print every chart twice in a row
   * under alternating names, and a break-even card under nobody's heading.
   */
  const renderPeople = (ids: ReportBlockId[]): React.ReactNode => {
    const parts = ids.flatMap((id) => (PART_OF[id] ? [PART_OF[id] as PersonPart] : []));
    if (parts.length === 0) return null;
    return analysis.people.map((rep, i) => (
      <View key={rep.person.id} break={i > 0}>
        {PersonBlock({
          analysis: rep,
          index: i === 0 ? 0 : 1,
          annualCola: analysis.assumptions.annualCola,
          isBest: analysis.scenarioIsBest,
          claimingRows: claimingRowsByPerson[rep.person.id],
          parts,
        })}
      </View>
    ));
  };

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
          {groupRun(run).map((group, i) =>
            // The first group on a sheet sits against the top margin; every
            // one after it needs the gap its own heading deliberately does
            // not carry. A plain Fragment for the first, so nothing adds a
            // layout box where no spacing is wanted.
            i === 0 ? (
              <Fragment key={group.ids.join('-')}>
                {group.scope === 'person' ? renderPeople(group.ids) : renderBlock(group.ids[0])}
              </Fragment>
            ) : (
              <View key={group.ids.join('-')} style={styles.blockGap}>
                {group.scope === 'person' ? renderPeople(group.ids) : renderBlock(group.ids[0])}
              </View>
            ),
          )}
          <PageFooter text={footerText} />
        </Page>
      ))}
    </Document>
  );
}
