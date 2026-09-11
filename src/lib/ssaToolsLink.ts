/**
 * The address of a claimant on ssa.tools.
 *
 * One builder, used by two places that must not disagree: the live
 * cross-check suite, which drives that site and diffs its figures against our
 * fixtures, and the app's validation panel, which offers an adviser the same
 * link. If they built the URL separately, the link a client is invited to
 * check would only look like the one the suite verified.
 *
 * `ssa.tools` takes its inputs in the fragment — the calculator's own
 * "reload these inputs" link is the format — so nothing here reaches a
 * server as a query string.
 */

/** ssa.tools' calculator, which reads `#pia1=…&dob1=…[&pia2=…&dob2=…]`. */
const CALCULATOR = 'https://ssa.tools/calculator';

export interface SsaToolsPerson {
  birthYear: number;
  birthMonth: number;
  /** Absent means the 15th, the day every record written before it used. */
  birthDay?: number;
  piaMonthly: number;
}

/**
 * The date to send, which is the person's own birth day where there is one.
 *
 * The 2nd is the fallback, not a substitution applied to everybody. It has to
 * be the 1st or the 2nd for ssa.tools to show a `62y 0m` row at all — SSA
 * pays a month only to someone 62 throughout it — and of those two the 2nd is
 * the one that behaves like an ordinary day.
 *
 * Sending the real day matters for one case and matters completely there: SSA
 * reads a 1 January birthday into the PREVIOUS cohort, so substituting the
 * 2nd would show the adviser a different claimant than the one on screen.
 */
export function ssaToolsDob(person: SsaToolsPerson): string {
  const day = person.birthDay ?? 2;
  const mm = String(person.birthMonth).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${person.birthYear}-${mm}-${dd}`;
}

/** The calculator prefilled for one or two people, in the order given. */
export function ssaToolsCalculatorUrl(people: readonly SsaToolsPerson[]): string {
  const [first, second] = people;
  let url = `${CALCULATOR}#pia1=${first.piaMonthly}&dob1=${ssaToolsDob(first)}`;
  if (second !== undefined) {
    url += `&pia2=${second.piaMonthly}&dob2=${ssaToolsDob(second)}`;
  }
  return url;
}
