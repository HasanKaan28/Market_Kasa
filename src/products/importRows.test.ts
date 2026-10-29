import { describe, expect, it } from 'vitest';
import { guessMapping, readImportRows } from './importRows';

const V1_HEADERS = [
  'Barkod',
  'Ürün Adı',
  'Kategori',
  'Alış Fiyatı',
  'Satış Fiyatı',
  'KDV %',
  'Mevcut Stok',
  'Birim',
  'Hızlı Satış',
];

function readOne(cells: string[], headers: string[]) {
  const [row] = readImportRows([headers, cells], guessMapping(headers), true);
  return row;
}

describe('guessMapping', () => {
  it('maps the v1 export headers and common names', () => {
    expect(guessMapping(V1_HEADERS)).toEqual({
      barcode: 0,
      name: 1,
      category: 2,
      buyPrice: 3,
      sellPrice: 4,
      vatRate: 5,
      stock: 6,
      unit: 7,
      isQuick: 8,
    });
    expect(guessMapping(['Stok Adı', 'Satış Fiyatı (₺)', 'Miktar', 'Not'])).toEqual({
      name: 0,
      sellPrice: 1,
      stock: 2,
    });
  });
});

describe('readImportRows', () => {
  it('reads values the Turkish way', () => {
    const headers = [
      'Barkod',
      'Ürün adı',
      'Satış fiyatı',
      'Alış fiyatı',
      'KDV',
      'Birim',
      'Stok',
      'Hızlı ürün',
    ];
    expect(
      readOne(
        ['="8690000000017"', ' Süt ', '12,50', '₺1.250,00', '%10', 'Kg', '1,5', 'Evet'],
        headers,
      ),
    ).toEqual({
      rowNumber: 2,
      fields: {
        barcode: '8690000000017',
        name: 'Süt',
        sellPrice: 1250,
        buyPrice: 125000,
        vatRate: 10,
        unit: 'kg',
        stockMilli: 1500,
        isQuick: true,
      },
      errors: [],
      warnings: [],
    });
    // Excel stores a percentage cell as a fraction, and v1 wrote prices with a dot.
    expect(
      readOne(['12.5', '0.2', 'Paket', 'Hayır'], ['Fiyat', 'KDV', 'Birim', 'Hızlı'])?.fields,
    ).toEqual({
      sellPrice: 1250,
      vatRate: 20,
      unit: 'piece',
      isQuick: false,
    });
  });

  it('rejects prices and VAT rates the app does not hold', () => {
    const row = readOne(['1000000,01', 'abc', '18'], ['Satış fiyatı', 'Alış fiyatı', 'KDV']);
    expect(row?.fields).toEqual({});
    expect(row?.errors).toEqual([
      'Fiyat en fazla ₺1.000.000,00 olabilir.',
      'Alış fiyatı okunamadı: "abc".',
      'KDV 0, 1, 10 ya da 20 olmalı.',
    ]);
  });

  it('rounds a price with more decimals to the kuruş, half up', () => {
    // A markup formula such as =B2*1,3 leaves 4,875 in the cell while Excel shows 4,88.
    expect(readOne(['4,875', '0,125'], ['Satış fiyatı', 'Alış fiyatı'])?.fields).toEqual({
      sellPrice: 488,
      buyPrice: 13,
    });
  });

  it('reads a stock below zero, which only a new product refuses', () => {
    expect(readOne(['-3'], ['Stok'])).toMatchObject({ fields: { stockMilli: -3000 }, errors: [] });
  });

  it('refuses a barcode in scientific notation', () => {
    for (const shown of ['8,69E+12', '8.69e12']) {
      expect(readOne([shown, 'Süt'], ['Barkod', 'Ürün adı'])?.errors).toEqual([
        `Barkod bilimsel gösterimde (${shown}): dosyada barkod sütununu metin yapın.`,
      ]);
    }
    expect(readOne(['869 0001'], ['Barkod'])?.errors).toEqual([
      'Barkod yalnız harf, rakam ve - içerebilir.',
    ]);
  });

  it('warns when Excel dropped a leading zero', () => {
    // 036000291452 is a valid UPC-A; Excel shows it as 36000291452.
    const row = readOne(['36000291452'], ['Barkod']);
    expect(row?.fields).toEqual({ barcode: '36000291452' });
    expect(row?.warnings).toEqual([
      'Barkodun başındaki 0 düşmüş olabilir (036000291452?): dosyada barkod sütununu metin yapın.',
    ]);
    expect(readOne(['036000291452'], ['Barkod'])?.warnings).toEqual([]);
  });

  it('reads only the mapped columns and skips empty cells', () => {
    const rows = readImportRows(
      [
        ['Ürün adı', 'Fiyat'],
        ['Simit', ''],
      ],
      { name: 0 },
      true,
    );
    expect(rows).toEqual([{ rowNumber: 2, fields: { name: 'Simit' }, errors: [], warnings: [] }]);
    expect(readImportRows([['Simit', '15']], { name: 0, sellPrice: 1 }, false)[0]?.rowNumber).toBe(
      1,
    );
  });

  it('reads the words Excel and shops write for yes, no and pieces', () => {
    const rows = readImportRows(
      [
        ['DOĞRU', 'AD'],
        ['YANLIŞ', 'ADT'],
        ['doğru', 'PK'],
      ],
      { isQuick: 0, unit: 1 },
      false,
    );
    expect(rows.map((row) => [row.fields.isQuick, row.fields.unit, row.errors])).toEqual([
      [true, 'piece', []],
      [false, 'piece', []],
      [true, 'piece', []],
    ]);
  });

  it('takes a code with a letter E for a barcode, not a number', () => {
    const rows = readImportRows([['12E45'], ['8,69E+12'], ['8.69e+12']], { barcode: 0 }, false);
    expect(rows[0]?.fields.barcode).toBe('12E45');
    expect(rows[0]?.errors).toEqual([]);
    expect(rows.slice(1).map((row) => row.errors.length)).toEqual([1, 1]);
  });

  it('refuses a quantity above 10.000', () => {
    const rows = readImportRows([['10000', '10000,001']], { stock: 0, criticalLevel: 1 }, false);
    expect(rows[0]?.fields.stockMilli).toBe(10_000_000);
    expect(rows[0]?.errors).toEqual(['Kritik stok en fazla 10.000 olabilir.']);
  });

  it('marks a blank cell in a mapped VAT column', () => {
    const rows = readImportRows([['Simit', ''], ['Ayran', '1']], { name: 0, vatRate: 1 }, false);
    expect(rows.map((row) => row.blankVat)).toEqual([true, undefined]);
    expect(readImportRows([['Simit']], { name: 0 }, false)[0]?.blankVat).toBeUndefined();
  });
});
