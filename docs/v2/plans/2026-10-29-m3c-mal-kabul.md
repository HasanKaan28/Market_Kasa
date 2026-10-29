# Market Kasa v2 · M3c Mal Kabul ve Stok Hareketleri — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market sahibi Stok ekranında gelen malı okutup miktarını ve yeni alış/satış fiyatını girer, tek seferde kaydeder. Bir ürünün stoğunu nedeniyle düzeltir, her ürünün stok hareketlerini görür ve kritik stoktaki ürünleri mal kabule ekler. Tartılı ürünlerin satışı sepette, iadede ve fişte "kg" ile yazılır.

**Architecture:**
- **Mal kabul** değişmez bir olaydır: `purchases` tablosu. Her satırı için `purchase` türünde bir stok hareketi yazılır (`refId` = mal kabul kimliği), fiyat güncellemeleriyle aynı transaction'da. M4 bu kayda tedarikçi ve ödeme ekler.
- **Elle düzeltme** işaretli bir `manual` hareketidir ve nedenini taşır. Mutlak değer değil, fark yazılır; iki kasanın düzeltmeleri toplanır, hiçbiri kaybolmaz.
- **Hareket geçmişi** `stockMovements`'ın ürün indeksinden okunur.
- **Satış satırı** birimi taşır. Eski kayıtlarda birim yoktur ve adet sayılır.

**Tech Stack:** React 19, Dexie 4 (şema v7), M3a/M3b bileşenleri, Vitest ve Testing Library.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md):
- §6.3: `stock_movements` (product_id, delta, kind: purchase/count/manual, ref_id) ve `purchase_invoices` (lines[], totals; tedarikçi ve ödeme M4'te).
- §6.4: stok hareketlerin toplamıdır; eksi stoğa izin verilir ama uyarı çıkar.
- §10 Stok satırı: mal kabul; ürün bazında hareket geçmişi.
- §7: düzenlenebilir varlıklarda alan bazında son yazan kazanır.

[docs/v2/ertelenenler.md](../ertelenenler.md) M3 bölümünden bu plan **M3c** satırını ve şu maddeleri alır:
- tartılı satırın birimi (sepet, iade, fiş);
- kg'dan adede çevrilen ürünün kesirli stoğu;
- ad önerisinin yarışları ve mesajları (M3b'den, Task 9).

"Aynı ürün iki satırda" maddesi M2e'ye taşınır: sepet satırları birleştiği için bugün oluşmuyor, kasa işidir.

## Global Constraints

| Kural | Bu kuralı koruyan test |
|---|---|
| Mal kabul tek transaction'dır: olay, hareketler ve fiyat yamaları ya birlikte yazılır ya hiç yazılmaz. | Task 2 "records a goods receipt all or nothing" |
| Stok yalnız hareketle değişir; düzeltme fark yazar, mutlak değer yazmaz. | Task 2 "adjusts stock by a signed difference with its reason" |
| Adetli üründe miktar tam sayıdır; mal kabul ve düzeltme de reddeder. | Task 2 "refuses fractions for a piece product" |
| Para tamsayı kuruştur, en fazla ₺1.000.000. | Task 2 "refuses a price above the limit" |
| Eski satış kaydı (biriminde) adet sayılır; görünüm çökmez. | Task 1 "reads a sale line without a unit as pieces" |
| Adetli ürüne çevirmek için stok tam sayı olmalı. | Task 8 "refuses to make a product with a fractional stock count pieces" |

**İki cihaz (çevrimdışı):**
- *İki kasa aynı ürünü mal kabule alırsa:* iki olay, iki hareket; stok ikisinin toplamı kadar artar. Doğrusu da budur, çünkü iki ayrı teslimat.
- *İki kasa aynı ürünün alış fiyatını farklı değiştirirse:* son yazan kazanır (§7). Hareketler etkilenmez.
- *Düzeltmeler:* farklar toplanır, ikisi de kalır.

## Review Focus

1. **Mal kabulde okutma.** Aynı ürün ikinci kez okutulunca yeni satır açılmaz, miktar artar. Bilinmeyen barkod yeni ürün formunu açar, ürün eklenince satıra girer. Harf içeren kod Shift ile gelir.
2. **Tartılı ürün.** Mal kabulde, düzeltmede, hareket listesinde ve satışın fişinde miktar kg ile ve en fazla 3 ondalıkla yazılır.
3. **Yarıda kalan mal kabul.** Sayfa yenilenir ya da ekran değiştirilirse taslak kaybolmaz.
4. **Hareket geçmişindeki bakiye.** Her satırın yanındaki stok, en yeniden geriye doğru doğru hesaplanmalı. Eksi stok görünür olmalı.
5. **Eski satış kayıtları.** Birimsiz satırlar fişte, iadede ve hareketlerde hatasız görünmeli.

## Bu planın dışında

- **M3d:** sayım (mutlak değer ve iki cihazda eşzamanlı satış), kamera ile okutma.
- **M4:** mal kabulün tedarikçiye ve alış faturasına bağlanması, ödeme.
- **M5:** stok değeri ve mal kabul raporları.

---

### Task 1: Satış satırında birim

**Files:**
- **Modify:** `src/data/types.ts` (`SaleLine.unit?: ProductUnit`), `src/pos/checkout.ts`, `src/pos/receipt.ts`, `src/pos/CartPanel.tsx`, `src/pos/ReturnDialog.tsx`, `src/pos/format.ts`
- **Test:** `src/pos/checkout.test.ts`, `src/pos/receipt.test.ts`, `src/pos/CartPanel.test.tsx`, `src/pos/ReturnDialog.test.tsx`, `src/pos/format.test.ts`

**Interfaces:**
- **Produces:** `formatLineQty(qtyMilli, unit?: ProductUnit): string`. Adette "2", kg'da "1,25 kg"; birim yoksa adet sayılır.
  - Satış satırı birimi `checkout` sırasında sepetten yazılır.
  - Fiş satır ayrıntısı: "2 × ₺15,00" ya da "1,25 kg × ₺80,00".
  - Sepet satırı ve iade adımı (Satılan / İade edilebilir) birimi gösterir.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('writes each line's unit into the sale')`.
  - `it('shows kilograms on a weighed receipt line')`.
  - `it('reads a sale line without a unit as pieces')`.
  - Sepet ve iade adımında "1,25 kg".
- [ ] **Step 2–4:** Run: `npm test -- src/pos && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(pos): sale lines carry their unit, shown in kg where weighed"`

---

### Task 2: Mal kabul ve düzeltme verisi

**Files:**
- **Create:** `src/data/purchases.ts`, `src/data/purchases.test.ts`
- **Modify:** `src/data/types.ts`, `src/data/db.ts` (v7), `src/data/stock.ts`, `src/sync/apply.ts`, `src/data/db.test.ts`, `src/sync/apply.test.ts`

**Interfaces:**
- **Produces:**
  - `type PurchaseLine = { productId: string; name: string; unit: ProductUnit; qtyMilli: number; buyPrice: Kurus; cost: Kurus }`.
  - `type PurchaseRecord = { id: string; deviceCode: string; lines: PurchaseLine[]; total: Kurus; note?: string; occurredAt: string; businessDate: string }`.
  - `OutboxTable`'a `'purchases'` eklenir. `db.ts` v7: `purchases: 'id, occurredAt'`. `apply.ts`: olay tablosu.
  - `StockMovementRecord.note?: string`.
  - `recordPurchase(db, { deviceCode, lines: { productId, qtyMilli, buyPrice?, sellPrice? }[], note? }, at): Promise<PurchaseRecord>`. Tek transaction'da şunlar yazılır:
    - `purchases` kaydı;
    - satır başına `purchase` hareketi (`refId`);
    - değişen `buyPrice` / `sellPrice` yamaları (`updateProduct`).

    `cost = yuvarla(qty × buyPrice)` (`lineTotal`). Boş satır listesi, sıfır ya da eksi miktar, adette kesir ve sınırı aşan fiyat `RangeError` verir. Silinmiş ya da bulunmayan ürün `RecordNotFoundError` verir.
  - `type AdjustReason = 'waste' | 'damaged' | 'lost' | 'found' | 'other'`, etiketleri `ADJUST_REASONS`: Fire, Bozuk / SKT geçmiş, Kayıp, Bulunan, Diğer.
  - `adjustStock(db, { productId, deltaMilli, reason, note? }, at): Promise<StockMovementRecord>`: `manual` hareketi, `note` = neden etiketi (ve not).
  - `listMovements(db, productId, limit = 200): Promise<{ movement: StockMovementRecord; balanceMilli: number }[]>`: en yeniden eskiye, bakiye mevcut stoktan geriye hesaplanır.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('records a goods receipt all or nothing')`: ikinci satırın ürünü silinmiş → hiçbir şey yazılmaz.
  - `it('updates only the prices that change')`.
  - `it('refuses fractions for a piece product')`.
  - `it('refuses a price above the limit')`.
  - `it('adjusts stock by a signed difference with its reason')`.
  - `it('lists movements newest first with the stock after each')`.
  - `db.test.ts` tabloları; `apply.test.ts` "applies pulled purchases once".
- [ ] **Step 2–4:** Run: `npm test -- src/data src/sync && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(data): goods receipts and stock adjustments"`

---

### Task 3: Stok ekranı ve geçiş

**Files:**
- **Create:** `src/stock/StockScreen.tsx`, `src/stock/StockScreen.test.tsx`
- **Modify:** `src/app/route.ts` (`'stock'`), `src/app/AppShell.tsx` (menüde "Stok"), `src/app/App.tsx`, `src/app/route.test.ts`, `src/app/AppShell.test.tsx`

**Interfaces:**
- **Produces:** `StockScreen()`: `AppShell activeNav="stock"`, `<h1>Stok</h1>`. "Göster" seçimi: "Mal kabul" ya da "Kritik stok".
- [ ] **Step 1–5:** `it('opens from the menu')`; `parseRoute('#/stock')`. Commit — `git commit -m "feat(stock): the stock screen"`

---

### Task 4: Mal kabul

**Files:**
- **Create:** `src/stock/receiptDraft.ts`, `src/stock/receiptDraft.test.ts`, `src/stock/GoodsReceipt.tsx`, `src/stock/GoodsReceipt.test.tsx`
- **Modify:** `src/stock/StockScreen.tsx`

**Interfaces:**
- **Consumes:** Task 2 `recordPurchase`, `findProductByBarcode`, `searchProducts`, `ProductFormDialog`, `useBarcodeScanner`, `parseTRY`, `parseQuantity`.
- **Produces:**
  - `receiptDraft.ts`:
    - `type DraftLine = { productId; name; unit; qty: string; buyPrice: string; sellPrice: string }`;
    - `addProduct(draft, product)`: aynı ürün varsa miktarı 1 (adet) artırır, yoksa satırı fiyatlarıyla ekler;
    - `loadDraft()` ve `saveDraft()`: `localStorage` `mk2.goodsReceipt`, bozuk veri yok sayılır.
  - `GoodsReceipt()`:
    - Bir arama alanı ("Ürün ara ya da okut") ve okuyucu.
    - Satırlar: ad, mevcut stok, "Miktar", "Alış fiyatı", "Satış fiyatı" ve "Çıkar". Satır başına tutar, altta toplam.
    - "Not" alanı (irsaliye no vb.) ve "Mal kabulü kaydet" düğmesi.
    - Bilinmeyen barkod `ProductFormDialog`'u o barkodla açar; kaydedilen ürün satıra girer.
    - Bildirim: "Mal kabul kaydedildi: {n} ürün, ₺{toplam}." Kaydedince taslak temizlenir.
    - Hatalı satır alanı hatayı gösterir: "Adet için tam sayı girin.", "Geçerli bir tutar girin." vb.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('adds a scanned product and counts it up when scanned again')`.
  - `it('starts a new product from an unknown barcode and adds it')`.
  - `it('records the receipt with new prices and clears the draft')`.
  - `it('keeps the draft across a reload')`.
  - `it('shows what a line cannot be saved with')`.
- [ ] **Step 2–4:** Run: `npm test -- src/stock && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(stock): receive goods with new prices"`

---

### Task 5: Elle stok düzeltme

**Files:**
- **Create:** `src/stock/AdjustStockDialog.tsx`, `src/stock/AdjustStockDialog.test.tsx`
- **Modify:** `src/products/ProductFormDialog.tsx` (düzenlemede "Stoğu düzelt")

**Interfaces:**
- **Produces:** `AdjustStockDialog({ open, product, onClose, onDone(message) })`.
  - Alanlar: "Değişim" (Ekle / Çıkar), "Miktar" (birimle), "Neden" (`ADJUST_REASONS`) ve "Not".
  - Önizleme: "Stok: 12 adet → 10 adet". Eksiye düşecekse "Stok eksiye düşecek." uyarısı çıkar, düzeltme yine yapılabilir.
  - Bildirim: "Stok düzeltildi."
- [ ] **Step 1–5:** `it('takes stock out with a reason')`, `it('warns before stock goes below zero')`. Commit — `git commit -m "feat(stock): adjust a product's stock with a reason"`

---

### Task 6: Hareket geçmişi

**Files:**
- **Create:** `src/stock/MovementsDialog.tsx`, `src/stock/MovementsDialog.test.tsx`
- **Modify:** `src/products/ProductFormDialog.tsx` (düzenlemede "Hareketler")

**Interfaces:**
- **Produces:** `MovementsDialog({ open, product, onClose })`. Tablonun sütunları: tarih (`formatDateTime`), tür, değişim (+/− birimle) ve stok (bakiye).
  - Tür etiketleri: Satış, İade, İptal, Mal kabul, Sayım, Düzeltme.
  - Satış, iade ve iptalde fiş numarası `refId` üzerinden gösterilir. Düzeltmede neden gösterilir.
  - En fazla 200 satır; daha fazlası için "Son 200 hareket gösteriliyor."
- [ ] **Step 1–5:** `it('lists a product's movements with the stock after each')`. Commit — `git commit -m "feat(stock): a product's movement history"`

---

### Task 7: Kritik stok listesi

**Files:**
- **Create:** `src/stock/CriticalStock.tsx`, `src/stock/CriticalStock.test.tsx`
- **Modify:** `src/stock/StockScreen.tsx`

**Interfaces:**
- **Produces:** `CriticalStock({ onReceive(product) })`.
  - Kritik seviyesinin altında ya da ona eşit canlı ürünler gösterilir, en eksik olan önce.
  - Satırda ad, stok ve kritik seviye bulunur. "Mal kabule ekle" düğmesi ürünü taslağa ekleyip Mal kabul görünümüne geçer.
  - Boşsa "Kritik stokta ürün yok." yazar.
- [ ] **Step 1–5:** `it('lists products at or below their level, the shortest first')`, `it('adds a product to the goods receipt')`. Commit — `git commit -m "feat(stock): the critical stock list"`

---

### Task 8: Birim değişiminde kesirli stok

**Files:**
- **Modify:** `src/products/ProductFormDialog.tsx`, `src/products/productForm.ts`
- **Test:** `src/products/ProductFormDialog.test.tsx`

**Interfaces:**
- **Produces:** Stoğu tam sayı olmayan bir ürün Kilogram'dan Adet'e çevrilirken form şu hatayı verir: "Stok kesirli ({formatStock}); adede çevirmeden önce stoğu düzeltin." Kaydetmez.
- [ ] **Step 1–5:** `it('refuses to make a product with a fractional stock count pieces')`. Commit — `git commit -m "fix(products): a fractional stock keeps a product in kilograms"`

---

### Task 9: Ad önerisinde yarışlar ve mesajlar (M3b'den)

**Files:**
- **Modify:** `src/products/ProductFormDialog.tsx`, `src/products/openFoodFacts.ts`
- **Test:** `src/products/ProductFormDialog.test.tsx`, `src/products/openFoodFacts.test.ts`

**Interfaces:**
- **Produces:**
  - Yanıt gelene kadar ad alanına bir şey yazılırsa öneri yazılmaz; "Öneri: …" ve "Kullan" olarak gösterilir.
  - İstek sürerken barkod değişirse eski barkodun yanıtı atılır. Barkod değişince eski öneri ve mesaj da kalkar.
  - Beklerken "Aranıyor…" yazar.
  - Sunucu hatası (5xx, 429) `{ error: 'unavailable' }` döner ve "Ürün veritabanına şu an ulaşılamıyor." yazar. "İnternet bağlantısı yok." yalnız ağ hatasında çıkar.
- [ ] **Step 1–5:** `it('does not overwrite a name typed while waiting')`, `it('drops the answer for a barcode that changed')`, `it('tells a server error from being offline')`. Commit — `git commit -m "fix(products): name suggestions never overwrite newer input"`

