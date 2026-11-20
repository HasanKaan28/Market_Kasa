# Market Kasa v2 · M0b-1 Sunucu ve eşitleme — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasalar Supabase test projesi (`market-kasa-v2-test`) üzerinden eşitlenir. Sahip bir kasayı e-posta ve şifresiyle markete bağlar; bağlı iki kasa birbirinin satışını, stoğunu ve veresiyesini görür; internet yokken satış sürer, gelince kuyruk gider.

**Architecture:**
- **Saklama:** Sunucu her kaydı istemcinin gönderdiği JSON olarak tek bir tabloda tutar: `app.rows (market_id, tbl, id, server_seq, row jsonb)`. Kurallar sahte sunucunun (`src/sync/fakeServer.ts`) kurallarıyla aynıdır: işlem `opId` başına bir kez uygulanır, olay bir kez eklenir, varlık alan alan yamalanır (`null` alanı siler), ürün barkodu büyük harfe çevrilir ve markette tek sahibi olur.
- **Erişim:** `app` şeması Data API'ye açık değildir; `anon` ve `authenticated` rollerinin tablolarda hiçbir yetkisi yoktur. İstemci yalnız `public` içindeki birkaç RPC fonksiyonunu çağırır. Her fonksiyon `SECURITY DEFINER`, `search_path = ''`, `anon`'dan `EXECUTE` geri alınmış, gövdesinde `auth.uid()` ile cihaz ya da sahip denetimi var.
- **Eşitleme:** `sync_push(ops)` ve `sync_pull(since, lim)` Postgres fonksiyonlarıdır (Edge Function değil). Bir marketin bütün yazmaları `pg_advisory_xact_lock` ile sıraya girer. Böylece `server_seq` o markette commit sırasıyla artar ve çekme imleci geride kalan bir satırı atlamaz.
- **Cihaz kaydı:** Sahip kasada e-posta ve şifresiyle geçici, kaydedilmeyen bir oturum açar ve `create_pairing` ile tek kullanımlık bir kod alır. Sonra kasa anonim oturum açar ve `claim_device(code, …)` ile markete bağlanır. Cihazda yalnız anonim cihaz oturumu saklanır, sahibinki saklanmaz. Edge Function ve servis anahtarı gerekmez.
- **Testler:** Sunucu SQL'i Vitest içinde PGlite (WASM Postgres) üzerinde çalışır. `auth.uid()` ve `auth.jwt()` Supabase'deki gibi `request.jwt.claims` ayarından okunur. Mevcut eşitleme ve yakınsama testleri hem sahte sunucuyla hem SQL sunucusuyla koşar; ikisinin aynı kuralları uyguladığı böyle kanıtlanır.

**Tech Stack:** Supabase (Postgres 17, Auth anonim oturum), `@supabase/supabase-js` 2.118.0, `@electric-sql/pglite` 0.5.10 (yalnız test), Vitest, React 19.

**Spec:** [docs/v2/DESIGN.md](../DESIGN.md) §6 (veri modeli), §7 (eşitleme protokolü), §8.2 (cihaz kaydı), §8.4 (sunucu kuralları), §16 (RLS testleri); [ertelenenler.md](../ertelenenler.md) M0b bölümü.

**Spec'ten sapmalar:**
- §6 her tablo için ayrı sütunlu SQL tabloları çizer. Burada kayıtlar tek tabloda JSON olarak durur. Neden: istemcinin 18 tablosu ve iç içe satırları (`lines[]`, `payments[]`) olduğu gibi taşınır, sunucu kuralları sahte sunucuyla birebir aynı kalır. Raporlar sonradan bu tablonun üstüne görünümlerle yazılabilir. Yanlışsa bedeli: web panel raporları JSON alanlarından okunur, sorgular uzar; tabloya dönüşüm sonradan bir göç olur.
- §5 eşitleme için Edge Function (`sync-push`, `sync-pull`, `register-device`) çizer. Burada hepsi Postgres fonksiyonu. Neden: tek işlemde atomik, PGlite'ta test edilebilir, Edge Function kotası harcanmaz, servis anahtarı gerekmez. Edge Function e-Arşiv ve operatör için M0b-3'te gelir.
- §8.2 oturumu Electron'da `safeStorage`'da, Android'de güvenli depoda ister. Burada her platformda `localStorage`. Yanlışsa bedeli: ele geçirilen bir cihazdan cihaz oturumu okunur; o oturum yalnız o marketin eşitlemesini yapabilir ve sahip `revoke_device` ile kapatır. Güvenli depo M0b-3'te.
- §8.4'ün lisans, yetki ve son sahip denetimleri burada yok; sunucu yalnız market eşleşmesini, cihaz iptalini ve kayıt biçimini denetler (M0b-2).

## Senin adımların (koddan önce ya da Task 6'da)

1. Supabase panelinde `market-kasa-v2-test` → Authentication → Sign In / Providers → **Allow anonymous sign-ins** açılır.
2. Authentication → Users → **Invite user** ile sahip hesabı (senin e-postan) davet edilir; e-postadaki bağlantıyla şifre konur. Şifre bana verilmez.
3. Davet bitince bana e-postayı söylersin; `app.create_market` ile marketi ve sahipliği ben kurarım (yalnız SQL, hesap açmaz).

## Global Constraints

| Kural | Bu kuralı koruyan test | Bozma denemesi |
|---|---|---|
| Bir cihaz yalnız kendi marketinin satırlarını okur ve yazar. | Task 1 "keeps one market's rows from another market's device" | `sync_pull`'da `market_id` koşulu kalkar |
| İptal edilmiş cihaz ne gönderir ne çeker. | Task 1 "stops a revoked device" | `revoked_at` denetimi kalkar |
| Cihaza bağlı olmayan oturum (anonim ya da e-postalı) eşitleme yapamaz. | Task 1 "refuses a session that is not a device" | cihaz bulunamazsa ilk market kullanılır |
| `anon` ve `authenticated` `app` tablolarına doğrudan erişemez; `anon` hiçbir RPC'yi çağıramaz. | Task 1 "gives the client no way around the functions" | `grant select on app.rows to authenticated` |
| Aynı işlem iki kez gelirse bir kez uygulanır. | Task 2 contract "applies an operation once" | `applied_ops` denetimi kalkar |
| Olay değişmez: olaya yama reddedilir, var olan olay kimliğine ikinci ekleme yok sayılır. | Task 1 "never changes an event" | olaya yama uygulanır |
| Varlığa ikinci ekleme (aynı `id`) yama gibi birleşir; sonra gelen alan kazanır. | Task 2 contract "merges a second insert of a record" | `on conflict do nothing` |
| Sunucu kaydın alanlarını değiştirmez; yalnız barkodu büyük harfe çevirir ve çekişmeyi kaybeden üründen barkodu kaldırır. | Task 1 "keeps every field as the device sent it" | `occurredAt` sunucu saatiyle yazılır |
| Silinmiş ürün barkod çekişmesine girmez. | Task 2 contract "lets a deleted product give up its barcode" | `deletedAt` denetimi kalkar |
| Eşleme kodu bir kez ve 10 dakika içinde kullanılır. | Task 4 "uses a pairing code once" | `used_at` denetimi kalkar |
| Sahibin oturumu cihazda saklanmaz. | Task 5 "keeps no owner session on the device" | sahip istemcisi `persistSession: true` |
| Uygulamaya yalnız yayımlanabilir anahtar girer. | Task 5 "refuses a secret key in the app" | `sb_secret_` kabul edilir |
| Bir marketin yazmaları sırayla commit edilir (`server_seq` commit sırasıyla artar). | Okuyarak: `sync_push`, `claim_device` ve `revoke_device` ilk iş `app.lock_market(market_id)` çağırır | kilit kalkar |

## Review Focus

1. **Aynı anda iki gönderim ve gönderim sırasında çekme:** Kilit olmadan, yavaş bir gönderimin düşük `server_seq`'li satırları imleç geçtikten sonra commit edilir ve hiç çekilmez. Kilit her yazma yolunda var mı?
2. **Cevabı kaybolan gönderim:** Sunucu uyguladı, cevap gelmedi, kasa aynı işlemleri yeniden gönderdi. Hiçbir şey iki kez yazılmamalı, onay yine gelmeli.
3. **İlk kurulumda büyük çekme:** 20.000 ürün ve aylarca satış sayfalarla iner; `lim` 1–1000 arasına sıkıştırılır; yarıda kopan çekme kaldığı yerden sürer.
4. **Günlerce çevrimdışı kalan kasa:** Erişim jetonunun süresi dolmuştur; geri gelince oturum yenilenmeli, yenilenemezse kasa "yeniden bağla" demeli, kuyruk silinmemeli.
5. **`yerel` verisi olan kasayı bağlamak:** Kasada denemeyle girilmiş satışlar ve kuyruk var. Sahip "Gönder" ya da "Boş başla" seçer; "Boş başla" eski kuyruğu göndermemeli ama silmemeli de.

Her biri ilgili görevin testlerinde var: 1 → Task 1 "takes the market lock before every write" (fonksiyon gövdesi), 2 → Task 2 "survives a lost acknowledgement", 3 → Task 1 "pages a large pull", 4 → Task 5 "asks to pair again when the session cannot be renewed", 5 → Task 5 "starts empty without sending the old queue".

---

### Task 1: Sunucu şeması ve eşitleme fonksiyonları

**Files:** Create `supabase/migrations/20261030120000_m0b1_sync.sql`, `supabase/tests/harness.ts`, `supabase/tests/sync.test.ts`; Modify `vite.config.ts` (test `include` `supabase/tests/**`), `package.json` (`@electric-sql/pglite` 0.5.10, devDependency, sabit sürüm)

**Interfaces:**
- **Produces (SQL):**
  - `app.markets(id text pk check (id ~ '^[a-z0-9-]{1,64}$'), name text, status text check in ('active','suspended') default 'active', license_expires_at timestamptz, created_at timestamptz)`
  - `app.memberships(market_id, user_id uuid, role text check in ('owner','manager'), pk(market_id, user_id))`
  - `app.devices(id uuid pk, market_id, auth_user_id uuid unique, code text check (code ~ '^[A-Z][A-Z0-9]{0,3}$'), name text, platform text, created_at, last_seen_at, revoked_at)`; `unique (market_id, code) where revoked_at is null`
  - `app.rows(market_id, tbl text, id text, server_seq bigint, row jsonb, received_at timestamptz, pk(market_id, tbl, id))`, index `(market_id, server_seq)`; `app.applied_ops(market_id, op_id text, pk)`; sequence `app.server_seq`
  - `app.lock_market(market_id text)`: `pg_advisory_xact_lock(hashtext('market:' || market_id))`
  - `app.current_device() returns app.devices`: `auth.uid()`'e bağlı, iptal edilmemiş, marketi `active` cihaz; yoksa `raise exception 'device_not_registered'` (iptal edilmişse `'device_revoked'`)
  - `public.sync_push(ops jsonb) returns jsonb` → `{ "acknowledged": [seq…], "rejected": [{ "seq", "reason" }…] }`. Tablo adları `OutboxTable` listesiyle aynı; yama yalnız varlık tablolarına (`products, customers, categories, suppliers, staff, settings, invoices`). Bilinmeyen tablo ya da tür → `rejected` (`reason: 'unknown_table'`, `'not_patchable'`). Reddedilen kaydın `server_seq`'i artırılır (yeniden gönderilir). Cihazın `last_seen_at`'i güncellenir.
  - `public.sync_pull(since bigint, lim int) returns jsonb` → `{ "rows": [{ "table", "id", "serverSeq", "row" }…], "latest" }`; `lim` 1–1000'e sıkıştırılır, `since < 0` → 0.
  - Her `public` fonksiyonu: `security definer set search_path = ''`, `revoke execute … from public, anon`, `grant execute … to authenticated`.
- **Produces (TS):** `createTestServer(): Promise<TestServer>`; `TestServer.as(userId: string | null)` (`null` = `anon`), `.query(sql, params)`, `.addMarket(id, name)`, `.addDevice(marketId, code): Promise<{ userId, deviceId }>`, `.addOwner(marketId): Promise<string>`. Harness `auth` şemasını (`auth.users`, `auth.uid()`, `auth.jwt()` → `request.jwt.claims`), `anon` ve `authenticated` rollerini kurar, sonra `supabase/migrations/*.sql`'i sırayla uygular.
- [ ] **Step 1:** Testleri yaz (dosya başında `// @vitest-environment node`):
  - `it("keeps one market's rows from another market's device")` — A marketinin cihazı satış gönderir; B'nin cihazının `sync_pull(0, 100)` sonucu `rows: []`; B'nin aynı `id` ile gönderdiği satış A'nın satırını değiştirmez.
  - `it('stops a revoked device')` — `revoked_at` dolu cihazın `sync_push` ve `sync_pull` çağrısı `device_revoked` hatası verir.
  - `it('refuses a session that is not a device')` — cihazı olmayan kullanıcı ve sahip kullanıcısı `device_not_registered` alır.
  - `it('gives the client no way around the functions')` — `authenticated` olarak `select * from app.rows` yetki hatası; `anon` olarak `select public.sync_pull(0, 10)` yetki hatası.
  - `it('never changes an event')` — `sales` kaydına yama `rejected: [{ seq, reason: 'not_patchable' }]`; aynı `id` ile farklı içerikli ikinci ekleme onaylanır ama satır ilk hâliyle kalır.
  - `it('keeps every field as the device sent it')` — `occurredAt: '2026-10-30T07:05:00.000Z'`, `total: 4250`, `lines[0].qtyMilli: 1500` çekmede aynen döner.
  - `it('pages a large pull')` — 2.500 ürün; `lim` 1000 ile üç sayfa, sıralı ve eksiksiz; `lim: 5000` 1000 döner; `since: -3` 0 gibi davranır.
  - `it('takes the market lock before every write')` — `pg_get_functiondef` ile `sync_push`, `claim_device`, `revoke_device` gövdelerinde `app.lock_market(` geçer.
- [ ] **Step 2:** `npx vitest run supabase/tests/sync.test.ts` → FAIL (göç dosyası yok).
- [ ] **Step 3:** Göçü ve harness'i yaz.
- [ ] **Step 4:** Aynı komut → PASS; `npm test` tamamı yeşil.
- [ ] **Step 5:** Commit — `git commit -m "feat(server): sync schema and push/pull functions, tested on PGlite"`

### Task 2: Sahte sunucu ile SQL sunucusu aynı kuralları uygular

**Files:** Create `supabase/tests/sqlTransport.ts`, `src/sync/contract.test.ts`; Modify `src/sync/fakeServer.ts`, `src/sync/convergence.test.ts`

**Interfaces:**
- **Consumes:** Task 1 `TestServer`, `sync_push`, `sync_pull`.
- **Produces:** `sqlTransport(server: TestServer, userId: string): SyncTransport`. `SERVERS: { name: string; make(): Promise<{ device(code): Promise<SyncTransport> }> }[]` — `fake` ve `sql`; testler `describe.each(SERVERS)` ile iki sunucuda koşar. İki sunucuda da `loseNextAck()`: sıradaki gönderimi uygular, cevabı atıp hata fırlatır. Sahte sunucuya iki kural eklenir: silinmiş ürün (`deletedAt` dolu) barkod çekişmesine girmez; varlığa ikinci ekleme yama gibi birleşir.
- [ ] **Step 1:** Testleri yaz, her biri iki sunucuda:
  - `it('applies an operation once')` — aynı `opId` iki gönderimde; stok hareketi bir kez.
  - `it('survives a lost acknowledgement')` — sunucu uygular, cevap atılır (`loseNextAck`), kasa yeniden gönderir; satış bir, onay gelir, kuyruk boşalır.
  - `it('merges a second insert of a record')` — iki kasa çevrimdışı market ayarını kaydeder (aynı `id`); sonra gönderenin alanı kazanır, öbürünün değiştirmediği alan kalır.
  - `it("lets a deleted product give up its barcode")` — küçük `id`'li silinmiş ürün ile büyük `id`'li canlı ürün aynı barkodda; barkod canlıda kalır.
  - `it('accepts a sale’s records before the sale')` — stok hareketi ve veresiye satıştan önce gelir; hepsi saklanır, çekmede üçü de iner.
  - `it('counts a void and a return that arrive before their sale')` — iptal ve iade satıştan önce çekilir; iki kasada stok ve bakiye aynı.
  - `it('agrees when two registers count the same product')` — iki kasa aynı ürünü sayar; ikisinde stok aynı ve iki sayım hareketi var.
  - `convergence.test.ts`: mevcut fast-check yakınsama testi `describe.each(SERVERS)` olur; rastgele `batchSize` (1–7), `overlap` (0–5), kayıp onay ve gönderimle çekme arasına yazma eklenir.
- [ ] **Step 2:** `npx vitest run src/sync` → yeni testler `sql` sunucusunda FAIL (taşıyıcı yok), `fake`'te iki yeni kural FAIL.
- [ ] **Step 3:** `sqlTransport`'u yaz, sahte sunucuya iki kuralı ekle, Task 1 göçüne aynı iki kuralı ekle (göç henüz hiçbir yere uygulanmadı, aynı dosya düzenlenir).
- [ ] **Step 4:** `npx vitest run src/sync supabase` → PASS; `npm test` tamamı yeşil.
- [ ] **Step 5:** Commit — `git commit -m "test(sync): one contract for the fake and the SQL server"`

### Task 3: Eşitleme motorunu sunucuya hazırla

**Files:** Modify `src/sync/engine.ts`, `src/sync/runner.ts`, `src/sync/engine.test.ts`, `src/sync/runner.test.ts`

**Interfaces:**
- **Produces:** `syncOnce` yalnız gönderdiği `seq`'leri onaylar (sunucunun fazladan döndürdükleri yok sayılır); çekmede `latest` ilerlemezse döngü biter; `batchSize < 1` → `RangeError`. `createSyncRunner`: bir abonenin hatası diğerlerini ve turu bozmaz; `requestTimeoutMs` (varsayılan 30.000) geçen tur `error` olur ve sıradaki tur başlayabilir; ilk tur bitmeden durum `pendingCount`'u gerçek kuyruktan okur (çevrimdışıyken de).
- [ ] **Step 1:** Testler: `it('acknowledges only what it sent')`, `it('stops pulling when the server does not move on')`, `it('refuses a batch size below one')`, `it('keeps syncing when a listener throws')`, `it('gives up on a request that never answers')`, `it('shows the real queue before the first round')`.
- [ ] **Step 2:** `npx vitest run src/sync` → yeni altı test FAIL.
- [ ] **Step 3:** Uygula.
- [ ] **Step 4:** Aynı komut → PASS; `npm test` yeşil.
- [ ] **Step 5:** Commit — `git commit -m "fix(sync): trust only what was sent, never hang, show the real queue"`

### Task 4: Cihaz kaydı fonksiyonları

**Files:** Modify `supabase/migrations/20261030120000_m0b1_sync.sql`; Create `supabase/tests/pairing.test.ts`

**Interfaces:**
- **Produces (SQL):**
  - `app.pairings(code text pk, market_id, created_by uuid, expires_at timestamptz, used_at timestamptz)`
  - `public.owner_markets() returns jsonb` → `[{ "id", "name" }]`, yalnız `owner` üyelikleri; anonim oturum `[]`.
  - `public.create_pairing(market_id text) returns text` — çağıran o marketin `owner`'ı ve anonim değil (`auth.jwt()->>'is_anonymous'`); 8 karakter (`A–Z`, `2–9`, karışan `0 O 1 I` yok), 10 dakika geçerli.
  - `public.claim_device(code text, device_code text, device_name text, platform text) returns jsonb` → `{ "marketId", "marketName", "deviceId", "deviceCode" }`. Kod kullanılmamış ve süresi geçmemiş olmalı (`update … where used_at is null and expires_at > now() returning`); çağıranın zaten cihazı varsa `already_registered`; kasa kodu markette kullanımdaysa `device_code_taken`; `platform` `windows | android | web` dışıysa `bad_platform`.
  - `public.my_device() returns jsonb` → `{ marketId, marketName, deviceId, deviceCode, revoked }` ya da `null`.
  - `public.revoke_device(device_id uuid) returns void` — yalnız o marketin `owner`'ı.
  - `app.create_market(id text, name text, owner_email text) returns void` — yalnız `postgres` rolü (operatör SQL düzenleyicisinden çalıştırır); `auth.users`'da e-posta yoksa `owner_not_found`.
- [ ] **Step 1:** Testler: `it('lists only the markets a person owns')`, `it('gives a pairing code only to an owner who signed in with a password')`, `it('uses a pairing code once')` (aynı kodla ikinci `claim_device` `pairing_invalid`), `it('refuses an expired code')`, `it('keeps register codes unique in a market')` (iptal edilen cihazın kodu yeniden kullanılabilir), `it('lets only the owner revoke a device')`, `it('tells a device where it belongs')`, `it('opens a market only from the operator role')`.
- [ ] **Step 2:** `npx vitest run supabase/tests/pairing.test.ts` → FAIL.
- [ ] **Step 3:** Uygula.
- [ ] **Step 4:** Aynı komut → PASS; `npm test` yeşil.
- [ ] **Step 5:** Commit — `git commit -m "feat(server): pair a register to a market with a one-time code"`

### Task 5: Kasayı sunucuya bağlama

**Files:** Create `src/server/config.ts` ve testi, `src/server/client.ts`, `src/server/pairing.ts` ve testi, `src/sync/supabaseTransport.ts` ve testi, `src/settings/PairDialog.tsx` ve testi, `.env.example`; Modify `src/app/device.ts` ve testi, `src/app/appData.ts` ve testi, `src/settings/MarketSections.tsx`, `package.json` (`@supabase/supabase-js` 2.118.0, sabit sürüm), `.github/workflows/v2-ci.yml` ve `v2-release.yml` (yapıya `VITE_SUPABASE_URL` ve `VITE_SUPABASE_PUBLISHABLE_KEY` depo değişkenlerinden, sır değil)

**Interfaces:**
- **Consumes:** Task 4 RPC'leri; Task 3 `createSyncRunner`.
- **Produces:**
  - `serverConfig(env): { url: string; key: string } | null` — `VITE_SUPABASE_URL` (`https://`) ve `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_` ile başlar); `sb_secret_` ya da `service_role` içeren anahtar `null` ve konsola uyarı.
  - `deviceClient(config)`: oturumu `localStorage` `mk2.auth` anahtarında saklayan istemci. `ownerClient(config)`: `persistSession: false, autoRefreshToken: false`.
  - `supabaseTransport(client, { timeoutMs }): SyncTransport` — `rpc('sync_push', { ops })`, `rpc('sync_pull', { since, lim })`; `device_revoked` → `DeviceRevokedError`, `device_not_registered` ya da yenilenemeyen oturum → `DeviceUnpairedError`.
  - `pairDevice({ config, email, password, marketId?, deviceCode, deviceName, platform }): Promise<DeviceSettings>` — sahip istemcisiyle giriş, `owner_markets`, `create_pairing`, sahip oturumunu kapat; cihaz istemcisiyle `signInAnonymously`, `claim_device`.
  - `DeviceSettings` yeni alanlar: `databaseId?: string` (yoksa `marketId`), `paired?: boolean`. `openMarketDb(settings.databaseId ?? settings.marketId)`.
  - `createAppData`: yapılandırma varsa ve cihaz bağlıysa `supabaseTransport`, `isOnline: () => navigator.onLine`, `runner.start()`; değilse bugünkü `NO_SERVER`.
  - Ayarlar → "Bu kasa": "Sunucuya bağla" düğmesi (yapılandırma yoksa gizli) → `PairDialog`: e-posta, şifre, birden çok market varsa seçim, kasa kodu ve adı. Kasada `yerel` verisi varsa iki seçenek: "Bu kasadaki N işlemi markete gönder" (aynı `databaseId`) ya da "Boş başla" (yeni veritabanı, eski veri silinmez). Hatalar: "E-posta ya da şifre yanlış.", "Bu hesabın sahibi olduğu market yok.", "K2 kodu bu markette kullanılıyor.", "Bağlantı kurulamadı. İnternet bağlantısını kontrol edin."
  - Eşitleme durumu: `DeviceRevokedError` → "Bu kasanın kaydı iptal edildi."; `DeviceUnpairedError` → "Kasayı yeniden bağlayın." Kuyruk silinmez.
- [ ] **Step 1:** Testler: `it('refuses a secret key in the app')`, `it('keeps no owner session on the device')` (sahte auth istemcisi `persistSession` bayrağını kaydeder), `it('pairs a register and remembers its market')`, `it('sends this register’s queue to the market when asked')`, `it('starts empty without sending the old queue')` (eski veritabanı ve kuyruğu yerinde), `it('asks to pair again when the session cannot be renewed')`, `it('says when the register code is taken')`, `it('hides pairing when the app has no server')`.
- [ ] **Step 2:** `npx vitest run src/server src/sync/supabaseTransport.test.ts src/settings/PairDialog.test.tsx src/app` → FAIL.
- [ ] **Step 3:** Uygula.
- [ ] **Step 4:** Aynı komut → PASS; `npm test`, `npm run lint`, `npm run typecheck` yeşil.
- [ ] **Step 5:** Commit — `git commit -m "feat(sync): pair a register to its market and sync through Supabase"`

### Task 6: Test projesine kurulum ve iki kasayla deneme

**Files:** Modify `README.md` ("Not built yet" ve kurulum), `docs/v2/ertelenenler.md`, bu planın "Uygulama notları"; Create `.env.local` (yerel, git dışında)

- [ ] **Step 1:** Göç MCP `apply_migration` ile `market-kasa-v2-test`'e uygulanır; `list_tables` ile `app` tabloları, `get_advisors` (security ve performance) ile uyarılar okunur; her uyarı düzeltilir ya da gerekçesiyle notlara yazılır.
- [ ] **Step 2:** "Senin adımların" 1–2 bitince `select app.create_market('kursunlu', 'Kurşunlu Market', '<e-posta>')` MCP `execute_sql` ile çalışır.
- [ ] **Step 3:** `.env.local`'e proje adresi ve yayımlanabilir anahtar (`get_publishable_keys`) yazılır; `npm run dev`.
- [ ] **Step 4:** İki ayrı tarayıcı bağlamı K1 ve K2 olarak bağlanır. Sahip şifresini bağlama penceresine sen yazarsın; şifre sohbete ya da dosyaya yazılmaz. Denenecekler: K1'de satış → K2'de görünür; K2 çevrimdışı satış → internet gelince K1'de; aynı ürün iki kasada satılır → stok iki kez düşer; K2 iptal edilir → K2 "kaydı iptal edildi" der.
- [ ] **Step 5:** README ve ertelenenler güncellenir, notlar yazılır. Commit — `git commit -m "docs(v2): M0b-1 server setup, verification and backlog"`

## Bu planın dışında (ertelenenler.md M0b listesinin her maddesi)

| Madde | Yeri |
|---|---|
| Kayıp onay, rastgele `batchSize`/`overlap`, gönderimle çekme arası yazım testi (M1b) | Bu plan, Task 2 |
| Silinmiş ürün barkodu kazanıyor (M1b) | Bu plan, Task 2 |
| Koşucu: hata atan abone, bitmeyen istek (M1b) | Bu plan, Task 3 |
| Döngüler sunucunun sayılarına güveniyor (M1b) | Bu plan, Task 3 |
| Alt kayıtlar satıştan önce geliyor (M1a) | Bu plan, Task 2 |
| İlk turdan önce "0 işlem bekliyor"; çevrimdışı sayı (M2a) | Bu plan, Task 3 |
| Satıştan önce gelen iptal ve iade testi (M2b) | Bu plan, Task 2 |
| İki kasanın aynı ürünü sayması testi (M3d) | Bu plan, Task 2 |
| Sunucu barkodu büyük harfe çevirir, markette tek tutar (M3a) | Bu plan, Task 1–2 |
| Market ayarında ilk ulaşan kazanıyor (M6b) | Bu plan, Task 2 (ikinci ekleme birleşir) |
| `occurredAt` biçimini sunucu korur (M3c) | Bu plan, Task 1 |
| Değişiklik olmayan güncelleme yine yama gönderiyor (M1a) | M0b-2 |
| Bilinmeyen ödeme yöntemi, veresiyesiz `customerId` (M1a) | M0b-2 (biçim denetimi) |
| Sunucudan gelen satırların şekil denetimi (M2b, M2d, M3a, M3c, M7; personel `pinIterations`) | M0b-2 |
| Kasalar arası sıra ve borç yaşı için sunucu sıra numarası (M3c, M4a) | M0b-2 (`serverSeq` bu planla gelir; kullanımı M0b-2) |
| Geri getirilen ürünün barkodu başkasında (M3a) | M0b-2 |
| Kesirli kritik seviye birleşmesi (M3b) | M0b-2 |
| İçe aktarma ve mal kabul fiyatlarının iz kaydı (M3b) | M0b-2 |
| İz kaydının bilinmeyen işlemleri (M6b) | M0b-2 |
| Lisans salt-okunurken yazılan olaylar (M6b) | M0b-2 (bu planda sunucu lisansa bakmaz) |
| Son sahip, personel denetimi, yönetimde yetki (M6a, M6) | M0b-2 |
| Fatura durum kuralı, iptalin faturayı geri çekmesi, iki isteğin birleşmesi (M7) | M0b-2 |
| Yeniden basılan fişte satan kasanın adı (M2d) | M0b-2 (cihaz adları bu planla sunucuda) |
| Mal kabul taslağı markete göre (M3c) | M0b-3 (çok marketli giriş) |
| Sahip oturumu ayarlar ve personel için (M6a I2) | M0b-3 |
| e-Arşiv sağlayıcı adaptörü, sahte sağlayıcının girişi (M7) | M0b-3 |
| Fişteki satır tutarları satıştan okunmuyor (M2d) | M2e · Kasa cilası (sunucuyla ilgisi yok) |
| Güvenli oturum deposu (§8.2), Realtime haberi (§7.4), web panel, operatör paneli | M0b-3 |
| Cihaz saati sapma uyarısı (§15; `received_at` bu planla saklanır) | M0b-2 |
| Sunucuda günlük yedek (§2.4) | Canlı proje: ücretli plan açılınca (test projesinde yedek yok) |
