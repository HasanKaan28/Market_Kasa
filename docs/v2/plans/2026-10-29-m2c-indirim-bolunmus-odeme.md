# Market Kasa v2 · M2c İndirim, Satır Düzenleme ve Bölünmüş Ödeme — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasiyer bir satırın miktarını (tartılı ürünlerde kilogram) ve indirimini düzenler, sepete indirim uygular ve bir satışı nakit, kart ve veresiye arasında bölerek alır.

**Architecture:** M0'ın `computeCart` ve M1a'nın `recordSale`'i satır indirimini, sepet indirimini (en büyük kalan yöntemiyle satırlara dağıtılır) ve birden çok ödemeyi zaten destekler. Bu plan sepet modeline indirim ve birim alanlarını ekler, `checkout`'u ödeme listesi alacak şekilde genişletir ve üç pencere ekler. M2b'nin iade bölüşümü satırın indirimli `net`'ini kullandığı için indirimli satışların iadesi değişmeden doğru kalır.

**Tech Stack:** M0 alan kuralları, M2a/M2b kasa bileşenleri.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md): §9 para kuralları, §10 Kasa satırı ("satır ve sepet indirimi", "bölünmüş ödeme", tartılı ürün), §8.5 (indirim izni M6'da yöneticiye bağlanır; M2c'de herkes yapabilir), §6.3 `sales.payments[]`.

## Global Constraints

| Kural | Bu kuralı koruyan test |
|---|---|
| Tutarlar tam sayı kuruş; yüzde indirim `divRoundHalfUp` ile kuruşa yuvarlanır | Task 1 "turns a percentage into kuruş" |
| Satır indirimi satırın brüt tutarını, sepet indirimi satır indirimlerinden sonraki ara toplamı aşamaz; miktar ya da fiyat düşünce indirim kırpılır | Task 1 "clamps discounts when the line shrinks" |
| Bölünmüş ödemenin toplamı satış toplamına eşittir; veresiye kısmı müşteri ister; para üstü yalnız nakit kısmından hesaplanır | Task 2 "records a split sale", Task 5 testleri |
| Eski kayıtlı sepetler (indirim ve birim alanı olmadan) okunur | Task 1 "reads a cart saved before discounts existed" |
| Tartılı ürün miktarı en fazla üç ondalık kilogram; adetli ürün tam sayı | Task 1 "reads quantities by unit" |
| Arayüz metinleri Türkçe, tutarlar `formatTRY` | Task 3–6 testleri |

## Review Focus

1. **İndirim + iade:** indirimli bir satıştan kısmi iade, satırın indirimli netinden bölünmeli; sepet indiriminin payı iki kez düşülmemeli. → Task 2
2. **Bölünmüş ödemede yuvarlama ve kenarlar:** kalan 0 olmadan onay verilmemeli; boş bırakılan alan 0 sayılmalı; nakit verilen tutar nakit kısmından azsa onay yok. → Task 5
3. **Fiyat değişince indirim:** başka cihazdan fiyat düşünce satır indirimi brütü aşmamalı (kırpılır), sepet çökmemeli. → Task 1
4. **Tartılı miktar girişi:** "1,250", "0,5", "1.5" doğru okunmalı; adetli üründe "1,5" reddedilmeli. → Task 1, Task 3
5. **Bayat sepet koruması:** indirimler satır karşılaştırmasını (ürün, miktar) değiştirmemeli; M2a'nın iki sekme koruması sürmeli. → Task 2

## Bu planın dışında

- **M2d:** fiş görünümü, yazdırma (58/80 mm), PDF, WhatsApp, fiş ayarları, ertelenen küçük bulguların uygun olanları.
- **M6:** indirim ve limit aşımı izinleri. **M3:** terazi entegrasyonu ve barkodlu tartılı etiketler.

---

### Task 1: Sepette indirim, birim ve miktar

**Files:**
- **Modify:** `src/pos/cart.ts`, `src/pos/format.ts`
- **Create:** `src/domain/discount.ts`
- **Test:** `src/pos/cart.test.ts`, `src/domain/discount.test.ts`, `src/pos/format.test.ts`

**Interfaces:**
- **Produces:**
  - `percentOf(amount: Kurus, percent: number): Kurus` (`domain/discount.ts`): `percent` 1–100 tam sayı, değilse `RangeError`; `divRoundHalfUp(amount × percent, 100)`.
  - `CartLine` yeni alanlar: `unit: ProductUnit`, `lineDiscount: Kurus`. `Cart` yeni alan: `cartDiscount: Kurus`.
  - Yeni eylemler: `{ type: 'setQuantity'; productId: string; qtyMilli: number }` (0 satırı siler), `{ type: 'setLineDiscount'; productId: string; amount: Kurus }`, `{ type: 'setCartDiscount'; amount: Kurus }`. Her değişiklikten sonra satır indirimi `min(indirim, brüt)`, sepet indirimi `min(indirim, satır indirimlerinden sonraki ara toplam)` olarak kırpılır; `refresh` ve `decrement` dahil.
  - `cartTotals` indirimleri `computeCart`'a geçirir.
  - `loadCart`/`isCart` eski biçimi okur: eksik `unit` → `'piece'`, eksik indirim alanları → 0.
  - `parseQuantity(text: string, unit: ProductUnit): number | null` (`pos/format.ts`): adet → pozitif tam sayı × 1000; kg → en fazla üç ondalıklı pozitif sayı, virgül ya da nokta (`"1,250"` → 1250, `"0,5"` → 500, `"1.5"` → 1500); okunamazsa `null`.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `discount.test.ts` `it('turns a percentage into kuruş')`: `percentOf(56640, 10)` → 5664; `percentOf(999, 15)` → 150; `percentOf(1000, 0)` ve `percentOf(1000, 101)` → `RangeError`.
  - `cart.test.ts`:
    - `it('applies line and cart discounts to the totals')`: maket sepete Ekmek satırına 300, sepete 1000 indirim → toplam 56640 − 1300 = 55340.
    - `it('clamps discounts when the line shrinks')`: 2 Ekmek, satır indirimi 2500 → `decrement` sonrası indirim 1500; fiyat 1000'e düşen `refresh` sonrası 1000.
    - `it('sets a weighed quantity and removes a line at zero')`: `setQuantity` 1250 → satır 1250; 0 → satır yok.
    - `it('reads a cart saved before discounts existed')`: `{ id, lines: [{ productId, name, unitPrice, vatRate, qtyMilli }] }` → `unit: 'piece'`, `lineDiscount: 0`, `cartDiscount: 0`.
  - `format.test.ts` `it('reads quantities by unit')`: yukarıdaki örnekler; adette `"1,5"`, `"0"`, `"abc"` → `null`; kg'de `"1,2345"` → `null`.
- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/domain/discount src/pos/cart src/pos/format` · Expected: FAIL.
- [ ] **Step 3: Yaz.** `add` eylemi yeni satıra ürünün `unit`'ini koyar.
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test && npm run lint && npm run typecheck` · Expected: PASS (bütün paket: sepet tipi değişti).
- [ ] **Step 5: Commit** — `git add src` · `git commit -m "feat(pos): carry line and cart discounts and weighed quantities in the cart"`

---

### Task 2: İndirimli ve bölünmüş satış

**Files:**
- **Modify:** `src/pos/checkout.ts`, `src/pos/PosScreen.tsx` (çağrı biçimi)
- **Test:** `src/pos/checkout.test.ts`

**Interfaces:**
- **Produces:**
  - `CheckoutInput` artık `method` yerine `payments: Payment[]` alır; `cashGiven?`, `customerId?` aynı. Satırlar `lineDiscount` ile, sepet `cartDiscount` ile `recordSale`'e gider.
  - `singlePayment(cart: Cart, method: PaymentMethod): Payment[]` (toplamın tamamı tek yöntemle).
  - `checkoutErrorMessage` aynı; ek olarak `RecordNotFoundError` (müşteri) → "Veresiye için müşteri seçin."

- [ ] **Step 1: Başarısız testleri yaz:**
  - `it('records a split sale')`: Süt (4250) + Ekmek (1500) = 5750; ödemeler nakit 2000, kart 2000, veresiye 1750 (müşteriyle), `cashGiven` 5000 → satış `payments` üç kalem, `change` 3000, müşteri bakiyesi 1750.
  - `it('records discounts on the sale')`: satır indirimi 250 ve sepet indirimi 500 → satış `cartDiscount` 500, Süt satırı `lineDiscount` 250, `total` 5000.
  - `it('splits a partial return of a discounted sale from the discounted net')`: 2 Ekmek, sepet indirimi 300 → 1 Ekmek iadesi `amount` 1350.
  - Mevcut testler `singlePayment` ile güncellenir.
- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/checkout` · Expected: FAIL.
- [ ] **Step 3: Yaz; PosScreen'deki `pay` çağrısını `singlePayment` ile güncelle.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src` · `git commit -m "feat(pos): check out with discounts and several payments"`

---

### Task 3: Satır penceresi

**Files:**
- **Create:** `src/pos/LineDialog.tsx`
- **Test:** `src/pos/LineDialog.test.tsx`

**Interfaces:**
- **Consumes:** Task 1.
- **Produces:** `LineDialog({ open, line, onClose, dispatch }: { open: boolean; line: CartLine; onClose(): void; dispatch(action: CartAction): void })`: başlık ürün adı; "Miktar" (adet ya da "Miktar (kg)"; `parseQuantity`, okunamazsa "Geçerli bir miktar girin."); "İndirim" tutar ya da yüzde seçimiyle ("₺" / "%"; `parseTRY` ya da 1–100 tam sayı; brütü aşarsa "İndirim satır tutarını aşamaz."); satır tutarı önizlemesi; "Kaydet" → `setQuantity` ve `setLineDiscount`, kapanır; "Satırı sil" → `remove`.

- [ ] **Step 1: Başarısız testleri yaz:** `it('sets a weighed quantity')` (kg satırı, "1,250" → `setQuantity` 1250), `it('applies a percentage discount to the line')` (2 × ₺15,00, %10 → `setLineDiscount` 300), `it('refuses a discount above the line')`, `it('refuses a fractional quantity for a piece')`, `it('removes the line')`.
- [ ] **Step 2–4:** Run: `npm test -- src/pos/LineDialog && npm run lint && npm run typecheck` · Expected önce FAIL, sonra PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(pos): edit a cart line's quantity and discount"`

---

### Task 4: Sepet indirimi penceresi

**Files:**
- **Create:** `src/pos/DiscountDialog.tsx`
- **Test:** `src/pos/DiscountDialog.test.tsx`

**Interfaces:**
- **Produces:** `DiscountDialog({ open, cart, onClose, dispatch })`: başlık "Sepet indirimi"; tutar ya da yüzde (yüzde, satır indirimlerinden sonraki ara toplamdan); yeni toplam önizlemesi; "Uygula" → `setCartDiscount`; mevcut indirim varsa "İndirimi kaldır" → 0; ara toplamı aşan indirim → "İndirim toplamı aşamaz.".

- [ ] **Step 1: Başarısız testleri yaz:** `it('applies an amount')` ("50" → 5000), `it('applies a percentage of the subtotal')` (maket sepet %10 → 5664), `it('refuses more than the subtotal')`, `it('removes the discount')`.
- [ ] **Step 2–4:** Run: `npm test -- src/pos/DiscountDialog && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(pos): add a cart discount dialog"`

---

### Task 5: Bölünmüş ödeme penceresi

**Files:**
- **Create:** `src/pos/SplitPaymentDialog.tsx`
- **Test:** `src/pos/SplitPaymentDialog.test.tsx`

**Interfaces:**
- **Consumes:** `CustomerPicker` (M2a), Task 2 (`Payment`).
- **Produces:** `SplitPaymentDialog({ open, total, busy, onClose, onConfirm }: { open: boolean; total: Kurus; busy?: boolean; onClose(): void; onConfirm(input: { payments: Payment[]; cashGiven?: Kurus; customerId?: string }): void })`: başlık "Bölünmüş ödeme"; "Nakit", "Kart", "Veresiye" tutar alanları (boş = 0, `parseTRY`); "Kalan" (toplam − girilenler; `data-testid="remaining"`); her alanda "Kalanı ekle" kısayolu; veresiye > 0 ise "Müşteri seç" (CustomerPicker, seçilen ad gösterilir); nakit > 0 ise isteğe bağlı "Alınan nakit" ve para üstü; "Satışı tamamla" yalnız kalan 0, okunamayan alan yok, veresiye varsa müşteri seçili, alınan nakit nakit kısmından az değilken etkin. 0 tutarlı ödemeler listeye girmez.

- [ ] **Step 1: Başarısız testleri yaz:** `it('confirms when the parts add up to the total')` (5750: nakit "20", kart "20", veresiye "17,50" + müşteri → `onConfirm` ödemeler ve müşteri), `it('shows what is left and fills it')`, `it('needs a customer for the credit part')`, `it('computes change from the cash part only')` (nakit 2000, alınan "50" → para üstü ₺30,00, `cashGiven` 5000), `it('leaves out empty parts')`.
- [ ] **Step 2–4:** Run: `npm test -- src/pos/SplitPaymentDialog && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(pos): take a payment split across cash, card and credit"`

---

### Task 6: Kasa ekranına bağlama

**Files:**
- **Modify:** `src/pos/CartPanel.tsx`, `src/pos/PosScreen.tsx`
- **Test:** `src/pos/CartPanel.test.tsx`, `src/pos/PosScreen.test.tsx`

**Interfaces:**
- **Produces:**
  - CartPanel: satır adı bir buton (`aria-label` "Düzenle · {ad}") → `onEditLine(productId)`; satırda indirim varsa "İndirim −{tutar}"; toplamlarda sepet indirimi varsa "Sepet indirimi −{tutar}" (`data-testid="cart-discount"`); "İndirim" butonu → `onDiscount()`; ödeme butonlarına "Bölünmüş" → `onPay('split')` (`onPay` tipi `PaymentMethod | 'split'`).
  - PosScreen: `{ kind: 'line'; productId }`, `{ kind: 'discount' }`, `{ kind: 'split' }` pencereleri; bölünmüş ödeme `checkout`'a `payments` ile gider.

- [ ] **Step 1: Başarısız testleri yaz:**
  - CartPanel: `it('shows line and cart discounts')`, `it('opens the line editor and the discount dialog')`.
  - PosScreen: `it('sells a discounted cart')` (okut → "Düzenle · Süt" → %10 → Kaydet → F2 → satış `lineDiscount` 425), `it('sells with a split payment')` (okut → "Bölünmüş" → nakit "20", kart "22,50" → tamamla → satışta iki ödeme).
- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/CartPanel src/pos/PosScreen`.
- [ ] **Step 3: Bağla.**
- [ ] **Step 4: Bütün kontroller** — Run: `npm run lint && npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Gözle kontrol** — `kasa-preview`, 1366 × 768 ve 375 × 812: tartılı ürün ekle ve kg gir, satır indirimi, sepet indirimi, bölünmüş ödeme (nakit + kart + veresiye), indirimli satıştan iade.
- [ ] **Step 6: Commit** — `git commit -m "feat(pos): wire discounts, line editing and split payment into the register"`

## Uygulama notları (2026-10-29)

Commit'ler `e070a11`…`e09a806`. Son inceleme: 1 kritik, 2 önemli (düzeltildi); 2 küçük bulgu önemliye yükseltildi (düzeltildi); 7 küçük bulgu ertelendi.

**Verilen kararlar:**
- `isCart` yerine `readCart`: eski kayıtlı sepetlerde birim ve indirim alanı yok, okurken tamamlanıyor; bekleyen sepetler de bundan geçiyor.
- Bir satırda en fazla 10.000 adet (en yüksek fiyatla çarpım kesin kalsın diye).
- Müşteri kaydı bulunamazsa "Veresiye için müşteri seçin." yerine genel mesaj (aynı hata ürün için de kullanılıyor).
- İndirim girişi `DiscountField` ve `discountInput.ts`'te ortak.
- Veresiye müşterisi bölünmüş ödeme penceresinin üstünde açılan müşteri seçicide seçiliyor.
- **İade, satışın ödendiği yoldan döner** (sahip adına verdiğim karar): önce veresiye borcundan, sonra karta, en son nakit; her yöntem en fazla o yolla gelen tutar eksi önceki iadeler. Kasiyer artık iade yöntemi seçmiyor; iade kaydı `refunds[]` taşıyor (eski kayıtlar tek yöntem olarak okunuyor). İade bildirimi paranın nasıl döndüğünü yazıyor.
- Sepette satırlar kendi indirimini gösteriyor; Ara toplam satırların toplamı, ardından Sepet indirimi ve Toplam; KDV "KDV (dahil)" bilgi satırı.
- Bölünmüş ödemede okunamayan tutar, eksik alınan nakit ve fazla ödeme ("Fazla") yazıyla gösteriliyor.
- Düzenlenen satır kaybolunca pencere kapalı sayılıyor; miktar düzenleme alanı binlik ayırıcısız dolduruluyor (küçük bulgulardan yükseltildi).
- Bayat sepet koruması yalnız satırları (ürün, miktar) karşılaştırmaya devam ediyor.

**Ertelenen küçük bulgular:**
- ₺0'lık (tamamen indirimli) sepet ödeme yollarında tutarsız; bölünmüşte ödemesiz satış oluşuyor ve iadesi alınamıyor.
- Sepet indirimi penceresi mevcut indirimi göstermiyor; boş alanla "Uygula" indirimi sessizce kaldırıyor.
- Odak ve ekran okuyucu: bölünmüş ödeme ve sepet indirimi pencereleri "Kapat"ta açılıyor; iç içe müşteri seçicinin ardından odak sayfaya düşüyor; para üstü ve hata metinleri duyurulmuyor.
- Tartılı satırlar birimini kaybedebiliyor (eski kayıt, `refresh`), sepet satırında "kg" yok.
- Satır adındaki düzenleme butonu 44 px'ten küçük.
- İndirim girişi: "%10" ve "10%" reddediliyor; "%"ye geçince dolu tutar hata veriyor.
- Test boşlukları: boş sepette Bölünmüş/İndirim, ekrandan veresiyeli bölünmüş satış ve limit hatası, eski biçimli bekleyen sepet.
