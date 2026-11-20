# Market Kasa v2 · M6b Ayarlar, İz Kaydı, Lisans ve Personel Raporu — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sahip "Ayarlar"da gün dönümünü, market ve kasa adını, fiş ayarlarını değiştirir; gün dönümü bütün kayıtlara, raporlara, Z'ye ve borç yaşına uygulanır. Yönetim işlemleri (personel, ayar, fiyat değişikliği, yetkili onayı) iz kaydına düşer ve sahip bunu okur. Lisans bitişi yaklaşınca uyarı görünür; tolerans bitince satış kapanır. Raporlarda personel bazında satış görünür.

**Architecture:**
- **Market ayarları** eşitlenen tek satırlık bir varlıktır (`settings`, Dexie v12, kimlik `market`): `cutoffMinutes` (0–720). Bütün cihazlar aynı iş günü tanımını kullanır (DESIGN §9). Kasa adı ve kodu cihaza aittir (`mk2.device`).
- **Gün dönümü** tek bir kancadan (`useMarketSettings`) okunur ve olay yazan her ekran onu veri fonksiyonuna geçirir. Raporların "bugün"ü, Z'nin gün başlangıcı ve borç yaşı aynı ayarı kullanır. Borç yaşı, kayıtlı `businessDate`'ten hesaplanır.
- **İz kaydı** değişmez bir olay tablosudur (`auditLog`, v12): kim, ne yaptı, hangi kayıt, önce ve sonra (DESIGN §6.3 `audit_log`).
- **Lisans** bilgisi sunucudan gelecek (M0b). İstemci bitiş tarihini `meta`'da tutar, durumu saf bir fonksiyonla hesaplar: etkin, uyarı (7 gün kala), tolerans (bitişten sonra 3 gün), salt-okunur. Bilgi yokken etkin sayılır.
- **Personel raporu** özetin bir kırılımıdır: satış adedi ve net tutar, personel adıyla.

**Tech Stack:** React 19, Dexie 4 (v12), Vitest ve Testing Library. Yeni bağımlılık yok.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md): §6.2 (`markets.settings`), §6.3 (`audit_log`), §8.4, §8.6, §9, §10 (Raporlar: personel performansı; Yönetim: iz kaydı, lisans bilgisi).

[docs/v2/ertelenenler.md](../ertelenenler.md) M6 bölümünün gün dönümü maddesini ve M5'in "Z gece yarısından sonra" maddesini alır.

## Global Constraints

| Kural | Bu kuralı koruyan test | Bozma denemesi |
|---|---|---|
| Gün dönümü 0–720 dakikadır ve bütün cihazlarda aynıdır. | Task 1 "keeps the day cutoff for the whole market" | denetim kaldırılır |
| Olay yazan her ekran gün dönümünü geçirir. | Task 1 "counts a sale after midnight on the day before" | ayar geçirilmez |
| Borç yaşı kayıtlı iş gününden hesaplanır. | Task 1 "ages a debt by its business day" | `occurredAt`'ten hesaplanır |
| Yönetim işlemleri iz kaydına düşer; iz kaydı değişmez. | Task 2 "records who changed what" | kayıt yazılmaz |
| Lisans: 7 gün kala uyarı, 3 gün tolerans, sonra satış kapanır. | Task 3 "follows the licence through warning, grace and read-only" | eşikler kaydırılır |
| Personel raporu satışları yapan kişiye göre toplar. | Task 4 "sums sales by who made them" | kişi yerine kasa kullanılır |

## Review Focus

1. **Gün dönümü değişirse** geçmiş kayıtların iş günü değişmez (kayıtta saklıdır); yalnız yeni kayıtlar yeni ayarla yazılır.
2. **Başka cihazdan gelen ayar** bu cihazda hemen uygulanır.
3. **Lisans bilgisi yokken** hiçbir şey kapanmaz.
4. **Salt-okunur modda** veriler okunur ve dışa aktarılır; satış kapanır.
5. **Silinmiş ya da pasif personelin satışları** raporda adıyla görünür; personeli olmayan satışlar "Personelsiz" satırında toplanır.

## Bu planın dışında

- **M0b:** lisans tarihinin sunucudan gelmesi, sunucuda iz kaydı ve "yetkisiz" işareti, cihaz yönetimi.

---

### Task 1: Market ayarları ve gün dönümü

**Files:** Create `src/data/settings.ts`, `src/app/marketSettings.ts` ve testleri; Modify `src/data/types.ts`, `src/data/db.ts` (v12), `src/sync/apply.ts`, olay yazan ekranlar, `src/reports/ReportsScreen.tsx`, `src/data/cash.ts`, `src/domain/ledger.ts`, `src/customers/statement.ts`, `src/settings/SettingsScreen.tsx`

**Interfaces:**
- **Produces:**
  - `MarketSettingsRecord = { id: 'market'; cutoffMinutes; createdAt; updatedAt }`; `loadMarketSettings(db)`, `saveMarketSettings(db, { cutoffMinutes }, at)`.
  - `useMarketSettings(): { cutoffMinutes }` (yokken 0).
  - Ayarlar → "Market": gün dönümü saati ("00:00"–"12:00"). "Bu kasa": market adı, kasa adı, kasa kodu (kaydedince sayfa yenilenir). "Fiş": fiş ayarları penceresi.
  - Olay yazan bütün çağrılar `cutoffMinutes` geçirir; raporun "bugün"ü ve Z'nin gün başlangıcı ayara uyar; borç yaşı kayıtlı `businessDate`'ten hesaplanır.
- [ ] **Step 1–5:** `it('keeps the day cutoff for the whole market')`, `it('counts a sale after midnight on the day before')`, `it('ages a debt by its business day')`, `it('edits the market and this register')`, `apply.test.ts`: "applies pulled settings". Commit — `git commit -m "feat(settings): the day cutoff, the market and this register"`

### Task 2: İz kaydı

**Files:** Create `src/data/audit.ts`, `src/settings/AuditLog.tsx` ve testleri; Modify `src/data/types.ts`, `src/data/db.ts` (v12), `src/sync/apply.ts`, `src/data/staff.ts`, `src/data/settings.ts`, `src/data/products.ts`, `src/app/ApprovalDialog.tsx` kullanan yerler

**Interfaces:**
- **Produces:**
  - `AuditRecord = { id; deviceCode; staffId?; action; entity; entityId?; before?; after?; occurredAt; businessDate }`.
  - `action`: `staff.create`, `staff.update`, `staff.pin`, `staff.archive`, `staff.restore`, `settings.update`, `product.price`, `approval`.
  - Yazan fonksiyonlar `actor?: { deviceCode; staffId? }` alır ve iz kaydını aynı transaction'da yazar.
  - Ayarlar → "İz kaydı": en yeni 200 kayıt; tarih, kişi, işlem, açıklama.
- [ ] **Step 1–5:** `it('records who changed what')`, `it('records a price change and an approval')`, `it('shows the latest entries to the owner')`, `apply.test.ts`: "applies pulled audit entries once". Commit — `git commit -m "feat(audit): who changed what"`

### Task 3: Lisans

**Files:** Create `src/domain/license.ts`, `src/app/license.ts`, `src/app/LicenseBanner.tsx` ve testleri; Modify `src/app/AppShell.tsx`, `src/pos/PosScreen.tsx`, `src/settings/SettingsScreen.tsx`

**Interfaces:**
- **Produces:**
  - `licenseState(expiresAt: string | null, now: Date): { kind: 'active' | 'warning' | 'grace' | 'readOnly' | 'unknown'; daysLeft? }`.
  - `loadLicense(db)`, `saveLicense(db, expiresAt)` (`meta`; M0b'de sunucudan doldurulur).
  - Üst çubukta uyarı ve tolerans şeridi; salt-okunurda kasada ödeme kapalı ve neden yazılı; Ayarlar → "Lisans": bitiş tarihi ya da "Bilinmiyor".
- [ ] **Step 1–5:** `it('follows the licence through warning, grace and read-only')`, `it('closes the register when the grace is over')`, `it('keeps everything open without licence information')`. Commit — `git commit -m "feat(app): licence warning, grace and read-only"`

### Task 4: Personel performansı

**Files:** Modify `src/reports/summary.ts`, `src/reports/ReportTables.tsx`, `src/reports/ReportsScreen.tsx` ve testleri

**Interfaces:**
- **Produces:**
  - `Summary.byStaff: { staffId?: string; name: string; salesCount; net }[]` (adı personel tablosundan; personelsizler "Personelsiz").
  - Raporlarda "Personel" tablosu (birden çok satır varsa).
- [ ] **Step 1–5:** `it('sums sales by who made them')`, `it('shows the staff table on the reports screen')`. Commit — `git commit -m "feat(reports): sales by staff"`

## Uygulama notları (2026-10-30)

- **Commitler:** `5819739`, `0338ae4`, `f4b6202`, `0d627c2` (4 görev); inceleme düzeltmeleri `16cfc52`. Son durumda 673 test yeşil.
- **Son inceleme** (Opus, donmuş worktree): kritik yok, 4 önemli, 8 küçük bulgu. Önemlilerin hepsi düzeltildi, küçükler ertelendi.
  - **I-1:** Mal kabulde değişen satış fiyatı iz kaydına düşmüyordu. Artık düşüyor.
  - **I-2:** Kasa kodu değişince açık kasa geride kalıyor, Z ikiye bölünüyordu; başka kasanın kodu da alınabiliyordu. Artık kasa açıkken ya da kod başka kasadaysa kod değişmez.
  - **I-3:** Açılış stoğu gün dönümünü kullanmıyordu. Artık kullanıyor.
  - **I-4:** Lisans günü gece yarısı dönüyordu. Artık marketin gün dönümüyle dönüyor.
- **Bozma denemeleri:** 21 deneme, hepsi kırmızı.
- **Kararlar:**
  - Gün dönümü bütün kasaların paylaştığı tek bir ayardır; saat başı 00:00–12:00 seçilir. Yazılmış kayıtların iş günü değişmez.
  - Market adı, kasa adı ve kodu cihaza aittir; uygulama yeniden açılınca geçerli olur.
  - İz kaydı (şema v13) personel, ayar, fiyat değişikliklerini ve yetkili onaylarını tutar; PIN ve hash'i hiçbir zaman tutmaz. İçe aktarmanın fiyatları kaydedilmez.
  - Lisans tarihi sunucudan gelecek (M0b); yokken hiçbir şey kapanmaz. Salt-okunurda yalnız satış kapanır.
  - Personel tablosu kişinin çaldığı ve iptal edilmemiş satışları gösterir; iadeler kişiden düşülmez.
- **Ertelenenler:** [ertelenenler.md](../ertelenenler.md) içinde M6 ve M0b bölümlerinde.
