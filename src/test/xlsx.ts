import { strToU8, zipSync } from 'fflate';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NUMBER = /^-?\d+(?:\.\d+)?$/;

type Sheet = readonly (readonly string[])[];

/**
 * A real .xlsx file for tests: the parts Excel writes, zipped. Numbers become number cells and
 * text becomes shared strings (or inline strings); an empty value leaves its cell out.
 */
export function makeXlsx(
  rows: Sheet,
  { sharedStrings = true, secondSheet }: { sharedStrings?: boolean; secondSheet?: Sheet } = {},
): Uint8Array {
  const strings: string[] = [];
  const sheetXml = (sheet: Sheet) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><sheetData>${sheet
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row.map((value, c) => cell(value, `${column(c)}${r + 1}`)).join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;

  function cell(value: string, ref: string): string {
    if (value === '') {
      return '';
    }
    if (NUMBER.test(value)) {
      return `<c r="${ref}"><v>${value}</v></c>`;
    }
    if (sharedStrings) {
      strings.push(value);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  }

  const sheets = secondSheet ? [rows, secondSheet] : [rows];
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${RELS}"><sheets>${sheets
        .map((_, i) => `<sheet name="Sayfa${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELS}">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${RELS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}</Relationships>`,
    ),
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });
  if (sharedStrings) {
    files['xl/sharedStrings.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${MAIN}">${strings
        .map((text) => `<si><t>${escapeXml(text)}</t></si>`)
        .join('')}</sst>`,
    );
  }
  return zipSync(files);
}

function column(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
