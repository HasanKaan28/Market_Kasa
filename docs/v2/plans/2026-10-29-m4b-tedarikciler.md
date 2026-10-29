# Market Kasa v2 · M4b Tedarikçiler — Uygulama Planı (taslak)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Durum:** Kullanıcı yokken yazıldı ve uygulandı; son incelemesi yapıldı ve bulguları düzeltildi. Plan sahibin onayını bekliyor (özellikle tedarikçi carisine eklenen "Düzeltme" türü).

**Goal:** Market sahibi tedarikçilerini kaydeder (ad, telefon, vergi no, vergi dairesi). Mal kabul bir tedarikçiye ve fatura numarasına bağlanır; ödeme nakit, kart ya da açık hesap olur. Açık hesap tedarikçinin carisine borç yazar. "Tedarikçiler" ekranında her tedarikçinin bakiyesi, ekstresi ve ödemeleri (nakit, banka, kart, çek) görünür; ekstre yazdırılır. Mal kabulde KDV hariç fatura fiyatı ve bedelsiz gelen mal girilebilir.

**Architecture:**
- **Tedarikçi** düzenlenebilir varlıktır (`suppliers`, alan bazında birleşme). **Tedarikçi carisi** değişmez olaydır (`supplierLedger`): fatura artı, ödeme eksi tutarla yazılır (DESIGN §6.3).
- **Mal kabul** (`PurchaseRecord`) `supplierId?`, `invoiceNo?` ve `payment` ('cash' | 'card' | 'on_account') alır. Açık hesap mal kabulü, aynı transaction'da tedarikçi carisine `invoice` yazar. Nakit ve kart ödemesi yalnız kayıtta durur; kasa hareketi M5'e kalır.
- **Dexie v9:** `suppliers: 'id, name, updatedAt'`, `supplierLedger: 'id, supplierId, occurredAt'`. Eşitlemede `suppliers` varlık, `supplierLedger` olay tablosudur.
- Ekstre ve yazdırma M4a'nın `printView`'unu ve ekstre bileşeninin düzenini kullanır.

**Tech Stack:** React 19, Dexie 4 (v9), Vitest ve Testing Library. Yeni bağımlılık yok.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md):
- §6.2 `suppliers` (name, phone, tax_no, tax_office); §6.3 `purchase_invoices` (supplier_id, invoice_no, lines, totals, payment: cash/card/on_account) ve `supplier_ledger` (kind invoice/payment, amount, method cash/bank/card/cheque); §6.4 tedarikçi bakiyesi.
- §8.5: tedarikçi işlemleri kasiyere kapalı (roller M6'da; bu planda herkes yapabilir).
- §10 Tedarikçiler satırı: ödemeler, ekstre PDF, gerçek tedarikçi kaydı, alış faturası tedarikçiye bağlı, kasadan ödeme kasa hareketine yazılır (M5).

[docs/v2/ertelenenler.md](../ertelenenler.md) M4 bölümünün M4b maddelerini alır.

## Global Constraints

| Kural | Bu kuralı koruyan test | Bozma denemesi |
|---|---|---|
| Açık hesap mal kabulü, fatura cari kaydıyla tek transaction'dır. | Task 2 "writes an on-account receipt and its invoice all or nothing": cari yazımı bozulur | `recordPurchase`'taki transaction'dan cari tablosu çıkarılır |
| Tedarikçi ödemesi sıfırdan büyüktür; yöntem nakit, banka, kart ya da çektir. | Task 1 "refuses an empty or unknown supplier payment" | tutar ve yöntem denetimi ayrı ayrı kaldırılır |
| Bakiyesi sıfır olmayan tedarikçi arşivlenemez. | Task 1 "refuses to archive a supplier with a balance" | denetim kaldırılır |
| KDV hariç fiyat, ürünün KDV oranıyla dahil fiyata çevrilir ve kuruşa yarım yukarı yuvarlanır. | Task 4 "turns a VAT-exclusive price into the price paid" | oran 0 alınır |

## Review Focus

1. **Açık hesap ve iptal.** Açık hesap mal kabulünden sonra tedarikçinin bakiyesi faturayı gösterir; ödeme bakiyeyi düşürür, fazla ödeme alacak kalır.
2. **Tedarikçisiz mal kabul.** Eskisi gibi kaydedilir; ödeme alanı "Nakit" gelir.
3. **KDV hariç fiyat.** %1, %10 ve %20 oranlı ürünlerde dahil fiyat ve satır tutarı doğrudur; satış fiyatı kutusu etkilenmez.
4. **Bedelsiz mal.** Alış fiyatı ₺0 yazılan satır stoğu artırır, tutara bir şey eklemez ve ürünün bilinen alış fiyatını değiştirmez.
5. **Aynı adlı tedarikçi.** Büyük/küçük harf farkıyla ikinci kez eklenemez.

## Bu planın dışında

- **M5:** kasadan ödemenin kasa hareketi, gün sonu.
- **M6:** tedarikçi işlemlerinin role bağlanması.
- **M8:** v1'deki serbest metin tedarikçi adlarının birleştirilerek aktarılması.

---

### Task 1: Tedarikçi ve tedarikçi cari verisi

**Files:** Create `src/data/suppliers.ts`, `src/data/supplierLedger.ts` ve testleri; Modify `src/data/types.ts`, `src/data/db.ts` (v9), `src/sync/apply.ts`, `src/data/db.test.ts`, `src/sync/apply.test.ts`

**Interfaces:**
- **Produces:**
  - `SupplierRecord = { id; name; phone?; taxNo?; taxOffice?; createdAt; updatedAt; archivedAt? }`; `createSupplier`, `updateSupplier`, `archiveSupplier` (bakiye sıfır değilse `RangeError`), `searchSuppliers`.
  - `SupplierLedgerRecord = { id; supplierId; kind: 'invoice' | 'payment'; amount (işaretli); method?: 'cash' | 'bank' | 'card' | 'cheque'; purchaseId?; note?; occurredAt; businessDate }`.
  - `recordSupplierPayment(db, { supplierId, amount (>0), method, note? }, at)`; `supplierBalance(db, supplierId)`.
  - Aynı adlı (Türkçe büyük/küçük harf duyarsız) ikinci tedarikçi `DuplicateSupplierError` ile reddedilir.
- [ ] **Step 1–5:** `it('adds, edits and archives a settled supplier')`, `it('refuses a second supplier with the same name')`, `it('refuses an empty or unknown supplier payment')`, `it('refuses to archive a supplier with a balance')`, `apply.test.ts`: "applies pulled suppliers and supplier ledger entries". Bozma denemeleri. Commit — `git commit -m "feat(data): suppliers and their ledger"`

### Task 2: Mal kabulü tedarikçiye bağla

**Files:** Modify `src/data/purchases.ts`, `src/stock/GoodsReceipt.tsx`, `src/stock/receiptDraft.ts` ve testleri

**Interfaces:**
- **Produces:**
  - `PurchaseInput`'a `supplierId?`, `invoiceNo?`, `payment: 'cash' | 'card' | 'on_account'` eklenir; açık hesap tedarikçi ister.
  - Açık hesapta aynı transaction'da `invoice` cari kaydı (tutar = mal kabul toplamı, `purchaseId`).
  - Mal kabul ekranında "Tedarikçi" seçimi (arama ve "Yeni tedarikçi"), "Fatura no" ve "Ödeme" (Nakit, Kart, Açık hesap). Taslak bunları da saklar.
- [ ] **Step 1–5:** `it('writes an on-account receipt and its invoice all or nothing')`, `it('needs a supplier for an on-account receipt')`, `it('keeps a receipt without a supplier as before')`, `it('picks a supplier and saves on account')`. Commit — `git commit -m "feat(stock): goods receipts from a supplier, paid or on account"`

### Task 3: Tedarikçiler ekranı

**Files:** Create `src/suppliers/SuppliersScreen.tsx`, `src/suppliers/SupplierDialog.tsx`, `src/suppliers/SupplierFormDialog.tsx`, `src/suppliers/statement.ts` ve testleri; Modify `src/app/route.ts` (`'suppliers'`), `src/app/AppShell.tsx` ("Tedarikçiler"), `src/app/App.tsx`

**Interfaces:**
- **Produces:** Müşteriler ekranının eşi: liste (ad, telefon, bakiye), arama; pencerede ekstre ("Fatura {no}", "Ödeme (banka)"), "Ödeme yap" (nakit, banka, kart, çek), "Düzenle", "Arşivle", "Ekstreyi yazdır".
- [ ] **Step 1–5:** `it('lists suppliers with their balance')`, `it('pays a supplier by bank transfer')`, `it('shows invoices and payments in the statement')`, `it('opens from the menu')`. Commit — `git commit -m "feat(suppliers): the suppliers screen"`

### Task 4: KDV hariç fiyat ve bedelsiz mal (M3c'den)

**Files:** Modify `src/stock/receiptDraft.ts`, `src/stock/GoodsReceipt.tsx`, `src/domain/pricing.ts` ve testleri

**Interfaces:**
- **Produces:**
  - Mal kabulde "Alış fiyatları KDV hariç" seçeneği: yazılan alış fiyatı `withVat(price, vatRate)` ile dahile çevrilir (kuruşa yarım yukarı) ve öyle kaydedilir; satır tutarı dahil fiyatla hesaplanır.
  - Bedelsiz satır: "Bedelsiz" işaretli satır ₺0 maliyetle stoğa girer, ürünün alış fiyatını değiştirmez.
- [ ] **Step 1–5:** `it('turns a VAT-exclusive price into the price paid')`, `it('takes free goods into stock at no cost')`. Commit — `git commit -m "feat(stock): VAT-exclusive invoice prices and free goods"`

## Uygulama notları (2026-10-29)

- **Commitler:** `3bc6ace`, `d0d4f7f`, `e091105`, `fdcdb5e` (4 görev), inceleme düzeltmeleri `ef4b784`. Son durumda 589 test yeşil.
- **Son inceleme** (Opus, donmuş worktree): kritik yok, 7 önemli, 6 küçük bulgu. Önemlilerin hepsi düzeltildi. Küçüklerden biri önemliye yükseltilip düzeltildi; kalanlar ertelendi.
  - **I1:** Arşivlenmiş ama başka kasadan açık hesap mal gelmiş tedarikçiye ödeme yapılamıyordu. Artık yapılıyor.
  - **I2:** Tedarikçide fazla ödeme "Alacak" diye yazılıyordu, müşteridekinin tersi anlamında. Artık ekranda ve yazdırılan ekstrede "Fazla ödeme" yazıyor.
  - **I3:** Alış fiyatına 0 yazmak ürünün bilinen alış fiyatını siliyordu. Artık 0 bedelsiz sayılıyor; mal kabul hiçbir zaman alış fiyatını 0 yapmıyor.
  - **I4:** KDV hariç fiyatta satır tutarı kâğıt faturadan sapıyordu (birim fiyat önce yuvarlanıyordu). Artık KDV satır toplamına ekleniyor, fatura gibi.
  - **I5:** Tedarikçi carisinde düzeltme ve açılış bakiyesi yoktu. Neden zorunlu bir "Düzeltme" eklendi (DESIGN §6.1'deki karşı kayıt; §6.3'teki tür listesini genişletir, onay bekler).
  - **I6:** Mal kabul yalnız ilk 50 tedarikçiyi listeliyordu. Artık hepsini listeliyor.
  - **I7:** Bazı kuralların ikiz korumaları test edilmiyordu; hepsi test edildi, bozma denemeleri kırmızı.
  - **Küçük 3 (önemliye yükseltildi):** Bedelsiz satırın kapalı fiyat kutusunda hatalı metin kalırsa satır kaydedilemiyordu. Artık o kutu okunmuyor.
- **Bozma denemeleri:** 29 deneme, hepsi kırmızı. İçlerinden biri önce hayatta kaldı (arşivlenen tedarikçinin seçimden düşmesi): test yalnız ekrandaki seçimi ölçüyordu, artık kaydı ölçüyor.
- **Kararlar:**
  - Tedarikçi varlık tablosudur, tedarikçi carisi olay tablosudur (Dexie v9).
  - Açık hesap mal kabulü faturasını aynı transaction'da yazar; yalnız bedelsiz maldan oluşan açık hesap mal kabulü fatura yazmaz.
  - Tedarikçi mal kabulden değil Tedarikçiler ekranından eklenir.
  - "KDV hariç" yalnız bu mal kabulde yazılan alış fiyatlarına uygulanır.
  - Aynı ad (Türkçe harf farkları dahil) ikinci kez eklenemez.
- **Doğrulama:** Production build Chromium'da denendi. "Eti Gida" eklendi; Tereyağı açık hesapla alındı ve tedarikçi bakiyesi ₺90,00 oldu. Bankayla ödeme bakiyeyi ₺0,00 yaptı; ekstrede "Mal kabul" ve "Ödeme (banka)" göründü. 375 px'te pencere sığdı; beş öğeli menü iki satıra kayıyor.
- **Ertelenenler:** [ertelenenler.md](../ertelenenler.md) içinde M4 cilası, M5 ve M6 bölümlerinde.
