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
import { BRAND_NAME } from './brand';

export interface ReportTheme {
  id: string;
  /** Shown in the picker. */
  name: string;
  /** One line under the name, describing the look rather than the hex. */
  blurb: string;
  /**
   * Who the report is from.
   *
   * Part of the theme rather than a setting of its own, because a theme is a
   * whole identity: one install may serve two advisers, and picking the
   * palette without picking the name that goes under "Prepared by" would put
   * the wrong firm on a client's report in the one place nobody re-reads.
   */
  firm: string;
  /** An optional second line under the firm — an adviser, or a team. */
  adviser?: string;
  /**
   * The disclosures printed at the end of every report.
   *
   * Part of the theme because it is the firm's text, not the app's: the
   * regulatory line a compliance officer requires is different for every
   * firm, and the app has no business guessing it. Paragraphs are separated
   * by a blank line. `DEFAULT_DISCLOSURE` is the starting point, and it
   * carries a bracketed placeholder for exactly that line.
   */
  disclosure: string;
  /**
   * An optional logo for the cover, as a data URL.
   *
   * Held in the theme rather than fetched from a link: a report is printed in
   * front of a client, and a logo that depends on someone else's server is a
   * logo that is missing exactly when it is being looked at.
   */
  logo?: string;
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
 * The disclosures a report opens with until a firm writes its own.
 *
 * Written for a compliance reader as much as a client: each paragraph is one
 * of the things a financial-planning review usually asks a claiming analysis
 * to say. It is a draft to be reviewed, and the bracketed line says so.
 */
export const DEFAULT_DISCLOSURE = [
  'This report is an educational estimate prepared to help you think about when to ' +
    'claim Social Security. It is not a recommendation to buy or sell any investment or ' +
    'insurance product, and it is not legal, tax, or accounting advice. Consult a ' +
    'qualified professional about your own situation before acting on it.',
  'The figures are estimates. They are based on the information you provided, including ' +
    'the benefit amount on your Social Security statement, and on the assumptions listed in ' +
    'this report for cost-of-living increases, the discount rate, and how long each person is ' +
    'assumed to live. Your actual benefit is determined by the Social Security Administration ' +
    'when you apply and may differ from any figure here. Verify your figures at ssa.gov or ' +
    'with a Social Security representative before you make a decision.',
  'This report is not affiliated with, endorsed by, or approved by the Social Security ' +
    'Administration or any other government agency. Social Security rules are set by law ' +
    'and can change.',
  'This report was prepared for the people named on the cover and is intended for their ' +
    'use only.',
  '[Replace this paragraph with your firm’s regulatory disclosure, for example: Advisory ' +
    'services are offered through Firm Name, a registered investment adviser. Insurance ' +
    'products are offered through Agency Name.]',
].join('\n\n');

/** How long a disclosure may be. Long enough for a page; not a novel. */
export const MAX_DISCLOSURE_CHARS = 6000;

/** Whether a disclosure still carries the placeholder a firm has to replace. */
export function disclosureHasPlaceholder(text: string): boolean {
  return /\[[^\]]*\]/.test(text);
}

/**
 * The house palette, and the one the app itself wears. Bronze accents on
 * warm white, with the claiming grid in cool blue so the heat surface reads
 * as data rather than as more branding.
 */
const WOLFPACK: ReportTheme = {
  id: 'wolfpack',
  name: 'Wolfpack',
  blurb: 'Bronze on warm white, the house palette',
  firm: BRAND_NAME,
  disclosure: DEFAULT_DISCLOSURE,
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
  blurb: 'Navy and gold, traditional and institutional',
  firm: BRAND_NAME,
  disclosure: DEFAULT_DISCLOSURE,
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
  blurb: 'Teal on cool gray, quieter and more modern',
  firm: BRAND_NAME,
  disclosure: DEFAULT_DISCLOSURE,
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
 * gray and the report loses the emphasis it was relying on.
 *
 * Gain and loss keep a trace of hue rather than going fully neutral: they are
 * the one place in the report where color carries meaning a reader would
 * otherwise have to infer from a minus sign.
 */
const MONO: ReportTheme = {
  id: 'mono',
  name: 'Mono',
  blurb: 'Black and white, safe on any printer',
  firm: BRAND_NAME,
  disclosure: DEFAULT_DISCLOSURE,
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

/**
 * The colors an adviser can set, in the order the editor lists them.
 *
 * `floor` is the contrast this color must reach against white paper for the
 * report to stay readable — the same numbers `reportTheme.test.ts` holds the
 * presets to. The editor warns rather than refuses: a firm's own brand color
 * is not ours to reject, and the warning is what tells them why the printed
 * page looked washed out.
 */
export interface ThemeColorField {
  key: ThemeColorKey;
  label: string;
  blurb: string;
  /** Minimum contrast against paper, or null where contrast is not the point. */
  floor: number | null;
}

export type ThemeColorKey =
  | 'ink'
  | 'muted'
  | 'subtle'
  | 'brand'
  | 'brandDark'
  | 'border'
  | 'green'
  | 'red'
  | 'heatLo'
  | 'heatHi';

export const THEME_COLORS: readonly ThemeColorField[] = [
  { key: 'ink', label: 'Ink', blurb: 'Headings and body text', floor: 4.5 },
  { key: 'muted', label: 'Muted', blurb: 'Captions and sub-labels', floor: 4.5 },
  { key: 'subtle', label: 'Subtle', blurb: 'Column headers and footnotes', floor: 3 },
  { key: 'brand', label: 'Brand', blurb: 'Rules, accents, and the big figures', floor: 4.5 },
  { key: 'brandDark', label: 'Brand dark', blurb: 'Text on a tinted fill', floor: 4.5 },
  { key: 'border', label: 'Border', blurb: 'Hairlines and table rules', floor: null },
  { key: 'green', label: 'Gain', blurb: 'A figure better than the baseline', floor: 4.5 },
  { key: 'red', label: 'Loss', blurb: 'A figure worse than the baseline', floor: 4.5 },
  { key: 'heatLo', label: 'Heat low', blurb: 'The coolest cell in a heat map', floor: null },
  { key: 'heatHi', label: 'Heat high', blurb: 'The warmest cell in a heat map', floor: null },
];

/* ------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------ */

/** WCAG relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const channels = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** The report is printed on white, so every ratio is measured against it. */
export const PAPER = '#ffffff';

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Why this color will not print well, or null if it will.
 *
 * Only the fields that carry text are checked. A border is meant to be faint
 * and a heat ramp is meant to be pale — holding either to a text floor would
 * warn about the two colors that are correct.
 */
export function themeColorWarning(field: ThemeColorField, value: string): string | null {
  if (field.floor === null) return null;
  const ratio = contrastRatio(value, PAPER);
  if (ratio >= field.floor) return null;
  return `${ratio.toFixed(1)}:1 on paper, below ${field.floor}:1, so this will print faint`;
}

export const DEFAULT_REPORT_THEME_ID = WOLFPACK.id;

/** The theme with this id, or the house palette if the id is unknown. */
export function reportTheme(id: string | null | undefined): ReportTheme {
  return REPORT_THEMES.find((t) => t.id === id) ?? WOLFPACK;
}

/* ------------------------------------------------------------------ *
 * Import, export, and repair
 * ------------------------------------------------------------------ */

export const THEME_FILE_KIND = 'wolfpack-report-theme';

interface ThemeFile {
  kind: typeof THEME_FILE_KIND;
  version: 1;
  theme: ReportTheme;
}

export function serializeTheme(theme: ReportTheme): string {
  const file: ThemeFile = { kind: THEME_FILE_KIND, version: 1, theme };
  return JSON.stringify(file, null, 2);
}

/** `#rgb` and `#rrggbb`, the two forms a color input will hand back. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !HEX.test(raw.trim())) return fallback;
  const hex = raw.trim().toLowerCase();
  if (hex.length === 7) return hex;
  // `#abc` → `#aabbcc`, so everything downstream sees one shape.
  return `#${[...hex.slice(1)].map((c) => c + c).join('')}`;
}

function cleanText(raw: unknown, fallback: string, max: number): string {
  if (typeof raw !== 'string') return fallback;
  const text = raw.trim().slice(0, max);
  return text.length > 0 ? text : fallback;
}

/**
 * How large a stored logo may be, in characters of data URL.
 *
 * Roughly 200KB of image. Every theme is written to localStorage on every
 * change and carried in an exported file, and a browser's whole storage
 * budget is a few megabytes — one unbounded logo would take the layouts and
 * the client list down with it.
 */
export const MAX_LOGO_CHARS = 280_000;

function cleanLogo(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // Data URLs only. A remote link would make the cover depend on a server
  // being reachable while a client is watching, and `javascript:` has no
  // business anywhere near an `<Image src>`.
  if (!/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(raw)) return undefined;
  if (raw.length > MAX_LOGO_CHARS) return undefined;
  return raw;
}

/**
 * Repair anything that claims to be a theme.
 *
 * Themes arrive from a colleague's file and from this browser's own storage,
 * so every field is checked rather than trusted. A missing or unreadable
 * color falls back to the house palette's, which means a half-written file
 * still opens as a usable theme instead of printing `undefined` into a PDF.
 */
export function parseTheme(raw: unknown): ReportTheme | null {
  if (raw === null || typeof raw !== 'object') return null;
  const outer = raw as Record<string, unknown>;
  const source =
    outer.kind === THEME_FILE_KIND && outer.theme !== null && typeof outer.theme === 'object'
      ? (outer.theme as Record<string, unknown>)
      : outer;
  // Something with none of a theme's fields is not a damaged theme, it is
  // some other file the adviser picked by mistake, and saying so beats
  // silently opening a copy of the house palette under its name.
  const hasAny = ['name', 'ink', 'brand', 'firm'].some((key) => key in source);
  if (!hasAny) return null;

  const colors = Object.fromEntries(
    THEME_COLORS.map((field) => [field.key, normalizeHex(source[field.key], WOLFPACK[field.key])]),
  ) as Record<ThemeColorKey, string>;

  const theme: ReportTheme = {
    id: cleanText(source.id, `theme-${Date.now()}`, 60),
    name: cleanText(source.name, 'Imported theme', 60),
    blurb: cleanText(source.blurb, 'Imported', 80),
    firm: cleanText(source.firm, BRAND_NAME, 80),
    disclosure:
      typeof source.disclosure === 'string'
        ? source.disclosure.trim().slice(0, MAX_DISCLOSURE_CHARS)
        : DEFAULT_DISCLOSURE,
    ...colors,
  };
  const adviser = typeof source.adviser === 'string' ? source.adviser.trim().slice(0, 80) : '';
  if (adviser.length > 0) theme.adviser = adviser;
  const logo = cleanLogo(source.logo);
  if (logo !== undefined) theme.logo = logo;
  return theme;
}

/** Parse a `.json` file's text. Returns null rather than throwing. */
export function parseThemeFile(text: string): ReportTheme | null {
  try {
    return parseTheme(JSON.parse(text));
  } catch {
    return null;
  }
}
