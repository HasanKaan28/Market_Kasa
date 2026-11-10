# Market Kasa v2 · M6a Personel, PIN ve İzinler — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasada çalışan personel PIN ile geçiş yapar. Satış, iptal, iade, tahsilat, ödeme, mal kabul, sayım, kasa hareketi ve gün sonu, işi yapan personeli taşır. Ekranlar ve işlemler rolün ve kişinin izinlerine göre açılır (DESIGN §8.5). Yetkisi olmayan bir işlemi, yetkili bir personel kendi PIN'iyle onaylar. Sahip personeli ekler, rolünü ve izinlerini değiştirir, PIN'ini yeniler, pasife alır.

**Architecture:**
- **İzinler** saf bir modüldür. `Permission` anahtarları ve rol varsayılanları §8.5 tablosundan gelir. Kişiye özel izin, rolün varsayılanını açar ya da kapatır. Sahibin izinleri kısılamaz, böylece market kendini kilitleyemez.
- **PIN** WebCrypto ile hash'lenir: PBKDF2-SHA256, 150.000 tur, kişiye özel 16 baytlık tuz (§8.3). Doğrulama cihazda yapılır, çevrimdışı çalışır. Hatalı deneme sayacı cihazda (`meta`) tutulur: 5 hatalı denemede 5 dakika kilit.
- **Personel** düzenlenebilir bir varlıktır: `staff` tablosu (Dexie v11), eşitlemede varlık tablosu. PIN hash'i ve tuzu kayıtla birlikte eşitlenir (§6.2). Pasif personel `archivedAt` taşır (müşteri ve tedarikçideki gibi).
- **Oturum** cihazdadır: geçerli personelin kimliği `localStorage`'da durur (`mk2.staff`), sayfa yenilense de kalır, "Kilitle" ile kapanır. Hiç personel tanımlı değilken uygulama bugünkü gibi açık çalışır ve bütün izinler verilir (ilk kurulum). İlk eklenen personel sahip olmak zorundadır.
- **Sahip oturumu** M0b'de Supabase Auth ile gelecek. O zamana kadar sahip rolündeki personelin PIN'i yönetim ekranlarını açar.

**Tech Stack:** React 19, Dexie 4 (v11), WebCrypto (`crypto.subtle`), Vitest ve Testing Library. Yeni bağımlılık yok.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md): §6.2 (`staff`), §6.3 (olaylar `staff_id` taşır), §8.1, §8.3, §8.5, §13.

[docs/v2/ertelenenler.md](../ertelenenler.md) M6 bölümünün rol maddelerini alır. Gün dönümü, ayarlar, iz kaydı, lisans ve personel performansı M6b'dedir.

## Global Constraints

| Kural | Bu kuralı koruyan test | Bozma denemesi |
|---|---|---|
| PIN 4–6 hanedir; PBKDF2-SHA256 en az 100.000 tur ve kişiye özel tuzla hash'lenir. | Task 1 "hashes a PIN with its own salt and enough rounds" | tur sayısı düşürülür; tuz sabitlenir |
| 5 hatalı denemede 5 dakika kilit; doğru PIN sayacı sıfırlar. | Task 2 "locks a person after five wrong PINs for five minutes" | sayaç ya da kilit kaldırılır |
| Rol varsayılanları §8.5 tablosudur; sahibin izni kısılamaz. | Task 1 "gives each role the permissions of §8.5" | bir hücre değiştirilir |
| Son aktif sahip pasife alınamaz, rolü düşürülemez. | Task 2 "keeps the last owner" | denetim kaldırılır |
| Olaylar işi yapan personeli taşır. | Task 3 "stamps who did it on every event" | `staffId` yazılmaz |
| Yetkisiz işlem ancak yetkili bir personelin PIN'iyle yapılır. | Task 4 "asks a permitted person to approve" | onay atlanır |
| Personel yönetimi yalnız `admin` iznindedir. | Task 5 "lets only the owner manage staff" | izin denetimi kaldırılır |

## Review Focus

1. **Oturumdaki personel pasife alınır ya da rolü değişir** (başka cihazdan gelen eşitlemeyle de): oturum hemen yeni duruma uyar; pasif personel oturumda kalmaz.
2. **Hiç personel yokken** uygulama açık çalışır; ilk personel sahip değilse kaydedilmez.
3. **Kilitli personel** doğru PIN'i girse de kilit süresince giremez; kilit bitince sayaç sıfırdan başlar.
4. **Onay penceresi** yalnız o izni taşıyan aktif personeli listeler; onaylayanın kilidi de sayılır.
5. **Satış sırasında oturum kapanırsa** sepet kaybolmaz (sepet zaten cihazda saklı).

## Bu planın dışında

- **M0b:** sahibin Supabase Auth oturumu, cihaz kaydı ve iptali, sunucuda "yetkisiz" işaretli iz kaydı.
- **M6b:** ayarlar ekranının geri kalanı (gün dönümü, market ve cihaz adı, fiş), iz kaydı, lisans, personel performansı raporu.

---

### Task 1: İzinler ve PIN

**Files:** Create `src/domain/permissions.ts`, `src/domain/pin.ts` ve testleri

**Interfaces:**
- **Produces:**
  - `Role = 'cashier' | 'stock' | 'manager' | 'owner'`, `ROLE_LABELS` ("Kasiyer", "Stok", "Yönetici", "Sahip").
  - `Permission`: `sell`, `creditSale`, `overLimit`, `discount`, `returnWithReceipt`, `voidSale`, `collect`, `addProduct`, `editProducts`, `seeCost`, `stock`, `suppliers`, `reports`, `closeDay`, `invoice`, `admin`; `PERMISSION_LABELS` §8.5 satır adlarıyla.
  - `ROLE_PERMISSIONS: Record<Role, readonly Permission[]>` (§8.5 tablosu); `can(person: { role; permissions? }, permission): boolean` (kişi izni rolün üstüne yazılır; sahipte yok sayılır).
  - `isValidPin(pin): boolean` (`^\d{4,6}$`); `hashPin(pin, salt?): Promise<PinHash>` (`{ hash, salt, iterations }`, base64); `verifyPin(pin, stored): Promise<boolean>` (sabit süreli karşılaştırma).
- [ ] **Step 1–5:** `it('gives each role the permissions of §8.5')`, `it('lets a person’s own permission win over the role, except for the owner')`, `it('accepts only four to six digits')`, `it('hashes a PIN with its own salt and enough rounds')`, `it('verifies the right PIN and refuses a wrong one')`. Commit — `git commit -m "feat(domain): roles, permissions and PIN hashing"`

### Task 2: Personel kaydı ve giriş

**Files:** Create `src/data/staff.ts`, `src/data/staff.test.ts`; Modify `src/data/types.ts` (`StaffRecord`, `OutboxTable`), `src/data/db.ts` (v11), `src/sync/apply.ts`

**Interfaces:**
- **Produces:**
  - `StaffRecord = { id; name; role; permissions?; pinHash; pinSalt; pinIterations; createdAt; updatedAt; archivedAt? }`.
  - `createStaff(db, { name, role, pin, permissions? }, at)`: ilk personel sahip olmalı; ad ve PIN denetlenir.
  - `updateStaff(db, id, { name?, role?, permissions? }, at)`, `setStaffPin(db, id, pin, at)`, `archiveStaff(db, id, at)`, `restoreStaff(db, id, at)`: son aktif sahip korunur.
  - `listStaff(db, { active? })` ada göre.
  - `checkPin(db, staffId, pin, at): Promise<PinCheck>`; `PinCheck = { ok: true; staff } | { ok: false; reason: 'wrong'; attemptsLeft } | { ok: false; reason: 'locked'; until } | { ok: false; reason: 'inactive' }`.
- [ ] **Step 1–5:** `it('adds the owner first and keeps the PIN only as a hash')`, `it('keeps the last owner')`, `it('locks a person after five wrong PINs for five minutes')`, `it('refuses an archived person')`, `apply.test.ts`: "applies pulled staff". Commit — `git commit -m "feat(data): staff with PINs and sign-in lockout"`

### Task 3: Oturum, giriş ekranı ve olayların personeli

**Files:** Create `src/app/session.tsx`, `src/app/SignInScreen.tsx` ve testleri; Modify `src/app/App.tsx`, `src/app/AppShell.tsx`, olay yazan veri fonksiyonları (`sales`, `voids`, `returns`, `ledger`, `supplierLedger`, `purchases`, `counts`, `cash`) ve onları çağıran pencereler

**Interfaces:**
- **Produces:**
  - `SessionProvider`, `useSession(): { staff: StaffRecord | null; open: boolean; can(permission): boolean; signIn(staff): void; signOut(): void }`. `open` hiç aktif personel yokken doğrudur ve her izin verilir.
  - Giriş ekranı: aktif personel listesi, PIN alanı (rakam tuş takımı ve klavye), hata satırları ("PIN yanlış. 3 deneme kaldı.", "Çok fazla hatalı deneme. 14:35'te tekrar deneyin.").
  - Üst çubukta personel adı ve "Kilitle".
  - Olay kayıtlarına `staffId?` eklenir: `SaleVoidRecord`, `ReturnRecord`, `LedgerRecord`, `SupplierLedgerRecord`, `PurchaseRecord`, `StockCountRecord`, `CashMovementRecord`, `CashSessionRecord` (satışta zaten var). Veri fonksiyonları `staffId?` alır, ekranlar oturumdaki personeli geçirir.
- [ ] **Step 1–5:** `it('asks for a PIN when staff are set up')`, `it('opens straight in when no staff are set up')`, `it('signs out with Kilitle')`, `it('leaves a session whose person was archived')`, `it('stamps who did it on every event')`. Commit — `git commit -m "feat(app): staff sign-in and who did each event"`

### Task 4: İzin denetimi ve yetkili onayı

**Files:** Create `src/app/ApprovalDialog.tsx` ve testi; Modify `src/app/AppShell.tsx` (menü izinleri), `src/pos/PosScreen.tsx`, `src/pos/CartPanel.tsx`, `src/pos/ReceiptsDialog.tsx`, `src/pos/PaymentDialog.tsx` (limit aşımı), `src/reports/ReportsScreen.tsx` (maliyet ve kâr, CSV), `src/products/ProductsScreen.tsx` (dışa aktarma)

**Interfaces:**
- **Produces:**
  - Menü: Ürünler `editProducts`, Stok `stock`, Müşteriler `collect`, Tedarikçiler `suppliers`, Raporlar `reports`, Ayarlar `admin`. İzinsiz ekran menüde görünmez; adresle açılırsa "Bu ekran için yetkiniz yok." yazar.
  - `ApprovalDialog({ permission, onApproved(approver), onClose })`: izni taşıyan aktif personelden biri seçilir, PIN'i girilir (kilit sayılır).
  - Kasada indirim (`discount`), satış iptali (`voidSale`), veresiye limit aşımı (`overLimit`), gün sonu ve kasa hareketleri (`closeDay`), fiş ayarları (`admin`), kasada yeni ürün (`addProduct`): izin yoksa onay istenir.
  - Raporlarda maliyet ve kâr (`seeCost`) izinsizse gizlenir; CSV ve ürün dışa aktarma `admin` ister.
- [ ] **Step 1–5:** `it('hides the screens a person may not use')`, `it('asks a permitted person to approve a discount')`, `it('sells over the credit limit only with approval')`, `it('hides cost and profit without the permission')`. Commit — `git commit -m "feat(app): permissions on screens and approval by PIN"`

### Task 5: Personel yönetimi

**Files:** Create `src/settings/SettingsScreen.tsx`, `src/settings/StaffDialog.tsx` ve testleri; Modify `src/app/route.ts` (`'settings'`), `src/app/AppShell.tsx` ("Ayarlar"), `src/app/App.tsx`

**Interfaces:**
- **Produces:**
  - "Ayarlar" ekranı, `admin` izniyle; bölüm "Personel": ad, rol, durum.
  - "Yeni personel": ad, rol, PIN, PIN tekrar. Hiç personel yokken ilk kayıt sahip olarak açılır ve kaydedilince oturum o kişiyle başlar.
  - Personel penceresi: ad, rol, izinler (rolün varsayılanı işaretli; kişiye özel değişiklik ayrıca belirtilir), "PIN'i değiştir", "Pasife al" / "Geri al".
- [ ] **Step 1–5:** `it('lets only the owner manage staff')`, `it('adds the first person as the owner and signs them in')`, `it('changes a role and a permission')`, `it('renews a PIN and archives a person')`. Commit — `git commit -m "feat(settings): staff management"`

## Uygulama notları (2026-10-29)

- **Commitler:** `5a8c9e0`, `bc3d255`, `010cf67`, `bd0dd66`, `d677fd9` (5 görev); kırılgan test düzeltmesi `1a69a5a`; inceleme düzeltmeleri `230af66`. Son durumda 661 test yeşil.
- **Son inceleme** (Opus, donmuş worktree): 1 kritik, 5 önemli, 10 küçük bulgu. Kritik ve önemliler düzeltildi; bir önemli karar olarak kaldı; küçükler ertelendi.
  - **C1:** Her kasiyer Müşteriler'de veresiye limitini kaldırıp borç düşebiliyordu. Artık "Düzeltme" ve limit değişikliği yöneticinin onayını (PIN) ister; onaylar iz kaydına düşer.
  - **I1:** Bölünmüş ödemenin veresiye kısmı veresiye iznini aramıyordu. Artık arıyor.
  - **I2 (karar):** Oturum cihazda yalnız bir kimlik olarak durur; geliştirici araçlarını açabilen biri PIN'siz sahip olabilir. İstemcide bunu durduracak bir denetim yok; çözüm yayında geliştirici araçlarının kaldırılması (M8) ve sahibin sunucu oturumu (M0b).
  - **I3:** "Personel, cihaz, ayar, dışa aktarma" izni kişiye verilebiliyordu ve böyle biri sahibin PIN'ini değiştirebiliyordu. Artık yalnız sahiptedir. Bilinmeyen bir rol hiçbir izin almaz (kasayı düşürmez).
  - **I4:** PIN alanında Enter, PIN'i değil kişiyi kaydediyordu. PIN değişikliği artık ayrı bir form.
  - **I5:** Açılış stoğu ve elle stok düzeltmesi yapanı taşımıyordu. Artık taşıyor.
- **Bozma denemeleri:** 30 deneme, hepsi kırmızı.
- **Kararlar:**
  - PIN: PBKDF2-SHA256, 150.000 tur, kişiye özel 16 baytlık tuz. Hatalı deneme sayacı her cihazda ayrı.
  - Pasif personel `archivedAt` taşır. Son aktif sahip korunur.
  - Hiç personel yokken uygulama eskisi gibi açık çalışır; ilk kişi sahip olur ve hemen oturum açar.
  - İzni olmayan biri kasada işlemi yetkili birinin PIN'iyle yapar; ekranlar menüde görünmez, dışa aktarma ile maliyet ve kâr gizlenir.
  - Limit aşımı yönetici için de onay ister (kendi PIN'iyle).
  - Stok hareketleri yalnız üstlerinde bir kayıt yoksa personel taşır.
- **Doğrulama:** Production build Chromium'da denendi. Ayarlar'dan ilk sahip "Kaan" eklendi ve oturum açıldı; "Kilitle" giriş ekranını getirdi; PIN ile geri girildi.
- **Ertelenenler:** [ertelenenler.md](../ertelenenler.md) içinde M6, M8 ve M0b bölümlerinde.
