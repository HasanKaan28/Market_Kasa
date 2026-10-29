import { describe, expect, it } from 'vitest';
import type { CategoryRecord, ProductRecord } from '@/data/types';
import { productsToCsv } from './exportCsv';
import { decodeText, parseCsv } from './importFile';
import { guessMapping, readImportRows } from './importRows';
import { buildProductRows, indexProducts } from './productList';

const stamp = '2026-10-29T09:00:00.000Z';
const BOM = String.fromCharCode(0xfeff);

const dairy: CategoryRecord = {
  id: 'c-dairy',
  name: 'Süt ürünleri',
  sort: 0,
  createdAt: stamp,
  updatedAt: stamp,
};

const products: ProductRecord[] = [
  {
    id: 'milk',
    barcode: '8690000000017',
    name: 'Süt; 1 L',
    categoryId: dairy.id,
    unit: 'piece',
    sellPrice: 4250,
    buyPrice: 3000,
    vatRate: 1,
    isQuick: true,
    criticalLevelMilli: 5000,
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    id: 'formula',
    name: '=SUM(A1)',
    unit: 'kg',
    sellPrice: 32000,
    buyPrice: 0,
    vatRate: 1,
    isQuick: false,
    criticalLevelMilli: 0,
    createdAt: stamp,
    updatedAt: stamp,
  },
];

const rows = buildProductRows(
  indexProducts(products),
  new Map([
    ['milk', 12000],
    ['formula', -1500],
  ]),
  [dairy],
  { text: '', filter: 'all', category: 'any' },
);

describe('productsToCsv', () => {
  it('writes Excel-safe CSV', () => {
    const csv = productsToCsv(rows);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Barkod;Ürün adı;Kategori;Birim;Satış fiyatı;Alış fiyatı;KDV;Kritik stok;Stok;Hızlı ürün',
      // A name that Excel would run as a formula is written with a leading apostrophe.
      ";'=SUM(A1);;Kg;320,00;;1;;-1,5;Hayır",
      '="8690000000017";"Süt; 1 L";Süt ürünleri;Adet;42,50;30,00;1;5;12;Evet',
      '',
    ]);
  });

  it('round-trips through the importer', () => {
    const table = parseCsv(decodeText(new TextEncoder().encode(productsToCsv(rows))));
    const read = readImportRows(table, guessMapping(table[0] ?? []), true);
    expect(read.map((row) => row.fields)).toEqual([
      {
        name: '=SUM(A1)',
        unit: 'kg',
        sellPrice: 32000,
        vatRate: 1,
        stockMilli: -1500,
        isQuick: false,
      },
      {
        barcode: '8690000000017',
        name: 'Süt; 1 L',
        category: 'Süt ürünleri',
        unit: 'piece',
        sellPrice: 4250,
        buyPrice: 3000,
        vatRate: 1,
        criticalLevelMilli: 5000,
        stockMilli: 12000,
        isQuick: true,
      },
    ]);
    expect(read.flatMap((row) => [...row.errors, ...row.warnings])).toEqual([]);
  });
});
