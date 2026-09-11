import React, { lazy, Suspense, useState, useEffect } from 'react';
import { seedInitialData, cleanupPreloadedProducts } from './db/db';
import Navbar from './components/Navbar';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { sync } from './utils/sync';
import { googleDriveSync } from './utils/googleDriveSync';
import { Download, Smartphone, X } from 'lucide-react';

const PosScreen = lazy(() => import('./components/PosScreen'));
const ProductCatalog = lazy(() => import('./components/ProductCatalog'));
const CustomerBook = lazy(() => import('./components/CustomerBook'));
const ReportsView = lazy(() => import('./components/ReportsView'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));

function AppContent() {
  const [activeTab, setActiveTab] = useState('pos');
  const [cart, setCart] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [hideBanner, setHideBanner] = useState(false);
  const [hasInitDashboard, setHasInitDashboard] = useState(false);

  const { currentUser, hasPermission } = useAuth();

  useEffect(() => {
    // Clean up preloaded library/dummy products so user catalog remains clean
    cleanupPreloadedProducts();

    // Start real-time sync manager and Google Drive sync
    sync.init();
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
  }, []);

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
    <div className="app-shell h-[100dvh] max-h-[100dvh] text-zinc-100 flex flex-col overflow-hidden antialiased selection:bg-emerald-500 selection:text-zinc-950">
      
      {/* Top Installation Banner */}
      {!isInstalled && !hideBanner && (
        <div className="shrink-0 bg-gradient-to-r from-emerald-600 to-teal-700 text-white px-3 py-1.5 flex items-center justify-between shadow-md z-50 text-xs font-semibold">
          <div className="flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 animate-bounce shrink-0" />
            <span className="text-[11px]">Telefona Kurulabilir Market POS</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleInstallApp}
              className="bg-white text-emerald-800 hover:bg-emerald-50 font-black px-2 py-0.5 rounded-lg text-xs shadow active:scale-95 transition flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              <span>Yükle</span>
            </button>
            <button
              onClick={() => setHideBanner(true)}
              className="text-white/80 hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        cartItemCount={totalCartCount}
        onInstallClick={handleInstallApp}
        isInstalled={isInstalled}
      />

      {/* Main View Container */}
      <main className={`flex-1 min-h-0 w-full mx-auto ${
        activeTab === 'pos'
          ? `flex flex-col overflow-hidden max-w-7xl px-0 sm:px-2 lg:px-4 ${currentUser?.role === 'admin' ? 'pb-0' : 'pb-[56px] md:pb-0'}`
          : `overflow-y-auto px-2 lg:px-4 ${currentUser?.role === 'admin' ? 'pb-4' : 'pb-20 md:pb-6'} ${activeTab === 'dashboard' ? 'max-w-6xl' : 'max-w-5xl'}`
      }`}>
        <Suspense fallback={
          <div className="flex min-h-32 items-center justify-center text-sm text-zinc-400">
            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
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

  useEffect(() => {
    async function init() {
      try {
        await seedInitialData();
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
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-semibold tracking-wide text-slate-300">Market Kasası Başlatılıyor...</p>
        <p className="text-xs text-slate-500 mt-1">Veritabanı ve canlı senkronizasyon sistemi yükleniyor</p>
      </div>
    );
  }

  return (
    <LanguageProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  );
}
