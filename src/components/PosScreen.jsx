import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Scan, Search, Plus, Minus, Trash2, PauseCircle, 
  RotateCcw, Sparkles, Percent, Tag, AlertCircle, ShoppingBag, X, Globe, Loader2,
  Banknote, CreditCard, Keyboard, Monitor, Layers, CheckCircle2, ChevronRight,
  Receipt, Printer, Clock, Star, Zap
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

  // Return / Refund Mode states
  const [isRefundMode, setIsRefundMode] = useState(false);
  const [refundPaymentMethod, setRefundPaymentMethod] = useState('cash'); // 'cash' | 'card' | 'debt'
  const [refundQty, setRefundQty] = useState(1);
  const [refundCustomerId, setRefundCustomerId] = useState('');
  const [refundCustomerName, setRefundCustomerName] = useState('');
  const [refundToast, setRefundToast] = useState(null);
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];

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

  // Barkodsuz (Kiralama, Masa-Sandalye, Mangal, Top, Hizmet vb.) Modal ve Form State'i
  const [nonBarcodeModal, setNonBarcodeModal] = useState(false);
  const [nonBarcodeName, setNonBarcodeName] = useState('');
  const [nonBarcodePrice, setNonBarcodePrice] = useState('');
  const [nonBarcodeCategory, setNonBarcodeCategory] = useState('Kiralama & Hizmet');
  const [nonBarcodeIsQuick, setNonBarcodeIsQuick] = useState(true);
  const [nonBarcodeStock, setNonBarcodeStock] = useState('999');

  // Hızlı öneri şablonları
  const NON_BARCODE_PRESETS = [
    { name: 'Kiralık Mangal', price: 150, category: 'Kiralama & Hizmet', icon: '🥩' },
    { name: 'Kiralık Masa & Sandalye', price: 75, category: 'Kiralama & Hizmet', icon: '🪑' },
    { name: 'Futbol / Voleybol Topu', price: 30, category: 'Kiralama & Hizmet', icon: '⚽' },
    { name: 'Semaver Çay Hizmeti', price: 100, category: 'Kiralama & Hizmet', icon: '☕' },
    { name: 'Şezlong & Şemsiye', price: 80, category: 'Kiralama & Hizmet', icon: '⛱️' },
    { name: 'Ekmek / Unlu Mamul', price: 10, category: 'Unlu Mamul', icon: '🍞' },
    { name: 'Açık Su / Meşrubat', price: 30, category: 'İçecek', icon: '💧' },
  ];

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
      if (selectedCategory === 'FAVORITES') {
        return filteredProducts.filter(p => p.isQuick);
      }
      return filteredProducts;
    }
    if (selectedCategory === 'FAVORITES') {
      return products.filter(p => p.isQuick);
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

  // Process Return / Refund
  const processRefund = async (product, quantity = 1, method = refundPaymentMethod, custId = refundCustomerId, custName = refundCustomerName) => {
    if (!product) return;
    const qty = Math.max(1, parseInt(quantity) || 1);
    const unitPrice = product.price || 0;
    const buyPrice = product.buyPrice || 0;
    const refundTotal = unitPrice * qty;
    const refundCost = buyPrice * qty;
    const refundProfit = -(refundTotal - refundCost);
    const taxRate = product.taxRate || 1;
    const taxTotal = -(refundTotal - (refundTotal / (1 + taxRate / 100)));

    // 1. Ürün stoğuna geri ekle
    const currentProd = await db.products.get(product.id);
    const prevStock = currentProd?.stock || 0;
    const newStock = prevStock + qty;
    await db.products.update(product.id, {
      stock: newStock,
      updatedAt: new Date().toISOString()
    });

    // 2. Satış / İade kaydını oluştur
    const now = new Date();
    const receiptNo = `IAD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Date.now().toString().slice(-4)}`;

    const saleRecord = {
      receiptNo,
      date: now.toISOString(),
      items: [
        {
          id: product.id,
          barcode: product.barcode,
          name: product.name,
          price: unitPrice,
          buyPrice: buyPrice,
          taxRate: taxRate,
          unit: product.unit || 'Adet',
          quantity: -qty,
          total: -refundTotal
        }
      ],
      subtotal: -refundTotal,
      discount: 0,
      taxTotal: taxTotal,
      grandTotal: -refundTotal,
      profit: refundProfit,
      paymentMethod: method,
      cashGiven: method === 'cash' ? refundTotal : 0,
      changeGiven: 0,
      customerId: method === 'debt' ? (custId ? parseInt(custId) : null) : null,
      customerName: method === 'debt' ? custName : null,
      sellerId: currentUser?.id || 'user_kasiyer',
      sellerName: currentUser?.name || 'Kasiyer',
      status: 'completed',
      isRefund: true,
      type: 'refund',
      note: `Ürün İadesi: ${product.name} (${qty} ${product.unit || 'Adet'})`
    };

    const saleId = await db.sales.add(saleRecord);
    saleRecord.id = saleId;

    // 3. Veresiye ise müşterinin borcundan düş
    if (method === 'debt' && custId) {
      let cust = await db.customers.get(custId);
      if (!cust && !isNaN(Number(custId))) cust = await db.customers.get(Number(custId));
      if (!cust) cust = await db.customers.get(String(custId));
      if (cust) {
        const currentBal = Number(cust.balance) || 0;
        const newBalance = Math.max(0, currentBal - refundTotal);
        const targetId = cust.id;
        const nowIso = now.toISOString();

        let updated = await db.customers.update(targetId, {
          balance: newBalance,
          updatedAt: nowIso
        });
        if (!updated && !isNaN(Number(targetId))) {
          updated = await db.customers.update(Number(targetId), {
            balance: newBalance,
            updatedAt: nowIso
          });
        }
        if (!updated) {
          await db.customers.update(String(targetId), {
            balance: newBalance,
            updatedAt: nowIso
          });
        }

        await db.customerTransactions.add({
          customerId: cust.id,
          type: 'payment',
          amount: refundTotal,
          date: nowIso,
          note: `Ürün İadesi: ${product.name} (Fiş #${receiptNo})`,
          receiptNo
        });
      }
    }

    // 4. WebSocket & Google Drive eşitleme
    sync.broadcast('SALE_REFUNDED', {
      sale: saleRecord,
      productId: product.id,
      newStock
    });
    googleDriveSync.triggerOnSaleSync();

    // 5. Ses ve Bildirim
    playCashRegisterSound();

    if (window._refundToastTimer) clearTimeout(window._refundToastTimer);
    setRefundToast({
      sale: saleRecord,
      saleId: saleId,
      productId: product.id,
      productName: product.name,
      qty: qty,
      unit: product.unit || 'Adet',
      amount: refundTotal,
      method: method,
      receiptNo,
      time: now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    });
    window._refundToastTimer = setTimeout(() => {
      setRefundToast(null);
    }, 7000);
  };

  const handleUndoRefund = async (toast) => {
    if (!toast) return;
    try {
      const prod = await db.products.get(toast.productId);
      if (prod) {
        await db.products.update(prod.id, {
          stock: Math.max(0, prod.stock - toast.qty),
          updatedAt: new Date().toISOString()
        });
      }
      await db.sales.update(toast.saleId, { status: 'cancelled' });

      if (toast.sale?.paymentMethod === 'debt' && toast.sale?.customerId) {
        let cust = await db.customers.get(toast.sale.customerId);
        if (!cust && !isNaN(Number(toast.sale.customerId))) cust = await db.customers.get(Number(toast.sale.customerId));
        if (!cust) cust = await db.customers.get(String(toast.sale.customerId));
        if (cust) {
          const newBal = (Number(cust.balance) || 0) + toast.amount;
          const targetId = cust.id;
          const nowIso = new Date().toISOString();
          let updated = await db.customers.update(targetId, { balance: newBal, updatedAt: nowIso });
          if (!updated && !isNaN(Number(targetId))) {
            updated = await db.customers.update(Number(targetId), { balance: newBal, updatedAt: nowIso });
          }
          if (!updated) {
            await db.customers.update(String(targetId), { balance: newBal, updatedAt: nowIso });
          }
        }
      }

      setRefundToast(null);
      playBarcodeBeep();
    } catch (err) {
      console.error('İade geri alma hatası:', err);
    }
  };

  // Handle barcode scanned from camera, bluetooth or USB barcode gun
  const handleBarcodeScanned = async (barcode) => {
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return;

    // İade modu aktifse: doğrudan iade işlemini yap
    if (isRefundMode) {
      const found = await db.products.where('barcode').equals(cleanBarcode).first();
      if (found) {
        await processRefund(found, refundQty);
        return;
      }
      playErrorBeep();
      alert(`[İADE] "${cleanBarcode}" barkodlu ürün sistemde kayıtlı değil! İade alabilmek için ürünün veritabanında kayıtlı olması gerekir.`);
      return;
    }

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

  // Hazır şablonu form alanlarına uygula
  const applyNonBarcodePreset = (preset) => {
    setNonBarcodeName(preset.name);
    setNonBarcodePrice(preset.price.toString());
    setNonBarcodeCategory(preset.category);
    setNonBarcodeIsQuick(true);
  };

  // Barkodsuz (Mangal, Masa-Sandalye, Top, Hizmet vb.) Ürün Kaydet & Sepete Ekle
  const handleNonBarcodeSubmit = async (e, shouldAddToCart = true) => {
    if (e) e.preventDefault();
    if (!nonBarcodeName.trim() || !nonBarcodePrice) {
      alert('Lütfen ürün / hizmet adını ve satış fiyatını girin.');
      return;
    }

    const sellP = parseFloat(nonBarcodePrice) || 0;
    const cleanCode = `BRK-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;

    try {
      const newId = await db.products.add({
        barcode: cleanCode,
        name: nonBarcodeName.trim(),
        category: nonBarcodeCategory.trim() || 'Kiralama & Hizmet',
        price: sellP,
        buyPrice: 0,
        taxRate: 1,
        stock: parseFloat(nonBarcodeStock) || 999,
        unit: 'Adet',
        needsPricing: false,
        isQuick: nonBarcodeIsQuick,
        isNoBarcode: true,
        color: '#f59e0b',
        updatedAt: new Date().toISOString()
      });

      const savedProduct = await db.products.get(newId);
      sync.broadcast('PRODUCT_SAVED', { product: savedProduct });
      googleDriveSync.triggerOnSaleSync();

      if (shouldAddToCart) {
        addToCart(savedProduct, 1);
      }

      setNonBarcodeModal(false);
      setNonBarcodeName('');
      setNonBarcodePrice('');
    } catch (err) {
      alert('Kayıt sırasında hata oluştu: ' + err.message);
    }
  };

  // Tek Tıkla Örnek Kiralama Paketini Sisteme Ekle (Mangal, Masa-Sandalye, Top)
  const handleQuickRentalPackSeed = async () => {
    try {
      const itemsToSeed = [
        { name: 'Kiralık Mangal', price: 150, category: 'Kiralama & Hizmet', code: `BRK-MAN${Date.now().toString().slice(-4)}` },
        { name: 'Kiralık Masa & Sandalye', price: 75, category: 'Kiralama & Hizmet', code: `BRK-MAS${Date.now().toString().slice(-4)}` },
        { name: 'Futbol / Voleybol Topu', price: 30, category: 'Kiralama & Hizmet', code: `BRK-TOP${Date.now().toString().slice(-4)}` },
      ];

      for (const item of itemsToSeed) {
        const exists = await db.products.filter(p => p.name.toLowerCase() === item.name.toLowerCase()).first();
        if (!exists) {
          const newId = await db.products.add({
            barcode: item.code,
            name: item.name,
            category: item.category,
            price: item.price,
            buyPrice: 0,
            taxRate: 1,
            stock: 999,
            unit: 'Adet',
            needsPricing: false,
            isQuick: true,
            isNoBarcode: true,
            color: '#f59e0b',
            updatedAt: new Date().toISOString()
          });
          const prod = await db.products.get(newId);
          sync.broadcast('PRODUCT_SAVED', { product: prod });
        } else if (!exists.isQuick) {
          await db.products.update(exists.id, { isQuick: true });
        }
      }
      googleDriveSync.triggerOnSaleSync();
      setNonBarcodeModal(false);
    } catch (err) {
      console.error('Kiralama paketi yüklenemedi:', err);
    }
  };

  // Ürünü Hızlı Satış Butonlarına (isQuick) Ekle / Çıkar
  const toggleQuickProduct = async (product, e) => {
    if (e) e.stopPropagation();
    try {
      const updatedStatus = !product.isQuick;
      await db.products.update(product.id, {
        isQuick: updatedStatus,
        updatedAt: new Date().toISOString()
      });
      sync.broadcast('PRODUCT_SAVED', { product: { ...product, isQuick: updatedStatus } });
      googleDriveSync.triggerOnSaleSync();
    } catch (err) {
      console.error('Hızlı ürün durumu güncellenemedi:', err);
    }
  };

  // Handle Search Input submit (e.g. Enter pressed by barcode gun)
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;

    if (isRefundMode) {
      const matched = products?.find(p => p.barcode === searchTerm.trim());
      if (matched) {
        processRefund(matched, refundQty);
        setSearchTerm('');
        return;
      }
      if (filteredProducts.length === 1) {
        processRefund(filteredProducts[0], refundQty);
        setSearchTerm('');
        return;
      }
      handleBarcodeScanned(searchTerm);
      setSearchTerm('');
      return;
    }

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
      let cust = await db.customers.get(paymentDetails.customerId);
      if (!cust && !isNaN(Number(paymentDetails.customerId))) {
        cust = await db.customers.get(Number(paymentDetails.customerId));
      }
      if (!cust) {
        cust = await db.customers.get(String(paymentDetails.customerId));
      }
      if (cust) {
        const currentBal = Number(cust.balance) || 0;
        const newBalance = currentBal + grandTotal;
        const targetId = cust.id;
        const nowIso = now.toISOString();

        let updated = await db.customers.update(targetId, {
          balance: newBalance,
          updatedAt: nowIso
        });
        if (!updated && !isNaN(Number(targetId))) {
          updated = await db.customers.update(Number(targetId), {
            balance: newBalance,
            updatedAt: nowIso
          });
        }
        if (!updated) {
          await db.customers.update(String(targetId), {
            balance: newBalance,
            updatedAt: nowIso
          });
        }

        await db.customerTransactions.add({
          customerId: cust.id,
          type: 'debt',
          amount: grandTotal,
          date: nowIso,
          note: `Satış Fişi #${receiptNo}`,
          receiptNo
        });
      } else {
        console.error('[POS] Veresiye müşterisi bulunamadı:', paymentDetails.customerId);
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
      if (showPayment || showScanner || showSuspended || quickAddModal.isOpen || showDiscountModal || completedSale || nonBarcodeModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowPayment(false);
          setShowScanner(false);
          setShowSuspended(false);
          setShowDiscountModal(false);
          setNonBarcodeModal(false);
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

      if (e.key === 'F7') {
        e.preventDefault();
        setIsRefundMode(prev => !prev);
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
        if (isRefundMode) {
          setIsRefundMode(false);
        } else if (showRecentSales) {
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
  }, [cart, grandTotal, showPayment, showScanner, showSuspended, quickAddModal, showDiscountModal, nonBarcodeModal, completedSale, searchTerm, barcodeInput, scanMode, isRefundMode]);

  return (
    <div className="h-full flex flex-col lg:flex-row gap-0 lg:gap-3 w-full max-w-lg lg:max-w-7xl mx-auto overflow-hidden relative">
      
      {/* ================= LEFT PANE: SEARCH, CATALOG & QUICK ITEMS ================= */}
      <div className="flex-1 min-h-0 flex flex-col bg-zinc-950/55 lg:bg-zinc-900/45 lg:border lg:border-zinc-700/70 lg:rounded-2xl overflow-hidden shadow-xl shadow-black/10">
        
        {/* Modern Minimalist Header / Mode Switcher */}
        <div className="shrink-0 p-2 sm:p-2.5 bg-zinc-900/90 backdrop-blur border-b border-zinc-800/80 space-y-2">
          
          {/* Mode Switcher Segmented Control (Barkod Okuyucu vs Kamera vs İade Modu) */}
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

            {/* Return / Refund Mode Trigger */}
            <button
              type="button"
              onClick={() => setIsRefundMode(prev => !prev)}
              className={`relative px-2.5 py-1 rounded-lg border transition active:scale-95 shrink-0 flex items-center gap-1.5 ${
                isRefundMode
                  ? 'bg-rose-500 text-white border-rose-400 shadow-md shadow-rose-500/30 animate-pulse'
                  : 'bg-zinc-850 text-rose-300 hover:text-white hover:bg-rose-600/20 border-rose-500/30'
              }`}
              title="Ürün İade Modu [F7]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="text-[11px] font-bold">
                {isRefundMode ? 'İADE AÇIK' : 'İade [F7]'}
              </span>
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

          {/* ================= ACTIVE REFUND MODE BANNER ================= */}
          {isRefundMode && (
            <div className="bg-gradient-to-r from-rose-950/90 via-amber-950/90 to-rose-950/90 border border-rose-500/70 rounded-xl p-2.5 space-y-2 shadow-lg animate-fade-in text-white">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-rose-500 flex items-center justify-center text-white shrink-0 shadow-md">
                    <RotateCcw className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black tracking-wider text-rose-300 uppercase">🔄 İADE MODU AKTİF</span>
                      <span className="text-[10px] bg-rose-500/30 text-rose-200 px-1.5 py-0.2 rounded font-semibold border border-rose-500/30">
                        Anında İade & Stok Girişi
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-tight">
                      Barkod okutun veya ürüne dokunun — <strong>anında iade alınır</strong>, tutar kasadan düşülür ve stok artırılır.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsRefundMode(false)}
                  className="shrink-0 p-1 rounded-lg bg-zinc-800/80 hover:bg-rose-500 text-zinc-400 hover:text-white transition flex items-center gap-1 text-xs px-2"
                  title="İade Modunu Kapat [Esc]"
                >
                  <X className="w-3.5 h-3.5" />
                  <span className="font-bold hidden sm:inline">Kapat (Esc)</span>
                </button>
              </div>

              {/* Controls: Refund Method & Quantity */}
              <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-rose-500/20">
                <span className="text-[11px] font-bold text-rose-200">İade Ödemesi:</span>
                <div className="flex items-center bg-zinc-950/80 border border-zinc-800 rounded-lg p-0.5 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setRefundPaymentMethod('cash')}
                    className={`px-2.5 py-1 rounded-md transition ${
                      refundPaymentMethod === 'cash' ? 'bg-emerald-500 text-zinc-950 font-black' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    💵 Nakit
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefundPaymentMethod('card')}
                    className={`px-2.5 py-1 rounded-md transition ${
                      refundPaymentMethod === 'card' ? 'bg-sky-500 text-zinc-950 font-black' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    💳 Kart
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefundPaymentMethod('debt')}
                    className={`px-2.5 py-1 rounded-md transition ${
                      refundPaymentMethod === 'debt' ? 'bg-amber-500 text-zinc-950 font-black' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    👤 Veresiye
                  </button>
                </div>

                {/* Customer Picker for Debt */}
                {refundPaymentMethod === 'debt' && (
                  <select
                    value={refundCustomerId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setRefundCustomerId(id);
                      const c = customers.find(cust => cust.id === parseInt(id));
                      setRefundCustomerName(c ? c.name : '');
                    }}
                    className="bg-zinc-950 border border-amber-500/50 text-amber-300 text-xs rounded-lg px-2 py-1 focus:outline-none"
                  >
                    <option value="">Borçtan düşülecek müşteri...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name} (Bakiye: ₺{(c.balance || 0).toFixed(2)})</option>
                    ))}
                  </select>
                )}

                {/* Quantity adjustment */}
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-[11px] font-bold text-zinc-400">İade Adedi:</span>
                  <div className="flex items-center bg-zinc-950/80 border border-zinc-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setRefundQty(prev => Math.max(1, prev - 1))}
                      className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-white font-bold text-sm"
                    >
                      -
                    </button>
                    <span className="px-2 text-xs font-mono font-black text-rose-300">{refundQty}</span>
                    <button
                      type="button"
                      onClick={() => setRefundQty(prev => prev + 1)}
                      className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-white font-bold text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

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
                    placeholder={isRefundMode ? "🔄 İade edilecek barkodu okutun / yazın..." : "Barkod sayısını okutun / yazın..."}
                    className={`w-full bg-zinc-950 rounded-xl pl-8 pr-8 py-2 text-xs font-mono font-bold tracking-wider placeholder-zinc-500 focus:outline-none shadow-inner transition ${
                      isRefundMode
                        ? 'border-2 border-rose-500 focus:border-rose-400 text-rose-300'
                        : 'border border-emerald-500/50 focus:border-emerald-400 text-emerald-300'
                    }`}
                  />
                  {isRefundMode ? (
                    <RotateCcw className="w-3.5 h-3.5 text-rose-400 absolute left-2.5 top-2.5" />
                  ) : (
                    <Keyboard className="w-3.5 h-3.5 text-emerald-400 absolute left-2.5 top-2.5" />
                  )}
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
                  className={`${
                    isRefundMode
                      ? 'bg-rose-500 hover:bg-rose-400 text-white'
                      : 'bg-emerald-400 hover:bg-emerald-300 text-zinc-950'
                  } disabled:opacity-30 font-black px-3 py-2 rounded-xl text-xs flex items-center gap-1 transition shadow-xs shrink-0`}
                >
                  <span>{isRefundMode ? 'İade Al' : 'Ekle'}</span>
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
                      className={`col-span-3 py-2 disabled:opacity-35 font-black text-xs rounded-lg transition shadow-xs flex items-center justify-center gap-1 active:scale-98 ${
                        isRefundMode
                          ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/20'
                          : 'bg-emerald-400 hover:bg-emerald-300 text-zinc-950'
                      }`}
                    >
                      <span>{isRefundMode ? '↵ İadeyi Al' : '↵ Sepete Ekle'}</span>
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
                  placeholder={isRefundMode ? "🔄 İade edilecek ürün adı veya barkod..." : "Ürün adı veya barkod arayın..."}
                  className={`w-full bg-zinc-950 rounded-xl pl-8 pr-10 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none transition shadow-inner ${
                    isRefundMode
                      ? 'border-2 border-rose-500 focus:border-rose-400'
                      : 'border border-zinc-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30'
                  }`}
                />
                {isRefundMode ? (
                  <RotateCcw className="w-3.5 h-3.5 text-rose-400 absolute left-2.5 top-2.5 animate-spin-slow" />
                ) : (
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                )}
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
                    onClick={() => {
                      if (isRefundMode) {
                        processRefund(prod, refundQty);
                      } else {
                        addToCart(prod, 1);
                      }
                      setSearchTerm('');
                    }}
                    className={`p-2 flex items-center justify-between cursor-pointer active:bg-zinc-700 transition ${
                      isRefundMode ? 'hover:bg-rose-950/30' : 'hover:bg-zinc-800'
                    }`}
                  >
                    <div>
                      <p className={`text-xs font-bold ${isRefundMode ? 'text-rose-300' : 'text-white'}`}>{prod.name}</p>
                      <p className="text-[10px] text-zinc-400 font-mono">
                        {prod.barcode} • {isRefundMode ? '🔄 İade Alınacak' : `Stok: ${prod.stock}`}
                      </p>
                    </div>
                    <span className={`text-xs font-black font-mono ${isRefundMode ? 'text-rose-400' : 'text-emerald-400'}`}>
                      ₺{prod.price.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Quick Items & Non-Barcode Quick Access Bar */}
          {!searchTerm.trim() && (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setNonBarcodeName('');
                  setNonBarcodePrice('');
                  setNonBarcodeCategory('Kiralama & Hizmet');
                  setNonBarcodeIsQuick(true);
                  setNonBarcodeModal(true);
                }}
                className="shrink-0 border border-dashed border-amber-500/70 hover:border-amber-600 bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 font-bold px-2.5 py-1 rounded-lg text-xs flex items-center gap-1.5 active:scale-95 transition shadow-2xs"
                title="Barkodsuz kiralama, mangal, masa veya hizmet ürünü ekle"
              >
                <Plus className="w-3.5 h-3.5 text-amber-600 font-black" />
                <span>+ Barkodsuz / Kiralama</span>
              </button>

              {quickProducts.map((p) => {
                const isRental = p.isNoBarcode || p.barcode?.startsWith('BRK-') || p.category?.toLowerCase().includes('kira') || p.category?.toLowerCase().includes('hizmet');
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      if (isRefundMode) {
                        processRefund(p, refundQty);
                      } else {
                        addToCart(p, 1);
                      }
                    }}
                    className={`shrink-0 border rounded-lg px-2.5 py-1 text-left active:scale-95 transition flex items-center gap-1.5 shadow-2xs group ${
                      isRefundMode
                        ? 'bg-rose-50 hover:bg-rose-100 border-rose-300'
                        : isRental
                        ? 'bg-amber-50 hover:bg-amber-100/90 border-amber-300'
                        : 'bg-white hover:bg-slate-50 border-slate-300'
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-800 truncate max-w-[120px]">
                      {isRental && <span className="mr-1 text-[11px]">⚡</span>}
                      {p.name}
                    </span>
                    <span className={`text-[10px] font-mono font-black ${
                      isRefundMode
                        ? 'text-rose-600'
                        : isRental
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}>
                      {isRefundMode ? `İade ₺${p.price.toFixed(2)}` : `₺${p.price.toFixed(2)}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Desktop Category Filter Chips (lg:flex) */}
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-2 bg-slate-100/80 border-b border-slate-200 overflow-x-auto no-scrollbar shrink-0">
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all border ${
              selectedCategory === 'ALL'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm ring-1 ring-emerald-500 font-extrabold'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900 shadow-2xs font-semibold'
            }`}
          >
            Tüm Ürünler
          </button>

          {/* ⭐ Favoriler Filtre Butonu */}
          <button
            onClick={() => setSelectedCategory('FAVORITES')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all border flex items-center gap-1.5 ${
              selectedCategory === 'FAVORITES'
                ? 'bg-amber-600 text-white border-amber-600 shadow-sm ring-1 ring-amber-500 font-extrabold'
                : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-50 shadow-2xs font-semibold'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${selectedCategory === 'FAVORITES' ? 'fill-white text-white' : 'fill-amber-500 text-amber-500'}`} />
            <span>Favoriler</span>
            <span className={`px-1.5 py-0.2 text-[10px] rounded-md font-mono ${selectedCategory === 'FAVORITES' ? 'bg-black/25 text-white font-bold' : 'bg-amber-100 text-amber-900 font-bold'}`}>
              {quickProducts.length}
            </span>
          </button>

          {categories.filter(c => c !== 'ALL').map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all border ${
                selectedCategory === cat
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm ring-1 ring-emerald-500 font-extrabold'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900 shadow-2xs font-semibold'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Desktop Visual Product Grid (lg:block) */}
        <div className="hidden lg:block flex-1 min-h-0 overflow-y-auto p-3">
          {desktopDisplayProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 py-10">
              {selectedCategory === 'FAVORITES' ? (
                <div className="text-center p-6 flex flex-col items-center">
                  <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-500 mb-2.5 shadow-inner">
                    <Star className="w-7 h-7 fill-amber-400 text-amber-400" />
                  </div>
                  <p className="text-xs font-bold text-slate-800">Henüz Favori Ürün Eklenmedi</p>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
                    Ürün kartlarının sağ üstündeki <b>Yıldız (⭐)</b> simgesine tıklayarak favorilerinize ve hızlı satış çubuğuna ürün ekleyebilirsiniz.
                  </p>
                </div>
              ) : (
                <>
                  <ShoppingBag className="w-12 h-12 mb-2 opacity-30 stroke-1" />
                  <p className="text-xs font-medium">Bu kategoride ürün bulunamadı.</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {desktopDisplayProducts.map((prod) => {
                const isRental = prod.isNoBarcode || prod.barcode?.startsWith('BRK-') || prod.category?.toLowerCase().includes('kira') || prod.category?.toLowerCase().includes('hizmet');
                return (
                  <div
                    key={prod.id}
                    onClick={() => {
                      if (isRefundMode) {
                        processRefund(prod, refundQty);
                      } else {
                        addToCart(prod, 1);
                      }
                    }}
                    className={`border rounded-xl p-2.5 cursor-pointer transition active:scale-98 shadow-sm flex flex-col justify-between group relative ${
                      isRefundMode
                        ? 'bg-rose-50 hover:bg-rose-100 border-rose-300'
                        : isRental
                        ? 'bg-amber-50/40 hover:bg-amber-50/90 border-amber-200/90 hover:border-amber-400'
                        : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-emerald-500/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-1">
                        <h4 className={`text-xs font-bold transition line-clamp-2 ${isRefundMode ? 'text-rose-900' : 'text-slate-900 group-hover:text-emerald-700'}`}>
                          {prod.name}
                        </h4>
                        <button
                          type="button"
                          onClick={(e) => toggleQuickProduct(prod, e)}
                          className={`p-1 rounded-md transition shrink-0 ${
                            prod.isQuick
                              ? 'text-amber-500 hover:text-amber-600 bg-amber-100/60'
                              : 'text-slate-300 hover:text-amber-500 hover:bg-slate-100'
                          }`}
                          title={prod.isQuick ? 'Hızlı satış çubuğundan kaldır' : 'Hızlı satış çubuğuna sabitle (Basarak ekle)'}
                        >
                          <Star className={`w-3.5 h-3.5 ${prod.isQuick ? 'fill-amber-500' : ''}`} />
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {isRental ? (
                          <span className="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded font-sans flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5 text-amber-600 fill-amber-600" />
                            Kiralama/Hizmet
                          </span>
                        ) : (
                          <p className="text-[10px] text-slate-500 font-mono">
                            {prod.barcode}
                          </p>
                        )}
                        {prod.isQuick && (
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 rounded">
                            Hızlı Buton
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between">
                      <span className={`text-[10px] font-medium ${isRefundMode ? 'text-rose-700 font-bold' : 'text-slate-500'}`}>
                        {isRefundMode ? '🔄 İade Et' : isRental ? 'Hizmet / Sınırsız' : `Stok: ${prod.stock}`}
                      </span>
                      <span className={`text-xs font-black font-mono ${isRefundMode ? 'text-rose-600' : 'text-emerald-700'}`}>
                        ₺{prod.price.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
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
              <button
                type="button"
                onClick={() => setIsRefundMode(prev => !prev)}
                className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border transition ${
                  isRefundMode
                    ? 'bg-rose-500 text-white border-rose-600 shadow-xs animate-pulse'
                    : 'text-rose-400 hover:text-rose-300 bg-rose-500/10 border-rose-500/20'
                }`}
                title="Ürün İade Modu [F7]"
              >
                {isRefundMode ? 'İADE AÇIK' : 'İade [F7]'}
              </button>
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
            <div className="py-2 text-center text-xs text-zinc-500">
              Sepet boş • Ürün ekleyin veya okutun
            </div>
          )}
        </div>

      </div>

      {/* ================= RIGHT PANE: DESKTOP CART & FAST CHECKOUT (lg:flex) ================= */}
      <div className="hidden lg:flex w-96 xl:w-[430px] min-h-0 flex-col bg-zinc-900/70 border border-zinc-700/70 rounded-2xl overflow-hidden shadow-2xl shadow-black/25 shrink-0 backdrop-blur-sm">
        
        {/* Cart Top Header */}
        <div className="shrink-0 p-2.5 bg-zinc-950/90 border-b border-zinc-800 space-y-2">
          {/* Row 1: Header Title & prominent [Esc] İptal button (guaranteed to be inside screen) */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold shrink-0">
                <ShoppingBag className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-white truncate">Alışveriş Sepeti</h3>
                <p className="text-[10px] text-zinc-400 font-mono">
                  {cart.reduce((s, i) => s + i.quantity, 0)} Adet ({cart.length} Kalem)
                </p>
              </div>
            </div>

            {/* [Esc] İptal button: permanently positioned in top-right, visible and high-contrast */}
            <button
              type="button"
              onClick={clearCart}
              disabled={cart.length === 0}
              className="shrink-0 text-xs text-rose-300 hover:text-white bg-rose-500/20 hover:bg-rose-600 disabled:opacity-30 disabled:hover:bg-rose-500/20 disabled:hover:text-rose-300 border border-rose-500/40 hover:border-rose-400 px-2.5 py-1 rounded-lg transition font-bold flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Sepeti Temizle [Esc]"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>[Esc] İptal</span>
            </button>
          </div>

          {/* Row 2: Action Hotkey Buttons (F7 İade, % İndirim, F9 Fişler, F8 Beklet) */}
          <div className={`grid ${hasPermission('canApplyDiscount') ? 'grid-cols-4' : 'grid-cols-3'} gap-1.5 pt-0.5`}>
            <button
              type="button"
              onClick={() => setIsRefundMode(prev => !prev)}
              className={`text-[11px] font-bold py-1 px-1 rounded-lg border transition flex items-center justify-center gap-1 ${
                isRefundMode
                  ? 'bg-rose-500 text-white border-rose-400 shadow-sm animate-pulse'
                  : 'bg-rose-500/10 text-rose-400 hover:text-rose-300 border-rose-500/20'
              }`}
              title="Ürün İade Modu [F7]"
            >
              <RotateCcw className="w-3 h-3 shrink-0" />
              <span className="truncate">{isRefundMode ? 'İade Açık' : '[F7] İade'}</span>
            </button>

            {hasPermission('canApplyDiscount') && (
              <button
                type="button"
                onClick={() => setShowDiscountModal(true)}
                className={`text-[11px] font-semibold py-1 px-1 rounded-lg border transition flex items-center justify-center gap-1 ${
                  discountPercent > 0
                    ? 'bg-amber-500 text-zinc-950 border-amber-400 font-bold'
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-white hover:bg-zinc-750'
                }`}
                title="Sepet İndirimi"
              >
                <Percent className="w-3 h-3 shrink-0 text-amber-400" />
                <span className="truncate">%{discountPercent > 0 ? discountPercent : ' İndirim'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowRecentSales(true)}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 py-1 px-1 rounded-lg transition font-bold flex items-center justify-center gap-1"
              title="Son Yapılan İşlemler ve Fişler [F9]"
            >
              <Receipt className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">[F9] Fişler</span>
            </button>

            <button
              type="button"
              onClick={handleSuspendCart}
              disabled={cart.length === 0}
              className="text-[11px] text-amber-300/90 hover:text-amber-200 bg-amber-500/10 disabled:opacity-30 border border-amber-500/20 hover:bg-amber-500/20 py-1 px-1 rounded-lg transition font-medium flex items-center justify-center gap-1"
              title="Sepeti Askıya Al [F8]"
            >
              <PauseCircle className="w-3 h-3 shrink-0" />
              <span className="truncate">[F8] Beklet</span>
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
      {/* Top Notification Toast (İade Alındı) */}
      {refundToast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-lg pointer-events-auto animate-in slide-in-from-top-4 duration-300">
          <div className="bg-zinc-900/95 border-2 border-rose-500/80 backdrop-blur-md rounded-2xl p-3 sm:p-3.5 shadow-2xl shadow-rose-950/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/40 shadow-inner">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-rose-400 font-mono font-black text-sm sm:text-base">
                    -₺{refundToast.amount.toFixed(2)}
                  </span>
                  <span className="text-zinc-200 text-xs font-bold truncate">
                    iade alındı (+{refundToast.qty} stok)
                  </span>
                </div>
                <div className="text-[11px] text-zinc-300 truncate mt-0.5 font-medium">
                  {refundToast.productName}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono mt-0.5">
                  <span className="text-amber-300 font-semibold">
                    {refundToast.method === 'cash' ? 'Nakit İade' : refundToast.method === 'card' ? 'Kart İade' : 'Veresiye / Cari Düşüm'}
                  </span>
                  <span>•</span>
                  <span>#{refundToast.receiptNo}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setCompletedSale(refundToast.sale);
                  setRefundToast(null);
                }}
                className="bg-rose-500 hover:bg-rose-400 text-white px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 active:scale-95 transition shadow-sm"
                title="İade Fişini Görüntüle ve Yazdır"
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>İade Fişi</span>
              </button>
              <button
                type="button"
                onClick={() => handleUndoRefund(refundToast)}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-2 py-1.5 rounded-xl text-xs font-semibold border border-zinc-750 active:scale-95 transition"
                title="İade İşlemini Geri Al"
              >
                Geri Al
              </button>
              <button
                type="button"
                onClick={() => setRefundToast(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

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
                filteredRecentSales.map((sale) => {
                  const isRefund = sale.isRefund || sale.grandTotal < 0 || sale.receiptNo?.startsWith('IAD');
                  return (
                    <div
                      key={sale.id || sale.receiptNo}
                      className={`border rounded-2xl p-3 sm:p-3.5 flex items-center justify-between gap-3 transition group ${
                        isRefund
                          ? 'bg-amber-950/20 border-amber-600/40 hover:border-amber-500'
                          : 'bg-zinc-950/70 hover:bg-zinc-850/90 border-zinc-800/90 hover:border-emerald-500/40'
                      }`}
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
                          {isRefund && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-rose-500/20 text-rose-300 border-rose-500/40">
                              İADE
                            </span>
                          )}
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {new Date(sale.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                            {' • '}
                            {new Date(sale.date).toLocaleDateString('tr-TR')}
                          </span>
                        </div>

                        {/* Items preview snippet */}
                        <p className="text-[11px] text-zinc-400 truncate mt-1">
                          {sale.items?.map(i => `${i.name} (x${Math.abs(i.quantity)})`).join(', ') || 'Ürün bilgisi yok'}
                        </p>
                        
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          Kasiyer: {sale.sellerName || 'Kasiyer'} • {sale.items?.length || 0} Kalem
                        </div>
                      </div>

                      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                        <div className={`text-sm sm:text-base font-black font-mono ${
                          isRefund ? 'text-rose-400' : 'text-emerald-400'
                        }`}>
                          {sale.grandTotal < 0 ? `-₺${Math.abs(sale.grandTotal).toFixed(2)}` : `₺${sale.grandTotal.toFixed(2)}`}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setCompletedSale(sale);
                            setShowRecentSales(false);
                          }}
                          className={`${
                            isRefund
                              ? 'bg-rose-500 hover:bg-rose-400 text-white'
                              : 'bg-emerald-400 hover:bg-emerald-300 text-zinc-950'
                          } font-black px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-md active:scale-95 transition`}
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>{isRefund ? 'İade Fişi' : 'Fişi Aç'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })
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

      {/* Non-Barcode / Rental / Quick Service Modal */}
      {nonBarcodeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 safe-bottom animate-fade-in">
          <div className="bg-white border border-slate-200 w-full max-w-lg rounded-3xl p-5 space-y-4 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-700">
                  <Zap className="w-5 h-5 fill-amber-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Barkodsuz Ürün &amp; Kiralama / Hizmet Ekle
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Mangal, masa-sandalye, top gibi barkodsuz ürünleri tek dokunuşla sepete ve hızlı butonlara ekleyin.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNonBarcodeModal(false)}
                className="p-1.5 rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick 1-Click Suggestion Chips */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600">⚡ Sık Kullanılan Hazır Şablonlar (Tıklayın Dolsun):</span>
                <button
                  type="button"
                  onClick={handleQuickRentalPackSeed}
                  className="text-[10px] font-bold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg transition active:scale-95"
                  title="Mangal, Masa-Sandalye ve Top butonlarını tek tıkla sisteme yükle"
                >
                  Paketi Otomatik Yükle
                </button>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {NON_BARCODE_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyNonBarcodePreset(preset)}
                    className="shrink-0 text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-amber-50 hover:border-amber-300 text-slate-800 font-semibold transition active:scale-95 flex items-center gap-1 shadow-2xs"
                  >
                    <span>{preset.icon}</span>
                    <span>{preset.name}</span>
                    <span className="text-[10px] font-bold text-emerald-700 font-mono ml-0.5">₺{preset.price}</span>
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={(e) => handleNonBarcodeSubmit(e, true)} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">
                  Ürün / Hizmet Adı *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={nonBarcodeName}
                  onChange={(e) => setNonBarcodeName(e.target.value)}
                  placeholder="Örn: Kiralık Mangal, Masa & Sandalye, Top"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-bold text-emerald-700 block mb-1">
                    Satış Fiyatı (₺) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={nonBarcodePrice}
                    onChange={(e) => setNonBarcodePrice(e.target.value)}
                    placeholder="Örn: 150.00"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-black text-emerald-700 font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Kategori
                  </label>
                  <input
                    type="text"
                    value={nonBarcodeCategory}
                    onChange={(e) => setNonBarcodeCategory(e.target.value)}
                    placeholder="Örn: Kiralama & Hizmet"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-slate-400"
                  />
                </div>
              </div>

              {/* Quick Bar Toggle */}
              <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                    Hızlı Satış Butonlarına Sabitle
                  </p>
                  <p className="text-[11px] text-amber-700">
                    Kasa ekranında üst çubukta tek dokunuşla eklenen buton olsun.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={nonBarcodeIsQuick}
                  onChange={(e) => setNonBarcodeIsQuick(e.target.checked)}
                  className="w-5 h-5 accent-amber-600 rounded cursor-pointer"
                />
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
                <button
                  type="submit"
                  className="w-full sm:flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition active:scale-98 flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Sepete Ekle &amp; Buton Yap</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleNonBarcodeSubmit(e, false)}
                  className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition active:scale-98"
                >
                  Sadece Buton Olarak Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
