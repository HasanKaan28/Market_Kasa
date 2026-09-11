import React, { useState, useEffect } from 'react';
import { ShoppingCart, Package, Users, BarChart3, Settings, Clock, Wifi, WifiOff, LogOut, UserCheck, Cloud, CloudOff, RefreshCw, X, Check, Crown, Globe, Maximize2, Minimize2, Monitor } from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { useLanguage, SUPPORTED_LANGUAGES } from '../context/LanguageContext';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';

export default function Navbar({ activeTab, setActiveTab, cartItemCount = 0, onInstallClick, isInstalled }) {
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

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

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
      <header className="sticky top-0 z-30 bg-zinc-950/75 backdrop-blur-xl border-b border-emerald-500/10 px-3 py-2 flex items-center justify-between shadow-lg shadow-black/10">
        
        {/* Left: Store Branding & Live Sync Status */}
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400/25 to-cyan-400/10 border border-emerald-400/40 flex items-center justify-center text-emerald-300 font-black text-base shadow-lg shadow-emerald-950/30">
            K
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
              <span>{storeName}</span>
              <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1 py-0.2 rounded font-mono font-bold">POS</span>
            </h1>
            
            {/* Live Sync Status indicator */}
            <div className="flex items-center gap-1.5 text-[10px]">
              {syncState.isConnected ? (
                <span className="text-emerald-400 flex items-center gap-1 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  {syncState.connectedDevices > 1 ? `Canlı (${syncState.connectedDevices})` : 'Canlı'}
                </span>
              ) : (
                <span className="text-zinc-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-600"></span>
                  Çevrimdışı
                </span>
              )}

              {/* Google Drive Status Button - Clickable by any user */}
              <button
                type="button"
                onClick={() => setShowGdriveModal(true)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg border font-mono text-[9px] transition active:scale-95 ${
                  gdriveState.isConfigured
                    ? gdriveState.status === 'syncing'
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                      : gdriveState.status === 'error'
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                      : 'bg-sky-500/15 border-sky-500/30 text-sky-400'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
                title="Google Drive Canlı Eşitleme Ayarları (Herkes Ayarlayabilir)"
              >
                {gdriveState.status === 'syncing' ? (
                  <span className="flex items-center gap-1 text-amber-400">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Drive ⚡
                  </span>
                ) : gdriveState.status === 'error' ? (
                  <span className="flex items-center gap-1 text-rose-400">
                    <CloudOff className="w-2.5 h-2.5" /> Drive Hata
                  </span>
                ) : gdriveState.isConfigured ? (
                  <span className="flex items-center gap-1 text-sky-400">
                    <Cloud className="w-2.5 h-2.5" /> {gdriveState.lastSyncTime ? gdriveState.lastSyncTime.slice(0, 5) : 'Drive ⚡'}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-zinc-400">
                    <CloudOff className="w-2.5 h-2.5" /> +Drive
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Center: Desktop Navigation Bar */}
        <div className="hidden md:flex items-center gap-1 bg-zinc-900/75 border border-zinc-700/70 rounded-xl p-1 shadow-inner shadow-black/20">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-emerald-300 to-teal-400 text-zinc-950 font-black shadow-md shadow-emerald-950/40'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
                {item.badge > 0 && (
                  <span className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${isActive ? 'bg-zinc-950 text-white' : 'bg-rose-500 text-white'}`}>
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
              className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-2 py-1 rounded-xl text-xs font-bold text-white transition active:scale-95 flex items-center gap-1"
              title={t('language', 'Dil')}
            >
              <span>{SUPPORTED_LANGUAGES.find(l => l.code === language)?.flag || '🇹🇷'}</span>
              <span className="uppercase text-[10px] font-mono">{language}</span>
            </button>

            {showLangMenu && (
              <div className="absolute right-0 mt-1.5 w-32 bg-zinc-900 border border-zinc-750 rounded-xl shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 space-y-0.5">
                {SUPPORTED_LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => {
                      setLanguage(l.code);
                      setShowLangMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1 rounded-lg text-xs font-semibold transition ${
                      language === l.code ? 'bg-sky-500/20 text-sky-300 font-bold' : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{l.flag}</span>
                      <span>{l.name}</span>
                    </span>
                    {language === l.code && <Check className="w-3 h-3 text-sky-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Admin Back to Kitaplık Button */}
          {currentUser?.role === 'admin' && activeTab !== 'dashboard' && (
            <button
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 px-2.5 py-1.5 rounded-xl text-xs font-bold transition active:scale-95"
              title="Yönetim Kitaplığı Ana Sayfasına Dön"
            >
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('nav_back_to_shelf', '← Kitaplık')}</span>
            </button>
          )}

          {/* Active User Pill */}
          {currentUser && (
            <button
              onClick={openLogin}
              className="flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-2.5 py-1 rounded-xl text-xs text-white transition active:scale-95"
              title="Kullanıcıyı Değiştir / Çıkış"
            >
              <span className="text-sm">{currentUser.role === 'admin' ? '👑' : '👤'}</span>
              <div className="text-left hidden xs:block">
                <p className="text-[11px] font-bold leading-tight truncate max-w-[80px]">{currentUser.name}</p>
                <p className="text-[9px] text-zinc-400 leading-none capitalize">
                  {currentUser.role === 'admin' ? 'Müdür' : 'Kasiyer'}
                </p>
              </div>
            </button>
          )}

          {/* Clock */}
          <div className="hidden sm:flex items-center gap-1 bg-zinc-900 px-2 py-1 rounded-lg text-xs font-mono text-zinc-300 border border-zinc-800">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>{time}</span>
          </div>

          {/* Desktop Fullscreen Toggle (F11) */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="hidden sm:flex items-center justify-center w-8 h-8 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-zinc-300 hover:text-white transition active:scale-95"
            title={isFullscreen ? 'Tam Ekrandan Çık (F11)' : 'Tam Ekran Modu (F11)'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-amber-400" /> : <Maximize2 className="w-3.5 h-3.5 text-zinc-300" />}
          </button>

          {/* PWA Install Button */}
          {!isInstalled && (
            <button
              onClick={onInstallClick}
              className="flex items-center gap-1 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-1 rounded-lg text-xs font-bold active:scale-95 transition"
              title="Telefona Uygulama Olarak Yükle"
            >
              <span>📲</span>
              <span className="hidden xs:inline text-[11px]">Yükle</span>
            </button>
          )}

          {/* Cart Counter Trigger */}
          {hasPermission('canAccessPos') && (
            <button
              onClick={() => setActiveTab('pos')}
              className="relative sm:hidden flex items-center gap-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded-lg text-xs font-bold active:scale-95 transition"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              {cartItemCount > 0 && (
                <span className="bg-emerald-400 text-zinc-950 px-1 py-0.2 text-[9px] font-black rounded-full">
                  {cartItemCount}
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      {/* Bottom Navigation Bar: ONLY for non-admin users (Cashiers), Hidden on Desktop Screens (md:hidden) */}
      {currentUser?.role !== 'admin' && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/98 backdrop-blur-md border-t border-zinc-800/90 px-2 py-1 shadow-2xl safe-bottom md:hidden">
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
                      ? 'text-emerald-400 font-bold scale-105'
                      : 'text-zinc-500 hover:text-zinc-200 active:scale-95'
                  }`}
                >
                  <div className={`p-1.5 rounded-lg transition-colors ${isActive ? 'bg-emerald-500/15' : ''}`}>
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <span className="text-[9px] sm:text-[10px] mt-0.5 tracking-tight truncate max-w-[60px]">{item.label}</span>

                  {item.badge > 0 && (
                    <span className="absolute top-0.5 right-1 bg-rose-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-lg border border-zinc-900">
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-sky-500/40 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-500/30">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Google Drive Canlı Eşitleme</h3>
                  <p className="text-[10px] text-sky-300/80">Her iki telefonda anlık ciro & stok</p>
                </div>
              </div>
              <button
                onClick={() => setShowGdriveModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalMsg && (
              <div className={`text-xs px-3 py-2 rounded-xl flex items-center gap-2 ${
                modalMsg.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                modalMsg.type === 'error' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                'bg-sky-500/20 text-sky-300 border border-sky-500/40'
              }`}>
                {modalMsg.type === 'success' ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <RefreshCw className="w-4 h-4 animate-spin text-sky-400 shrink-0" />}
                <span>{modalMsg.text}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 block">
                Google Apps Script Web URL
              </label>
              <input
                type="url"
                value={modalGdriveUrl}
                onChange={(e) => setModalGdriveUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
              />
              <p className="text-[10px] text-slate-400 leading-relaxed">
                İki telefona da aynı Web URL'sini yapıştırın. Biri satış yapınca diğerindeki ciro 1 saniyede otomatik artar.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 block">
                Eşitleme Sıklığı
              </label>
              <select
                value={modalInterval}
                onChange={(e) => setModalInterval(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-xl px-3 py-2 font-semibold focus:outline-none focus:border-sky-500"
              >
                <option value="1s">⚡ Canlı Eşitleme (Her 1-2 Saniyede Bir) ⭐</option>
                <option value="5s">Hızlı Eşitleme (Her 5 Saniyede Bir)</option>
                <option value="on_sale">Yalnızca Satış Yapıldığında</option>
                <option value="off">Kapalı</option>
              </select>
            </div>

            <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 text-xs space-y-1.5">
              <div className="flex justify-between items-center text-slate-400">
                <span>Bağlantı Durumu:</span>
                <span className={`font-bold flex items-center gap-1.5 ${
                  gdriveState.status === 'syncing' ? 'text-amber-400' :
                  gdriveState.status === 'error' ? 'text-rose-400' :
                  gdriveState.isConfigured ? 'text-emerald-400' : 'text-slate-500'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    gdriveState.status === 'syncing' ? 'bg-amber-400 animate-pulse' :
                    gdriveState.status === 'error' ? 'bg-rose-400' :
                    gdriveState.isConfigured ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                  }`}></span>
                  {gdriveState.status === 'syncing' ? 'Eşitleniyor...' :
                   gdriveState.status === 'error' ? 'Bağlantı Hatası' :
                   gdriveState.isConfigured ? 'Bağlı & Canlı' : 'Bağlı Değil'}
                </span>
              </div>
              {gdriveState.lastSyncTime && (
                <div className="flex justify-between items-center text-slate-400 text-[11px]">
                  <span>Son Eşitleme:</span>
                  <span className="text-slate-200 font-mono font-medium">{gdriveState.lastSyncTime}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveModalGdrive}
                className="flex-1 bg-sky-600 hover:bg-sky-500 text-white py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-lg shadow-sky-600/20 active:scale-95"
              >
                <Check className="w-4 h-4" />
                <span>Kaydet & Başlat</span>
              </button>
              <button
                type="button"
                onClick={handleManualSyncModal}
                disabled={modalSyncing || !modalGdriveUrl}
                className="bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95"
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
