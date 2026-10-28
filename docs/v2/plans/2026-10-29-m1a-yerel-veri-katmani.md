# Market Kasa v2 · M1a Yerel Veri Katmanı — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasanın internetsiz çalışacağı cihaz veritabanını ve depolarını kurmak: ürünler, müşteriler, stok seviyesi ve bir satışın tek işlemde (satış + stok hareketi + veresiye + fiş numarası + outbox) kaydı.

**Architecture:** `src/data/` altında Dexie (IndexedDB) üzerine kurulu depolar. Her yazma tek bir Dexie işlemi (transaction) içinde olur ve değişen her kayıt için outbox'a bir işlem ekler (M1b'de sunucuya bu outbox gönderilecek). Satış, stok hareketi ve veresiye kaydı değişmez olaylardır: yalnızca eklenir. Ürün ve müşteri düzenlenebilir varlıklardır: yama (patch) ile güncellenir, silinince `deletedAt` alır. Hesaplar M0'daki `src/domain/` fonksiyonlarıyla yapılır.

**Tech Stack:** Dexie 4, fake-indexeddb (testlerde), Vitest, M0'daki domain modülleri.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md): §6 (veri modeli), §7 (eşitleme: outbox, fiş no), §9 (para ve KDV), §15 (çift tıklama, uç durumlar).

## Global Constraints

| Kural | Bu kuralı koruyan test |
|---|---|
| Her para ve miktar tamsayıdır (kuruş, `qtyMilli`); yazılan hiçbir kayıtta kesir olmaz | Task 3 "rejects invalid prices and VAT rates", Task 4 "rejects a fractional credit limit", Task 6 "rejects fractional payment amounts" |
| KDV oranı yalnızca 0, 1, 10, 20 | Task 3 "rejects invalid prices and VAT rates" |
| Değişen her kayıt için outbox'a tam olarak bir işlem eklenir | Task 3, 4, 5 ve 6'daki outbox iddiaları |
| Olaylar (satış, stok hareketi, veresiye) yalnızca eklenir; güncelleme/silme fonksiyonu yoktur | Task 6 "queues every sale record as an insert" |
| Fiş numarası cihaz ve iş günü başına benzersizdir, saat geri gitse de | Task 6 "numbers receipts per device and business day" |
| v2 veritabanı v1'inkinden (`MarketPosDB`) ayrıdır; adı `mk2-<marketId>` | Task 1 "names the database per market" |
| İş günü `businessDate` ile hesaplanır (Europe/Istanbul, gün dönümü ayarı) | Task 6 "numbers receipts per device and business day" |

## Review Focus

1. **Silinmiş ya da bilinmeyen ürünle satış:** hata vermeli, hiçbir kayıt yazılmamalı. → Task 6
2. **Tutmayan ödeme:** ödemelerin toplamı satış toplamına eşit değilse ya da kesirliyse satış reddedilmeli. → Task 6
3. **Veresiye uç durumları:** müşterisiz, arşivlenmiş müşteriyle ya da limit aşımında (izin yoksa) satış reddedilmeli. → Task 6
4. **Gece yarısı ve saat geri dönüşü:** fiş numaraları tekrar etmemeli. → Task 6
5. **Barkod çakışması:** silinmiş bir üründe kayıtlı barkod da dahil; baştaki/sondaki boşluklar kırpılmalı. → Task 3

## Bu planın dışında

- **M1b:** eşitleme motoru (outbox gönderme, değişiklik çekme, sahte sunucuyla yakınsama testleri), eşitleme imleci için `meta` tablosu.
- **M2:** sepet, bekletme, iade, kasa ekranları. **M3:** kategori, mal kabul, sayım. **M4:** tahsilat ve tedarikçiler.

---

### Task 1: Kimlikler ve veritabanı şeması

**Files:**
- **Create:** `src/data/ids.ts`, `src/data/types.ts`, `src/data/db.ts`, `src/data/errors.ts`, `src/test/db.ts`
- **Modify:** `src/test/setup.ts` (`import 'fake-indexeddb/auto';` en üste), `package.json` (`fake-indexeddb` geliştirme bağımlılığı)
- **Test:** `src/data/ids.test.ts`, `src/data/db.test.ts`

**Interfaces:**
- **Produces:**
  - `newId(now?: number, random?: Uint8Array): string`: UUID v7. 48 bit milisaniye zamanı, sürüm 7, varyant `10`; `random` 10 bayt (varsayılan `crypto.getRandomValues`).
  - `src/data/types.ts` kayıt tipleri:
    - `ProductUnit = 'piece' | 'kg'`
    - `ProductRecord = { id; barcode?; name; categoryId?; unit: ProductUnit; sellPrice: Kurus; buyPrice: Kurus; vatRate: VatRate; isQuick: boolean; criticalLevelMilli: number; createdAt: string; updatedAt: string; deletedAt?: string }`
    - `CustomerRecord = { id; name; phone?; creditLimit: Kurus; createdAt; updatedAt; archivedAt? }` (`creditLimit` 0 = limitsiz)
    - `PaymentMethod = 'cash' | 'card' | 'credit'`, `Payment = { method: PaymentMethod; amount: Kurus }`
    - `SaleLine = { productId; name; barcode?; qtyMilli; unitPrice; vatRate; lineDiscount; cartShare; net; vat; buyPrice }`
    - `SaleRecord = { id; receiptNo; deviceCode; seq; businessDate; occurredAt; staffId?; customerId?; lines: SaleLine[]; subtotal; cartDiscount; total; vatTotal; vatByRate; payments: Payment[]; cashGiven?: Kurus; change: Kurus }`
    - `StockMovementKind = 'sale' | 'return' | 'void' | 'purchase' | 'count' | 'manual'`
    - `StockMovementRecord = { id; productId; delta: number; kind: StockMovementKind; refId?; occurredAt; businessDate }`
    - `StockLevelRecord = { productId: string; qtyMilli: number }`
    - `LedgerRecord = { id; customerId; kind: LedgerKind; amount: Kurus; saleId?; note?; occurredAt; businessDate }`
    - `OutboxTable = 'products' | 'customers' | 'sales' | 'stockMovements' | 'ledger'`
    - `OutboxOp = { kind: 'insert'; table: OutboxTable; recordId: string; record: object } | { kind: 'patch'; table: 'products' | 'customers'; recordId: string; patch: object }`
    - `OutboxItem = OutboxOp & { seq?: number; createdAt: string }`
  - `class MarketDb extends Dexie` ve tabloları: `products`, `customers`, `sales`, `stockMovements`, `stockLevels`, `ledger`, `outbox`. Şema (sürüm 1):
    - `products: 'id, &barcode, name, isQuick, updatedAt'`
    - `customers: 'id, name, phone, updatedAt'`
    - `sales: 'id, &receiptNo, [deviceCode+businessDate+seq], occurredAt, customerId'`
    - `stockMovements: 'id, productId'`
    - `stockLevels: 'productId'`
    - `ledger: 'id, customerId'`
    - `outbox: '++seq'`
  - `openMarketDb(marketId: string): MarketDb`: ad `mk2-${marketId}`; `marketId` `^[a-z0-9-]{1,64}$` değilse `RangeError`.
  - `src/data/errors.ts`: `NotFoundError`, `DuplicateBarcodeError`, `PaymentMismatchError`, `CreditLimitError` (hepsi `Error`'dan türer, `name` alanı sınıf adı).
  - `src/test/db.ts`: `makeTestDb(): MarketDb` (`openMarketDb(\`test-${crypto.randomUUID()}\`)`).

- [ ] **Step 1: Bağımlılığı ekle ve başarısız testleri yaz**

```bash
npm install -D fake-indexeddb
```

```ts
// src/data/ids.test.ts
import { describe, expect, it } from 'vitest';
import { newId } from './ids';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('lays out a UUID v7 from time and random bytes', () =>
    expect(newId(1793178000000, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(
      '01a181bc-da80-7001-8203-040506070809',
    ));

  it('produces version 7 ids by default', () => expect(newId()).toMatch(V7));

  it('sorts by creation time', () => {
    const early = newId(1000, new Uint8Array(10).fill(255));
    const late = newId(1001, new Uint8Array(10));
    expect(early < late).toBe(true);
  });
});
```

```ts
// src/data/db.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { openMarketDb, type MarketDb } from './db';

let db: MarketDb | undefined;
afterEach(async () => {
  await db?.delete();
  db = undefined;
});

describe('openMarketDb', () => {
  it('names the database per market, apart from v1', () => {
    db = openMarketDb('kursunlu-market');
    expect(db.name).toBe('mk2-kursunlu-market');
    expect(db.name).not.toBe('MarketPosDB');
  });

  it('declares the M1a tables', async () => {
    db = openMarketDb('tables-check');
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'customers', 'ledger', 'outbox', 'products', 'sales', 'stockLevels', 'stockMovements',
    ]);
  });

  it('rejects market ids that are not slug-safe', () =>
    expect(() => openMarketDb('Kurşunlu Market')).toThrow(RangeError));
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/data`
Expected: FAIL. `./ids` ve `./db` bulunamaz.

- [ ] **Step 3: Modülleri yukarıdaki imzalarla yaz**

`newId` bayt düzeni: `b[0..5]` = zaman (big-endian), `b[6] = 0x70 | (r[0] & 0x0f)`, `b[7] = r[1]`, `b[8] = 0x80 | (r[2] & 0x3f)`, `b[9..15] = r[3..9]`; onaltılık, `8-4-4-4-12` tirelerle.

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/data && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data src/test package.json package-lock.json
git commit -m "feat(data): add UUID v7 ids and the per-market Dexie schema"
```

---

### Task 2: Outbox

**Files:**
- **Create:** `src/data/outbox.ts`
- **Test:** `src/data/outbox.test.ts`

**Interfaces:**
- **Consumes:** `MarketDb`, `OutboxOp`, `OutboxItem` (Task 1).
- **Produces:**
  - `appendOutbox(db: MarketDb, op: OutboxOp, at: Date): Promise<void>`: `createdAt = at.toISOString()`. Çağıran, `db.outbox`'ı içeren bir işlemin içinden çağırır.
  - `pendingOps(db: MarketDb, limit?: number): Promise<OutboxItem[]>`: `seq` sırasıyla, varsayılan en fazla 500.
  - `pendingCount(db: MarketDb): Promise<number>`
  - `acknowledgeOps(db: MarketDb, seqs: readonly number[]): Promise<void>`: yalnızca verilen `seq`'leri siler.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/data/outbox.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { acknowledgeOps, appendOutbox, pendingCount, pendingOps } from './outbox';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('outbox', () => {
  it('keeps operations in the order they were queued', async () => {
    await appendOutbox(db, { kind: 'insert', table: 'sales', recordId: 'a', record: { id: 'a' } }, at);
    await appendOutbox(db, { kind: 'patch', table: 'products', recordId: 'p', patch: { sellPrice: 100 } }, at);
    const ops = await pendingOps(db);
    expect(ops.map((op) => op.recordId)).toEqual(['a', 'p']);
    expect(ops[0]?.createdAt).toBe('2026-10-29T09:00:00.000Z');
    expect(await pendingCount(db)).toBe(2);
  });

  it('removes only acknowledged operations', async () => {
    await appendOutbox(db, { kind: 'insert', table: 'sales', recordId: 'a', record: {} }, at);
    await appendOutbox(db, { kind: 'insert', table: 'sales', recordId: 'b', record: {} }, at);
    const [first] = await pendingOps(db);
    await acknowledgeOps(db, [first?.seq ?? -1]);
    expect((await pendingOps(db)).map((op) => op.recordId)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/data/outbox`
Expected: FAIL. `./outbox` bulunamaz.

- [ ] **Step 3: `outbox.ts`'i yaz**

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/data/outbox`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/outbox.ts src/data/outbox.test.ts
git commit -m "feat(data): add the outbox queue"
```

---

### Task 3: Ürün deposu

**Files:**
- **Create:** `src/data/products.ts`, `src/data/text.ts`
- **Test:** `src/data/products.test.ts`

**Interfaces:**
- **Consumes:** `MarketDb`, `ProductRecord` (Task 1), `appendOutbox` (Task 2), `newId`, `assertSafeInteger` ve `VAT_RATES` (M0).
- **Produces:**
  - `normalizeForSearch(text: string): string` (`src/data/text.ts`): kırpar ve `toLocaleLowerCase('tr')` uygular.
  - `type NewProduct = { barcode?: string; name: string; categoryId?: string; unit?: ProductUnit; sellPrice: Kurus; buyPrice?: Kurus; vatRate: VatRate; isQuick?: boolean; criticalLevelMilli?: number }`
  - `type ProductPatch = Partial<NewProduct>`
  - `createProduct(db, input: NewProduct, at: Date): Promise<ProductRecord>`: varsayılanlar `unit 'piece'`, `buyPrice 0`, `isQuick false`, `criticalLevelMilli 0`; `createdAt = updatedAt = at.toISOString()`. Outbox: `insert` ve tam kayıt.
  - `updateProduct(db, id: string, patch: ProductPatch, at: Date): Promise<ProductRecord>`: outbox `patch` = değişen alanlar + `updatedAt`.
  - `deleteProduct(db, id: string, at: Date): Promise<void>`: yumuşak silme; outbox `patch` = `{ deletedAt, updatedAt }`.
  - `findProductByBarcode(db, barcode: string): Promise<ProductRecord | undefined>`: silinmişleri döndürmez.
  - `searchProducts(db, query: string, limit?: number): Promise<ProductRecord[]>`: silinmişler hariç; ad (`normalizeForSearch` ile) içeriyorsa ya da barkod sorguyla başlıyorsa eşleşir; ada göre `localeCompare(…, 'tr')` sırasıyla; varsayılan en fazla 50.
- **Doğrulama:**
  - Ad kırpılır, boşsa `RangeError`.
  - Barkod kırpılır; boş metin barkodsuz demektir; `^[0-9A-Za-z-]{1,32}$` değilse `RangeError`.
  - `sellPrice`, `buyPrice`, `criticalLevelMilli` güvenli tamsayı ve ≥ 0; değilse `RangeError`.
  - `vatRate` `VAT_RATES` içinde değilse `RangeError`.
  - Barkod başka bir üründe (silinmiş olsa da) varsa `DuplicateBarcodeError`.
  - Bilinmeyen `id` için `NotFoundError`.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/data/products.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { DuplicateBarcodeError } from './errors';
import { pendingOps } from './outbox';
import {
  createProduct,
  deleteProduct,
  findProductByBarcode,
  searchProducts,
  updateProduct,
} from './products';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const later = new Date('2026-10-29T10:00:00Z');

describe('products', () => {
  it('creates a product with defaults and queues it', async () => {
    const p = await createProduct(db, { barcode: ' 8690000000017 ', name: '  Süt ', sellPrice: 4250, vatRate: 1 }, at);
    expect(p).toMatchObject({
      barcode: '8690000000017', name: 'Süt', unit: 'piece', buyPrice: 0, isQuick: false,
      criticalLevelMilli: 0, createdAt: '2026-10-29T09:00:00.000Z', updatedAt: '2026-10-29T09:00:00.000Z',
    });
    const ops = await pendingOps(db);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'insert', table: 'products', recordId: p.id, record: p });
  });

  it('refuses a barcode that another product holds, even a deleted one', async () => {
    const p = await createProduct(db, { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    await expect(createProduct(db, { barcode: '8690000000017', name: 'Ayran', sellPrice: 2250, vatRate: 1 }, at)).rejects.toBeInstanceOf(DuplicateBarcodeError);
    await deleteProduct(db, p.id, later);
    await expect(createProduct(db, { barcode: '8690000000017', name: 'Ayran', sellPrice: 2250, vatRate: 1 }, at)).rejects.toBeInstanceOf(DuplicateBarcodeError);
  });

  it('patches only the changed fields', async () => {
    const p = await createProduct(db, { name: 'Simit', sellPrice: 1750, vatRate: 1 }, at);
    const updated = await updateProduct(db, p.id, { sellPrice: 2000 }, later);
    expect(updated).toMatchObject({ sellPrice: 2000, updatedAt: '2026-10-29T10:00:00.000Z' });
    const last = (await pendingOps(db)).at(-1);
    expect(last).toMatchObject({ kind: 'patch', table: 'products', recordId: p.id });
    expect(last && 'patch' in last ? last.patch : undefined).toEqual({
      sellPrice: 2000,
      updatedAt: '2026-10-29T10:00:00.000Z',
    });
  });

  it('soft-deletes and hides deleted products', async () => {
    const p = await createProduct(db, { barcode: '8690000000024', name: 'Siyah Çay', sellPrice: 27900, vatRate: 1 }, at);
    await deleteProduct(db, p.id, later);
    expect(await findProductByBarcode(db, '8690000000024')).toBeUndefined();
    expect(await searchProducts(db, 'çay')).toEqual([]);
    expect((await pendingOps(db)).at(-1)).toMatchObject({
      kind: 'patch', patch: { deletedAt: '2026-10-29T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z' },
    });
  });

  it('searches names the Turkish way and barcodes by prefix', async () => {
    await createProduct(db, { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    await createProduct(db, { barcode: '8690000000024', name: 'Siyah Çay', sellPrice: 27900, vatRate: 1 }, at);
    await createProduct(db, { name: 'Simit', sellPrice: 1750, vatRate: 1 }, at);
    expect((await searchProducts(db, 'ç')).map((p) => p.name)).toEqual(['Siyah Çay']);
    expect((await searchProducts(db, 'SİMİT')).map((p) => p.name)).toEqual(['Simit']);
    expect((await searchProducts(db, '869')).map((p) => p.name)).toEqual(['Siyah Çay', 'Süt']);
  });

  it('rejects invalid prices and VAT rates', async () => {
    await expect(createProduct(db, { name: 'X', sellPrice: -1, vatRate: 1 }, at)).rejects.toThrow(RangeError);
    await expect(createProduct(db, { name: 'X', sellPrice: 10.5, vatRate: 1 }, at)).rejects.toThrow(RangeError);
    await expect(createProduct(db, { name: 'X', sellPrice: 100, vatRate: 18 as VatRate }, at)).rejects.toThrow(RangeError);
    await expect(createProduct(db, { name: '   ', sellPrice: 100, vatRate: 1 }, at)).rejects.toThrow(RangeError);
    await expect(createProduct(db, { barcode: 'abc def', name: 'X', sellPrice: 100, vatRate: 1 }, at)).rejects.toThrow(RangeError);
    expect(await pendingOps(db)).toEqual([]);
  });
});
```

(`VatRate` tipi `@/domain/pricing`'den `type` olarak import edilir.)

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/data/products`
Expected: FAIL. `./products` bulunamaz.

- [ ] **Step 3: `products.ts` ve `text.ts`'i yaz**

Yazmalar `db.transaction('rw', db.products, db.outbox, …)` içinde yapılır; doğrulama yazmadan önce olur.

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/data/products && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/products.ts src/data/products.test.ts src/data/text.ts
git commit -m "feat(data): add the product repository with Turkish search"
```

---

### Task 4: Müşteri deposu

**Files:**
- **Create:** `src/data/customers.ts`
- **Test:** `src/data/customers.test.ts`

**Interfaces:**
- **Consumes:** Task 1–3 (`normalizeForSearch`), `balance` (M0 `src/domain/ledger.ts`).
- **Produces:**
  - `type NewCustomer = { name: string; phone?: string; creditLimit?: Kurus }`
  - `createCustomer(db, input: NewCustomer, at: Date): Promise<CustomerRecord>`: ad kırpılır; telefon yalnızca rakamlara indirgenir (boşsa yok); `creditLimit` varsayılan 0.
  - `updateCustomer(db, id: string, patch: Partial<NewCustomer>, at: Date): Promise<CustomerRecord>`: outbox `patch`.
  - `archiveCustomer(db, id: string, at: Date): Promise<void>`: outbox `patch` = `{ archivedAt, updatedAt }`.
  - `searchCustomers(db, query: string, limit?: number): Promise<CustomerRecord[]>`: arşivlenmişler hariç; ad (`normalizeForSearch`) ya da telefon rakamları eşleşir; varsayılan en fazla 50.
  - `customerBalance(db, customerId: string): Promise<Kurus>`: müşterinin `ledger` kayıtları üzerinden `balance`.
- **Doğrulama:** boş ad, negatif ya da kesirli `creditLimit` → `RangeError`; bilinmeyen `id` → `NotFoundError`.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/data/customers.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import {
  archiveCustomer,
  createCustomer,
  customerBalance,
  searchCustomers,
} from './customers';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('customers', () => {
  it('normalises name and phone and queues the customer', async () => {
    const c = await createCustomer(db, { name: ' Ahmet Yılmaz ', phone: '0 (532) 111 22 33', creditLimit: 250000 }, at);
    expect(c).toMatchObject({ name: 'Ahmet Yılmaz', phone: '05321112233', creditLimit: 250000 });
    expect((await pendingOps(db))[0]).toMatchObject({ kind: 'insert', table: 'customers', recordId: c.id });
  });

  it('finds customers by Turkish name or phone digits, not when archived', async () => {
    const c = await createCustomer(db, { name: 'Ahmet Yılmaz', phone: '05321112233' }, at);
    expect((await searchCustomers(db, 'YILMAZ')).map((x) => x.id)).toEqual([c.id]);
    expect((await searchCustomers(db, '1112')).map((x) => x.id)).toEqual([c.id]);
    await archiveCustomer(db, c.id, at);
    expect(await searchCustomers(db, 'ahmet')).toEqual([]);
  });

  it('starts with a zero balance', async () => {
    const c = await createCustomer(db, { name: 'Fatma' }, at);
    expect(await customerBalance(db, c.id)).toBe(0);
  });

  it('rejects a fractional credit limit', async () =>
    expect(createCustomer(db, { name: 'Fatma', creditLimit: 100.5 }, at)).rejects.toThrow(RangeError));
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/data/customers`
Expected: FAIL. `./customers` bulunamaz.

- [ ] **Step 3: `customers.ts`'i yaz**

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/data/customers && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/customers.ts src/data/customers.test.ts
git commit -m "feat(data): add the customer repository and ledger balance"
```

---

### Task 5: Stok seviyesi

**Files:**
- **Create:** `src/data/stock.ts`
- **Test:** `src/data/stock.test.ts`

**Interfaces:**
- **Consumes:** Task 1–2, `stockLevel` (M0), `businessDate` (M0).
- **Produces:**
  - `recordStockMovement(db, input: { productId: string; delta: number; kind: StockMovementKind; refId?: string; at: Date; cutoffMinutes?: number }): Promise<StockMovementRecord>`: hareketi ekler, `stockLevels` önbelleğini aynı işlemde günceller, outbox'a `insert` ekler. Kendi işlemini açar; bir dış işlemin içinden çağrılırsa Dexie onu kullanır.
  - `stockOf(db, productId: string): Promise<number>`: önbellekten; kayıt yoksa 0.
  - `recomputeStock(db, productId: string): Promise<number>`: hareketlerden `stockLevel` ile hesaplar, önbelleğe yazar, değeri döndürür.
- **Doğrulama:** `delta` güvenli tamsayı ve 0 değil; değilse `RangeError`.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/data/stock.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { recomputeStock, recordStockMovement, stockOf } from './stock';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

describe('stock', () => {
  it('keeps the cached level equal to the sum of movements', async () => {
    await recordStockMovement(db, { productId: 'p1', delta: 50000, kind: 'count', at });
    await recordStockMovement(db, { productId: 'p1', delta: -2000, kind: 'sale', refId: 's1', at });
    expect(await stockOf(db, 'p1')).toBe(48000);
    expect(await recomputeStock(db, 'p1')).toBe(48000);
  });

  it('reports zero for a product without movements', async () =>
    expect(await stockOf(db, 'unknown')).toBe(0));

  it('queues each movement as an insert with its business day', async () => {
    const m = await recordStockMovement(db, { productId: 'p1', delta: -1000, kind: 'sale', at: new Date('2026-10-28T21:30:00Z') });
    expect(m.businessDate).toBe('2026-10-29');
    expect((await pendingOps(db))[0]).toMatchObject({ kind: 'insert', table: 'stockMovements', recordId: m.id });
  });

  it('rejects zero and fractional deltas', async () => {
    await expect(recordStockMovement(db, { productId: 'p1', delta: 0, kind: 'manual', at })).rejects.toThrow(RangeError);
    await expect(recordStockMovement(db, { productId: 'p1', delta: 0.5, kind: 'manual', at })).rejects.toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/data/stock`
Expected: FAIL. `./stock` bulunamaz.

- [ ] **Step 3: `stock.ts`'i yaz**

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/data/stock && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/stock.ts src/data/stock.test.ts
git commit -m "feat(data): add stock movements with a cached level"
```

---

### Task 6: Satış kaydı

**Files:**
- **Create:** `src/data/sales.ts`
- **Test:** `src/data/sales.test.ts`

**Interfaces:**
- **Consumes:** Task 1–5; M0 `computeCart`, `businessDate`, `formatReceiptNo`, `nextReceiptSeq`, `assertSafeInteger`.
- **Produces:**
  - `type RecordSaleInput = { deviceCode: string; at: Date; cutoffMinutes?: number; lines: { productId: string; qtyMilli: number; lineDiscount?: Kurus }[]; cartDiscount?: Kurus; payments: Payment[]; cashGiven?: Kurus; customerId?: string; staffId?: string; allowOverLimit?: boolean }`
  - `recordSale(db, input: RecordSaleInput): Promise<SaleRecord>`
  - `recentSales(db, limit?: number): Promise<SaleRecord[]>`: `occurredAt`'e göre en yeni önce; varsayılan 50.
  - `findSaleByReceiptNo(db, receiptNo: string): Promise<SaleRecord | undefined>`
- **Kurallar** (hepsi yazmadan önce denetlenir):
  1. En az bir satır olmalı; her `productId` var olmalı ve silinmemiş olmalı, yoksa `NotFoundError`.
  2. Toplamlar `computeCart` ile ürünün `sellPrice` ve `vatRate` değerlerinden hesaplanır.
  3. Her ödeme tutarı güvenli tamsayı ve > 0 (`assertSafeInteger`, değilse `RangeError`). Toplamı `total`'a eşit değilse `PaymentMismatchError`.
  4. `credit` ödemesi varsa `customerId` var olan ve arşivlenmemiş bir müşteri olmalı, yoksa `NotFoundError`. `creditLimit > 0` ve (mevcut bakiye + veresiye tutarı) > `creditLimit` ise ve `allowOverLimit` değilse `CreditLimitError`.
  5. `cashGiven` verilirse nakit tutarından küçük olamaz (`PaymentMismatchError`); `change = cashGiven − nakit`, verilmezse 0.
  6. `businessDate(at, { cutoffMinutes })`; sıra = `nextReceiptSeq` (o cihaz ve o iş günündeki en büyük `seq`, `[deviceCode+businessDate+seq]` indeksinden); `receiptNo = formatReceiptNo(...)`.
- **Yazma sırası** (tek `rw` işlemi, `sales`, `products`, `customers`, `stockMovements`, `stockLevels`, `ledger`, `outbox` tablolarını kapsar):
  1. Her satır için `recordStockMovement` (`delta = −qtyMilli`, `kind 'sale'`, `refId = sale.id`).
  2. Veresiye varsa `ledger`'a `{ kind: 'debt', amount: veresiye tutarı, saleId }` ve outbox `insert`.
  3. En son satış kaydı ve onun outbox `insert`'i.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/data/sales.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import { createCustomer, customerBalance } from './customers';
import type { MarketDb } from './db';
import { CreditLimitError, NotFoundError, PaymentMismatchError } from './errors';
import { pendingCount, pendingOps } from './outbox';
import { createProduct, deleteProduct } from './products';
import { findSaleByReceiptNo, recentSales, recordSale } from './sales';
import { stockOf } from './stock';

let db: MarketDb;
let ids: { ekmek: string; ayran: string; peynir: string; cay: string };
const setupAt = new Date('2026-10-28T06:00:00Z');

beforeEach(async () => {
  db = makeTestDb();
  const make = async (name: string, sellPrice: number) =>
    (await createProduct(db, { name, sellPrice, vatRate: 1 }, setupAt)).id;
  ids = {
    ekmek: await make('Ekmek', 1500),
    ayran: await make('Ayran', 2250),
    peynir: await make('Beyaz Peynir', 18990),
    cay: await make('Siyah Çay', 27900),
  };
});
afterEach(async () => {
  await db.delete();
});

const cartLines = () => [
  { productId: ids.ekmek, qtyMilli: 2000 },
  { productId: ids.ayran, qtyMilli: 3000 },
  { productId: ids.peynir, qtyMilli: 1000 },
  { productId: ids.cay, qtyMilli: 1000 },
];
const cashSale = (at: string) => ({
  deviceCode: 'K1',
  at: new Date(at),
  lines: cartLines(),
  payments: [{ method: 'cash' as const, amount: 56640 }],
});

describe('recordSale', () => {
  it('records a cash sale with totals, change and stock movements', async () => {
    const sale = await recordSale(db, { ...cashSale('2026-10-28T09:00:00Z'), cashGiven: 60000 });
    expect(sale).toMatchObject({ receiptNo: 'K1-20261028-0001', total: 56640, vatTotal: 561, change: 3360 });
    expect(await stockOf(db, ids.ekmek)).toBe(-2000);
    expect(await stockOf(db, ids.ayran)).toBe(-3000);
    expect(await findSaleByReceiptNo(db, 'K1-20261028-0001')).toMatchObject({ id: sale.id });
  });

  it('queues every sale record as an insert', async () => {
    const before = await pendingCount(db);
    await recordSale(db, cashSale('2026-10-28T09:00:00Z'));
    const ops = (await pendingOps(db)).slice(before);
    expect(ops.map((op) => [op.kind, op.table])).toEqual([
      ['insert', 'stockMovements'], ['insert', 'stockMovements'], ['insert', 'stockMovements'],
      ['insert', 'stockMovements'], ['insert', 'sales'],
    ]);
  });

  it('numbers receipts per device and business day', async () => {
    const no = async (at: string) => (await recordSale(db, cashSale(at))).receiptNo;
    expect(await no('2026-10-28T09:00:00Z')).toBe('K1-20261028-0001');
    expect(await no('2026-10-28T10:00:00Z')).toBe('K1-20261028-0002');
    expect(await no('2026-10-28T21:30:00Z')).toBe('K1-20261029-0001');
    expect(await no('2026-10-28T20:00:00Z')).toBe('K1-20261028-0003');
  });

  it('writes the credit part of a split payment to the ledger', async () => {
    const c = await createCustomer(db, { name: 'Ahmet' }, setupAt);
    await recordSale(db, {
      ...cashSale('2026-10-28T09:00:00Z'),
      customerId: c.id,
      payments: [{ method: 'cash', amount: 20000 }, { method: 'credit', amount: 36640 }],
    });
    expect(await customerBalance(db, c.id)).toBe(36640);
  });

  it('enforces the credit limit unless allowed', async () => {
    const c = await createCustomer(db, { name: 'Ahmet', creditLimit: 30000 }, setupAt);
    const credit = { ...cashSale('2026-10-28T09:00:00Z'), customerId: c.id, payments: [{ method: 'credit' as const, amount: 56640 }] };
    await expect(recordSale(db, credit)).rejects.toBeInstanceOf(CreditLimitError);
    await recordSale(db, { ...credit, allowOverLimit: true });
    expect(await customerBalance(db, c.id)).toBe(56640);
  });

  it('requires an active customer for credit', async () => {
    const credit = { ...cashSale('2026-10-28T09:00:00Z'), payments: [{ method: 'credit' as const, amount: 56640 }] };
    await expect(recordSale(db, credit)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects payments that do not add up', async () => {
    await expect(recordSale(db, { ...cashSale('2026-10-28T09:00:00Z'), payments: [{ method: 'cash', amount: 50000 }] })).rejects.toBeInstanceOf(PaymentMismatchError);
    await expect(recordSale(db, { ...cashSale('2026-10-28T09:00:00Z'), cashGiven: 50000 })).rejects.toBeInstanceOf(PaymentMismatchError);
  });

  it('rejects fractional payment amounts', async () =>
    expect(recordSale(db, {
      ...cashSale('2026-10-28T09:00:00Z'),
      payments: [{ method: 'cash', amount: 56639.5 }, { method: 'card', amount: 0.5 }],
    })).rejects.toThrow(RangeError));

  it('rejects unknown and deleted products without writing anything', async () => {
    await deleteProduct(db, ids.cay, setupAt);
    const before = await pendingCount(db);
    await expect(recordSale(db, cashSale('2026-10-28T09:00:00Z'))).rejects.toBeInstanceOf(NotFoundError);
    expect(await pendingCount(db)).toBe(before);
    expect(await stockOf(db, ids.ekmek)).toBe(0);
  });

  it('rolls back every write when the sale itself cannot be stored', async () => {
    // A corrupted record already holds the receipt number this sale will get.
    await db.sales.add({ ...(await recordSale(db, cashSale('2026-10-27T09:00:00Z'))), id: 'bogus', receiptNo: 'K1-20261028-0001', businessDate: '2026-10-27', seq: 2 });
    const before = await pendingCount(db);
    await expect(recordSale(db, cashSale('2026-10-28T09:00:00Z'))).rejects.toThrow();
    expect(await pendingCount(db)).toBe(before);
    expect(await stockOf(db, ids.ekmek)).toBe(-2000);
  });

  it('lists recent sales newest first', async () => {
    await recordSale(db, cashSale('2026-10-28T09:00:00Z'));
    await recordSale(db, cashSale('2026-10-28T10:00:00Z'));
    expect((await recentSales(db)).map((s) => s.receiptNo)).toEqual(['K1-20261028-0002', 'K1-20261028-0001']);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/data/sales`
Expected: FAIL. `./sales` bulunamaz.

- [ ] **Step 3: `sales.ts`'i yukarıdaki kurallar ve yazma sırasıyla yaz**

- [ ] **Step 4: Testlerin ve bütün kontrollerin geçtiğini gör**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/sales.ts src/data/sales.test.ts
git commit -m "feat(data): record a sale atomically with stock, ledger and receipt number"
```
