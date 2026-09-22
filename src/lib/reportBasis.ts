/**
 * How the report states every total: what the money is worth today, or how
 * many dollars change hands.
 *
 * Two settings under one name. They have to move together because either
 * alone leaves the report saying two things at once — future dollars
 * discounted back to today is a coherent quantity, but it is not what either
 * a client or a competitor's report means by a lifetime total, and nothing on
 * the page would say which was meant.
 *
 * Derived from the two settings rather than stored beside them, so moving
 * either by hand moves this on its own and there is no third piece of state
 * to fall out of step. It also means a share link needs no new parameter:
 * `dollars` and `dr` already carry it.
 *
 * Lives here rather than in `AssumptionsPanel` because the layout presets
 * name a basis too — a Savvy-style layout is read in future dollars, and the
 * preset has to be able to say so without importing a panel.
 */
import type { DollarsMode } from './dollarsMode';
import { DEFAULT_DISCOUNT_RATE } from './ssaTools';

/**
 * `custom` is a real answer, not a fallback. The two named bases are two of
 * the four combinations the underlying controls can reach — nominal cash
 * flows discounted at a nominal rate is the textbook-correct pairing and is
 * neither of them — and a two-state control would have to show one of them
 * selected while the report was in the other.
 */
export type ReportBasis = 'present' | 'future' | 'custom';

/** A basis a preset or a control can actually ask for. */
export type NamedBasis = Exclude<ReportBasis, 'custom'>;

export interface BasisSettings {
  dollarsMode: DollarsMode;
  /** A FRACTION (0.025 is 2.5%). */
  discountRate: number;
}

export function basisOf({ dollarsMode, discountRate }: BasisSettings): ReportBasis {
  if (dollarsMode === 'real' && discountRate > 0) return 'present';
  if (dollarsMode === 'nominal' && discountRate === 0) return 'future';
  return 'custom';
}

/**
 * The settings a named basis asks for, given what is currently set.
 *
 * `current` is read so present value keeps a rate the adviser chose: 4% in
 * real dollars is still present value, and snapping it back to the default
 * would discard a deliberate assumption. Only a household with no rate at all
 * gets one supplied.
 */
export function settingsForBasis(basis: NamedBasis, current: BasisSettings): BasisSettings {
  if (basis === 'future') return { dollarsMode: 'nominal', discountRate: 0 };
  return {
    dollarsMode: 'real',
    discountRate: current.discountRate > 0 ? current.discountRate : DEFAULT_DISCOUNT_RATE,
  };
}

export const BASIS_LABEL: Record<NamedBasis, string> = {
  present: 'Present value',
  future: 'Future value',
};
