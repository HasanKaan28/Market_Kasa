import React, { useState, useEffect } from 'react';
import { ShoppingCart, Package, Users, BarChart3, Settings, Clock, Wifi, WifiOff, LogOut, UserCheck, Cloud, CloudOff, RefreshCw, X, Check, Crown, Globe, Maximize2, Minimize2, Monitor, Pencil, ImagePlus } from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { useLanguage, SUPPORTED_LANGUAGES } from '../context/LanguageContext';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';

export default function Navbar({ activeTab, setActiveTab, cartItemCount = 0, onInstallClick, isInstalled, marketSession, onMarketUpdate, onMarketExit }) {
  const [time, setTime] = useState(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
  const [syncState, setSyncState] = useState({ isConnected: false, connectedDevices: 1 });
  const [gdriveState, setGdriveState] = useState(googleDriveSync.getState());

  // Quick Google Drive Modal State (Accessible by any user)
  const [showGdriveModal, setShowGdriveModal] = useState(false);
  const [modalGdriveUrl, setModalGdriveUrl] = useState('');
  const [modalInterval, setModalInterval] = useState('1s');
  const [modalSyncing, setModalSyncing] = useState(false);
  const [modalMsg, setModalMsg] = useState(null);

  const storeNameSetting = useLiveQuery(() => db.settings.get('storeName'), []);
  const storeName = storeNameSetting?.value || 'KURŞUNLU MARKET';

  const { currentUser, logout, hasPermission, openLogin } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [showMarketMenu, setShowMarketMenu] = useState(false);
  const [showMarketEditor, setShowMarketEditor] = useState(false);
  const [marketNameInput, setMarketNameInput] = useState(marketSession?.name || '');
  const [marketLogoInput, setMarketLogoInput] = useState(marketSession?.logo || '');

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    setMarketNameInput(marketSession?.name || '');
    setMarketLogoInput(marketSession?.logo || '');
  }, [marketSession?.name, marketSession?.logo]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    }, 1000);

    const unsubscribe = sync.subscribe((state) => {
      setSyncState(state);
    });

    const unsubGdrive = googleDriveSync.subscribe((state) => {
      setGdriveState(state);
    });

    return () => {
      clearInterval(timer);
      unsubscribe();
      unsubGdrive();
    };
  }, []);

  useEffect(() => {
    if (gdriveState.syncUrl) {
      setModalGdriveUrl(gdriveState.syncUrl);
    }
    if (gdriveState.autoSyncInterval) {
      setModalInterval(gdriveState.autoSyncInterval);
    }
  }, [gdriveState.syncUrl, gdriveState.autoSyncInterval]);

  const handleMarketLogo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setMarketLogoInput(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const saveMarketProfile = () => {
    const name = marketNameInput.trim();
    if (!name) return;
    onMarketUpdate?.({ ...marketSession, name, logo: marketLogoInput });
    setShowMarketEditor(false);
    setShowMarketMenu(false);
  };

  const handleSaveModalGdrive = async () => {
    if (!modalGdriveUrl.trim()) return;
    await googleDriveSync.setSyncUrl(modalGdriveUrl.trim());
    await googleDriveSync.setAutoSyncInterval(modalInterval);
    setModalMsg({ type: 'success', text: 'Google Drive URL kaydedildi ve anlık eşitleme devrede!' });
    setTimeout(() => {
      setModalMsg(null);
      setShowGdriveModal(false);
    }, 1200);
  };

  const handleManualSyncModal = async () => {
    if (!modalGdriveUrl.trim()) return;
    setModalSyncing(true);
    setModalMsg({ type: 'info', text: 'Eşitleniyor...' });
    const res = await googleDriveSync.fullSync();
    setModalSyncing(false);
    if (res.success) {
      const added = res.mergeResult?.addedSales || 0;
      setModalMsg({ 
        type: 'success', 
        text: `Başarılı! ${added > 0 ? `${added} yeni satış eşitlendi.` : 'Verileriniz güncel.'}` 
      });
    } else {
      setModalMsg({ type: 'error', text: res.error || 'Eşitleme hatası' });
    }
    setTimeout(() => setModalMsg(null), 3000);
  };

  const allNavItems = [
    { id: 'pos', label: t('nav_pos', 'Kasa (Satış)'), icon: ShoppingCart, badge: cartItemCount, permission: 'canAccessPos' },
    { id: 'products', label: t('nav_products', 'Ürün & Stok'), icon: Package, permission: 'canAccessProducts' },
    { id: 'customers', label: t('nav_customers', 'Veresiye'), icon: Users, permission: 'canAccessCustomers' },
    { id: 'reports', label: t('nav_reports', 'Rapor & Z'), icon: BarChart3, permission: 'canAccessReports' },
    { id: 'users', label: t('nav_users', 'Personel'), icon: Users, permission: 'canManageUsers' },
    { id: 'settings', label: t('nav_settings', 'Ayarlar'), icon: Settings, permission: 'canAccessSettings' },
  ];

  // Filter items based on current user's permissions
  const navItems = allNavItems.filter(item => hasPermission(item.permission));

  return (
    <>
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-sm border-b border-slate-200 px-3 py-2 flex items-center justify-between shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          
        {/* Left: Store Branding & Live Sync Status */}
        <div className="flex items-center space-x-2 min-w-0">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMarketMenu((value) => !value)}
              className="w-8 h-8 overflow-hidden rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-black text-base"
              title="Market profili"
            >
              {marketSession?.logo ? <img src={marketSession.logo} alt="" className="h-full w-full object-cover" /> : (marketSession?.name?.charAt(0).toUpperCase() || 'K')}
            </button>
            {showMarketMenu && (
              <div className="absolute left-0 top-10 z-50 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <div className="border-b border-slate-100 px-2 pb-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Aktif market</p>
                  <p className="mt-1 truncate text-sm font-black text-slate-900">{marketSession?.name}</p>
                </div>
                <button type="button" onClick={() => setShowMarketEditor(true)} className="mt-2 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700">
                  <Pencil className="h-4 w-4" /> Market bilgilerini düzenle
                </button>
                <button type="button" onClick={() => { if (confirm('Aktif marketten çıkış yapılsın mı?')) onMarketExit?.(); }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50">
                  <LogOut className="h-4 w-4" /> Marketten çıkış yap
                </button>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-semibold tracking-tight text-slate-800 truncate">
              <span>{storeName}</span>
            </h1>
              
            <div className="flex items-center gap-1.5 text-[10px]">
              {syncState.isConnected ? (
                <span className="text-emerald-600 flex items-center gap-1 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  {syncState.connectedDevices > 1 ? `Canlı (${syncState.connectedDevices})` : 'Canlı'}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                </span>
              )}

              <button
                type="button"
                onClick={() => setShowGdriveModal(true)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition active:scale-95"
                title="Google Drive Canlı Eşitleme Ayarları"
              >
                <Cloud className="w-2.5 h-2.5" />
                <span className="text-[9px]">
                  {gdriveState.isConfigured && gdriveState.status !== 'error' ? 'Çevrimiçi' : 'Drive'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Center: Desktop Navigation Bar */}
        <div className="hidden md:flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
                {item.badge > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${isActive ? 'bg-slate-900 text-white' : 'bg-rose-500 text-white'}`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Active User Profile & Actions */}
        <div className="flex items-center gap-2">
          {/* Language Selector Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="bg-slate-100 hover:bg-white border border-slate-200 px-2 py-1 rounded-lg text-xs font-semibold text-slate-700 transition active:scale-95 flex items-center gap-1"
              title={t('language', 'Dil')}
            >
              <span>{SUPPORTED_LANGUAGES.find(l => l.code === language)?.flag || '🇹🇷'}</span>
              <span className="uppercase text-[10px] font-mono">{language}</span>
            </button>

            {showLangMenu && (
              <div className="absolute right-0 mt-1.5 w-32 bg-white border border-slate-200 rounded-xl shadow-xl p-1 z-50 animate-in fade-in zoom-in-95 space-y-0.5">
                {SUPPORTED_LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => {
                      setLanguage(l.code);
                      setShowLangMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1 rounded-lg text-xs font-semibold transition ${
                      language === l.code ? 'bg-slate-900 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{l.flag}</span>
                      <span>{l.name}</span>
                    </span>
                    {language === l.code && <Check className="w-3 h-3 text-white" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Admin Back to Kitaplık Button */}
          {currentUser?.role === 'admin' && activeTab !== 'dashboard' && (
            <button
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-medium transition active:scale-95"
              title="Yönetim Kitaplığı Ana Sayfasına Dön"
            >
              <Crown className="w-3.5 h-3.5 text-amber-600" />
              <span>{t('nav_back_to_shelf', '← Kitaplık')}</span>
            </button>
          )}

          {/* Active User Pill */}
          {currentUser && (
            <button
              onClick={openLogin}
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-xs text-slate-700 transition active:scale-95"
              title="Kullanıcıyı Değiştir / Çıkış"
            >
              <span className="text-sm">{currentUser.role === 'admin' ? '👑' : '👤'}</span>
              <div className="text-left hidden xs:block">
                <p className="text-[11px] font-semibold leading-tight truncate max-w-[80px] text-slate-800">{currentUser.name}</p>
              </div>
            </button>
          )}

          {/* Clock */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg text-xs font-mono text-slate-700 border border-slate-200">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>{time}</span>
          </div>

          {/* Desktop Fullscreen Toggle (F11) */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="hidden sm:flex items-center justify-center w-8 h-8 bg-slate-100 hover:bg-white border border-slate-200 rounded-lg text-slate-600 transition active:scale-95"
            title={isFullscreen ? 'Tam Ekrandan Çık (F11)' : 'Tam Ekran Modu (F11)'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-slate-500" /> : <Maximize2 className="w-3.5 h-3.5 text-slate-600" />}
          </button>

          {/* Cart Counter Trigger */}
          {hasPermission('canAccessPos') && (
            <button
              onClick={() => setActiveTab('pos')}
              className="relative sm:hidden flex items-center gap-1 bg-blue-600 text-white border border-blue-500 px-2 py-1 rounded-lg text-xs font-bold active:scale-95 transition shadow-sm"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              {cartItemCount > 0 && (
                <span className="bg-white text-blue-700 px-1 py-0.2 text-[9px] font-black rounded-full">
                  {cartItemCount}
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      {showMarketEditor && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">Market profilini düzenle</h3>
              <button type="button" onClick={() => setShowMarketEditor(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-1 block text-xs font-bold text-slate-600">Market adı</label>
            <input value={marketNameInput} onChange={(event) => setMarketNameInput(event.target.value)} className="mb-4 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500" />
            <label className="mb-1 block text-xs font-bold text-slate-600">Market fotoğrafı / logosu</label>
            <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-blue-200 bg-blue-50 p-3 text-xs font-bold text-blue-700">
              {marketLogoInput ? <img src={marketLogoInput} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <ImagePlus className="h-8 w-8" />}
              <span>Fotoğraf seç</span>
              <input type="file" accept="image/*" onChange={handleMarketLogo} className="hidden" />
            </label>
            <button type="button" onClick={saveMarketProfile} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700">Kaydet</button>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar: ONLY for non-admin users (Cashiers), Hidden on Desktop Screens (md:hidden) */}
      {currentUser?.role !== 'admin' && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-blue-100 px-2 py-1 shadow-[0_-8px_24px_rgba(59,130,246,0.08)] safe-bottom md:hidden">
          <div className="max-w-md mx-auto flex items-center justify-around">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`relative flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all duration-150 ${
                    isActive
                      ? 'text-blue-700 font-bold scale-105'
                      : 'text-slate-500 hover:text-slate-700 active:scale-95'
                  }`}
                >
                  <div className={`p-1.5 rounded-lg transition-colors ${isActive ? 'bg-blue-100 text-blue-700' : 'text-slate-500'}`}>
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <span className="text-[9px] sm:text-[10px] mt-0.5 tracking-tight truncate max-w-[60px]">{item.label}</span>

                  {item.badge > 0 && (
                    <span className="absolute top-0.5 right-1 bg-rose-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-lg border border-white">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Quick Google Drive Modal (Accessible by ALL users: Cashier & Admin) */}
      {showGdriveModal && (
       <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
         <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
               <div className="w-9 h-9 rounded-xl bg-sky-100 text-blue-600 flex items-center justify-center border border-sky-200">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                 <h3 className="text-sm font-bold text-slate-900">Google Drive Canlı Eşitleme</h3>
                 <p className="text-[10px] text-slate-500">Her iki telefonda anlık ciro & stok</p>
                </div>
              </div>
              <button
                onClick={() => setShowGdriveModal(false)}
               className="text-slate-500 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalMsg && (
              <div className={`text-xs px-3 py-2 rounded-xl flex items-center gap-2 ${
               modalMsg.type === 'success' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
               modalMsg.type === 'error' ? 'bg-rose-100 text-rose-700 border border-rose-200' :
               'bg-sky-100 text-blue-700 border border-sky-200'
              }`}>
               {modalMsg.type === 'success' ? <Check className="w-4 h-4 text-emerald-600 shrink-0" /> : <RefreshCw className="w-4 h-4 animate-spin text-blue-600 shrink-0" />}
                <span>{modalMsg.text}</span>
              </div>
            )}

            <div className="space-y-1.5">
             <label className="text-xs font-bold text-slate-700 block">
                Google Apps Script Web URL
              </label>
              <input
                type="url"
                value={modalGdriveUrl}
                onChange={(e) => setModalGdriveUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
               className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 font-mono focus:outline-none focus:border-blue-500"
              />
             <p className="text-[10px] text-slate-500 leading-relaxed">
                İki telefona da aynı Web URL'sini yapıştırın. Biri satış yapınca diğerindeki ciro 1 saniyede otomatik artar.
              </p>
            </div>

            <div className="space-y-1.5">
             <label className="text-xs font-bold text-slate-700 block">
                Eşitleme Sıklığı
              </label>
              <select
                value={modalInterval}
                onChange={(e) => setModalInterval(e.target.value)}
               className="w-full bg-slate-50 border border-slate-200 text-xs text-slate-800 rounded-xl px-3 py-2 font-semibold focus:outline-none focus:border-blue-500"
              >
                <option value="1s">⚡ Canlı Eşitleme (Her 1-2 Saniyede Bir) ⭐</option>
                <option value="5s">Hızlı Eşitleme (Her 5 Saniyede Bir)</option>
                <option value="on_sale">Yalnızca Satış Yapıldığında</option>
                <option value="off">Kapalı</option>
              </select>
            </div>

           <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs space-y-1.5">
             <div className="flex justify-between items-center text-slate-600">
                <span>Bağlantı Durumu:</span>
                <span className={`font-bold flex items-center gap-1.5 ${
                 gdriveState.status === 'syncing' ? 'text-amber-600' :
                 gdriveState.status === 'error' ? 'text-rose-600' :
                 gdriveState.isConfigured ? 'text-emerald-600' : 'text-slate-500'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                   gdriveState.status === 'syncing' ? 'bg-amber-500 animate-pulse' :
                   gdriveState.status === 'error' ? 'bg-rose-500' :
                   gdriveState.isConfigured ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                  }`}></span>
                  {gdriveState.status === 'syncing' ? 'Eşitleniyor...' :
                   gdriveState.status === 'error' ? 'Bağlantı Hatası' :
                   gdriveState.isConfigured ? 'Bağlı & Canlı' : 'Bağlı Değil'}
                </span>
              </div>
              {gdriveState.lastSyncTime && (
               <div className="flex justify-between items-center text-slate-500 text-[11px]">
                  <span>Son Eşitleme:</span>
                 <span className="text-slate-700 font-mono font-medium">{gdriveState.lastSyncTime}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveModalGdrive}
               className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-lg shadow-blue-200 active:scale-95"
              >
                <Check className="w-4 h-4" />
                <span>Kaydet & Başlat</span>
              </button>
              <button
                type="button"
                onClick={handleManualSyncModal}
                disabled={modalSyncing || !modalGdriveUrl}
               className="bg-slate-100 hover:bg-slate-200 text-blue-700 border border-slate-200 px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95"
                title="Şimdi Manuel Test Et"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${modalSyncing ? 'animate-spin' : ''}`} />
                <span>Şimdi</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
