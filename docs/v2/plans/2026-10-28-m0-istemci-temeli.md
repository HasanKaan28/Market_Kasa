# Market Kasa v2 · M0 İstemci Temeli ve Domain Çekirdeği — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kurulacak her şey için şu üç parçayı hazırlamak: v1 kodunun yerini alan TypeScript iskeleti, "sade ve profesyonel" tasarım token'ları ve testlerle sabitlenmiş para/KDV/fiş/defter kuralları.

**Architecture:** Tek paketli Vite + React 19 uygulaması. İş kuralları `src/domain/` altında, React'e ve tarayıcıya bağımlı olmayan saf TypeScript fonksiyonlarıdır. Arayüz parçaları `src/design/` altında, Tailwind 4 `@theme` token'larıyla yazılır. Sürüm numarası yalnızca `package.json`'dan gelir.

**Tech Stack:** TypeScript (strict), React 19, Vite, Tailwind CSS 4, Vitest + Testing Library + jsdom, ESLint 9 (flat config) + Prettier, GitHub Actions (Node 24).

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md). Özellikle §9 (para, KDV, tarih), §6.4 (türetilen değerler), §7.6 (fiş no), §13 (tasarım), §16 (CI).

## Global Constraints

- **Para:** Kuruş cinsinden tamsayı (`Kurus = number`, `Number.isSafeInteger`). Saklanan veya hesaplanan hiçbir tutar float olmaz.
- **KDV:** Oranlar yalnızca `0, 1, 10, 20`. Fiyatlar KDV dahildir.
- **Yuvarlama:**
  - Kuruşa, yarım değerler sıfırdan uzağa yuvarlanır (iadede simetrik).
  - Satır bazında yuvarlanır; toplamlar yuvarlanmış satırların toplamıdır.
  - Sepet indirimi en büyük kalan yöntemiyle dağıtılır; eşitlikte önce gelen satır kazanır.
- **Miktar:** Bin'de bir birim tamsayı (`qtyMilli`, 1 adet = 1000).
- **İş günü:** `Europe/Istanbul`; gün dönümü dakikası ayarlanabilir, varsayılan 0.
- **Fiş numarası:** `K1-20261028-0042` biçiminde: cihaz kodu `^[A-Z][A-Z0-9]{0,3}$`, iş günü `YYYYMMDD`, en az 4 haneye doldurulmuş sıra.
- **Sürüm:** `2.0.0-alpha.0`, yalnızca `package.json`'da yazılır; arayüze `__APP_VERSION__` ile girer.
- **Arayüz (K12):**
  - Metinler Türkçe; kod tanımlayıcıları İngilizce.
  - En küçük metin 14 px (kısayol etiketleri 12 px). Dokunma hedefi en az 44 px. WCAG AA kontrast.
  - Yakınlaştırma serbest: `user-scalable=no` yasak.
- **Node ≥ 24.** README dosyaları İngilizce.

## Review Focus

1. **İade tutarları (negatif):** KDV ve yuvarlama simetrik olmalı. `vatIncluded(-3000, 1)` sonucu `-30` olmalı, `-29` değil. → Task 4
2. **İmkânsız indirim:** Ara toplamdan büyük ya da negatif indirim ve boş sepete indirim sessizce yanlış toplam üretmemeli, `RangeError` atmalı. → Task 4
3. **Türkçe tutar yazımı:** `1.234,50`, `12.50`, `1.250`, `15 TL` doğru okunmalı; `1,234` ve `-5` reddedilmeli. → Task 3
4. **İstanbul'da gece yarısı:** 21:00 UTC sınırında ve gün dönümü dakikası verildiğinde satış doğru iş gününe düşmeli. → Task 5
5. **Fiş sırası:** Günde 9999'u geçen satışta numara bozulmamalı (`…-10000`). Yeni iş gününde sıra 1'den başlamalı. → Task 5

## Bu planın dışında

Her biri kendi planıyla gelir:
- **M0b:** Supabase şeması, RLS, Auth ve eşitleme fonksiyonları.
- **M1:** Dexie veri katmanı ve eşitleme motoru.
- **M2:** Kasa ekranları ve koyu tema değerleri.
- **M8:** Electron/Capacitor paketleme; eski `android-apk.yml` iş akışının değiştirilmesi. Bu iş akışı `v*` etiketlerinde de çalışıyor; v2 sürüm etiketi atılmadan önce değiştirilmeli.

---

### Task 1: v2 iskeleti ve tek kaynaklı sürüm

**Files:**
- **Delete:** `src/` (v1 kodunun tamamı), `server.js`, `public/sw.js`, `.env.example`, `vite.config.js`
- **Modify:** `package.json`, `index.html`, `.gitignore`
- **Create:**
  - Yapılandırma: `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`
  - Kaynak: `src/vite-env.d.ts`, `src/main.tsx`, `src/app/App.tsx`, `src/app/app.css`, `src/app/version.ts`, `src/test/setup.ts`
- **Test:** `src/app/version.test.ts`, `src/app/App.test.tsx`

**Interfaces:**
- **Produces:**
  - `APP_VERSION: string` (`src/app/version.ts`) ve global `__APP_VERSION__: string` (Vite `define`).
  - `@/*` takma adı, `src/*` dizinine çözülür (hem `tsconfig.json` `paths` hem Vite `resolve.alias`).
  - npm script'leri: `dev`, `build`, `preview`, `lint`, `typecheck`, `test`, `test:watch`, `format`.

- [ ] **Step 1: v1 kaynaklarını kaldır ve bağımlılıkları düzenle**

```bash
git rm -r src server.js public/sw.js .env.example vite.config.js
npm uninstall canvas-confetti html5-qrcode jspdf ws @vitejs/plugin-basic-ssl electron-packager
npm install -D typescript @types/node @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals prettier eslint-config-prettier
```

`package.json` düzenlemesi:
- `"version": "2.0.0-alpha.0"` ve `"engines": { "node": ">=24" }` olur.
- Eklenen script'ler:
  - `dev` = `vite`
  - `build` = `npm run typecheck && vite build`
  - `preview` = `vite preview`
  - `lint` = `eslint .`
  - `typecheck` = `tsc --noEmit`
  - `test` = `vitest run`
  - `test:watch` = `vitest`
  - `format` = `prettier --write .`
- Kaldırılan script'ler: `electron:pack`, `sync:server`.
- Dokunulmayan script'ler (M8'e kadar): `electron:start`, `electron:installer`, `cap:sync`, `cap:open`.
- `dexie`, `dexie-react-hooks`, `lucide-react` ve `@capacitor/*` bağımlılıkları kalır.

- [ ] **Step 2: Başarısız testleri yaz**

```ts
// src/app/version.test.ts
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { APP_VERSION } from './version';

describe('APP_VERSION', () => {
  it('comes from package.json only', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toBe('2.0.0-alpha.0');
  });
});
```

```tsx
// src/app/App.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the main landmark', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Testlerin başarısız olduğunu gör**

Run: `npm test`
Expected: FAIL. `./version` ve `./App` modülleri bulunamaz.

- [ ] **Step 4: İskeleti kur**

- **`vite.config.ts`:**
  - `defineConfig` 'vitest/config' paketinden alınır.
  - Eklentiler: `react()` ve `tailwindcss()`.
  - `base: './'` (Electron `file://` yüklemesi için).
  - `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` (`pkg` doğrudan `./package.json`'dan import edilir).
  - `resolve.alias` içinde `'@'` → `fileURLToPath(new URL('./src', import.meta.url))`.
  - `test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] }`.
- **`tsconfig.json`:**
  - Dil ve modül: `strict`, `noUncheckedIndexedAccess`, `target`/`lib` ES2022 + DOM, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`.
  - Diğer ayarlar: `resolveJsonModule`, `noEmit`, `skipLibCheck`, `paths: { "@/*": ["src/*"] }`.
  - `include: ["src", "vite.config.ts"]`, `types: ["node", "vite/client"]`.
- **`src/vite-env.d.ts`:** `/// <reference types="vite/client" />` ve `declare const __APP_VERSION__: string;`.
- **`src/app/version.ts`:** `export const APP_VERSION: string = __APP_VERSION__;`.
- **`src/test/setup.ts`:** `import '@testing-library/jest-dom/vitest';`.
- **`src/app/App.tsx`:** `export function App(): JSX.Element` bir `<main>` ve içinde `<h1>Market Kasa</h1>` döndürür. Task 8 bunu kabukla değiştirir.
- **`src/app/app.css`:** `@import "tailwindcss";`.
- **`src/main.tsx`:** `createRoot(...).render(<StrictMode><App /></StrictMode>)` çağırır ve `./app/app.css`'i import eder.
- **`index.html`:**
  - `<html lang="tr">` ve `<title>Market Kasa</title>`.
  - `<meta name="viewport" content="width=device-width, initial-scale=1">`; zoom kilidi kaldırılır.
  - Script `/src/main.tsx`.
- **`eslint.config.js`:** `@eslint/js` recommended, `typescript-eslint` recommended, react-hooks ve react-refresh, sonra `eslint-config-prettier`. `ignores`: `dist`, `android`, `electron`, `coverage`, `.codebase-memory`, `create_shortcut.cjs`.
- **`.prettierrc.json`:** `{ "singleQuote": true, "printWidth": 100 }`.
- **`.gitignore`:** `coverage/` ve `.playwright-mcp/` eklenir.

- [ ] **Step 5: Bütün kontrolleri çalıştır**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: Dört komut da hatasız biter; `dist/index.html` oluşur.

- [ ] **Step 6: Commit**

Silinen dosyalar Step 1'deki `git rm` ile zaten hazırlandı. Takip edilmeyen `.codebase-memory/` klasörü commit'e girmemeli, bu yüzden yollar tek tek eklenir:

```bash
git add package.json package-lock.json index.html .gitignore vite.config.ts tsconfig.json eslint.config.js .prettierrc.json src docs/v2
git commit -m "feat(v2): scaffold TypeScript app and remove v1 sources"
```

---

### Task 2: Tasarım token'ları ve temel bileşenler (K12: sade ve profesyonel)

**Files:**
- **Create:** `src/design/tokens.css`, `src/design/Kbd.tsx`, `src/design/Button.tsx`, `src/design/TextField.tsx`, `src/design/index.ts`
- **Modify:**
  - `src/app/app.css`: `@import "../design/tokens.css";`
  - `src/main.tsx`: font import'ları
  - `package.json`: `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`
- **Test:** `src/design/Button.test.tsx`, `src/design/TextField.test.tsx`

**Interfaces:**
- **Produces:**
  - **Tailwind 4 `@theme` token'ları (`tokens.css`):**
    - Renkler: `--color-bg: #F5F6F8`, `--color-surface: #FFFFFF`, `--color-line: #E2E5EA`, `--color-line-strong: #CDD2DA`, `--color-text: #12151A`, `--color-text-2: #4A5260`, `--color-muted: #5B6472`.
    - Vurgu ve durum renkleri: `--color-accent: #2350D8`, `--color-accent-hover: #1A3FAE`, `--color-success: #0F6B49`, `--color-success-bg: #E8F6EF`, `--color-danger: #B42318`, `--color-danger-bg: #FDECEA`.
    - Köşe: `--radius-control: 8px`, `--radius-chip: 6px`.
    - Yazı tipi: `--font-sans: 'IBM Plex Sans', system-ui, sans-serif`, `--font-mono: 'IBM Plex Mono', ui-monospace, monospace`.
    - Bu token'lar `bg-surface`, `text-muted`, `border-line`, `rounded-control` gibi sınıfları üretir. Gövde `bg-bg text-text font-sans`, rakamlar `tabular-nums`.
  - **`Kbd({ children }: { children: ReactNode }): JSX.Element`:** `<kbd>`, mono, 12 px, `rounded-chip`.
  - **`Button(props: ButtonProps): JSX.Element`:**
    - Tip: `ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'lg'; kbd?: string; icon?: ReactNode }`.
    - Varsayılanlar: `variant='secondary'`, `size='md'`, `type='button'`.
    - Yükseklik: `md` en az 44 px, `lg` en az 56 px.
    - `kbd` verilirse `<Kbd>` gösterilir ve `aria-keyshortcuts={kbd}` yazılır.
  - **`TextField(props: TextFieldProps): JSX.Element`:**
    - Tip: `TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }`.
    - Etiket görünür ve girdinin üstündedir; placeholder etiket yerine kullanılmaz.
    - `id` prop'tan ya da `useId()` ile gelir. `aria-describedby` = `${id}-hint ${id}-error` (yalnızca var olanlar). Hata varken `aria-invalid="true"`.
    - Girdi en az 44 px yüksekliğinde, yazı 16 px.
  - **`src/design/index.ts`:** Üç bileşeni dışa aktarır.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
// src/design/Button.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('defaults to type=button and exposes its shortcut', async () => {
    const onClick = vi.fn();
    render(<Button kbd="F2" onClick={onClick}>Nakit</Button>);
    const btn = screen.getByRole('button', { name: /Nakit/ });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'F2');
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Kart</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Kart' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

```tsx
// src/design/TextField.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

describe('TextField', () => {
  it('ties label, hint and error to the input', () => {
    render(<TextField label="Barkod" hint="Okuyucu ile okutun" error="Ürün bulunamadı" />);
    const input = screen.getByLabelText('Barkod');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Okuyucu ile okutun Ürün bulunamadı');
  });

  it('is not invalid without an error', () => {
    render(<TextField label="Ad" />);
    expect(screen.getByLabelText('Ad')).not.toHaveAttribute('aria-invalid');
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/design`
Expected: FAIL. `./Button` ve `./TextField` bulunamaz.

- [ ] **Step 3: Token'ları ve bileşenleri yukarıdaki imzalarla yaz**

`src/main.tsx` font import'ları:
- `@fontsource/ibm-plex-sans/400.css`, `500.css`, `600.css`, `700.css`
- `@fontsource/ibm-plex-mono/500.css`

Varyant renkleri:
- `primary`: vurgu zemin, beyaz yazı.
- `secondary`: yüzey zemin, `line` çizgi.
- `ghost`: saydam.
- `danger`: `danger-bg` zemin, `danger` yazı.

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/design && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/design src/app/app.css src/main.tsx package.json package-lock.json
git commit -m "feat(v2): add design tokens and base components"
```

---

### Task 3: Para (kuruş) ve Türkçe tutar okuma

**Files:**
- **Create:** `src/domain/money.ts`
- **Test:** `src/domain/money.test.ts`

**Interfaces:**
- **Produces:**
  - `type Kurus = number`
  - `class MoneyParseError extends Error`
  - `formatTRY(k: Kurus): string`: `k` güvenli tamsayı değilse `RangeError` atar.
  - `parseTRY(input: string): Kurus`: geçersiz girdide `MoneyParseError` atar.
  - `divRoundHalfUp(n: number, d: number): number`: `n` tamsayı, `d` pozitif tamsayı; yarımı sıfırdan uzağa yuvarlar.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/domain/money.test.ts
import { describe, expect, it } from 'vitest';
import { divRoundHalfUp, formatTRY, MoneyParseError, parseTRY } from './money';

describe('formatTRY', () => {
  it.each([
    [123450, '₺1.234,50'],
    [1500, '₺15,00'],
    [0, '₺0,00'],
    [-3020, '-₺30,20'],
    [123456789, '₺1.234.567,89'],
  ])('%i → %s', (k, s) => expect(formatTRY(k)).toBe(s));

  it('rejects non-integer kuruş', () => expect(() => formatTRY(1.5)).toThrow(RangeError));
});

describe('parseTRY', () => {
  it.each([
    ['1.234,50', 123450],
    ['1234,5', 123450],
    ['12,5', 1250],
    ['12.5', 1250],
    ['12.50', 1250],
    ['1.250', 125000],
    ['₺ 1.234,50', 123450],
    ['15 TL', 1500],
    ['15', 1500],
    ['0', 0],
  ])('%s → %i', (s, k) => expect(parseTRY(s)).toBe(k));

  it.each(['', 'abc', '-5', '1,234', '1,2,3', '12.3.4', ','])('rejects %j', (s) =>
    expect(() => parseTRY(s)).toThrow(MoneyParseError),
  );
});

describe('divRoundHalfUp', () => {
  it.each([
    [5, 2, 3],
    [-5, 2, -3],
    [4, 2, 2],
    [7, 3, 2],
    [300000, 101, 2970],
  ])('%i / %i → %i', (n, d, r) => expect(divRoundHalfUp(n, d)).toBe(r));
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/domain/money`
Expected: FAIL. `./money` bulunamaz.

- [ ] **Step 3: `money.ts`'i yaz**

- **`formatTRY`:** `Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })` ile `k / 100` biçimlenir. Biçimleyici bir kez oluşturulup yeniden kullanılır.
- **`divRoundHalfUp`:** `n >= 0` için `Math.floor((2 * n + d) / (2 * d))`. Negatif `n` için `-divRoundHalfUp(-n, d)`.
- **`parseTRY` kuralları:**
  1. `₺`, `TL` (büyük/küçük harf fark etmez) ve bütün boşluklar silinir.
  2. Rakam, `.` ve `,` dışında karakter varsa ya da metin boşsa hata atılır.
  3. **`,` varsa:**
     - Tam olarak bir `,` olmalı ve ondalık ayırıcıdır.
     - `.`'lar binlik ayırıcıdır ve silinir.
     - Kesir 1–2 hane olmalı.
  4. **Yalnızca `.` varsa:**
     - Tek bir `.` ve ardından 1–2 hane geliyorsa `.` ondalıktır.
     - Aksi halde `.`'lar binlik ayırıcıdır ve her `.` ardından tam 3 hane gelmelidir.
  5. Tam kısım boş olamaz.
  6. Sonuç = tam × 100 + iki haneye tamamlanmış kesir.

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/domain/money`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/money.ts src/domain/money.test.ts
git commit -m "feat(domain): add kurus money formatting and Turkish amount parsing"
```

---

### Task 4: Fiyatlama: satır tutarı, KDV, indirim dağıtımı, sepet

**Files:**
- **Create:** `src/domain/pricing.ts`
- **Test:** `src/domain/pricing.test.ts`

**Interfaces:**
- **Consumes:** `Kurus` ve `divRoundHalfUp` (Task 3).
- **Produces:**
  - `type VatRate = 0 | 1 | 10 | 20` ve `const VAT_RATES: readonly VatRate[] = [0, 1, 10, 20]`
  - `lineTotal(qtyMilli: number, unitPrice: Kurus): Kurus` = `divRoundHalfUp(qtyMilli * unitPrice, 1000)`
  - `vatIncluded(total: Kurus, rate: VatRate): Kurus` = `total - divRoundHalfUp(total * 100, 100 + rate)`
  - `distributeDiscount(lineTotals: readonly Kurus[], discount: Kurus): Kurus[]`:
    - En büyük kalan yöntemi kullanılır; eşitlikte küçük indeks kazanır.
    - `discount < 0`, `discount > Σ`, ya da negatif satır tutarı varsa `RangeError` atar.
  - `type CartLineInput = { qtyMilli: number; unitPrice: Kurus; vatRate: VatRate; lineDiscount?: Kurus }`
  - `type CartLineTotals = { gross: Kurus; lineDiscount: Kurus; cartShare: Kurus; net: Kurus; vat: Kurus }`
  - `type CartTotals = { lines: CartLineTotals[]; subtotal: Kurus; cartDiscount: Kurus; total: Kurus; vatTotal: Kurus; vatByRate: Partial<Record<VatRate, Kurus>> }`
  - `computeCart(lines: readonly CartLineInput[], cartDiscount?: Kurus): CartTotals`:
    - `gross` = `lineTotal(...)`
    - `subtotal` = Σ(`gross − lineDiscount`)
    - `cartShare` = indirimin `gross − lineDiscount` değerleri üzerinden dağıtılmış payı
    - `net` = `gross − lineDiscount − cartShare`
    - `vat` = `vatIncluded(net, vatRate)`
    - `total` = Σ`net`
    - `vatByRate` yalnızca sepette bulunan oranları içerir.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/domain/pricing.test.ts
import { describe, expect, it } from 'vitest';
import { computeCart, distributeDiscount, lineTotal, vatIncluded, type CartLineInput } from './pricing';

const mockupCart: CartLineInput[] = [
  { qtyMilli: 2000, unitPrice: 1500, vatRate: 1 }, // Ekmek ×2
  { qtyMilli: 3000, unitPrice: 2250, vatRate: 1 }, // Ayran ×3
  { qtyMilli: 1000, unitPrice: 18990, vatRate: 1 }, // Beyaz Peynir
  { qtyMilli: 1000, unitPrice: 27900, vatRate: 1 }, // Siyah Çay
];

describe('computeCart', () => {
  it('totals the mockup cart', () => {
    const t = computeCart(mockupCart);
    expect(t.subtotal).toBe(56640);
    expect(t.total).toBe(56640);
    expect(t.lines.map((l) => l.vat)).toEqual([30, 67, 188, 276]);
    expect(t.vatTotal).toBe(561);
    expect(t.vatByRate).toEqual({ 1: 561 });
  });

  it('spreads a cart discount by largest remainder', () => {
    expect(distributeDiscount([3000, 6750, 18990, 27900], 1000)).toEqual([53, 119, 335, 493]);
    const t = computeCart(mockupCart, 1000);
    expect(t.lines.map((l) => l.net)).toEqual([2947, 6631, 18655, 27407]);
    expect(t.total).toBe(55640);
    expect(t.vatTotal).toBe(551);
  });

  it('applies a line discount before VAT', () => {
    const t = computeCart([{ qtyMilli: 1000, unitPrice: 5000, vatRate: 20, lineDiscount: 500 }]);
    expect(t.lines[0]).toMatchObject({ gross: 5000, net: 4500, vat: 750 });
  });

  it('groups VAT by rate', () => {
    const t = computeCart([
      { qtyMilli: 1000, unitPrice: 1500, vatRate: 1 },
      { qtyMilli: 1000, unitPrice: 4990, vatRate: 20 },
      { qtyMilli: 1000, unitPrice: 8990, vatRate: 20 },
    ]);
    expect(t.total).toBe(15480);
    expect(t.vatByRate).toEqual({ 1: 15, 20: 2330 });
  });
});

describe('line and VAT rules', () => {
  it('handles 0% VAT and fractional quantities', () => {
    expect(vatIncluded(1000, 0)).toBe(0);
    expect(lineTotal(1500, 5000)).toBe(7500);
    expect(lineTotal(333, 1999)).toBe(666);
  });

  it('is symmetric for refunds', () => {
    expect(vatIncluded(-3000, 1)).toBe(-30);
  });

  it('rejects impossible discounts', () => {
    expect(() => distributeDiscount([3000], 3001)).toThrow(RangeError);
    expect(() => distributeDiscount([3000], -1)).toThrow(RangeError);
    expect(distributeDiscount([], 0)).toEqual([]);
    expect(() => computeCart([], 100)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/domain/pricing`
Expected: FAIL. `./pricing` bulunamaz.

- [ ] **Step 3: `pricing.ts`'i yukarıdaki imzalarla yaz**

`distributeDiscount` algoritması (taban değerlere kalan kuruşları dağıtır):

```ts
// shares[i] = floor(lineTotals[i] * discount / sum); remainder = discount - Σshares
// sort indices by (lineTotals[i] * discount) % sum descending, index ascending;
// give +1 to the first `remainder` indices.
```

Ara çarpımlar tamsayı aritmetiğinde kalır (`lineTotals[i] * discount` güvenli tamsayı sınırının altında).

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/domain/pricing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/pricing.ts src/domain/pricing.test.ts
git commit -m "feat(domain): add VAT-inclusive cart totals and discount distribution"
```

---

### Task 5: İş günü ve fiş numarası

**Files:**
- **Create:** `src/domain/businessDate.ts`, `src/domain/receipt.ts`
- **Test:** `src/domain/businessDate.test.ts`, `src/domain/receipt.test.ts`

**Interfaces:**
- **Produces:**
  - `businessDate(at: Date, opts?: { timeZone?: string; cutoffMinutes?: number }): string`:
    - Döndürdüğü değer `YYYY-MM-DD` biçimindedir.
    - Varsayılan `timeZone` `'Europe/Istanbul'`, varsayılan `cutoffMinutes` `0`.
  - `formatReceiptNo(deviceCode: string, businessDate: string, seq: number): string`
  - `nextReceiptSeq(last: { businessDate: string; seq: number } | null, businessDate: string): number`

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/domain/businessDate.test.ts
import { describe, expect, it } from 'vitest';
import { businessDate } from './businessDate';

describe('businessDate', () => {
  it.each([
    ['2026-10-28T20:59:59Z', 0, '2026-10-28'],
    ['2026-10-28T21:00:00Z', 0, '2026-10-29'],
    ['2026-10-28T21:30:00Z', 240, '2026-10-28'],
    ['2026-10-29T00:59:59Z', 240, '2026-10-28'],
    ['2026-10-29T01:00:00Z', 240, '2026-10-29'],
  ])('%s (cutoff %i) → %s', (iso, cutoff, day) =>
    expect(businessDate(new Date(iso), { cutoffMinutes: cutoff })).toBe(day),
  );
});
```

```ts
// src/domain/receipt.test.ts
import { describe, expect, it } from 'vitest';
import { formatReceiptNo, nextReceiptSeq } from './receipt';

describe('receipt numbers', () => {
  it('formats device, day and padded sequence', () =>
    expect(formatReceiptNo('K1', '2026-10-28', 42)).toBe('K1-20261028-0042'));

  it('grows past four digits', () =>
    expect(formatReceiptNo('K1', '2026-10-28', 10000)).toBe('K1-20261028-10000'));

  it('restarts each business day', () => {
    expect(nextReceiptSeq(null, '2026-10-28')).toBe(1);
    expect(nextReceiptSeq({ businessDate: '2026-10-28', seq: 41 }, '2026-10-28')).toBe(42);
    expect(nextReceiptSeq({ businessDate: '2026-10-28', seq: 41 }, '2026-10-29')).toBe(1);
  });

  it('rejects bad input', () => {
    expect(() => formatReceiptNo('k1', '2026-10-28', 1)).toThrow(RangeError);
    expect(() => formatReceiptNo('K1', '28.10.2026', 1)).toThrow(RangeError);
    expect(() => formatReceiptNo('K1', '2026-10-28', 0)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/domain/businessDate src/domain/receipt`
Expected: FAIL. Modüller bulunamaz.

- [ ] **Step 3: İki modülü yaz**

- **`businessDate`:** Anı `cutoffMinutes` dakika geri al, sonra `Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })` ile biçimle (`en-CA`, `YYYY-MM-DD` verir).
- **`formatReceiptNo`:**
  - Cihaz kodu `^[A-Z][A-Z0-9]{0,3}$` desenine, iş günü `^\d{4}-\d{2}-\d{2}$` desenine uymalı. `seq` 1 veya daha büyük bir tamsayı olmalı. Aksi halde `RangeError` atılır.
  - Sıra `String(seq).padStart(4, '0')` ile doldurulur.

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/domain/businessDate src/domain/receipt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/businessDate.ts src/domain/businessDate.test.ts src/domain/receipt.ts src/domain/receipt.test.ts
git commit -m "feat(domain): add Istanbul business date and per-device receipt numbers"
```

---

### Task 6: Defter ve stok seviyesi

**Files:**
- **Create:** `src/domain/ledger.ts`
- **Test:** `src/domain/ledger.test.ts`

**Interfaces:**
- **Consumes:** `Kurus` (Task 3) ve `businessDate` (Task 5).
- **Produces:**
  - `type LedgerKind = 'debt' | 'payment' | 'adjustment'`
  - `type LedgerEntry = { kind: LedgerKind; amount: Kurus; occurredAt: string }`
    - Tutar işaretlidir: borç > 0, ödeme < 0, düzeltme her iki işarette olabilir. İşaret türle çelişirse `RangeError` atılır.
  - `balance(entries: readonly LedgerEntry[]): Kurus`
  - `oldestUnpaidDebt(entries: readonly LedgerEntry[]): string | null`:
    - Kayıtlar zamana göre sıralanır, FIFO uygulanır.
    - Ödemeler ve eksi düzeltmeler önce en eski açık borcu kapatır; artan kısım alacak olur ve sonraki borçlardan düşer.
    - Tamamen kapanmamış ilk borcun `occurredAt` değeri döner; yoksa `null`.
  - `debtAgeDays(entries: readonly LedgerEntry[], today: string): number`: en eski açık borcun iş günü ile `today` arasındaki gün sayısı; açık borç yoksa 0.
  - `stockLevel(movements: readonly { delta: number }[]): number`: `delta`'ların toplamı (`qtyMilli`).

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// src/domain/ledger.test.ts
import { describe, expect, it } from 'vitest';
import { balance, debtAgeDays, oldestUnpaidDebt, stockLevel, type LedgerEntry } from './ledger';

const entries: LedgerEntry[] = [
  { kind: 'debt', amount: 10000, occurredAt: '2026-10-01T09:00:00Z' },
  { kind: 'debt', amount: 5000, occurredAt: '2026-10-10T09:00:00Z' },
  { kind: 'payment', amount: -12000, occurredAt: '2026-10-15T09:00:00Z' },
];

describe('ledger', () => {
  it('sums signed amounts', () => expect(balance(entries)).toBe(3000));

  it('ages from the oldest unpaid debt, FIFO', () => {
    expect(oldestUnpaidDebt(entries)).toBe('2026-10-10T09:00:00Z');
    expect(debtAgeDays(entries, '2026-10-28')).toBe(18);
  });

  it('orders by time, not by array position', () =>
    expect(oldestUnpaidDebt([...entries].reverse())).toBe('2026-10-10T09:00:00Z'));

  it('keeps overpayment as credit', () => {
    const over: LedgerEntry[] = [
      { kind: 'debt', amount: 10000, occurredAt: '2026-10-01T09:00:00Z' },
      { kind: 'payment', amount: -12000, occurredAt: '2026-10-02T09:00:00Z' },
    ];
    expect(balance(over)).toBe(-2000);
    expect(oldestUnpaidDebt(over)).toBeNull();
    expect(debtAgeDays(over, '2026-10-28')).toBe(0);
  });

  it('applies earlier credit to later debts', () => {
    const e: LedgerEntry[] = [
      { kind: 'debt', amount: 10000, occurredAt: '2026-10-01T09:00:00Z' },
      { kind: 'payment', amount: -12000, occurredAt: '2026-10-02T09:00:00Z' },
      { kind: 'debt', amount: 5000, occurredAt: '2026-10-05T09:00:00Z' },
    ];
    expect(balance(e)).toBe(3000);
    expect(oldestUnpaidDebt(e)).toBe('2026-10-05T09:00:00Z');
  });

  it('rejects sign mistakes', () =>
    expect(() =>
      balance([{ kind: 'payment', amount: 500, occurredAt: '2026-10-01T09:00:00Z' }]),
    ).toThrow(RangeError));
});

describe('stockLevel', () => {
  it('sums movements', () => expect(stockLevel([{ delta: 50000 }, { delta: -2000 }, { delta: -1000 }])).toBe(47000));
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/domain/ledger`
Expected: FAIL. `./ledger` bulunamaz.

- [ ] **Step 3: `ledger.ts`'i yukarıdaki imzalarla yaz**

`debtAgeDays` gün farkını `businessDate(new Date(oldest))` ile `today` arasında, UTC gece yarılarına çevrilmiş tarihlerin farkı olarak hesaplar.

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `npm test -- src/domain/ledger`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ledger.ts src/domain/ledger.test.ts
git commit -m "feat(domain): add signed ledger balance, FIFO debt age and stock level"
```

---

### Task 7: v2 CI iş akışı

**Files:**
- **Create:** `.github/workflows/v2-ci.yml`

**Interfaces:**
- **Consumes:** Task 1'deki npm script'leri (`lint`, `typecheck`, `test`, `build`).

- [ ] **Step 1: İş akışını yaz** (yapılandırma, içerik birebir)

```yaml
name: v2 CI

on:
  push:
    branches: [v2]
  pull_request:
    branches: [v2, main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
        env:
          ELECTRON_SKIP_BINARY_DOWNLOAD: '1'
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Aynı komutları yerelde çalıştır**

Run: `npm ci && npm run lint && npm run typecheck && npm test && npm run build`
Expected: Hepsi hatasız biter.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/v2-ci.yml
git commit -m "ci(v2): run lint, typecheck, tests and build on v2"
```

- [ ] **Step 4: İlk push sonrasında Actions'ta "v2 CI" çalışmasının yeşil olduğunu gör**

`v2` dalı GitHub'a ilk kez kullanıcının onayıyla push edilir.

---

### Task 8: Kasa kabuğu (yön 1 düzeni)

**Files:**
- **Create:** `src/app/AppShell.tsx`
- **Modify:** `src/app/App.tsx`: `AppShell`'i örnek değerlerle gösterir.
- **Test:** `src/app/AppShell.test.tsx`

**Interfaces:**
- **Consumes:** `Button`, `Kbd` (Task 2) ve `APP_VERSION` (Task 1).
- **Produces:**
  - `type NavKey = 'pos' | 'products' | 'stock' | 'customers' | 'reports'`
  - `type SyncState = 'online' | 'offline' | 'pending'`
  - `type AppShellProps = { marketName: string; deviceName: string; staffName: string; syncState: SyncState; pendingCount?: number; activeNav: NavKey; children?: ReactNode; cart?: ReactNode }`
  - `AppShell(props: AppShellProps): JSX.Element`
- **Sabit metinler:**
  - Menü: `Kasa`, `Ürünler`, `Stok`, `Veresiye`, `Raporlar`. `<nav aria-label="Ana menü">`; bağlantılar `#/pos` … `#/reports`.
  - Eşitleme durumu (`role="status"`): `Çevrimiçi`, `Çevrimdışı`, `${pendingCount} işlem bekliyor`.
  - `cart` verilmezse `<aside aria-label="Sepet">` içinde "Sepet boş" ve "Barkod okutun ya da soldan ürün seçin." görünür.
  - Altta `v${APP_VERSION}` yazar.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
// src/app/AppShell.test.tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';
import { APP_VERSION } from './version';

const base = { marketName: 'Kurşunlu Market', deviceName: 'Kasa 1', staffName: 'Elif Y.', activeNav: 'pos' } as const;

describe('AppShell', () => {
  it('lists the five sections and marks the active one', () => {
    render(<AppShell {...base} syncState="online" />);
    const nav = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Kasa', 'Ürünler', 'Stok', 'Veresiye', 'Raporlar',
    ]);
    expect(within(nav).getByRole('link', { name: 'Kasa' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['online', undefined, 'Çevrimiçi'],
    ['offline', undefined, 'Çevrimdışı'],
    ['pending', 3, '3 işlem bekliyor'],
  ] as const)('shows sync state %s', (state, n, label) => {
    render(<AppShell {...base} syncState={state} pendingCount={n} />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
  });

  it('shows an empty cart and the app version', () => {
    render(<AppShell {...base} syncState="online" />);
    expect(screen.getByRole('complementary', { name: 'Sepet' })).toHaveTextContent('Sepet boş');
    expect(screen.getByText(`v${APP_VERSION}`)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Testlerin başarısız olduğunu gör**

Run: `npm test -- src/app/AppShell`
Expected: FAIL. `./AppShell` bulunamaz.

- [ ] **Step 3: `AppShell`'i yaz ve `App`'ten örnek değerlerle göster**

Düzen, taslağın 1. panosunu izler:
- Beyaz üst çubuk: logo, market adı ve cihaz, menü, eşitleme durumu, kasiyer.
- Altında iki sütun: solda `children` (ürün alanı), sağda en fazla 460 px'lik `cart`.
- Dar ekranda sütunlar alt alta iner (`flex-wrap`).

- [ ] **Step 4: Testleri ve bütün kontrolleri çalıştır**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Gözle kontrol et**

`npm run dev` ile ekranı tarayıcıda aç; 1366 px ve 390 px genişlikte bak. Düzen taslağın 1. panosuyla tutarlı olmalı; dar ekranda sepet alta inmeli.

- [ ] **Step 6: Commit**

```bash
git add src/app/AppShell.tsx src/app/AppShell.test.tsx src/app/App.tsx
git commit -m "feat(v2): add POS app shell in the clean professional direction"
```

---

## Uygulama notları (2026-10-28)

Commit'ler `c9e235b`…`4bceb27`. Son inceleme: 0 kritik, 2 önemli (düzeltildi: tamsayı/KDV oranı denetimi, gün içi fiş sırası), 6 küçük bulgu ertelendi.

**Ertelenen küçük bulgular:**
- `parseTRY` binlik gruplamayı denetlemiyor ("0.500" → ₺500,00).
- `debtAgeDays` gün dönümü ayarını ve saat dilimini dikkate almıyor.
- `viewport-fit=cover` var, güvenli alan boşluğu yok.
- Danger butonda kısayol etiketi kontrastı ~4,2:1.
- `cutoffMinutes` için sınır yok.
- `version.test.ts` sürüm metnini sabit yazıyor.
