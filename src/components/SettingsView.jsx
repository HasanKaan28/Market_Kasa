import React, { useState, useEffect } from 'react';
import { 
  Store, Smartphone, Volume2, Database, ShieldCheck, 
  RotateCcw, Download, Upload, Check, Info, ExternalLink,
  Wifi, WifiOff, Cloud, CloudOff, RefreshCw, Copy, CheckCheck, Share2, HelpCircle, ChevronDown, ChevronUp,
  Globe, BellRing, Target, Bell
} from 'lucide-react';
import { db, seedInitialData } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';
import { useLanguage, SUPPORTED_LANGUAGES } from '../context/LanguageContext';
import { testRevenueNotification, shareTargetAchievedViaWhatsApp, requestNotificationPermission } from '../utils/revenueAlerts';

const APPS_SCRIPT_CODE = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var folderName = "MarketKasa_Yedek";
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    var files = folder.getFilesByName("market_pos_data.json");
    var file;
    if (files.hasNext()) {
      file = files.next();
      file.setContent(e.postData.contents);
    } else {
      file = folder.createFile("market_pos_data.json", e.postData.contents, MimeType.PLAIN_TEXT);
    }
    var lastUpdated = file.getLastUpdated().getTime();
    return ContentService.createTextOutput(JSON.stringify({ status: "success", serverTime: lastUpdated, timestamp: new Date().toISOString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var folderName = "MarketKasa_Yedek";
    var folders = DriveApp.getFoldersByName(folderName);
    if (!folders.hasNext()) return ContentService.createTextOutput(JSON.stringify({ empty: true })).setMimeType(ContentService.MimeType.JSON);
    var folder = folders.next();
    var files = folder.getFilesByName("market_pos_data.json");
    if (!files.hasNext()) return ContentService.createTextOutput(JSON.stringify({ empty: true })).setMimeType(ContentService.MimeType.JSON);
    
    var file = files.next();
    var lastUpdated = file.getLastUpdated().getTime();
    
    // Hızlı kontrol: Eğer istemcinin elindeki zaman sunucu ile aynıysa dosyayı indirmeye gerek yok
    if (e && e.parameter && e.parameter.since) {
      var since = parseInt(e.parameter.since);
      if (since >= lastUpdated) {
        return ContentService.createTextOutput(JSON.stringify({ unchanged: true, serverTime: lastUpdated }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    var content = file.getBlob().getDataAsString();
    var parsed = JSON.parse(content);
    parsed.serverTime = lastUpdated;
    return ContentService.createTextOutput(JSON.stringify(parsed)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

export default function SettingsView() {
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [syncUrl, setSyncUrl] = useState('ws://192.168.1.103:5174');
  const [syncState, setSyncState] = useState({ isConnected: false, connectedDevices: 1 });
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Google Drive state
  const [gdriveUrl, setGdriveUrl] = useState('');
  const [gdriveState, setGdriveState] = useState(googleDriveSync.getState());
  const [showGdriveGuide, setShowGdriveGuide] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [syncingGdrive, setSyncingGdrive] = useState(false);
  const [gdriveMsg, setGdriveMsg] = useState(null);

  const { language, setLanguage, t } = useLanguage();
  const [dailyTarget, setDailyTarget] = useState(10000);
  const [targetNotifyEnabled, setTargetNotifyEnabled] = useState(true);
  const [targetSavedSuccess, setTargetSavedSuccess] = useState(false);

  const settingsList = useLiveQuery(() => db.settings.toArray(), []);

  useEffect(() => {
    if (settingsList) {
      settingsList.forEach(s => {
        if (s.key === 'storeName') setStoreName(s.value);
        if (s.key === 'storeAddress') setStoreAddress(s.value);
        if (s.key === 'storePhone') setStorePhone(s.value);
        if (s.key === 'taxId') setTaxId(s.value);
        if (s.key === 'receiptFooter') setReceiptFooter(s.value);
        if (s.key === 'syncServerUrl') setSyncUrl(s.value);
        if (s.key === 'gdrive_sync_url' && !gdriveUrl) setGdriveUrl(s.value);
        if (s.key === 'daily_revenue_target') setDailyTarget(parseFloat(s.value) || 10000);
        if (s.key === 'daily_revenue_notify_enabled') setTargetNotifyEnabled(s.value !== 'false' && s.value !== false);
      });
    }
    const unsub = sync.subscribe((state) => {
      setSyncState(state);
    });
    const unsubGdrive = googleDriveSync.subscribe((state) => {
      setGdriveState(state);
      if (state.syncUrl && !gdriveUrl) setGdriveUrl(state.syncUrl);
    });

    return () => {
      unsub();
      unsubGdrive();
    };
  }, [settingsList]);

  const handleSaveDailyTarget = async () => {
    await db.settings.put({ key: 'daily_revenue_target', value: dailyTarget });
    await db.settings.put({ key: 'daily_revenue_notify_enabled', value: targetNotifyEnabled });
    setTargetSavedSuccess(true);
    setTimeout(() => setTargetSavedSuccess(false), 2000);
  };

  const handleSaveSyncUrl = async () => {
    if (!syncUrl.trim()) return;
    await db.settings.put({ key: 'syncServerUrl', value: syncUrl.trim() });
    sync.connect(syncUrl.trim());
    alert('Senkronizasyon sunucu adresi güncellendi ve yeniden bağlanıldı!');
  };

  const handleSaveGDriveUrl = async () => {
    if (!gdriveUrl.trim()) return;
    await googleDriveSync.setSyncUrl(gdriveUrl.trim());
    setGdriveMsg({ type: 'success', text: 'Google Drive Web URL kaydedildi!' });
    setTimeout(() => setGdriveMsg(null), 3000);
  };

  const handleGDriveSyncNow = async () => {
    if (!gdriveUrl.trim()) {
      alert('Lütfen önce Google Drive Web URL adresinizi girin!');
      return;
    }
    setSyncingGdrive(true);
    setGdriveMsg({ type: 'info', text: 'Google Drive ile senkronize ediliyor...' });
    const res = await googleDriveSync.fullSync();
    setSyncingGdrive(false);
    if (res.success) {
      const added = res.mergeResult?.addedSales || 0;
      setGdriveMsg({ 
        type: 'success', 
        text: `Senkronizasyon başarılı! ${added > 0 ? `(${added} yeni satış eklendi)` : '(Verileriniz güncel)'}` 
      });
    } else {
      setGdriveMsg({ type: 'error', text: `Hata: ${res.error || 'Bağlantı kurulamadı'}` });
    }
    setTimeout(() => setGdriveMsg(null), 5000);
  };

  const handleCopyScript = () => {
    navigator.clipboard.writeText(APPS_SCRIPT_CODE);
    setScriptCopied(true);
    setTimeout(() => setScriptCopied(false), 3000);
  };

  const handleShareDriveFile = async () => {
    await googleDriveSync.shareBackupFile();
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    await db.settings.bulkPut([
      { key: 'storeName', value: storeName.trim() || 'KURŞUNLU MARKET' },
      { key: 'storeAddress', value: storeAddress.trim() },
      { key: 'storePhone', value: storePhone.trim() },
      { key: 'taxId', value: taxId.trim() },
      { key: 'receiptFooter', value: receiptFooter.trim() }
    ]);

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleExportBackup = async () => {
    const products = await db.products.toArray();
    const customers = await db.customers.toArray();
    const sales = await db.sales.toArray();
    const customerTransactions = await db.customerTransactions.toArray();
    const settings = await db.settings.toArray();

    const data = {
      backupDate: new Date().toISOString(),
      storeName,
      products,
      customers,
      sales,
      customerTransactions,
      settings
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `market_pos_yedek_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (confirm('Yedeği geri yüklerseniz mevcut veriler üzerine yazılacaktır. Devam edilsin mi?')) {
          if (data.products) {
            await db.products.clear();
            await db.products.bulkAdd(data.products);
          }
          if (data.customers) {
            await db.customers.clear();
            await db.customers.bulkAdd(data.customers);
          }
          if (data.sales) {
            await db.sales.clear();
            await db.sales.bulkAdd(data.sales);
          }
          if (data.customerTransactions) {
            await db.customerTransactions.clear();
            await db.customerTransactions.bulkAdd(data.customerTransactions);
          }
          alert('Yedek başarıyla geri yüklendi!');
        }
      } catch (err) {
        alert('Yedek dosyası okunamadı veya bozuk: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleResetData = async () => {
    if (confirm('DİKKAT: Tüm satışlar ve veriler sıfırlanıp fabrika ayarlarına (örnek market ürünlerine) dönülecektir. Onaylıyor musunuz?')) {
      await db.products.clear();
      await db.customers.clear();
      await db.sales.clear();
      await db.customerTransactions.clear();
      await db.suspendedSales.clear();
      await seedInitialData();
      alert('Sistem başlangıç durumuna sıfırlandı.');
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-57px-60px)] max-w-lg mx-auto bg-slate-950 overflow-hidden">
      
      {/* Header */}
      <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Store className="w-5 h-5 text-emerald-400" />
          <span>Market & Sistem Ayarları</span>
        </h2>
      </div>

      {/* Settings Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        
        {/* Android PWA Installation Info Card */}
        <div className="bg-gradient-to-br from-emerald-950/50 to-slate-900 border border-emerald-500/30 rounded-2xl p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <Smartphone className="w-5 h-5" />
            <span>Android Telefona Nasıl Yüklenir?</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Bu uygulama <b>PWA (Progressive Web App)</b> mimarisine sahiptir. Android telefonunuzun Chrome tarayıcısında açtığınızda:
          </p>
          <ol className="text-xs text-slate-300 space-y-1 list-decimal list-inside font-medium bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
            <li>Chrome menüsündeki üç noktaya (⋮) dokunun.</li>
            <li><b className="text-white">"Ana ekrana ekle"</b> veya <b className="text-white">"Uygulamayı yükle"</b> seçeneğine basın.</li>
            <li>Uygulama telefonunuza tıpkı bir APK gibi kurulur; tam ekran, internetsiz ve çevrimdışı çalışır!</li>
          </ol>
        </div>

        {/* Language Selection Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-sky-400" />
            <span>{t('language', 'Dil Seçeneği')}</span>
          </h3>
          <p className="text-xs text-slate-300">
            Uygulamanın arayüz dilini değiştirin:
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SUPPORTED_LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLanguage(l.code)}
                className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-bold transition active:scale-95 ${
                  language === l.code
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 shadow'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-base">{l.flag}</span>
                  <span>{l.name}</span>
                </span>
                {language === l.code && <Check className="w-4 h-4 text-sky-400" />}
              </button>
            ))}
          </div>
        </div>

        {/* Daily Revenue Target & Notification Card */}
        <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4 space-y-3 shadow-lg shadow-amber-500/5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <BellRing className="w-4 h-4" />
              <span>{t('target_card_title', 'Günlük Ciro Hedefi & Canlı Bildirim')}</span>
            </h3>
            <button
              type="button"
              onClick={() => setTargetNotifyEnabled(!targetNotifyEnabled)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition ${
                targetNotifyEnabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {targetNotifyEnabled ? 'Açık' : 'Kapalı'}
            </button>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            {t('target_card_subtitle', 'Belirlediğiniz günlük ciro eşiğine ulaşıldığında sesli, konfetili ve sistem bildirimi alın.')}
          </p>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-300 block">
              {t('target_amount_label', 'Günlük Ciro Limiti (₺)')}
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={dailyTarget}
                onChange={(e) => setDailyTarget(parseFloat(e.target.value) || 0)}
                placeholder="10000"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono font-bold focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={handleSaveDailyTarget}
                className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-xl text-xs font-bold active:scale-95 transition"
              >
                {targetSavedSuccess ? '✓ Kaydedildi' : t('save', 'Kaydet')}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => testRevenueNotification(dailyTarget, dailyTarget * 1.05)}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>{t('target_test_btn', '🔔 Bildirimi Test Et')}</span>
            </button>

            {'Notification' in window && Notification.permission !== 'granted' && (
              <button
                type="button"
                onClick={requestNotificationPermission}
                className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
              >
                <span>İzin Ver 🔔</span>
              </button>
            )}
          </div>
        </div>

        {/* Sync Server Settings Card (Local Wi-Fi) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Wifi className="w-4 h-4 text-emerald-400" />
            <span>Aynı Wi-Fi Canlı Eşitleme (WebSocket)</span>
          </h3>
          <p className="text-xs text-slate-400">
            Aynı Wi-Fi ağına bağlı telefonların anlık milisaniyelik eşitlenmesi için sunucu adresi:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={syncUrl}
              onChange={(e) => setSyncUrl(e.target.value)}
              placeholder="ws://192.168.1.103:5174"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={handleSaveSyncUrl}
              className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-3 py-2 rounded-xl text-xs font-bold active:scale-95 transition"
            >
              Kaydet
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs bg-slate-950 p-2.5 rounded-xl border border-slate-800">
            <span className="text-slate-400">Durum:</span>
            {syncState.isConnected ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Bağlı ({syncState.connectedDevices} Cihaz Canlı Eşitleniyor)
              </span>
            ) : (
              <span className="text-rose-400 font-bold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                Bağlantı Kurulamadı (Çevrimdışı Mod)
              </span>
            )}
          </div>
        </div>

        {/* Google Drive Cross-Network Sync Card */}
        <div className="bg-slate-900 border border-sky-500/30 rounded-2xl p-4 space-y-3.5 shadow-lg shadow-sky-500/5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
              <Cloud className="w-4 h-4" />
              <span>Google Drive ile Uzaktan Eşitleme (Farklı Ağlar / 4G)</span>
            </h3>
            <span className="text-[10px] bg-sky-500/20 text-sky-300 font-mono px-2 py-0.5 rounded-full border border-sky-500/30 font-bold">
              Bulut Eşitleme
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Telefonlar farklı Wi-Fi ağlarında veya mobil veride (4G/5G) olsa bile satışları ve stokları Google Drive hesabınız üzerinden kayıpsız eşitler.
          </p>

          {/* Web App URL input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-300 block">
              Google Apps Script Web Uygulama URL'si
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={gdriveUrl}
                onChange={(e) => setGdriveUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={handleSaveGDriveUrl}
                className="bg-sky-600 hover:bg-sky-500 text-white px-3 py-2 rounded-xl text-xs font-bold active:scale-95 transition"
              >
                Kaydet
              </button>
            </div>
          </div>

          {/* Auto-sync Interval Dropdown */}
          <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800">
            <span className="text-xs text-slate-300 font-medium">Otomatik Eşitleme:</span>
            <select
              value={gdriveState.autoSyncInterval}
              onChange={(e) => googleDriveSync.setAutoSyncInterval(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-2.5 py-1 font-bold focus:outline-none focus:border-sky-500"
            >
              <option value="1s">⚡ Canlı Eşitleme (Her 1-2 Saniyede Bir) ⭐</option>
              <option value="5s">Hızlı Eşitleme (Her 5 Saniyede Bir)</option>
              <option value="on_sale">Yalnızca Satış Yapıldığında</option>
              <option value="off">Kapalı (Yalnızca Manuel)</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={handleGDriveSyncNow}
              disabled={syncingGdrive || !gdriveUrl}
              className="bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition disabled:opacity-50"
            >
              {syncingGdrive ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                  <span>Eşitleniyor...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 text-sky-400" />
                  <span>Şimdi Eşitle (Drive)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleShareDriveFile}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition"
              title="Telefonun kendi Drive uygulamasına doğrudan dosya aktarımı"
            >
              <Share2 className="w-4 h-4 text-emerald-400" />
              <span>Drive'a Paylaş</span>
            </button>
          </div>

          {/* Status Message Notification */}
          {gdriveMsg && (
            <div className={`p-2.5 rounded-xl text-xs font-medium border ${
              gdriveMsg.type === 'success' ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' :
              gdriveMsg.type === 'error' ? 'bg-rose-950/60 border-rose-500/40 text-rose-300' :
              'bg-sky-950/60 border-sky-500/40 text-sky-300'
            }`}>
              {gdriveMsg.text}
            </div>
          )}

          {/* Status Info */}
          <div className="flex items-center justify-between text-xs bg-slate-950 p-2.5 rounded-xl border border-slate-800">
            <span className="text-slate-400">Bulut Durumu:</span>
            {gdriveState.isConfigured ? (
              <span className="text-sky-400 font-medium flex items-center gap-1">
                <Cloud className="w-3.5 h-3.5" />
                {gdriveState.lastSyncTime ? `Son Eşitleme: ${gdriveState.lastSyncTime}` : 'Hazır (Henüz eşitlenmedi)'}
              </span>
            ) : (
              <span className="text-slate-500 italic">URL girilmedi</span>
            )}
          </div>

          {/* Setup Guide Accordion */}
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
            <button
              type="button"
              onClick={() => setShowGdriveGuide(!showGdriveGuide)}
              className="w-full p-2.5 flex items-center justify-between text-xs text-slate-300 hover:text-white transition font-medium"
            >
              <span className="flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-sky-400" />
                <span>Google Drive'a Nasıl Bağlanır? (1 Dakikalık Rehber)</span>
              </span>
              {showGdriveGuide ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>

            {showGdriveGuide && (
              <div className="p-3 border-t border-slate-800 space-y-3 text-xs text-slate-300">
                <ol className="list-decimal list-inside space-y-1.5 leading-relaxed">
                  <li>Bilgisayarınızda veya telefonunuzda <a href="https://script.google.com" target="_blank" rel="noreferrer" className="text-sky-400 underline font-bold">script.google.com</a> adresini açıp <b>"Yeni proje"</b>ye tıklayın.</li>
                  <li>Aşağıdaki hazır kodu kopyalayıp oradaki her şeyi silerek yapıştırın:</li>
                </ol>

                <div className="relative">
                  <pre className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-36">
                    {APPS_SCRIPT_CODE}
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopyScript}
                    className="absolute top-2 right-2 bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow"
                  >
                    {scriptCopied ? <CheckCheck className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3" />}
                    <span>{scriptCopied ? 'Kopyalandı!' : 'Kodu Kopyala'}</span>
                  </button>
                </div>

                <ol start="3" className="list-decimal list-inside space-y-1.5 leading-relaxed">
                  <li>Sağ üstteki mavi <b>"Dağıt" (Deploy)</b> butonuna basın &gt; <b>"Yeni dağıtım"</b>ı seçin.</li>
                  <li>Sol çarktaki türü <b>"Web uygulaması"</b> seçin. <i>Erişimi olanlar (Who has access)</i> kısmını <b>"Herkes" (Anyone)</b> yapıp <b>"Dağıt"</b>a tıklayın.</li>
                  <li>Google'ın size verdiği <b>Web Uygulaması URL'sini</b> kopyalayıp yukarıdaki kutuya yapıştırıp Kaydet'e basın!</li>
                </ol>
                <p className="text-[11px] text-emerald-400 bg-emerald-950/40 p-2 rounded-lg border border-emerald-500/20">
                  ✨ Artık her iki telefonunuz da Google Drive'ınızdaki <code>MarketKasa_Yedek</code> klasörü üzerinden dünyadaki tüm ağlardan eşitlenecektir!
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Store Profile Form */}
        <form onSubmit={handleSaveSettings} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">İşletme & Fiş Bilgileri</h3>

          <div>
            <label className="text-xs text-slate-300 font-bold block mb-1">Market / Mağaza Adı</label>
            <input
              type="text"
              required
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Örn: KURŞUNLU MARKET"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 font-bold block mb-1">Adres</label>
            <input
              type="text"
              value={storeAddress}
              onChange={(e) => setStoreAddress(e.target.value)}
              placeholder="Örn: Merkez Mah. Atatürk Cad. No: 42"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Telefon</label>
              <input
                type="text"
                value={storePhone}
                onChange={(e) => setStorePhone(e.target.value)}
                placeholder="Örn: 0212 555 00 11"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Vergi No / VKN</label>
              <input
                type="text"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="Örn: VKN: 1234567890"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-300 font-bold block mb-1">Fiş Altı Teşekkür Mesajı</label>
            <input
              type="text"
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              placeholder="Bizi tercih ettiğiniz için teşekkür ederiz!"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 active:scale-95 transition mt-2"
          >
            {savedSuccess ? (
              <>
                <Check className="w-4 h-4" />
                <span>Ayarlar Kaydedildi!</span>
              </>
            ) : (
              <span>Bilgileri Güncelle</span>
            )}
          </button>
        </form>

        {/* Backup & Restore */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Database className="w-4 h-4 text-blue-400" />
            <span>Veritabanı & Yedekleme</span>
          </h3>
          <p className="text-xs text-slate-400">
            Tüm ürünlerinizi, müşteri borç defterinizi ve satış geçmişinizi telefonunuza tek dosyada yedekleyin veya başka telefona aktarın.
          </p>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={handleExportBackup}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>Yedek İndir (JSON)</span>
            </button>

            <label className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition cursor-pointer">
              <Upload className="w-4 h-4 text-blue-400" />
              <span>Yedekten Yükle</span>
              <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
            </label>
          </div>
        </div>

        {/* Factory Reset */}
        <div className="bg-slate-900 border border-rose-900/40 rounded-2xl p-4 space-y-2">
          <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider">Sıfırlama</h3>
          <p className="text-xs text-slate-400">
            Tüm satış ve veresiye hareketlerini temizleyip hazır market ürünlerini yeniden yükler.
          </p>
          <button
            type="button"
            onClick={handleResetData}
            className="w-full bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/60 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Fabrika Ayarlarına Dön</span>
          </button>
        </div>

      </div>
    </div>
  );
}
