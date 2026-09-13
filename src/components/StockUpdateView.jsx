import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  PackagePlus, Search, Scan, Plus, Minus, ArrowRight, 
  RotateCcw, Check, AlertTriangle, Download, ArrowUpDown, 
  Boxes, Layers, TrendingUp, DollarSign, Tag, CheckCircle2, 
  X, History, Clock, FileSpreadsheet, Sparkles, Filter, ChevronRight, FileText, Building2
} from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { playBarcodeBeep, playErrorBeep, playCashRegisterSound } from '../utils/sound';
import BarcodeScanner from './BarcodeScanner';
import PurchaseInvoiceView from './PurchaseInvoiceView';
import SupplierPaymentsView from './SupplierPaymentsView';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export default function StockUpdateView({ onNavigate }) {
  const { hasPermission, currentUser } = useAuth();
  const { t } = useLanguage();

  // Top-level View Mode: 'invoice' (Toptancı Alış Faturası) | 'single' (Tekil Hızlı Stok & Sayım)
  const [viewMode, setViewMode] = useState('invoice');

  // Mode within single editor: 'add' (İrsaliye / Stok Ekleme) | 'count' (Raf Sayımı / Doğrudan Miktar Belirleme)
  const [mode, setMode] = useState('add');

  // Search & Barcode Input
  const [searchInput, setSearchInput] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showCameraScanner, setShowCameraScanner] = useState(false);

  // Form Values for Selected Product
  const [stockQuantity, setStockQuantity] = useState(1);
  const [editBuyPrice, setEditBuyPrice] = useState('');
  const [editSalePrice, setEditSalePrice] = useState('');
  const [updateSuccessToast, setUpdateSuccessToast] = useState(null);

  // Filter Tabs: 'all' | 'critical' (Kritik Stok <= 10) | 'out' (Tükenenler = 0)
  const [productFilter, setProductFilter] = useState('critical');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Session Log: Records of stock updates done in current session
  const [sessionLog, setSessionLog] = useState([]);
  const [showLogModal, setShowLogModal] = useState(false);

  const barcodeInputRef = useRef(null);

  // Query Products from Dexie
  const allDbProducts = useLiveQuery(() => db.products.toArray(), []) || [];
  const products = useMemo(() => allDbProducts.filter(p => !p.needsPricing && p.price > 0), [allDbProducts]);

  // Categories
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category || 'Genel'));
    return ['ALL', ...Array.from(cats)];
  }, [products]);

  // Low Stock & Out of Stock counts
  const criticalProducts = useMemo(() => products.filter(p => p.stock > 0 && p.stock <= 10), [products]);
  const outOfStockProducts = useMemo(() => products.filter(p => p.stock <= 0), [products]);

  // Filtered product suggestions
  const searchResults = useMemo(() => {
    if (!searchInput.trim()) return [];
    const q = searchInput.toLowerCase().trim();
    return products.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.barcode.includes(q) || 
      p.category?.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [products, searchInput]);

  // Filtered products for quick selection list
  const catalogList = useMemo(() => {
    let list = products;
    if (productFilter === 'critical') {
      list = products.filter(p => p.stock <= 10);
    } else if (productFilter === 'out') {
      list = products.filter(p => p.stock <= 0);
    }

    if (categoryFilter !== 'ALL') {
      list = list.filter(p => (p.category || 'Genel') === categoryFilter);
    }

    if (searchInput.trim()) {
      const q = searchInput.toLowerCase().trim();
      list = list.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.barcode.includes(q)
      );
    }

    return list.slice(0, 50);
  }, [products, productFilter, categoryFilter, searchInput]);

  // Auto-focus barcode input
  useEffect(() => {
    if (viewMode === 'single' && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, [viewMode]);

  // Set form fields when a product is selected
  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
    setEditBuyPrice(product.buyPrice ? product.buyPrice.toString() : '');
    setEditSalePrice(product.price ? product.price.toString() : '');
    if (mode === 'add') {
      setStockQuantity(1);
    } else {
      setStockQuantity(product.stock || 0);
    }
    playBarcodeBeep();
  };

  // Hardware Scanner / Enter key handler
  const handleBarcodeSubmit = (e) => {
    e?.preventDefault();
    const code = searchInput.trim();
    if (!code) return;

    // Exact barcode match first
    const match = products.find(p => p.barcode === code);
    if (match) {
      handleSelectProduct(match);
      setSearchInput('');
    } else {
      // Look for single search result
      if (searchResults.length === 1) {
        handleSelectProduct(searchResults[0]);
        setSearchInput('');
      } else if (searchResults.length === 0) {
        playErrorBeep();
        alert(`"${code}" barkodlu veya isimli ürün bulunamadı. Lütfen önce "Ürün & Stok" ekranından ekleyin.`);
      }
    }
  };

  // Camera Barcode Scan
  const handleCameraScan = (scannedCode) => {
    setShowCameraScanner(false);
    const code = scannedCode.trim();
    const match = products.find(p => p.barcode === code);
    if (match) {
      handleSelectProduct(match);
    } else {
      setSearchInput(code);
      playErrorBeep();
    }
  };

  // Quick Quantity Presets
  const handleQuantityPreset = (amount) => {
    if (mode === 'add') {
      setStockQuantity(prev => Math.max(1, (Number(prev) || 0) + amount));
    } else {
      setStockQuantity(amount);
    }
  };

  // Execute Stock Update
  const handleSaveStockUpdate = async () => {
    if (!selectedProduct) return;

    const qty = Number(stockQuantity);
    if (isNaN(qty) || qty < 0) {
      alert('Lütfen geçerli bir miktar girin.');
      return;
    }

    const previousStock = Number(selectedProduct.stock) || 0;
    let newCalculatedStock = 0;
    let delta = 0;

    if (mode === 'add') {
      delta = qty;
      newCalculatedStock = previousStock + qty;
    } else {
      // Sayım modu: Net yeni stok
      newCalculatedStock = qty;
      delta = newCalculatedStock - previousStock;
    }

    const buyP = parseFloat(editBuyPrice) || selectedProduct.buyPrice || 0;
    const sellP = parseFloat(editSalePrice) || selectedProduct.price || 0;

    const updatedFields = {
      stock: newCalculatedStock,
      buyPrice: buyP,
      price: sellP,
      updatedAt: new Date().toISOString()
    };

    try {
      await db.products.update(selectedProduct.id, updatedFields);

      // Broadcast to local Wi-Fi terminals and Google Drive
      const updatedProductObj = { ...selectedProduct, ...updatedFields };
      sync.broadcast('PRODUCT_SAVED', { product: updatedProductObj });
      googleDriveSync.triggerOnSaleSync();

      // Audio & Toast
      playCashRegisterSound();
      setUpdateSuccessToast({
        name: selectedProduct.name,
        delta: delta,
        newStock: newCalculatedStock,
        mode: mode
      });
      setTimeout(() => setUpdateSuccessToast(null), 3000);

      // Add to Session Log
      const logEntry = {
        id: Date.now(),
        productId: selectedProduct.id,
        name: selectedProduct.name,
        barcode: selectedProduct.barcode,
        unit: selectedProduct.unit || 'Adet',
        previousStock,
        newStock: newCalculatedStock,
        delta,
        mode,
        buyPrice: buyP,
        totalCost: mode === 'add' ? delta * buyP : 0,
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
      };
      setSessionLog(prev => [logEntry, ...prev]);

      // Reset selection for next quick scan
      setSelectedProduct(null);
      setSearchInput('');
      setStockQuantity(1);
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    } catch (err) {
      console.error('Stok güncelleme hatası:', err);
      alert('Stok kaydedilirken bir hata oluştu: ' + err.message);
    }
  };

  // Revert / Undo a specific log entry
  const handleUndoLogEntry = async (entry) => {
    if (confirm(`"${entry.name}" için yapılan ${entry.delta > 0 ? '+' : ''}${entry.delta} stok hareketini geri almak istiyor musunuz?`)) {
      try {
        await db.products.update(entry.productId, { stock: entry.previousStock });
        sync.broadcast('STOCK_ADJUSTED', { id: entry.productId, delta: -entry.delta });
        googleDriveSync.triggerOnSaleSync();

        setSessionLog(prev => prev.filter(item => item.id !== entry.id));
        playBarcodeBeep();
      } catch (err) {
        alert('Geri alma hatası: ' + err.message);
      }
    }
  };

  // Export Session Stock Intake to CSV
  const handleExportSessionCSV = () => {
    if (sessionLog.length === 0) return;
    const headers = ['Zaman', 'Barkod', 'Ürün Adı', 'İşlem', 'Önceki Stok', 'Fark / Eklenen', 'Yeni Stok', 'Birim', 'Birim Alış Fiyatı', 'Toplam Maliyet'];
    const rows = sessionLog.map(item => [
      `"${item.time}"`,
      `"${item.barcode}"`,
      `"${item.name}"`,
      item.mode === 'add' ? 'Mal Kabul (Ekleme)' : 'Sayım (Düzeltme)',
      item.previousStock,
      item.delta,
      item.newStock,
      `"${item.unit}"`,
      item.buyPrice.toFixed(2),
      item.totalCost.toFixed(2)
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `stok_giris_irsaliye_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sessionTotalAdded = sessionLog.filter(l => l.mode === 'add').reduce((sum, l) => sum + Math.max(0, l.delta), 0);
  const sessionTotalCost = sessionLog.filter(l => l.mode === 'add').reduce((sum, l) => sum + l.totalCost, 0);

  return (
    <div className="flex flex-col h-[calc(100dvh-57px-60px)] md:h-[calc(100dvh-60px)] max-w-7xl mx-auto px-2 sm:px-4 py-2 space-y-2 overflow-hidden antialiased">
      
      {/* Top Switcher Bar */}
      <div className="bg-slate-900 border border-slate-800 p-1.5 rounded-2xl flex items-center justify-between gap-2 shrink-0 shadow-md">
        <div className="flex items-center gap-1.5 flex-1 max-w-2xl">
          <button
            type="button"
            onClick={() => setViewMode('invoice')}
            className={`flex-1 py-2 px-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 ${
              viewMode === 'invoice'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span className="truncate">Alış Faturası (Mal Kabul)</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('payments')}
            className={`flex-1 py-2 px-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 ${
              viewMode === 'payments'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span className="truncate">Toptancı Ödemeleri & Cari</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('single')}
            className={`flex-1 py-2 px-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 ${
              viewMode === 'single'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span className="truncate">Hızlı Tekil Stok</span>
          </button>
        </div>

        <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400 pr-2 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Stok & Cari Eşitleme Aktif</span>
        </div>
      </div>

      {viewMode === 'invoice' && (
        <div className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-slate-800 shadow-xl">
          <PurchaseInvoiceView 
            onNavigate={onNavigate} 
            onOpenPayments={() => setViewMode('payments')}
          />
        </div>
      )}

      {viewMode === 'payments' && (
        <div className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-slate-800 shadow-xl">
          <SupplierPaymentsView 
            onNavigate={onNavigate} 
            onOpenNewInvoice={() => setViewMode('invoice')}
          />
        </div>
      )}

      {viewMode === 'single' && (
        <>
          {/* 1. Header Banner & Stats */}
          <div className="bg-white border border-blue-100 rounded-2xl p-3 shadow-sm flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight text-slate-900 flex items-center gap-2">
              <span>Hızlı Stok Güncelleme & Mal Kabul</span>
              <span className="text-[10px] bg-blue-50 text-blue-700 font-mono px-2 py-0.5 rounded-full border border-blue-200">
                {products.length} Kayıtlı Ürün
              </span>
            </h1>
            <p className="text-xs text-slate-500">İrsaliye girişi yapın, raf sayımını güncelleyin ve alış/satış fiyatlarını revize edin.</p>
          </div>
        </div>

        {/* Action badges & Session Stats */}
        <div className="flex items-center gap-2">
          {sessionLog.length > 0 && (
            <button
              onClick={() => setShowLogModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition active:scale-95"
            >
              <History className="w-3.5 h-3.5" />
              <span>Oturum Girişleri ({sessionLog.length})</span>
              {sessionTotalCost > 0 && (
                <span className="bg-emerald-600 text-white px-1.5 py-0.2 text-[10px] rounded-md font-mono">
                  ₺{sessionTotalCost.toFixed(2)}
                </span>
              )}
            </button>
          )}

          <div className="hidden sm:flex items-center gap-1.5">
            <div className="px-2 py-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              <span>{criticalProducts.length} Kritik</span>
            </div>
            <div className="px-2 py-1 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-1">
              <span>{outOfStockProducts.length} Tükenen</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Success Notification Toast */}
      {updateSuccessToast && (
        <div className="bg-emerald-600 text-white px-4 py-2.5 rounded-2xl shadow-lg flex items-center justify-between text-xs font-bold animate-in fade-in slide-in-from-top-2 shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-200" />
            <span>
              "{updateSuccessToast.name}" stoğu başarıyla güncellendi! ({updateSuccessToast.mode === 'add' ? `+${updateSuccessToast.delta}` : 'Sayım'} → Yeni Stok: {updateSuccessToast.newStock})
            </span>
          </div>
          <span className="text-[10px] font-mono bg-emerald-700 px-2 py-0.5 rounded-md">Canlı Eşitlendi ⚡</span>
        </div>
      )}

      {/* 3. Main Operational Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">
        
        {/* Left Column: Quick Scanner & Product Editor (7 Cols on LG) */}
        <div className="lg:col-span-7 flex flex-col bg-white border border-blue-100 rounded-2xl shadow-sm p-3.5 overflow-y-auto space-y-3">
          
          {/* Mode Selector Tabs */}
          <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => { setMode('add'); if (selectedProduct) setStockQuantity(1); }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
                mode === 'add'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <PackagePlus className="w-4 h-4" />
              <span>Stok Ekleme (İrsaliye / Mal Kabul)</span>
            </button>
            <button
              type="button"
              onClick={() => { setMode('count'); if (selectedProduct) setStockQuantity(selectedProduct.stock || 0); }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
                mode === 'count'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Raf Sayımı (Net Stok Düzeltme)</span>
            </button>
          </div>

          {/* Barcode Scanner & Search Input Field */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
              <span>Barkod Okutun veya Ürün Arayın</span>
              <span className="text-blue-600 text-[10px] font-mono">USB / Bluetooth / Kamera Uyumlu</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <form onSubmit={handleBarcodeSubmit}>
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Barkod okutun veya ürün adı yazın..."
                    className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl pl-9 pr-8 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none transition shadow-inner"
                  />
                </form>
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => setSearchInput('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowCameraScanner(true)}
                className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shrink-0"
                title="Kamera ile Barkod Okut"
              >
                <Scan className="w-4 h-4" />
                <span className="hidden sm:inline">Kamera</span>
              </button>
            </div>

            {/* Live Search Suggestions Dropdown */}
            {searchResults.length > 0 && searchInput.trim() && (
              <div className="bg-white border border-blue-100 rounded-xl shadow-lg p-1 space-y-1 max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 z-20">
                {searchResults.map(p => (
                  <div
                    key={p.id}
                    onClick={() => { handleSelectProduct(p); setSearchInput(''); }}
                    className="p-2 rounded-lg hover:bg-blue-50 cursor-pointer flex items-center justify-between text-xs transition"
                  >
                    <div>
                      <span className="font-bold text-slate-800">{p.name}</span>
                      <span className="text-[10px] text-slate-400 ml-2 font-mono">[{p.barcode}]</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${p.stock <= 10 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        Stok: {p.stock}
                      </span>
                      <span className="text-xs font-bold text-emerald-600 font-mono">₺{p.price.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Product Details Card & Quantity Input */}
          {selectedProduct ? (
            <div className="bg-gradient-to-br from-blue-50/70 to-slate-50 border border-blue-200/80 rounded-2xl p-4 space-y-3.5 animate-in fade-in">
              
              {/* Product Header */}
              <div className="flex items-start justify-between border-b border-blue-100 pb-3">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600 bg-blue-100/80 px-2 py-0.5 rounded-md">
                    {selectedProduct.category || 'Genel'}
                  </span>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 mt-1">{selectedProduct.name}</h3>
                  <p className="text-xs text-slate-500 font-mono">Barkod: {selectedProduct.barcode}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Current Stock vs New Stock Display */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Mevcut Stok</span>
                  <div className="text-xl sm:text-2xl font-black text-slate-800 font-mono mt-0.5 flex items-baseline gap-1">
                    <span>{selectedProduct.stock}</span>
                    <span className="text-xs font-normal text-slate-500">{selectedProduct.unit || 'Adet'}</span>
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-bold text-emerald-700">
                    {mode === 'add' ? 'İşlem Sonrası Stok' : 'Yeni Sayım Stoğu'}
                  </span>
                  <div className="text-xl sm:text-2xl font-black text-emerald-700 font-mono mt-0.5 flex items-baseline gap-1">
                    <span>
                      {mode === 'add' 
                        ? (Number(selectedProduct.stock || 0) + (Number(stockQuantity) || 0)) 
                        : (Number(stockQuantity) || 0)}
                    </span>
                    <span className="text-xs font-normal text-emerald-600">{selectedProduct.unit || 'Adet'}</span>
                  </div>
                </div>
              </div>

              {/* Quantity Input with Increment/Decrement */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>{mode === 'add' ? 'Eklenecek Miktar (+)' : 'Rafta Sayılan Net Miktar'}</span>
                  {mode === 'add' && stockQuantity > 1 && (
                    <span className="text-xs text-blue-600 font-mono font-bold">+{stockQuantity} {selectedProduct.unit || 'Adet'}</span>
                  )}
                </label>
                
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStockQuantity(prev => Math.max(mode === 'add' ? 1 : 0, (Number(prev) || 0) - 1))}
                    className="w-11 h-11 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700 text-lg font-black transition active:scale-95 shadow-sm"
                  >
                    <Minus className="w-5 h-5" />
                  </button>

                  <input
                    type="number"
                    min={mode === 'add' ? '1' : '0'}
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                    className="flex-1 h-11 bg-white border border-blue-300 rounded-xl text-center text-xl font-black font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                  />

                  <button
                    type="button"
                    onClick={() => setStockQuantity(prev => (Number(prev) || 0) + 1)}
                    className="w-11 h-11 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-700 text-lg font-black transition active:scale-95 shadow-sm"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                {/* Quick Increment Presets */}
                <div className="grid grid-cols-6 gap-1.5 pt-1">
                  {[1, 5, 6, 12, 24, 48].map((qty) => (
                    <button
                      key={qty}
                      type="button"
                      onClick={() => handleQuantityPreset(qty)}
                      className="py-1.5 bg-white hover:bg-blue-50 hover:border-blue-300 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 transition active:scale-95 font-mono shadow-xs"
                    >
                      +{qty}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Revision (Alış & Satış Fiyatı Güncelleme) */}
              <div className="bg-white/90 border border-blue-100 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-blue-600" />
                    <span>Fiyat Revizyonu (Yeni İrsaliye / Raf Fiyatı)</span>
                  </span>
                  {editBuyPrice && editSalePrice && Number(editSalePrice) > Number(editBuyPrice) && (
                    <span className="text-[10px] font-bold text-emerald-600 font-mono">
                      Kâr: %{(((Number(editSalePrice) - Number(editBuyPrice)) / Number(editBuyPrice)) * 100).toFixed(0)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Alış Fiyatı (₺)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editBuyPrice}
                      onChange={(e) => setEditBuyPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold font-mono text-slate-800 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Satış Fiyatı (₺)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editSalePrice}
                      onChange={(e) => setEditSalePrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold font-mono text-slate-800 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Confirm & Save Button */}
              <button
                type="button"
                onClick={handleSaveStockUpdate}
                className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white py-3 rounded-xl text-sm font-black transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 active:scale-98"
              >
                <Check className="w-5 h-5" />
                <span>Stoğu Onayla & Kaydet (Enter)</span>
              </button>
            </div>
          ) : (
            <div className="flex-1 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center p-6 text-center text-slate-400 space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Scan className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">İşlem yapmak için bir ürün seçin veya okutun</p>
                <p className="text-xs text-slate-400 max-w-xs mt-1">
                  Barkod tabancasını okutabilir, kamera tarayıcısını açabilir ya da yandaki kritik stok listesinden tıklayabilirsiniz.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Quick Selection Catalog & Critical Stock List (5 Cols on LG) */}
        <div className="lg:col-span-5 flex flex-col bg-white border border-blue-100 rounded-2xl shadow-sm p-3.5 overflow-hidden">
          
          {/* Header & Filter Tabs */}
          <div className="space-y-2 border-b border-slate-100 pb-3 shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span>Stok Listesi & Hızlı Seçim</span>
              </h2>
              <span className="text-[10px] font-mono text-slate-400">{catalogList.length} Ürün Listelendi</span>
            </div>

            {/* Quick Stock Filters */}
            <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setProductFilter('critical')}
                className={`py-1.5 px-1 rounded-lg text-center transition ${
                  productFilter === 'critical' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Kritik (≤10)
              </button>
              <button
                type="button"
                onClick={() => setProductFilter('out')}
                className={`py-1.5 px-1 rounded-lg text-center transition ${
                  productFilter === 'out' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Tükenen (0)
              </button>
              <button
                type="button"
                onClick={() => setProductFilter('all')}
                className={`py-1.5 px-1 rounded-lg text-center transition ${
                  productFilter === 'all' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Tüm Liste
              </button>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar text-[11px]">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-lg whitespace-nowrap font-medium transition ${
                    categoryFilter === cat
                      ? 'bg-blue-600 text-white font-bold'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {cat === 'ALL' ? 'Tümü' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Product Items List */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pt-2 pr-1">
            {catalogList.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <Boxes className="w-10 h-10 mx-auto text-slate-300 mb-2 stroke-1" />
                <p className="text-xs font-semibold">Bu filtrede ürün bulunmuyor.</p>
              </div>
            ) : (
              catalogList.map((p) => {
                const isSelected = selectedProduct?.id === p.id;
                const isCritical = p.stock <= 10 && p.stock > 0;
                const isOut = p.stock <= 0;

                return (
                  <div
                    key={p.id}
                    onClick={() => handleSelectProduct(p)}
                    className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between group active:scale-98 ${
                      isSelected
                        ? 'bg-blue-50 border-blue-500 shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200/80'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 truncate">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                        <span>{p.barcode}</span>
                        <span>•</span>
                        <span>Alış: ₺{(p.buyPrice || 0).toFixed(2)}</span>
                        <span>•</span>
                        <span>Satış: ₺{p.price.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-black font-mono px-2 py-0.5 rounded-md border ${
                        isOut ? 'bg-rose-100 text-rose-700 border-rose-200' :
                        isCritical ? 'bg-amber-100 text-amber-800 border-amber-200' :
                        'bg-white text-slate-700 border-slate-200'
                      }`}>
                        {p.stock} {p.unit || 'Adet'}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 transition" />
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>

      </div>

      {/* 4. Session Log Modal (Oturum İrsaliye & Sayım Özeti) */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-white border border-slate-200 w-full max-w-2xl rounded-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Bu Oturumdaki Stok Girişleri</h3>
                  <p className="text-xs text-slate-500">
                    Toplam {sessionLog.length} işlem | {sessionTotalAdded} adet eklendi | Toplam Maliyet: ₺{sessionTotalCost.toFixed(2)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowLogModal(false)}
                className="p-1.5 rounded-full bg-slate-100 text-slate-500 hover:text-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {sessionLog.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  Henüz bu oturumda kaydedilmiş bir stok girişi yok.
                </div>
              ) : (
                sessionLog.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{entry.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">[{entry.barcode}]</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                        <span>Zaman: {entry.time}</span>
                        <span>•</span>
                        <span>Önceki: {entry.previousStock}</span>
                        <span>•</span>
                        <span className="font-bold text-emerald-600">Yeni: {entry.newStock} {entry.unit}</span>
                        {entry.totalCost > 0 && (
                          <>
                            <span>•</span>
                            <span className="font-mono text-slate-700">Maliyet: ₺{entry.totalCost.toFixed(2)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-black font-mono px-2.5 py-1 rounded-lg ${
                        entry.delta > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                      }`}>
                        {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUndoLogEntry(entry)}
                        className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition"
                        title="Bu Girişi Geri Al"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer with CSV Export */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={handleExportSessionCSV}
                disabled={sessionLog.length === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50 transition active:scale-95"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>İrsaliye Listesini Excel/CSV Olarak İndir</span>
              </button>

              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-300 transition"
              >
                Kapat
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 5. Mobile Camera Barcode Scanner Modal */}
      {showCameraScanner && (
        <BarcodeScanner
          onScan={handleCameraScan}
          onClose={() => setShowCameraScanner(false)}
          continuous={false}
        />
      )}
        </>
      )}

    </div>
  );
}
