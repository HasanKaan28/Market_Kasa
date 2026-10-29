# Market Kasa v2 · M3d Sayım ve Kamera — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market sahibi Stok ekranında rafı sayar: okutarak ya da yazarak sayılan miktarları girer, beklenenle farkı görür ve sayımı tek seferde kaydeder. Başka kasadan sonradan gelen hareketler bir sayımı tutmaz hale getirirse, bu ürünler "Kontrol gerekli" olarak listelenir. Kamerası olan cihazda (telefon, tablet) barkod kamerayla okutulur: kasada, Ürünler ekranında, mal kabulde ve sayımda. M3b'den kalan içe aktarma cilası da bu planda.

**Architecture:**
- **Sayım** değişmez bir olaydır: `stockCounts` tablosu, Dexie v8. Her satırda sayım anında beklenen (yerel stok) ve sayılan miktar tutulur. Fark sıfır değilse `count` hareketi yazılır (`refId` = sayım).
- **Kontrol:** stok farkların toplamıdır (§6.4). Başka bir cihazın sayımdan önce yaptığı ama sonra gelen bir satış, sayımın farkını yanlış yapar. Sayımın beklediği miktar, sayım anından önceki bütün hareketlerin toplamından yeniden hesaplanır. Kayıttaki beklenenle tutmazsa sayım "Kontrol gerekli" olur. İki cihazın aynı ürünü aynı anda sayması da böyle yakalanır. Düzeltme kendiliğinden yapılmaz, kişi yeniden sayar (0018'deki "bir kişiye işaretle" seçeneği).
- **Kamera:** tarayıcının `BarcodeDetector`'ı varsa o kullanılır, yoksa `@zxing/browser`. İkisi de `useBarcodeScanner` ile aynı `onScan` işlevine bağlanır. Pencere kapanınca kamera akışı serbest bırakılır (§15).

**Tech Stack:** React 19, Dexie 4 (v8), `@zxing/browser` 0.2.1 ve `@zxing/library` 0.23.0 (Apache-2.0; gerektiğinde, dinamik import ile yüklenir), Vitest ve Testing Library.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md):
- §10 Stok satırı: sayım; sayım farkı hareket olarak kaydedilir.
- §10 Kasa satırı: USB ve kamera ile barkod.
- §15: kamera; tarayıcı kapanınca kamera akışı serbest bırakılır.
- §6.3, §6.4, §7.

[docs/v2/ertelenenler.md](../ertelenenler.md) M3 bölümünün bütün **M3d** maddelerini alır: sayım ve kamera, M3b'den kalan içe aktarma maddeleri (Task 6), M3c'den kalan stok ve mal kabul maddeleri (Task 5 ve Task 7).

## Global Constraints

Her kuralın bir bozma denemesi var: kuralı koruyan kod kaldırılınca testi kırmızıya dönmeli. Görev bitmeden deneme çalıştırılır, kırmızı görülür ve kod geri konur (gözlem 0012).

| Kural | Bu kuralı koruyan test | Bozma denemesi |
|---|---|---|
| Sayım tek transaction'dır: olay ve hareketler birlikte yazılır. Farkı sıfır olan satır hareket yazmaz ama sayımda kalır. | Task 1 "records a count all or nothing, moving only what differs": ikinci hareketin yazılması bozulur | `recordCount`'taki `db.transaction` sarmalayıcısı kaldırılır |
| Sayılan miktar adette tam sayıdır, eksi olamaz. | Task 1 "refuses fractions and amounts below zero" | miktar denetimi kaldırılır |
| Sonradan gelen eski bir hareket, ya da başka kasanın sayımı, bir sayımı "Kontrol gerekli" yapar. | Task 1 "flags a count that a late movement or a second count breaks" | yeniden hesaplama sayımın kendi beklenenini döndürür |
| Kamera akışı pencere kapanınca durur. | Task 3 "stops the camera when it closes" | durdurma işlevi çağrılmaz |
| Kamera yalnız düğmeyle açılır ve görüntü cihazdan çıkmaz. | Task 3: inceleme okur; görüntü işleme yereldir | — |

**İki cihaz (çevrimdışı):** İki kasa aynı ürünü sayarsa ya da birinin satışı sayımdan sonra gelirse, sayım kontrol listesine düşer (Task 1). Hareketler toplanmaya devam eder; kendiliğinden düzeltme yapılmaz.

## Review Focus

1. **Okutarak sayım.** Her okutma sayılanı 1 artırır. Tartılı ürün okutulunca miktar yazılmayı bekler, artmaz. Harf içeren kod Shift ile gelir.
2. **Yarıda kalan sayım.** Sayfa yenilense de ekran değişse de kaybolmaz.
3. **Kontrol listesi.** Yalnız gerçekten tutmayan sayımlar listelenir. "Yeniden say" ürünü sayıma ekler, yeni sayım kaydedilince ürün listeden çıkar.
4. **Kamera izni reddedilirse ya da kamera yoksa** açık bir mesaj çıkar ve pencere kapanabilir. Akış her yoldan kapanır: kapat düğmesi, Escape ve okuma sonrası.
5. **İçe aktarmada gerçek dosyalar:**
   - UTF-16 metin ve `sep=;` satırı okunur.
   - Eski `.xls` dosyası anlaşılır bir mesajla reddedilir.
   - DOĞRU/YANLIŞ ve "AD" gibi kısaltmalar okunur.
   - Harfli kod bilimsel sayı sanılmaz.
6. **Mal kabulde okutma.** Silinmiş ürünün barkodu geri getirmeyi önerir. Formda barkodu değişen yeni ürün yine satıra eklenir. Harfli kod okunur.

## Bu planın dışında

- **M4:** cari hesaplar.
- **M5:** sayım ve stok raporları.
- **M8:** iOS'ta kamera izni ve pilotta gerçek kamerayla deneme.

---

### Task 1: Sayım verisi

**Files:**
- **Create:** `src/data/counts.ts`, `src/data/counts.test.ts`
- **Modify:** `src/data/types.ts`, `src/data/db.ts` (v8: `stockCounts: 'id, occurredAt'`; `stockMovements: 'id, productId, [productId+occurredAt]'`), `src/sync/apply.ts`, `src/data/db.test.ts`, `src/sync/apply.test.ts`

**Interfaces:**
- **Produces:**
  - `type CountLine = { productId; name; unit; expectedMilli: number; countedMilli: number }`.
  - `type StockCountRecord = { id; deviceCode; lines: CountLine[]; note?; occurredAt; businessDate }`.
  - `OutboxTable`'a `'stockCounts'` eklenir; olay tablosudur.
  - `recordCount(db, { deviceCode, lines: { productId, countedMilli }[], note? }, at): Promise<StockCountRecord>`:
    - `expectedMilli` = o anki yerel stok;
    - fark sıfır değilse `count` hareketi yazılır (`refId`).
    - Boş liste, eksi miktar, adette kesir ya da silinmiş ürün kaydı durdurur.
  - `countsNeedingCheck(db, since: Date): Promise<{ count: StockCountRecord; line: CountLine; expectedNowMilli: number }[]>`. Sayım anından önceki hareketlerin toplamı (sayımın kendi hareketi hariç) `expectedMilli`'den farklıysa satır listelenir. Ürün bu sayımdan sonra yeniden sayılmışsa listelenmez.
- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('records a count all or nothing, moving only what differs')`.
  - `it('refuses fractions and amounts below zero')`.
  - `it('flags a count that a late movement or a second count breaks')`: başka cihazdan, sayımdan önceki zamanda bir satış gelir; aynı ürünü iki cihaz sayar; sonra yeniden sayım yapılınca işaret kalkar.
  - `apply.test.ts`: "applies pulled counts once".
- [ ] **Step 2–4:** Run: `npm test -- src/data src/sync && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(data): stock counts, and the counts that later movements break"`

---

### Task 2: Sayım ekranı

**Files:**
- **Create:** `src/stock/countDraft.ts`, `src/stock/countDraft.test.ts`, `src/stock/StockCount.tsx`, `src/stock/StockCount.test.tsx`
- **Modify:** `src/stock/StockScreen.tsx` (görünüm "Sayım")

**Interfaces:**
- **Produces:**
  - `countDraft.ts`:
    - `CountDraftLine = { productId; name; unit; counted: string }`;
    - `countProduct(draft, product)`: adette okutma başına +1; kg'da satırı ekler ama sayıyı artırmaz;
    - `loadCountDraft()` ve `saveCountDraft()`: `mk2.stockCount`;
    - `readCountLines(draft)`: hata mesajları ile.
  - `StockCount({ onDone })`:
    - "Ürün ara ya da okut" alanı ve okuyucu; bilinmeyen barkod için "Bu barkod kayıtlı değil." yazar.
    - Satır başına "Sayılan", beklenen stok ve fark (+/−, birimle) ve "Çıkar" bulunur.
    - "Not" alanı ve "Sayımı kaydet" düğmesi. Bildirim: "Sayım kaydedildi: {n} ürün, {m} farklı."
    - Üstte "Kontrol gerekli" bölümü (`countsNeedingCheck`, son 30 gün):
      - satır: "{ürün}: sayımda {beklenen} beklendi, şimdi {şimdi} görünüyor.";
      - "Yeniden say" düğmesi ürünü sayıma ekler.
- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('counts a product up with each scan')`.
  - `it('shows the expected stock and the difference')`.
  - `it('records the count and clears the draft')`.
  - `it('keeps the draft across a reload')`.
  - `it('lists counts that need a recount and adds one back')`.
- [ ] **Step 2–4:** Run: `npm test -- src/stock && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(stock): count the shelf by scanning, and recount what does not add up"`

---

### Task 3: Kamera okuyucu

**Files:**
- **Create:** `src/pos/camera.ts`, `src/pos/CameraScanner.tsx`, `src/pos/CameraScanner.test.tsx`
- **Modify:** `package.json`, `package-lock.json`

**Interfaces:**
- **Produces:**
  - `camera.ts`: `startCameraScan(video: HTMLVideoElement, onCode: (code) => void): Promise<() => void>`.
    - `getUserMedia({ video: { facingMode: 'environment' } })` ile akışı açar.
    - `BarcodeDetector` varsa 250 ms'de bir okur, yoksa `@zxing/browser`'ın `BrowserMultiFormatReader`'ını yükler.
    - Dönen işlev akışın bütün izlerini durdurur.
    - Aynı kod 1,5 saniye içinde tekrar bildirilmez.
  - `CameraScanner({ open, onClose, onScan(code), continuous?: boolean })`: başlığı "Kamerayla okut" olan bir pencere.
    - Video gösterilir. `continuous` değilse ilk kodda `onScan` çağrılır ve pencere kapanır; sayımda açık kalır, her okumada "Okundu: {kod}" yazar.
    - Hatalar: "Kamera izni verilmedi." (NotAllowedError), "Kamera bulunamadı." (NotFoundError), "Kamera açılamadı."
- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('reads a code and closes')`.
  - `it('keeps reading in continuous mode without repeating a code at once')`.
  - `it('stops the camera when it closes')`.
  - `it('says when the camera is not allowed or missing')`.

  Testlerde `getUserMedia` ve `BarcodeDetector` taklit edilir.
- [ ] **Step 2–4:** Run: `npm test -- src/pos/CameraScanner && npm run typecheck` · önce FAIL, sonra PASS; ardından `npm test && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(pos): read barcodes with the camera"`

---

### Task 4: Kamerayı ekranlara bağla

**Files:**
- **Modify:**
  - `src/pos/ProductPanel.tsx` ("Kamera" düğmesi, arama alanının yanında);
  - `src/products/ProductsScreen.tsx`;
  - `src/stock/GoodsReceipt.tsx`;
  - `src/stock/StockCount.tsx` (sürekli mod).
- **Test:** ilgili test dosyaları.

**Interfaces:**
- **Produces:** Her ekranda "Kamerayla okut" düğmesi. Okunan kod, o ekranın okuyucu işlevine (`onScan`) gider. Düğme yalnız `navigator.mediaDevices` varsa görünür.
- [ ] **Step 1–5:** `it('scans with the camera at the register')`, `it('counts with the camera continuously')`. Commit — `git commit -m "feat: camera scanning at the register, products, goods receipts and counts"`

---

### Task 5: Hareketler, düzeltme ve kritik stok (M3c'den)

**Files:**
- **Modify:** `src/stock/MovementsDialog.tsx`, `src/data/stock.ts`, `src/stock/AdjustStockDialog.tsx`, `src/stock/CriticalStock.tsx`, `src/products/productList.ts` ve testleri

**Interfaces:**
- **Produces:**
  - Hareket geçmişinde sayım satırının ayrıntısı sayımın notudur, not yoksa boş kalır.
  - `listMovements` `[productId+occurredAt]` indeksiyle en yeni 200 hareketi okur; stoğu aynı okuma transaction'ında okur.
  - Stok düzeltmesinde neden seçilmemişse yöne göre gelir: Ekle → "Bulunan", Çıkar → "Fire". Kişinin seçtiği neden yön değişince korunur.
  - `adjustStock` `cutoffMinutes` alır, öbür yazıcılar gibi.
  - `isCritical(product, stockMilli)` `productList.ts`'ten dışa açılır; `CriticalStock` onu kullanır.
- [ ] **Step 1–5:** `it('names the count a movement came from')`, `it('reads only the newest movements of one product')`, `it('defaults the reason to the direction')`. Commit — `git commit -m "feat(stock): movement history names the count; adjustment reason follows the direction"`

---

### Task 6: İçe aktarma cilası (M3b'den)

**Files:**
- **Modify:** `src/products/importFile.ts`, `src/products/importRows.ts`, `src/products/importPlan.ts`, `src/products/ImportDialog.tsx`, `src/products/BulkPriceDialog.tsx` ve testleri

**Interfaces:**
- **Produces:**
  - UTF-16 (BOM FF FE / FE FF) metin okunur. İlk satırdaki `sep=;` ayracı belirler ve atılır.
  - `.xls` (D0 CF 11 E0) için "Eski Excel (.xls) dosyası okunamıyor; XLSX ya da CSV olarak kaydedin." yazar.
  - Zip denetimi 4 baytla (PK\x03\x04) yapılır.
  - DOĞRU/YANLIŞ, "AD", "ADT", "PK" okunur. Bilimsel gösterim yalnız ondalıklı ve `E+` ile yazılmış sayıdır ("12E45" barkoddur).
  - Hatalı çıkan satır, aynı barkodlu sonraki satırı engellemez.
  - İçe aktarılan miktar en fazla 10.000 birimdir.
  - Eşlenmiş KDV sütununda boş hücre yeni üründe "KDV boş: %1 sayıldı." uyarısı verir.
  - Önizlemede hatalı ve uyarılı satırlar önce gösterilir. Uygulanırken düğmede "İçe aktarılıyor…" yazar.
  - Toplu fiyatta "Alış" hedefi seçiliyken alış fiyatı bilinmeyen (₺0) ürünler değişmez; pencere bunu söyler.
  - "1.000" gibi binlik ayraçlı miktar ondalık okunmaya devam eder, çünkü v1 dışa aktarımı ondalık nokta kullanıyor. Excel'in açılışta adları tarihe çevirmesi uygulamanın dışında kalır.
- [ ] **Step 1–5:** Her madde için bir test. Commit — `git commit -m "fix(products): import reads more real files and says more"`

---

### Task 7: Mal kabul cilası (M3c'den)

**Files:**
- **Modify:** `src/stock/GoodsReceipt.tsx`, `src/products/ProductFormDialog.tsx` ve testleri

**Interfaces:**
- **Produces:**
  - `ProductFormDialog`'a `onProductSaved?(productId: string)` eklenir: ekleme, kaydetme ve geri getirmeden sonra çağrılır. Mal kabul yeni ürünü barkodla değil bununla satıra ekler.
  - Silinmiş ürünün barkodu okutulunca form o ürünle, geri getirme durumunda açılır; geri getirilince ürün satıra eklenir.
  - Bir satır düzenlenince o satırın kayıt hatası kalkar.
  - Var olan satırı artıran okutma arama alanının altında "{ad}: {miktar}" yazar (`role="status"`).
  - Tartılı satırda fiyat kutularının ipucu "Kilogram fiyatı"dır.
- [ ] **Step 1–5:** `it('adds a new product whose barcode changed in the form')`, `it('offers to restore a deleted product it scans')`, `it('clears a line error once the line is edited')`, `it('says which line a rescan counted up')`, `it('reads a scanned code with letters')`, `it('refuses a price above the limit')`. Commit — `git commit -m "fix(stock): goods receipt restores, follows the form and says more"`
