/** Display formatting. Deliberately dependency-free so every layer can import it. */

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCurrencyPrecise(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * `formatCurrency` with an explicit `/yr` unit — for a figure that is a
 * RATE (what a benefit pays annually once it's running), not a sum of what
 * changed hands over some period. `CombinedIncomeChart`'s tooltip is the
 * motivating case: its label is a single month ("Feb 2042"), but every
 * value is `buildMonthlyIncomeSeries`' annual rate at that month, never
 * that month's own payment — without the unit, a bare month beside a bare
 * dollar figure reads as that month's payment.
 */
export function formatCurrencyPerYear(amount: number): string {
  return `${formatCurrency(amount)}/yr`;
}

/** Structural parameter rather than FraResult, so this module imports nothing. */
export function fraLabel(fra: { years: number; months: number }): string {
  if (fra.months === 0) return `${fra.years}`;
  return `${fra.years} years, ${fra.months} months`;
}

export function formatAgeDisplay(age: { years: number; months: number }): string {
  if (age.months === 0) return `${age.years} years old`;
  return `${age.years} years, ${age.months} months`;
}

/**
 * Resolves a person's display name. The single source of truth for the
 * Client/Spouse fallback — tabs, chart legends, table headers and the PDF all
 * call this so the rule cannot drift between them.
 */
export function personLabel(name: string | undefined, index: number): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return index === 0 ? 'Client' : 'Spouse';
}
