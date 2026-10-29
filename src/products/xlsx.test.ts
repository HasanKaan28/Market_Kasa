import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { makeXlsx } from '@/test/xlsx';
import { readXlsx, XlsxReadError } from './xlsx';

const table = [
  ['Barkod', 'Ürün adı', 'Satış fiyatı'],
  ['8690000000017', 'Süt & <Yoğurt>', '42.5'],
];

describe('readXlsx', () => {
  it('reads shared and inline strings and numbers from the first sheet', () => {
    expect(readXlsx(makeXlsx(table))).toEqual(table);
    expect(readXlsx(makeXlsx(table, { sharedStrings: false }))).toEqual(table);
    expect(readXlsx(makeXlsx(table, { secondSheet: [['başka', 'sayfa']] }))).toEqual(table);
  });

  it('keeps the column of a cell when cells are missing', () => {
    expect(
      readXlsx(
        makeXlsx([
          ['A', '', 'C'],
          ['', '', ''],
          ['', 'B'],
        ]),
      ),
    ).toEqual([
      ['A', '', 'C'],
      ['', 'B'],
    ]);
  });

  it('refuses a file that is not a workbook', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow(XlsxReadError);
    expect(() => readXlsx(zipSync({ 'readme.txt': strToU8('merhaba') }))).toThrow(XlsxReadError);
  });
});
