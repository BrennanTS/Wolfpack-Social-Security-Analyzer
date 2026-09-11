import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { householdAt, widowedHouseholdAt } from './households';
import { analyze, stubLifeTableFetch } from './harness';
import { reportSurface } from './surfaces';
import { NOT_IN_THE_CLIENT_REPORT, SCHEDULE_SECTIONS } from '../copy/sections';
import { APP_VERSION } from '../../src/lib/version';

/**
 * Writes `validation/copy/copy-schedule.docx` — the report's wording, for
 * approval.
 *
 * NOT a test. It exists because a compliance reviewer handed one exported PDF
 * has approved one household's wording: the report says materially different
 * things depending on the household, and the variants they would not have
 * seen are disproportionately the conditional, liability-adjacent ones.
 *
 * So this renders the client report's copy over hundreds of generated
 * households, collects every distinct sentence each section can print, and
 * lays them out in the order a reader meets them — with a note saying when
 * each appears and a column to sign off in.
 *
 * Word rather than PDF because a reviewer marks up in Word, and the sign-off
 * column is meant to be filled in.
 *
 *   npm run copy:schedule
 */

const COUNT = Number(process.env.SCHEDULE_COUNT ?? 400);
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../copy/copy-schedule.docx',
);

beforeAll(() => {
  vi.stubGlobal('fetch', stubLifeTableFetch());
});
afterAll(() => vi.unstubAllGlobals());

/** Sentences differing only in their figures are one entry to a reviewer. */
const shapeOf = (text: string) =>
  text.replace(/\$?[\d,]+(?:\.\d+)?%?/g, '#').replace(/\b(?:Alpha|Beta)\b/g, 'NAME');

function cell(children: Paragraph[], width: number): TableCell {
  return new TableCell({ children, width: { size: width, type: WidthType.PERCENTAGE } });
}

const text = (value: string, opts: { bold?: boolean; size?: number } = {}) =>
  new Paragraph({
    children: [new TextRun({ text: value, bold: opts.bold, size: opts.size ?? 20 })],
    spacing: { after: 80 },
  });

describe('copy schedule', () => {
  it('writes the Word document', async () => {
    const byShape = new Map<string, { source: string; text: string }>();

    const collect = async (household: Parameters<typeof analyze>[0]) => {
      const analysis = await analyze(household);
      for (const line of reportSurface(analysis)) {
        const trimmed = line.text.trim();
        if (trimmed === '') continue;
        const key = `${line.source} :: ${shapeOf(trimmed)}`;
        if (!byShape.has(key)) byShape.set(key, { source: line.source, text: trimmed });
      }
    };

    for (let i = 0; i < COUNT; i++) await collect(householdAt(i).household);
    for (let i = 0; i < Math.round(COUNT / 4); i++) await collect(widowedHouseholdAt(i).household);

    const bySource = new Map<string, string[]>();
    for (const entry of byShape.values()) {
      const list = bySource.get(entry.source) ?? [];
      list.push(entry.text);
      bySource.set(entry.source, list);
    }

    const today = new Date().toISOString().slice(0, 10);
    const children: (Paragraph | Table)[] = [];
    const push = (p: Paragraph | Table) => children.push(p);

    push(
      new Paragraph({
        text: 'Client report — copy schedule',
        heading: HeadingLevel.TITLE,
      }),
    );
    push(
      text(
        `Wolfpack Social Security Analyzer, version ${APP_VERSION}. Generated ${today}.`,
        { bold: true },
      ),
    );
    push(
      text(
        'Every sentence the client report can print, in the order a reader meets them. ' +
          'The report is generated per household, so most sections have more than one ' +
          'possible wording; the "When it appears" column says which. Figures shown are ' +
          'real output from a sample household — the words around them are what is being ' +
          'approved, not the amounts.',
      ),
    );
    push(
      text(
        'This schedule covers the CLIENT report only. Not included: ' +
          NOT_IN_THE_CLIENT_REPORT.join(' '),
      ),
    );
    push(
      text(
        'Please mark each row Approved, or write the change you want in Comments. ' +
          'Regenerate this document after any copy change; it is produced from the ' +
          'application itself and is never edited by hand.',
      ),
    );

    let missing = 0;
    for (const section of SCHEDULE_SECTIONS) {
      push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }));
      push(text(section.purpose));

      const rows: TableRow[] = [
        new TableRow({
          tableHeader: true,
          children: [
            cell([text('Text as printed', { bold: true })], 52),
            cell([text('When it appears', { bold: true })], 28),
            cell([text('Approved', { bold: true })], 10),
            cell([text('Comments', { bold: true })], 10),
          ],
        }),
      ];

      for (const source of section.sources) {
        const lines = bySource.get(source);
        if (lines === undefined) {
          missing += 1;
          console.log(`  no rendered lines for ${source}`);
          continue;
        }
        const when = section.appears?.[source] ?? 'Always.';
        // Insertion order, NOT sorted. `reportSurface` pushes lines in the
        // order the report prints them, and for the disclosures that order
        // is part of what is being approved — alphabetising put "The figures
        // are estimates" above the educational-estimate paragraph that has
        // to come first.
        for (const line of lines) {
          rows.push(
            new TableRow({
              children: [
                cell([text(line)], 52),
                cell([text(when)], 28),
                cell([text('')], 10),
                cell([text('')], 10),
              ],
            }),
          );
        }
      }

      push(
        new Table({
          rows,
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
          },
        }),
      );
      push(new Paragraph({ text: '', spacing: { after: 200 } }));
    }

    push(new Paragraph({ text: 'Sign-off', heading: HeadingLevel.HEADING_1 }));
    push(text('Reviewed by: ______________________________   Date: ______________'));
    push(
      text(
        'Approval applies to the wording above, at the version and date in the header. ' +
          'A later version of the application may print different sentences.',
        { size: 18 },
      ),
    );
    push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({
            text:
              'Prepared for internal review. The application is not affiliated with, ' +
              'endorsed by, or approved by the Social Security Administration.',
            size: 18,
            italics: true,
          }),
        ],
      }),
    );

    const doc = new Document({ sections: [{ children }] });
    writeFileSync(OUT, await Packer.toBuffer(doc));
    if (missing > 0) throw new Error(`${missing} schedule source(s) rendered nothing`);
    console.log(
      `Wrote ${byShape.size} sentence shapes across ${SCHEDULE_SECTIONS.length} sections` +
        (missing > 0 ? ` (${missing} sources produced nothing)` : ''),
    );
  }, 600_000);
});
