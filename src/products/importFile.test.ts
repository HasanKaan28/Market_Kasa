import { describe, expect, it } from 'vitest';
import { decodeText, parseCsv } from './importFile';

describe('decodeText', () => {
  it("reads UTF-8 with a BOM and Turkish Excel's windows-1254", () => {
    expect(decodeText(new TextEncoder().encode('\uFEFFŞeker Çay'))).toBe('Şeker Çay');
    // "Şeker Çay" and "ğıİöü" as Excel writes them on a Turkish Windows.
    const cp1254 = new Uint8Array([0xde, 0x65, 0x6b, 0x65, 0x72, 0x20, 0xc7, 0x61, 0x79]);
    expect(decodeText(cp1254)).toBe('Şeker Çay');
    expect(decodeText(new Uint8Array([0xf0, 0xfd, 0xdd, 0xf6, 0xfc]))).toBe('ğıİöü');
  });
});

describe('parseCsv', () => {
  it('detects the delimiter from the header', () => {
    expect(parseCsv('a;b;c\n1;2,5;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2,5', '3'],
    ]);
    expect(parseCsv('a,b,c\r\n1,2,3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps delimiters, quotes and line breaks inside quoted fields', () => {
    expect(
      parseCsv('ad;not\n"Süt; tam yağlı";"satır\r\nikinci"\n"Ayran ""ev"" yapımı";5" boru'),
    ).toEqual([
      ['ad', 'not'],
      ['Süt; tam yağlı', 'satır\r\nikinci'],
      ['Ayran "ev" yapımı', '5" boru'],
    ]);
  });

  it('reads a line of the v1 export and drops blank lines', () => {
    const text =
      'Barkod;Ürün Adı;Kategori;Alış Fiyatı;Satış Fiyatı;KDV %;Mevcut Stok;Birim;Hızlı Satış\n' +
      '"8690000000017";"Süt 1 L";"Süt";30;42.5;1;12;"Adet";Evet\n\n';
    expect(parseCsv(text)).toEqual([
      [
        'Barkod',
        'Ürün Adı',
        'Kategori',
        'Alış Fiyatı',
        'Satış Fiyatı',
        'KDV %',
        'Mevcut Stok',
        'Birim',
        'Hızlı Satış',
      ],
      ['8690000000017', 'Süt 1 L', 'Süt', '30', '42.5', '1', '12', 'Adet', 'Evet'],
    ]);
  });
});
