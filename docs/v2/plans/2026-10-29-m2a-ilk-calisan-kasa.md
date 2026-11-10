# Market Kasa v2 · M2a İlk Çalışan Kasa — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** İnternetsiz satış yapan ilk kasa: barkod okutma ya da adla arama, sepet, nakit/kart/veresiye ödeme, bilinmeyen barkoda ya da barkodsuz ürüne kasada ürün ekleme.

**Architecture:** Kasa ekranı `src/pos/` altında. Saf mantık (sepet, barkod tamponu, ödeme) React'ten ayrı modüllerde ve birim testli. Bileşenler M1a depolarına `useData()` ile erişir, listeler `useLiveQuery` ile canlı güncellenir. Eşitleme koşucusu (M1b) sunucu gelene kadar (M0b) "çevrimdışı" çalışır ve kabuktaki rozeti besler.

**Tech Stack:** React 19, dexie-react-hooks 4 (`useLiveQuery`), `@radix-ui/react-dialog`, Testing Library + fake-indexeddb (gerçek Dexie), M0 tasarım bileşenleri.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md): §10 Kasa satırı, §13 arayüz (K12), §15 barkod okuyucu (tuşlar arası ≤ 50 ms, Enter ile biter, odak nerede olursa olsun yakalanır, harf içeren kodlar da okunur), §8.5 veresiye limiti (onaylı aşım M6'da).

## Global Constraints

| Kural | Bu kuralı koruyan test |
|---|---|
| Arayüz metinleri Türkçe; tutarlar `formatTRY` ile (₺1.234,50) | Task 7 "shows the mockup cart totals"; Task 8 PaymentDialog testleri |
| Bir sepet en fazla bir satış üretir (sepet kimliği = satış kimliği) | Task 8 "records one sale per cart however often it is checked out" |
| Okuyucu: tuşlar arası ≤ 50 ms, Enter ile biter, odak nerede olursa olsun yakalanır, harfli kodlar okunur | Task 4 "returns a fast burst ending in Enter as a code", "keeps a scan apart from letters typed slowly before it", "reads a scan while a button has focus without clicking it" |
| Sepet sayfa yenilenince kaybolmaz | Task 2 "round-trips through storage"; Task 9 "keeps the cart after a reload" |
| Sepetteki fiyat, satışın yazılacağı fiyatla aynıdır | Task 2 "follows price changes made elsewhere"; Task 9 "follows a price changed elsewhere" |
| Dokunma hedefleri ≥ 44 px, metin ≥ 14 px (kısayol etiketi 12 px) | M0 `Button`/`TextField` (`min-h-11`); Task 9 gözle kontrol |
| Eşitleme rozeti koşucunun gerçek durumunu gösterir | Task 9 "shows the sync runner's state in the shell" |

## Review Focus

1. **Okuyucu ile elle yazım ya da açık pencere karışırsa:** aramaya yavaş yazılmış harfler okutulan kodla birleşmemeli; okuyucunun Enter'ı odaktaki butonu tıklamamalı; ödeme penceresi açıkken okutulan kod "Alınan tutar"a yazılıp satışı tamamlamamalı. → Task 4, Task 9
2. **Sepetteyken fiyatı değişen ürün** (başka cihazdan eşitleme ya da düzenleme): sepet yeni fiyatı göstermeli; arada kalan bir yarış "Satış kaydedilemedi" ile sepeti kilitlememeli. → Task 2, Task 8, Task 9
3. **Para üstü:** alınan tutar toplamdan azsa satış tamamlanamamalı; "600" ve "566,40" doğru okunmalı; boş alan tam tutar sayılmalı. → Task 8
4. **Veresiye limiti:** aşılırsa satış yazılmamalı, kasiyere anlaşılır mesaj gösterilmeli, sepet korunmalı. → Task 8
5. **Bozuk ya da erişilemeyen kayıtlı sepet/ayar:** okunamayan JSON ya da hata atan `localStorage` uygulamayı çökertmemeli. → Task 1, Task 2

## Bu planın dışında

- **M2b:** bekletme, iade, son fişler (F9), bölünmüş ödeme, indirim, tartılı ürün miktarı, fiş yazdırma/PDF/WhatsApp, kamera ile okutma.
- **M3:** ürün yönetimi ekranı. **M0b:** gerçek sunucu. **M6:** personel girişi ve yetkiler (limit aşım onayı dahil).

---

### Task 1: Cihaz ayarları ve veri bağlamı

**Files:**
- **Create:** `src/app/device.ts`, `src/app/appData.ts`, `src/app/DataProvider.tsx`
- **Test:** `src/app/device.test.ts`, `src/app/appData.test.tsx`

**Interfaces:**
- **Produces:**
  - `type DeviceSettings = { marketId: string; marketName: string; deviceCode: string; deviceName: string }`
  - `const DEFAULT_DEVICE: DeviceSettings = { marketId: 'yerel', marketName: 'Market Kasa', deviceCode: 'K1', deviceName: 'Kasa 1' }`
  - `loadDeviceSettings(storage?: Pick<Storage, 'getItem'>): DeviceSettings`: `mk2.device` anahtarındaki JSON. `marketId` `^[a-z0-9-]{1,64}$`, `deviceCode` `^[A-Z][A-Z0-9]{0,3}$`, adlar 1–60 karakter değilse, JSON bozuksa ya da depolamaya erişim hata atarsa (varsayılan `localStorage`'a erişim dahil) `DEFAULT_DEVICE`.
  - `type AppData = { db: MarketDb; settings: DeviceSettings; runner: SyncRunner }`
  - `createAppData(settings: DeviceSettings, deps?: { transport?: SyncTransport; isOnline?: () => boolean; now?: () => Date }): AppData`: varsayılan taşıyıcının `push` ve `pull`'u `Error('Sunucu bağlantısı henüz kurulmadı')` ile reddeder; varsayılan `isOnline` `() => false`.
  - `useData(): AppData` (sağlayıcı yoksa `Error('useData needs a DataProvider')`), `useSyncStatus(runner: SyncRunner): SyncStatus` (`useSyncExternalStore(runner.subscribe, runner.status)`): ikisi de `appData.ts`'te, bağlam nesnesiyle birlikte.
  - `DataProvider({ value, children }: { value: AppData; children: ReactNode })` (`DataProvider.tsx`; bileşen dosyası yalnızca bileşen dışa aktarır, react-refresh kuralı).

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/app/device.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE, loadDeviceSettings } from './device';

const stored = (value: string | null) => ({ getItem: () => value });

describe('loadDeviceSettings', () => {
  it('falls back to the default device', () =>
    expect(loadDeviceSettings(stored(null))).toEqual(DEFAULT_DEVICE));

  it('uses stored settings when they are valid', () => {
    const settings = { marketId: 'kursunlu', marketName: 'Kurşunlu Market', deviceCode: 'K2', deviceName: 'Kasa 2' };
    expect(loadDeviceSettings(stored(JSON.stringify(settings)))).toEqual(settings);
  });

  it('ignores invalid or unreadable settings', () => {
    const badId = { ...DEFAULT_DEVICE, marketId: 'Kurşunlu' };
    expect(loadDeviceSettings(stored(JSON.stringify(badId)))).toEqual(DEFAULT_DEVICE);
    expect(loadDeviceSettings(stored('not json'))).toEqual(DEFAULT_DEVICE);
    expect(loadDeviceSettings({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULT_DEVICE);
  });
});
```

```tsx
// src/app/appData.test.tsx
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppData, useData, type AppData } from './appData';
import { DataProvider } from './DataProvider';
import { DEFAULT_DEVICE } from './device';

let data: AppData;
beforeEach(() => {
  data = createAppData({ ...DEFAULT_DEVICE, marketId: `test-${crypto.randomUUID()}` });
});
afterEach(async () => { await data.db.delete(); });

describe('app data', () => {
  it('hands the app data to its children', () => {
    const { result } = renderHook(() => useData(), {
      wrapper: ({ children }) => <DataProvider value={data}>{children}</DataProvider>,
    });
    expect(result.current).toBe(data);
  });

  it('refuses to work without a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useData())).toThrow('useData needs a DataProvider');
  });

  it('starts offline until a server is configured', async () =>
    expect((await data.runner.run()).state).toBe('offline'));
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/app/device src/app/appData` · Expected: FAIL (modüller yok).
- [ ] **Step 3: `device.ts`, `appData.ts`, `DataProvider.tsx`'i yaz.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/app && npm run lint && npm run typecheck` · Expected: PASS, lint uyarısız.
- [ ] **Step 5: Commit** — `git add src/app` · `git commit -m "feat(app): add device settings and the app data context"`

---

### Task 2: Sepet modeli

**Files:**
- **Create:** `src/pos/cart.ts`
- **Test:** `src/pos/cart.test.ts`

**Interfaces:**
- **Consumes:** `computeCart`, `CartTotals`, `VatRate`, `Kurus` (M0); `newId`, `ProductRecord` (M1a).
- **Produces:**
  - `type CartLine = { productId: string; name: string; unitPrice: Kurus; vatRate: VatRate; qtyMilli: number }`
  - `type Cart = { id: string; lines: CartLine[] }`, `emptyCart(id?: string): Cart` (varsayılan `newId()`)
  - `type CartAction = { type: 'add'; product: ProductRecord } | { type: 'increment' | 'decrement' | 'remove'; productId: string } | { type: 'clear' } | { type: 'refresh'; products: readonly ProductRecord[] }`
  - `cartReducer(cart: Cart, action: CartAction): Cart`: `add` aynı ürünü birleştirir (+1000), yeni ürünü sona ekler; `decrement` 0'da satırı siler; `clear` yeni kimlikli boş sepet; `refresh` listede bulunan ürünlerin ad, fiyat ve KDV'sini satırlara yazar, hiçbir şey değişmediyse **aynı nesneyi** döndürür (efekt döngüsü olmasın diye).
  - `cartTotals(cart: Cart): CartTotals`
  - `saveCart(cart: Cart, storage?: Pick<Storage, 'setItem'>): void`, `loadCart(storage?: Pick<Storage, 'getItem'>): Cart`: anahtar `mk2.cart`; okunamayan ya da şekli bozuk kayıt ve hata atan depolama → `emptyCart()`; `saveCart` hatayı yutar.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/pos/cart.test.ts
import { describe, expect, it } from 'vitest';
import type { ProductRecord } from '@/data/types';
import { cartReducer, cartTotals, emptyCart, loadCart, saveCart, type Cart } from './cart';

const product = (id: string, name: string, sellPrice: number): ProductRecord => ({
  id, name, sellPrice, vatRate: 1, unit: 'piece', buyPrice: 0, isQuick: false,
  criticalLevelMilli: 0, createdAt: '', updatedAt: '',
});
const ekmek = product('ekmek', 'Ekmek', 1500);
const ayran = product('ayran', 'Ayran', 2250);
const peynir = product('peynir', 'Beyaz Peynir', 18990);
const cay = product('cay', 'Siyah Çay', 27900);

function mockupCart(): Cart {
  let cart = emptyCart('cart-1');
  for (const p of [ekmek, ekmek, ayran, ayran, ayran, peynir, cay]) cart = cartReducer(cart, { type: 'add', product: p });
  return cart;
}

describe('cart', () => {
  it('merges repeated products and totals the mockup cart', () => {
    const cart = mockupCart();
    expect(cart.lines.map((l) => [l.name, l.qtyMilli])).toEqual([
      ['Ekmek', 2000], ['Ayran', 3000], ['Beyaz Peynir', 1000], ['Siyah Çay', 1000],
    ]);
    expect(cartTotals(cart)).toMatchObject({ total: 56640, vatTotal: 561 });
  });

  it('removes a line when it is decremented to zero', () => {
    const cart = cartReducer(cartReducer(emptyCart('c'), { type: 'add', product: cay }), { type: 'decrement', productId: 'cay' });
    expect(cart.lines).toEqual([]);
  });

  it('starts a new cart with a new id when cleared', () => {
    const cleared = cartReducer(mockupCart(), { type: 'clear' });
    expect(cleared.lines).toEqual([]);
    expect(cleared.id).not.toBe('cart-1');
  });

  it('follows price changes made elsewhere', () => {
    const cart = mockupCart();
    const refreshed = cartReducer(cart, { type: 'refresh', products: [{ ...cay, sellPrice: 29900 }] });
    expect(refreshed.lines.find((l) => l.productId === 'cay')?.unitPrice).toBe(29900);
    expect(cartTotals(refreshed).total).toBe(58640);
    expect(cartReducer(cart, { type: 'refresh', products: [cay, ekmek] })).toBe(cart);
  });

  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    saveCart(mockupCart(), { setItem: (k, v) => void store.set(k, v) });
    expect(loadCart({ getItem: (k) => store.get(k) ?? null })).toEqual(mockupCart());
  });

  it('opens an empty cart when the stored one is unreadable or storage fails', () => {
    for (const storage of [
      { getItem: () => '{"id":5,"lines":"x"}' },
      { getItem: () => { throw new Error('blocked'); } },
    ]) {
      const cart = loadCart(storage);
      expect(cart.lines).toEqual([]);
      expect(typeof cart.id).toBe('string');
    }
    expect(() => saveCart(mockupCart(), { setItem: () => { throw new Error('full'); } })).not.toThrow();
  });
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/cart` · Expected: FAIL.
- [ ] **Step 3: `cart.ts`'i yaz.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/pos/cart && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/pos` · `git commit -m "feat(pos): add the cart model with refresh and persistence"`

---

### Task 3: Diyalog ve bildirim

**Files:**
- **Create:** `src/design/Dialog.tsx`, `src/design/ToastRegion.tsx`, `src/design/useToast.ts`
- **Modify:** `src/design/index.ts`, `package.json` (`@radix-ui/react-dialog`)
- **Test:** `src/design/Dialog.test.tsx`, `src/design/Toast.test.tsx`

**Interfaces:**
- **Produces:**
  - `Dialog({ open, onOpenChange, title, description?, children }: { open: boolean; onOpenChange(open: boolean): void; title: string; description?: string; children: ReactNode })`: Radix modal diyalog; başlık erişilebilir ad; Esc, dış tıklama ve "Kapat" butonu `onOpenChange(false)`. Açıklama yoksa `aria-describedby={undefined}` (Radix uyarısı çıkmasın). Görünüm: yüzey zemin, `rounded-control`, en fazla 440 px, yarı saydam karartma, telefonda kenarlarda 16 px boşluk.
  - `useToast(durationMs = 4000): { message: string | null; show(message: string): void }`
  - `ToastRegion({ message }: { message: string | null })`: her zaman var olan `role="status"`, `aria-label="Bildirim"`, `aria-live="polite"` kapsayıcı; mesaj varsa içinde görünür. Alt ortada, `z-50`.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
// src/design/Dialog.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

describe('Dialog', () => {
  it('is named by its title and closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="Nakit ödeme"><p>İçerik</p></Dialog>);
    expect(screen.getByRole('dialog', { name: 'Nakit ödeme' })).toHaveTextContent('İçerik');
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes from its close button', async () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="Yeni ürün"><p>İçerik</p></Dialog>);
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

```tsx
// src/design/Toast.test.tsx
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastRegion } from './ToastRegion';
import { useToast } from './useToast';

afterEach(() => { vi.useRealTimers(); });

describe('toast', () => {
  it('shows a message and clears it after the duration', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(1000));
    act(() => result.current.show('Satış tamamlandı'));
    expect(result.current.message).toBe('Satış tamamlandı');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.message).toBeNull();
  });

  it('announces its message politely', () => {
    render(<ToastRegion message="Satış tamamlandı" />);
    expect(screen.getByRole('status', { name: 'Bildirim' })).toHaveTextContent('Satış tamamlandı');
  });
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm install @radix-ui/react-dialog && npm test -- src/design` · Expected: FAIL (yeni modüller yok).
- [ ] **Step 3: Bileşenleri yaz, `index.ts`'ten dışa aktar.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/design && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/design package.json package-lock.json` · `git commit -m "feat(design): add an accessible dialog and a toast region"`

---

### Task 4: Barkod okuyucu ve kısayollar

**Files:**
- **Create:** `src/pos/keyboard.ts`
- **Test:** `src/pos/keyboard.test.tsx`

**Interfaces:**
- **Produces:**
  - `createScanBuffer(options?: { maxGapMs?: number; minLength?: number }): { push(key: string, at: number): string | null }` (varsayılan 50 ve 4): `[0-9A-Za-z-]` tek karakterleri, öncekinden en fazla `maxGapMs` sonra geldiyse tampona ekler; daha geç gelen karakter tamponu onunla yeniden başlatır; başka tuşlar tamponu boşaltır. `Enter`: tampon `minLength`–32 uzunluktaysa kodu döndürür; her durumda boşaltır.
  - `looksLikeBarcode(text: string): boolean`: elle yazılmış metin için; `^[0-9A-Za-z-]{4,32}$` ve en az bir rakam.
  - `useBarcodeScanner(onScan: (code: string) => void, options?: { now?: () => number; maxGapMs?: number; minLength?: number })`: `window` üzerinde **yakalama aşamasında** `keydown`; Ctrl/Alt/Meta basılıysa yok sayar; her olayda `now()` (varsayılan `performance.now()`) bir kez okunur. Kod çıkınca: `preventDefault()` ve `stopPropagation()` (Enter odaktaki butonu tıklamasın, alanın kendi Enter işleyicisi çalışmasın), olay hedefi değeri kodla biten bir `<input>` ise kodu değerin sonundan siler (yerel `value` setter'ı ve kabarcıklanan `input` olayı: React `onChange` görür), sonra `onScan(code)`.
  - `useShortcuts(handlers: Partial<Record<'F1' | 'F2' | 'F4', () => void>>, enabled = true)`: `enabled` iken eşleşen tuşta `preventDefault()` ve işleyici.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
// src/pos/keyboard.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createScanBuffer, looksLikeBarcode, useBarcodeScanner, useShortcuts } from './keyboard';

function feed(buffer: ReturnType<typeof createScanBuffer>, keys: string[], start: number, gap: number) {
  let result: string | null = null;
  keys.forEach((key, index) => { result = buffer.push(key, start + index * gap) ?? result; });
  return result;
}

describe('createScanBuffer', () => {
  it('returns a fast burst ending in Enter as a code', () =>
    expect(feed(createScanBuffer(), [...'BRK-0042', 'Enter'], 0, 10)).toBe('BRK-0042'));

  it('ignores slow human typing', () =>
    expect(feed(createScanBuffer(), [...'8690', 'Enter'], 0, 200)).toBeNull());

  it('drops codes shorter than the minimum', () =>
    expect(feed(createScanBuffer(), [...'12', 'Enter'], 0, 5)).toBeNull());
});

describe('looksLikeBarcode', () => {
  it('needs barcode characters and at least one digit', () => {
    expect(['8690000000017', 'BRK-0042'].map(looksLikeBarcode)).toEqual([true, true]);
    expect(['süt', 'cola', '12'].map(looksLikeBarcode)).toEqual([false, false, false]);
  });
});

function fakeClock() {
  const clock = { t: 0, gap: 300, now: () => (clock.t += clock.gap) };
  return clock;
}

function Harness(props: { onScan(code: string): void; now(): number; onClick?(): void }): JSX.Element {
  const [value, setValue] = useState('');
  useBarcodeScanner(props.onScan, { now: props.now });
  return (
    <>
      <input aria-label="Ara" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button" onClick={props.onClick}>Artır</button>
    </>
  );
}

describe('useBarcodeScanner', () => {
  it('keeps a scan apart from letters typed slowly before it', async () => {
    const clock = fakeClock();
    const onScan = vi.fn();
    render(<Harness onScan={onScan} now={clock.now} />);
    const field = screen.getByLabelText('Ara');
    await userEvent.type(field, 'sü');
    clock.t += 1000;
    clock.gap = 5;
    await userEvent.type(field, '8690000000017{Enter}');
    expect(onScan).toHaveBeenCalledExactlyOnceWith('8690000000017');
    expect(field).toHaveValue('sü');
  });

  it('reads a scan while a button has focus without clicking it', async () => {
    const clock = fakeClock();
    clock.gap = 5;
    const onScan = vi.fn();
    const onClick = vi.fn();
    render(<Harness onScan={onScan} now={clock.now} onClick={onClick} />);
    screen.getByRole('button', { name: 'Artır' }).focus();
    await userEvent.keyboard('8690000000017{Enter}');
    expect(onScan).toHaveBeenCalledWith('8690000000017');
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('useShortcuts', () => {
  it('runs the handler for its key only while enabled', () => {
    const onCash = vi.fn();
    const Probe = ({ enabled }: { enabled: boolean }) => { useShortcuts({ F2: onCash }, enabled); return null; };
    const { rerender } = render(<Probe enabled />);
    fireEvent.keyDown(window, { key: 'F2' });
    rerender(<Probe enabled={false} />);
    fireEvent.keyDown(window, { key: 'F2' });
    expect(onCash).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/keyboard` · Expected: FAIL.
- [ ] **Step 3: `keyboard.ts`'i yaz.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/pos/keyboard && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/pos` · `git commit -m "feat(pos): capture barcode scanner bursts and F-key shortcuts"`

---

### Task 5: Ürün paneli

**Files:**
- **Create:** `src/pos/ProductPanel.tsx`, `src/test/renderWithData.tsx`
- **Modify:** `src/data/products.ts` (`listQuickProducts`), `src/design/TextField.tsx` (`ref`), `src/test/setup.ts`, `package.json` (`dexie-react-hooks` ^4.4.0)
- **Test:** `src/pos/ProductPanel.test.tsx`, `src/data/products.test.ts`, `src/design/TextField.test.tsx`

**Interfaces:**
- **Consumes:** Task 1 (`AppData`, `createAppData`, `DataProvider`, `useData`), Task 4 (`looksLikeBarcode`), `searchProducts`, `findProductByBarcode`, `formatTRY`, `TextField`, `Button`.
- **Produces:**
  - `listQuickProducts(db: MarketDb): Promise<ProductRecord[]>`: silinmemiş `isQuick` ürünler, ada göre (`tr`).
  - `TextField` `ref` prop'u alır ve `<input>`'a verir (React 19: `TextFieldProps` `ComponentProps<'input'>` tabanlı).
  - `createTestData(): AppData` (benzersiz `test-<uuid>` market, kayda alınır), `renderWithData(ui: ReactElement, data?: AppData): Promise<RenderResult & { data: AppData }>`, `disposeTestData(): Promise<void>` (kayıtlı veritabanlarını siler). `setup.ts`'teki tek `afterEach` sırayla: `cleanup()`, `await disposeTestData()`, `localStorage.clear()` (bileşenler kapanmadan veritabanı silinmesin).
  - `ProductPanel({ onAdd, onNewProduct, searchRef }: { onAdd(product: ProductRecord): void; onNewProduct(barcode?: string): void; searchRef?: Ref<HTMLInputElement> })`:
    - Arama alanı "Barkod veya ürün adı" (ipucu "Okuyucu ile okutun ya da yazmaya başlayın."), yanında "Yeni ürün" butonu → `onNewProduct()`.
    - Sorgu boşken hızlı ürünler, doluyken `searchProducts`; her ürün adı ve fiyatı yazan bir buton → `onAdd`. Sorgu dolu ve sonuç yoksa "Sonuç yok".
    - Alanda Enter (yalnızca elle yazım; okuyucu Enter'ı Task 4'te yakalanır): sorgu bir ürünün barkoduysa `onAdd` ve alan temizlenir; değilse ve `looksLikeBarcode` ise `onNewProduct(sorgu)` ve alan temizlenir; değilse bir şey olmaz.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
// src/pos/ProductPanel.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { renderWithData } from '@/test/renderWithData';
import { ProductPanel } from './ProductPanel';

const at = new Date('2026-10-29T09:00:00Z');
const milk = { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 } as const;

describe('ProductPanel', () => {
  it('finds a product by name and adds it on click', async () => {
    const onAdd = vi.fn();
    const { data } = await renderWithData(<ProductPanel onAdd={onAdd} onNewProduct={vi.fn()} />);
    const created = await createProduct(data.db, milk, at);
    await userEvent.type(screen.getByLabelText('Barkod veya ürün adı'), 'sut');
    await userEvent.click(await screen.findByRole('button', { name: /Süt.*₺42,50/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }));
  });

  it('shows quick products while the search is empty', async () => {
    const { data } = await renderWithData(<ProductPanel onAdd={vi.fn()} onNewProduct={vi.fn()} />);
    await createProduct(data.db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1, isQuick: true }, at);
    await createProduct(data.db, milk, at);
    expect(await screen.findByRole('button', { name: /Ekmek/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Süt/ })).not.toBeInTheDocument();
  });

  it('adds an exact barcode on Enter and clears the field', async () => {
    const onAdd = vi.fn();
    const { data } = await renderWithData(<ProductPanel onAdd={onAdd} onNewProduct={vi.fn()} />);
    await createProduct(data.db, milk, at);
    const field = screen.getByLabelText('Barkod veya ürün adı');
    await userEvent.type(field, '8690000000017{Enter}');
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(field).toHaveValue('');
  });

  it('offers a new product for an unknown barcode or from its button', async () => {
    const onNewProduct = vi.fn();
    await renderWithData(<ProductPanel onAdd={vi.fn()} onNewProduct={onNewProduct} />);
    await userEvent.type(screen.getByLabelText('Barkod veya ürün adı'), '8690000000099{Enter}');
    await vi.waitFor(() => expect(onNewProduct).toHaveBeenCalledWith('8690000000099'));
    await userEvent.click(screen.getByRole('button', { name: 'Yeni ürün' }));
    expect(onNewProduct).toHaveBeenLastCalledWith();
  });
});
```

`src/data/products.test.ts`'e `it('lists quick products by name, without deleted ones')`: "Simit" ve "Ayran" (`isQuick: true`) ile "Süt" (`isQuick: false`) oluştur, "Ayran"ı sil → `(await listQuickProducts(db)).map((p) => p.name)` `['Simit']`.

`src/design/TextField.test.tsx`'e `it('passes its ref to the input')`: `createRef<HTMLInputElement>()` ile render → `ref.current` `screen.getByLabelText(...)` ile aynı eleman.

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/ProductPanel src/data/products src/design/TextField` · Expected: FAIL.
- [ ] **Step 3: Yaz:** `npm install dexie-react-hooks@^4.4.0` (peer: dexie >=4.2 <5), `listQuickProducts`, `TextField` ref, `renderWithData.tsx`, `setup.ts`, `ProductPanel.tsx`.
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test && npm run lint && npm run typecheck` · Expected: PASS (bütün paket; `setup.ts` değişti).
- [ ] **Step 5: Commit** — `git add src package.json package-lock.json` · `git commit -m "feat(pos): add the product panel with search, quick products and barcode entry"`

---

### Task 6: Yeni ürün diyaloğu

**Files:**
- **Create:** `src/pos/NewProductDialog.tsx`
- **Test:** `src/pos/NewProductDialog.test.tsx`

**Interfaces:**
- **Consumes:** `Dialog` (Task 3), `renderWithData` (Task 5), `TextField`, `Button`, `parseTRY`, `createProduct`, `DuplicateBarcodeError`.
- **Produces:** `NewProductDialog({ open, barcode, onClose, onCreated }: { open: boolean; barcode?: string; onClose(): void; onCreated(product: ProductRecord): void })`:
  - Başlık "Yeni ürün"; barkod varsa "Barkod: {barkod}" metni.
  - "Ürün adı", "Satış fiyatı" (`parseTRY`), "KDV oranı" (radyo grubu: %0, %1, %10, %20; varsayılan %1), "Hızlı ürünlere ekle" onay kutusu (varsayılan: barkod yoksa işaretli).
  - "Kaydet ve sepete ekle": `createProduct` → `onCreated`. Boş ad → "Ürün adı gerekli."; okunamayan fiyat → "Geçerli bir tutar girin." (ikisi aynı anda gösterilebilir, ürün yazılmaz); `DuplicateBarcodeError` → "Bu barkod başka bir üründe kayıtlı."
  - Her açılışta boş başlar: çağıran, diyaloğu yalnızca açıkken bağlar (Task 9).

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
// src/pos/NewProductDialog.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct, findProductByBarcode } from '@/data/products';
import { renderWithData } from '@/test/renderWithData';
import { NewProductDialog } from './NewProductDialog';

async function fill(name: string, price: string) {
  if (name) await userEvent.type(screen.getByLabelText('Ürün adı'), name);
  await userEvent.type(screen.getByLabelText('Satış fiyatı'), price);
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve sepete ekle' }));
}

describe('NewProductDialog', () => {
  it('saves a product typed the Turkish way and hands it back', async () => {
    const onCreated = vi.fn();
    const { data } = await renderWithData(<NewProductDialog open barcode="8690000000099" onClose={vi.fn()} onCreated={onCreated} />);
    await fill('Kaşar Peyniri', '12,50');
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(await findProductByBarcode(data.db, '8690000000099')).toMatchObject({ name: 'Kaşar Peyniri', sellPrice: 1250, vatRate: 1, isQuick: false });
  });

  it('adds a barcodeless product as a quick product', async () => {
    const onCreated = vi.fn();
    const { data } = await renderWithData(<NewProductDialog open onClose={vi.fn()} onCreated={onCreated} />);
    await fill('Ekmek', '15');
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [bread] = await data.db.products.toArray();
    expect(bread).toMatchObject({ name: 'Ekmek', sellPrice: 1500, isQuick: true });
    expect(bread?.barcode).toBeUndefined();
  });

  it('explains what is missing and writes nothing', async () => {
    const { data } = await renderWithData(<NewProductDialog open barcode="8690000000099" onClose={vi.fn()} onCreated={vi.fn()} />);
    await fill('', 'abc');
    expect(await screen.findByText('Ürün adı gerekli.')).toBeInTheDocument();
    expect(screen.getByText('Geçerli bir tutar girin.')).toBeInTheDocument();
    expect(await data.db.products.count()).toBe(0);
  });

  it('refuses a barcode that is already in use', async () => {
    const onCreated = vi.fn();
    const { data } = await renderWithData(<NewProductDialog open barcode="8690000000017" onClose={vi.fn()} onCreated={onCreated} />);
    await createProduct(data.db, { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 }, new Date());
    await fill('Ayran', '20');
    expect(await screen.findByText('Bu barkod başka bir üründe kayıtlı.')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/NewProductDialog` · Expected: FAIL.
- [ ] **Step 3: Diyaloğu yaz.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/pos/NewProductDialog && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/pos` · `git commit -m "feat(pos): add products at the register, with or without a barcode"`

---

### Task 7: Sepet paneli

**Files:**
- **Create:** `src/pos/CartPanel.tsx`
- **Test:** `src/pos/CartPanel.test.tsx`

**Interfaces:**
- **Consumes:** Task 2 (`Cart`, `CartAction`, `cartTotals`), `Button`, `formatTRY`, `PaymentMethod`.
- **Produces:** `CartPanel({ cart, dispatch, onPay }: { cart: Cart; dispatch(action: CartAction): void; onPay(method: PaymentMethod): void })`:
  - Başlık "Sepet" ve "{satır sayısı} kalem"; boşken "Sepet boş" ve "Barkod okutun ya da ürün seçin."
  - Satır: ad, "{adet} × {birim fiyat}" (adet `qtyMilli / 1000`, `tr-TR`), satır tutarı; "Azalt" ve "Artır" (ikon butonlar, `aria-label`, 44 px); "Sepeti temizle" (ikon, `aria-label`).
  - Toplamlar: "Ara toplam" (`total − vatTotal`, `data-testid="net"`), "KDV" (`"vat"`), "Toplam" (`"total"`, büyük, mono rakam).
  - "Nakit" (`kbd="F2"`, primary, lg), "Kart" (`kbd="F4"`), "Veresiye"; sepet boşken pasif.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
// src/pos/CartPanel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProductRecord } from '@/data/types';
import { cartReducer, emptyCart, type Cart } from './cart';
import { CartPanel } from './CartPanel';

const p = (id: string, name: string, sellPrice: number): ProductRecord => ({
  id, name, sellPrice, vatRate: 1, unit: 'piece', buyPrice: 0, isQuick: false,
  criticalLevelMilli: 0, createdAt: '', updatedAt: '',
});
function mockupCart(): Cart {
  const e = p('e', 'Ekmek', 1500), a = p('a', 'Ayran', 2250);
  let cart = emptyCart('c');
  for (const product of [e, e, a, a, a, p('b', 'Beyaz Peynir', 18990), p('c', 'Siyah Çay', 27900)]) {
    cart = cartReducer(cart, { type: 'add', product });
  }
  return cart;
}

describe('CartPanel', () => {
  it('shows the mockup cart totals', () => {
    render(<CartPanel cart={mockupCart()} dispatch={vi.fn()} onPay={vi.fn()} />);
    expect(screen.getByText('4 kalem')).toBeInTheDocument();
    expect(screen.getByText('2 × ₺15,00')).toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('₺566,40');
    expect(screen.getByTestId('vat')).toHaveTextContent('₺5,61');
    expect(screen.getByTestId('net')).toHaveTextContent('₺560,79');
  });

  it('changes quantities, clears and starts payments', async () => {
    const dispatch = vi.fn();
    const onPay = vi.fn();
    render(<CartPanel cart={mockupCart()} dispatch={dispatch} onPay={onPay} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Artır' })[0]!);
    expect(dispatch).toHaveBeenCalledWith({ type: 'increment', productId: 'e' });
    await userEvent.click(screen.getByRole('button', { name: 'Sepeti temizle' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'clear' });
    await userEvent.click(screen.getByRole('button', { name: 'Kart' }));
    expect(onPay).toHaveBeenCalledWith('card');
  });

  it('disables payment for an empty cart', () => {
    render(<CartPanel cart={emptyCart('c')} dispatch={vi.fn()} onPay={vi.fn()} />);
    expect(screen.getByText('Sepet boş')).toBeInTheDocument();
    for (const name of ['Nakit', 'Kart', 'Veresiye']) expect(screen.getByRole('button', { name })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/CartPanel` · Expected: FAIL.
- [ ] **Step 3: `CartPanel.tsx`'i yaz** (ikonlar `lucide-react`: `Minus`, `Plus`, `Trash2`).
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/pos/CartPanel && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/pos` · `git commit -m "feat(pos): add the cart panel with totals and payment buttons"`

---

### Task 8: Ödeme

**Files:**
- **Create:** `src/pos/checkout.ts`, `src/pos/PaymentDialog.tsx`, `src/pos/CustomerPicker.tsx`
- **Test:** `src/pos/checkout.test.ts`, `src/pos/PaymentDialog.test.tsx`, `src/pos/CustomerPicker.test.tsx`

**Interfaces:**
- **Consumes:** `recordSale`, `createCustomer`, `searchCustomers`, `customerBalance`, `CreditLimitError`, `PaymentMismatchError` (M1a); Task 2, 3, 5.
- **Produces:**
  - `checkout(db: MarketDb, input: { cart: Cart; deviceCode: string; method: PaymentMethod; customerId?: string; cashGiven?: Kurus; at: Date }): Promise<SaleRecord>`: `recordSale`'i `id: cart.id`, satırlar (`productId`, `qtyMilli`) ve tek ödemeyle (`amount: cartTotals(cart).total`) çağırır; `cashGiven` yalnızca nakitte, `customerId` yalnızca veresiyede.
  - `checkoutErrorMessage(error: unknown): string`: `CreditLimitError` → "Müşterinin veresiye limiti aşılıyor."; `PaymentMismatchError` → "Tutar değişti, toplamı kontrol edip yeniden deneyin."; diğerleri → "Satış kaydedilemedi."
  - `suggestCash(total: Kurus): Kurus[]`: ₺10, ₺50, ₺100 ve ₺500 adımlarında toplamın üstündeki ilk yuvarlak tutarlar; toplamdan büyük olanlar, tekrarsız, artan.
  - `PaymentDialog({ open, method, total, busy, onClose, onConfirm }: { open: boolean; method: 'cash' | 'card'; total: Kurus; busy?: boolean; onClose(): void; onConfirm(cashGiven?: Kurus): void })`:
    - Nakit: başlık "Nakit ödeme"; toplam; "Alınan tutar" (`parseTRY`; boş = tam tutar); `suggestCash` butonları (`formatTRY`); alınan ≥ toplamsa "Para üstü" (`data-testid="change"`); "Satışı tamamla" alınan < toplam, tutar okunamıyor ya da `busy` iken pasif; `onConfirm(alınan ?? toplam)`. Alanda Enter da tamamlar.
    - Kart: başlık "Kart ile ödeme"; toplam; "Satışı tamamla" → `onConfirm()`.
  - `CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose(): void; onPick(customer: CustomerRecord): void })`: başlık "Veresiye müşterisi"; "Müşteri ara"; sonuçlar ad ve bakiye (`formatTRY`) yazan butonlar; "Yeni müşteri" → "Müşteri adı" alanı ve "Ekle" (`createCustomer` → `onPick`).

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/pos/checkout.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomer } from '@/data/customers';
import type { MarketDb } from '@/data/db';
import { CreditLimitError, PaymentMismatchError } from '@/data/errors';
import { createProduct, updateProduct } from '@/data/products';
import type { ProductRecord } from '@/data/types';
import { makeTestDb } from '@/test/db';
import { cartReducer, emptyCart, type Cart } from './cart';
import { checkout, checkoutErrorMessage, suggestCash } from './checkout';

let db: MarketDb;
let milk: ProductRecord;
let cart: Cart;
const at = new Date('2026-10-29T09:00:00Z');
beforeEach(async () => {
  db = makeTestDb();
  milk = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
  cart = cartReducer(emptyCart('01a181bc-da80-7001-8203-040506070809'), { type: 'add', product: milk });
});
afterEach(async () => { await db.delete(); });

describe('checkout', () => {
  it('records one sale per cart however often it is checked out', async () => {
    const first = await checkout(db, { cart, deviceCode: 'K1', method: 'cash', cashGiven: 5000, at });
    const again = await checkout(db, { cart, deviceCode: 'K1', method: 'cash', cashGiven: 5000, at });
    expect(first).toMatchObject({ id: cart.id, total: 4250, change: 750, receiptNo: 'K1-20261029-0001' });
    expect(again.id).toBe(first.id);
    expect(await db.sales.count()).toBe(1);
  });

  it('explains a credit limit refusal', async () => {
    const customer = await createCustomer(db, { name: 'Ahmet', creditLimit: 1000 }, at);
    const error = await checkout(db, { cart, deviceCode: 'K1', method: 'credit', customerId: customer.id, at }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CreditLimitError);
    expect(checkoutErrorMessage(error)).toBe('Müşterinin veresiye limiti aşılıyor.');
  });

  it('explains a total that changed under the cart', async () => {
    await updateProduct(db, milk.id, { sellPrice: 4500 }, at);
    const error = await checkout(db, { cart, deviceCode: 'K1', method: 'card', at }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentMismatchError);
    expect(checkoutErrorMessage(error)).toBe('Tutar değişti, toplamı kontrol edip yeniden deneyin.');
  });
});

describe('suggestCash', () => {
  it('suggests round amounts above the total', () => {
    expect(suggestCash(56640)).toEqual([57000, 60000, 100000]);
    expect(suggestCash(4250)).toEqual([5000, 10000, 50000]);
    expect(suggestCash(5000)).toEqual([10000, 50000]);
  });
});
```

```tsx
// src/pos/PaymentDialog.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaymentDialog } from './PaymentDialog';

const cash = (onConfirm = vi.fn()) =>
  render(<PaymentDialog open method="cash" total={56640} onClose={vi.fn()} onConfirm={onConfirm} />);

describe('PaymentDialog', () => {
  it('shows the change and confirms the amount given', async () => {
    const onConfirm = vi.fn();
    cash(onConfirm);
    await userEvent.type(screen.getByLabelText('Alınan tutar'), '600');
    expect(screen.getByTestId('change')).toHaveTextContent('₺33,60');
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    expect(onConfirm).toHaveBeenCalledWith(60000);
  });

  it('cannot complete with less than the total', async () => {
    cash();
    await userEvent.type(screen.getByLabelText('Alınan tutar'), '500');
    expect(screen.getByRole('button', { name: 'Satışı tamamla' })).toBeDisabled();
  });

  it('takes the exact total when nothing is typed, or typed with kuruş', async () => {
    const onConfirm = vi.fn();
    cash(onConfirm);
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    await userEvent.type(screen.getByLabelText('Alınan tutar'), '566,40{Enter}');
    expect(onConfirm.mock.calls).toEqual([[56640], [56640]]);
  });

  it('fills a suggested amount', async () => {
    cash();
    await userEvent.click(screen.getByRole('button', { name: '₺600,00' }));
    expect(screen.getByTestId('change')).toHaveTextContent('₺33,60');
  });

  it('confirms a card payment of the total', async () => {
    const onConfirm = vi.fn();
    render(<PaymentDialog open method="card" total={56640} onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole('dialog', { name: 'Kart ile ödeme' })).toHaveTextContent('₺566,40');
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    expect(onConfirm).toHaveBeenCalledWith();
  });
});
```

```tsx
// src/pos/CustomerPicker.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCustomer } from '@/data/customers';
import { renderWithData } from '@/test/renderWithData';
import { CustomerPicker } from './CustomerPicker';

describe('CustomerPicker', () => {
  it('finds and picks a customer, showing the balance', async () => {
    const onPick = vi.fn();
    const { data } = await renderWithData(<CustomerPicker open onClose={vi.fn()} onPick={onPick} />);
    const customer = await createCustomer(data.db, { name: 'Ahmet Yılmaz' }, new Date());
    await userEvent.type(screen.getByLabelText('Müşteri ara'), 'yilmaz');
    await userEvent.click(await screen.findByRole('button', { name: /Ahmet Yılmaz.*₺0,00/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: customer.id }));
  });

  it('adds a new customer inline', async () => {
    const onPick = vi.fn();
    await renderWithData(<CustomerPicker open onClose={vi.fn()} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Yeni müşteri' }));
    await userEvent.type(screen.getByLabelText('Müşteri adı'), 'Fatma Teyze');
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fatma Teyze' })));
  });
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/checkout src/pos/PaymentDialog src/pos/CustomerPicker` · Expected: FAIL.
- [ ] **Step 3: Modülleri yaz.**
- [ ] **Step 4: Geçtiğini gör** — Run: `npm test -- src/pos && npm run lint && npm run typecheck` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/pos` · `git commit -m "feat(pos): add checkout with cash, card and credit payments"`

---

### Task 9: Kasa ekranı ve uygulama bağlantısı

**Files:**
- **Create:** `src/pos/PosScreen.tsx`
- **Modify:** `src/app/App.tsx`, `src/app/AppShell.tsx`, `src/app/App.test.tsx`, `src/app/AppShell.test.tsx`
- **Test:** `src/pos/PosScreen.test.tsx`

**Interfaces:**
- **Consumes:** Task 1–8, `AppShell`, `findProductByBarcode`.
- **Produces:**
  - `AppShell`: `SyncState` artık `@/sync/runner`'dan (`'error'` → "Eşitleme hatası", tehlike rengi); `staffName` isteğe bağlı (yoksa gösterilmez).
  - `PosScreen()`: `AppShell` (pazar ve cihaz adı `settings`'ten, rozet `useSyncStatus`) içinde sol tarafta `ProductPanel`, `cart` yuvasında `CartPanel`, en altta `ToastRegion`.
    - Sepet: `useReducer(cartReducer, undefined, () => loadCart())`, her değişiklikte `saveCart`; sepetteki ürünler `useLiveQuery(() => db.products.bulkGet(ids))` ile izlenir ve `refresh` gönderilir.
    - Tek açık diyalog durumu: `{ kind: 'cash' | 'card' } | { kind: 'credit' } | { kind: 'newProduct'; barcode?: string } | null`; diyaloglar yalnızca açıkken bağlanır.
    - Okuyucu (`useBarcodeScanner`) her zaman açık: diyalog açıksa kodu kullanmaz, "Önce açık pencereyi kapatın." bildirir; değilse ürün varsa sepete, yoksa yeni ürün diyaloğu o barkodla.
    - Kısayollar (`useShortcuts`, diyalog yokken): F1 aramaya odaklanır; F2 nakit, F4 kart (sepet doluysa).
    - Ödeme başarılı: sepet temizlenir, diyalog kapanır, "Satış tamamlandı · {fiş no}" bildirilir, `runner.run()`. Hata: `checkoutErrorMessage` bildirilir, sepet ve diyalog kalır. Ödeme sürerken `busy`.
  - `App()`: `useState(() => createAppData(loadDeviceSettings()))`; efektte `runner.start()` ve bir `run()`, temizlikte `runner.stop()`; `DataProvider` içinde `PosScreen`.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
// src/pos/PosScreen.test.tsx
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct, updateProduct } from '@/data/products';
import { recentSales } from '@/data/sales';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { PosScreen } from './PosScreen';

const milk = { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 } as const;

function scan(code: string) {
  for (const key of [...code, 'Enter']) fireEvent.keyDown(window, { key });
}

describe('PosScreen', () => {
  it('sells a scanned product for cash', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    expect(await screen.findByText('1 kalem')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F2' });
    await userEvent.type(await screen.findByLabelText('Alınan tutar'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Satışı tamamla' }));
    expect(await screen.findByRole('status', { name: 'Bildirim' })).toHaveTextContent(/Satış tamamlandı · K1-\d{8}-0001/);
    expect(await recentSales(data.db)).toHaveLength(1);
    expect(screen.getByText('Sepet boş')).toBeInTheDocument();
  });

  it('adds an unknown scanned barcode through the new product dialog', async () => {
    await renderWithData(<PosScreen />);
    scan('8690000000099');
    await userEvent.type(await screen.findByLabelText('Ürün adı'), 'Kaşar');
    await userEvent.type(screen.getByLabelText('Satış fiyatı'), '120');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve sepete ekle' }));
    expect(await screen.findByText('1 kalem')).toBeInTheDocument();
  });

  it('sells on credit to a picked customer', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await userEvent.click(await screen.findByRole('button', { name: 'Veresiye' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni müşteri' }));
    await userEvent.type(screen.getByLabelText('Müşteri adı'), 'Ahmet');
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    expect(await screen.findByText(/Satış tamamlandı/)).toBeInTheDocument();
    expect((await recentSales(data.db))[0]?.payments).toEqual([{ method: 'credit', amount: 4250 }]);
  });

  it('follows a price changed elsewhere', async () => {
    const { data } = await renderWithData(<PosScreen />);
    const created = await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    await updateProduct(data.db, created.id, { sellPrice: 5000 }, new Date());
    await vi.waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('₺50,00'));
  });

  it('ignores a scan while a payment dialog is open', async () => {
    const { data } = await renderWithData(<PosScreen />);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    fireEvent.keyDown(window, { key: 'F2' });
    await screen.findByRole('dialog', { name: 'Nakit ödeme' });
    scan(milk.barcode);
    expect(await screen.findByText('Önce açık pencereyi kapatın.')).toBeInTheDocument();
    expect(screen.getByText('1 × ₺42,50')).toBeInTheDocument();
  });

  it('keeps the cart after a reload', async () => {
    const data = createTestData();
    const first = await renderWithData(<PosScreen />, data);
    await createProduct(data.db, milk, new Date());
    scan(milk.barcode);
    await screen.findByText('1 kalem');
    first.unmount();
    await renderWithData(<PosScreen />, data);
    expect(await screen.findByText('1 kalem')).toBeInTheDocument();
  });
});
```

`src/app/AppShell.test.tsx`: durum tablosuna `['error', undefined, 'Eşitleme hatası']`; `it('hides the staff name when there is none')`. `src/app/App.test.tsx`: mevcut testin yanına `it("shows the sync runner's state in the shell")`: `render(<App />)` → `await screen.findByText('Çevrimdışı')`.

- [ ] **Step 2: Başarısız olduğunu gör** — Run: `npm test -- src/pos/PosScreen src/app` · Expected: FAIL.
- [ ] **Step 3: `PosScreen.tsx`'i yaz; `App` ve `AppShell`'i güncelle.**
- [ ] **Step 4: Bütün kontroller** — Run: `npm run lint && npm run typecheck && npm test && npm run build` · Expected: PASS.
- [ ] **Step 5: Gözle kontrol** — production build'i `kasa-preview` ile aç; 1366 × 768 ve 375 × 812'de: barkodsuz hızlı ürün ekle (Yeni ürün), adla ara ve ekle, F2 ile nakit sat (para üstü), Kart ile sat, Veresiye ile yeni müşteriye sat, sayfayı yenileyip sepetin kaldığını gör. Düzen taslağın 1. panosuyla tutarlı, yatay kaydırma yok, dokunma hedefleri ≥ 44 px.
- [ ] **Step 6: Commit** — `git add src` · `git commit -m "feat(pos): wire the first working register into the app"`

## Uygulama notları (2026-10-29)

Commit'ler `a4bd185`…`78bcbf8`. Son inceleme: 1 kritik, 4 önemli (düzeltildi), 10 küçük bulgu ertelendi. CI'da bir test kararsız çıktı; nedeni gerçek bir zamanlama hatasıydı, düzeltildi.

**Verilen kararlar:**
- TextField'in `ref`'i ve AppShell'in isteğe bağlı `staffName`'i çalışma anında zaten çalışıyordu; başarısız kontrol tip denetimiydi.
- Button'a 44 px kare `icon` boyutu eklendi.
- Plandaki nakit satış testi, her zaman var olan bildirim bölgesini bulunca hemen geçiyordu; artık bildirim metnini bekliyor.
- Eşitleme koşucusu hiçbir hatada reddetmiyor, hatayı durum olarak bildiriyor.
- F tuşu ve okuyucu işleyicileri ekran güncellenirken (layout effect) yenileniyor; CI'daki kararsız testin nedeni buydu.
- Okuyucu: Shift gibi değiştirici tuşlar yok sayılıyor; iki ya da daha çok hızlı tuştan sonra gelen Enter, kod çıkmasa da yutuluyor; kart onay butonu odak almıyor (F4 sonra Enter artık satmıyor).
- Sepet kimliği daha önce başka satırlarla satılmışsa satış reddediliyor ve sepet yeni kimlik alıyor. Karşılaştırma fiyatlara değil satırlara (ürün, miktar) bakıyor. Başka sekmenin kaydettiği sepet bu sekmedekinin yerine geçiyor.
- Yeni veresiye müşterisi bir kez oluşturuluyor; çift tıklama ya da tekrar deneme aynısını kullanıyor.
- Birim fiyat üst sınırı ₺1.000.000,00 (ürün deposu ve yeni ürün penceresi). Toplanamayan kayıtlı sepet atılıyor. Hata sınırı boş ekran yerine "Sepeti temizle ve yeniden başlat" sunuyor.
- Sepete girdikten sonra silinen ürün satılabiliyor (DESIGN §7); yalnız hiç olmayan ürün reddediliyor. M1a kuralı bu yönde değişti.
- Kapsam dışı bırakılanlar: okuyucu ayarı (klavye düzeni, önek, Tab sonu), 50 ms eşiği (§15), büyük/küçük harfe duyarlı barkod (M1a), IndexedDB erişilemezliği, eşitleme yeniden deneme (M0b), ölü menü bağlantıları (M3+), limit aşım onayı (M6).

**Ertelenen küçük bulgular:**
- Okuyucu zamanı işleyicide `performance.now()` ile ölçülüyor; 50 ms'yi aşan bir donma taramayı bölebilir. "Alınan tutar" için üst sınır yok.
- Yalnız ₺0,00'lık ürün içeren sepet satılamıyor.
- Satıştan sonra odak sayfada kalıyor; arama alanına dönmeli.
- İmleç metnin ortasındayken okutulan kod alanda kalıyor.
- Eşitleme rozeti ilk turdan önce "0 işlem bekliyor" gösteriyor; çevrimdışıyken bekleyen işlem sayısını göstermiyor (§15).
- Açık ödeme penceresinin toplamı sepet yenilenince sessizce değişiyor; müşteri seçiminde toplam görünmüyor ve borç tek dokunuşta yazılıyor.
- Hata bildirimleri 4 saniyede kayboluyor; aynı mesaj ikinci kez gösterilmiyor.
- IndexedDB hataları (okutma, arama Enter'ı, "Ekle") mesaj göstermiyor.
- "5lt", "cola1L" gibi aramalar barkod sanılıyor ve Enter yeni ürün penceresini açıyor.
- "Sepeti temizle" geri alınamıyor; satırların Azalt/Artır etiketleri aynı; F1 için ekranda ipucu yok; pencere açıkken F1 Chrome yardımını açıyor.
