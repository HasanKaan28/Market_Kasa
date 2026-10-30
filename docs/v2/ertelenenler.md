# Ertelenen işler

Son incelemelerde ertelenen küçük bulgular ve ileri aşamalara bırakılan işler, gidecekleri aşamaya göre. Her yeni plan yazılmadan önce bu dosya okunur: plana alınan madde buradan silinir, aşaması değişen madde taşınır. Parantez içi maddenin kaynağıdır (hangi planın son incelemesi).

## M2e · Kasa cilası

### Okutma, arama ve klavye

- İmleç metnin ortasındayken okutulan kod alanda kalıyor; alandaki metin seçiliyken okutma alanı boşaltıyor (mal kabulde fiyat kutusu). (M2a, M3c)
- "5lt", "cola1L" gibi aramalar barkod sanılıyor; Enter yeni ürün penceresini açıyor. (M2a)
- F1 için ekranda ipucu yok; pencere açıkken F1 Chrome yardımını açıyor. (M2a)
- Odak bir açılır listedeyken (`select`) harfli bir okutma seçimi değiştirebilir (doğrulanmadı). (M3a)

### Sepet ve ödeme

- `parseTRY` binlik gruplamayı denetlemiyor ("0.500" → ₺500,00). (M0)
- "Alınan tutar" için üst sınır yok. (M2a)
- Yalnız kartla ödemede `cashGiven` verilirse para üstü yazılıyor. (M1a)
- WhatsApp bağlantısı sabit hatları da `wa.me/90212…` yapıyor ve WhatsApp hata veriyor; yalnız 5xx cep numaralarına numara verilmeli. (M4a)
- ₺0'lık sepet: yalnız ₺0,00'lık ürünle satılamıyor; tamamen indirimli sepet ödeme yollarında tutarsız, bölünmüşte ödemesiz satış oluşuyor ve iadesi alınamıyor. (M2a, M2c)
- Açık ödeme penceresinin toplamı sepet yenilenince sessizce değişiyor; müşteri seçiminde toplam görünmüyor ve borç tek dokunuşta yazılıyor. (M2a)
- Sepet indirimi penceresi mevcut indirimi göstermiyor; boş alanla "Uygula" indirimi sessizce kaldırıyor. (M2c)
- İndirim girişi: "%10" ve "10%" reddediliyor; "%"ye geçince dolu tutar hata veriyor. (M2c)
- "Sepeti temizle" geri alınamıyor; satırların Azalt/Artır etiketleri aynı. (M2a)
- Satır adındaki düzenleme butonu 44 px'ten küçük. (M2c)
- Sepetteki satırlar yenilenirken (`refreshLines`) ürünün birimi güncellenmiyor; kaydedilen satış doğru. (M3c)

### Bekletme, iptal ve iade

- Bekleyenler: aynı dakikadaki iki sepetin etiketi aynı, eski günlerin tarihi yok, sepeti açmadan silmenin yolu yok. (M2b)
- Boş sepette "Beklet" pasif, oysa F8 listeyi açıyor. (M2b)
- Bu arada iptal edilmiş satışın iadesi genel "İade kaydedilemedi." mesajını veriyor. (M2b)
- İade penceresi tartılı satırı 1 kg adımla azaltıyor; 0,5 kg iade edilemiyor. (M3c)
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
- Kasada silinmiş ürünün barkodunu okutup yeni ürün kaydetmek; kasada küçük harfli okutma. (M3a)
- Birimi olmayan eski satırla iade penceresi. (M3c)
- Aynı ürün iki satırda olursa iade ürün kimliğiyle arıyor; sepet satırları birleştiği için şimdilik oluşmuyor. (M2b; M3c planı buraya taşıdı)

## M0b · Sunucu ve eşitleme

- Kaybolan onay senaryosunun testi yok: `loseNextAck()` ve yakınsama testine kayıp onay, barkod düzenleme, gönderimle çekme arası yazım, rastgele `batchSize`/`overlap` eklenmeli. (M1b)
- Silinmiş bir ürün çakışan barkodu kazanabiliyor; canlı ürün barkodsuz kalıyor. (M1b)
- Koşucu: hata atan bir abone temiz bir eşitlemeyi hataya çeviriyor; hiç bitmeyen bir istek koşucuyu donduruyor. (M1b)
- Gönderim ve çekme döngüleri sunucunun sayılarına güveniyor (onaylanan sıra numaraları eşleştirilmiyor, `latest` ilerlemiyor mu bakılmıyor, `batchSize` ≤ 0 sonsuz döngü). (M1b)
- Satışın alt kayıtları satıştan önce kuyruğa giriyor; sunucu çocukları ebeveynden önce kabul etmeli. (M1a)
- Değişiklik olmayan güncelleme yine de `{updatedAt}` yaması gönderiyor. (M1a)
- Bilinmeyen ödeme yöntemi ve veresiyesiz satıştaki `customerId` çalışma anında denetlenmiyor. (M1a)
- Sunucudan gelen satış, iptal, iade, kategori, mal kabul ve sayım satırları şekil denetiminden geçmiyor (satırsız bir sayım Sayım ekranındaki denetimi bozuyor): bozuk bir satış fiş görünümünü, adsız bir kategori kasayı ve Ürünler ekranını düşürüyor. (M2b, M2d, M3a, M3c)
- Kasalar arası hareket sırası saat kaymasında yanlış görünebilir; gerçek sıra için sunucu sıra numarası gerekir. `occurredAt` metin olarak karşılaştırılıyor; sunucu aynı ISO biçimini korumalı. (M3c)
- Mal kabul taslağı sekmeler arasında eşitlenmiyor ve markete göre anahtarlanmıyor (sepetle aynı); çok marketli girişte ele alınmalı. (M3c)
- Fişteki satır tutarları ve ara toplam satıştan okunmuyor, yeniden hesaplanıyor. (M2d)
- Yeniden basılan fiş, satışı yapan kasanın değil bu cihazın adını yazıyor. (M2d)
- Eşitleme rozeti ilk turdan önce "0 işlem bekliyor" gösteriyor; çevrimdışıyken bekleyen işlem sayısını göstermiyor (§15). (M2a)
- Test: satıştan önce gelen iptal ve iade; yakınsama testinde iptal ve iade. (M2b)
- Test: iki kasanın aynı ürünü saymasını `applyServerRows` ya da sahte sunucu üzerinden denemek. (M3d)
- Sunucu barkodu büyük harfe çevirmeli ve market içinde benzersiz tutmalı; silinmiş ürünün barkodu bırakması istemcideki kuralla aynı olmalı. (M3a)
- Geri getirilen ürünün barkodu bu arada başka cihazda başka ürüne verilmişse kullanıcıya bir şey söylenmiyor. (M3a)
- Saati geride bir kasanın iptali kendi satışının borcundan önce sıralanınca borç yaşı yanlış borçtan sayılıyor; gerçek sıra sunucu sıra numarasıyla gelir. (M4a)
- İki kasanın alan bazında birleşmesi, kritik seviyesi kesirli bir adetli ürün üretebilir; form sonra kaydetmeyi reddeder. (M3b)
- Fiyat değişiklikleri için iz kaydı (§2.3). (M3b) — M6b iz kaydı ekranda değişen fiyatları kaydediyor; içe aktarma ve mal kabul fiyatları kaydetmiyor.
- **Sahip oturumu (M6a I2):** ayarlar, personel ve dışa aktarma için sahibin Supabase Auth oturumu (§8.3); şimdilik sahip rolündeki PIN açıyor.
- Market ayarı sabit kimlikli tek satır: iki kasa eşitlemeden önce kaydederse sunucuya ilk ulaşan kazanıyor (§7.2 sonuncunun kazanmasını ister). (M6b)
- İz kaydının bilinmeyen işlemleri (ör. "yetkisiz" işaretli kayıtlar, §8.4) boş satır gösteriyor; açıklama metnine varsayılan dal gerekir. (M6b)
- Lisans salt-okunurken yerelde yazılan bir tahsilat ya da kasa hareketi sunucuda reddedilirse geri alınacak bir şey yok; salt-okunurda olay yazan bütün formlar kapanmalı ya da sunucu bunları kabul etmeli. (M6b)
- Sunucu: son aktif sahip kuralı, personel satırlarının denetimi, yönetim değişikliklerinde yetki denetimi için kuyruğa işlemi yapanın eklenmesi (§8.4). (M6a)
- **e-Arşiv sağlayıcı adaptörü** (§11): bekleyen istekleri keser, `ettn` ya da `error` yazar; sonuç eşitlemeyle kasalara gelir. Kasa `issued` durumunu hiç göndermez. (M7)
- Fatura durum kuralı sunucuda: kasadan gelen durum yamaları yalnız beklemede→iptal, hata→beklemede ve hata→iptal olabilir; başkası reddedilir ve satır yeniden gönderilir. Yoksa kesilmiş faturanın üstüne kuyruktaki bir iptal yazılır ve satış faturasız görünür. (M7)
- Satış iptali sunucuda da bekleyen fatura isteğini iptal etmeli; başka kasadan eşitlemeyle gelen iptal bu kasadaki isteği geri çekmiyor. Aynı satışa iki kasadan gelen istekleri sunucu birleştirmeli (ekranda "Aynı fişe ikinci istek" yazıyor). (M7)
- Sunucudan gelen fatura satırları şekil denetiminden geçmiyor; `buyer` alanı olmayan bir satır Faturalar ekranını düşürür. (M7)

## M3 · Ürün ve stok

M3a (ürün kataloğu) ekranlar arası geçişi, Ürünler ekranını, ürün formunu, kategorileri ve kasada kategori seçimini getirir. M3b içe/dışa aktarmayı, toplu fiyatı ve barkoddan ad önerisini getirir. M3c mal kabulü, stok düzeltmesini, hareket geçmişini ve kritik stok listesini getirir. M3d sayımı, kamerayla okutmayı ve M3b–M3c'den kalan içe aktarma ve mal kabul maddelerini getirir. M3'ün planı kalmadı. M3d incelemesinden kalan küçük maddeler, bir sonraki stok ve ürün cilasına:

- Sayım satırının hatası ve kayıt uyarısı satır düzeltilince kalkmıyor (mal kabulde satır hatası kalkıyor). (M3d)
- Barkod hücresinde "2E+12" genel mesaj alıyor; "sütunu metin yapın" önerisi çıkmıyor. (M3d)
- Parolalı .xlsx "Eski Excel" diye anılıyor. (M3d)
- Sayım denetimi her sayılan ürünün sayıma kadarki bütün geçmişini okuyor; geçmiş büyüdükçe yavaşlar. (M3d)
- Test: kamera açılmadan pencerenin kapanması. (M3d)

## M4 · Cari hesaplar

M4a veresiyeyi getirir: Müşteriler ekranı, tahsilat, düzeltme, ekstre ve WhatsApp hatırlatma. İncelemesinden kalan küçük maddeler (M4 cilası):

- Liste yüklenmeden "0 müşteri" yazıyor. (M4a)
- Reddedilen arşiv ya da tahsilat nedenini söylemiyor. (M4a)
- Limiti aşan bakiye yalnız renk ve kalınlıkla belirtiliyor; testi yok. (M4a)
- `customerSummaries` her cari satırında müşterinin listesini kopyalıyor (karesel). (M4a)
- Küçükler: iki alan testi `describe('stockLevel')` altında; yazdırma CSS'i ve sınıf adı hâlâ "receipt" diyor; hatırlatma ve ekstre sıralama eşitlikleri ve `customerSummaries`'te gün dönümü test edilmiyor. (M4a)
 M4b'nin planı taslak olarak yazıldı ([2026-10-29-m4b-tedarikciler.md](plans/2026-10-29-m4b-tedarikciler.md)) ve aşağıdaki maddeleri alır:

- M4b tedarikçileri getirir: Tedarikçiler ekranı, tedarikçi carisi (ödeme, düzeltme), mal kabulün tedarikçiye ve açık hesaba bağlanması, KDV hariç alış fiyatı, bedelsiz mal. Sahip "Bütün adımları bitir" diyerek kararlarıyla birlikte onayladı (2026-10-29). İncelemesinden kalan küçük maddeler (M4 cilası):
- Çevrimdışı iki kasada aynı adla eklenen tedarikçiler eşitlemeden sonra düzenlenemiyor (ad her kayıtta yeniden denetleniyor). (M4b)
- Fiyatı bilinmeyen ürünlerle açık hesap mal kabulü ₺0 kaydediliyor, fatura yazmıyor ve uyarmıyor. (M4b)
- Tedarikçi ödemesinin üst sınırı birim fiyat sabitini (`MAX_UNIT_PRICE`) kullanıyor. (M4b)
- "KDV hariç" açıkken dokunulmamış fiyat kutuları KDV dahil olduklarını söylemiyor. (M4b)
- Aynı tedarikçiden aynı fatura numarası için uyarı yok; nakit ve kartla ödenen mal kabuller tedarikçi ekstresinde görünmüyor. (M4b)

## M5 · Raporlar ve kasa

M5 tamamlandı. İncelemeden kalan küçük bulgular:

- Gece yarısından sonra alınan Z ertesi iş gününe yazılıyor. Gün dönümü ayarı (M6b) bunu çözer.
- Aynı satışın hem iptali hem iadesi eşitlemeyle gelirse (çakışma), bütün kasaların raporu iki kasanın nakdiyle uyuşmuyor.
- Başka kasada iptal edilen satış, "Tümü", K1 ve K2 süzgeçlerinde üç farklı görünüyor.
- Gün sonu penceresi ve yazdırılan Z, "kasa açılmadı" yazısına farklı ölçütle karar veriyor (nakit satış ve satış sayısı).
- Dünden açık kalan kasa yalnız saati gösteriyor ("Açık · 09:00"), tarihi göstermiyor.
- İki sekme aynı anda gün sonu alırsa iki Z kaydı yazılıyor (hiçbir rakam iki kez sayılmıyor).
- `data/cash.ts` ve `data/types.ts`, `reports/summary`'den içe aktarıyor; bugün çalışan ama kırılgan bir döngü (cash → summary → returns → ledger → cash). Özet hesabı `src/data` ya da `src/domain` altına taşınmalı.
- Küçük temizlikler: `csvText` üzerinde üst üste iki açıklama; bir rapor testi `URL.createObjectURL`'ı geri koymuyor; `cash.ts` "kasa günde bir açılır" diyor ama kod yalnız açık kasayı tekrar açtırmıyor.
- Uzun bir tarih aralığı her değişiklikte baştan okunuyor.
- **Cila için:** Nakit tahsilat, tedarikçiye nakit ödeme ve nakit mal kabul her zaman kasadan sayılıyor. Cepten ödenen para "nakit" yazılırsa Z'de kasa fazlası çıkar. Bu formlara "Kasadan" seçeneği eklenmeli (DESIGN §10: "kasadan ödeme").

## M6 · Yönetim

M6a (personel, PIN, izinler) tamamlandı; bu bölümün rol maddeleri ve gün dönümü maddesi kapandı. İncelemeden kalan küçük bulgular:

- Hatalı PIN sayacı okunup ayrı yazılıyor; aynı anda birkaç sekmeden deneme eksik sayılır.
- Son sahip kuralı yalnız bir cihazda geçerli: iki çevrimdışı kasa iki sahibi de pasife alabilir (sunucu kuralı M0b'de).
- Sunucudan gelen personel satırları denetlenmiyor (çok büyük `pinIterations` girişi kilitler).
- "Kilitle" öbür sekmeleri kapatmıyor; PIN değişikliği o kişinin açık oturumlarını bitirmiyor.
- Sağlayıcı dışında `useSession` her izni veriyor (bugün böyle bir kullanım yok).
- Kişiye özel izinler yalnız raporlarda tam uygulanıyor: maliyet izni kapalı biri ürün formunda alış fiyatını görüyor; ürün düzenleme izni olmayan stokçu mal kabulde fiyat değiştirebiliyor.
- Onaylayan kişi olayın kendisinde yok; M6b'nin iz kaydı onayları bundan sonra kaydediyor.
- Son sahibi düşürmeye çalışınca "pasife alınamaz" yazıyor; "Pasife al" onay sormuyor; kimse onaylayamıyorsa onay penceresi boş seçim gösteriyor; giriş ekranındaki gönderim hatayı yakalamıyor.
- Satır indirimi izinsiz kişiye gizleniyor, onaya sunulmuyor.
- Test eksikleri: oturumdayken rol değişmesi, kilit bitince yanlış PIN, pasif onaylayan, paralel PIN denemesi, yeni PIN'in kilidi kaldırması.
- Müşteri ve tedarikçi arşivden geri getirilemiyor. (M4b)

M6b (ayarlar, iz kaydı, lisans, personel raporu) tamamlandı. İncelemesinden kalan küçük maddeler:

- İz kaydında silinen alanlar `undefined` olarak kalıyor; eşitlemeden sonra öbür kasada "Ayşe: " diye boş görünüyor.
- Onay metni "Limit aşımı onayı onayı" diye kelime tekrarlıyor; onay kaydı yazılamazsa hata yutuluyor.
- Salt-okunur durumu yalnız ödeme penceresi açılırken bakılıyor; açık kalan pencere sınırı geçince satabiliyor.
- İz kaydı ekranı her değişiklikte bütün ürünleri ve personeli okuyor.
- Personel tablosundaki "Tutar" iade öncesi satıştır, öyle adlandırılmalı; "Silinmiş personel" çoğu zaman "henüz eşitlenmedi" demektir.

## Cila 1

Cila 1 tamamlandı; M5'in "kasadan ödeme", "kasa açılmadı" ölçütü ve dünden açık kasanın tarihi maddeleri ile M6a'nın son sahip ve boş onay penceresi maddeleri kapandı. İncelemeden kalan küçük maddeler:

- Tartılı iadede 0 kg reddediliyor ama testle sabitlenmedi; tamamı iade edilmiş tartılı satırın alanı hâlâ yazılabiliyor.
- Kasa penceresindeki açılış tarihi takvim gününe bakıyor, gün dönümüne bakmıyor.
- "Kasadan ödendi" seçimi cari hareketinde ve alışta saklanmıyor; sonradan cepten mi kasadan mı ödendiği görülmüyor.
- Eşitleme hiç etkin sahip bırakmazsa ayarlara nasıl dönüleceği (sunucu kuralı M0b'de).
- Ürün panelinin grup testi tam paket yükü altında bir kez zaman aşımına düştü; tek başına geçiyor.

## M7 · e-Arşiv

M7 (istemci tarafı) tamamlandı; "Bilgi fişidir" maddesi kapandı. Sağlayıcı adaptörü ve sunucu kuralları M0b bölümünde. İncelemeden kalan küçük maddeler:

- Hata almış bir istek de fişteki "Bilgi fişidir" satırını kaldırıyor. §12 "fatura kesilmemiş" diyor, plan "istenmiş" dedi; muhasebeciyle netleşmeli.
- Tamamı iade edilmiş bir satışa da fatura istenebiliyor.
- Sahte sağlayıcının (`settlePending`) geliştirmede bir girişi yok; sunucu olmadan uygulamada "Kesildi" ya da "Hata" görülemiyor.
- TCKN alanına boşluklu yapıştırılan numara hane kaybediyor (`maxLength` rakamlar ayıklanmadan kesiyor).
- Şahıs şirketi için kurumsal formda TCKN kabul ediliyor; sağlayıcı ve muhasebeci bunu onaylamalı.

## M8 · Yayın

M8 tamamlandı; geliştirici araçları (M6a I2) ve `setWindowOpenHandler` (M2d) maddeleri kapandı.

- **Önce yapılmalı — Android imzası:** yayın iş akışı her seferinde yeni bir makinede debug imzalı APK üretiyor; yeni APK eskisinin üstüne kurulamıyor, kaldırmak veriyi siliyor. Sabit bir imza anahtarı depo sırrı olarak eklenmeli (yalnız sahip ekleyebilir) ve iş akışı onunla imzalamalı. O zamana kadar README ve sürüm notu "önce dışa aktarın" diyor. (M8 I-3)
- Electron'da imzalı otomatik güncelleme (§8.7) yok; kurulum imzasız.
- v1'in kendi service worker önbelleği (`market-pos-v2`) aynı kaynakta silinmiyor; açılışta sayfa isteğinin zaman sınırı yok; `manifest.json` ve `logo.svg` önbellekte ama oradan verilmiyor.
- Electron: `serveApp` eksik dosyada 404 yerine ağ hatası veriyor; bütün izin istekleri sessizce veriliyor (yalnız kamera verilmeli).
- v1 aktarma: KDV'si %1 olan ürünler sayılıyor, listelenmiyor (§14 liste ister); KDV 8/18, eksi ya da kesirli adet stok ve 10.000 üstü stok düzeltilemeyen hatalı satır oluyor; `IMP-` ile başlayan uydurma kodlar gerçek barkod sayılıyor; v1 borcu "0 gün" görünüyor; kullanıcılar, satış geçmişi ve tedarikçi hareketleri aktarılmıyor.
- README: `allowBackup=false` cihazdan cihaza aktarımı durdurmuyor (`dataExtractionRules` gerekir); "v2 v1'i okuyamaz" yalnız masaüstünde doğru.
- İş akışındaki eylemler etiketle sabitlenmiş, commit SHA ile değil.
- Kurulum dosyası (NSIS) bu ortamda hiç üretilmedi; v1'in üstüne kurulumu ve asar içindeki yollar yalnız ayarlardan çıkarıldı.
- Android/Capacitor'da yazdırma ve paylaşım (`window.print` WebView'da çalışmıyor); PDF. (M2d)
- Sessiz yazdırma: otomatik yazdırma açıkken okuyucu tuşları yazdırma penceresine gidiyor. (M2d)
- Pilotta denenecek: gerçek termal yazıcıda basılabilir genişlik (48/72 mm), Safari ve iOS'ta yazdırma, büyük bir sepetin WhatsApp metni telefonda. (M2d)
- Fiş logosu ayarı (§12). (M2d)
- `viewport-fit=cover` var, güvenli alan boşluğu yok. (M0)
- `version.test.ts` sürüm metnini sabit yazıyor. (M0)
- v5 yükseltmesi büyük/küçük harf çakışmasında silinmiş eski ürünü canlı ürüne tercih ediyor; yalnız v4 deneme verisini etkiler. (M3a)
- Geri tuşu (Android'inki de) kasada açık bir pencere varken ekranı değiştiriyor; sepet saklı olduğu için kayıp yok. (M3a)
- Electron ve Android'de dışa aktarılan dosyanın indirilmesi ve paylaşılması. İleride bir CSP gelirse `world.openfoodfacts.org`'a izin vermeli, yoksa ad önerisi "çevrimdışı" der. (M3b)
- Kamera düğmesi kamerası olmayan bilgisayarlarda da görünüyor ve "Kamera bulunamadı." diyor; `enumerateDevices()` ile gizlenebilir. (M3d)
- Pilotta denenecek: gerçek kamerayla okuma hızı, iOS'ta kamera izni, ZXing'in okuyamadığı bir hatadan sonra döngüsünü durdurup görüntüyü siyah bırakıp bırakmadığı. (M3d)
- Pilotta denenecek: okuyucu UPC-A'yı 12 mi 13 hane mi gönderiyor (12 haneli kodda düşmüş 0 sağlama toplamıyla anlaşılamıyor); Safari/iOS'ta 5.000 satırlık içe aktarmanın hızı. (M3b)

## Kapananlar

Ertelendikten sonra başka bir planda kapanan maddeler: `isQuick` indeksi (M1b, şema sürüm 2); iade yöntemi seçeneklerinin klavye odağı (M2c'de seçim kalktı); iade bildiriminin paranın nasıl döndüğünü söylememesi (M2c); okuyucu zamanının işleyicide ölçülmesi (M2a; M3a'da tuşun kendi zaman damgasına geçti).
