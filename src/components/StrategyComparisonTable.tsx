import { formatCurrency, personLabel } from '../lib/format';
import type { HouseholdStrategy } from '../lib/household';
import type { Person } from '../lib/personAnalysis';

interface StrategyComparisonTableProps {
  comparisons: HouseholdStrategy[];
  people: Person[];
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
 */
export function StrategyComparisonTable({ comparisons, people }: StrategyComparisonTableProps) {
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
