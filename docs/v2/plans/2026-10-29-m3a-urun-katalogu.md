# Market Kasa v2 · M3a Ürün Kataloğu — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market sahibi "Ürünler" ekranında bütün ürünleri arar, süzer, ekler, düzenler, siler ve geri getirir; ürünleri kategorilere ayırır, kasada kategoriye göre ürün seçer. Barkodlar büyük/küçük harf farkı gözetmeden bulunur ve silinmiş bir ürün barkodunu artık kilitlemez.

**Architecture:** Ekranlar adres çubuğundaki `#/` yolu ile seçilir (çevrimdışı, Electron ve PWA'da aynı çalışır). Kasa dışındaki ekranlar sepet paneli olmadan tam genişlikte açılır. Kategoriler ürünler gibi düzenlenebilir ve eşitlenen bir varlıktır (`categories`, yumuşak silme). Liste süzme ve sıralama saf bir modülde, ekran yalnız çizer. Barkodlar büyük harfle saklanır; aramada ve okutmada harf büyüklüğü fark etmez.

**Tech Stack:** React 19, Dexie 4 (şema v5 ve v6), dexie-react-hooks, Tailwind 4, Radix Dialog, Vitest ve Testing Library.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md):
- §6.2: `categories` (name, sort) ve `products` (barcode market içinde benzersiz, unit, sell_price, buy_price, vat_rate, is_quick, critical_level).
- §6.4: stok hareketlerin toplamıdır.
- §10 Ürünler satırı: arama ve filtreler, ekleme/düzenleme, ürün bazında kritik stok.
- §10 Kasa satırı: kategoriler.
- §13: sade ve profesyonel; en küçük yazı 14 px; ≥ 44 px dokunma; yönetim ekranları tam genişlik.
- §15: okuyucu, harf içeren kodlar.

[docs/v2/ertelenenler.md](../ertelenenler.md) M3 bölümünden bu plan şunları alır: barkodun büyük/küçük harfe duyarlılığı, silinmiş ürünün barkodundaki çıkmaz sokak ve güncellemede barkod çakışması testi.

## Global Constraints

| Kural | Bu kuralı koruyan test |
|---|---|
| Barkod yalnız harf, rakam ve "-" içerir (1–32). Büyük harfle saklanır. Okutmada, aramada ve eşitlemede harf büyüklüğü fark etmez. | Task 2 "stores barcodes in upper case and finds them in any case", "upper-cases a pulled barcode"; Task 7 "opens a product when its barcode is scanned" |
| Barkod ürünler arasında benzersizdir. Silinmiş ürün barkodunu bırakır; canlı ürünün barkodu ne eklemede ne güncellemede alınabilir. | Task 2 "takes a barcode off a deleted product", "refuses a barcode a live product holds, on create and on update" |
| Her değişiklik kendi kaydıyla aynı transaction'da outbox'a yazılır. Silme yumuşaktır (`deletedAt`). | Task 2 "restores a deleted product"; Task 3 "queues every change for sync" |
| Fiyat tamsayı kuruştur ve en fazla ₺1.000.000 olur. KDV oranı yalnız 0, 1, 10 ya da 20 olabilir. | mevcut `products.test.ts`; Task 5 "rejects a price above the limit" |
| Miktar binde bir birimdir. Adet tam sayıdır; kg en fazla 3 ondalık alır. | Task 5 "rejects a fractional quantity for a piece product", "creates a weighed product with its opening stock" |
| Başlangıç stoğu ürünle aynı transaction'da `count` hareketi olarak yazılır. | Task 2 "records opening stock as a count movement" |
| Arayüz Türkçedir; her alanın görünür etiketi vardır; en küçük yazı 14 px; dokunma hedefleri ≥ 44 px. | Bütün arayüz testleri `getByLabelText` ya da `getByRole(name)` kullanır; boyutları inceleme okur |

**İki cihaz (çevrimdışı):**
- *Aynı barkodu iki cihaz ayrı ürünlere verirse:* sunucu birini seçer (M0b). Çekilen satır, yerelde barkodu tutan ürünün barkodunu bırakır (M1b `releaseBarcode`, artık büyük harfle). Test: Task 2 "upper-cases a pulled barcode".
- *Bir cihaz kategoriyi silerken öteki ona ürün atarsa:* ürün "Kategorisiz" görünür. Test: Task 4 "puts products of a deleted or unknown category under Kategorisiz".
- *İki cihaz aynı adlı kategoriyi açarsa:* ikisi de kalır, birleştirilmez. Kullanıcı birini siler.

## Review Focus

1. **Ürünler ekranında okuyucu.** Harf içeren kod, her büyük harften önce Shift ile gelir. Harf büyüklüğü ürünü bulmayı engellememeli. Form açıkken okutulan kod barkod alanına yazılmalı, listede başka ürün açmamalı. → Task 5 "fills the barcode from a scan", Task 7 "opens a product when its barcode is scanned" (ikisi de `src/test/scan.ts` ile Shift'li olay akışı).
2. **Silinmiş ürünün barkodu.**
   - Kasada okutulunca yeni ürün kaydedilebilmeli.
   - Ürünler ekranında okutulunca silinmiş ürün açılmalı ve geri getirilebilmeli.
   → Task 2, Task 7 "shows deleted products under Silinenler and restores one".
3. **Eski veritabanı.** v4'te "abc" ve "ABC" iki ayrı üründeyse açılış bozulmamalı; en eski ürün barkodu korur. → Task 2 "upper-cases stored barcodes when it opens, keeping the oldest holder".
4. **Büyük katalog.** Binlerce ürünlük listede ekran 100'er satır göstermeli; arama ve süzme bütün listede çalışmalı. → Task 4 testleri, Task 7 "shows 100 products at a time".
5. **Silinen ya da bilinmeyen kategori.**
   - Ürün listede "Kategorisiz" altında görünmeli.
   - Formda "Kategorisiz" seçili gelmeli.
   - Kasadaki kategori düğmelerinde silinen kategori olmamalı.
   → Task 4, Task 5 "shows a missing category as Kategorisiz", Task 8.

## Bu planın dışında

M3'ün geri kalanı [ertelenenler.md](../ertelenenler.md) M3 bölümünde, alt planlarına göre yazılıdır:
- **M3b:** CSV/XLSX içe aktarma (sütun eşleme ve önizleme), CSV dışa aktarma, toplu fiyat güncelleme, barkoddan ad önerisi (Open Food Facts).
- **M3c:** Stok ekranında şunlar:
  - mal kabul;
  - ürün bazında hareket geçmişi;
  - elle stok düzeltme;
  - kritik stok listesi;
  - satış satırında birim ("kg");
  - aynı ürünün iki satırı.
- **M3d:** sayım, kamera ile okutma.

Başka aşamalara kalanlar:
- **M4:** tedarikçiler.
- **M6:** ürün ve kategori düzenleme yetkisi, yönetim için yan menü.
- **M0b:** sunucuda barkodun büyük harfe çevrilmesi ve benzersizliği.

---

### Task 1: Ekranlar arası geçiş ve tam genişlik düzen

**Files:**
- **Create:** `src/app/route.ts`, `src/app/route.test.ts`, `src/products/ProductsScreen.tsx` (başlıktan ibaret; Task 7 doldurur)
- **Modify:** `src/app/App.tsx`, `src/app/AppShell.tsx`
- **Test:** `src/app/App.test.tsx`, `src/app/AppShell.test.tsx`

**Interfaces:**
- **Produces:**
  - `type Route = 'pos' | 'products'`.
  - `parseRoute(hash: string): Route`: `'#/products'` → `'products'`; başka her şey → `'pos'`.
  - `useRoute(): Route` (`useSyncExternalStore` ile `hashchange` dinler).
  - `AppShell`'de `cart` verilmezse yan panel hiç çizilmez ve içerik tam genişlik olur. `EmptyCart` kalkar, çünkü `CartPanel` kendi boş durumunu gösterir.
  - Menüde yalnız hazır ekranlar bulunur: Kasa (`#/pos`) ve Ürünler (`#/products`). Diğer ekranlar kendi aşamasında eklenir.
  - `ProductsScreen(): JSX.Element` önce yalnız `AppShell activeNav="products"` ile `<h1>Ürünler</h1>` çizer.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('reads the screen from the address')`: `'#/products'`, `'#/pos'`, `''` ve `'#/bilinmeyen'` denenir.
  - `it('opens the products screen from the menu')`: `App` çizilir, "Ürünler" bağlantısına tıklanır, `heading` "Ürünler" bulunur ve "Ürünler" `aria-current="page"` olur.
  - `it('lists the built sections and marks the active one')`: yalnız Kasa ve Ürünler.
  - `it('leaves out the cart panel when a screen has none')`: `complementary` yok.
- [ ] **Step 2: Çalıştır, FAIL gör:** `npm test -- src/app && npm run typecheck`.
- [ ] **Step 3: Uygula.** `App` rotaya göre `PosScreen` ya da `ProductsScreen` çizer; `DataProvider` ve `ErrorBoundary` ikisini de sarar.
- [ ] **Step 4: Çalıştır, PASS gör:** `npm test -- src/app && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(app): switch between the register and the products screen"`

---

### Task 2: Ürün veri kuralları: barkod, geri getirme, açılış stoğu

**Files:**
- **Modify:** `src/data/products.ts`, `src/data/errors.ts`, `src/data/db.ts`, `src/sync/apply.ts`
- **Test:** `src/data/products.test.ts`, `src/data/db.test.ts`, `src/sync/apply.test.ts`

**Interfaces:**
- **Consumes:** `recordStockMovement` (M1a), `appendOutbox`, `releaseBarcode` (M1b, `apply.ts`).
- **Produces:**
  - `canonicalBarcode(raw: string): string | undefined`:
    - boş → `undefined`;
    - geçersiz karakter → `RangeError`;
    - geçerli → `trim().toUpperCase()`.

    `createProduct` ve `updateProduct` bunu kullanır.
  - `findProductByBarcode(db, code)` aramadan önce büyük harfe çevirir. Geçersiz kod hata atmaz, `undefined` döner.
  - `DuplicateBarcodeError` alanları: `barcode` ve `holderName: string`. Kurucusu `(barcode, holderName)`.
  - Eklemede ve güncellemede barkodu silinmiş bir ürün tutuyorsa:
    - o üründen `barcode` kalkar;
    - aynı transaction'da `{ barcode: null, updatedAt }` yaması kuyruğa girer.

    Canlı ürün tutuyorsa `DuplicateBarcodeError` atılır.
  - `restoreProduct(db, id, at): Promise<ProductRecord>`: `deletedAt` kalkar ve `{ deletedAt: null, updatedAt }` yaması kuyruğa girer. Ürün zaten canlıysa hiçbir şey yazmaz. Ürün yoksa `RecordNotFoundError`.
  - `createProduct(db, input, at, options?: { openingStockMilli?: number })`: `openingStockMilli > 0` ise aynı transaction'da `kind: 'count'` hareketi yazar (`products`, `stockMovements`, `stockLevels`, `outbox`).
  - `db.ts` v5 (`stores({})` + `upgrade`) kayıtlı barkodları büyük harfe çevirir. Çakışmada en eski ürün (`createdAt`, eşitse `id`) barkodu korur, sonrakinden barkod kalkar. Önce kaybedenlerin barkodu silinir, sonra kazananlar yazılır; böylece benzersiz indeks açılışı hiç düşürmez.
  - `apply.ts`: çekilen `products` satırının barkodu `canonicalBarcode` ile yazılır. Geçersiz barkod satırı park eder.

- [ ] **Step 1: Başarısız testleri yaz** (`products.test.ts`'deki "refuses a barcode that another product holds, even a deleted one" testi kaldırılır; yerine alttakiler gelir):
  - `it('stores barcodes in upper case and finds them in any case')`: `'brk-0042'` → kayıt `'BRK-0042'`. `findProductByBarcode(db, ' brk-0042 ')` bulur; `'brk 42'` hata atmadan `undefined` döner.
  - `it('takes a barcode off a deleted product')`: silinmiş A `'869'` tutar. B `'869'` ile eklenir. A'nın barkodu yok olur; outbox'ta A için `{ barcode: null }` yaması bulunur.
  - `it('refuses a barcode a live product holds, on create and on update')`: hata `DuplicateBarcodeError`'dur ve `holderName` "Süt" olur; güncellemede de aynısı.
  - `it('restores a deleted product')`: `deletedAt` kalkar, yama kuyruktadır; canlı ürüne ikinci çağrı outbox'a yazmaz.
  - `it('records opening stock as a count movement')`: `openingStockMilli: 1500` → `stockOf` 1500 verir, hareket `kind: 'count'` olur.
  - `db.test.ts` `it('upper-cases stored barcodes when it opens, keeping the oldest holder')`:
    - aynı adla v4 şemasında ham bir Dexie açılır;
    - `'abc'` (2026-01-01), `'ABC'` (2026-02-01) ve `'x-1'` yazılır;
    - `openMarketDb` ile açılır;
    - beklenen: eski ürün `'ABC'`, yeni ürün barkodsuz, `'X-1'`.
  - `apply.test.ts` `it('upper-cases a pulled barcode and takes it off a local holder')`: yerel ürün `'ABC'` tutar, sunucudan `'abc'` barkodlu başka ürün gelir. Yerel ürün barkodsuz kalır; gelen ürün `'ABC'` ile kaydedilir.
- [ ] **Step 2: Çalıştır, FAIL gör:** `npm test -- src/data src/sync && npm run typecheck`.
- [ ] **Step 3: Uygula.** Barkodu büyük harfe çevirmek `toUpperCase()` ile yapılır: karakter kümesi ASCII olduğundan Türkçe "i" sorunu yoktur.
- [ ] **Step 4: Çalıştır, PASS gör:** `npm test && npm run lint && npm run typecheck`. `NewProductDialog` ve `PosScreen` testleri de yeşil kalmalı.
- [ ] **Step 5: Commit** — `git commit -m "feat(data): case-free barcodes, restore, opening stock; deleted products give up their barcode"`

---

### Task 3: Kategoriler (veri ve eşitleme)

**Files:**
- **Create:** `src/data/categories.ts`, `src/data/categories.test.ts`
- **Modify:** `src/data/types.ts`, `src/data/db.ts`, `src/data/errors.ts`, `src/sync/apply.ts`
- **Test:** `src/data/db.test.ts`, `src/sync/apply.test.ts`

**Interfaces:**
- **Produces:**
  - `type CategoryRecord = { id: string; name: string; sort: number; createdAt: string; updatedAt: string; deletedAt?: string }`.
  - `OutboxTable`'a `'categories'` eklenir; yama birliği `'products' | 'customers' | 'categories'` olur.
  - `db.ts` v6: `categories: 'id, updatedAt'`.
  - `apply.ts`: `categories` varlık tablolarına ve transaction listesine eklenir.
  - `DuplicateCategoryError(name: string)`.
  - `createCategory(db, name: string, at: Date): Promise<CategoryRecord>`:
    - ad kırpılır, en fazla 40 karakter olur;
    - boş ad → `RangeError`;
    - aynı ad canlı bir kategoride varsa (`normalizeForSearch` eşitliği) → `DuplicateCategoryError`;
    - `sort` = en büyük canlı `sort` + 1, hiç kategori yoksa 0.
  - `renameCategory(db, id, name, at): Promise<CategoryRecord>`: aynı kurallar, kendisi hariç. Değişmeyen ad yazılmaz.
  - `deleteCategory(db, id, at): Promise<void>`: yumuşak silme. Ürünlere dokunulmaz; listeler eksik kategoriyi "Kategorisiz" sayar.
  - `reorderCategories(db, orderedIds: readonly string[], at): Promise<void>`: `sort` = dizideki sıra. Yalnız değişenler yamalanır.
  - `listCategories(db): Promise<CategoryRecord[]>`: canlı kategoriler, `sort` sonra ada göre (`'tr'`).

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('creates categories in order and queues every change for sync')`: oluşturma, ad değiştirme, sıralama ve silme dört ayrı outbox kaydı üretir.
  - `it('refuses an empty or duplicate name, the Turkish way')`: "Çay" varken "ÇAY" ve " çay " reddedilir; silinmiş "Çay" engel değildir.
  - `it('renames and reorders with patches of the changed fields only')`.
  - `it('deletes softly and leaves products as they are')`.
  - `db.test.ts`: tablo listesine `categories` eklenir.
  - `apply.test.ts` `it('applies pulled categories')`.
- [ ] **Step 2: Çalıştır, FAIL gör:** `npm test -- src/data src/sync && npm run typecheck`.
- [ ] **Step 3: Uygula.**
- [ ] **Step 4: Çalıştır, PASS gör:** `npm test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(data): categories that sync like products"`

---

### Task 4: Ürün listesi mantığı

**Files:**
- **Create:** `src/products/productList.ts`, `src/products/productList.test.ts`
- **Modify:** `src/pos/format.ts`, `src/pos/format.test.ts`

**Interfaces:**
- **Consumes:** `normalizeForSearch`, `ProductRecord`, `CategoryRecord`.
- **Produces:**
  - `type ProductFilter = 'all' | 'critical' | 'quick' | 'deleted'`.
  - `type CategoryChoice = 'any' | 'none' | string` (string bir kategori kimliğidir).
  - `type ProductRow = { product: ProductRecord; stockMilli: number; categoryName?: string; critical: boolean }`.
  - `buildProductRows(products, levels: ReadonlyMap<string, number>, categories: readonly CategoryRecord[], query: { text: string; filter: ProductFilter; category: CategoryChoice }): ProductRow[]`:
    - `'deleted'` yalnız silinmişleri gösterir, ötekiler yalnız canlıları;
    - metin adda geçer ya da barkodun başıyla eşleşir (harf büyüklüğü fark etmez);
    - `'none'`: `categoryId` yok ya da canlı bir kategoriye ait değil;
    - `critical`: `criticalLevelMilli > 0 && stok ≤ criticalLevelMilli`;
    - sıralama ada göredir (`'tr'`).
  - `criticalCount(products, levels): number`: yalnız canlı ürünler.
  - `format.ts`:
    - `UNIT_LABELS: Record<ProductUnit, string>` = `{ piece: 'adet', kg: 'kg' }`;
    - `formatStock(qtyMilli, unit): string` → "12 adet", "1,25 kg", "−3 adet".

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('filters by text the Turkish way and by barcode prefix in any case')`.
  - `it('puts products of a deleted or unknown category under Kategorisiz')`.
  - `it('flags critical stock only where a level is set')`.
  - `it('shows deleted products only under Silinenler')`.
  - `it('formats stock with its unit')`.
- [ ] **Step 2: Çalıştır, FAIL gör:** `npm test -- src/products src/pos/format`.
- [ ] **Step 3: Uygula.**
- [ ] **Step 4: Çalıştır, PASS gör:** aynı komut, ardından `npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): filter and sort the product list"`

---

### Task 5: Ürün formu

**Files:**
- **Create:** `src/design/ChoiceGroup.tsx`, `src/design/ChoiceGroup.test.tsx`, `src/products/ProductFormDialog.tsx`, `src/products/ProductFormDialog.test.tsx`, `src/test/scan.ts`
- **Modify:** `src/design/index.ts`, `src/pos/NewProductDialog.tsx` (KDV seçimi `ChoiceGroup` olur)

**Interfaces:**
- **Consumes:** Task 2 (`createProduct` + `openingStockMilli`, `updateProduct`, `deleteProduct`, `restoreProduct`, `DuplicateBarcodeError.holderName`), Task 3 (`listCategories`), Task 4 (`UNIT_LABELS`, `formatStock`), `parseTRY`, `parseQuantity`, `useBarcodeScanner`.
- **Produces:**
  - `ChoiceGroup<T extends string | number>({ legend, name, options: readonly { value: T; label: string }[], value: T, onChange(value: T): void })`: `fieldset` ve `legend` içinde radyo düğmeleri; görünüş `NewProductDialog`'daki KDV seçimiyle aynıdır.
  - `scan(code: string): void` (`src/test/scan.ts`): okuyucunun gerçek olay akışını üretir. Her büyük harften önce `Shift` gelir, ardından kodun karakterleri ve `Enter`.
  - `ProductFormDialog({ open, product?: ProductRecord, barcode?: string, onClose(): void, onSaved(message: string): void })`:
    - Başlık: "Yeni ürün" ya da "Ürünü düzenle".
    - Alanlar sırayla:
      - **"Barkod":** ipucu "Okutun ya da yazın; boş bırakılabilir.", `font-mono`, `spellCheck={false}`.
      - **"Ürün adı".**
      - **"Kategori":** `select`; "Kategorisiz" ile canlı kategoriler. Eksik kategori "Kategorisiz" gösterilir.
      - **"Birim":** `ChoiceGroup`; Adet / Kilogram.
      - **"Satış fiyatı".**
      - **"Alış fiyatı":** isteğe bağlı. İki fiyat da geçerliyse ipucu "Birim kâr: ₺X".
      - **"KDV oranı".**
      - **"Kritik stok":** isteğe bağlı, birimle. İpucu "Stok bu miktara inince uyarı verilir. Boş bırakılırsa uyarı yok."
      - **"Hızlı ürünlere ekle".**
      - **Yalnız yenide "Başlangıç stoğu":** ipucu "Rafta şu an kaç {birim} var?".
      - **Düzenlemede:** salt okunur "Stok: {formatStock}" ve "Stok, mal kabul ve sayımla değişir."
    - Düğmeler:
      - "Kaydet": birincil, kayıt sürerken pasif.
      - Canlı üründe "Ürünü sil": yerinde onay ister, "Bu ürün silinsin mi? Satış geçmişi korunur." ile "Sil" / "Vazgeç".
      - Silinmiş üründe "Bu ürün silinmiş." notu ve "Geri getir".
    - Hata metinleri:
      - "Ürün adı gerekli."
      - "Geçerli bir tutar girin."
      - "Fiyat en fazla ₺1.000.000,00 olabilir."
      - "Barkod yalnız harf, rakam ve - içerebilir."
      - "Bu barkod “{holderName}” ürününde kayıtlı."
      - "Adet için tam sayı girin."
      - "Geçerli bir miktar girin."
      - Bilinmeyen hata: "Ürün kaydedilemedi."
    - Açıkken `useBarcodeScanner` okutulan kodu barkod alanına yazar.
    - Bildirim (`onSaved`) metinleri: "Ürün eklendi.", "Ürün kaydedildi.", "Ürün silindi.", "Ürün geri getirildi."

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('creates a weighed product with its opening stock')`: Kilogram, "1,5" → stok 1500, hareket `count`.
  - `it('edits a product and patches only what changed')`.
  - `it('refuses a barcode another product holds and names it')`.
  - `it('rejects a fractional quantity for a piece product')`.
  - `it('rejects a price above the limit')`.
  - `it('deletes after confirming and restores a deleted product')`.
  - `it('fills the barcode from a scan')`: `scan('BRK-0042')`, odak "Ürün adı" alanında. Barkod alanı `'BRK-0042'` olur, ad alanı boş kalır.
  - `it('shows a missing category as Kategorisiz')`.
  - `ChoiceGroup.test.tsx` `it('checks the chosen option and reports a change')`.
- [ ] **Step 2: Çalıştır, FAIL gör:** `npm test -- src/products src/design src/pos/NewProductDialog && npm run typecheck`.
- [ ] **Step 3: Uygula.** Boş ya da "0" girilen isteğe bağlı miktar 0 sayılır; dolu alan `parseQuantity(text, unit)` ile okunur.
- [ ] **Step 4: Çalıştır, PASS gör:** `npm test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): add and edit products in a full form"`

---

### Task 6: Kategori yönetimi

**Files:**
- **Create:** `src/products/CategoriesDialog.tsx`, `src/products/CategoriesDialog.test.tsx`

**Interfaces:**
- **Consumes:** Task 3'ün bütün işlevleri, `DuplicateCategoryError`.
- **Produces:** `CategoriesDialog({ open, onClose(): void })`.
  - Başlık "Kategoriler", açıklama "Sıra, kasadaki düğmelerin sırasıdır."
  - Her satırda adı ve dört ikon düğmesi bulunur; düğme adları kategori adını taşır:
    - "Yukarı taşı: {ad}";
    - "Aşağı taşı: {ad}";
    - "Yeniden adlandır: {ad}";
    - "Sil: {ad}".
  - Yeniden adlandırma yerinde yapılır: "Yeni ad" alanı ile "Kaydet" / "Vazgeç".
  - Silme onayı: "{ad} silinsin mi? Bu kategorideki {n} ürün kategorisiz kalır." ile "Sil" / "Vazgeç". `n` canlı ürün sayısıdır; 0 ise ikinci cümle yazılmaz.
  - Altta "Yeni kategori" alanı ve "Ekle" düğmesi bulunur. Enter ile de eklenir.
  - Hatalar: "Kategori adı gerekli." ve "Bu adda bir kategori var."

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('adds, renames and deletes a category')`.
  - `it('moves a category up')`.
  - `it('refuses a duplicate name')`.
  - `it('says how many products lose the category')`.
- [ ] **Step 2–4:** Run: `npm test -- src/products/CategoriesDialog && npm run lint && npm run typecheck` · önce FAIL, sonra PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): manage categories"`

---

### Task 7: Ürünler ekranı

**Files:**
- **Modify:** `src/products/ProductsScreen.tsx`
- **Create:** `src/products/ProductsScreen.test.tsx`

**Interfaces:**
- **Consumes:** Task 1 (`AppShell` sepetsiz), Task 4, Task 5, Task 6, `findProductByBarcode`, `useBarcodeScanner`, `ToastRegion`, `useToast`.
- **Produces:** `ProductsScreen()`.
  - **Üst satır:** `<h1>Ürünler</h1>`, "{n} ürün" ve "Kategoriler" ile "Yeni ürün" (birincil) düğmeleri.
  - **Araç satırı:**
    - "Ürün ara" alanı (`type="search"`, yer tutucu "Ad ya da barkod").
    - "Kategori" `select`: "Tüm kategoriler", "Kategorisiz" ve kategoriler.
    - "Göster" `ChoiceGroup`: "Tümü", "Kritik stok ({n})", "Hızlı ürünler", "Silinenler".
  - **Tablo** (`caption` ekran okuyucuya "Ürün listesi"):
    - "Ürün" sütunu: ad bir düğmedir ve düzenleme formunu açar; altında barkod `font-mono`.
    - "Kategori" sütunu: `md` ve üstünde.
    - "Satış fiyatı" sütunu: sağa yaslı, sabit genişlikte rakamlar.
    - "Stok" sütunu: birimle. Kritikse "Kritik" rozeti, eksi stok tehlike renginde.
    - "KDV" sütunu: `lg` ve üstünde.
    - Telefonda (375 px) yatay kaydırma olmaz.
  - **Sayfalama:** ilk 100 satır gösterilir. "Daha fazla göster" 100 satır ekler. Altta "{gösterilen} / {toplam} ürün" yazar.
  - **Boş durumlar:** hiç ürün yoksa "Henüz ürün yok." ve "Yeni ürün" ile başlayın. Arama sonuçsuzsa "Aramaya uyan ürün yok."
  - **Okuyucu (dialog kapalıyken):**
    - kod canlı ya da silinmiş bir üründeyse o ürünün formu açılır;
    - değilse "Yeni ürün" formu o barkodla açılır;
    - dialog açıkken ekran okutmayı yok sayar.
  - **Bildirimler:** formun `onSaved` metni `ToastRegion` ile gösterilir.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('lists products with their stock, unit and category')`.
  - `it('finds products by name and filters by category and critical stock')`.
  - `it('opens a product when its barcode is scanned')`: ürünün barkodu `'BRK-0042'`; önce `scan('BRK-0042')` (Shift'li), sonra küçük harfli `scan('brk-0042')`.
  - `it('starts a new product with an unknown scanned barcode')`.
  - `it('shows 100 products at a time')`: 120 ürün → 100 satır; "Daha fazla göster" → 120 satır.
  - `it('shows deleted products under Silinenler and restores one')`.
- [ ] **Step 2: Çalıştır, FAIL gör:** `npm test -- src/products/ProductsScreen && npm run typecheck`.
- [ ] **Step 3: Uygula.** Veri tek bir `useLiveQuery` ile okunur: ürünler, `stockLevels` ve `listCategories`.
- [ ] **Step 4: Çalıştır, PASS gör:** `npm test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Tarayıcıda doğrula** (production build, `kasa-preview`):
  - 1280 px ve 375 px'te ekran yatay kaydırmasız açılır.
  - Tab sırası menü → araç satırı → tablo düğmeleri olur ve odak görünür.
  - Form Enter ile kaydeder, Escape ile kapanır.
  - "Kritik" rozeti ve eksi stok okunur kontrastta.

  Adım çalıştırılamazsa yerine en güçlü kontrol yapılır ve ledger'a `Ruling:` olarak yazılır.
- [ ] **Step 6: Commit** — `git commit -m "feat(products): the products screen"`

---

### Task 8: Kasada kategoriler

**Files:**
- **Modify:** `src/data/products.ts`, `src/pos/ProductPanel.tsx`
- **Test:** `src/data/products.test.ts`, `src/pos/ProductPanel.test.tsx`

**Interfaces:**
- **Consumes:** `listCategories` (Task 3), `ChoiceGroup` (Task 5).
- **Produces:**
  - `listProductsInCategory(db, categoryId: string): Promise<ProductRecord[]>`: canlı ürünler, ada göre (`'tr'`).
  - `ProductPanel`, arama boşken ve en az bir canlı kategori varken ızgaranın üstünde "Ürün grubu" seçimini gösterir: "Hızlı" ve kategoriler, `sort` sırasıyla. Başlık seçime göre "Hızlı ürünler" ya da kategori adıdır.
  - Arama yazılınca ızgara arama sonuçlarını gösterir.
  - Seçili kategori silinirse "Hızlı" grubuna dönülür.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('lists a category's live products by name')` (`products.test.ts`).
  - `it('shows a category's products in the grid')`.
  - `it('hides the group choice when there are no categories')`.
  - `it('falls back to quick products when the chosen category is deleted')`.
- [ ] **Step 2–4:** Run: `npm test -- src/pos/ProductPanel src/data/products && npm run lint && npm run typecheck` · önce FAIL, sonra PASS. Ardından `npm test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(pos): pick products by category at the register"`
