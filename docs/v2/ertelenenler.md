# Ertelenen işler

Son incelemelerde ertelenen küçük bulgular ve ileri aşamalara bırakılan işler, gidecekleri aşamaya göre. Her yeni plan yazılmadan önce bu dosya okunur: plana alınan madde buradan silinir, aşaması değişen madde taşınır. Parantez içi maddenin kaynağıdır (hangi planın son incelemesi).

## M2e · Kasa cilası

### Okutma, arama ve klavye

- Okuyucu zamanı işleyicide `performance.now()` ile ölçülüyor; 50 ms'yi aşan bir donma taramayı bölebilir. (M2a)
- İmleç metnin ortasındayken okutulan kod alanda kalıyor. (M2a)
- "5lt", "cola1L" gibi aramalar barkod sanılıyor; Enter yeni ürün penceresini açıyor. (M2a)
- F1 için ekranda ipucu yok; pencere açıkken F1 Chrome yardımını açıyor. (M2a)

### Sepet ve ödeme

- `parseTRY` binlik gruplamayı denetlemiyor ("0.500" → ₺500,00). (M0)
- "Alınan tutar" için üst sınır yok. (M2a)
- Yalnız kartla ödemede `cashGiven` verilirse para üstü yazılıyor. (M1a)
- ₺0'lık sepet: yalnız ₺0,00'lık ürünle satılamıyor; tamamen indirimli sepet ödeme yollarında tutarsız, bölünmüşte ödemesiz satış oluşuyor ve iadesi alınamıyor. (M2a, M2c)
- Açık ödeme penceresinin toplamı sepet yenilenince sessizce değişiyor; müşteri seçiminde toplam görünmüyor ve borç tek dokunuşta yazılıyor. (M2a)
- Sepet indirimi penceresi mevcut indirimi göstermiyor; boş alanla "Uygula" indirimi sessizce kaldırıyor. (M2c)
- İndirim girişi: "%10" ve "10%" reddediliyor; "%"ye geçince dolu tutar hata veriyor. (M2c)
- "Sepeti temizle" geri alınamıyor; satırların Azalt/Artır etiketleri aynı. (M2a)
- Satır adındaki düzenleme butonu 44 px'ten küçük. (M2c)

### Bekletme, iptal ve iade

- Bekleyenler: aynı dakikadaki iki sepetin etiketi aynı, eski günlerin tarihi yok, sepeti açmadan silmenin yolu yok. (M2b)
- Boş sepette "Beklet" pasif, oysa F8 listeyi açıyor. (M2b)
- Bu arada iptal edilmiş satışın iadesi genel "İade kaydedilemedi." mesajını veriyor. (M2b)
- İptal penceresinin hataları duyurulmuyor ve neden alanı hatalı görünüyor; nakit satışta da "veresiye geri alınır" yazıyor; iptal bildirimi tutarı söylemiyor. (M2b)

### Fiş

- `printReceipt` yalnız olaylardan ve async koddan çağrılmalı (StrictMode'da effect'ten iki kez ve boş yazdırıyor); "Yazdır"a çift tıklama yazdırma penceresini iki kez açıyor. (M2d)
- Sütun genişliğini aşan satırlar: uzun müşteri satırı bölünmüyor; satırdan uzun tek kelime "…" olmadan kesiliyor. (M2d)
- İadesi olan satışın fişi "İADESİ VAR" yazıyor ama iade tutarını ve yolunu göstermiyor. (M2d)
- Fiş görünümünde erişilebilirlik: `dt`/`dd`'siz `dl`, §13'ün 14 px sınırının altında 13 px yazı, ekran okuyucuya giden `***`, odaklanamayan kaydırma kutusu. (M2d)
- Fiş ayarları metni sessizce kesiyor (dördüncü satır, 48 karakterden sonrası; boş satırlar sayılıyor; alt bilgi ipucu sınırı söylemiyor). (M2d)
- Yazdırma hataları sessiz: "Fiş yazdırılamadı." bildirimi yok. (M2d)
- Metin: "KDV %0 ₺0,00" satırı; "Alınan" yerine "Nakit alınan"; "WhatsApp" yerine bağlantı olarak "WhatsApp ile gönder"; "0090…" diye kayıtlı telefon kayboluyor. (M2d)
- "Fiş ayarları" düğmesi listenin altında, pencere başlığında değil. (M2d)

### Bildirimler, odak ve erişilebilirlik

- Satıştan sonra odak sayfada kalıyor; arama alanına dönmeli. (M2a)
- Hata bildirimleri 4 saniyede kayboluyor; aynı mesaj ikinci kez gösterilmiyor. (M2a)
- IndexedDB hataları (okutma, arama Enter'ı, "Ekle") mesaj göstermiyor. (M2a)
- Bölünmüş ödeme ve sepet indirimi pencereleri "Kapat"ta açılıyor; iç içe müşteri seçicinin ardından odak sayfaya düşüyor; para üstü ve hata metinleri duyurulmuyor. (M2c)
- Danger butonda kısayol etiketi kontrastı ~4,2:1. (M0)

### Test boşlukları

- Pencereler açıkken okutma ve kısayollar; arayüzden veresiye iptali ve iadesi. (M2b)
- Boş sepette Bölünmüş ve İndirim; ekrandan veresiyeli bölünmüş satış ve limit hatası; eski biçimli bekleyen sepet. (M2c)
- İadeden sonra otomatik yazdırma olmaması; gerçek bir iadenin fişe "İADESİ VAR" yazması. (M2d)

## M0b · Sunucu ve eşitleme

- Kaybolan onay senaryosunun testi yok: `loseNextAck()` ve yakınsama testine kayıp onay, barkod düzenleme, gönderimle çekme arası yazım, rastgele `batchSize`/`overlap` eklenmeli. (M1b)
- Silinmiş bir ürün çakışan barkodu kazanabiliyor; canlı ürün barkodsuz kalıyor. (M1b)
- Koşucu: hata atan bir abone temiz bir eşitlemeyi hataya çeviriyor; hiç bitmeyen bir istek koşucuyu donduruyor. (M1b)
- Gönderim ve çekme döngüleri sunucunun sayılarına güveniyor (onaylanan sıra numaraları eşleştirilmiyor, `latest` ilerlemiyor mu bakılmıyor, `batchSize` ≤ 0 sonsuz döngü). (M1b)
- Satışın alt kayıtları satıştan önce kuyruğa giriyor; sunucu çocukları ebeveynden önce kabul etmeli. (M1a)
- Değişiklik olmayan güncelleme yine de `{updatedAt}` yaması gönderiyor. (M1a)
- Bilinmeyen ödeme yöntemi ve veresiyesiz satıştaki `customerId` çalışma anında denetlenmiyor. (M1a)
- Sunucudan gelen satış, iptal ve iade satırları şekil denetiminden geçmiyor; bozuk bir satış fiş görünümünü düşürüyor. (M2b, M2d)
- Fişteki satır tutarları ve ara toplam satıştan okunmuyor, yeniden hesaplanıyor. (M2d)
- Yeniden basılan fiş, satışı yapan kasanın değil bu cihazın adını yazıyor. (M2d)
- Eşitleme rozeti ilk turdan önce "0 işlem bekliyor" gösteriyor; çevrimdışıyken bekleyen işlem sayısını göstermiyor (§15). (M2a)
- Test: satıştan önce gelen iptal ve iade; yakınsama testinde iptal ve iade. (M2b)
- Sunucu barkodu büyük harfe çevirmeli ve market içinde benzersiz tutmalı; silinmiş ürünün barkodu bırakması istemcideki kuralla aynı olmalı. (M3a)

## M3 · Ürün ve stok

M3a (ürün kataloğu) ekranlar arası geçişi, Ürünler ekranını, ürün formunu, kategorileri ve kasada kategori seçimini getirir. M3'ün kalan alt planları:

- **M3b · İçe/dışa aktarma ve toplu fiyat:** sütun eşlemeli CSV/XLSX içe aktarma ve önizleme, düzgün CSV dışa aktarma, toplu fiyat güncelleme, barkoddan ad önerisi (Open Food Facts). (DESIGN §10)
- **M3c · Mal kabul ve stok hareketleri:** Stok ekranı, mal kabul (alış ve satış fiyatını güncelleyerek), ürün bazında hareket geçmişi, elle stok düzeltme, kritik stok listesi. (DESIGN §10)
- **M3d · Sayım:** sayım farkı hareket olarak yazılır (DESIGN §10); sayım sürerken başka cihazda yapılan satışlar hesaba katılır.

Ertelenmiş maddeler:

- **M3c:** Tartılı satırlar birimini kaybedebiliyor (eski kayıt, `refresh`); sepet satırında, iade adımında ve fişte "kg" yok, çünkü satış satırı birim taşımıyor. (M2b, M2c, M2d)
- **M3c:** Aynı ürün iki satırda olursa iade ürün kimliğiyle arıyor (sepet satırları birleştirdiği için şimdilik oluşmuyor). (M2b)
- **M3d:** Kamera ile okutma (DESIGN §10 Kasa, §15). M2a planı bunu M2b'ye bırakmıştı, M2b almadı. Kasada, Ürünler ekranında, mal kabulde ve sayımda kullanılacak. (M2a)

## M4 · Cari hesaplar

- İptal ya da iadeden sonra borç yaşı en eski borçtan düşülüyor, ilgili satışın borcundan değil. (M2b)
- `debtAgeDays` gün dönümü ayarını ve saat dilimini dikkate almıyor; `cutoffMinutes` için sınır yok. (M0)
- `addLedgerEntry` kendi transaction'ını açmıyor (bugün her çağıran açıyor). (M2b)
- Test: arşivli ya da bilinmeyen veresiye müşterisi, `cutoffMinutes`. (M1a)

## M6 · Yönetim

- Fiş ayarlarını her kasiyer değiştirebiliyor (roller). (M2d)
- Ürünleri ve kategorileri her kasiyer ekleyip silebiliyor (roller); yönetim ekranları için yan menü (§13). (M3a)

## M7 · e-Arşiv

- "Bilgi fişidir, mali değeri yoktur." faturalanan satışlarda yazılmamalı. (M2d)

## M8 · Yayın

- Electron: `electron/main.cjs`'de `setWindowOpenHandler` yok; WhatsApp `webSecurity: false` olan bir alt pencerede açılıyor. v2 Electron'da çalışmadan önce bağlantılar sistem tarayıcısına gitmeli. (M2d)
- Android/Capacitor'da yazdırma ve paylaşım (`window.print` WebView'da çalışmıyor); PDF. (M2d)
- Sessiz yazdırma: otomatik yazdırma açıkken okuyucu tuşları yazdırma penceresine gidiyor. (M2d)
- Pilotta denenecek: gerçek termal yazıcıda basılabilir genişlik (48/72 mm), Safari ve iOS'ta yazdırma, büyük bir sepetin WhatsApp metni telefonda. (M2d)
- Fiş logosu ayarı (§12). (M2d)
- `viewport-fit=cover` var, güvenli alan boşluğu yok. (M0)
- `version.test.ts` sürüm metnini sabit yazıyor. (M0)

## Kapananlar

Ertelendikten sonra başka bir planda kapanan maddeler: `isQuick` indeksi (M1b, şema sürüm 2); iade yöntemi seçeneklerinin klavye odağı (M2c'de seçim kalktı); iade bildiriminin paranın nasıl döndüğünü söylememesi (M2c).
