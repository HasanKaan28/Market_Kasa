import React, { lazy, Suspense, useState, useEffect } from 'react';
import { db, seedInitialData, cleanupPreloadedProducts, removeInitialDemoData, switchToMarket } from './db/db';
import Navbar from './components/Navbar';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { sync } from './utils/sync';
import { googleDriveSync } from './utils/googleDriveSync';
import { LayoutDashboard, ShoppingCart, Package, BookUser, BarChart3, X, ArrowRight, Check } from 'lucide-react';

const PosScreen = lazy(() => import('./components/PosScreen'));
const ProductCatalog = lazy(() => import('./components/ProductCatalog'));
const CustomerBook = lazy(() => import('./components/CustomerBook'));
const ReportsView = lazy(() => import('./components/ReportsView'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));

const MARKET_SESSION_KEY = 'market_session_v1';
const MARKET_REGISTRY_KEY = 'market_registry_v1';

function getStoredMarket() {
  try {
    const raw = localStorage.getItem(MARKET_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getMarketRegistry() {
  try {
    const raw = localStorage.getItem(MARKET_REGISTRY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persistMarketSession(market) {
  const registry = getMarketRegistry();
  const normalizedName = (market.name || '').trim();
  const existingIndex = registry.findIndex(item => item.name.toLowerCase() === normalizedName.toLowerCase());
  const nextMarket = {
    id: market.id || `${normalizedName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    name: normalizedName,
    email: (market.email || '').trim(),
    password: market.password || '',
    createdAt: market.createdAt || new Date().toISOString(),
    location: market.location || null,
    members: Array.isArray(market.members) ? market.members : [],
    logo: market.logo || ''
  };

  if (existingIndex >= 0) {
    registry[existingIndex] = { ...registry[existingIndex], ...nextMarket };
  } else {
    registry.push(nextMarket);
  }

  localStorage.setItem(MARKET_REGISTRY_KEY, JSON.stringify(registry));
  localStorage.setItem(MARKET_SESSION_KEY, JSON.stringify(nextMarket));

  db.settings.put({ key: 'storeName', value: nextMarket.name }).catch(() => {});
  return nextMarket;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());
}

function openMailTo(recipient, subject, body) {
  const mailto = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(mailto, '_blank');
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendVerificationEmail(recipient, code) {
  const response = await fetch('/api/send-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient, code })
  });

  if (!response.ok) {
    throw new Error('Doğrulama e-postası gönderilemedi.');
  }
}

function MarketSetupScreen({ onComplete }) {
  const [mode, setMode] = useState('create');
  const [marketName, setMarketName] = useState('');
  const [marketEmail, setMarketEmail] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationInput, setVerificationInput] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [emailDeliveryMode, setEmailDeliveryMode] = useState('api');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const resetVerificationState = () => {
    setVerificationCode('');
    setVerificationInput('');
    setVerificationSent(false);
    setEmailVerified(false);
    setError('');
    setSuccess('');
  };

  const validateCurrentEmail = async () => {
    if (!marketEmail.trim()) {
      setError('Market sahibi e-posta adresi gerekli.');
      setEmailVerified(false);
      return false;
    }

    if (!validateEmail(marketEmail)) {
      setError('Geçerli bir e-posta adresi girin.');
      setEmailVerified(false);
      return false;
    }

    const nextCode = generateVerificationCode();
    setVerificationCode(nextCode);
    setVerificationInput('');
    setVerificationSent(true);
    setEmailVerified(false);

    try {
      await sendVerificationEmail(marketEmail.trim(), nextCode);
      setEmailDeliveryMode('api');
      setSuccess('6 haneli doğrulama kodu e-posta adresinize gönderildi.');
    } catch {
      setEmailDeliveryMode('fallback');
      const mailBody = [
        'Market Kasa e-posta doğrulama',
        '',
        'Aşağıdaki doğrulama kodunu uygulamaya girin.',
        `Kod: ${nextCode}`,
        '',
        'Bu e-posta otomatik olarak oluşturulmuştur.'
      ].join('\n');
      openMailTo(marketEmail, 'Market Kasa e-posta doğrulama', mailBody);
      setSuccess('E-posta API kullanılamadı; mail taslağı açıldı. Kod aşağıda gösteriliyor.');
    }
    setError('');
    return true;
  };

  const confirmVerificationCode = () => {
    if (!verificationSent) {
      setError('Önce doğrulama kodu gönderilmelidir.');
      return false;
    }

    if (!verificationInput.trim()) {
      setError('Doğrulama kodunu girin.');
      return false;
    }

    if (verificationInput.trim() !== verificationCode) {
      setError('Doğrulama kodu yanlış. Lütfen e-postadaki kodu kontrol edin.');
      return false;
    }

    setEmailVerified(true);
    setError('');
    setSuccess('E-posta doğrulandı. Artık marketinizi oluşturabilirsiniz.');
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = marketName.trim();
    const pass = password.trim();

    if (!name || !pass) {
      setError('Market adı ve şifre gerekli.');
      return;
    }

    const registry = getMarketRegistry();
    const normalized = name.toLowerCase();

    if (mode === 'create') {
      if (!marketEmail.trim() || !validateEmail(marketEmail)) {
        setError('Market oluşturmak için geçerli bir e-posta adresi girmeniz gerekir.');
        return;
      }

      if (!verificationSent || !emailVerified) {
        setError('Lütfen önce e-posta doğrulamasını tamamlayın.');
        return;
      }

      const exists = registry.some(item => item.name.toLowerCase() === normalized);
      if (exists) {
        setError('Bu market adı zaten mevcut. Lütfen farklı bir isim seçin veya "Markete Katıl" modunu kullanın.');
        return;
      }

      const market = persistMarketSession({
        name,
        email: marketEmail,
        password: pass,
        createdAt: new Date().toISOString(),
        location: null,
        members: []
      });

      setSuccess('Market oluşturuldu. Giriş başlatılıyor...');
      onComplete(market);
      return;
    }

    const found = registry.find(item => item.name.toLowerCase() === normalized);
    if (!found) {
      setError('Bu isimde kayıtlı market bulunamadı. Önce market oluşturun.');
      return;
    }
    if (found.password !== pass) {
      setError('Market şifresi yanlış.');
      return;
    }
    const memberInfo = {
      name: 'Market kullanıcısı',
      joinedAt: new Date().toISOString(),
      market: found.name
    };

    const updatedRegistry = getMarketRegistry().map(item => item.name.toLowerCase() === normalized ? { ...item, members: [...(item.members || []), memberInfo] } : item);
    localStorage.setItem(MARKET_REGISTRY_KEY, JSON.stringify(updatedRegistry));

    const mailBody = [
      'Yeni market katılım bildirimi',
      '',
      `Market: ${found.name}`,
      `Katılım Tarihi: ${new Date().toLocaleString('tr-TR')}`,
      '',
      'Bu e-posta otomatik olarak oluşturulmuştur.'
    ].join('\n');

    openMailTo(found.email, `Yeni katılım: ${found.name}`, mailBody);

    const market = persistMarketSession({ ...found, members: updatedRegistry.find(item => item.name.toLowerCase() === normalized)?.members || found.members || [] });
    setSuccess('Katılım onayı için market sahibine e-posta hazırlandı.');
    onComplete(market);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#eff6ff,_#e2e8f0_38%,_#dfe7f3_100%)] flex items-center justify-center p-4 text-slate-800">
      <div className="w-full max-w-md rounded-[32px] bg-white/90 border border-slate-200 shadow-[0_30px_80px_rgba(37,99,235,0.12)] p-5 backdrop-blur-md">
        <div className="mb-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-2xl font-black text-blue-700 shadow-inner shadow-blue-200">
            M
          </div>
          <h1 className="mt-4 text-2xl font-black tracking-tight text-slate-900">Market Giriş</h1>
          <p className="mt-1 text-xs text-slate-500">Her market kendi arayüzü ve verisiyle çalışır.</p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => { setMode('create'); setError(''); setSuccess(''); resetVerificationState(); }}
            className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
              mode === 'create' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-600'
            }`}
          >
            Market Oluştur
          </button>
          <button
            type="button"
            onClick={() => { setMode('join'); setError(''); setSuccess(''); resetVerificationState(); }}
            className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
              mode === 'join' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-600'
            }`}
          >
            Markete Katıl
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Market adı</label>
            <input
              value={marketName}
              onChange={(e) => setMarketName(e.target.value)}
              placeholder="Örn. Aysu Market"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {mode === 'create' && (
            <>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Market sahibi e-posta</label>
                <input
                  type="email"
                  value={marketEmail}
                  onChange={(e) => {
                    setMarketEmail(e.target.value);
                    resetVerificationState();
                  }}
                  placeholder="market@sahibi.com"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={validateCurrentEmail}
                className="w-full rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"
              >
                {emailVerified ? 'E-posta Doğrulandı' : verificationSent ? 'Yeniden Kod Gönder' : 'E-posta Doğrula'}
              </button>

              {verificationSent && !emailVerified && (
                <div className="space-y-2 rounded-2xl border border-blue-100 bg-blue-50/80 p-3">
                  {emailDeliveryMode === 'fallback' && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">E-posta gönderilemedi</p>
                      <p className="mt-1 text-[10px] text-amber-700">Mail taslağındaki kodu kullanın veya e-posta API ayarlarını kontrol edin.</p>
                    </div>
                  )}
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Doğrulama kodu</label>
                  <input
                    value={verificationInput}
                    onChange={(e) => setVerificationInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6 haneli kod"
                    className="w-full rounded-2xl border border-blue-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={confirmVerificationCode}
                    className="w-full rounded-2xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"
                  >
                    Kodu Onayla
                  </button>
                </div>
              )}
            </>
          )}

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Market şifresi</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Şifre girin"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              {success}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-200 transition active:scale-[0.99]"
          >
            {mode === 'create' ? 'Market Oluştur ve Giriş Yap' : 'Markete Katıl'}
          </button>
        </form>
      </div>
    </div>
  );
}

const TUTORIAL_STEPS = [
  {
    title: 'Kontrol paneli',
    description: 'Günün cirosunu, kârını, satış sayısını ve hedef ilerlemesini tek ekranda takip edin.',
    icon: LayoutDashboard,
    color: 'bg-blue-100 text-blue-700'
  },
  {
    title: 'Kasa satışı',
    description: 'Ürünleri arayın veya barkod okutun, sepete ekleyin ve ödemeyi tamamlayın.',
    icon: ShoppingCart,
    color: 'bg-emerald-100 text-emerald-700'
  },
  {
    title: 'Ürün kataloğu',
    description: 'Ürün fiyatı, stok miktarı ve barkod bilgilerini buradan yönetin.',
    icon: Package,
    color: 'bg-violet-100 text-violet-700'
  },
  {
    title: 'Veresiye defteri',
    description: 'Müşteri ekleyin, borç hareketlerini izleyin ve WhatsApp hatırlatması gönderin.',
    icon: BookUser,
    color: 'bg-amber-100 text-amber-700'
  },
  {
    title: 'Raporlar ve ayarlar',
    description: 'Satış raporlarını inceleyin, yedekleme ve market ayarlarını yönetin.',
    icon: BarChart3,
    color: 'bg-sky-100 text-sky-700'
  }
];

function TutorialOverlay({ marketName, onClose }) {
  const [step, setStep] = useState(-1);
  const isPrompt = step === -1;
  const currentStep = TUTORIAL_STEPS[Math.max(step, 0)];
  const Icon = currentStep.icon;

  const finish = () => {
    localStorage.setItem(`market_tutorial_seen_v1:${marketName}`, 'true');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-blue-100 bg-white shadow-[0_24px_80px_rgba(37,99,235,0.2)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">Market Kasa öğretici</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">
              {isPrompt ? 'Kısa bir tur ister misiniz?' : `${step + 1}. adım: ${currentStep.title}`}
            </h2>
          </div>
          <button type="button" onClick={finish} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Öğreticiyi kapat">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {isPrompt ? (
            <>
              <div className="mb-5 rounded-2xl bg-blue-50 p-5 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-white text-blue-600 shadow-sm">
                  <LayoutDashboard className="h-10 w-10" />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  {marketName} içindeki kasa, ürün, veresiye ve rapor bölümlerini birkaç adımda tanıyalım.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={finish} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Şimdi değil</button>
                <button type="button" onClick={() => setStep(0)} className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700">Başlayalım <ArrowRight className="h-4 w-4" /></button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-5 rounded-2xl bg-slate-50 p-5">
                <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-blue-200 bg-gradient-to-br from-blue-50 to-white">
                  <div className="text-center">
                    <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${currentStep.color}`}>
                      <Icon className="h-8 w-8" />
                    </div>
                    <p className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">{currentStep.title}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">{currentStep.description}</p>
              </div>
              <div className="mb-4 flex justify-center gap-1.5">
                {TUTORIAL_STEPS.map((item, index) => <span key={item.title} className={`h-1.5 rounded-full transition-all ${index === step ? 'w-7 bg-blue-600' : 'w-1.5 bg-slate-200'}`} />)}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={finish} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600">Atla</button>
                <button type="button" onClick={() => step === TUTORIAL_STEPS.length - 1 ? finish() : setStep(step + 1)} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700">
                  {step === TUTORIAL_STEPS.length - 1 ? <>Tamamla <Check className="h-4 w-4" /></> : <>Sonraki <ArrowRight className="h-4 w-4" /></>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AppContent({ marketSession, onMarketUpdate, onMarketExit }) {
  const [activeTab, setActiveTab] = useState('pos');
  const [cart, setCart] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [hasInitDashboard, setHasInitDashboard] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  const { currentUser, hasPermission } = useAuth();

  useEffect(() => {
    // Clean up preloaded library/dummy products so user catalog remains clean
    cleanupPreloadedProducts();

    // Start real-time sync manager and Google Drive sync
    sync.init(marketSession.id);
    googleDriveSync.setMarketContext(marketSession.id, marketSession.name);
    googleDriveSync.init();

    // Catch PWA install prompt event
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setIsInstalled(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, [marketSession.id, marketSession.name]);

  // Ensure user cannot stay on an unauthorized tab & default Admin to single-page Kitaplık
  useEffect(() => {
    if (!currentUser) return;

    // Default admin to the single-page Kitaplık dashboard on login
    if (currentUser.role === 'admin' && !hasInitDashboard) {
      setActiveTab('dashboard');
      setHasInitDashboard(true);
      return;
    }

    // Cashiers cannot access admin dashboard
    if (activeTab === 'dashboard' && currentUser.role !== 'admin') {
      setActiveTab('pos');
      return;
    }

    const tabPermissions = {
      dashboard: 'canManageUsers',
      pos: 'canAccessPos',
      products: 'canAccessProducts',
      customers: 'canAccessCustomers',
      reports: 'canAccessReports',
      users: 'canManageUsers',
      settings: 'canAccessSettings'
    };

    const requiredPerm = tabPermissions[activeTab];
    if (requiredPerm && !hasPermission(requiredPerm)) {
      if (currentUser.role === 'admin') setActiveTab('dashboard');
      else if (hasPermission('canAccessPos')) setActiveTab('pos');
      else if (hasPermission('canAccessProducts')) setActiveTab('products');
      else if (hasPermission('canAccessCustomers')) setActiveTab('customers');
      else if (hasPermission('canAccessReports')) setActiveTab('reports');
      else if (hasPermission('canAccessSettings')) setActiveTab('settings');
    }
  }, [currentUser, activeTab, hasInitDashboard]);

  useEffect(() => {
    if (!currentUser || !marketSession?.name) return;
    const tutorialKey = `market_tutorial_seen_v1:${marketSession.name}`;
    if (!localStorage.getItem(tutorialKey)) setShowTutorial(true);
  }, [currentUser, marketSession?.name]);

  const handleInstallApp = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
        setInstallPrompt(null);
      }
    } else {
      alert('Android cihazınızda uygulamayı indirmek için:\n\n1. Chrome tarayıcısının sağ üstündeki üç noktaya (⋮) dokunun.\n2. "Ana Ekrana Ekle" veya "Uygulamayı Yükle" seçeneğine basın.\n3. Market Kasa telefonunuza doğrudan yüklenecektir.');
    }
  };

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="app-shell h-[100dvh] max-h-[100dvh] text-slate-800 flex flex-col overflow-hidden antialiased selection:bg-slate-900 selection:text-white">
      {showTutorial && <TutorialOverlay marketName={marketSession.name} onClose={() => setShowTutorial(false)} />}
      
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        cartItemCount={totalCartCount}
        onInstallClick={handleInstallApp}
        isInstalled={isInstalled}
        marketSession={marketSession}
        onMarketUpdate={onMarketUpdate}
        onMarketExit={onMarketExit}
      />

      {/* Main View Container */}
      <main className={`flex-1 min-h-0 w-full mx-auto ${
        activeTab === 'pos'
          ? `flex flex-col overflow-hidden max-w-7xl px-0 sm:px-2 lg:px-4 ${currentUser?.role === 'admin' ? 'pb-0' : 'pb-[56px] md:pb-0'}`
          : `overflow-y-auto px-2 lg:px-4 ${currentUser?.role === 'admin' ? 'pb-4' : 'pb-20 md:pb-6'} ${activeTab === 'dashboard' ? 'max-w-6xl' : 'max-w-5xl'}`
      }`}>
        <Suspense fallback={
          <div className="flex min-h-32 items-center justify-center text-sm text-slate-500">
            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            Ekran yükleniyor...
          </div>
        }>
          {activeTab === 'dashboard' && currentUser?.role === 'admin' && (
            <AdminDashboard onNavigate={setActiveTab} cartItemCount={totalCartCount} />
          )}
          {activeTab === 'pos' && hasPermission('canAccessPos') && (
            <PosScreen cart={cart} setCart={setCart} />
          )}
          {activeTab === 'products' && hasPermission('canAccessProducts') && (
            <ProductCatalog />
          )}
          {activeTab === 'customers' && hasPermission('canAccessCustomers') && (
            <CustomerBook />
          )}
          {activeTab === 'reports' && hasPermission('canAccessReports') && (
            <ReportsView />
          )}
          {activeTab === 'users' && hasPermission('canManageUsers') && (
            <UserManagement />
          )}
          {activeTab === 'settings' && hasPermission('canAccessSettings') && (
            <SettingsView onInstallClick={handleInstallApp} />
          )}
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [marketSession, setMarketSession] = useState(() => getStoredMarket());

  useEffect(() => {
    async function init() {
      try {
        const storedMarket = getStoredMarket();
        if (storedMarket?.id) await switchToMarket(storedMarket.id);
        await seedInitialData();
        await removeInitialDemoData();
      } catch (err) {
        console.error('DB Init Error:', err);
      } finally {
        setDbReady(true);
      }
    }
    init();
  }, []);

  if (!dbReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-slate-700 p-4">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-semibold tracking-wide text-slate-700">Market Kasası Başlatılıyor...</p>
        <p className="text-xs text-slate-500 mt-1">Veritabanı ve canlı senkronizasyon sistemi yükleniyor</p>
      </div>
    );
  }

  if (!marketSession) {
    return (
      <LanguageProvider>
        <MarketSetupScreen
          onComplete={async (market) => {
            await switchToMarket(market.id);
            setMarketSession(market);
          }}
        />
      </LanguageProvider>
    );
  }

  return (
    <LanguageProvider>
      <AuthProvider>
        <AppContent
          marketSession={marketSession}
          onMarketUpdate={(market) => setMarketSession(persistMarketSession(market))}
          onMarketExit={() => {
            localStorage.removeItem(MARKET_SESSION_KEY);
            setMarketSession(null);
          }}
        />
      </AuthProvider>
    </LanguageProvider>
  );
}
