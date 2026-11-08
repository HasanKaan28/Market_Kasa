import { loadDeviceSettings } from '@/app/device';
import { createCategory } from '@/data/categories';
import { createCustomer } from '@/data/customers';
import { openMarketDb } from '@/data/db';
import { recordPayment } from '@/data/ledger';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import type { ProductUnit } from '@/data/types';
import type { VatRate } from '@/domain/pricing';

type DemoProduct = [
  name: string,
  barcode: string,
  category: string,
  price: number,
  vat: VatRate,
  unit: ProductUnit,
  quick: boolean,
];

const PRODUCTS: DemoProduct[] = [
  ['Ekmek', '8690000000011', 'Fırın', 1250, 1, 'piece', true],
  ['Simit', '8690000000028', 'Fırın', 1500, 1, 'piece', true],
  ['Tam yağlı süt 1 L', '8690000000035', 'Süt ürünleri', 4250, 1, 'piece', true],
  ['Ayran 300 ml', '8690000000042', 'Süt ürünleri', 1750, 1, 'piece', true],
  ['Beyaz peynir', '8690000000059', 'Süt ürünleri', 32000, 1, 'kg', false],
  ['Yumurta 10’lu', '8690000000066', 'Kahvaltılık', 8990, 1, 'piece', true],
  ['Domates', '2000000000017', 'Manav', 3490, 1, 'kg', true],
  ['Muz', '2000000000024', 'Manav', 6990, 1, 'kg', false],
  ['Siyah çay 1 kg', '8690000000073', 'Kahvaltılık', 26500, 1, 'piece', false],
  ['Su 0,5 L', '8690000000080', 'İçecek', 750, 1, 'piece', true],
  ['Kola 1 L', '8690000000097', 'İçecek', 4500, 20, 'piece', true],
  ['Makarna 500 g', '8690000000103', 'Bakliyat', 2490, 1, 'piece', false],
  ['Baldo pirinç 1 kg', '8690000000110', 'Bakliyat', 7990, 1, 'piece', false],
  ['Zeytinyağı 1 L', '8690000000127', 'Bakliyat', 38990, 1, 'piece', false],
  ['Bulaşık deterjanı', '8690000000134', 'Temizlik', 8990, 20, 'piece', false],
];

/**
 * Fills this browser's market with a believable week of a small grocery: products, customers on
 * credit and sales spread over the last days. Development only: screenshots and demos.
 */
export async function seedDemo(): Promise<string> {
  const settings = loadDeviceSettings();
  const db = openMarketDb(settings.databaseId ?? settings.marketId);
  if ((await db.products.count()) > 0) {
    return 'Bu markette zaten ürün var; demo verisi eklenmedi.';
  }
  const now = Date.now();
  const at = (daysAgo: number, hour: number, minute = 0) => {
    const day = new Date(now - daysAgo * 86_400_000);
    day.setHours(hour, minute, 0, 0);
    return day;
  };

  const categories = new Map<string, string>();
  for (const name of new Set(PRODUCTS.map(([, , category]) => category))) {
    categories.set(name, (await createCategory(db, name, at(8, 9))).id);
  }
  const products = [];
  for (const [name, barcode, category, price, vat, unit, quick] of PRODUCTS) {
    products.push(
      await createProduct(
        db,
        {
          name,
          barcode,
          categoryId: categories.get(category),
          sellPrice: price,
          buyPrice: Math.round(price * 0.78),
          vatRate: vat,
          unit,
          isQuick: quick,
          criticalLevelMilli: unit === 'kg' ? 3000 : 10_000,
        },
        at(8, 9, 30),
        { openingStockMilli: unit === 'kg' ? 25_000 : 60_000 },
      ),
    );
  }
  const customers = [];
  for (const [name, phone, limit] of [
    ['Ayşe Yılmaz', '05321234567', 200_000],
    ['Mehmet Demir', '05337654321', 150_000],
    ['Fatma Kaya', '05441112233', 100_000],
  ] as const) {
    customers.push(await createCustomer(db, { name, phone, creditLimit: limit }, at(8, 10)));
  }

  // A few dozen baskets a day, some on credit.
  let seed = 7;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  for (let day = 6; day >= 0; day -= 1) {
    const baskets = day === 0 ? 9 : 18 + Math.floor(random() * 10);
    for (let basket = 0; basket < baskets; basket += 1) {
      const lines = [];
      const picked = new Set<number>();
      const size = 1 + Math.floor(random() * 4);
      while (picked.size < size) {
        picked.add(Math.floor(random() * products.length));
      }
      let total = 0;
      for (const index of picked) {
        const product = products[index];
        if (!product) continue;
        const qtyMilli =
          product.unit === 'kg'
            ? 500 + Math.floor(random() * 4) * 250
            : (1 + Math.floor(random() * 3)) * 1000;
        lines.push({ productId: product.id, qtyMilli });
        total += Math.round((product.sellPrice * qtyMilli) / 1000);
      }
      const credit = basket % 9 === 4 ? customers[basket % customers.length] : undefined;
      const method = credit ? 'credit' : basket % 3 === 0 ? 'card' : 'cash';
      await recordSale(db, {
        deviceCode: settings.deviceCode,
        at: at(day, 8 + Math.floor((basket * 12) / baskets), Math.floor(random() * 59)),
        lines,
        payments: [{ method, amount: total }],
        ...(credit ? { customerId: credit.id } : {}),
      });
    }
  }
  const first = customers[0];
  if (first) {
    await recordPayment(
      db,
      { deviceCode: settings.deviceCode, customerId: first.id, amount: 15_000, method: 'cash' },
      at(1, 18),
    );
  }
  return 'Demo verisi eklendi. Sayfayı yenileyin.';
}
