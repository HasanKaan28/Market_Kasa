import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Scan, Search, Plus, Minus, Trash2, PauseCircle, 
  RotateCcw, Sparkles, Percent, Tag, AlertCircle, ShoppingBag, X, Globe, Loader2,
  Banknote, CreditCard, Keyboard, Monitor, Layers, CheckCircle2, ChevronRight,
  Receipt, Printer, Clock
} from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { playBarcodeBeep, playErrorBeep, playCashRegisterSound } from '../utils/sound';
import BarcodeScanner from './BarcodeScanner';
import PaymentModal from './PaymentModal';
import ReceiptModal from './ReceiptModal';
import SuspendedSales from './SuspendedSales';
import { useAuth } from '../context/AuthContext';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';
import { lookupBarcodeInCatalogOrOnline } from '../data/barcodeCatalog';

export default function PosScreen({ cart, setCart, onCartChange }) {
  const { currentUser, hasPermission } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [showScanner, setShowScanner] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showSuspended, setShowSuspended] = useState(false);
  const [completedSale, setCompletedSale] = useState(null);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [showDiscountModal, setShowDiscountModal] = useState(false);

  // Top Toast Notification for Completed Sales
  const [saleSuccessToast, setSaleSuccessToast] = useState(null);

  // Recent Transactions & Fişler Modal
  const [showRecentSales, setShowRecentSales] = useState(false);
  const [recentSearch, setRecentSearch] = useState('');
  const recentSales = useLiveQuery(() => db.sales.reverse().limit(50).toArray(), []) || [];

  const filteredRecentSales = useMemo(() => {
    if (!recentSales) return [];
    if (!recentSearch.trim()) return recentSales;
    const q = recentSearch.toLowerCase();
    return recentSales.filter(s => 
      s.receiptNo?.toLowerCase().includes(q) ||
      s.customerName?.toLowerCase().includes(q) ||
      s.sellerName?.toLowerCase().includes(q) ||
      s.grandTotal?.toString().includes(q)
    );
  }, [recentSales, recentSearch]);

  // Scan Mode: 'reader' (Barkod Okuyucu / Sayı Girişi) vs 'camera' (Kamera)
  const [scanMode, setScanMode] = useState(() => {
    return localStorage.getItem('pos_scan_mode') || 'reader';
  });
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showNumpad, setShowNumpad] = useState(true);

  const searchInputRef = useRef(null);
  const barcodeInputRef = useRef(null);

  // Quick Add Product state for unknown barcodes
  const [quickAddModal, setQuickAddModal] = useState({ isOpen: false, barcode: '', productId: null, isCatalogMatch: false, title: '' });
  const [quickName, setQuickName] = useState('');
  const [quickBuyPrice, setQuickBuyPrice] = useState('');
  const [quickPrice, setQuickPrice] = useState('');
  const [quickCategory, setQuickCategory] = useState('Genel');
  const [quickTaxRate, setQuickTaxRate] = useState(1);

  // Products from Dexie (Yalnızca kullanıcının kendi eklediği veya fiyatlandırdığı aktif ürünler)
  const allDbProducts = useLiveQuery(() => db.products.toArray(), []);
  const products = useMemo(() => (allDbProducts || []).filter(p => !p.needsPricing && p.price > 0), [allDbProducts]);
  const suspendedCount = useLiveQuery(() => db.suspendedSales.count(), []);
  const storeSettings = useLiveQuery(async () => {
    const list = await db.settings.toArray();
    return list.reduce((acc, cur) => ({ ...acc, [cur.key]: cur.value }), {});
  }, []);

  // Quick products
  const quickProducts = products?.filter(p => p.isQuick) || [];

  // Unique categories for desktop filter
  const categories = useMemo(() => {
    if (!products || products.length === 0) return ['ALL'];
    const cats = new Set(products.map(p => p.category || 'Genel'));
    return ['ALL', ...Array.from(cats)];
  }, [products]);

  // Filtered products for search dropdown / desktop grid
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    if (!searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(term) || p.barcode.includes(term) || p.category?.toLowerCase().includes(term));
  }, [products, searchTerm]);

  // Display products for Desktop Grid (Search or Category)
  const desktopDisplayProducts = useMemo(() => {
    if (!products) return [];
    if (searchTerm.trim()) {
      return filteredProducts;
    }
    if (selectedCategory === 'ALL') {
      return products;
    }
    return products.filter(p => (p.category || 'Genel') === selectedCategory);
  }, [products, searchTerm, selectedCategory, filteredProducts]);

  // Numpad Touch Input Handlers (Mobile Phone Manual Entry)
  const handleNumpadPress = (val) => {
    if (val === 'clear') {
      setBarcodeInput('');
    } else if (val === 'backspace') {
      setBarcodeInput(prev => prev.slice(0, -1));
    } else {
      setBarcodeInput(prev => (prev + val).slice(0, 24));
    }
  };

  const handleBarcodeSubmit = (e) => {
    if (e) e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;
    setBarcodeInput('');
    handleBarcodeScanned(code);
  };

  // Add product to cart by barcode or object
  const addToCart = (product, quantity = 1) => {
    if (!product) return;
    playBarcodeBeep();

    setCart(prevCart => {
      const existingIndex = prevCart.findIndex(item => item.id === product.id);
      if (existingIndex > -1) {
        const updated = [...prevCart];
        const newQty = updated[existingIndex].quantity + quantity;
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: newQty,
          total: newQty * updated[existingIndex].price
        };
        return updated;
      } else {
        return [
          {
            id: product.id,
            barcode: product.barcode,
            name: product.name,
            price: product.price,
            buyPrice: product.buyPrice || 0,
            taxRate: product.taxRate || 1,
            unit: product.unit || 'Adet',
            quantity: quantity,
            total: product.price * quantity
          },
          ...prevCart
        ];
      }
    });
  };

  // Handle barcode scanned from camera, bluetooth or USB barcode gun
  const handleBarcodeScanned = async (barcode) => {
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return;

    // 1. Önce yerel veritabanında ara
    const found = await db.products.where('barcode').equals(cleanBarcode).first();
    if (found) {
      if (found.needsPricing || !found.price || found.price <= 0) {
        playBarcodeBeep();
        setQuickName(found.name || '');
        setQuickBuyPrice(found.buyPrice > 0 ? found.buyPrice.toString() : '');
        setQuickPrice(found.price > 0 ? found.price.toString() : '');
        setQuickCategory(found.category || 'Genel');
        setQuickTaxRate(found.taxRate || 10);
        setQuickAddModal({
          isOpen: true,
          barcode: cleanBarcode,
          productId: found.id,
          isCatalogMatch: true,
          title: 'Hazır Barkod: Fiyat Belirleyin'
        });
        return;
      }

      // Ürün kayıtlı ve fiyatlı -> Doğrudan sepete ekle
      addToCart(found, 1);
      return;
    }

    // 2. Yerel veritabanında yoksa: İnternet / Hazır katalog kütüphanesinde ara
    try {
      const catalogResult = await lookupBarcodeInCatalogOrOnline(cleanBarcode);
      if (catalogResult) {
        playBarcodeBeep();
        // SADECE İSMİNİ VE KATEGORİSİNİ AL; FİYATLAR BOŞ GELSİN KULLANICI GİRSİN
        setQuickName(catalogResult.name);
        setQuickBuyPrice('');
        setQuickPrice('');
        setQuickCategory(catalogResult.category || 'Genel');
        setQuickTaxRate(catalogResult.taxRate || 1);
        setQuickAddModal({
          isOpen: true,
          barcode: cleanBarcode,
          productId: null,
          isCatalogMatch: true,
          title: 'Barkod Kütüphanede Bulundu: Fiyat Belirleyin'
        });
        return;
      }
    } catch (err) {
      console.warn('Barkod sorgusu hatası:', err);
    }

    // 3. Hiçbir yerde bulunamadıysa yeni ürün modalı
    playErrorBeep();
    setQuickName('');
    setQuickBuyPrice('');
    setQuickPrice('');
    setQuickCategory('Genel');
    setQuickTaxRate(1);
    setQuickAddModal({
      isOpen: true,
      barcode: cleanBarcode,
      productId: null,
      isCatalogMatch: false,
      title: 'Yeni Ürün Kaydet'
    });
  };

  const handleQuickAddSubmit = async (e) => {
    e.preventDefault();
    if (!quickName.trim() || !quickPrice) {
      alert('Lütfen ürün adını ve satış fiyatını girin.');
      return;
    }

    const buyP = parseFloat(quickBuyPrice) || 0;
    const sellP = parseFloat(quickPrice) || 0;
    let savedProduct;

    if (quickAddModal.productId) {
      await db.products.update(quickAddModal.productId, {
        name: quickName.trim(),
        category: quickCategory.trim() || 'Genel',
        buyPrice: buyP,
        price: sellP,
        taxRate: parseInt(quickTaxRate) || 1,
        needsPricing: false,
        updatedAt: new Date().toISOString()
      });
      savedProduct = await db.products.get(quickAddModal.productId);
    } else {
      const newId = await db.products.add({
        barcode: quickAddModal.barcode,
        name: quickName.trim(),
        category: quickCategory.trim() || 'Genel',
        price: sellP,
        buyPrice: buyP,
        taxRate: parseInt(quickTaxRate) || 1,
        stock: 50,
        unit: 'Adet',
        needsPricing: false,
        isQuick: false,
        color: '#10b981',
        updatedAt: new Date().toISOString()
      });
      savedProduct = await db.products.get(newId);
    }

    sync.broadcast('PRODUCT_SAVED', { product: savedProduct });
    googleDriveSync.triggerOnSaleSync();

    setQuickAddModal({ isOpen: false, barcode: '', productId: null, isCatalogMatch: false, title: '' });
    addToCart(savedProduct, 1);
  };

  // Handle Search Input submit (e.g. Enter pressed by barcode gun)
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;

    const matched = products?.find(p => p.barcode === searchTerm.trim());
    if (matched) {
      if (matched.needsPricing || !matched.price || matched.price <= 0) {
        handleBarcodeScanned(matched.barcode);
      } else {
        addToCart(matched, 1);
      }
      setSearchTerm('');
    } else if (filteredProducts.length === 1) {
      if (filteredProducts[0].needsPricing || !filteredProducts[0].price || filteredProducts[0].price <= 0) {
        handleBarcodeScanned(filteredProducts[0].barcode);
      } else {
        addToCart(filteredProducts[0], 1);
      }
      setSearchTerm('');
    } else {
      handleBarcodeScanned(searchTerm);
      setSearchTerm('');
    }
  };

  const updateQuantity = (id, delta) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const nextQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: nextQty, total: nextQty * item.price };
      }
      return item;
    }));
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const clearCart = () => {
    if (cart.length === 0) return;
    if (confirm('Sepetteki tüm ürünleri temizlemek istiyor musunuz?')) {
      setCart([]);
      setDiscountPercent(0);
    }
  };

  // Park / Suspend current cart
  const handleSuspendCart = async () => {
    if (cart.length === 0) return;
    const note = prompt('Sepet için bir not veya müşteri adı (opsiyonel):', '');
    await db.suspendedSales.add({
      note: note || `${cart.length} çeşit ürün`,
      items: cart,
      createdAt: new Date().toISOString()
    });
    setCart([]);
    setDiscountPercent(0);
  };

  // Calculations
  const subtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const discountAmount = (subtotal * discountPercent) / 100;
  const grandTotal = Math.max(0, subtotal - discountAmount);

  const taxTotal = cart.reduce((sum, item) => {
    const rate = item.taxRate || 1;
    const itemSubtotal = item.total * (1 - discountPercent / 100);
    return sum + (itemSubtotal - (itemSubtotal / (1 + rate / 100)));
  }, 0);

  // Finalize Sale handler
  const handleSaleCompleted = async (paymentDetails) => {
    const now = new Date();
    const receiptNo = `F-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const totalCost = cart.reduce((sum, item) => sum + (item.buyPrice * item.quantity), 0);
    const profit = grandTotal - totalCost;

    const saleRecord = {
      receiptNo,
      date: now.toISOString(),
      items: [...cart],
      subtotal,
      discount: discountAmount,
      taxTotal,
      grandTotal,
      profit,
      paymentMethod: paymentDetails.paymentMethod,
      cashGiven: paymentDetails.cashGiven,
      changeGiven: paymentDetails.changeGiven,
      customerId: paymentDetails.customerId,
      customerName: paymentDetails.customerName,
      sellerId: currentUser?.id || 'user_kasiyer',
      sellerName: currentUser?.name || 'Kasiyer',
      status: 'completed'
    };

    await db.sales.add(saleRecord);

    for (const item of cart) {
      const prod = await db.products.get(item.id);
      if (prod) {
        await db.products.update(item.id, {
          stock: Math.max(0, prod.stock - item.quantity)
        });
      }
    }

    if (paymentDetails.paymentMethod === 'debt' && paymentDetails.customerId) {
      const cust = await db.customers.get(paymentDetails.customerId);
      if (cust) {
        const newBalance = (cust.balance || 0) + grandTotal;
        await db.customers.update(cust.id, { balance: newBalance });
        await db.customerTransactions.add({
          customerId: cust.id,
          type: 'debt',
          amount: grandTotal,
          date: now.toISOString(),
          note: `Satış Fişi #${receiptNo}`,
          receiptNo
        });
      }
    }

    sync.broadcast('SALE_COMPLETED', {
      sale: saleRecord,
      items: cart,
      customerId: paymentDetails.customerId,
      grandTotal: grandTotal
    });

    googleDriveSync.triggerOnSaleSync();

    setCart([]);
    setDiscountPercent(0);
    setShowPayment(false);

    // Fişi ekranda zorla açmak yerine arka planda kaydet ve yukarıdan bildirim göster
    playCashRegisterSound();

    if (window._saleToastTimer) clearTimeout(window._saleToastTimer);
    setSaleSuccessToast({
      sale: saleRecord,
      amount: grandTotal,
      method: paymentDetails.paymentMethod,
      customerName: paymentDetails.customerName,
      receiptNo,
      time: now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    });
    window._saleToastTimer = setTimeout(() => {
      setSaleSuccessToast(null);
    }, 4500);
  };

  // Instant 1-Click Fast Checkout
  const handleFastCashSale = () => {
    if (cart.length === 0) return;
    handleSaleCompleted({
      paymentMethod: 'cash',
      cashGiven: grandTotal,
      changeGiven: 0,
      customerId: null,
      customerName: null
    });
  };

  const handleFastCardSale = () => {
    if (cart.length === 0) return;
    handleSaleCompleted({
      paymentMethod: 'card',
      cashGiven: grandTotal,
      changeGiven: 0,
      customerId: null,
      customerName: null
    });
  };

  // Global USB Barcode Scanner Listener & Windows Keyboard Hotkeys
  useEffect(() => {
    let barcodeBuffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e) => {
      // If modal is open, let Escape close it
      if (showPayment || showScanner || showSuspended || quickAddModal.isOpen || showDiscountModal || completedSale) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowPayment(false);
          setShowScanner(false);
          setShowSuspended(false);
          setShowDiscountModal(false);
          setQuickAddModal({ isOpen: false, barcode: '', productId: null, isCatalogMatch: false, title: '' });
          setCompletedSale(null);
        }
        return;
      }

      // Keyboard Shortcuts
      if (e.key === 'F1') {
        e.preventDefault();
        if (scanMode === 'reader') {
          barcodeInputRef.current?.focus();
          barcodeInputRef.current?.select();
        } else {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        if (cart.length > 0) {
          handleFastCashSale();
        }
        return;
      }

      if (e.key === 'F4') {
        e.preventDefault();
        if (cart.length > 0) {
          handleFastCardSale();
        }
        return;
      }

      if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0) {
          handleSuspendCart();
        }
        return;
      }

      if (e.key === 'F9') {
        e.preventDefault();
        setShowRecentSales(prev => !prev);
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (showRecentSales) {
          setShowRecentSales(false);
        } else if (completedSale) {
          setCompletedSale(null);
        } else if (cart.length > 0) {
          clearCart();
        } else if (barcodeInput) {
          setBarcodeInput('');
        } else if (searchTerm) {
          setSearchTerm('');
        }
        return;
      }

      // USB Barcode Wedge Scanner Accumulator
      const activeEl = document.activeElement;
      const isOtherInputFocused = (activeEl?.tagName === 'INPUT' && activeEl !== searchInputRef.current && activeEl !== barcodeInputRef.current) || activeEl?.tagName === 'TEXTAREA';
      if (isOtherInputFocused) return;

      const currentTime = Date.now();
      const diff = currentTime - lastKeyTime;
      lastKeyTime = currentTime;

      if (e.key === 'Enter') {
        if (barcodeBuffer.length >= 3) {
          e.preventDefault();
          const scannedCode = barcodeBuffer.trim();
          barcodeBuffer = '';
          if (searchInputRef.current) searchInputRef.current.value = '';
          if (barcodeInputRef.current) barcodeInputRef.current.value = '';
          setSearchTerm('');
          setBarcodeInput('');
          handleBarcodeScanned(scannedCode);
        }
        return;
      }

      // Printable single characters
      if (e.key.length === 1) {
        if (diff > 120 && activeEl !== searchInputRef.current && activeEl !== barcodeInputRef.current) {
          barcodeBuffer = e.key;
        } else {
          barcodeBuffer += e.key;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, grandTotal, showPayment, showScanner, showSuspended, quickAddModal, showDiscountModal, completedSale, searchTerm, barcodeInput, scanMode]);

  return (
    <div className="h-full flex flex-col lg:flex-row gap-0 lg:gap-3 w-full max-w-lg lg:max-w-7xl mx-auto overflow-hidden relative">
      
      {/* ================= LEFT PANE: SEARCH, CATALOG & QUICK ITEMS ================= */}
      <div className="flex-1 min-h-0 flex flex-col bg-zinc-950/55 lg:bg-zinc-900/45 lg:border lg:border-zinc-700/70 lg:rounded-2xl overflow-hidden shadow-xl shadow-black/10">
        
        {/* Modern Minimalist Header / Mode Switcher */}
        <div className="shrink-0 p-2 sm:p-2.5 bg-zinc-900/90 backdrop-blur border-b border-zinc-800/80 space-y-2">
          
          {/* Mode Switcher Segmented Control (Barkod Okuyucu vs Kamera) */}
          <div className="flex items-center p-0.5 bg-zinc-950 border border-zinc-800 rounded-xl gap-1">
            <button
              type="button"
              onClick={() => {
                setScanMode('reader');
                localStorage.setItem('pos_scan_mode', 'reader');
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-lg text-xs font-bold transition-all ${
                scanMode === 'reader'
                  ? 'bg-emerald-400 text-zinc-950 shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>Barkod Okuyucu (Sayı)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setScanMode('camera');
                localStorage.setItem('pos_scan_mode', 'camera');
                setShowScanner(true);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-lg text-xs font-bold transition-all ${
                scanMode === 'camera'
                  ? 'bg-emerald-400 text-zinc-950 shadow-xs'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Scan className="w-3.5 h-3.5" />
              <span>Kamera Barkod</span>
            </button>

            {/* Suspended Carts Trigger */}
            <button
              onClick={() => setShowSuspended(true)}
              className={`relative p-1.5 rounded-lg border transition active:scale-95 shrink-0 ${
                suspendedCount > 0
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-zinc-850 text-zinc-400 border-zinc-750 hover:text-zinc-200'
              }`}
              title="Bekleyen Sepetler [F8]"
            >
              <PauseCircle className="w-4 h-4" />
              {suspendedCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-amber-500 text-zinc-950 text-[10px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center shadow">
                  {suspendedCount}
                </span>
              )}
            </button>

            {/* Recent Sales & Receipts Trigger */}
            <button
              type="button"
              onClick={() => setShowRecentSales(true)}
              className="relative p-1.5 rounded-lg border bg-zinc-850 hover:bg-zinc-800 text-zinc-300 hover:text-white border-zinc-750 transition active:scale-95 shrink-0 flex items-center gap-1"
              title="Son Yapılan İşlemler ve Fişler [F9]"
            >
              <Receipt className="w-4 h-4 text-emerald-400" />
              <span className="text-[11px] font-bold hidden sm:inline">Fişler [F9]</span>
            </button>
          </div>

          {/* ================= MODE 1: BARKOD OKUYUCU (SAYI GİRİŞİ / NUMPAD) ================= */}
          {scanMode === 'reader' ? (
            <div className="space-y-1.5">
              {/* Barcode Number Input Form */}
              <form onSubmit={handleBarcodeSubmit} className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Barkod sayısını okutun / yazın..."
                    className="w-full bg-zinc-950 border border-emerald-500/50 focus:border-emerald-400 rounded-xl pl-8 pr-8 py-2 text-xs text-emerald-300 font-mono font-bold tracking-wider placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 shadow-inner"
                  />
                  <Keyboard className="w-3.5 h-3.5 text-emerald-400 absolute left-2.5 top-2.5" />
                  {barcodeInput && (
                    <button
                      type="button"
                      onClick={() => setBarcodeInput('')}
                      className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!barcodeInput.trim()}
                  className="bg-emerald-400 hover:bg-emerald-300 disabled:opacity-30 text-zinc-950 font-black px-3 py-2 rounded-xl text-xs flex items-center gap-1 transition shadow-xs shrink-0"
                >
                  <span>Ekle</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </form>

              {/* Touch Numpad for Mobile Phones (Telefon versiyonunda elle sayılar girilebilmesi için) */}
              <div className="lg:hidden bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-1.5 space-y-1 shadow-xs">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Dokunmatik Tuş Takımı
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowNumpad(!showNumpad)}
                    className="text-[10px] text-zinc-400 hover:text-white font-mono flex items-center gap-0.5"
                  >
                    {showNumpad ? '▲ Gizle' : '▼ Göster'}
                  </button>
                </div>

                {showNumpad && (
                  <div className="grid grid-cols-4 gap-1 pt-0.5">
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => handleNumpadPress(n.toString())}
                        className="py-2 bg-zinc-850 hover:bg-zinc-800 active:bg-emerald-400 active:text-zinc-950 text-white font-black text-sm rounded-lg transition"
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleNumpadPress('backspace')}
                      className="py-2 bg-zinc-800 hover:bg-zinc-750 text-rose-400 active:scale-95 font-bold text-xs rounded-lg transition flex items-center justify-center"
                      title="Geri Al"
                    >
                      ⌫
                    </button>

                    {[4, 5, 6].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => handleNumpadPress(n.toString())}
                        className="py-2 bg-zinc-850 hover:bg-zinc-800 active:bg-emerald-400 active:text-zinc-950 text-white font-black text-sm rounded-lg transition"
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleNumpadPress('clear')}
                      className="py-2 bg-zinc-800 hover:bg-zinc-750 text-amber-400 active:scale-95 font-bold text-xs rounded-lg transition flex items-center justify-center"
                      title="Temizle"
                    >
                      C
                    </button>

                    {[7, 8, 9].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => handleNumpadPress(n.toString())}
                        className="py-2 bg-zinc-850 hover:bg-zinc-800 active:bg-emerald-400 active:text-zinc-950 text-white font-black text-sm rounded-lg transition"
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleNumpadPress('00')}
                      className="py-2 bg-zinc-850 hover:bg-zinc-800 active:bg-emerald-400 active:text-zinc-950 text-white font-bold text-xs rounded-lg transition"
                    >
                      00
                    </button>

                    <button
                      type="button"
                      onClick={() => handleNumpadPress('0')}
                      className="py-2 bg-zinc-850 hover:bg-zinc-800 active:bg-emerald-400 active:text-zinc-950 text-white font-black text-sm rounded-lg transition"
                    >
                      0
                    </button>

                    <button
                      type="button"
                      onClick={handleBarcodeSubmit}
                      disabled={!barcodeInput.trim()}
                      className="col-span-3 py-2 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-35 text-zinc-950 font-black text-xs rounded-lg transition shadow-xs flex items-center justify-center gap-1 active:scale-98"
                    >
                      <span>↵ Sepete Ekle</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ================= MODE 2: KAMERA & İSİMLE ARAMA ================= */
            <div className="flex items-center gap-1.5">
              <form onSubmit={handleSearchSubmit} className="relative flex-1">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Ürün adı veya barkod arayın..."
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl pl-8 pr-10 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 transition shadow-inner"
                />
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="text-zinc-400 hover:text-white absolute right-2.5 top-2.5 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </form>

              <button
                onClick={() => setShowScanner(true)}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 active:scale-95 transition shadow-sm shrink-0"
              >
                <Scan className="w-4 h-4 animate-pulse" />
                <span>Kamera Aç</span>
              </button>
            </div>
          )}

          {/* Quick Search Overlay (If searching by name/barcode) */}
          {searchTerm.trim() && (
            <div className="lg:hidden bg-zinc-900 border border-zinc-700 rounded-xl max-h-44 overflow-y-auto divide-y divide-zinc-800 shadow-2xl z-30">
              {filteredProducts.length === 0 ? (
                <div className="p-2.5 text-center text-xs text-zinc-400">
                  Ürün bulunamadı. Enter'a basarak barkod olarak okutabilirsiniz.
                </div>
              ) : (
                filteredProducts.map((prod) => (
                  <div
                    key={prod.id}
                    onClick={() => { addToCart(prod, 1); setSearchTerm(''); }}
                    className="p-2 flex items-center justify-between hover:bg-zinc-800 cursor-pointer active:bg-zinc-700"
                  >
                    <div>
                      <p className="text-xs font-bold text-white">{prod.name}</p>
                      <p className="text-[10px] text-zinc-400 font-mono">{prod.barcode} • Stok: {prod.stock}</p>
                    </div>
                    <span className="text-xs font-black text-emerald-400 font-mono">₺{prod.price.toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Quick Items Chips (Horizontal Scroll) */}
          {quickProducts.length > 0 && !searchTerm.trim() && (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
              {quickProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p, 1)}
                  className="shrink-0 bg-zinc-850 hover:bg-zinc-800 border border-zinc-750/70 hover:border-zinc-600 rounded-lg px-2 py-1 text-left active:scale-95 transition flex items-center gap-1.5"
                >
                  <span className="text-xs font-medium text-zinc-200 truncate max-w-[100px]">{p.name}</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">₺{p.price.toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Desktop Category Filter Chips (lg:flex) */}
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-2 bg-zinc-950/60 border-b border-zinc-800 overflow-x-auto no-scrollbar shrink-0">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? 'bg-emerald-500 text-zinc-950 font-bold shadow-md shadow-emerald-500/20'
                  : 'bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {cat === 'ALL' ? 'Tüm Ürünler' : cat}
            </button>
          ))}
        </div>

        {/* Desktop Visual Product Grid (lg:block) */}
        <div className="hidden lg:block flex-1 min-h-0 overflow-y-auto p-3">
          {desktopDisplayProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 py-10">
              <ShoppingBag className="w-12 h-12 mb-2 opacity-30 stroke-1" />
              <p className="text-xs font-medium">Bu kategoride ürün bulunamadı.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {desktopDisplayProducts.map((prod) => (
                <div
                  key={prod.id}
                  onClick={() => addToCart(prod, 1)}
                  className="bg-zinc-900/90 hover:bg-zinc-850 border border-zinc-800/80 hover:border-emerald-500/50 rounded-xl p-2.5 cursor-pointer transition active:scale-98 shadow-sm flex flex-col justify-between group"
                >
                  <div>
                    <h4 className="text-xs font-bold text-white line-clamp-2 group-hover:text-emerald-300 transition">
                      {prod.name}
                    </h4>
                    <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                      {prod.barcode}
                    </p>
                  </div>
                  <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400 font-medium">Stok: {prod.stock}</span>
                    <span className="text-xs font-black text-emerald-400 font-mono">
                      ₺{prod.price.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ================= MOBILE CART LIST (SCROLLABLE MIDDLE, lg:hidden) ================= */}
        <div className="lg:hidden flex-1 min-h-0 overflow-y-auto p-2 sm:p-2.5 space-y-1.5 overscroll-contain">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
              <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 mb-2.5 shadow-inner">
                <ShoppingBag className="w-7 h-7 stroke-1 text-emerald-500/50" />
              </div>
              <p className="text-xs font-bold text-zinc-300">Sepetiniz Boş</p>
              <p className="text-[11px] text-zinc-500 mt-0.5 max-w-xs">
                Barkod okutun, üstteki tuş takımıyla girin veya arama yapın.
              </p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.id}
                className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-2 flex items-center justify-between gap-2 shadow-xs"
              >
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-semibold text-white truncate">{item.name}</h4>
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono mt-0.5">
                    <span className="text-emerald-400 font-bold">₺{item.price.toFixed(2)}</span>
                    <span>×</span>
                    <span>{item.quantity}</span>
                    <span className="text-zinc-600">|</span>
                    <span className="text-zinc-500">KDV %{item.taxRate}</span>
                  </div>
                </div>

                {/* Compact Stepper */}
                <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.id, -1)}
                    className="w-6 h-6 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-300 flex items-center justify-center active:scale-90"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-5 text-center text-xs font-bold text-white font-mono">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.id, 1)}
                    className="w-6 h-6 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-300 flex items-center justify-center active:scale-90"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {/* Total & Delete */}
                <div className="flex items-center gap-1">
                  <span className="text-xs font-black text-emerald-400 font-mono w-14 text-right">
                    ₺{item.total.toFixed(2)}
                  </span>
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="p-1 text-zinc-500 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ================= MOBILE STICKY BOTTOM CHECKOUT (PERMANENTLY PINNED, lg:hidden) ================= */}
        <div className="lg:hidden shrink-0 bg-zinc-900/98 backdrop-blur-md border-t border-zinc-800/90 p-2 sm:p-2.5 shadow-2xl z-20 space-y-1.5">
          {/* Summary Micro Bar */}
          <div className="flex items-center justify-between text-xs text-zinc-400 px-0.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-300">
                {cart.reduce((s, i) => s + i.quantity, 0)} Ürün
              </span>
              {discountPercent > 0 && (
                <span className="text-rose-400 font-bold bg-rose-500/15 px-1.5 py-0.2 rounded text-[10px]">
                  -%{discountPercent}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {hasPermission('canApplyDiscount') && (
                <button
                  onClick={() => setShowDiscountModal(true)}
                  disabled={cart.length === 0}
                  className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 disabled:opacity-30 border border-amber-500/20 px-2 py-0.5 rounded-lg"
                >
                  İndirim
                </button>
              )}
              <button
                onClick={handleSuspendCart}
                disabled={cart.length === 0}
                className="text-[11px] text-zinc-400 hover:text-white bg-zinc-800 disabled:opacity-30 border border-zinc-750 px-2 py-0.5 rounded-lg"
              >
                Beklet
              </button>
              <button
                onClick={clearCart}
                disabled={cart.length === 0}
                className="text-[11px] text-rose-400 hover:text-rose-300 bg-rose-500/10 disabled:opacity-30 border border-rose-500/20 px-2 py-0.5 rounded-lg"
              >
                İptal
              </button>
            </div>
          </div>

          {/* Square / Stripe Terminal Style Prominent Checkout Button */}
          {cart.length > 0 ? (
            <div className="space-y-1.5">
              <button
                onClick={() => setShowPayment(true)}
                className="w-full bg-emerald-400 hover:bg-emerald-300 active:scale-[0.98] text-zinc-950 font-black py-3 px-4 rounded-xl flex items-center justify-between shadow-lg shadow-emerald-500/20 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-zinc-950/15 flex items-center justify-center font-bold">
                    <CheckCircle2 className="w-4 h-4 text-zinc-950" />
                  </span>
                  <span className="text-xs sm:text-sm font-black tracking-tight">Kasayı Kapat / Ödeme</span>
                </div>
                <div className="text-lg sm:text-xl font-mono font-black tracking-tight">
                  ₺{grandTotal.toFixed(2)}
                </div>
              </button>

              {/* 1-Tap Quick Payment Shortcuts */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={handleFastCashSale}
                  className="bg-zinc-800 hover:bg-zinc-750 text-emerald-400 border border-emerald-500/30 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition shadow-xs"
                >
                  <Banknote className="w-3.5 h-3.5" />
                  <span>Hızlı Nakit [F2]</span>
                </button>
                <button
                  onClick={handleFastCardSale}
                  className="bg-zinc-800 hover:bg-zinc-750 text-sky-400 border border-sky-500/30 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition shadow-xs"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Hızlı Kart [F4]</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full bg-zinc-950/80 border border-zinc-850 text-zinc-500 py-2.5 px-4 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 opacity-40" />
                <span className="text-xs font-medium">Sepet Bekleniyor</span>
              </div>
              <span className="text-sm font-mono font-bold text-zinc-600">₺0.00</span>
            </div>
          )}
        </div>

      </div>

      {/* ================= RIGHT PANE: DESKTOP CART & FAST CHECKOUT (lg:flex) ================= */}
      <div className="hidden lg:flex w-96 xl:w-[430px] min-h-0 flex-col bg-zinc-900/70 border border-zinc-700/70 rounded-2xl overflow-hidden shadow-2xl shadow-black/25 shrink-0 backdrop-blur-sm">
        
        {/* Cart Top Header */}
        <div className="shrink-0 p-3 bg-zinc-950/80 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white">Alışveriş Sepeti</h3>
              <p className="text-[10px] text-zinc-400 font-mono">
                {cart.reduce((s, i) => s + i.quantity, 0)} Adet ({cart.length} Kalem)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {hasPermission('canApplyDiscount') && (
              <button
                onClick={() => setShowDiscountModal(true)}
                className={`text-[11px] font-semibold px-2 py-1 rounded-lg border transition ${
                  discountPercent > 0
                    ? 'bg-amber-500 text-zinc-950 border-amber-400 font-bold'
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-white'
                }`}
                title="Sepet İndirimi"
              >
                %{discountPercent > 0 ? discountPercent : ' İndirim'}
              </button>
            )}

            <button
              onClick={() => setShowRecentSales(true)}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg transition font-bold flex items-center gap-1"
              title="Son Yapılan İşlemler ve Fişler [F9]"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>[F9] Fişler</span>
            </button>

            <button
              onClick={handleSuspendCart}
              disabled={cart.length === 0}
              className="text-[11px] text-amber-300/90 hover:text-amber-200 bg-amber-500/10 disabled:opacity-30 border border-amber-500/20 px-2 py-1 rounded-lg transition"
              title="Sepeti Askıya Al [F8]"
            >
              [F8] Beklet
            </button>

            <button
              onClick={clearCart}
              disabled={cart.length === 0}
              className="text-[11px] text-rose-400 hover:text-rose-300 bg-rose-500/10 disabled:opacity-30 border border-rose-500/20 px-2 py-1 rounded-lg transition"
              title="Sepeti Temizle [Esc]"
            >
              [Esc] İptal
            </button>
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
              <div className="w-16 h-16 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-600 mb-3 shadow-inner">
                <ShoppingBag className="w-8 h-8 stroke-1 text-emerald-500/40" />
              </div>
              <p className="text-xs font-bold text-zinc-300">Sepet Boş</p>
              <p className="text-[11px] text-zinc-500 mt-1 max-w-[220px]">
                USB barkod tabancasıyla okutun veya sol listeden tıklayın.
              </p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.id}
                className="bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 rounded-xl p-2.5 flex items-center justify-between gap-2 shadow-xs transition"
              >
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-white truncate">{item.name}</h4>
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono mt-0.5">
                    <span className="text-emerald-400 font-bold">₺{item.price.toFixed(2)}</span>
                    <span>×</span>
                    <span>{item.quantity}</span>
                    <span className="text-zinc-600">|</span>
                    <span className="text-zinc-500">KDV %{item.taxRate}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.id, -1)}
                    className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-300 flex items-center justify-center active:scale-95 transition"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center text-xs font-bold text-white font-mono">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(item.id, 1)}
                    className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-300 flex items-center justify-center active:scale-95 transition"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black text-emerald-400 font-mono w-14 text-right">
                    ₺{item.total.toFixed(2)}
                  </span>
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="p-1 text-zinc-500 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop Cart Footer & Fast Supermarket Hotkey Buttons */}
        <div className="shrink-0 bg-zinc-950 border-t border-zinc-800 p-3 space-y-2.5">
          {/* Subtotal, Discount & Tax */}
          <div className="space-y-1 text-xs text-zinc-400 border-b border-zinc-800/80 pb-2">
            <div className="flex justify-between">
              <span>Ara Toplam:</span>
              <span className="font-mono text-zinc-300">₺{subtotal.toFixed(2)}</span>
            </div>
            {discountPercent > 0 && (
              <div className="flex justify-between text-rose-400">
                <span>İndirim (%{discountPercent}):</span>
                <span className="font-mono">-₺{discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-[11px] text-zinc-500">
              <span>KDV Dahil:</span>
              <span className="font-mono">₺{taxTotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Grand Total Display */}
          <div className="flex items-baseline justify-between bg-zinc-900/90 border border-zinc-800 rounded-xl px-3 py-2">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wide">Ödenecek Tutar</span>
            <span className="text-2xl font-black font-mono text-emerald-400 tracking-tight">
              ₺{grandTotal.toFixed(2)}
            </span>
          </div>

          {/* 1-Click Supermarket Cashier Hotkey Buttons */}
          <div className="grid grid-cols-2 gap-2">
            {/* F2: Fast Cash */}
            <button
              onClick={handleFastCashSale}
              disabled={cart.length === 0}
              className="bg-emerald-400 hover:bg-emerald-300 disabled:opacity-30 text-zinc-950 font-black py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-98 transition"
            >
              <Banknote className="w-4 h-4" />
              <div className="text-left">
                <div className="text-[10px] opacity-75 font-mono leading-none">[F2]</div>
                <div className="text-xs font-black leading-tight">Nakit Satış</div>
              </div>
            </button>

            {/* F4: Fast Card */}
            <button
              onClick={handleFastCardSale}
              disabled={cart.length === 0}
              className="bg-sky-400 hover:bg-sky-300 disabled:opacity-30 text-zinc-950 font-black py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 active:scale-98 transition"
            >
              <CreditCard className="w-4 h-4" />
              <div className="text-left">
                <div className="text-[10px] opacity-75 font-mono leading-none">[F4]</div>
                <div className="text-xs font-black leading-tight">Kart Satış</div>
              </div>
            </button>
          </div>

          {/* Detailed Payment Button */}
          <button
            onClick={() => setShowPayment(true)}
            disabled={cart.length === 0}
            className="w-full bg-zinc-850 hover:bg-zinc-800 disabled:opacity-30 text-zinc-200 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition border border-zinc-750"
          >
            <span>Detaylı Ödeme (Veresiye / Parçalı / Para Üstü)</span>
          </button>
        </div>

      </div>

      {/* ================= MODALS ================= */}
      {/* Top Notification Toast (Ödeme Alındı) */}
      {saleSuccessToast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-md pointer-events-auto animate-in slide-in-from-top-4 duration-300">
          <div className="bg-zinc-900/95 border-2 border-emerald-500/80 backdrop-blur-md rounded-2xl p-3 sm:p-3.5 shadow-2xl shadow-emerald-950/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/40 shadow-inner">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-emerald-400 font-mono font-black text-sm sm:text-base">
                    ₺{saleSuccessToast.amount.toFixed(2)}
                  </span>
                  <span className="text-zinc-200 text-xs font-bold truncate">
                    ödeme alınmıştır
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono mt-0.5">
                  <span className="text-emerald-300 font-semibold">
                    {saleSuccessToast.method === 'cash' ? 'Nakit' : saleSuccessToast.method === 'card' ? 'Kredi Kartı' : `Veresiye (${saleSuccessToast.customerName || 'Müşteri'})`}
                  </span>
                  <span>•</span>
                  <span>#{saleSuccessToast.receiptNo}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setCompletedSale(saleSuccessToast.sale);
                  setSaleSuccessToast(null);
                }}
                className="bg-emerald-400 hover:bg-emerald-300 text-zinc-950 px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 active:scale-95 transition shadow-sm"
                title="Fişi Görüntüle ve Yazdır"
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>Fişi Gör</span>
              </button>
              <button
                type="button"
                onClick={() => setSaleSuccessToast(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= RECENT TRANSACTIONS / RECEIPTS MODAL ================= */}
      {showRecentSales && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-4 safe-bottom animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-750 w-full max-w-2xl max-h-[85vh] rounded-3xl flex flex-col shadow-2xl overflow-hidden">
            
            {/* Modal Header */}
            <div className="shrink-0 p-3.5 sm:p-4 bg-zinc-950/90 border-b border-zinc-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold">
                  <Receipt className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <span>Son Yapılan İşlemler & Fişler</span>
                    <span className="text-xs bg-zinc-800 text-zinc-400 font-mono px-2 py-0.5 rounded-full border border-zinc-700">
                      {recentSales.length} Fiş
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    İstediğiniz fişe dokunarak anında açabilir ve yazdırabilirsiniz.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRecentSales(false)}
                className="p-1.5 rounded-full bg-zinc-800 text-zinc-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search filter */}
            <div className="p-3 bg-zinc-900 border-b border-zinc-800">
              <div className="relative">
                <input
                  type="text"
                  value={recentSearch}
                  onChange={(e) => setRecentSearch(e.target.value)}
                  placeholder="Fiş no, müşteri adı veya tutar ile arayın..."
                  className="w-full bg-zinc-950 border border-zinc-750 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                {recentSearch && (
                  <button onClick={() => setRecentSearch('')} className="absolute right-3 top-2.5 text-zinc-400">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Sales List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 overscroll-contain">
              {filteredRecentSales.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 space-y-2">
                  <Receipt className="w-10 h-10 mx-auto text-zinc-700 stroke-1" />
                  <p className="text-xs font-bold text-zinc-400">Henüz kayıtlı satış işlemi bulunamadı.</p>
                </div>
              ) : (
                filteredRecentSales.map((sale) => (
                  <div
                    key={sale.id || sale.receiptNo}
                    className="bg-zinc-950/70 hover:bg-zinc-850/90 border border-zinc-800/90 hover:border-emerald-500/40 rounded-2xl p-3 sm:p-3.5 flex items-center justify-between gap-3 transition group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold font-mono text-white">
                          #{sale.receiptNo}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          sale.paymentMethod === 'cash'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : sale.paymentMethod === 'card'
                            ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        }`}>
                          {sale.paymentMethod === 'cash' ? 'Nakit' : sale.paymentMethod === 'card' ? 'Kredi Kartı' : `Veresiye (${sale.customerName || 'Müşteri'})`}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {new Date(sale.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                          {' • '}
                          {new Date(sale.date).toLocaleDateString('tr-TR')}
                        </span>
                      </div>

                      {/* Items preview snippet */}
                      <p className="text-[11px] text-zinc-400 truncate mt-1">
                        {sale.items?.map(i => `${i.name} (x${i.quantity})`).join(', ') || 'Ürün bilgisi yok'}
                      </p>
                      
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        Kasiyer: {sale.sellerName || 'Kasiyer'} • {sale.items?.length || 0} Kalem
                      </div>
                    </div>

                    <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                      <div className="text-sm sm:text-base font-black font-mono text-emerald-400">
                        ₺{sale.grandTotal.toFixed(2)}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCompletedSale(sale);
                          setShowRecentSales(false);
                        }}
                        className="bg-emerald-400 hover:bg-emerald-300 text-zinc-950 font-black px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/10 active:scale-95 transition"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Fişi Aç & Yazdır</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="shrink-0 p-3 bg-zinc-950/80 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
              <span>Toplam {filteredRecentSales.length} işlem listelendi</span>
              <button
                type="button"
                onClick={() => setShowRecentSales(false)}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-xl font-bold transition"
              >
                Kapat
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Discount Modal */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-750 rounded-3xl p-5 w-full max-w-xs space-y-3 shadow-2xl">
            <h4 className="text-sm font-bold text-white">Sepet İndirimi Seçin</h4>
            <div className="grid grid-cols-4 gap-2">
              {[0, 5, 10, 15, 20, 25, 30, 50].map((pct) => (
                <button
                  key={pct}
                  onClick={() => { setDiscountPercent(pct); setShowDiscountModal(false); }}
                  className={`py-2 rounded-xl text-xs font-bold font-mono transition ${
                    discountPercent === pct
                      ? 'bg-amber-500 text-zinc-950'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  %{pct}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowDiscountModal(false)}
              className="w-full bg-zinc-800 hover:bg-zinc-750 text-zinc-400 py-2 rounded-xl text-xs font-bold transition"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* Camera Barcode Scanner Modal */}
      {showScanner && (
        <BarcodeScanner
          onScan={(code) => {
            handleBarcodeScanned(code);
            setShowScanner(false);
          }}
          onClose={() => setShowScanner(false)}
          continuous={false}
        />
      )}

      {/* Payment Modal */}
      {showPayment && (
        <PaymentModal
          total={grandTotal}
          onComplete={handleSaleCompleted}
          onClose={() => setShowPayment(false)}
        />
      )}

      {/* Receipt Modal */}
      {completedSale && (
        <ReceiptModal
          sale={completedSale}
          onClose={() => setCompletedSale(null)}
          storeInfo={{
            name: storeSettings?.storeName || 'KURŞUNLU MARKET',
            address: storeSettings?.storeAddress || 'Merkez Mah.',
            phone: storeSettings?.storePhone || '0212 555 0011',
            taxId: storeSettings?.taxId || 'VKN: 1234567890',
            footer: storeSettings?.receiptFooter || 'Teşekkür Ederiz!'
          }}
        />
      )}

      {/* Suspended Sales Modal */}
      {showSuspended && (
        <SuspendedSales
          onRestore={(items) => setCart(items)}
          onClose={() => setShowSuspended(false)}
        />
      )}

      {/* Unknown or Unpriced Barcode - Quick Pricing Modal */}
      {quickAddModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 safe-bottom animate-fade-in">
          <form onSubmit={handleQuickAddSubmit} className="bg-zinc-900 border border-zinc-750 w-full max-w-md rounded-3xl p-5 space-y-3.5 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  {quickAddModal.isCatalogMatch ? (
                    <>
                      <Globe className="w-4 h-4 text-sky-400" />
                      <span className="text-sky-300">İlk Okutma: Fiyat Belirleyin</span>
                    </>
                  ) : (
                    <>
                      <Tag className="w-4 h-4 text-amber-400" />
                      <span>Yeni Ürün Kaydet</span>
                    </>
                  )}
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                  Barkod: <span className="text-emerald-400 font-bold">{quickAddModal.barcode}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuickAddModal({ isOpen: false, barcode: '', productId: null, isCatalogMatch: false, title: '' })}
                className="p-1 rounded-full bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {quickAddModal.isCatalogMatch && (
              <div className="bg-sky-950/50 border border-sky-500/30 rounded-2xl p-2.5 flex items-start gap-2 text-xs text-sky-200">
                <Sparkles className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <b>İnternet / Katalog Veritabanında Bulundu!</b> Ürün adı otomatik dolduruldu. Mağazanızın alış ve satış fiyatını girip kaydedin; sonraki okutmalarda doğrudan sepete eklenecektir.
                </div>
              </div>
            )}

            <div>
              <label className="text-[11px] font-bold text-zinc-300 block mb-1">Ürün Adı *</label>
              <input
                type="text"
                required
                autoFocus={!quickName}
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder="Örn: Ülker Çikolata"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-amber-400 block mb-1">Alış Fiyatı (₺)</label>
                <input
                  type="number"
                  step="0.01"
                  value={quickBuyPrice}
                  onChange={(e) => setQuickBuyPrice(e.target.value)}
                  placeholder="0.00 (Opsiyonel)"
                  className="w-full bg-zinc-950 border border-amber-500/50 rounded-xl px-3 py-2 text-xs text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-emerald-400 block mb-1">Satış Fiyatı (₺) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  autoFocus={Boolean(quickName)}
                  value={quickPrice}
                  onChange={(e) => setQuickPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-zinc-950 border border-emerald-500/50 rounded-xl px-3 py-2 text-xs text-emerald-300 font-mono font-bold focus:outline-none focus:border-emerald-400"
                />
              </div>
            </div>

            {quickPrice && quickBuyPrice && (
              <div className="bg-zinc-950 px-3 py-1.5 rounded-xl border border-zinc-800 flex items-center justify-between text-[11px]">
                <span className="text-zinc-400">Tahmini Kâr:</span>
                <span className={`font-mono font-bold ${parseFloat(quickPrice) >= parseFloat(quickBuyPrice) ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ₺{(parseFloat(quickPrice) - parseFloat(quickBuyPrice)).toFixed(2)}
                  {parseFloat(quickBuyPrice) > 0 && ` (%${(((parseFloat(quickPrice) - parseFloat(quickBuyPrice)) / parseFloat(quickBuyPrice)) * 100).toFixed(0)})`}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-zinc-300 block mb-1">Kategori</label>
                <input
                  type="text"
                  value={quickCategory}
                  onChange={(e) => setQuickCategory(e.target.value)}
                  placeholder="Genel"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-zinc-300 block mb-1">KDV Oranı</label>
                <select
                  value={quickTaxRate}
                  onChange={(e) => setQuickTaxRate(parseInt(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="1">%1 KDV</option>
                  <option value="10">%10 KDV</option>
                  <option value="20">%20 KDV</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setQuickAddModal({ isOpen: false, barcode: '', productId: null, isCatalogMatch: false, title: '' })}
                className="w-full bg-zinc-800 text-zinc-400 hover:text-white py-2.5 rounded-xl text-xs font-bold transition"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                className="w-full bg-emerald-400 hover:bg-emerald-300 text-zinc-950 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-emerald-500/20 active:scale-95 transition flex items-center justify-center gap-1"
              >
                <span>Fiyatı Kaydet ve Ekle</span>
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
