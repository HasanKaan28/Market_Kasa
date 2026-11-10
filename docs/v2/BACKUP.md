# Yedekleme ve geri yükleme

Ücretsiz Supabase planı kendi yedeğini tutmaz. Market verisi iki yolla yedeklenir.

| Yedek | Ne zaman | Nerede | İçinde ne var |
|---|---|---|---|
| **Gece yedeği** | Her gece 03:00 (İstanbul) | GitHub → Actions → "v2 backup" → çalıştırma → Artifacts. 90 gün saklanır. | Sunucudaki bütün marketler, kasalar ve kayıtlar (`app` şeması) ile hesaplar (`auth.users`, `auth.identities`). Şifreli. |
| **"Yedek al"** | Market sahibi istediğinde | Ayarlar → Yedek → "Yedek al". Dosya cihaza iner (`market-kasa-yedek-<market>-<tarih>.json`). | O kasanın gördüğü bütün market verisi, henüz gönderilmemiş satışlar dahil. Şifresiz: USB bellekte ya da e-postada saklayın. |

## Kurulum (bir kez)

GitHub → Settings → Secrets and variables → Actions → **New repository secret**:

1. **`SUPABASE_DB_URL`:** Supabase → proje → **Connect** → **Session pooler** bağlantı adresi. İçindeki `[YOUR-PASSWORD]` yerine veritabanı şifresi yazılır. Doğrudan `db.<ref>.supabase.co` adresi işe yaramaz: yalnız IPv6'dır, GitHub makinelerinde IPv6 yok.
2. **`BACKUP_PASSPHRASE`:** En az 16 karakterlik bir parola. **Bu parola olmadan yedekler açılamaz.** Bir parola yöneticisinde saklayın.

Sonra Actions → "v2 backup" → **Run workflow** ile ilk yedeği elle alın ve yeşil bittiğini görün.

Zamanlanmış iş akışları yalnız deponun varsayılan dalında çalışır. Varsayılan dal `v2` değilse gece yedeği kendiliğinden başlamaz.

Gece yedeği aynı zamanda veritabanına her gün istek atar; bu, ücretsiz projenin "etkinlik yok" diye duraklatılmasını da önler.

## Gece yedeğini açmak

```bash
gpg --decrypt market-kasa-2026-11-10.tar.gpg > yedek.tar
tar -xf yedek.tar
```

`market-kasa-2026-11-10/` klasöründe `app.dump` ve `auth.dump` çıkar.

## Geri yükleme

Geri yüklemeden önce bütün kasaları kapatın. Yedekten sonra yapılan ve sunucuya ulaşmış satışlar geri yüklemeyle sunucudan silinir. Kasalarda hâlâ duran gönderilmemiş satışlar ise kasalar açılınca yeniden gönderilir.

**Aynı projede, market verisi bozulduysa:**

```bash
pg_restore --clean --if-exists --no-owner --schema=app -d "$SUPABASE_DB_URL" market-kasa-2026-11-10/app.dump
```

**Yeni bir projeye, eski proje tamamen kaybolduysa:**

```bash
pg_restore --data-only --no-owner -d "$NEW_DB_URL" market-kasa-2026-11-10/auth.dump
pg_restore --no-owner -d "$NEW_DB_URL" market-kasa-2026-11-10/app.dump
```

Ardından yeni projede:

1. Authentication → Sign In / Providers: **Allow anonymous sign-ins** açık, **Confirm email** kapalı.
2. GitHub depo değişkenleri `VITE_SUPABASE_URL` ve `VITE_SUPABASE_PUBLISHABLE_KEY` yeni projeye çevrilir.
3. Yeni bir `v2.x.y` sürümü yayımlanır. Kasalar güncellenince yeni sunucuya bağlanır.

**"Yedek al" dosyasından:** uygulamada geri yükleme düğmesi yok. Dosyayı operatöre verin; kayıtlar sunucuya elle aktarılır.
