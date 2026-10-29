# Market Kasa v2 · M5 Raporlar ve Gün Sonu — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market sahibi "Raporlar" ekranında seçtiği günlerin satışını görür: ciro, ödeme yoluna göre dağılım (bölünmüş ödeme doğru dağılır), iade ve iptaller, KDV dilimleri, brüt kâr, kategori kırılımı, en çok satanlar ve kasa bazında toplamlar; CSV'ye aktarır ve yazdırır. Kasiyer kasada gün başında açılış nakdini girer, gün içinde para girişi ve çıkışı yazar, gün sonunda kasadaki nakdi sayar; uygulama beklenen nakdi hesaplar, farkı gösterir ve Z raporunu kaydedip yazdırır.

**Architecture:**
- **Rapor** saf bir toplamadır: `buildSummary` satış, iptal ve iade kayıtlarını, ürün ve kategorilerle birlikte alır ve bir özet döndürür. `loadSummary` aralığın kayıtlarını `businessDate` üzerinden okur (DESIGN §9). İptal edilen satış satış toplamlarına girmez, iptaller ayrıca sayılır; iade kendi geri ödeme yollarından düşülür.
- **Kasa oturumu** cihaza aittir. Açık oturum bu cihazda saklanır (`meta`), kapanınca değişmez bir **Z kaydı** (`cashSessions`) yazılır. Gün içindeki para girişi ve çıkışı değişmez **kasa hareketleridir** (`cashMovements`). Nakit tahsilat, tedarikçiye nakit ödeme ve nakit ödenen mal kabul aynı transaction'da kasa hareketi yazar (DESIGN §10: "kasadan ödeme kasa hareketine yazılır").
- **Beklenen nakit** = açılış nakdi + bu cihazın oturumdaki satışlarının nakit kısmı − bu cihazda oturumda yapılan iptallerin nakit kısmı − nakit iadeler + kasa girişleri − kasa çıkışları. Her olay yapıldığı cihazın kasasına sayılır.
- **Dexie v10:** `cashSessions: 'id, deviceCode, closedAt'`, `cashMovements: 'id, deviceCode, occurredAt'`; ikisi de eşitlemede olay tablosudur.

**Tech Stack:** React 19, Dexie 4 (v10), Vitest ve Testing Library. Yeni bağımlılık yok.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md): §6.3 (`cash_sessions`, `cash_movements`), §6.4, §7, §8.5 (gün sonu kasiyerde, raporlar yöneticide), §9 (raporlar `business_date` üzerinden), §10 Raporlar satırı, §12 (yazdırma), §13 (KPI kutusu).

[docs/v2/ertelenenler.md](../ertelenenler.md) M5 bölümünün iki maddesini alır.

## Global Constraints

| Kural | Bu kuralı koruyan test | Bozma denemesi |
|---|---|---|
| Bölünmüş ödeme yollarına tutarlarıyla dağılır; iptal edilen satış satış toplamlarına girmez. | Task 1 "splits payments and leaves voided sales out" | iptal filtresi kaldırılır; ödemeler toplamdan bölünür |
| İade kendi geri ödeme yolundan düşülür. | Task 1 "takes returns off by how they were refunded" | iade düşülmez |
| Beklenen nakit yalnız bu cihazın, oturum içindeki olaylarından hesaplanır. | Task 3 "expects the cash this register took in the session" | cihaz ya da zaman filtresi kaldırılır |
| Z kaydı ve kasa hareketleri değişmezdir; Z kaydı kapanış transaction'ında yazılır, açık oturum kapanır. | Task 3 "closes the session into one Z record" | transaction kaldırılır |
| Nakit tahsilat, nakit tedarikçi ödemesi ve nakit mal kabul kasa hareketini aynı transaction'da yazar. | Task 3 "puts cash collections and cash payments in the drawer" | kasa hareketi yazılmaz |

## Review Focus

1. **Gece yarısını geçen gün.** Rapor `businessDate` ile gruplanır; gün dönümü ayarı yokken takvim günü kullanılır.
2. **Başka cihazın satışı.** Kasa raporu yalnız bu cihazın olaylarını sayar; genel rapor bütün cihazları.
3. **Önceki oturumun satışını iptal etmek.** İptal bugünkü kasadan nakit çıkışıdır.
4. **Oturum açmadan satış.** Satış engellenmez; gün sonu açılmamış oturum için açılış nakdini 0 sayar ve bunu söyler.
5. **Boş gün.** Satışsız günde rapor sıfırları gösterir, bölme hatası olmaz.

## Bu planın dışında

- **M0b:** web paneli (sahibin uzaktan girişi), sunucuda rapor görünümleri.
- **M6:** personel performansı (satışlar personelle M6'da işaretlenir), raporların role bağlanması, gün dönümü ayarı.

---

### Task 1: Rapor özeti

**Files:** Create `src/reports/summary.ts`, `src/reports/summary.test.ts`

**Interfaces:**
- **Produces:**
  - `Summary = { salesCount; voidCount; voidTotal; returnCount; returnTotal; gross; discounts; net; byMethod: Record<PaymentMethod, Kurus>; vatByRate: { rate; base; vat }[]; cost; grossProfit; averageBasket; categories: { categoryId?; name; net; qtyMilli }[]; bestSellers: { productId; name; unit?; qtyMilli; net }[]; byDevice: { deviceCode; salesCount; net }[] }`.
  - `buildSummary({ sales, voids, returns, products, categories }): Summary`:
    - satış: iptal edilmemişler; `gross` = toplamlar, `discounts` = satır + sepet indirimi;
    - `byMethod` = ödemeler − iadelerin geri ödemeleri; `net` = `gross` − iade tutarları;
    - `vatByRate` = satışların KDV'si − iadelerin KDV'si (iade satırının oranı satıştan bulunur);
    - `cost` = satırların alış fiyatı × miktar (iade edilen miktar düşülür); `grossProfit` = `net` − `cost`;
    - `bestSellers` ilk 10, net tutara göre; `categories` net tutara göre, kategorisizler "Kategorisiz".
  - `loadSummary(db, { from, to, deviceCode? }): Promise<Summary>`.
- [ ] **Step 1–5:** `it('splits payments and leaves voided sales out')`, `it('takes returns off by how they were refunded')`, `it('breaks down VAT, cost, categories and best sellers')`, `it('reads a range of business days, one register or all')`, `it('shows an empty day as zeros')`. Commit — `git commit -m "feat(reports): the sales summary"`

### Task 2: Raporlar ekranı

**Files:** Create `src/reports/ReportsScreen.tsx`, `src/reports/reportCsv.ts` ve testleri; Modify `src/app/route.ts` (`'reports'`), `src/app/AppShell.tsx` ("Raporlar"), `src/app/App.tsx`

**Interfaces:**
- **Produces:**
  - Aralık seçimi: "Bugün", "Dün", "Bu hafta", "Bu ay", "Özel" (başlangıç ve bitiş tarihi). "Kasa": "Tümü" ya da cihaz kodu.
  - KPI kutuları: Net satış, İşlem, Ortalama sepet, Brüt kâr; ödeme yolları (Nakit, Kart, Veresiye); İade; İptal.
  - Tablolar: KDV dilimleri, kategoriler, en çok satanlar, kasalar.
  - "CSV indir": ürün bazında satış (ad, miktar, net tutar); "Yazdır": A4 (`printView`).
- [ ] **Step 1–5:** `it('shows today’s figures')`, `it('changes the range and the register')`, `it('exports the products sold as CSV')`, `it('opens from the menu')`. Commit — `git commit -m "feat(reports): the reports screen"`

### Task 3: Kasa oturumu, kasa hareketleri ve Z kaydı

**Files:** Create `src/data/cash.ts`, `src/data/cash.test.ts`; Modify `src/data/types.ts`, `src/data/db.ts` (v10), `src/sync/apply.ts`, `src/data/ledger.ts`, `src/data/supplierLedger.ts`, `src/data/purchases.ts` ve testleri

**Interfaces:**
- **Produces:**
  - `CashMovementRecord = { id; deviceCode; kind: 'in' | 'out'; amount (>0); reason; refId?; occurredAt; businessDate }`.
  - `CashSessionRecord = { id; deviceCode; openedAt; openingCash; closedAt; expectedCash; countedCash; difference; summary: Summary; businessDate }` (Z kaydı).
  - `openCashSession(db, { deviceCode, openingCash }, at)`, `currentCashSession(db, deviceCode)` (açık oturum `meta`'da).
  - `recordCashMovement(db, { deviceCode, kind, amount, reason, refId? }, at)`.
  - `expectedCash(db, deviceCode, at): Promise<{ session; sales; voids; refunds; movementsIn; movementsOut; expected }>`.
  - `closeCashSession(db, { deviceCode, countedCash }, at): Promise<CashSessionRecord>`.
  - `recordPayment` (nakit), `recordSupplierPayment` (nakit), `recordPurchase` (`payment: 'cash'`) `deviceCode` alır ve kasa hareketi yazar.
  - `PurchaseRecord.payment` isteğe bağlı olur (yoksa nakit).
- [ ] **Step 1–5:** `it('expects the cash this register took in the session')`, `it('counts a void of an earlier sale as cash out today')`, `it('closes the session into one Z record')`, `it('puts cash collections and cash payments in the drawer')`, `apply.test.ts`: "applies pulled cash records once". Commit — `git commit -m "feat(data): cash sessions, cash movements and the Z record"`

### Task 4: Kasada gün sonu

**Files:** Create `src/pos/CashDialog.tsx`, `src/pos/ZReportView.tsx` ve testleri; Modify `src/pos/PosScreen.tsx`, ödeme alan ekranlar (`deviceCode` geçirmek için)

**Interfaces:**
- **Produces:**
  - Kasa ekranında "Kasa" düğmesi (F10): pencere oturum durumunu gösterir.
  - Oturum yoksa "Açılış nakdi" ve "Kasayı aç".
  - Açıkken: beklenen nakit, "Para girişi" ve "Para çıkışı" (tutar, neden), "Gün sonu (Z)".
  - Gün sonu: "Sayılan nakit" girilir, beklenen ve fark gösterilir, "Z raporunu kaydet" ile kapanır. Z raporu fiş genişliğinde yazdırılır (`printView`, fiş ayarlarındaki kâğıt).
  - Oturum açılmamışsa gün sonu açılış nakdini 0 sayar ve "Kasa açılmadan satış yapıldı." yazar.
- [ ] **Step 1–5:** `it('opens the drawer, records cash out and closes with a Z report')`, `it('closes a day the drawer was never opened')`, `it('prints the Z report on the receipt paper')`. Commit — `git commit -m "feat(pos): cash drawer sessions and the end-of-day Z report"`
