# Market Kasa v2 · M1b Eşitleme Motoru — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cihazdaki outbox'ı sunucuya göndermek, sunucudaki değişiklikleri çekip yerel veritabanına tekrar zararsız (idempotent) biçimde uygulamak ve birden çok cihazın sonunda aynı duruma vardığını kanıtlamak.

**Architecture:** `src/sync/` altında taşıyıcıdan bağımsız bir motor. Sunucu `SyncTransport` arayüzünün arkasında durur. Bu planda gerçek sunucu yerine aynı kuralları uygulayan bir bellek içi `FakeServer` kullanılır; M0b'deki Supabase fonksiyonları aynı sözleşmeyi uygulayacak. Olaylar (satış, stok hareketi, veresiye) "yoksa ekle" ile uygulanır. Varlıklarda (ürün, müşteri) sunucu satırı esas alınır, cihazın henüz gönderilmemiş değişiklikleri üstüne yeniden uygulanır.

**Tech Stack:** Dexie 4 (şema sürüm 2: `meta` tablosu), Vitest, fast-check (özellik testi), M1a'daki `src/data` depoları.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md): §7 (eşitleme protokolü ve çakışma kuralları), §6.4 (türetilen değerler), §15 (uzun çevrimdışı, hata durumu).

## Global Constraints

| Kural | Bu kuralı koruyan test |
|---|---|
| Aynı işlem iki kez gönderilse de sunucuda bir kez uygulanır | Task 2 "applies an insert once however often it is pushed", "ignores a retried patch so a newer edit survives" |
| Aynı satır iki kez çekilse de cihazda bir kez uygulanır | Task 3 "inserts a foreign event once and updates the stock cache", Task 4 "re-reads an overlap window without duplicating events" |
| Varlıklarda alan bazında son yazan kazanır; `null`, alanın silinmesi demektir | Task 2 "merges patches and clears null fields", Task 3 "removes fields the server cleared" |
| Gönderilmemiş yerel değişiklik, çekilen satırın altında kaybolmaz | Task 3 "keeps a pending local edit on top of the server row" |
| Başarısız gönderimde outbox silinmez | Task 4 "keeps the outbox when a push fails" |
| Barkod çakışmasında en eski ürün (en küçük UUID v7) barkodu tutar; diğerinin barkodu temizlenir | Task 2 "lets the earliest product keep a contested barcode", Task 3 "clears a contested barcode on the local loser first" |
| Bütün cihazlar, eşitlemeden sonra sunucuyla aynı ürünlere, stoklara ve satışlara sahip olur | Task 6 "converges every device to the server" |

## Review Focus

1. **Gönderim yarıda kesilirse:** sunucu işlemi uygulayıp onay cihaza ulaşmazsa işlem tekrar gönderilir; çift satış, çift stok düşüşü olmamalı. → Task 2, Task 4
2. **İki kasa aynı yeni barkodu internetsiz eklerse:** eşitleme takılmamalı, bütün cihazlarda tek bir ürün barkodu tutmalı. → Task 2, 3, 6
3. **Çekme sırasında yerel düzenleme:** kullanıcının henüz gönderilmemiş fiyat değişikliği eski sunucu değeriyle ezilmemeli. → Task 3
4. **Uzun çevrimdışı:** yüzlerce bekleyen işlem sayfa sayfa gönderilmeli; çekme sayfalı ilerlemeli ve sonsuz döngüye girmemeli. → Task 4
5. **Aynı anda iki eşitleme isteği:** zamanlayıcı ve kullanıcı aynı anda tetiklerse tek eşitleme çalışmalı. → Task 5

## Bu planın dışında

- **M0b:** gerçek sunucu (Supabase şeması, RLS, `sync-push`/`sync-pull` fonksiyonları, Realtime yayını) ve sunucu tarafında geç commit edilen işlemlere karşı güvenli imleç. Sunucu, bir push içindeki alt kayıtları (stok hareketi, veresiye) ebeveyn satıştan önce gelse de kabul etmeli: cihaz satışın çocuklarını satıştan önce kuyruğa koyuyor.
- **M2:** motorun arayüze bağlanması (durum rozeti, ağ olaylarının dinlenmesi).

---

### Task 1: Şema sürüm 2 ve çekme imleci

**Files:**
- **Modify:** `src/data/db.ts` (sürüm 2: `meta: 'key'` ve `products`'tan `isQuick` indeksinin kaldırılması: IndexedDB boolean'ı anahtar olarak kabul etmiyor, M1a incelemesi), `src/data/types.ts` (`MetaRecord = { key: string; value: unknown }`), `src/data/db.test.ts`
- **Create:** `src/sync/cursor.ts`
- **Test:** `src/sync/cursor.test.ts`, `src/data/db.test.ts` (tablo listesine `meta`; yeni test "does not index booleans": `db.products.schema.indexes` adları `isQuick` içermez)

**Interfaces:**
- **Produces:**
  - `MarketDb.meta: Table<MetaRecord, string>`
  - `getPullCursor(db: MarketDb): Promise<number>`: kayıt yoksa 0.
  - `setPullCursor(db: MarketDb, value: number): Promise<void>`: `value` 0 veya pozitif güvenli tamsayı değilse `RangeError`.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/sync/cursor.test.ts
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { MarketDb, openMarketDb } from '@/data/db';
import { getPullCursor, setPullCursor } from './cursor';

const opened: Dexie[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

describe('pull cursor', () => {
  it('starts at zero and remembers its value', async () => {
    const db = openMarketDb(`test-${crypto.randomUUID()}`);
    opened.push(db);
    expect(await getPullCursor(db)).toBe(0);
    await setPullCursor(db, 42);
    expect(await getPullCursor(db)).toBe(42);
    await expect(setPullCursor(db, -1)).rejects.toThrow(RangeError);
  });

  it('upgrades a version 1 database without losing rows', async () => {
    const name = `mk2-test-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      products: 'id, &barcode, name, isQuick, updatedAt',
      customers: 'id, name, phone, updatedAt',
      sales: 'id, &receiptNo, [deviceCode+businessDate+seq], occurredAt, customerId',
      stockMovements: 'id, productId',
      stockLevels: 'productId',
      ledger: 'id, customerId',
      outbox: '++seq',
    });
    await v1.table('products').add({ id: 'p1', name: 'Süt' });
    v1.close();
    const db = new MarketDb(name);
    opened.push(db);
    expect(await db.products.get('p1')).toMatchObject({ name: 'Süt' });
    expect(await getPullCursor(db)).toBe(0);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/sync/cursor`
Expected: FAIL. `./cursor` bulunamaz.

- [ ] **Step 3: Şemayı ve imleci yaz**

`db.ts`'te `this.version(1).stores({...})` olduğu gibi kalır; altına `this.version(2).stores({ meta: 'key', products: 'id, &barcode, name, updatedAt' })` eklenir. İmleç `meta` tablosunda `{ key: 'pullCursor', value }` olarak durur.

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/sync/cursor src/data && npm run lint && npm run typecheck`
Expected: PASS. (`src/data/db.test.ts`'teki tablo listesi `meta`'yı içerecek şekilde güncellenir.)

- [ ] **Step 5: Commit**

```bash
git add src/data/db.ts src/data/types.ts src/data/db.test.ts src/sync
git commit -m "feat(sync): add schema version 2 with the pull cursor"
```

---

### Task 2: Protokol ve sahte sunucu

**Files:**
- **Create:** `src/sync/protocol.ts`, `src/sync/fakeServer.ts`
- **Modify:** `src/data/types.ts` (`OutboxItem`'a `opId: string`), `src/data/outbox.ts` (`appendOutbox`, `opId = newId(at.getTime())` atar)
- **Test:** `src/sync/fakeServer.test.ts`, `src/data/outbox.test.ts` (yeni test "gives every operation its own opId")

**Interfaces:**
- **Consumes:** `OutboxItem`, `OutboxTable` (M1a).
- **Changes:** Her outbox işlemi benzersiz bir `opId` (UUID v7) taşır. M1a incelemesi: onayı kaybolan bir yama tekrar gönderilirse, aradaki daha yeni bir değişikliğin üzerine yazmamalı.
- **Produces:**
  - `type SyncTable = OutboxTable`
  - `type PushRequest = { ops: OutboxItem[] }`, `type PushResponse = { acknowledged: number[] }` (işlenen her işlemin cihaz tarafındaki `seq`'i)
  - `type ServerRow = { table: SyncTable; id: string; serverSeq: number; row: Record<string, unknown> }`
  - `type PullRequest = { since: number; limit: number }`, `type PullResponse = { rows: ServerRow[]; latest: number }` (`latest` = dönen son `serverSeq`, satır yoksa `since`)
  - `interface SyncTransport { push(request: PushRequest): Promise<PushResponse>; pull(request: PullRequest): Promise<PullResponse> }`
  - `class FakeServer implements SyncTransport`:
    - `rows(table: SyncTable): Record<string, unknown>[]`: o tablonun güncel satırları, `id` sırasıyla.
    - `failNextPush(error?: Error): void`: sonraki `push` bu hatayla (varsayılan `new Error('network down')`) reddedilir.
- **Sunucu kuralları:**
  0. Daha önce uygulanmış bir `opId` tekrar gelirse işlem uygulanmaz, yalnızca onaylanır.
  1. `insert`: aynı `recordId` varsa hiçbir şey yapılmaz; yoksa kayıt saklanır ve yeni `serverSeq` alır.
  2. `patch`: satır varsa alanlar işlenme sırasıyla uygulanır, `null` alanı siler, satır yeni `serverSeq` alır; satır yoksa yok sayılır.
  3. Her işlemin `seq`'i, uygulansa da uygulanmasa da `acknowledged`'a girer.
  4. `products`'ta bir barkod birden fazla üründe olursa, `id`'si en küçük olan barkodu tutar; diğerlerinden barkod silinir ve onlar yeni `serverSeq` alır.
  5. `pull`, `serverSeq > since` olan satırları `serverSeq` sırasıyla, en fazla `limit` tane döndürür.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/sync/fakeServer.test.ts
import { describe, expect, it } from 'vitest';
import type { OutboxItem } from '@/data/types';
import { FakeServer } from './fakeServer';

const at = '2026-10-29T09:00:00.000Z';
const insert = (seq: number, table: OutboxItem['table'], record: { id: string } & Record<string, unknown>): OutboxItem =>
  ({ seq, opId: `op-${table}-${record.id}`, createdAt: at, kind: 'insert', table, recordId: record.id, record }) as OutboxItem;
const patch = (seq: number, id: string, fields: Record<string, unknown>, opId = `op-${seq}`): OutboxItem =>
  ({ seq, opId, createdAt: at, kind: 'patch', table: 'products', recordId: id, patch: fields }) as OutboxItem;

describe('FakeServer', () => {
  it('applies an insert once however often it is pushed', async () => {
    const server = new FakeServer();
    const op = insert(1, 'sales', { id: 's1', total: 100 });
    expect(await server.push({ ops: [op] })).toEqual({ acknowledged: [1] });
    expect(await server.push({ ops: [{ ...op, seq: 7 }] })).toEqual({ acknowledged: [7] });
    expect(server.rows('sales')).toEqual([{ id: 's1', total: 100 }]);
  });

  it('merges patches and clears null fields', async () => {
    const server = new FakeServer();
    await server.push({ ops: [insert(1, 'products', { id: 'p1', name: 'Süt', barcode: 'B1', sellPrice: 4250 })] });
    await server.push({ ops: [patch(2, 'p1', { sellPrice: 4500, barcode: null })] });
    expect(server.rows('products')).toEqual([{ id: 'p1', name: 'Süt', sellPrice: 4500 }]);
  });

  it('ignores a retried patch so a newer edit survives', async () => {
    const server = new FakeServer();
    await server.push({ ops: [insert(1, 'products', { id: 'p1', name: 'Süt', sellPrice: 4250 })] });
    const first = patch(2, 'p1', { sellPrice: 4500 }, 'op-a');
    await server.push({ ops: [first] });
    await server.push({ ops: [patch(1, 'p1', { sellPrice: 5000 }, 'op-b')] });
    expect(await server.push({ ops: [first] })).toEqual({ acknowledged: [2] });
    expect(server.rows('products')).toEqual([{ id: 'p1', name: 'Süt', sellPrice: 5000 }]);
  });

  it('pages changes in server order', async () => {
    const server = new FakeServer();
    await server.push({ ops: [insert(1, 'sales', { id: 'a' }), insert(2, 'sales', { id: 'b' }), insert(3, 'sales', { id: 'c' })] });
    const first = await server.pull({ since: 0, limit: 2 });
    expect(first.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(first.latest).toBe(2);
    const second = await server.pull({ since: first.latest, limit: 2 });
    expect(second.rows.map((r) => r.id)).toEqual(['c']);
    expect(await server.pull({ since: 3, limit: 2 })).toEqual({ rows: [], latest: 3 });
  });

  it('lets the earliest product keep a contested barcode', async () => {
    const server = new FakeServer();
    await server.push({ ops: [insert(1, 'products', { id: 'p-2', name: 'Geç', barcode: 'X' })] });
    await server.push({ ops: [insert(1, 'products', { id: 'p-1', name: 'Erken', barcode: 'X' })] });
    expect(server.rows('products')).toEqual([
      { id: 'p-1', name: 'Erken', barcode: 'X' },
      { id: 'p-2', name: 'Geç' },
    ]);
    const changes = await server.pull({ since: 0, limit: 10 });
    expect(changes.rows.at(-1)).toMatchObject({ id: 'p-2', row: { id: 'p-2', name: 'Geç' } });
  });

  it('can fail a push on purpose', async () => {
    const server = new FakeServer();
    server.failNextPush();
    await expect(server.push({ ops: [insert(1, 'sales', { id: 's1' })] })).rejects.toThrow('network down');
    expect(await server.push({ ops: [insert(1, 'sales', { id: 's1' })] })).toEqual({ acknowledged: [1] });
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/sync/fakeServer`
Expected: FAIL. `./fakeServer` bulunamaz.

- [ ] **Step 3: `protocol.ts` ve `fakeServer.ts`'i yukarıdaki kurallarla yaz**

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/sync/fakeServer && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/protocol.ts src/sync/fakeServer.ts src/sync/fakeServer.test.ts
git commit -m "feat(sync): define the sync protocol and an in-memory reference server"
```

---

### Task 3: Çekilen satırları uygulamak

**Files:**
- **Create:** `src/sync/apply.ts`
- **Test:** `src/sync/apply.test.ts`

**Interfaces:**
- **Consumes:** Task 1–2, M1a depoları.
- **Produces:**
  - `applyServerRows(db: MarketDb, rows: readonly ServerRow[]): Promise<void>`: tek bir `rw` işleminde, satır sırasıyla:
    - **Olaylar** (`sales`, `stockMovements`, `ledger`): aynı `id` yerelde yoksa eklenir; `stockMovements` eklenince `stockLevels` önbelleğine `delta` eklenir. Varsa hiçbir şey yapılmaz.
    - **Varlıklar** (`products`, `customers`): sunucu satırı (`null` alanlar atılarak) esas alınır; outbox'ta o kayda ait bekleyen işlemler `seq` sırasıyla üstüne uygulanır (`insert` → kaydın alanları, `patch` → alanlar, `null` silme). Ürünlerde son barkod başka bir yerel üründeyse, önce o üründen barkod kaldırılır (outbox'a yazmadan), sonra satır kaydedilir.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/sync/apply.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { acknowledgeOps, pendingOps } from '@/data/outbox';
import { createProduct, updateProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import { makeTestDb } from '@/test/db';
import { applyServerRows } from './apply';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-10-29T09:00:00Z');
const movement = { id: 'm1', productId: 'p1', delta: -2000, kind: 'sale', occurredAt: at.toISOString(), businessDate: '2026-10-29' };

describe('applyServerRows', () => {
  it('inserts a foreign event once and updates the stock cache', async () => {
    const row = { table: 'stockMovements' as const, id: 'm1', serverSeq: 1, row: movement };
    await applyServerRows(db, [row]);
    await applyServerRows(db, [row]);
    expect(await stockOf(db, 'p1')).toBe(-2000);
    expect(await db.stockMovements.count()).toBe(1);
  });

  it('keeps a pending local edit on top of the server row', async () => {
    const p = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    await acknowledgeOps(db, (await pendingOps(db)).map((op) => op.seq ?? -1));
    await updateProduct(db, p.id, { sellPrice: 4500 }, at);
    await applyServerRows(db, [
      { table: 'products', id: p.id, serverSeq: 2, row: { ...p, name: 'Süt 1 L', sellPrice: 5000 } },
    ]);
    expect(await db.products.get(p.id)).toMatchObject({ name: 'Süt 1 L', sellPrice: 4500 });
  });

  it('removes fields the server cleared', async () => {
    const p = await createProduct(db, { barcode: 'B1', name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    await acknowledgeOps(db, (await pendingOps(db)).map((op) => op.seq ?? -1));
    await applyServerRows(db, [{ table: 'products', id: p.id, serverSeq: 3, row: { ...p, barcode: null } }]);
    expect((await db.products.get(p.id))?.barcode).toBeUndefined();
  });

  it('clears a contested barcode on the local loser first', async () => {
    const base = { name: 'X', unit: 'piece', sellPrice: 100, buyPrice: 0, vatRate: 1, isQuick: false, criticalLevelMilli: 0, createdAt: at.toISOString(), updatedAt: at.toISOString() } as const;
    await db.products.add({ ...base, id: 'p-2', barcode: 'X' });
    await applyServerRows(db, [{ table: 'products', id: 'p-1', serverSeq: 4, row: { ...base, id: 'p-1', barcode: 'X' } }]);
    expect((await db.products.get('p-1'))?.barcode).toBe('X');
    expect((await db.products.get('p-2'))?.barcode).toBeUndefined();
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/sync/apply`
Expected: FAIL. `./apply` bulunamaz.

- [ ] **Step 3: `apply.ts`'i yaz**

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/sync/apply && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/apply.ts src/sync/apply.test.ts
git commit -m "feat(sync): apply pulled rows idempotently, keeping pending local edits"
```

---

### Task 4: Bir eşitleme turu

**Files:**
- **Create:** `src/sync/engine.ts`
- **Test:** `src/sync/engine.test.ts`

**Interfaces:**
- **Consumes:** Task 1–3, `pendingOps`, `acknowledgeOps`, `pendingCount` (M1a).
- **Produces:**
  - `type SyncOptions = { batchSize?: number; overlap?: number }` (varsayılan 500 ve 50)
  - `type SyncResult = { pushed: number; pulled: number }`
  - `syncOnce(db: MarketDb, transport: SyncTransport, options?: SyncOptions): Promise<SyncResult>`:
    1. **Gönder:** outbox boşalana kadar `batchSize`'lık sayfalar gönderilir; dönen `acknowledged` silinir. Hiçbir işlem onaylanmazsa döngü durur.
    2. **Çek:** ilk sayfa `since = max(0, imleç − overlap)` ile, sonrakiler bir önceki `latest` ile istenir; her sayfa `applyServerRows` ile uygulanır; imleç `max(imleç, latest)` olarak saklanır; sayfa `batchSize`'dan kısaysa durulur.
    3. `pushed` = onaylanan işlem sayısı, `pulled` = uygulanan satır sayısı.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/sync/engine.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { pendingCount } from '@/data/outbox';
import { createProduct, findProductByBarcode } from '@/data/products';
import { recentSales, recordSale } from '@/data/sales';
import { stockOf } from '@/data/stock';
import { makeTestDb } from '@/test/db';
import { syncOnce } from './engine';
import { FakeServer } from './fakeServer';

let a: MarketDb;
let b: MarketDb;
let server: FakeServer;
beforeEach(() => {
  a = makeTestDb();
  b = makeTestDb();
  server = new FakeServer();
});
afterEach(async () => {
  await a.delete();
  await b.delete();
});

const at = new Date('2026-10-29T09:00:00Z');

async function sellOneMilk(db: MarketDb) {
  const milk = await createProduct(db, { barcode: 'B1', name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
  await recordSale(db, { deviceCode: 'K1', at, lines: [{ productId: milk.id, qtyMilli: 1000 }], payments: [{ method: 'cash', amount: 4250 }] });
  return milk;
}

describe('syncOnce', () => {
  it('moves a product and a sale from one device to another', async () => {
    const milk = await sellOneMilk(a);
    expect(await syncOnce(a, server)).toEqual({ pushed: 3, pulled: 3 });
    expect(await syncOnce(b, server)).toEqual({ pushed: 0, pulled: 3 });
    expect((await findProductByBarcode(b, 'B1'))?.id).toBe(milk.id);
    expect(await stockOf(b, milk.id)).toBe(-1000);
    expect((await recentSales(b)).map((s) => s.receiptNo)).toEqual(['K1-20261029-0001']);
  });

  it('keeps the outbox when a push fails', async () => {
    await sellOneMilk(a);
    server.failNextPush();
    await expect(syncOnce(a, server)).rejects.toThrow('network down');
    expect(await pendingCount(a)).toBe(3);
    await syncOnce(a, server);
    expect(await pendingCount(a)).toBe(0);
  });

  it('pages through large pushes and pulls', async () => {
    for (const code of ['B1', 'B2', 'B3', 'B4', 'B5']) {
      await createProduct(a, { barcode: code, name: code, sellPrice: 100, vatRate: 1 }, at);
    }
    expect(await syncOnce(a, server, { batchSize: 2, overlap: 0 })).toEqual({ pushed: 5, pulled: 5 });
    expect(await syncOnce(b, server, { batchSize: 2, overlap: 0 })).toEqual({ pushed: 0, pulled: 5 });
    expect(await b.products.count()).toBe(5);
  });

  it('re-reads an overlap window without duplicating events', async () => {
    const milk = await sellOneMilk(a);
    await syncOnce(a, server);
    await syncOnce(b, server);
    expect(await syncOnce(b, server, { overlap: 10 })).toEqual({ pushed: 0, pulled: 3 });
    expect(await stockOf(b, milk.id)).toBe(-1000);
    expect(await b.sales.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/sync/engine`
Expected: FAIL. `./engine` bulunamaz.

- [ ] **Step 3: `engine.ts`'i yaz**

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/sync/engine && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/engine.ts src/sync/engine.test.ts
git commit -m "feat(sync): push the outbox and pull server changes page by page"
```

---

### Task 5: Eşitleme durumu ve tek seferde bir eşitleme

**Files:**
- **Create:** `src/sync/runner.ts`
- **Test:** `src/sync/runner.test.ts`

**Interfaces:**
- **Consumes:** Task 4, `pendingCount` (M1a).
- **Produces:**
  - `type SyncState = 'online' | 'offline' | 'pending' | 'error'`
  - `type SyncStatus = { state: SyncState; pendingCount: number; lastSyncedAt?: string; error?: string }`
  - `type SyncRunner = { status(): SyncStatus; subscribe(listener: (status: SyncStatus) => void): () => void; run(): Promise<SyncStatus>; start(intervalMs?: number): void; stop(): void }`
  - `createSyncRunner(deps: { db: MarketDb; transport: SyncTransport; isOnline: () => boolean; now: () => Date }): SyncRunner`
- **Kurallar:**
  - Başlangıç durumu `{ state: 'pending', pendingCount: 0 }`.
  - `run()` sürerken gelen `run()` çağrıları aynı sözü (promise) döndürür.
  - Çevrimdışıyken sunucuya gidilmez: `offline` ve bekleyen işlem sayısı.
  - Başarılı turdan sonra outbox boşsa `online`, değilse `pending`; `lastSyncedAt = now().toISOString()`.
  - Hata olursa `error`, `error` = hata mesajı, bekleyen sayı korunur.
  - Her durum değişikliği abonelere bildirilir. `start(intervalMs = 60000)` aralıkla `run()` çağırır; `stop()` durdurur.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/sync/runner.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { makeTestDb } from '@/test/db';
import { FakeServer } from './fakeServer';
import { createSyncRunner } from './runner';

let db: MarketDb;
let server: FakeServer;
const now = () => new Date('2026-10-29T09:30:00Z');
beforeEach(async () => {
  db = makeTestDb();
  server = new FakeServer();
  await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, new Date('2026-10-29T09:00:00Z'));
});
afterEach(async () => {
  vi.useRealTimers();
  await db.delete();
});

describe('createSyncRunner', () => {
  it('reports offline without calling the server', async () => {
    const push = vi.spyOn(server, 'push');
    const runner = createSyncRunner({ db, transport: server, isOnline: () => false, now });
    expect(await runner.run()).toEqual({ state: 'offline', pendingCount: 1 });
    expect(push).not.toHaveBeenCalled();
  });

  it('reports online after a clean sync', async () => {
    const runner = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    expect(await runner.run()).toEqual({ state: 'online', pendingCount: 0, lastSyncedAt: '2026-10-29T09:30:00.000Z' });
  });

  it('reports an error and keeps the pending count', async () => {
    server.failNextPush();
    const runner = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    expect(await runner.run()).toEqual({ state: 'error', pendingCount: 1, error: 'network down' });
  });

  it('runs one sync at a time', async () => {
    const push = vi.spyOn(server, 'push');
    const runner = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    await Promise.all([runner.run(), runner.run()]);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers and syncs on an interval once started', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const runner = createSyncRunner({ db, transport: server, isOnline: () => true, now });
    const seen: string[] = [];
    runner.subscribe((status) => seen.push(status.state));
    runner.start(1000);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(seen).toContain('online'));
    runner.stop();
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/sync/runner`
Expected: FAIL. `./runner` bulunamaz.

- [ ] **Step 3: `runner.ts`'i yaz**

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/sync/runner && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/runner.ts src/sync/runner.test.ts
git commit -m "feat(sync): add a single-flight sync runner with status updates"
```

---

### Task 6: Çok cihazlı yakınsama testi

**Files:**
- **Modify:** `package.json` (`fast-check` geliştirme bağımlılığı)
- **Test:** `src/sync/convergence.test.ts`

**Interfaces:**
- **Consumes:** Task 1–4 ve M1a depoları. Üretim kodu eklenmez; test başarısız olursa bulunan hata ilgili modülde düzeltilir ve o modülün testine bir regresyon testi eklenir.

- [ ] **Step 1: Bağımlılığı ekle ve testi yaz**

```bash
npm install -D fast-check
```

Test yapısı:
- Her çalıştırmada yeni bir `FakeServer` ve üç cihaz: `K1`, `K2`, `K3`, her biri kendi `makeTestDb()` veritabanıyla.
- Başlangıç: `K1` barkodu `B1`, `B2`, `B3` olan üç ürün (fiyat 1000) ekler ve eşitler; `K2` ve `K3` eşitleyip bunları alır.
- `fc.array(command, { maxLength: 25 })` ile rastgele komut dizisi; `command` şunlardan biri:
  - `{ type: 'sale', device: 0..2, product: 0..2, qty: 1..3 }`: cihaz, ürünü barkodla yerelde bulabiliyorsa `qtyMilli = qty × 1000` ve tutar kadar nakit ödemeyle satış kaydeder.
  - `{ type: 'price', device, product, price: 100..10000 }`: cihaz ürünü bulabiliyorsa `updateProduct` ile fiyatını değiştirir.
  - `{ type: 'newProduct', device, barcode: 'N1' | 'N2' }`: cihaz bu barkodla ürün ekler; yerelde `DuplicateBarcodeError` alırsa atlar.
  - `{ type: 'sync', device }`: `syncOnce`.
- Komutlardan sonra iki tur boyunca her cihaz sırayla `syncOnce` çalıştırır.
- `fc.assert(fc.asyncProperty(...), { numRuns: 15 })`.

```ts
it('converges every device to the server', async () => {
  // property described above; for every device after the final rounds:
  //   product ids and each product's sellPrice and barcode equal the server rows;
  //   server barcodes are unique;
  //   stockOf(product) equals the sum of the server's stockMovements deltas for that product;
  //   sales count equals the server's, and receipt numbers are unique.
});
```

- [ ] **Step 2: Testi çalıştır**

Run: `npm test -- src/sync/convergence`
Expected: PASS. Başarısız olursa fast-check'in küçülttüğü komut dizisi hatayı gösterir: hatayı ilgili modülde düzelt, o modüle regresyon testi ekle (önce kırmızı), sonra yakınsama testini tekrar çalıştır.

- [ ] **Step 3: Bütün kontrolleri çalıştır**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/sync/convergence.test.ts package.json package-lock.json
git commit -m "test(sync): prove three devices converge under random offline interleavings"
```
