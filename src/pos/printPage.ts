/** How wide a thermal printer prints on each paper: the paper less its unprintable edges. */
export const PRINTABLE_WIDTH: Record<58 | 80, number> = { 58: 48, 80: 72 };

const MM_PER_PX = 25.4 / 96;
// Paper fed past the last line, so the receipt tears off below the text.
const FEED_MM = 5;
// A floor for a receipt that measured nothing (not laid out), so it never prints on slivers.
const MIN_HEIGHT_MM = 40;

/**
 * The page of one receipt: the paper's width and the receipt's own height. A page size needs
 * both lengths: `80mm auto` is invalid and dropped, and a single length makes a square page.
 */
export function pageSizeRule(paperWidth: 58 | 80, heightPx: number): string {
  const height = Math.max(MIN_HEIGHT_MM, Math.ceil(heightPx * MM_PER_PX) + FEED_MM);
  return `@page { size: ${paperWidth}mm ${height}mm; margin: 0; }`;
}
