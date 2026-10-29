# Market Kasa v2 · M4a Veresiye — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasiyer ve market sahibi "Müşteriler" ekranında veresiye müşterilerini bakiyesi, borç yaşı ve limitiyle görür. Bir müşteriyi açınca ekstresini (her hareket ve ardından kalan bakiye) görür, tahsilat alır (nakit ya da kart), düzeltme yazar, müşteriyi düzenler ya da arşivler, ekstreyi yazdırır. Hatırlatma listesi borçluları en eski borçtan sıralar ve her biri için WhatsApp mesajı hazırlar; gönderimi kişi yapar.

**Architecture:**
- **Tahsilat ve düzeltme** cari hareketidir (`ledger`, olay tablosu). Tahsilat eksi tutarlı `payment`, düzeltme işaretli `adjustment` olarak yazılır. `LedgerRecord`'a `method` eklenir (DESIGN §6.3). Her yazım kendi transaction'ında yapılır: hareket ve outbox kaydı birlikte yazılır.
- **Bakiye** cari hareketlerinin toplamıdır (§6.4). Fazla ödeme eksi bakiye olarak kalır ve "Alacak" diye gösterilir.
- **Borç yaşı** en eski ödenmemiş borçtan sayılır. Satışa bağlı bir iptal ya da iade düzeltmesi önce o satışın borcunu kapatır, sonra en eskiyi (M2b'den kalan madde). Gün, gün dönümü ayarıyla ve market saat dilimiyle hesaplanır (M0'dan kalan madde).
- **Ekran:** `#/customers` rotası, üst menüde "Müşteriler". Liste ve müşteri penceresi ayrı bileşenlerdir; ekstre ve hatırlatma metni saf işlevlerdir.

**Tech Stack:** React 19, Dexie 4, Vitest ve Testing Library. Yeni bağımlılık yok.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md):
- §6.2 `customers`; §6.3 `customer_ledger` (kind, işaretli amount, method, sale_id, note); §6.4 müşteri bakiyesi.
- §8.5 izinler: tahsilat her rolde açık.
- §10 Veresiye satırı: borç ve tahsilat, ekstre PDF, WhatsApp hatırlatma, müşteri düzenleme, fazla ödeme alacak kalır, borç yaşı en eski ödenmemiş borçtan, hatırlatma listesi elle gönderilir.

[docs/v2/ertelenenler.md](../ertelenenler.md) M4 bölümünden bu plan M4a'nın bütün maddelerini alır. M4b (tedarikçiler) maddesi orada kalır.

## Global Constraints

Her kuralın bir bozma denemesi var: kuralı koruyan kod kaldırılınca testi kırmızıya dönmeli. Görev bitmeden deneme çalıştırılır, kırmızı görülür ve kod geri konur.

| Kural | Bu kuralı koruyan test | Bozma denemesi |
|---|---|---|
| Tahsilat ve düzeltme tek transaction'dır: hareket ve outbox birlikte yazılır. | Task 1 "records a payment all or nothing": outbox yazımı bozulur | `recordPayment`'taki `db.transaction` kaldırılır |
| Tahsilat tutarı sıfırdan büyük tam kuruştur; yöntem nakit ya da karttır. Düzeltme sıfır olamaz. | Task 1 "refuses an empty or unknown payment" | tutar denetimi kaldırılır |
| Fazla ödeme eksi bakiye olarak kalır, kırpılmaz. | Task 2 "keeps an overpayment as credit" | bakiye `Math.max(0, …)` ile kırpılır |
| Satışa bağlı iptal ya da iade önce o satışın borcunu kapatır. | Task 1 "closes the voided sale's debt, not the oldest" | `saleId` yok sayılır |
| Arşivli müşteri veresiye alamaz; borcu ya da alacağı olan müşteri arşivlenemez. | Task 1 "refuses to archive a customer with a balance"; Task 6 "refuses credit to an archived customer" | denetimler kaldırılır |

**İki cihaz (çevrimdışı):** İki kasa aynı müşteriden çevrimdışı tahsilat alırsa iki hareket de kalır ve bakiye ikisinin toplamıdır; hiçbiri kaybolmaz. Hareketlerin kimliği her cihazda ayrıdır, birleştirme yoktur.

## Review Focus

1. **Fazla ödeme.** Borçtan büyük tahsilat eksi bakiye bırakır; listede ve ekstrede "Alacak ₺…" yazar, hatırlatma listesine girmez.
2. **İptal ve iadeli ekstre.** Veresiye satışı iptal edilen ya da iadesi alınan müşterinin ekstresinde açıklamalar ve yürüyen bakiye doğrudur; borç yaşı iptal edilen satışın tarihinden sayılmaz.
3. **Gün dönümü.** Gün dönümü 04:00 olan markette 02:00'deki borç önceki iş gününe yazılır ve borç yaşı ona göre sayılır.
4. **Telefonsuz müşteri.** WhatsApp bağlantısı numarasız açılır; kişi alıcıyı kendisi seçer.
5. **İki kasadan tahsilat.** Aynı müşteriden iki tahsilat eşitlemeden sonra ikisi de görünür.

## Bu planın dışında

- **M4b:** tedarikçiler, tedarikçi cari, mal kabulün tedarikçiye bağlanması, bedelsiz mal ve KDV hariç fatura fiyatı.
- **M5:** kasa hareketi (tahsilat nakitse kasaya giriş), gün sonu.
- **M6:** limit aşımı için yetki, rol bazlı izinler; müşteri bazında hatırlatma açık/kapalı ve sıklığı (§6.2 `reminder`). Liste elle gönderildiği için bugün kimin hatırlatılacağını kişi seçer.

---

### Task 1: Tahsilat, düzeltme ve borç yaşı verisi

**Files:**
- **Modify:** `src/data/types.ts` (`LedgerRecord.method?: 'cash' | 'card'`), `src/data/ledger.ts`, `src/domain/ledger.ts`, `src/data/customers.ts`, `src/domain/businessDate.ts` ve testleri

**Interfaces:**
- **Produces:**
  - `recordPayment(db, { customerId, amount: Kurus (>0), method: 'cash' | 'card', note?, cutoffMinutes? }, at): Promise<LedgerRecord>`: kind `payment`, tutar eksi yazılır.
  - `recordAdjustment(db, { customerId, amount: Kurus (≠0, işaretli), note: string (boş olamaz), cutoffMinutes? }, at): Promise<LedgerRecord>`.
  - İkisi de arşivli ya da bilinmeyen müşteriyi `RecordNotFoundError` ile reddeder.
  - `oldestUnpaidDebt(entries)`: girişlere `saleId?` eklenir. Satışa bağlı eksi hareket önce aynı `saleId`'li borcu kapatır.
  - `debtAgeDays(entries, today, { cutoffMinutes?, timeZone? })`: borcun iş günü bu ayarlarla bulunur.
  - `businessDate` 0–720 dışındaki `cutoffMinutes`'ı `RangeError` ile reddeder.
  - `archiveCustomer` bakiyesi sıfır olmayan müşteriyi `RangeError` ile reddeder.
- [ ] **Step 1: Başarısız testleri yaz:** `it('records a payment all or nothing')`, `it('refuses an empty or unknown payment')`, `it('writes a signed adjustment with its note')`, `it('closes the voided sale's debt, not the oldest')`, `it('counts debt age by the business day cutoff')`, `it('refuses a cutoff outside the day')`, `it('refuses to archive a customer with a balance')`.
- [ ] **Step 2–4:** Run: `npx vitest run src/data src/domain && npm run typecheck` · önce FAIL, sonra PASS; ardından `npx vitest run && npm run lint`. Bozma denemeleri.
- [ ] **Step 5: Commit** — `git commit -m "feat(data): payments and adjustments on the customer ledger"`

---

### Task 2: Müşteri özeti ve ekstre

**Files:**
- **Create:** `src/customers/statement.ts`, `src/customers/statement.test.ts`

**Interfaces:**
- **Consumes:** Task 1.
- **Produces:**
  - `customerSummaries(db, today, { cutoffMinutes? }): Promise<CustomerSummary[]>`: `{ customer, balance, debtAgeDays }`, arşivsiz müşteriler, ada göre (Intl.Collator 'tr').
  - `customerStatement(db, customerId): Promise<StatementLine[]>`: en eskiden yeniye `{ entry, description, balanceAfter }`. Açıklamalar:
    - satış borcu "Satış {fiş no}";
    - satışa bağlı eksi düzeltme "İptal {fiş no}" ya da "İade {fiş no}";
    - tahsilat "Tahsilat (nakit)" ya da "Tahsilat (kart)", not varsa ": {not}";
    - düzeltme "Düzeltme: {not}".
  - `formatBalance(balance)`: borç "₺…", alacak "Alacak ₺…", sıfır "₺0,00".
- [ ] **Step 1–5:** `it('keeps an overpayment as credit')`, `it('describes each entry and carries the balance')`, `it('sums only active customers')`. Commit — `git commit -m "feat(customers): balances, debt ages and statements"`

---

### Task 3: Müşteriler ekranı

**Files:**
- **Create:** `src/customers/CustomersScreen.tsx`, `src/customers/CustomersScreen.test.tsx`
- **Modify:** `src/app/route.ts` (`'customers'`), `src/app/AppShell.tsx` (menüde "Müşteriler", Ürünler'den sonra), `src/app/App.tsx` ve testleri

**Interfaces:**
- **Produces:**
  - Başlık "Müşteriler" ve müşteri sayısı.
  - "Müşteri ara" alanı (ad ya da telefon).
  - Görünüm seçimi: "Tümü", "Borçlu", "Hatırlatma".
  - Tablo: ad, telefon, bakiye (`formatBalance`), borç yaşı ("{n} gün", borç yoksa "—"), limit. Limiti aşan bakiye uyarı renginde.
  - Satıra basınca müşteri penceresi açılır (Task 4). "Yeni müşteri" düğmesi.
- [ ] **Step 1–5:** `it('lists customers with balance, debt age and limit')`, `it('finds a customer by name or phone')`, `it('opens from the menu')`. Commit — `git commit -m "feat(customers): the customers screen"`

---

### Task 4: Müşteri penceresi

**Files:**
- **Create:** `src/customers/CustomerDialog.tsx`, `src/customers/CustomerFormDialog.tsx`, `src/customers/PaymentForm.tsx` ve testleri

**Interfaces:**
- **Produces:**
  - `CustomerDialog({ open, customerId, onClose, onDone(message) })`: başlıkta ad, bakiye ve borç yaşı; altında ekstre tablosu ("Ekstre": Tarih, Açıklama, Tutar, Bakiye).
  - "Tahsilat al": tutar kutusu bakiye kadar dolu gelir; "Nakit" ve "Kart"; not. Bildirim: "Tahsilat alındı: ₺…".
  - "Düzeltme": "Borç ekle" ve "Borç düş", tutar, not zorunlu.
  - "Düzenle": `CustomerFormDialog` (ad, telefon, limit); yeni müşteri de bununla eklenir.
  - "Arşivle": yalnız bakiye sıfırken etkindir; aksi halde "Bakiyesi sıfır olmayan müşteri arşivlenemez." yazar.
- [ ] **Step 1–5:** `it('takes a payment in cash or by card')`, `it('writes an adjustment only with a note')`, `it('edits and adds a customer')`, `it('archives only a settled customer')`. Commit — `git commit -m "feat(customers): payments, adjustments and editing in the customer dialog"`

---

### Task 5: Ekstre yazdırma ve WhatsApp hatırlatma

**Files:**
- **Create:** `src/customers/reminder.ts`, `src/customers/printStatement.ts` ve testleri
- **Modify:** `src/customers/CustomerDialog.tsx`, `src/customers/CustomersScreen.tsx`

**Interfaces:**
- **Produces:**
  - `reminderText({ marketName, customerName, balance, debtAgeDays })`: "Merhaba {ad}, {market} hesabınızda {tutar} borç görünüyor ({n} gündür). Uygun olduğunuzda ödeyebilirsiniz. İyi günler."
  - "WhatsApp ile hatırlat" bağlantısı: `whatsappLink(text, phone)` (`src/pos/receiptText.ts`), yeni sekmede açılır.
  - "Hatırlatma" görünümü: borcu olan müşteriler, borç yaşı büyükten küçüğe; her satırda WhatsApp bağlantısı.
  - `printStatement(model)`: A4 sayfada market adı, müşteri, tarih aralığı ve ekstre; tarayıcının yazdırma penceresi açılır, PDF olarak kaydedilebilir. Fiş yazdırmadaki gibi gizli bir iframe kullanılır.
- [ ] **Step 1–5:** `it('writes the reminder with balance and age')`, `it('lists debtors oldest debt first with a WhatsApp link')`, `it('prints the statement on A4')`. Commit — `git commit -m "feat(customers): statement printing and WhatsApp reminders"`

---

### Task 6: Kasada veresiye denetimleri (M1a'dan test boşlukları)

**Files:**
- **Modify:** `src/pos/checkout.ts` (gerekirse), `src/pos/checkout.test.ts`

**Interfaces:**
- **Produces:** Arşivli ya da bilinmeyen müşteriye veresiye satış reddedilir; mesaj kasada "Bu müşteri veresiye alamaz." olur. Gün dönümü ayarı veresiye borcuna da yazılır.
- [ ] **Step 1–5:** `it('refuses credit to an archived customer')`, `it('refuses credit to an unknown customer')`, `it('dates a credit sale by the cutoff')`. Commit — `git commit -m "test(pos): credit sales check the customer and the cutoff"`
