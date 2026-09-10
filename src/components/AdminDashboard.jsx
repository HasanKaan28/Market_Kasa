import React, { useState, useEffect, useMemo } from 'react';
import { 
  Crown, Trophy, Medal, TrendingUp, Users, ShoppingCart, 
  Package, BarChart3, Settings, ShieldAlert, ArrowRight, 
  Clock, Cloud, RefreshCw, Sparkles, DollarSign, Receipt, 
  ChevronRight, AlertCircle, Calendar, Award, Star, Zap, Target,
  Flame, CheckCircle2, ArrowUpRight, ShieldCheck, LogOut, UserCheck,
  Bell, BellRing, Volume2, Share2, Globe, Check, X
} from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { useLanguage, SUPPORTED_LANGUAGES } from '../context/LanguageContext';
import { calculateStaffLeaderboard } from '../utils/staffStats';
import { googleDriveSync } from '../utils/googleDriveSync';
import { sync } from '../utils/sync';
import { 
  checkAndTriggerRevenueNotification, 
  testRevenueNotification, 
  requestNotificationPermission, 
  shareTargetAchievedViaWhatsApp 
} from '../utils/revenueAlerts';

export default function AdminDashboard({ onNavigate, cartItemCount = 0 }) {
  const { currentUser, openLogin } = useAuth();
  const { language, setLanguage, t } = useLanguage();

  const [period, setPeriod] = useState('today'); // 'today' | 'week' | 'month' | 'all'
  const [gdriveState, setGdriveState] = useState(googleDriveSync.getState());
  const [syncState, setSyncState] = useState({ isConnected: false, connectedDevices: 1 });
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
  
  // Revenue Target State
  const [dailyTarget, setDailyTarget] = useState(10000);
  const [targetNotifyEnabled, setTargetNotifyEnabled] = useState(true);
  const [targetSavedMsg, setTargetSavedMsg] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [celebrationModal, setCelebrationModal] = useState(null); // { target, currentRevenue }

  // Live Database Queries
  const sales = useLiveQuery(() => db.sales.reverse().toArray(), []) || [];
  const users = useLiveQuery(() => db.users.toArray(), []) || [];
  const allDbProducts = useLiveQuery(() => db.products.toArray(), []) || [];
  const products = useMemo(() => allDbProducts.filter(p => !p.needsPricing && p.price > 0), [allDbProducts]);
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const storeNameSetting = useLiveQuery(() => db.settings.get('storeName'), []);
  const storeName = storeNameSetting?.value || 'KURŞUNLU MARKET';

  // Load Saved Target Settings
  useEffect(() => {
    async function loadTargetSettings() {
      try {
        const targetSetting = await db.settings.get('daily_revenue_target');
        if (targetSetting?.value) {
          setDailyTarget(parseFloat(targetSetting.value) || 10000);
        }
        const notifySetting = await db.settings.get('daily_revenue_notify_enabled');
        if (notifySetting) {
          setTargetNotifyEnabled(notifySetting.value !== 'false' && notifySetting.value !== false);
        }
      } catch (err) {
        console.warn('Target settings load error:', err);
      }
    }
    loadTargetSettings();
  }, []);

  // Timer & Event Subscriptions
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    }, 1000);

    const unsubGdrive = googleDriveSync.subscribe((state) => {
      setGdriveState(state);
    });

    const unsubSync = sync.subscribe((state) => {
      setSyncState(state);
    });

    const handleMilestoneCelebration = (e) => {
      if (e.detail) {
        setCelebrationModal(e.detail);
      }
    };
    window.addEventListener('DAILY_REVENUE_TARGET_REACHED', handleMilestoneCelebration);

    return () => {
      clearInterval(timer);
      unsubGdrive();
      unsubSync();
      window.removeEventListener('DAILY_REVENUE_TARGET_REACHED', handleMilestoneCelebration);
    };
  }, []);

  // Calculate Staff Leaderboard & Competition Stats
  const { leaderboard, totalStoreRevenue, totalStoreSalesCount } = useMemo(() => {
    return calculateStaffLeaderboard(sales, users, period);
  }, [sales, users, period]);

  // Executive KPI summary for Today
  const todayKPIs = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todaySales = sales.filter(s => s.status !== 'cancelled' && new Date(s.date).getTime() >= todayStart);

    const revenue = todaySales.reduce((sum, s) => sum + (s.grandTotal || 0), 0);
    const profit = todaySales.reduce((sum, s) => sum + (s.profit || 0), 0);
    const count = todaySales.length;
    const avgBasket = count > 0 ? revenue / count : 0;
    const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

    return { revenue, profit, count, avgBasket, profitMargin };
  }, [sales]);

  // Check today's revenue against target whenever sales change
  useEffect(() => {
    if (todayKPIs.revenue > 0) {
      checkAndTriggerRevenueNotification(todayKPIs.revenue);
    }
  }, [todayKPIs.revenue]);

  // Inventory & Customer quick alerts
  const lowStockCount = useMemo(() => products.filter(p => p.stock <= 10).length, [products]);
  const totalDebt = useMemo(() => customers.reduce((sum, c) => sum + (c.balance || 0), 0), [customers]);
  const indebtedCustomersCount = useMemo(() => customers.filter(c => c.balance > 0).length, [customers]);

  // Target calculations
  const targetProgressPercent = dailyTarget > 0 ? Math.min(100, (todayKPIs.revenue / dailyTarget) * 100) : 0;
  const isTargetAchieved = dailyTarget > 0 && todayKPIs.revenue >= dailyTarget;
  const remainingToTarget = Math.max(0, dailyTarget - todayKPIs.revenue);

  const handleSaveTarget = async (newAmount, newEnabled = targetNotifyEnabled) => {
    const val = parseFloat(newAmount) || 10000;
    setDailyTarget(val);
    await db.settings.put({ key: 'daily_revenue_target', value: val });
    await db.settings.put({ key: 'daily_revenue_notify_enabled', value: newEnabled });
    setTargetSavedMsg(true);
    setTimeout(() => setTargetSavedMsg(false), 2000);
  };

  const handleToggleNotify = async () => {
    const newVal = !targetNotifyEnabled;
    setTargetNotifyEnabled(newVal);
    await db.settings.put({ key: 'daily_revenue_notify_enabled', value: newVal });
  };

  const handleTestNotification = async () => {
    await testRevenueNotification(dailyTarget, todayKPIs.revenue > 0 ? todayKPIs.revenue : dailyTarget * 1.05);
  };

  const handleShareWhatsApp = () => {
    shareTargetAchievedViaWhatsApp(dailyTarget, todayKPIs.revenue, storeName);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-12 pt-2 px-3 sm:px-5 max-w-4xl mx-auto space-y-5 antialiased">
      
      {/* 1. EXECUTIVE WELCOME & COMMAND HEADER */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl">
        <div className="absolute -right-6 -top-6 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
        <div className="absolute right-24 bottom-0 w-28 h-28 bg-amber-500/10 rounded-full blur-xl pointer-events-none"></div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider">
                <Crown className="w-3 h-3 text-amber-400" />
                {t('admin_console', 'Yönetici Konsolu')}
              </span>
              <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                <Clock className="w-3 h-3 text-emerald-400" />
                {currentTime}
              </span>
            </div>
            
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <span>{storeName}</span>
            </h1>
            <p className="text-xs text-slate-300">
              {t('admin_welcome', 'Hoş Geldiniz')}, <strong className="text-amber-400">{currentUser?.name || 'Müdür'}</strong>. {t('admin_subtitle', 'Mağazanızın tüm canlı finans, personel ve stok durumu tek ekranda.')}
            </p>
          </div>

          {/* Quick Actions & Language Selector */}
          <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
            
            {/* Language Selector Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowLanguageMenu(!showLanguageMenu)}
                className="bg-slate-800/90 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 rounded-xl text-xs font-bold text-white transition active:scale-95 flex items-center gap-1.5 shadow"
                title="Dil Seçeneği"
              >
                <Globe className="w-3.5 h-3.5 text-sky-400" />
                <span className="uppercase font-mono">{language}</span>
                <span>{SUPPORTED_LANGUAGES.find(l => l.code === language)?.flag || '🇹🇷'}</span>
              </button>

              {showLanguageMenu && (
                <div className="absolute right-0 mt-2 w-36 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 space-y-0.5">
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => {
                        setLanguage(l.code);
                        setShowLanguageMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                        language === l.code ? 'bg-sky-500/20 text-sky-300 font-bold' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{l.flag}</span>
                        <span>{l.name}</span>
                      </span>
                      {language === l.code && <Check className="w-3.5 h-3.5 text-sky-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Google Drive Status badge */}
            <div className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono flex items-center gap-1.5 border ${
              gdriveState.isConfigured ? 'bg-sky-500/10 border-sky-500/30 text-sky-400' : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <Cloud className="w-3.5 h-3.5" />
              <span>{gdriveState.isConfigured ? t('drive_live', 'Drive Canlı ⚡') : t('drive_off', 'Drive Kapalı')}</span>
            </div>

            {/* Change Profile */}
            <button
              onClick={openLogin}
              className="bg-slate-800/90 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition active:scale-95 flex items-center gap-1.5 shadow"
              title={t('change_profile', 'Kullanıcı Değiştir / Çıkış')}
            >
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t('change_profile', 'Profili Değiştir')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. CANLI FİNANSAL NABIZ (EXECUTIVE LIVE KPIS) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Bugünkü Ciro */}
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-3.5 shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-semibold text-[11px]">{t('kpi_today_revenue', 'Bugünkü Ciro')}</span>
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono tracking-tight">
            ₺{todayKPIs.revenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
            <span className="text-emerald-400 font-bold">{t('kpi_live_sales', 'Canlı Satış')}</span>
          </p>
        </div>

        {/* Canlı Kâr (Sadece Yönetici Görür) */}
        <div className="bg-slate-900/90 border border-purple-500/30 rounded-2xl p-3.5 shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-semibold text-[11px]">{t('kpi_today_profit', 'Bugünkü Kâr 🔒')}</span>
            <div className="w-6 h-6 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-purple-400 font-mono tracking-tight">
            ₺{todayKPIs.profit.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            {t('kpi_profit_margin', 'Kâr Marjı')}: <span className="text-purple-300 font-bold">%{todayKPIs.profitMargin.toFixed(1)}</span>
          </p>
        </div>

        {/* Fiş / Satış Adedi */}
        <div className="bg-slate-900/90 border border-sky-500/30 rounded-2xl p-3.5 shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-semibold text-[11px]">{t('kpi_today_sales', 'Toplam Satış')}</span>
            <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <Receipt className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-white font-mono tracking-tight">
            {todayKPIs.count} <span className="text-xs font-normal text-slate-400">{t('kpi_receipts', 'Fiş')}</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            {todayKPIs.count > 0 ? 'Tamamlanan Satış' : 'Bekleniyor'}
          </p>
        </div>

        {/* Ortalama Sepet */}
        <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-3.5 shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="font-semibold text-[11px]">{t('kpi_avg_basket', 'Ortalama Sepet')}</span>
            <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Target className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-400 font-mono tracking-tight">
            ₺{todayKPIs.avgBasket.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            {t('kpi_per_receipt', 'Fiş başı ortalama')}
          </p>
        </div>
      </div>

      {/* 3. 🎯 GÜNLÜK CİRO HEDEFİ & CANLI BİLDİRİM KARTI */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/30 border border-sky-500/40 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-500/30">
                <BellRing className="w-4 h-4 animate-bounce" />
              </div>
              <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                <span>{t('target_card_title', 'Günlük Ciro Hedefi & Canlı Bildirim')}</span>
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              {t('target_card_subtitle', 'Belirlediğiniz günlük ciro eşiğine ulaşıldığında sesli ve görsel bildirim alın.')}
            </p>
          </div>

          {/* Toggle Switch */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={handleToggleNotify}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border ${
                targetNotifyEnabled
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${targetNotifyEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
              <span>{targetNotifyEnabled ? 'Bildirim Açık' : 'Bildirim Kapalı'}</span>
            </button>
          </div>
        </div>

        {/* Target Progress Bar & Live Status */}
        <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-bold flex items-center gap-1.5">
              <span>{t('target_progress', "Bugünkü İlerleme")}:</span>
              <strong className="text-emerald-400 font-mono text-sm">
                ₺{todayKPIs.revenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
              </strong>
              <span className="text-slate-500">/</span>
              <span className="text-slate-400 font-mono">
                ₺{dailyTarget.toLocaleString('tr-TR')}
              </span>
            </span>

            <span className={`font-mono font-black text-xs px-2 py-0.5 rounded-lg ${
              isTargetAchieved ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-sky-500/20 text-sky-300'
            }`}>
              %{targetProgressPercent.toFixed(1)}
            </span>
          </div>

          {/* Visual Progress Bar */}
          <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                isTargetAchieved 
                  ? 'bg-gradient-to-r from-emerald-400 via-teal-400 to-amber-300 animate-pulse shadow-lg' 
                  : 'bg-gradient-to-r from-sky-500 to-emerald-400'
              }`}
              style={{ width: `${targetProgressPercent}%` }}
            ></div>
          </div>

          {/* Achievement Alert or Remaining Indicator */}
          {isTargetAchieved ? (
            <div className="flex items-center justify-between text-xs text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 p-2.5 rounded-xl font-medium">
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-yellow-400 animate-spin" />
                <span>{t('target_completed', 'Tebrikler! Günlük ciro hedefine ulaşıldı!')}</span>
              </span>
              <button
                onClick={handleShareWhatsApp}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1 active:scale-95 shadow"
              >
                <Share2 className="w-3 h-3" />
                <span>WhatsApp</span>
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <span>{t('target_remaining', 'Hedefe kalan')}:</span>
              <strong className="text-slate-200 font-mono">₺{remainingToTarget.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</strong>
            </p>
          )}
        </div>

        {/* Target Amount Configuration & Quick Buttons */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-300 block">
            {t('target_amount_label', 'Günlük Ciro Limiti (₺)')}
          </label>
          
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={dailyTarget}
              onChange={(e) => setDailyTarget(parseFloat(e.target.value) || 0)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-sky-500 font-bold"
              placeholder="10000"
            />
            <button
              type="button"
              onClick={() => handleSaveTarget(dailyTarget)}
              className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-xl text-xs font-bold active:scale-95 transition shadow"
            >
              {targetSavedMsg ? '✓ Kaydedildi' : t('save', 'Kaydet')}
            </button>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[11px] text-slate-500 font-semibold mr-1">Hızlı Seçim:</span>
            {[5000, 10000, 25000, 50000, 100000].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => handleSaveTarget(amt)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition ${
                  dailyTarget === amt
                    ? 'bg-sky-500 text-slate-950 shadow'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                ₺{amt.toLocaleString('tr-TR')}
              </button>
            ))}
          </div>
        </div>

        {/* Notification Action Buttons */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80 flex-wrap">
          <button
            type="button"
            onClick={handleTestNotification}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-400 px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
            title="Bildirim sesini ve konfetiyi test et"
          >
            <Bell className="w-3.5 h-3.5" />
            <span>{t('target_test_btn', '🔔 Bildirimi Test Et')}</span>
          </button>

          <button
            type="button"
            onClick={handleShareWhatsApp}
            className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>{t('target_share_wa', '📲 WhatsApp ile Bildir')}</span>
          </button>

          {'Notification' in window && Notification.permission !== 'granted' && (
            <button
              type="button"
              onClick={requestNotificationPermission}
              className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>{t('target_perm_btn', 'Bildirim İznini Aç 🔔')}</span>
            </button>
          )}
        </div>
      </section>

      {/* 4. 🏆 PERSONEL REKABET LİGİ & LİDERLİK TABLOSU (SADECE YÖNETİCİ) */}
      <section className="bg-slate-900 border border-amber-500/40 rounded-3xl p-4 sm:p-6 shadow-2xl shadow-amber-500/5 space-y-4">
        
        {/* Leaderboard Header with Time Filter */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                <Trophy className="w-4 h-4" />
              </div>
              <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                <span>{t('leaderboard_title', 'Personel Rekabet Sıralaması (Leaderboard)')}</span>
              </h2>
              <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                {t('admin_only', '🔒 Sadece Yönetici')}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {t('leaderboard_subtitle', 'Çalışanlar arası satış performansı, ciro katkısı ve haftanın şampiyonu tablosu.')}
            </p>
          </div>

          {/* Time Filter Buttons */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 self-start sm:self-auto">
            <button
              onClick={() => setPeriod('today')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                period === 'today' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('period_today', 'Bugün')}
            </button>
            <button
              onClick={() => setPeriod('week')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                period === 'week' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('period_week', 'Bu Hafta')}
            </button>
            <button
              onClick={() => setPeriod('month')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                period === 'month' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('period_month', 'Bu Ay')}
            </button>
            <button
              onClick={() => setPeriod('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                period === 'all' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('period_all', 'Tümü')}
            </button>
          </div>
        </div>

        {/* Total Period Summary Bar */}
        <div className="flex items-center justify-between text-xs bg-slate-950/80 px-3.5 py-2 rounded-xl border border-slate-800 font-mono">
          <span className="text-slate-400">{t('total_period_sales', 'Seçili Dönem Toplam Satışı')}:</span>
          <span className="text-emerald-400 font-bold text-sm">
            ₺{totalStoreRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ({totalStoreSalesCount} Fiş)
          </span>
        </div>

        {/* Podium & Ranking Cards */}
        {leaderboard.length === 0 || totalStoreRevenue === 0 ? (
          <div className="text-center py-8 bg-slate-950/50 rounded-2xl border border-slate-800/80 text-slate-400 space-y-2">
            <Trophy className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-xs font-medium">{t('no_sales_yet', 'Bu dönem için henüz tamamlanmış satış bulunmuyor.')}</p>
            <p className="text-[11px] text-slate-500">Kasiyerler satış yaptıkça sıralama ve madalyalar anında burada belirecektir.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {leaderboard.map((staff, idx) => {
              const isFirst = idx === 0 && staff.totalRevenue > 0;
              const isSecond = idx === 1 && staff.totalRevenue > 0;
              const isThird = idx === 2 && staff.totalRevenue > 0;

              return (
                <div
                  key={staff.id || idx}
                  className={`p-3 sm:p-4 rounded-2xl border transition-all duration-200 ${
                    isFirst
                      ? 'bg-gradient-to-r from-amber-500/15 via-slate-900 to-slate-900 border-amber-500/50 shadow-lg shadow-amber-500/10'
                      : isSecond
                      ? 'bg-gradient-to-r from-slate-400/10 via-slate-900 to-slate-900 border-slate-500/40'
                      : isThird
                      ? 'bg-gradient-to-r from-amber-700/15 via-slate-900 to-slate-900 border-amber-700/40'
                      : 'bg-slate-950 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    
                    {/* Rank Badge & Name */}
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0 shadow-md ${
                        isFirst
                          ? 'bg-amber-400 text-slate-950 border-2 border-amber-300 animate-pulse'
                          : isSecond
                          ? 'bg-slate-300 text-slate-950 border-2 border-slate-200'
                          : isThird
                          ? 'bg-amber-700 text-amber-100 border-2 border-amber-600'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {isFirst ? '🥇' : isSecond ? '🥈' : isThird ? '🥉' : `#${staff.rank}`}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs sm:text-sm font-black text-white">
                            {staff.name}
                          </span>
                          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded font-mono">
                            {staff.role === 'admin' ? 'Müdür' : 'Kasiyer'}
                          </span>

                          {/* Badges */}
                          {staff.badges?.map((badge, bIdx) => (
                            <span
                              key={bIdx}
                              className={`text-[10px] px-2 py-0.2 rounded-full font-bold bg-slate-800/90 border border-slate-700 flex items-center gap-1 ${badge.color}`}
                            >
                              <span>{badge.icon}</span>
                              <span>{badge.label}</span>
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1 font-mono">
                          <span>{staff.salesCount} {t('sales_count', 'Satış')}</span>
                          <span>•</span>
                          <span>{staff.totalItemsSold} {t('items_count', 'Ürün')}</span>
                          <span>•</span>
                          <span>Ort. Sepet: ₺{staff.avgBasket.toFixed(0)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Revenue & Share */}
                    <div className="text-right shrink-0">
                      <div className="text-sm sm:text-base font-black font-mono text-emerald-400">
                        ₺{staff.totalRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {t('revenue_share', 'Ciro Payı')}: <strong className="text-amber-400">%{staff.revenueShare.toFixed(1)}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Revenue Contribution Progress Bar */}
                  <div className="mt-2.5 w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isFirst ? 'bg-gradient-to-r from-amber-400 to-emerald-400' : 'bg-emerald-500/70'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(5, staff.revenueShare))}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 5. 📚 YÖNETİM KİTAPLIĞI / MODÜL RAFLARI (BENTO SHELF) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
            <h2 className="text-sm sm:text-base font-black text-white">
              {t('shelf_title', 'Yönetim Kitaplığı & Modül Rafları')}
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">{t('shelf_subtitle', 'Tek dokunuşla modüllere erişim')}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          
          {/* RAF 1: KASA & SATIŞ */}
          <button
            onClick={() => onNavigate('pos')}
            className="group text-left bg-gradient-to-br from-slate-900 to-slate-900/80 hover:to-slate-800/80 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-4 shadow-lg transition-all duration-200 active:scale-98 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5" />
                </div>
                {cartItemCount > 0 && (
                  <span className="bg-emerald-500 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded-full">
                    {cartItemCount} Ürün Sepette
                  </span>
                )}
              </div>
              <h3 className="text-sm font-bold text-white group-hover:text-emerald-400 transition">
                {t('shelf_pos_title', 'Kasa (Satış Ekranı)')}
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {t('shelf_pos_desc', 'Kamera & barkod okutma, nakit/kart/veresiye tahsilat ve fiş yazdırma.')}
              </p>
            </div>
            <div className="mt-4 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs text-emerald-400 font-bold">
              <span>{t('shelf_pos_action', 'Kasayı Aç')}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
            </div>
          </button>

          {/* RAF 2: ÜRÜN & STOK YÖNETİMİ */}
          <button
            onClick={() => onNavigate('products')}
            className="group text-left bg-gradient-to-br from-slate-900 to-slate-900/80 hover:to-slate-800/80 border border-slate-800 hover:border-sky-500/50 rounded-2xl p-4 shadow-lg transition-all duration-200 active:scale-98 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center">
                  <Package className="w-5 h-5" />
                </div>
                {lowStockCount > 0 && (
                  <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {lowStockCount} Kritik
                  </span>
                )}
              </div>
              <h3 className="text-sm font-bold text-white group-hover:text-sky-400 transition">
                {t('shelf_products_title', 'Ürün & Stok Rafı')}
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {t('shelf_products_desc', 'Toplam kayıtlı ürün, hazır internet barkodları ve fiyat güncellemeleri.')}
              </p>
            </div>
            <div className="mt-4 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs text-sky-400 font-bold">
              <span>{t('shelf_products_action', 'Stokları İncele')} ({products.length})</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
            </div>
          </button>

          {/* RAF 3: VERESİYE DEFTERİ */}
          <button
            onClick={() => onNavigate('customers')}
            className="group text-left bg-gradient-to-br from-slate-900 to-slate-900/80 hover:to-slate-800/80 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-4 shadow-lg transition-all duration-200 active:scale-98 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold">
                  ₺{totalDebt.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} Alacak
                </span>
              </div>
              <h3 className="text-sm font-bold text-white group-hover:text-amber-400 transition">
                {t('shelf_customers_title', 'Veresiye & Müşteri Defteri')}
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                <strong className="text-white">{indebtedCustomersCount}</strong> {t('shelf_customers_desc', 'borçlu müşteri takibi, tahsilat ve ekstre.')}
              </p>
            </div>
            <div className="mt-4 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs text-amber-400 font-bold">
              <span>{t('shelf_customers_action', 'Defteri Aç')}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
            </div>
          </button>

          {/* RAF 4: Z RAPORU & MALİ ANALİZ */}
          <button
            onClick={() => onNavigate('reports')}
            className="group text-left bg-gradient-to-br from-slate-900 to-slate-900/80 hover:to-slate-800/80 border border-slate-800 hover:border-purple-500/50 rounded-2xl p-4 shadow-lg transition-all duration-200 active:scale-98 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-bold">
                  Mali Döküm
                </span>
              </div>
              <h3 className="text-sm font-bold text-white group-hover:text-purple-400 transition">
                {t('shelf_reports_title', 'Raporlar & Z Raporu')}
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {t('shelf_reports_desc', 'Nakit/Kart dağılımı, gün sonu Z raporu alma, PDF çıktısı ve geçmiş satış iptalleri.')}
              </p>
            </div>
            <div className="mt-4 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs text-purple-400 font-bold">
              <span>{t('shelf_reports_action', 'Z Raporu Al')}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
            </div>
          </button>

          {/* RAF 5: PERSONEL & PIN YÖNETİMİ */}
          <button
            onClick={() => onNavigate('users')}
            className="group text-left bg-gradient-to-br from-slate-900 to-slate-900/80 hover:to-slate-800/80 border border-slate-800 hover:border-teal-500/50 rounded-2xl p-4 shadow-lg transition-all duration-200 active:scale-98 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 border border-teal-500/30 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <span className="text-[10px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded-full font-bold font-mono">
                  {users.length} Çalışan
                </span>
              </div>
              <h3 className="text-sm font-bold text-white group-hover:text-teal-400 transition">
                {t('shelf_users_title', 'Personel & PIN Yönetimi')}
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {t('shelf_users_desc', 'Kasiyer ekleme, PIN şifreleri belirleme, ekran yetkilerini kısıtlama veya açma.')}
              </p>
            </div>
            <div className="mt-4 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs text-teal-400 font-bold">
              <span>{t('shelf_users_action', 'Personeli Yönet')}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
            </div>
          </button>

          {/* RAF 6: GOOGLE DRIVE & SİSTEM AYARLARI */}
          <button
            onClick={() => onNavigate('settings')}
            className="group text-left bg-gradient-to-br from-slate-900 to-slate-900/80 hover:to-slate-800/80 border border-slate-800 hover:border-sky-500/50 rounded-2xl p-4 shadow-lg transition-all duration-200 active:scale-98 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center">
                  <Cloud className="w-5 h-5" />
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold font-mono ${
                  gdriveState.isConfigured ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-800 text-slate-400'
                }`}>
                  {gdriveState.isConfigured ? '1s Canlı' : 'Bağlı Değil'}
                </span>
              </div>
              <h3 className="text-sm font-bold text-white group-hover:text-sky-400 transition">
                {t('shelf_settings_title', 'Ayarlar & Google Drive')}
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {t('shelf_settings_desc', 'Apps Script bağlantısı, mağaza adı ve fiş ayarları, veritabanı yedekleme ve geri yükleme.')}
              </p>
            </div>
            <div className="mt-4 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs text-sky-400 font-bold">
              <span>{t('shelf_settings_action', 'Ayarları Aç')}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
            </div>
          </button>

        </div>
      </section>

      {/* 6. CELEBRATION MODAL (WHEN TARGET REACHED OR TESTED) */}
      {celebrationModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950/60 border-2 border-emerald-400/60 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-3xl bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 flex items-center justify-center mx-auto text-3xl shadow-lg">
              🎉
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-black text-white tracking-tight">
                TEBRİKLER!
              </h3>
              <p className="text-xs text-emerald-300 font-semibold">
                Günlük Ciro Hedefiniz Aşıldı! 🚀
              </p>
            </div>

            <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800 space-y-1 font-mono">
              <div className="text-xs text-slate-400">Hedef Ciro</div>
              <div className="text-sm text-slate-300 font-bold">₺{celebrationModal.target.toLocaleString('tr-TR')}</div>
              <div className="text-xs text-slate-400 pt-2">Ulaşılan Ciro</div>
              <div className="text-2xl font-black text-emerald-400">₺{celebrationModal.currentRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setCelebrationModal(null)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 rounded-xl text-xs font-bold transition"
              >
                Harika! Kapat
              </button>
              <button
                onClick={() => {
                  shareTargetAchievedViaWhatsApp(celebrationModal.target, celebrationModal.currentRevenue, storeName);
                  setCelebrationModal(null);
                }}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>WhatsApp</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
