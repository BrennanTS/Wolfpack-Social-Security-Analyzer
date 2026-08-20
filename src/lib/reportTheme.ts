/**
 * Report themes — the palette the PDF is printed in.
 *
 * A theme belongs to the DELIVERABLE, not to the app. The screen has its own
 * palette and its own dark mode, which an adviser picks for their own eyes;
 * this is what the client ends up holding, and it is chosen to match a firm's
 * branding rather than a working preference. The two are deliberately not
 * wired together — switching to dark mode at 9pm should not change what comes
 * out of the printer.
 *
 * Every color here lands on white paper, so each is measured against white
 * rather than against a theme background. `reportTheme.test.ts` enforces that:
 * a preset whose body text falls under 4.5:1 fails the suite rather than
 * quietly printing something a client cannot read.
 */
export interface ReportTheme {
  id: string;
  /** Shown in the picker. */
  name: string;
  /** One line under the name, describing the look rather than the hex. */
  blurb: string;
  /** Headings and body text. */
  ink: string;
  /** Secondary text — captions, table sub-labels. */
  muted: string;
  /** Tertiary text — column headers, footnotes. */
  subtle: string;
  /** Rules, accents, and the figures the eye should land on first. */
  brand: string;
  /** A darker brand tone for text that sits on a tinted fill. */
  brandDark: string;
  /** Hairlines and table borders. */
  border: string;
  /** A figure that is better than the baseline. */
  green: string;
  /** A figure that is worse than the baseline. */
  red: string;
  /** Heat ramp endpoints for the claiming grid and the lifetime heatmap. */
  heatLo: string;
  heatHi: string;
}

/**
 * The house palette, and the one the app itself wears. Bronze accents on
 * warm white, with the claiming grid in cool blue so the heat surface reads
 * as data rather than as more branding.
 */
const WOLFPACK: ReportTheme = {
  id: 'wolfpack',
  name: 'Wolfpack',
  blurb: 'Bronze on warm white — the house palette',
  ink: '#101010',
  muted: '#454545',
  subtle: '#6b6b6b',
  brand: '#8f6d2c',
  brandDark: '#6f5526',
  border: '#e2ddd2',
  green: '#47694c',
  red: '#96423c',
  heatLo: '#eaf0f7',
  heatHi: '#8fb0d4',
};

const MIDNIGHT: ReportTheme = {
  id: 'midnight',
  name: 'Midnight',
  blurb: 'Navy and gold — traditional, institutional',
  ink: '#101820',
  muted: '#3f4d5c',
  subtle: '#5f6c7a',
  brand: '#1f4e79',
  brandDark: '#163a5a',
  border: '#dbe3ea',
  green: '#3f7050',
  red: '#9c4038',
  heatLo: '#eef3f9',
  heatHi: '#7fa9d4',
};

const SLATE: ReportTheme = {
  id: 'slate',
  name: 'Slate',
  blurb: 'Teal on cool grey — quieter, more modern',
  ink: '#171c1a',
  muted: '#414b48',
  subtle: '#5f6b67',
  brand: '#1e6b5e',
  brandDark: '#145247',
  border: '#e1e5e1',
  green: '#47694c',
  red: '#a04a3c',
  heatLo: '#e9f2ee',
  heatHi: '#6fbfa9',
};

/**
 * For firms that brand in black and white, and for anyone printing on a
 * monochrome office laser — where a colored accent becomes an indistinct
 * grey and the report loses the emphasis it was relying on.
 *
 * Gain and loss keep a trace of hue rather than going fully neutral: they are
 * the one place in the report where color carries meaning a reader would
 * otherwise have to infer from a minus sign.
 */
const MONO: ReportTheme = {
  id: 'mono',
  name: 'Mono',
  blurb: 'Black and white — safe on any printer',
  ink: '#000000',
  muted: '#3d3d3d',
  subtle: '#5e5e5e',
  brand: '#2b2b2b',
  brandDark: '#000000',
  border: '#d4d4d4',
  green: '#2f4f36',
  red: '#6b2f2a',
  heatLo: '#f0f0f0',
  heatHi: '#9a9a9a',
};

export const REPORT_THEMES: readonly ReportTheme[] = [WOLFPACK, MIDNIGHT, SLATE, MONO];

export const DEFAULT_REPORT_THEME_ID = WOLFPACK.id;

/** The theme with this id, or the house palette if the id is unknown. */
export function reportTheme(id: string | null | undefined): ReportTheme {
  return REPORT_THEMES.find((t) => t.id === id) ?? WOLFPACK;
}
