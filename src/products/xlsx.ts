import { strFromU8, unzipSync } from 'fflate';

const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The file is not an Excel workbook, or it has no sheet to read. */
export class XlsxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxReadError';
  }
}

/**
 * The cells of a workbook's first sheet as text, row by row. Shared, inline and formula strings
 * are read as text and numbers as Excel stores them ("12.5"); a missing cell is "" so every value
 * stays in its column. Rows with nothing in them are dropped, as `parseCsv` drops blank lines.
 */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name.startsWith('xl/') });
  } catch {
    throw new XlsxReadError('Not a zip file');
  }
  const sheet = readXml(files, firstSheetPath(files));
  const sharedStrings = files['xl/sharedStrings.xml']
    ? elements(readXml(files, 'xl/sharedStrings.xml'), 'si').map(richText)
    : [];
  const rows: string[][] = [];
  for (const row of elements(sheet, 'row')) {
    const cells: string[] = [];
    for (const cell of elements(row, 'c')) {
      const column = columnIndex(cell.getAttribute('r')) ?? cells.length;
      while (cells.length < column) {
        cells.push('');
      }
      cells[column] = cellText(cell, sharedStrings);
    }
    if (cells.some((cell) => cell.trim() !== '')) {
      rows.push(cells);
    }
  }
  return rows;
}

/** The path of the first sheet the workbook lists, through the workbook's relationships. */
function firstSheetPath(files: Record<string, Uint8Array>): string {
  const sheet = elements(readXml(files, 'xl/workbook.xml'), 'sheet')[0];
  const id = sheet?.getAttributeNS(RELATIONSHIPS, 'id');
  const target = elements(readXml(files, 'xl/_rels/workbook.xml.rels'), 'Relationship')
    .find((relationship) => relationship.getAttribute('Id') === id)
    ?.getAttribute('Target');
  if (!target) {
    throw new XlsxReadError('The workbook has no sheet');
  }
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function readXml(files: Record<string, Uint8Array>, path: string): Document {
  const bytes = files[path];
  if (!bytes) {
    throw new XlsxReadError(`Missing part: ${path}`);
  }
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new XlsxReadError(`Unreadable part: ${path}`);
  }
  return document;
}

/** Descendants by local name, whatever prefix the producer gave the namespace. */
function elements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName));
}

function cellText(cell: Element, sharedStrings: readonly string[]): string {
  const value = elements(cell, 'v')[0]?.textContent ?? '';
  switch (cell.getAttribute('t')) {
    case 's':
      return sharedStrings[Number(value)] ?? '';
    case 'inlineStr':
      return richText(elements(cell, 'is')[0]);
    case 'b':
      return value === '1' ? 'TRUE' : 'FALSE';
    default:
      return value;
  }
}

/** The text of a string item: its runs joined, without the phonetic guides some files carry. */
function richText(item: Element | undefined): string {
  if (!item) {
    return '';
  }
  return elements(item, 't')
    .filter((text) => text.parentElement?.localName !== 'rPh')
    .map((text) => text.textContent ?? '')
    .join('');
}

/** "C12" → 2. */
function columnIndex(reference: string | null): number | undefined {
  const letters = reference?.match(/^[A-Z]+/)?.[0];
  if (!letters) {
    return undefined;
  }
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}
