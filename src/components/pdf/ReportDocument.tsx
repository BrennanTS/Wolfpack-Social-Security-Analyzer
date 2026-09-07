import { Fragment } from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { householdDisplayShape, type HouseholdAnalysis } from '../../lib/household';
import type { ClaimingRow } from '../../lib/claimingRows';
import type { LongevitySensitivity } from '../../lib/longevity';
import {
  ADVISER_LAYOUT,
  blockScope,
  layoutRuns,
  SPACE,
  type ReportBlockId,
  type ReportLayout,
  type RunItem,
} from '../../lib/reportLayout';
import { formatVersionLabel } from '../../lib/version';
import { FIRM, styles } from './theme';
import {
  formatReportDate,
  MethodologyAppendix,
  PageFooter,
  ReportHeader,
} from './reportChrome';
import { ClaimingGridBlock, HouseholdBlock } from './HouseholdSection';
import { PersonBlock, type PersonPart } from './PersonSection';
import { WidowedSection } from './WidowedSection';
import {
  ActionBlock,
  AnswerBlock,
  ChangesBlock,
  CoverBlock,
  IntroBlock,
  LimitsBlock,
  LongevityBlock,
  MethodologyBlock,
  SurvivorBlock,
  TermsBlock,
} from './ReportSections';

/**
 * The report, composed from a layout.
 *
 * Every block used to render its own `<Page>`, which is why the report
 * printed at about 5% ink: a block holding a third of a page still consumed
 * a whole sheet. Blocks are now content, and the document groups them into
 * pages — one `<Page>` per run of blocks between the adviser's page breaks,
 * inside which react-pdf paginates on its own. A run that overflows spills
 * onto another sheet; a run that underfills simply ends.
 *
 * `LegacyReportDocument` is the fixed-order report this replaced. It was
 * built alongside rather than in place, so advisers could move across on
 * their own schedule.
 *
 * Widowed households keep their own section: every block built for two
 * living claimants choosing between filing ages has already been decided for
 * a widow(er), and `layoutRuns` drops them.
 */
/** What one page is built from: content, and the adviser's own padding. */
type RunGroup =
  | { kind: 'space' }
  | { kind: 'blocks'; scope: 'household' | 'person'; ids: ReportBlockId[] };

/**
 * A run of blocks, collapsed so consecutive person blocks travel together.
 *
 * Household blocks stay one to a group; person blocks gather into one, which
 * is what keeps the report person-major when a layout interleaves them.
 *
 * A space between two person blocks is dropped for the same reason: those two
 * blocks print inside one person's section, and a gap between them would have
 * to be inside it too. The editor says so where the space is dragged, rather
 * than leaving an adviser to work out why nothing moved.
 */
function groupRun(run: readonly RunItem[]): RunGroup[] {
  const groups: RunGroup[] = [];
  let pendingSpaces = 0;
  for (const item of run) {
    if (item === SPACE) {
      pendingSpaces += 1;
      continue;
    }
    const scope = blockScope(item);
    const last = groups[groups.length - 1];
    if (scope === 'person' && last?.kind === 'blocks' && last.scope === 'person') {
      last.ids.push(item);
      pendingSpaces = 0;
      continue;
    }
    for (let i = 0; i < pendingSpaces; i += 1) groups.push({ kind: 'space' });
    pendingSpaces = 0;
    groups.push({ kind: 'blocks', scope, ids: [item] });
  }
  return groups;
}

export function ReportDocument({
  analysis,
  claimingRowsByPerson = {},
  gridTarget,
  sensitivity,
  layout = ADVISER_LAYOUT,
  onBlockPage,
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
  /**
   * Called with the page each block landed on, as the document is rendered.
   *
   * Which sheet a block ends up on is not knowable before layout: a run
   * flows, and one long table above moves everything after it. react-pdf
   * hands `pageNumber` to a dynamic `render`, so a zero-height marker in
   * front of each group can report it — there is no other way to ask.
   *
   * The editor's preview passes this to jump to the block being clicked; the
   * export does not, and renders no markers at all.
   */
  onBlockPage?: (id: ReportBlockId, page: number) => void;
}) {
  const shape = householdDisplayShape(analysis.status);
  const reportDate = formatReportDate();
  const footerText = `${FIRM} · ${formatVersionLabel()} · Confidential · ${reportDate}`;
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
      case 'cover':
        return CoverBlock({ analysis, dateLabel: reportDate });
      case 'intro':
        return IntroBlock({ analysis });
      case 'limits':
        return LimitsBlock();
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
  // The document title goes on the first sheet that is not a cover: a cover
  // already carries the title, and printing it twice on one page reads as a
  // template nobody finished.
  const headerRun = runs.findIndex((run) => run[0] !== 'cover');

  return (
    <Document
      title="Social Security Claiming Analysis"
      author={FIRM}
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
        <Page key={runIndex} size="LETTER" style={styles.page}>
          {/* Called, not mounted, like every block: the tests walk this tree
              without a renderer, and a mounted `<ReportHeader />` has no
              children to walk — the title would be invisible to every
              assertion about which page carries it. */}
          {runIndex === headerRun && !isWidowed && ReportHeader({ dateLabel: reportDate })}
          {groupRun(run).map((group, i) => {
            /**
             * Where this group starts, reported as it renders.
             *
             * Every id in a person group reports the same page: those blocks
             * print inside one claimant's section, and the page an adviser
             * wants to be shown is where that section begins.
             */
            const mark = (ids: readonly ReportBlockId[]) =>
              onBlockPage === undefined ? null : (
                <Text
                  style={styles.pageMark}
                  render={({ pageNumber }) => {
                    for (const id of ids) onBlockPage(id, pageNumber);
                    return '';
                  }}
                />
              );
            // A space is padding on top of the gap the next block already
            // gets, which is what makes one enough to see and two twice as
            // much.
            if (group.kind === 'space') return <View key={i} style={styles.spacer} />;
            const content = (
              <>
                {mark(group.ids)}
                {group.scope === 'person' ? renderPeople(group.ids) : renderBlock(group.ids[0])}
              </>
            );
            // The first group on a sheet sits against the top margin; every
            // one after it needs the gap its own heading deliberately does
            // not carry. A plain Fragment for the first, so nothing adds a
            // layout box where no spacing is wanted.
            return i === 0 ? (
              <Fragment key={i}>{content}</Fragment>
            ) : (
              <View key={i} style={styles.blockGap}>
                {content}
              </View>
            );
          })}
          <PageFooter text={footerText} />
        </Page>
      ))}
    </Document>
  );
}
