/**
 * The claiming grid's near-best region, as both surfaces need it.
 *
 * In `lib` rather than beside the panel that draws it because three things
 * outside that panel depend on it: the PDF prints the region the adviser was
 * looking at, the share link carries it, and a saved client restores it. A
 * type that a library has to import from a component is a layering mistake
 * waiting to become an import cycle.
 */
export interface TargetRange {
  on: boolean;
  percent: number;
}

/** Default tolerance for the near-best region, in percent. */
export const DEFAULT_TARGET_PERCENT = 1;

export const DEFAULT_TARGET_RANGE: TargetRange = { on: true, percent: DEFAULT_TARGET_PERCENT };

/** The widest tolerance a stored or shared view may ask for. */
export const MAX_TARGET_PERCENT = 25;
