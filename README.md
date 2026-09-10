# 🛒 Market Kasa POS - Modern Barkodlu Satış & Stok Yönetim Sistemi

Modern, çevrimdışı (offline-first) çalışabilen, çoklu cihaz senkronizasyonu ve bulut yedekleme destekli yeni nesil market ve bakkal hızlı satış (POS) sistemi.

Masaüstü (Windows - Electron), mobil (Android - Capacitor) ve web (PWA) platformlarında kusursuz çalışacak şekilde geliştirilmiştir.

---

## ✨ Öne Çıkan Özellikler

- ⚡ **Hızlı Barkodlu Satış:** USB barkod okuyucu veya telefon/tablet kamerasıyla anında ürün okuma.
- 📦 **Gelişmiş Stok & Ürün Kataloğu:** Otomatik barkod oluşturma, ürün kategorileri, kritik stok uyarıları ve hızlı fiyat güncelleme.
- 📒 **Müşteri & Veresiye Defteri:** Müşteri bazlı açık hesap (veresiye) takip, kısmi tahsilat, bakiye görüntüleme ve işlem geçmişi.
- 📊 **Detaylı Raporlama & Z-Raporu:** Günlük ciro, kâr/zarar analizi, en çok satan ürünler, nakit/kredi kartı/veresiye kırılımları ve PDF fiş/rapor çıktısı.
- 👥 **Kullanıcı & Rol Yönetimi:** Yönetici (Admin) ve Kasiyer yetkilendirmesi ile kasa güvenliği.
- 🔄 **Çoklu Cihaz Canlı Senkronizasyonu:** Yerel ağda WebSocket üzerinden çoklu kasa ve terminaller arasında anlık veri eşitleme.
- ☁️ **Google Drive Bulut Yedekleme:** İnternet bağlantısı olduğunda veritabanını Google E-Tablolar / Drive üzerine otomatik yedekleme.
- 📴 **%100 Çevrimdışı (Offline-First):** İnternet kesilse bile Dexie (IndexedDB) yerel veritabanı sayesinde satışlar kesintisiz sürer.

---

## 🛠️ Kullanılan Teknolojiler

- **Frontend:** React 19, Vite, Tailwind CSS
- **Masaüstü Platform:** Electron, Electron Builder (Windows .exe)
- **Mobil Platform:** Capacitor (Android APK)
- **Veritabanı:** Dexie.js (Client-side IndexedDB)
- **İletişim & Senkronizasyon:** WebSocket (`ws`), Google Drive Apps Script API
- **Barkod & Fiş:** `html5-qrcode`, `jspdf`, `lucide-react`

---

## 🚀 Kurulum ve Çalıştırma

### Gereksinimler
- Node.js (v18+)
- npm veya yarn

### Adımlar

1. **Depoyu klonlayın veya indirin:**
   ```bash
   git clone https://github.com/KULLANICI_ADINIZ/market-kasa-pos.git
   cd market-kasa-pos
   ```

2. **Bağımlılıkları yükleyin:**
   ```bash
   npm install
   ```

3. **Geliştirici modunda başlatın (Web):**
   ```bash
   npm run dev
   ```

4. **Masaüstü (Electron) olarak çalıştırma:**
   ```bash
   npm run electron:start
   ```

5. **Windows Kurulum Dosyası (.exe) Üretme:**
   ```bash
   npm run electron:installer
   ```

---

## 📄 Lisans

Bu proje MIT lisansı altında lisanslanmıştır.
