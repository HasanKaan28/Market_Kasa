# Market Kasa v2 · M2b Bekletme, Son Fişler, İptal ve İade — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasiyer bir sepeti bekletip sonra devam ettirebilir, son fişleri görür, bir satışı iptal eder ve fişten iade alır; iptal ve iade stoku ve veresiye bakiyesini doğru düzeltir ve diğer cihazlara eşitlenir.

**Architecture:** İptal (`saleVoids`) ve iade (`returns`) yeni değişmez olaylardır (DESIGN §6.3): kendi stok hareketlerini ve veresiye düzeltmelerini satışla aynı transaction düzeninde yazar, outbox'a girer, M1b motoru onları diğer olaylar gibi taşır. İade tutarı satış satırının net tutarından birikimli yuvarlamayla bölünür, bütün kısmi iadelerin toplamı satır netine kuruşu kuruşuna eşit olur. Bekleyen sepetler cihaza özeldir (eşitlenmez), sepetle aynı biçimde `localStorage`'da durur.

**Tech Stack:** M1a/M1b veri katmanı, M2a kasa bileşenleri, fast-check (iade bölüşümü özelliği).

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md): §6.3 değişmez olaylar (`sale_voids`, `returns`), §6.4 türetilen stok ve bakiye, §10 Kasa satırı (bekletme, birden çok bekleyen sepet, iade, son fişler, iptal edilmiş fiş işaretli), §8.5 izinler (fişsiz iade ve iptal M6'da yöneticiye bağlanır; M2b'de herkes yapabilir).

## Global Constraints

| Kural | Bu kuralı koruyan test |
|---|---|
| Para tam sayı kuruş; bir satırın bütün kısmi iadeleri toplamı satır netine eşit | Task 1 "splits a line into partial refunds that add up to its net" |
| Bir satış en fazla bir kez iptal edilir; iadesi olan satış iptal edilmez; iptal edilmiş satıştan iade alınmaz | Task 2 "voids a sale once", Task 3 "refuses a return on a voided sale" |
| İade edilen miktar satılan miktarı aşamaz (önceki iadeler dahil) | Task 3 "refuses to return more than was sold" |
| İptal ve iade stoku ve veresiye bakiyesini düzeltir, her yazım tek transaction | Task 2 "puts the stock back and clears the credit", Task 3 "returns stock and reduces the debt" |
| Yeni olaylar diğer cihazlara eşitlenir | Task 4 "carries a void and a return to another device" |
| Bekleyen sepetler yenilemede kaybolmaz, bozuk kayıt çökertmez | Task 5 "round-trips held carts", "opens with no held carts when the stored list is unreadable" |
| Arayüz metinleri Türkçe, tutarlar `formatTRY` | Task 6–8 testleri |

## Review Focus

1. **Kısmi iade yuvarlaması:** 3 adetlik ₺10,00'luk satırdan üç ayrı tek adet iadesi ₺3,33/₺3,34 değil, toplamı tam ₺10,00 olmalı; sepet indirimi payı da düşülmüş net üzerinden. → Task 1, Task 3
2. **Veresiye satışın iptali ve iadesi:** borç geri alınmalı, bakiye eksiye düşebilir (fazla ödeme alacak kalır, §6.4); veresiye olmayan satışta "Veresiye" iade yöntemi sunulmamalı. → Task 2, Task 3, Task 7
3. **Eşitleme sırası:** iptal ya da iade, satıştan önce gelebilir mi? Cihaz satışı görmeden iptali uygularsa stok yine doğru olmalı (hareketler ayrı olaylar). → Task 4
4. **Bekletme ile sepet kimliği:** bekletilen sepete devam edildiğinde kimlik korunmalı (aynı sepet iki kez satılamaz); bekleyen sepet başka sekmede satılmışsa M2a'nın bayat sepet koruması devreye girmeli. → Task 5, Task 8
5. **Okuyucu ve kısayollar pencerelerde:** F8/F9 pencere açıkken çalışmamalı; okutma pencere açıkken "Önce açık pencereyi kapatın." demeli. → Task 8

## Bu planın dışında

- **M2c:** bölünmüş ödeme, satır ve sepet indirimi, fiş görünümü ve yazdırma (58/80 mm), PDF ve WhatsApp, M2a'dan ertelenen küçük bulgular.
- **M5:** kasadan çıkan iade parası (kasa hareketi) ve gün sonu. **M6:** iptal ve fişsiz iade izinleri.

---

### Task 1: İade bölüşümü (domain)

**Files:**
- **Create:** `src/domain/returns.ts`
- **Test:** `src/domain/returns.test.ts`

**Interfaces:**
- **Produces:** `refundShare(lineAmount: Kurus, soldMilli: number, alreadyReturnedMilli: number, returningMilli: number): Kurus` = `divRoundHalfUp(lineAmount × (already + returning), sold) − divRoundHalfUp(lineAmount × already, sold)`. `soldMilli` > 0, `returningMilli` > 0, `already + returning ≤ sold`, hepsi güvenli tam sayı; değilse `RangeError`.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/domain/returns.test.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { refundShare } from './returns';

describe('refundShare', () => {
  it('splits a line into partial refunds that add up to its net', () => {
    const parts = [0, 1000, 2000].map((already) => refundShare(1000, 3000, already, 1000));
    expect(parts).toEqual([333, 334, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 8 }),
        (amount, steps) => {
          const sold = steps.reduce((a, b) => a + b, 0);
          let already = 0;
          let refunded = 0;
          for (const step of steps) {
            refunded += refundShare(amount, sold, already, step);
            already += step;
          }
          expect(refunded).toBe(amount);
        },
      ),
    );
  });

  it('refuses impossible quantities', () => {
    expect(() => refundShare(1000, 3000, 2000, 2000)).toThrow(RangeError);
    expect(() => refundShare(1000, 3000, 0, 0)).toThrow(RangeError);
    expect(() => refundShare(1000, 0, 0, 1000)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/domain/returns` · Expected: FAIL (modül yok).
- [ ] **Step 3: `returns.ts`'i yaz.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/domain/returns && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/domain` · `git commit -m "feat(domain): split refunds so partial returns add up to the line"`

---

### Task 2: Satış iptali (veri)

**Files:**
- **Create:** `src/data/ledger.ts`, `src/data/voids.ts`
- **Modify:** `src/data/db.ts` (sürüm 4: `saleVoids: 'id, saleId'`, `returns: 'id, saleId'`), `src/data/types.ts`, `src/data/errors.ts`, `src/data/sales.ts` (borç yazımı `addLedgerEntry` ile)
- **Test:** `src/data/voids.test.ts`, `src/data/ledger.test.ts`

**Interfaces:**
- **Produces:**
  - `type SaleVoidRecord = { id: string; saleId: string; reason: string; deviceCode: string; occurredAt: string; businessDate: string }`
  - `type ReturnLine = { productId: string; name: string; qtyMilli: number; net: Kurus; vat: Kurus }`
  - `type ReturnRecord = { id: string; saleId: string; deviceCode: string; lines: ReturnLine[]; refundMethod: PaymentMethod; amount: Kurus; vat: Kurus; occurredAt: string; businessDate: string }`
  - `OutboxTable` artık `'saleVoids' | 'returns'` içerir.
  - `addLedgerEntry(db, entry: { customerId: string; kind: LedgerKind; amount: Kurus; saleId?: string; note?: string }, at: Date): Promise<LedgerRecord>` (outbox'a ekler; çağıranın transaction'ında çalışır).
  - `class SaleVoidedError extends Error` ("sale already voided"), `class SaleReturnedError extends Error` ("sale has returns").
  - `voidSale(db, input: { saleId: string; reason: string; deviceCode: string; at: Date }): Promise<SaleVoidRecord>`: tek transaction'da: satış yoksa `RecordNotFoundError`; boş neden `RangeError`; zaten iptalse `SaleVoidedError`; `returns` tablosunda bu satışa ait kayıt varsa `SaleReturnedError`; iptal kaydı; her satır için `kind: 'void'`, `delta: +qtyMilli`, `refId: void.id` stok hareketi; satışın veresiye kısmı varsa müşteriye `kind: 'adjustment'`, `amount: −veresiye` ve `saleId`.
  - `isVoided(db, saleId): Promise<boolean>`

- [ ] **Step 1: Başarısız testleri yaz** — `src/data/voids.test.ts` (M1a `sales.test.ts` kurulumuyla aynı dört ürün):
  - `it('puts the stock back and clears the credit')`: Ahmet'e veresiye satış (56640) → `voidSale` → her ürünün stoku 0, `customerBalance` 0, outbox'ta `saleVoids` eklemesi.
  - `it('voids a sale once')`: ikinci `voidSale` → `SaleVoidedError`; stok hareketi sayısı değişmez.
  - `it('needs a reason and an existing sale')`: `reason: '  '` → `RangeError`; bilinmeyen `saleId` → `RecordNotFoundError`; ikisinde de hiçbir şey yazılmaz.
  - `it('refuses to void a sale with returns')`: `db.returns`'e bu satışa ait bir kayıt eklenmişken → `SaleReturnedError`.
  - `src/data/ledger.test.ts` `it('writes a ledger entry and queues it')`: `addLedgerEntry` → kayıt `customerBalance`'a yansır, outbox'ta `ledger` eklemesi.

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/data/voids src/data/ledger` · Expected: FAIL.
- [ ] **Step 3: Yaz:** şema sürüm 4, tipler, hatalar, `ledger.ts`, `voids.ts`; `sales.ts`'teki borç yazımını `addLedgerEntry`'ye taşı.
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test && npm run lint && npm run typecheck` · Expected: PASS (bütün paket; şema ve `sales.ts` değişti).
- [ ] **Step 5: Commit** — `git add src/data` · `git commit -m "feat(data): void a sale, putting stock and credit back"`

---

### Task 3: Fişli iade (veri)

**Files:**
- **Create:** `src/data/returns.ts`
- **Modify:** `src/data/errors.ts`
- **Test:** `src/data/returns.test.ts`

**Interfaces:**
- **Consumes:** Task 1 (`refundShare`), Task 2 (tipler, `addLedgerEntry`, `isVoided`, `SaleVoidedError`).
- **Produces:**
  - `class ReturnExceedsSaleError extends Error`
  - `returnedQuantities(db, saleId): Promise<Map<string, number>>` (ürün → iade edilmiş binde birim)
  - `recordReturn(db, input: { saleId: string; lines: { productId: string; qtyMilli: number }[]; refundMethod: PaymentMethod; deviceCode: string; at: Date }): Promise<ReturnRecord>`: tek transaction'da: satış yok → `RecordNotFoundError`; iptal → `SaleVoidedError`; boş satır listesi ya da sıfır/eksi miktar → `RangeError`; satışta olmayan ürün → `RangeError`; önceki iadelerle birlikte satılanı aşan miktar → `ReturnExceedsSaleError`; `refundMethod` satışın ödeme yöntemlerinden biri değilse `RangeError`. Satır tutarları `refundShare(line.net, …)` ve `refundShare(line.vat, …)`; iade kaydı; her satır için `kind: 'return'`, `delta: +qtyMilli`, `refId: return.id` stok hareketi; `refundMethod === 'credit'` ise `kind: 'adjustment'`, `amount: −iade tutarı`.
  - `saleStatus(db, saleId): Promise<{ voided: boolean; returned: Map<string, number> }>`

- [ ] **Step 1: Başarısız testleri yaz** — `src/data/returns.test.ts`:
  - `it('returns stock and reduces the debt')`: Ahmet'e veresiye 3 Ayran (₺67,50) → 1 Ayran veresiye iadesi → kayıt `{ amount: 2250, refundMethod: 'credit' }`, Ayran stoku −2000, bakiye 4500.
  - `it('splits partial returns so they add up to the line')`: ₺10,00'luk ürün ×3 nakit satış → üç tek adet iade → tutarlar `[333, 334, 333]`, toplam 1000.
  - `it('refuses to return more than was sold')`: 2 adet satış, 1 adet iade sonrası 2 adet iade → `ReturnExceedsSaleError`, ikinci iade yazılmaz.
  - `it('refuses a return on a voided sale')` ve `it('refuses a refund method the sale did not use')` (nakit satışa `credit` iade → `RangeError`).

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/data/returns src/data/voids` · Expected: FAIL.
- [ ] **Step 3: `returns.ts`'i yaz.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/data && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/data` · `git commit -m "feat(data): take returns against a receipt"`

---

### Task 4: İptal ve iadenin eşitlenmesi

**Files:**
- **Modify:** `src/sync/apply.ts` (`EVENT_TABLES`'a `saleVoids`, `returns`)
- **Test:** `src/sync/engine.test.ts`

**Interfaces:**
- **Consumes:** Task 2–3, `syncOnce`, `FakeServer`.

- [ ] **Step 1: Başarısız testi yaz** — `it('carries a void and a return to another device')`: A'da iki satış; birini iptal et, ötekinden 1 adet iade al; A ve B eşitlenir → B'de `isVoided` true, `returnedQuantities` iadeyi gösterir, B'deki stok A'dakiyle aynı ve `parkedRows(b)` boş.
- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/sync/engine` · Expected: FAIL (B'de iptal yok; satırlar `parkedRows`'a düşer).
- [ ] **Step 3: `apply.ts`'e tabloları ekle.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/sync && npm run lint && npm run typecheck` · Expected: PASS (yakınsama testi dahil).
- [ ] **Step 5: Commit** — `git add src/sync` · `git commit -m "feat(sync): carry voids and returns between devices"`

---

### Task 5: Bekleyen sepetler (model)

**Files:**
- **Create:** `src/pos/held.ts`
- **Test:** `src/pos/held.test.ts`

**Interfaces:**
- **Consumes:** M2a `cart.ts`: `Cart`, `cartTotals` ve bu görevde dışa aktarılan `isCart`.
- **Produces:**
  - `type HeldCart = { cart: Cart; heldAt: string }`
  - `MAX_HELD = 10`
  - `holdCart(held: readonly HeldCart[], cart: Cart, at: Date): HeldCart[]`: boş sepet → `RangeError`; liste doluysa `RangeError('Bekleyen sepet sınırı dolu')`; en yenisi başta.
  - `takeHeld(held: readonly HeldCart[], cartId: string): { cart: Cart; rest: HeldCart[] }` (yoksa `RangeError`).
  - `loadHeld(storage?)`, `saveHeld(held, storage?)`: anahtar `mk2.held`; okunamayan liste → `[]`; bozuk öğeler atlanır; toplanamayan sepet atlanır (M2a `loadCart` kuralı).

- [ ] **Step 1: Başarısız testleri yaz:** `it('holds the newest cart first and takes one back by id')`, `it('refuses an empty cart and a full list')`, `it('round-trips held carts')`, `it('opens with no held carts when the stored list is unreadable')` (`'not json'`, hata atan depolama, bozuk öğe olan liste → yalnız sağlam öğeler).
- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/held` · Expected: FAIL.
- [ ] **Step 3: `held.ts`'i yaz** (`cart.ts`'teki `isCart` doğrulamasını dışa aktarıp kullan).
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/pos && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/pos` · `git commit -m "feat(pos): keep several held carts on the device"`

---

### Task 6: Bekleyen sepetler ve son fişler pencereleri

**Files:**
- **Create:** `src/pos/HeldCartsDialog.tsx`, `src/pos/ReceiptsDialog.tsx`
- **Test:** `src/pos/HeldCartsDialog.test.tsx`, `src/pos/ReceiptsDialog.test.tsx`

**Interfaces:**
- **Consumes:** Task 5, Task 3 (`saleStatus`), `recentSales`, `findSaleByReceiptNo`, M2a `Dialog`, `TextField`, `Button`.
- **Produces:**
  - `HeldCartsDialog({ open, held, onClose, onResume }: { open: boolean; held: readonly HeldCart[]; onClose(): void; onResume(cartId: string): void })`: başlık "Bekleyen sepetler"; her öğe saat (`HH:mm`, Europe/Istanbul), "{n} kalem", toplam ve "Devam et" butonu (`aria-label` "Devam et · {saat}"); boşsa "Bekleyen sepet yok".
  - `ReceiptsDialog({ open, onClose, onReturn, onVoid }: { open: boolean; onClose(): void; onReturn(sale: SaleRecord): void; onVoid(sale: SaleRecord): void })`: başlık "Son fişler"; "Fiş no" araması (tam eşleşme ya da son 4 hane); liste: fiş no, saat, toplam, ödeme yöntemleri (Nakit/Kart/Veresiye), rozetler "İptal edildi", "İade var". Seçilen fişin ayrıntısı: satırlar ("{adet} × {birim fiyat}" ve net), toplam, ödemeler, para üstü, müşteri adı; "İade al" (iptalse ya da her şey iade edildiyse pasif) ve "Satışı iptal et" (iptalse ya da iadesi varsa pasif).

- [ ] **Step 1: Başarısız testleri yaz:**
  - `HeldCartsDialog`: `it('lists held carts with time, items and total')`, `it('resumes the chosen cart')`, `it('says when nothing is held')`.
  - `ReceiptsDialog` (`renderWithData`): `it('lists recent sales and marks voided ones')` (iki satış, biri iptal → "İptal edildi" rozeti bir kez), `it('finds a receipt by its last four digits')`, `it('shows a receipt and starts a return or a void')` (ayrıntı satırları ve toplam; butonlar `onReturn`/`onVoid`'u satışla çağırır), `it('blocks a second void and a return on a voided sale')`.
- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/HeldCartsDialog src/pos/ReceiptsDialog` · Expected: FAIL.
- [ ] **Step 3: Pencereleri yaz.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/pos && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/pos` · `git commit -m "feat(pos): add the held carts and recent receipts dialogs"`

---

### Task 7: İptal ve iade pencereleri

**Files:**
- **Create:** `src/pos/VoidDialog.tsx`, `src/pos/ReturnDialog.tsx`
- **Test:** `src/pos/VoidDialog.test.tsx`, `src/pos/ReturnDialog.test.tsx`

**Interfaces:**
- **Consumes:** Task 2–3, Task 1, `useData`, `Dialog`.
- **Produces:**
  - `VoidDialog({ open, sale, onClose, onVoided }: { open: boolean; sale: SaleRecord; onClose(): void; onVoided(record: SaleVoidRecord): void })`: başlık "Satışı iptal et"; fiş no ve toplam; "İptal nedeni" (zorunlu: boşsa "İptal nedeni gerekli."); "İptal et" (`danger`) → `voidSale`; hata mesajları: `SaleVoidedError` → "Bu satış zaten iptal edilmiş.", `SaleReturnedError` → "İadesi olan satış iptal edilemez.", diğer → "İptal kaydedilemedi."; işlem sürerken pasif, bir kez yazar.
  - `ReturnDialog({ open, sale, onClose, onReturned }: { open: boolean; sale: SaleRecord; onClose(): void; onReturned(record: ReturnRecord): void })`: başlık "İade"; her satır için kalan iade edilebilir miktar ve "Azalt/Artır" (0…kalan); "İade tutarı" (`refundShare` ile, canlı); iade yöntemi seçimi yalnız satışta kullanılan yöntemler (varsayılan ilki); "İadeyi kaydet" miktar seçilmemişse pasif → `recordReturn`; `ReturnExceedsSaleError` → "İade miktarı satılan miktarı aşıyor."; diğer → "İade kaydedilemedi."; bir kez yazar.

- [ ] **Step 1: Başarısız testleri yaz:**
  - `VoidDialog`: `it('voids with a reason once, even on a double click')`, `it('asks for a reason')`, `it('explains a sale that cannot be voided')` (iadesi olan satış).
  - `ReturnDialog`: `it('returns the chosen quantity and shows the refund')` (3 Ayran, 1 seç → "₺22,50", kayıt), `it('offers only the methods the sale used')` (nakit satışta "Veresiye" yok), `it('caps each line at what is left to return')` (önceki iadeden sonra "Artır" kalan miktarda durur), `it('cannot save an empty return')`.
- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/VoidDialog src/pos/ReturnDialog` · Expected: FAIL.
- [ ] **Step 3: Pencereleri yaz.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/pos && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/pos` · `git commit -m "feat(pos): add the void and return dialogs"`

---

### Task 8: Kasa ekranına bağlama

**Files:**
- **Modify:** `src/pos/PosScreen.tsx` (ürün panelinin altında "Beklet" F8 ve "Son fişler" F9 butonlarından oluşan bir satır), `src/pos/keyboard.ts` (`F8`, `F9`)
- **Test:** `src/pos/PosScreen.test.tsx`, `src/pos/keyboard.test.tsx`

**Interfaces:**
- **Consumes:** Task 5–7.
- **Produces:**
  - `useShortcuts` anahtarları: `'F1' | 'F2' | 'F4' | 'F8' | 'F9'`.
  - PosScreen: "Beklet" (`kbd="F8"`) dolu sepeti bekletir ("Sepet beklemeye alındı.") ve boş sepetle devam eder; sepet boşsa ve bekleyen varsa bekleyenler penceresini açar; sepet boş ve bekleyen yoksa pasif. Bekleyenler penceresinden devam: mevcut sepet doluysa önce o bekletilir, seçilen sepet kimliğiyle geri gelir. "Son fişler" (`kbd="F9"`) fiş penceresini açar; oradan iade/iptal pencerelerine geçilir; başarılı iade "İade kaydedildi · {tutar}", iptal "Satış iptal edildi · {fiş no}" bildirir ve `runner.run()` çalışır. Bekleyenler listesi `saveHeld` ile kalıcı, `storage` olayıyla sekmeler arası güncel.

- [ ] **Step 1: Başarısız testleri yaz** (`PosScreen.test.tsx`):
  - `it('holds a cart and resumes it with the same id')`: okut → F8 → "Sepet boş" → F8 → "Devam et" → "1 kalem"; geri gelen sepetin kimliği bekletilenle aynı (`loadCart().id`).
  - `it('swaps the current cart when resuming another')`.
  - `it('voids a sale from recent receipts')`: satış → F9 → fişi seç → "Satışı iptal et" → neden → "İptal et" → bildirim ve listede "İptal edildi".
  - `it('takes a return from a receipt')`: satış → F9 → "İade al" → 1 adet → "İadeyi kaydet" → "İade kaydedildi · ₺42,50", stok geri gelir.
  - `keyboard.test.tsx`: `useShortcuts` F8 ve F9'u da çağırır.
- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/PosScreen src/pos/keyboard` · Expected: FAIL.
- [ ] **Step 3: Bağla.**
- [ ] **Step 4: Bütün kontroller** — Run: `npm run lint && npm run typecheck && npm test && npm run build` · Expected: PASS.
- [ ] **Step 5: Gözle kontrol** — `kasa-preview` (production build), 1366 × 768 ve 375 × 812: iki sepet beklet ve sırayla devam et; satış yap, F9'dan iade al, başka satışı iptal et; rozetler ve bildirimler doğru, yatay kaydırma yok.
- [ ] **Step 6: Commit** — `git add src` · `git commit -m "feat(pos): wire holding, recent receipts, voids and returns into the register"`

## Uygulama notları (2026-10-29)

Commit'ler `0c1cd1e`…`4319d22`. Son inceleme: 0 kritik, 4 önemli (düzeltildi); bir küçük bulgu önemliye yükseltildi (düzeltildi); 12 küçük bulgu ertelendi.

**Verilen kararlar:**
- İade bölüşümünün örneği planda yanlıştı (indirim olmadan birim net hep tam); test, KDV'nin düzensiz bölünmesini (22/23/22) kullanıyor.
- Aynı ürünü iki kez içeren iade isteği reddediliyor.
- Bekleyenler listesine F8'in yanında "Bekleyenler (n)" butonuyla da ulaşılıyor; dolu sepetle F8 bekletir.
- İptal ya da iade penceresi kapanınca son fişlere dönülüyor.
- İptal kaydının, stok hareketlerinin ve veresiye düzeltmesinin kimliği satıştan türetiliyor (`deriveId`, UUID v8): iki cihazda yapılan iptal tek sayılıyor. İki kopyanın neden ve saat metni cihazlara göre farklı kalabilir.
- İki cihazın satılandan fazla iade alması ya da iptal ile iadenin çakışması birleştirilmiyor: kayıtlar kalıyor, fiş "Kontrol gerekli" olarak işaretleniyor (DESIGN §7).
- İade penceresi, açıkken başka yerden gelen iadeye göre seçimleri kırpıyor.
- Okunamayan zamanı olan bekleyen sepet atlanıyor, en fazla 10 tanesi yükleniyor; hata ekranındaki sıfırlama bekleyen sepetleri de siliyor.
- Fiş araması yalnız son 50 fişe değil bütün satışlara bakıyor; liste tarih de gösteriyor.
- Başka sekmede satılmış bekleyen sepete devam edilince sepet bekleyenlerden çıkarılıyor (küçük bulgudan önemliye yükseltildi).
- Kapsam dışı bırakılanlar: bölünmüş ödemede iade (M2c), kasadan çıkan iade parası ve Z raporu (M5), iptal ve iade izinleri ile olaylarda `staffId` (M6), sunucu tabloları (M0b), e-Arşiv iade faturası (M7).

**Ertelenen küçük bulgular:**
- İptal ya da iadeden sonra borç yaşı en eski borçtan düşülüyor, ilgili satışın borcundan değil (M4'te görünür olur).
- Tartılı satırlarda iade adımı tam birim; birim etiketi yok.
- Aynı ürün iki satırda olursa iade ürün kimliğiyle arıyor (sepet satırları birleştirdiği için şimdilik oluşmuyor).
- Bu arada iptal edilmiş satışın iadesi genel "İade kaydedilemedi." mesajını veriyor.
- İptal penceresinin hataları duyurulmuyor ve neden alanını hatalı gösteriyor.
- İade yöntemi seçeneklerinde görünür klavye odağı yok.
- Bekleyenler listesi: aynı dakikadaki iki sepetin etiketi aynı, eski günlerin tarihi yok, sepeti açmadan silmenin yolu yok.
- Boş sepette "Beklet" butonu pasif, oysa F8 listeyi açıyor.
- Metin: iade bildirimi paranın nasıl döndüğünü, iptal bildirimi tutarı söylemiyor; iptal penceresi nakit satışta da "veresiye geri alınır" diyor.
- `addLedgerEntry` kendi transaction'ını açmıyor (bugün her çağıran açıyor).
- Sunucudan gelen iptal ve iade satırları, stok hareketleri gibi şekil denetiminden geçmiyor.
- Test boşlukları: pencereler açıkken okutma ve kısayollar, satıştan önce gelen iptal/iade, arayüzden veresiye iptali ve iadesi, yakınsama testinde iptal/iade.
