import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { formatTRY } from '@/domain/money';
import { makeTestDb } from '@/test/db';
import { buildReceipt } from './receipt';

let db: MarketDb;
let ekmek: string;
let sut: string;
const at = new Date('2026-10-29T09:00:00Z');
const context = { marketName: 'Kurşunlu Market', deviceName: 'Kasa 1' };

beforeEach(async () => {
  db = makeTestDb();
  ekmek = (await createProduct(db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1 }, at)).id;
  sut = (await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at)).id;
});
afterEach(async () => {
  await db.delete();
});

describe('buildReceipt', () => {
  it('lists lines and totals that add up', async () => {
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at,
      lines: [
        { productId: ekmek, qtyMilli: 2000 },
        { productId: sut, qtyMilli: 1000, lineDiscount: 250 },
      ],
      cartDiscount: 500,
      payments: [{ method: 'cash', amount: 6500 }],
      cashGiven: 10000,
    });
    const model = buildReceipt(sale, context);
    expect(model.lines.map((l) => [l.name, l.detail, l.discount, l.amount])).toEqual([
      ['Ekmek', '2 × ₺15,00', undefined, '₺30,00'],
      ['Süt', '1 × ₺42,50', 'İndirim −₺2,50', '₺40,00'],
    ]);
    expect(model.totals).toEqual([
      { label: 'Ara toplam', amount: '₺70,00' },
      { label: 'Sepet indirimi', amount: '−₺5,00' },
      { label: 'Toplam', amount: '₺65,00' },
    ]);
    expect(model.payments).toEqual([
      { label: 'Nakit', amount: '₺65,00' },
      { label: 'Alınan', amount: '₺100,00' },
      { label: 'Para üstü', amount: '₺35,00' },
    ]);
    expect(model.vat).toEqual([{ label: 'KDV %1 (dahil)', amount: formatTRY(sale.vatTotal) }]);
    expect(model).toMatchObject({
      receiptNo: 'K1-20261029-0001',
      dateTime: '29.10.2026 12:00',
      device: 'Kasa 1',
    });
  });

  it('marks voided and returned receipts', async () => {
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at,
      lines: [{ productId: ekmek, qtyMilli: 1000 }],
      payments: [{ method: 'card', amount: 1500 }],
    });
    const marks = (voided: boolean, returnedAny: boolean) =>
      buildReceipt(sale, { ...context, status: { voided, returnedAny } }).marks;
    expect(marks(false, false)).toEqual([]);
    expect(marks(true, false)).toEqual(['İPTAL EDİLDİ']);
    expect(marks(false, true)).toEqual(['İADESİ VAR']);
  });

  it('shows the market header, the customer and the fixed footer', async () => {
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at,
      lines: [{ productId: ekmek, qtyMilli: 1000 }],
      payments: [{ method: 'card', amount: 1500 }],
    });
    const model = buildReceipt(sale, {
      ...context,
      header: 'Atatürk Cad. 5\nTel 0532 123 45 67',
      footer: 'Teşekkürler',
      customerName: 'Ahmet Yılmaz',
    });
    expect(model.header).toEqual(['Kurşunlu Market', 'Atatürk Cad. 5', 'Tel 0532 123 45 67']);
    expect(model.customer).toBe('Müşteri: Ahmet Yılmaz');
    expect(model.footer).toEqual(['Teşekkürler', 'Bilgi fişidir, mali değeri yoktur.']);
  });

  it('lists every payment of a split sale', async () => {
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at,
      customerId: undefined,
      lines: [{ productId: sut, qtyMilli: 1000 }],
      payments: [
        { method: 'cash', amount: 2000 },
        { method: 'card', amount: 2250 },
      ],
    });
    expect(buildReceipt(sale, context).payments).toEqual([
      { label: 'Nakit', amount: '₺20,00' },
      { label: 'Kart', amount: '₺22,50' },
    ]);
  });
});
