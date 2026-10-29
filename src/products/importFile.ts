const DELIMITERS = [';', ',', '\t'] as const;

/**
 * A text file's contents: UTF-8 when the bytes are valid UTF-8, otherwise windows-1254, which
 * Excel uses for CSV on a Turkish Windows. A byte order mark is dropped.
 */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1254').decode(bytes);
  }
  return text.replace(/^\uFEFF/, '');
}

/**
 * The rows of a CSV text. The delimiter is the one of ";", "," and tab that the header line
 * uses most. A field that starts with a quote may hold delimiters, line breaks and doubled
 * quotes; rows with nothing in them are dropped.
 */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text.charAt(index + 1) === '"') {
        field += '"';
        index++;
      } else {
        quoted = false;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(index + 1) === '\n') {
        index++;
      }
      row.push(field);
      addRow(rows, row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  addRow(rows, row);
  return rows;
}

function addRow(rows: string[][], row: string[]): void {
  if (row.some((cell) => cell.trim() !== '')) {
    rows.push(row);
  }
}

/** The delimiter the first line uses most, counting only outside quotes; ";" when none. */
function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === '\n' || char === '\r')) {
      break;
    } else if (!quoted && counts.has(char)) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }
  let best: string = DELIMITERS[0];
  for (const delimiter of DELIMITERS) {
    if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) {
      best = delimiter;
    }
  }
  return best;
}
