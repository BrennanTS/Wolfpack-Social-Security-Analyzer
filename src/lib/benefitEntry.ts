import { isBenefitInRange } from './formBounds';

export interface YearlySuspicion {
  /** What the user typed. */
  entered: number;
  /**
   * The monthly equivalent to offer them, rounded to a WHOLE DOLLAR.
   *
   * Whole dollars rather than cents, for two reasons. The button is labelled
   * with `formatCurrency`, which is zero-decimal, so a cent-precise suggestion
   * produced a control reading "Use $2,583/month" that entered 2583.33 — in a
   * feature whose entire justification is not silently substituting numbers,
   * saying one number and entering another is the wrong shape. And the benefit
   * field itself is digits-only by construction (its onChange strips
   * non-digits), so a cent-precise value cannot be typed by hand and would
   * only ever arrive via this button.
   *
   * The precision is immaterial to the decision: the input is an estimate off
   * an SSA statement, and $0.33/month does not move a claiming recommendation.
   */
  monthly: number;
}

/**
 * Detects a yearly benefit typed into a monthly field.
 *
 * The signature of that mistake is specific: the entered value is implausible
 * as a monthly benefit, *and* dividing it by twelve produces one that is
 * plausible. Flagging on magnitude alone would fire on values where no useful
 * suggestion exists (999,999 divides to 83,333, still nonsense), and the whole
 * point is to offer a fix rather than just complain.
 *
 * Returns null when there is nothing helpful to say. Callers must treat this
 * as a suggestion, never a block — SSA's maximum benefit rises every year, so
 * a hard ceiling would eventually reject a legitimate high earner.
 */
export function detectYearlyEntry(entered: number): YearlySuspicion | null {
  if (!Number.isFinite(entered) || entered <= 0) return null;
  if (isBenefitInRange(entered)) return null;

  const monthly = Math.round(entered / 12);
  if (!isBenefitInRange(monthly) || monthly <= 0) return null;

  return { entered, monthly };
}
