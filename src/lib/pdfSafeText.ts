/**
 * Which characters the printed report is allowed to contain.
 *
 * react-pdf's default fonts are the PDF standard 14 (Helvetica and friends),
 * whose WinAnsi encoding stops just past Latin-1. A character outside it does
 * not fail loudly — it prints as some other glyph, or as nothing. The report
 * carried `Age 62 → Age 67` on every person page for months and printed
 * "Age 62 ' Age67": the arrow became a stray apostrophe and ate the space
 * after it. Nothing in the test suite could see it, because every assertion
 * ran against the React element tree, where the arrow is simply the arrow.
 *
 * Latin-1 (through U+00FF) is safe wholesale. Above it, WinAnsi carries a
 * short list of typographic characters, and this is the subset the report
 * actually uses — kept as an explicit allowlist rather than a full WinAnsi
 * table so that adding a character is a deliberate act with a chance to check
 * how it prints.
 */
const ALLOWED_ABOVE_LATIN1 = new Set([
  '‘', '’', // ‘ ’ — the typographic apostrophe is everywhere in this copy
  '“', '”', // “ ”
  '–', '—', // – —
  '…', // …
  '•', // •
]);

/**
 * Every character in `text` that the standard-14 fonts cannot print, in the
 * order found and without duplicates. Empty when the text is safe.
 */
export function unprintableInPdf(text: string): string[] {
  const found: string[] = [];
  for (const ch of text) {
    if (ch.codePointAt(0)! <= 0xff) continue;
    if (ALLOWED_ABOVE_LATIN1.has(ch)) continue;
    if (!found.includes(ch)) found.push(ch);
  }
  return found;
}
