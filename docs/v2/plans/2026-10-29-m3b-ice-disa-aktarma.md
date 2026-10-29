# Market Kasa v2 · M3b İçe/Dışa Aktarma ve Toplu Fiyat — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market sahibi ürün listesini bir CSV ya da Excel (XLSX) dosyasından içe aktarır. Önce sütunları eşler, sonra neyin ekleneceğini ve güncelleneceğini önizlemede görür. Listeyi Excel'in bozmadığı bir CSV olarak dışa aktarır, seçili ürünlerin fiyatını topluca değiştirir ve barkoddan ürün adı önerisi alır.

**Architecture:** Dosya okuma (CSV ve XLSX), sütun eşleme, satır okuma ve içe aktarma planı saf modüllerdir; her biri tek başına test edilir. İçe aktarma önce kuru çalışır (plan), sonra tek bir IndexedDB transaction'ında uygulanır: ya hepsi yazılır ya hiçbiri. XLSX, `fflate` ile açılan zip içindeki XML'den okunur; npm'deki `xlsx` paketinin bilinen açıkları yüzünden kullanılmaz. Ad önerisi Open Food Facts'e yalnız düğmeye basılınca gider.

**Tech Stack:** React 19, Dexie 4, `fflate` 0.8.3 (yeni bağımlılık, MIT, bağımlılıksız), `DOMParser`, `TextDecoder` (`windows-1254`), Vitest ve Testing Library.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md):
- §10 Ürünler satırı: toplu fiyat güncelleme; sütun eşlemeli CSV/XLSX içe aktarma ve önizleme; düzgün CSV dışa aktarma; barkodla ad önerisi (Open Food Facts).
- §9: fiyatlar KDV dahil, kuruş tamsayı; KDV 0/1/10/20.
- §14: v1 taşıması M8'dedir. Bu plan v1'in kendi CSV dışa aktarımını da okur (`Barkod;Ürün Adı;Kategori;Alış Fiyatı;Satış Fiyatı;KDV %;Mevcut Stok;Birim;Hızlı Satış`).

[docs/v2/ertelenenler.md](../ertelenenler.md) M3 bölümünden bu plan **M3b** satırını ve M3a'dan M3b'ye bırakılan üç maddeyi alır: adetli üründe veri katmanında tam sayı kuralı (Task 4), silinmiş ürünün formunun kaydetmesi ve kategori silme onayının sayıdan önce yanıtlanabilmesi (Task 9).

## Global Constraints

| Kural | Bu kuralı koruyan test |
|---|---|
| İçe aktarma tek transaction'dır; bir satır yazılamazsa hiçbiri yazılmaz. | Task 4 "applies all or nothing" |
| Mevcut bir ürünün stoğu içe aktarmayla değişmez. Stok sütunu yalnız yeni ürünün başlangıç stoğudur (`count`). | Task 4 "never changes the stock of an existing product" |
| Barkod büyük harfle eşleşir. Silinmiş ürünün barkodu gelirse o ürün geri getirilip güncellenir. | Task 4 "restores a deleted product that the file names" |
| Para tamsayı kuruştur, en fazla ₺1.000.000 olur. KDV yalnız 0, 1, 10 ya da 20 olabilir. Bunlara uymayan satır hatalıdır, yazılmaz. | Task 3 "rejects prices and VAT rates the app does not hold" |
| Excel'in bilimsel gösterime çevirdiği barkod ("8,69E+12") hata verir, sessizce yuvarlanmaz. | Task 3 "refuses a barcode in scientific notation" |
| Dışa aktarılan CSV aynı uygulamaya geri okunur: alanlar aynen döner. | Task 6 "round-trips through the importer" |
| Toplu fiyat yalnız listede görünen canlı ürünlere uygulanır. Fiyat eksiye düşmez, sınırı aşmaz. | Task 7 testleri |
| Ad önerisi yalnız düğmeyle istenir ve yalnız barkodu gönderir. | Task 8 "asks only when told, with the barcode alone" |
| Adetli üründe miktar tam sayıdır; veri katmanı da kesirli açılış stoğunu ve kritik seviyeyi reddeder (içe aktarma onu doğrudan çağırır). | Task 4 "refuses fractions for a piece product" |

**İki cihaz (çevrimdışı):**
- *İki kasada aynı dosya içe aktarılırsa:* aynı barkodlu ürünler iki kez oluşur. Sunucu barkodu birine verir (M0b), çekilen satır ötekinden barkodu alır (M1b `releaseBarcode`). Barkodsuz satırlar iki kez kalır; plan önizlemesi bunu söyleyemez. Bu durum içe aktarmanın tek kasadan yapılmasıyla önlenir. İçe aktarma penceresi bunu söyler: "İçe aktarmayı tek kasadan yapın."
- *Toplu fiyat iki kasada:* her ürün yaması alan bazında son yazanı kazanır (§7). İki kasa aynı ürüne farklı oran uygularsa sonuncusu kalır.

## Review Focus

1. **Türk Excel'inin CSV'si.** `;` ayraç, `windows-1254` kodlama, ondalık virgül, tırnak içinde `;` ve satır sonu. Hepsi doğru okunmalı. → Task 1.
2. **Excel'in bozduğu sayılar.** Bilimsel gösterimdeki barkod, başındaki sıfırı düşmüş barkod ve "12.500" gibi binlik ayraçlı fiyat. Bu satırlar ya doğru okunmalı ya açık bir hata vermeli. → Task 3.
3. **Büyük dosya.** 5.000 satırlık bir dosyada önizleme ve uygulama donmamalı; plan bütün dosya için tek seferde hesaplanmalı. → Task 4 "plans five thousand rows".
4. **Aynı dosyada tekrar eden barkod ya da ad.** İlk satır kazanır, sonrakiler hata olarak gösterilir. → Task 4.
5. **Ad önerisi çevrimdışı ya da yavaşken.** Kullanıcı açık bir mesaj görmeli. Form 5 saniyeden uzun beklememeli. → Task 8.

## Bu planın dışında

- **M3c:** stok ekranı, mal kabul, hareket geçmişi, elle düzeltme, kritik stok listesi.
- **M3d:** sayım, kamera.
- **M8:** v1 veritabanı taşıması (§14). Bu plan yalnız v1'in ürün CSV'sini okur.
- **M8:** Electron ve Android'de dosya indirme ve paylaşma.
- XLSX dışa aktarma bu planda yok; CSV, barkodu metin olarak koruyacak biçimde yazılır (Task 6).

---

### Task 1: Metin dosyası ve CSV okuma

**Files:**
- **Create:** `src/products/importFile.ts`, `src/products/importFile.test.ts`

**Interfaces:**
- **Produces:**
  - `decodeText(bytes: Uint8Array): string`:
    - UTF-8 BOM'u atar;
    - önce katı UTF-8 dener (`fatal: true`);
    - olmazsa `windows-1254` ile okur.
  - `parseCsv(text: string): string[][]`:
    - ayraç ilk satırda tırnak dışında en sık geçen `;`, `,` ya da sekmedir;
    - tırnaklı alan, `""` kaçışı, tırnak içinde ayraç ve satır sonu desteklenir;
    - CRLF, LF ve CR kabul edilir;
    - tamamen boş satırlar atılır.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('reads UTF-8 with a BOM and Turkish Excel's windows-1254')`: "Şeker Çay" iki kodlamada da aynı okunur.
  - `it('detects the delimiter from the header')`: `;`, `,` ve sekme.
  - `it('keeps delimiters, quotes and line breaks inside quoted fields')`.
  - `it('reads a line of the v1 export')`: `"8690000000017";"Süt 1 L";"Süt";30;42.5;1;12;"Adet";Evet`.
- [ ] **Step 2–4:** Run: `npm test -- src/products/importFile && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): read CSV files the way Turkish Excel writes them"`

---

### Task 2: XLSX okuma

**Files:**
- **Create:** `src/products/xlsx.ts`, `src/products/xlsx.test.ts`, `src/test/xlsx.ts`
- **Modify:** `package.json`, `package-lock.json` (`fflate` ^0.8.3)

**Interfaces:**
- **Produces:**
  - `readXlsx(bytes: Uint8Array): string[][]`: ilk sayfanın hücreleri metin olarak.
    - Ortak metinler (`t="s"`), satır içi metinler (`t="inlineStr"`), formül sonucu metinler (`t="str"`) ve sayılar (XML'de yazıldığı gibi, ör. `"12.5"`) okunur.
    - Boş hücreler `''` olur.
    - İlk sayfa, `workbook.xml` ve `workbook.xml.rels` ile bulunur.
  - `class XlsxReadError extends Error`: zip değilse ya da sayfa yoksa.
  - `src/test/xlsx.ts` `makeXlsx(sheet: string[][], { sharedStrings?: boolean }): Uint8Array`: testler için `fflate.zipSync` ile gerçek bir XLSX üretir.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('reads shared and inline strings and numbers from the first sheet')`.
  - `it('keeps the column of a cell when cells are missing')`: A1 ve C1 dolu, B1 yok.
  - `it('refuses a file that is not a workbook')`.
- [ ] **Step 2–4:** Run: `npm test -- src/products/xlsx && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): read the first sheet of an Excel workbook"`

---

### Task 3: Sütun eşleme ve satır okuma

**Files:**
- **Create:** `src/products/importRows.ts`, `src/products/importRows.test.ts`

**Interfaces:**
- **Consumes:** `canonicalBarcode`, `parseTRY`, `parseQuantity`, `VAT_RATES`, `MAX_UNIT_PRICE`.
- **Produces:**
  - `type ImportField = 'barcode' | 'name' | 'category' | 'unit' | 'sellPrice' | 'buyPrice' | 'vatRate' | 'criticalLevel' | 'stock' | 'isQuick'`.
  - `IMPORT_FIELD_LABELS: Record<ImportField, string>`: Barkod, Ürün adı, Kategori, Birim, Satış fiyatı, Alış fiyatı, KDV, Kritik stok, Stok, Hızlı ürün.
  - `type ColumnMapping = Partial<Record<ImportField, number>>`.
  - `guessMapping(headers: readonly string[]): ColumnMapping`. Başlıklar `normalizeForSearch` ile eşleşir:
    - barkod / barcode / ean;
    - ürün adı / ad / isim / ürün;
    - kategori / grup;
    - birim;
    - satış fiyatı / fiyat;
    - alış fiyatı / maliyet;
    - kdv;
    - kritik;
    - stok / mevcut stok / miktar;
    - hızlı.

    v1 başlıklarının hepsi eşleşir.
  - `type ImportRow = { rowNumber: number; fields: Partial<ImportValues>; errors: string[] }`.
    - `ImportValues` = `barcode?`, `name`, `category?`, `unit`, `sellPrice`, `buyPrice`, `vatRate`, `criticalLevelMilli`, `stockMilli`, `isQuick`.
    - Yalnız eşlenen sütunlar alanda bulunur.
  - `readImportRows(table: readonly string[][], mapping: ColumnMapping, hasHeader: boolean): ImportRow[]`. Değerler şöyle okunur:
    - **Birim:** "Adet", "Paket", "Koli", "Litre" → `piece`; "Kg", "kilo", "kilogram" → `kg`; boş → `piece`.
    - **KDV:** "1", "%1" ve "1%" kabul edilir. 0, 1, 10 ve 20 dışındakiler "KDV 0, 1, 10 ya da 20 olmalı." hatası verir.
    - **Hızlı ürün:** evet / hayır / 1 / 0 / true / false / x / boş.
    - **Miktar:** birime göre okunur. Eksi stok "Stok eksi olamaz." hatası verir.
    - **Barkod:** Task 6'nın yazdığı `="8690000000017"` sarmalı açılır. Bilimsel gösterim "Barkod bilimsel gösterimde (8,69E+12): dosyada barkod sütununu metin yapın." hatası verir. Geçersiz karakter de hatadır.
    - **Fiyat:** sınırı aşan fiyat "Fiyat en fazla ₺1.000.000,00 olabilir." hatası verir.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('maps the v1 export headers and common names')`.
  - `it('reads values the Turkish way')`: "12,50", "12.5", "₺1.250,00", "%10", "Kg", "Evet".
  - `it('rejects prices and VAT rates the app does not hold')`.
  - `it('refuses a barcode in scientific notation')`.
  - `it('reads only the mapped columns')`.
- [ ] **Step 2–4:** Run: `npm test -- src/products/importRows && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): map columns and read import rows"`

---

### Task 4: İçe aktarma planı ve uygulama

**Files:**
- **Create:** `src/products/importPlan.ts`, `src/products/importPlan.test.ts`
- **Modify:** `src/data/products.ts` (adetli üründe tam sayı kuralı), `src/data/products.test.ts`

**Interfaces:**
- **Consumes:** Task 3 (`ImportRow`), `createProduct` (açılış stoğuyla), `updateProduct`, `restoreProduct`, `createCategory`, `normalizeForSearch`.
- **Produces:**
  - `type ImportAction = 'create' | 'update' | 'unchanged' | 'error'`.
  - `type PlannedRow = { rowNumber: number; action: ImportAction; name: string; productId?: string; restore?: boolean; changes: string[]; errors: string[] }`. `changes` Türkçe alan adlarıdır, ör. `['Satış fiyatı']`.
  - `planImport(rows: readonly ImportRow[], products: readonly ProductRecord[], categories: readonly CategoryRecord[]): { rows: PlannedRow[]; newCategories: string[]; counts: Record<ImportAction, number> }`. Eşleme sırası:
    1. Barkod varsa barkod (silinmiş ürün de eşleşir, `restore: true`).
    2. Barkod yoksa adı aynı (`normalizeForSearch`) tek bir canlı barkodsuz ürün. Birden çoksa "Aynı adlı birden çok ürün var." hatası verir.
    3. Eşleşme yoksa yeni ürün. Yeni ürün için ad ve satış fiyatı gerekli.

    Dosyada aynı barkod ya da (barkodsuz) aynı ad ikinci kez geçerse "Bu ürün dosyada {n}. satırda da var." hatası verir. Kategori adları büyük/küçük harf gözetmeden mevcutlarla eşleşir; yoksa `newCategories`'e girer.
  - `applyImport(db, plan, rows, at): Promise<{ created: number; updated: number }>`: tek transaction (`products`, `categories`, `stockMovements`, `stockLevels`, `outbox`). Hatalı ve değişmeyen satırlar atlanır.
  - `createProduct` ve `updateProduct`, birimi `piece` olan üründe 1000'in katı olmayan `openingStockMilli` ve `criticalLevelMilli` için `RangeError` atar. Güncellemede birim ya da kritik seviye değişince sonuç birlikte denetlenir.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('refuses fractions for a piece product')` (`products.test.ts`): açılış stoğu 1500 ve kritik seviye 1500 adetli üründe reddedilir; kritik seviyesi 1500 olan kg ürün adede çevrilemez.
  - `it('plans creates, updates, unchanged rows and errors')`.
  - `it('restores a deleted product that the file names')`.
  - `it('matches a barcodeless product by its name')`.
  - `it('lets the first of two rows with the same barcode win')`.
  - `it('creates each new category once')`.
  - `it('never changes the stock of an existing product')`.
  - `it('applies all or nothing')`: plandan sonra başka bir ürün aynı barkodu alır, uygulama `DuplicateBarcodeError` atar ve hiçbir kayıt ya da outbox satırı yazılmaz.
  - `it('plans five thousand rows')`: 5.000 satırlık plan, eşleme bir `Map` ile kurulur.
- [ ] **Step 2–4:** Run: `npm test -- src/products/importPlan && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): plan an import, then apply it all or nothing"`

---

### Task 5: İçe aktarma penceresi

**Files:**
- **Create:** `src/products/ImportDialog.tsx`, `src/products/ImportDialog.test.tsx`
- **Modify:** `src/design/Dialog.tsx` (`size?: 'md' | 'lg'`; lg = `max-w-[880px]`), `src/products/ProductsScreen.tsx` ("İçe aktar" düğmesi)

**Interfaces:**
- **Consumes:** Task 1–4, `listCategories`.
- **Produces:** `ImportDialog({ open, onClose(): void, onDone(message: string): void })`. Üç adımı vardır.
  1. **Dosya.**
     - "Dosya seç" alanı: `.csv`, `.txt` ya da `.xlsx`.
     - İpucu: "Excel'den kaydedilen CSV ya da XLSX. v1'in ürün listesi de okunur."
     - Okunamayan dosya için: "Dosya okunamadı. CSV ya da XLSX seçin."
  2. **Sütunlar.**
     - Her alan için bir `SelectField` bulunur: "Kullanma" ya da dosyanın sütunları; tahmin edilen eşleme seçili gelir. Her sütunun ilk iki değeri seçeneğin yanında görünür.
     - "İlk satır başlık" onay kutusu bulunur.
     - Ürün adı da satış fiyatı da eşlenmemişse "Devam" pasif olur.
  3. **Önizleme.**
     - Özet: "{n} yeni, {n} güncellenecek, {n} aynı, {n} hatalı".
     - İlk 50 satır gösterilir: satır no, ad, durum ve değişen alanlar ya da hata.
     - Yeni kategoriler "Yeni kategoriler: …" satırında listelenir.
     - "İçe aktarmayı tek kasadan yapın." notu bulunur.
     - "{n} ürünü içe aktar" düğmesi.
  - Bitince bildirim: "{c} ürün eklendi, {u} ürün güncellendi."

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('imports a CSV file after mapping and preview')`: `userEvent.upload` ile v1 biçiminde bir dosya yüklenir.
  - `it('lets the user change a guessed column')`.
  - `it('shows the rows it will not import and why')`.
  - `it('says when a file cannot be read')`.
- [ ] **Step 2–4:** Run: `npm test -- src/products/ImportDialog && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): import products from a file with a preview"`

---

### Task 6: CSV dışa aktarma

**Files:**
- **Create:** `src/products/exportCsv.ts`, `src/products/exportCsv.test.ts`
- **Modify:** `src/products/ProductsScreen.tsx` ("Dışa aktar" düğmesi)

**Interfaces:**
- **Consumes:** M3a'nın `ProductRow`'u (`src/products/productList.ts`), Task 1–3.
- **Produces:**
  - `productsToCsv(rows: readonly ProductRow[]): string`:
    - Başında BOM, `;` ayraç, CRLF satır sonu.
    - Başlıklar: Barkod;Ürün adı;Kategori;Birim;Satış fiyatı;Alış fiyatı;KDV;Kritik stok;Stok;Hızlı ürün.
    - Fiyatlar "42,50" biçimindedir; miktarlar `formatQtyInput` ile yazılır.
    - Barkod `="8690000000017"` olarak yazılır, böylece Excel onu sayıya çevirmez. `parseCsv` sonrasında satır okuma bu sarmalı açar.
    - Gerektiğinde alanlar tırnaklanır ve tırnaklar kaçışlanır.
  - `downloadText(fileName: string, text: string): void`: Blob ve geçici bir bağlantıyla indirir.
  - Ürünler ekranında "Dışa aktar" düğmesi listedeki (süzülmüş) ürünleri `urunler-YYYY-MM-DD.csv` olarak indirir.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('writes Excel-safe CSV')`.
  - `it('round-trips through the importer')`: dışa aktar → `decodeText` → `parseCsv` → `guessMapping` → `readImportRows`; alanlar aynı döner.
  - `it('exports the listed products from the screen')`: `URL.createObjectURL` taklidiyle.
- [ ] **Step 2–4:** Run: `npm test -- src/products/exportCsv src/products/ProductsScreen && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): export the product list as Excel-safe CSV"`

---

### Task 7: Toplu fiyat güncelleme

**Files:**
- **Create:** `src/products/bulkPrice.ts`, `src/products/bulkPrice.test.ts`, `src/products/BulkPriceDialog.tsx`, `src/products/BulkPriceDialog.test.tsx`
- **Modify:** `src/products/ProductsScreen.tsx` ("Toplu fiyat" düğmesi; Silinenler filtresinde pasif)

**Interfaces:**
- **Produces:**
  - `type PriceChange = { target: 'sellPrice' | 'buyPrice'; by: 'percent' | 'amount'; value: number; roundTo: 0 | 25 | 50 | 100 }`.
    - `value` işaretlidir: yüzde için binde bir (`10%` = 100), tutar için kuruş.
    - `roundTo` kuruş adımıdır; yarım yukarı yuvarlanır.
  - `changedPrice(price: Kurus, change: PriceChange): Kurus`: en az 0, en fazla `MAX_UNIT_PRICE` (aşarsa `RangeError`).
  - `bulkUpdatePrices(db, productIds: readonly string[], change, at): Promise<number>`: tek transaction; yalnız fiyatı değişen ürünler yamalanır.
  - `BulkPriceDialog({ open, products: readonly ProductRecord[], onClose(): void, onDone(message: string): void })`. Alanlar:
    - "Hangi fiyat" (Satış / Alış);
    - "Değişim" (Artır / Azalt);
    - "Nasıl" (% / ₺);
    - "Miktar";
    - "Yuvarla" (Yok / 0,25 / 0,50 / 1,00).

    İlk 5 ürünün önizlemesi "Süt: ₺42,50 → ₺46,75" biçimindedir. Düğme "{n} ürünün fiyatını değiştir". Bildirim "{n} ürünün fiyatı değişti."

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('raises by a percentage and rounds half up to the step')`: ₺42,50 +10% ve 0,50 adım → ₺47,00 (46,75 yarım yukarı).
  - `it('never goes below zero and refuses the limit')`.
  - `it('patches only products whose price changes, in one transaction')`.
  - `it('changes only the listed products')`: ekran testi; kategori süzgeci açıkken.
- [ ] **Step 2–4:** Run: `npm test -- src/products/bulkPrice src/products/BulkPriceDialog && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): change the prices of listed products at once"`

---

### Task 8: Barkoddan ad önerisi

**Files:**
- **Create:** `src/products/openFoodFacts.ts`, `src/products/openFoodFacts.test.ts`
- **Modify:** `src/products/ProductFormDialog.tsx`, `src/products/ProductFormDialog.test.tsx`

**Interfaces:**
- **Produces:**
  - `suggestProductName(barcode: string, { fetch?, timeoutMs = 5000 }): Promise<{ name: string } | { error: 'not-found' | 'offline' | 'timeout' }>`.
    - Adres: `https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=product_name_tr,product_name,brands,quantity`.
    - Önce `product_name_tr` kullanılır, yoksa `product_name`. Marka ve miktar varsa eklenir: "Ülker Çikolatalı Gofret 36 g".
  - Formda, barkod 8–14 rakamsa "Ürün adı" altında "İnternetten ad öner" düğmesi görünür.
    - Ad boşsa öneri yazılır. Doluysa "Öneri: {ad}" ile "Kullan" gösterilir.
    - Hatalar: "Bu barkod için ad bulunamadı.", "İnternet bağlantısı yok.", "Yanıt gecikti, sonra yeniden deneyin."

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('asks only when told, with the barcode alone')`: `fetch` taklidi çağrı adresini kaydeder; form açılınca çağrı olmaz.
  - `it('builds a name from the Turkish name, brand and quantity')`.
  - `it('says when the product is unknown, the device is offline or the answer is late')`: `vi.useFakeTimers` ile 5 saniye.
- [ ] **Step 2–4:** Run: `npm test -- src/products/openFoodFacts src/products/ProductFormDialog && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(products): suggest a product name from its barcode"`

---

### Task 9: M3a'dan kalan küçük düzeltmeler

**Files:**
- **Modify:** `src/products/ProductFormDialog.tsx`, `src/products/CategoriesDialog.tsx`
- **Test:** `src/products/ProductFormDialog.test.tsx`, `src/products/CategoriesDialog.test.tsx`

**Interfaces:**
- **Produces:**
  - Silinmiş ürünün formunda "Kaydet" yoktur; alanlar salt okunurdur (`disabled`). Tek eylem "Geri getir"dir. Böylece "Ürün kaydedildi." deyip ürünü Silinenler'de bırakan kayıt olmaz.
  - Kategori silme onayı, kategorisiz kalacak ürün sayısı okunmadan görünmez: soru ve "Sil" birlikte, sayı geldikten sonra çıkar.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('offers only to restore a deleted product')`.
  - `it('asks to delete only once it knows how many products it affects')`: "Sil" düğmesi görünürken soru metni de tam sayıyla görünür.
- [ ] **Step 2–4:** Run: `npm test -- src/products/ProductFormDialog src/products/CategoriesDialog && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "fix(products): restore-only form for deleted products; delete confirmation waits for its count"`

