import { describe, expect, it } from 'vitest';
import { closeCashSession, openCashSession } from '@/data/cash';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import type { CashSessionRecord } from '@/data/types';
import { voidSale } from '@/data/voids';
import { makeTestDb } from '@/test/db';
import { zReportModel } from './zReport';

const record: CashSessionRecord = {
  id: 'z1',
  deviceCode: 'K1',
  openedAt: '2026-10-29T06:00:00.000Z',
  openingCash: 20000,
  closedAt: '2026-10-29T18:30:00.000Z',
  cash: { sales: 30000, voids: 1000, refunds: 500, movementsIn: 0, movementsOut: 5000 },
  expectedCash: 43500,
  countedCash: 44000,
  difference: 500,
  summary: {
    salesCount: 12,
    voidCount: 1,
    voidTotal: 1000,
    earlierVoidCount: 1,
    earlierVoidTotal: 1000,
    returnCount: 1,
    returnTotal: 500,
    gross: 52000,
    discounts: 300,
    net: 50500,
    byMethod: { cash: 28500, card: 20000, credit: 2000 },
    vatByRate: [{ rate: 10, base: 45910, vat: 4590 }],
    cost: 40000,
    grossProfit: 10500,
    averageBasket: 4333,
    categories: [],
    bestSellers: [],
    byDevice: [{ deviceCode: 'K1', salesCount: 12, net: 50500 }],
  },
  businessDate: '2026-10-29',
};

describe('zReportModel', () => {
  it('lays out the sales, the payments, the VAT and the drawer', () => {
    const model = zReportModel(record, { marketName: 'Bakkal', deviceName: 'Kasa 1' });
    expect(model.header).toEqual(['Bakkal', 'Z RAPORU']);
    expect(model.device).toBe('Kasa 1 (K1)');
    expect(model.dateTime).toBe('29.10.2026 21:30');
    expect(model.opened).toBe('Açılış 09:00 · İş günü 29.10.2026');
    const rows = Object.fromEntries(
      model.sections.map((section) => [
        section.title,
        section.rows.map((row) => `${row.label}: ${row.amount}`),
      ]),
    );
    expect(rows['Satışlar']).toEqual([
      'İşlem: 12',
      'Satış (iade öncesi): ₺520,00',
      'İade (1): −₺5,00',
      'Önceki satış iptali (1): −₺10,00',
      'Net satış: ₺505,00',
      'Verilen indirim: ₺3,00',
    ]);
    expect(rows['Ödemeler']).toEqual(['Nakit: ₺285,00', 'Kart: ₺200,00', 'Veresiye: ₺20,00']);
    expect(rows['KDV']).toEqual(['Matrah %10: ₺459,10', 'KDV %10: ₺45,90']);
    expect(rows['Kasa']).toEqual([
      'Açılış nakdi: ₺200,00',
      'Nakit satış: ₺300,00',
      'Nakit iptal: −₺10,00',
      'Nakit iade: −₺5,00',
      'Para girişi: ₺0,00',
      'Para çıkışı: −₺50,00',
      'Beklenen: ₺435,00',
      'Sayılan: ₺440,00',
      'Fark: +₺5,00',
    ]);
  });

  it('says when the drawer was never opened', () => {
    const unopened: CashSessionRecord = { ...record, openingCash: 0 };
    delete unopened.openedAt;
    const model = zReportModel(unopened, { marketName: 'Bakkal', deviceName: 'Kasa 1' });
    expect(model.opened).toBe('Kasa açılmadan satış yapıldı. · İş günü 29.10.2026');
  });

  it('adds up after a real close with a void of this day and one of the day before', async () => {
    const db = makeTestDb();
    try {
      const tea = await createProduct(
        db,
        { name: 'Çay', sellPrice: 1000, vatRate: 1 },
        new Date('2026-10-27T09:00:00Z'),
      );
      const sell = (pieces: number, at: string) =>
        recordSale(db, {
          deviceCode: 'K1',
          at: new Date(at),
          lines: [{ productId: tea.id, qtyMilli: pieces * 1000 }],
          payments: [{ method: 'cash', amount: pieces * 1000 }],
        });
      const void_ = (saleId: string, at: string) =>
        voidSale(db, { saleId, reason: 'Yanlış fiş', deviceCode: 'K1', at: new Date(at) });
      const yesterday = await sell(2, '2026-10-28T09:00:00Z');
      await closeCashSession(
        db,
        { deviceCode: 'K1', countedCash: 2000 },
        new Date('2026-10-28T17:00:00Z'),
      );
      await openCashSession(
        db,
        { deviceCode: 'K1', openingCash: 0 },
        new Date('2026-10-29T06:00:00Z'),
      );
      await sell(3, '2026-10-29T07:00:00Z');
      const mistaken = await sell(1, '2026-10-29T07:05:00Z');
      await void_(mistaken.id, '2026-10-29T07:06:00Z');
      await void_(yesterday.id, '2026-10-29T08:00:00Z');
      const z = await closeCashSession(
        db,
        { deviceCode: 'K1', countedCash: 1000 },
        new Date('2026-10-29T17:00:00Z'),
      );
      const model = zReportModel(z, { marketName: 'Bakkal', deviceName: 'Kasa 1' });
      const sales = model.sections.find((section) => section.title === 'Satışlar');
      expect(sales?.rows.map((row) => `${row.label}: ${row.amount}`)).toEqual([
        'İşlem: 1',
        'Satış (iade öncesi): ₺30,00',
        'İade (0): ₺0,00',
        'Önceki satış iptali (1): −₺20,00',
        'Net satış: ₺10,00',
        'Verilen indirim: ₺0,00',
        'İptal edilen fiş (1): ₺10,00',
      ]);
      expect(z).toMatchObject({ expectedCash: 1000, difference: 0 });
    } finally {
      await db.delete();
    }
  });
});
