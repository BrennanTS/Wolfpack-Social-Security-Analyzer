import type { SurvivorGap } from '../lib/benefitPeriods';
import type { DollarsMode } from '../lib/dollarsMode';
import { formatCurrency, personLabel } from '../lib/format';
import { showSurvivorIncomeColumn, type HouseholdStrategy } from '../lib/household';
import type { Person } from '../lib/personAnalysis';
import { SURVIVOR_INCOME_COLUMN_HEADER, survivorIncomeCaption } from './methodologyCopy';

interface StrategyComparisonTableProps {
  /**
   * `survivorIncome` on each row already carries whichever mode the caller
   * chose — `HouseholdPanel` transforms it before this component ever sees
   * it, alongside `dollarsMode` below, which only *names* that mode; it
   * applies no transform of its own.
   */
  comparisons: HouseholdStrategy[];
  people: Person[];
  /**
   * Only read for the survivor-income caption below the table. Optional so a
   * single-claimant call site (which never renders that column) need not
   * pass it.
   */
  survivorGap?: SurvivorGap | null;
  /**
   * Names which dollars the survivor-income column is in — that column sits
   * directly beside "Combined PV", which always stays in present-value
   * dollars regardless of this toggle, so the caption is the only thing
   * telling the two apart. Optional, defaulting to `'real'`, so every
   * existing call site keeps its prior wording.
   */
  dollarsMode?: DollarsMode;
}

/**
 * The centrepiece of the household tab: shows the client what the optimizer
 * rejected and by how much, not just what it picked. Rows carry real engine
 * numbers (`HouseholdStrategy` from `household.ts`) — nothing here is
 * illustrative. `filingAges`/`people` are variable-length so the same table
 * serves a single claimant (one age column) and a couple (two) without a
 * hardcoded shape, and the row count can legitimately be fewer than four —
 * `household.ts` already omits unattainable rows and folds a named row into
 * the optimum when they coincide.
 *
 * The survivor-income column is married-only (`people.length === 2`), the
 * same test the single-claimant call site already satisfies by never having
 * a second person. `household.ts` sets `survivorIncome: null` for a single
 * claimant, so gating on `people.length` rather than reading the field is
 * what keeps the column hidden even if some future single-claimant row ever
 * carried a non-null value by mistake.
 *
 * It ALSO requires at least one row to carry a figure. When both people
 * reach their plan-to age in the same month `firstDeath` returns null — it
 * refuses to invent a survivor the household does not have — so every row's
 * `survivorIncome` is null and every cell renders an em dash. The caption
 * used to print its claims over that column of dashes; a column with nothing
 * in it is not a column, so both it and its caption go.
 */
export function StrategyComparisonTable({
  comparisons,
  people,
  survivorGap,
  dollarsMode = 'real',
}: StrategyComparisonTableProps) {
  const showSurvivorIncome = showSurvivorIncomeColumn(comparisons, people.length);

  return (
    <div className="table-wrap">
      <table data-testid="strategy-table">
        <thead>
          <tr>
            <th>Strategy</th>
            {people.map((p, i) => (
              <th key={p.id}>{personLabel(p.name, i)}</th>
            ))}
            <th>Combined PV</th>
            <th>vs. best</th>
            {showSurvivorIncome && <th>{SURVIVOR_INCOME_COLUMN_HEADER}</th>}
          </tr>
        </thead>
        <tbody>
          {comparisons.map((s) => (
            <tr
              key={s.key}
              data-testid={`strategy-row-${s.key}`}
              className={s.isOptimal ? 'row-optimal' : ''}
            >
              <td>
                {s.label}
                {s.isOptimal && <span className="badge">Best</span>}
              </td>
              {s.filingAges.map((filingAge, i) => (
                <td key={people[i].id} data-testid={`cell-age-${people[i].id}`}>
                  {filingAge.label}
                </td>
              ))}
              <td>{formatCurrency(s.expectedNpv)}</td>
              <td data-testid="cell-delta" className={s.deltaVsOptimal < 0 ? 'negative' : ''}>
                {s.deltaVsOptimal === 0 ? '—' : formatCurrency(s.deltaVsOptimal)}
              </td>
              {showSurvivorIncome && (
                <td data-testid={`cell-survivor-${s.key}`}>
                  {/* `== null` rather than `=== null`: a row an older, not-yet-
                      updated fixture built without the field is `undefined`,
                      not `null`, and must fall back the same way rather than
                      print `formatCurrency(undefined)`'s "NaN". */}
                  {s.survivorIncome == null ? '—' : formatCurrency(s.survivorIncome)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {showSurvivorIncome && (
        <p className="chart-caveat" data-testid="survivor-income-caption">
          {survivorIncomeCaption(comparisons, survivorGap, dollarsMode)}
        </p>
      )}
    </div>
  );
}
