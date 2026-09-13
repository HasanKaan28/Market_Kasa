import React, { useState } from 'react';
import { 
  Plus, Search, Edit2, Trash2, Scan, AlertTriangle, 
  Download, Upload, Check, X, ArrowUpDown, Filter, Globe, Sparkles, Boxes,
  Star, Zap, Tag
} from 'lucide-react';
import { db, seedInternetBarcodes } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import BarcodeScanner from './BarcodeScanner';
import { useAuth } from '../context/AuthContext';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';
import { lookupBarcodeInCatalogOrOnline } from '../data/barcodeCatalog';

export default function ProductCatalog({ onNavigate }) {
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

  // Form State
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Temel Gıda');
  const [buyPrice, setBuyPrice] = useState('');
  const [price, setPrice] = useState('');
  const [taxRate, setTaxRate] = useState(1);
  const [stock, setStock] = useState('50');
  const [unit, setUnit] = useState('Adet');
  const [isQuick, setIsQuick] = useState(false);
  const [isNoBarcode, setIsNoBarcode] = useState(false);

  const allDbProducts = useLiveQuery(() => db.products.toArray(), []);

  // Yalnızca kullanıcının kendi eklediği veya fiyatlandırdığı aktif ürünler ("Tüm Ürünler"de önceden gelen kütüphane ürünleri çıkmaz)
  const products = (allDbProducts || []).filter(p => !p.needsPricing && p.price > 0);

  // Categories list
  const categories = Array.from(new Set(products.map(p => p.category).filter(Boolean)));

  // Filter products
  const filteredProducts = products.filter(p => {
    const matchesSearch = 
      p.name.toLowerCase().includes(search.toLowerCase()) || 
      p.barcode.includes(search) ||
      p.category?.toLowerCase().includes(search.toLowerCase());
    
    const matchesCategory = selectedCategory === 'ALL'
      ? true
      : selectedCategory === 'FAVORITES'
      ? p.isQuick
      : selectedCategory === 'KIRALAMA'
      ? (p.isNoBarcode || p.barcode?.startsWith('BRK-') || p.category?.toLowerCase().includes('kira') || p.category?.toLowerCase().includes('hizmet'))
      : p.category === selectedCategory;
    const matchesStock = !showLowStockOnly || (p.stock <= 10);

    return matchesSearch && matchesCategory && matchesStock;
  });

  const handleBarcodeBlurOrLookup = async (codeToLookup) => {
    const c = (codeToLookup || barcode).trim();
    if (!c) return;
    try {
      const match = await lookupBarcodeInCatalogOrOnline(c);
      if (match) {
        if (!name.trim()) setName(match.name);
        if (match.category) setCategory(match.category);
        if (match.taxRate) setTaxRate(match.taxRate);
      }
    } catch (e) {
      // ignore
    }
  };

  const openNewModal = () => {
    setEditingProduct(null);
    setBarcode('');
    setName('');
    setCategory('Temel Gıda');
    setBuyPrice('');
    setPrice('');
    setTaxRate(1);
    setStock('50');
    setUnit('Adet');
    setIsQuick(false);
    setIsNoBarcode(false);
    setIsModalOpen(true);
  };

  const openEditModal = (prod) => {
    setEditingProduct(prod);
    setBarcode(prod.barcode);
    setName(prod.name);
    setCategory(prod.category || 'Genel');
    setBuyPrice(prod.buyPrice?.toString() || '');
    setPrice(prod.price.toString());
    setTaxRate(prod.taxRate || 1);
    setStock(prod.stock.toString());
    setUnit(prod.unit || 'Adet');
    setIsQuick(!!prod.isQuick);
    setIsNoBarcode(Boolean(prod.isNoBarcode || prod.barcode?.startsWith('BRK-')));
    setIsModalOpen(true);
  };

  const toggleQuick = async (prod, e) => {
    if (e) e.stopPropagation();
    try {
      const updatedStatus = !prod.isQuick;
      await db.products.update(prod.id, { isQuick: updatedStatus, updatedAt: new Date().toISOString() });
      sync.broadcast('PRODUCT_SAVED', { product: { ...prod, isQuick: updatedStatus } });
      googleDriveSync.triggerOnSaleSync();
    } catch (err) {
      console.error('Hızlı buton güncellenemedi:', err);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim() || !price || (!isNoBarcode && (!barcode.trim() || buyPrice === ''))) {
      alert('Lütfen ürün adı ve satış fiyatı alanlarını eksiksiz doldurun.');
      return;
    }

    const cleanBarcode = (barcode || '').trim() || `BRK-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;

    const payload = {
      barcode: cleanBarcode,
      name: name.trim(),
      category: category.trim() || (isNoBarcode ? 'Kiralama & Hizmet' : 'Genel'),
      buyPrice: parseFloat(buyPrice) || 0,
      price: parseFloat(price) || 0,
      taxRate: parseInt(taxRate) || 1,
      stock: parseFloat(stock) || (isNoBarcode ? 999 : 0),
      unit: unit || 'Adet',
      isQuick: isNoBarcode ? true : isQuick,
      isNoBarcode: Boolean(isNoBarcode || cleanBarcode.startsWith('BRK-')),
      needsPricing: false,
      updatedAt: new Date().toISOString()
    };

    try {
      if (editingProduct) {
        await db.products.update(editingProduct.id, payload);
        sync.broadcast('PRODUCT_SAVED', { product: { id: editingProduct.id, ...payload } });
      } else {
        // Check duplicate barcode
        const existing = await db.products.where('barcode').equals(payload.barcode).first();
        if (existing) {
          alert('Bu barkod numarasına sahip başka bir ürün zaten var!');
          return;
        }
        const newId = await db.products.add(payload);
        sync.broadcast('PRODUCT_SAVED', { product: { id: newId, ...payload } });
      }
      googleDriveSync.triggerOnSaleSync();
      setIsModalOpen(false);
    } catch (err) {
      alert('Kayıt sırasında hata oluştu: ' + err.message);
    }
  };

  const handleDelete = async (id, name) => {
    if (confirm(`"${name}" ürününü silmek istediğinize emin misiniz?`)) {
      await db.products.delete(id);
      sync.broadcast('PRODUCT_DELETED', { id });
      googleDriveSync.triggerOnSaleSync();
    }
  };

  const adjustStock = async (id, delta) => {
    const prod = await db.products.get(id);
    if (prod) {
      await db.products.update(id, { stock: Math.max(0, prod.stock + delta) });
      sync.broadcast('STOCK_ADJUSTED', { id, delta });
      googleDriveSync.triggerOnSaleSync();
    }
  };

  const handleExportCSV = () => {
    if (!products || products.length === 0) return;
    const headers = ['Barkod', 'Ürün Adı', 'Kategori', 'Alış Fiyatı', 'Satış Fiyatı', 'KDV %', 'Mevcut Stok', 'Birim', 'Hızlı Satış'];
    const rows = products.map(p => [
      `"${p.barcode}"`,
      `"${p.name}"`,
      `"${p.category || ''}"`,
      p.buyPrice || 0,
      p.price,
      p.taxRate || 1,
      p.stock,
      `"${p.unit}"`,
      p.isQuick ? 'Evet' : 'Hayır'
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `market_urunler_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-57px-60px)] max-w-lg mx-auto bg-slate-950 overflow-hidden">
      
      {/* Header Bar */}
      <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>Ürün & Stok Yönetimi</span>
              <span className="text-xs bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full border border-slate-700">
                {products?.length || 0} Çeşit
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="p-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:text-white transition"
              title="CSV / Excel İndir"
            >
              <Download className="w-4 h-4" />
            </button>

            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('stock')}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition"
                title="Toptancı Alış Faturası Girişi ve Stok Güncelleme Ekranı"
              >
                <Boxes className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Alış Faturası & Stok</span>
              </button>
            )}

            {hasPermission('canEditProducts') && (
              <button
                onClick={openNewModal}
                className="bg-emerald-400 hover:bg-emerald-300 text-zinc-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow-lg shadow-emerald-500/20 active:scale-95 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Yeni Ürün</span>
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ürün adı, barkod veya kategori ile arayın..."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-2.5 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Pills & Low Stock Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            onClick={() => setShowLowStockOnly(!showLowStockOnly)}
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
              showLowStockOnly
                ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900 shadow-2xs font-semibold'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Kritik Stok</span>
          </button>

          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
              selectedCategory === 'ALL'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900 shadow-2xs font-semibold'
            }`}
          >
            Tümü
          </button>

          <button
            onClick={() => setSelectedCategory(selectedCategory === 'FAVORITES' ? 'ALL' : 'FAVORITES')}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
              selectedCategory === 'FAVORITES'
                ? 'bg-amber-600 text-white border-amber-600 shadow-sm ring-1 ring-amber-500'
                : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-50 shadow-2xs font-semibold'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${selectedCategory === 'FAVORITES' ? 'fill-white text-white' : 'fill-amber-500 text-amber-500'}`} />
            <span>Favoriler</span>
            <span className={`px-1.5 py-0.2 text-[10px] rounded-md font-mono ${selectedCategory === 'FAVORITES' ? 'bg-black/25 text-white font-bold' : 'bg-amber-100 text-amber-900 font-bold'}`}>
              {products.filter(p => p.isQuick).length}
            </span>
          </button>

          <button
            onClick={() => setSelectedCategory(selectedCategory === 'KIRALAMA' ? 'ALL' : 'KIRALAMA')}
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
              selectedCategory === 'KIRALAMA'
                ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900 shadow-2xs font-semibold'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>Barkodsuz &amp; Kiralama</span>
          </button>

          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
                selectedCategory === cat
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900 shadow-2xs font-semibold'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredProducts.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Boxes className="w-12 h-12 mx-auto mb-3 opacity-30 stroke-1" />
            <p className="text-sm font-bold text-slate-700">Aradığınız kriterde ürün bulunamadı</p>
            <p className="text-xs text-slate-600 mt-1">Farklı bir arama yapabilir veya yeni ürün ekleyebilirsiniz.</p>
          </div>
        ) : (
          filteredProducts.map((prod) => {
            const isRental = prod.isNoBarcode || prod.barcode?.startsWith('BRK-') || prod.category?.toLowerCase().includes('kira') || prod.category?.toLowerCase().includes('hizmet');
            return (
              <div
                key={prod.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-2 shadow-sm hover:border-slate-700 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs font-bold text-white truncate">{prod.name}</h4>
                    <button
                      type="button"
                      onClick={(e) => toggleQuick(prod, e)}
                      className={`p-1 rounded-md transition shrink-0 ${
                        prod.isQuick
                          ? 'text-amber-500 hover:text-amber-600 bg-amber-500/15'
                          : 'text-slate-500 hover:text-amber-400 hover:bg-slate-800'
                      }`}
                      title={prod.isQuick ? 'Hızlı Butonlardan Kaldır' : 'Hızlı Butonlara Sabitle (Kasa Ekranında Tek Dokunuşla Satış)'}
                    >
                      <Star className={`w-3.5 h-3.5 ${prod.isQuick ? 'fill-amber-500 text-amber-500' : ''}`} />
                    </button>
                    {prod.isQuick && (
                      <span className="bg-emerald-500/10 text-emerald-400 text-[9px] px-1.5 py-0.2 rounded font-bold border border-emerald-500/20 shrink-0">
                        Hızlı Buton
                      </span>
                    )}
                    {isRental && (
                      <span className="bg-amber-500/15 text-amber-300 text-[9px] px-1.5 py-0.2 rounded font-bold border border-amber-500/30 shrink-0 flex items-center gap-0.5">
                        <Zap className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                        Barkodsuz / Kiralama
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400 font-mono">
                    <span>{prod.barcode}</span>
                    <span>•</span>
                    <span>{prod.category}</span>
                  </div>

                <div className="flex items-center gap-2 mt-1.5">
                  {(prod.needsPricing || !prod.price || prod.price <= 0) ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-lg flex items-center gap-1">
                        🏷️ Fiyat Bekliyor
                      </span>
                      {hasPermission('canEditProducts') && (
                        <button
                          onClick={() => openEditModal(prod)}
                          className="text-[10px] text-sky-400 hover:text-sky-300 font-bold underline"
                        >
                          Fiyat Belirle
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <span className="text-sm font-black text-emerald-400 font-mono">
                        ₺{prod.price.toFixed(2)}
                      </span>
                      {hasPermission('canViewBuyPrice') && prod.buyPrice > 0 && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          Alış: ₺{prod.buyPrice.toFixed(2)}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Stock Stepper & Status */}
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl p-1">
                  {hasPermission('canEditProducts') && (
                    <button
                      onClick={() => adjustStock(prod.id, -1)}
                      className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs active:scale-95 transition"
                    >
                      -
                    </button>
                  )}
                  <span className={`px-1.5 text-xs font-bold font-mono ${prod.stock <= 10 ? 'text-rose-400 font-black' : 'text-white'}`}>
                    {prod.stock} {prod.unit}
                  </span>
                  {hasPermission('canEditProducts') && (
                    <button
                      onClick={() => adjustStock(prod.id, 5)}
                      className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 flex items-center justify-center text-xs active:scale-95 transition"
                      title="+5 Ekle"
                    >
                      +5
                    </button>
                  )}
                </div>

                {hasPermission('canEditProducts') && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(prod)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                      title="Düzenle"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(prod.id, prod.name)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 transition"
                      title="Sil"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
      </div>

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 safe-bottom">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up">
            
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-white text-sm">
                {editingProduct ? 'Ürünü Düzenle' : 'Yeni Ürün Kartı Aç'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Barcode Field with Scan Button & Non-Barcode Toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-300">
                    Barkod Numarası {isNoBarcode ? '(Otomatik)' : '*'}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-bold text-amber-400 cursor-pointer bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20 hover:bg-amber-500/20 transition">
                    <input
                      type="checkbox"
                      checked={isNoBarcode}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsNoBarcode(checked);
                        if (checked) {
                          if (!barcode || !barcode.startsWith('BRK-')) {
                            setBarcode(`BRK-${Date.now().toString().slice(-6)}`);
                          }
                          if (category === 'Temel Gıda') setCategory('Kiralama & Hizmet');
                          setIsQuick(true);
                          if (!buyPrice) setBuyPrice('0');
                        }
                      }}
                      className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer"
                    />
                    <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
                    <span>Barkodsuz / Kiralama</span>
                  </label>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    required={!isNoBarcode}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onBlur={() => handleBarcodeBlurOrLookup()}
                    placeholder={isNoBarcode ? "Otomatik Barkodsuz Kod (Örn: BRK-123456)" : "Örn: 869000100001"}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                  {!isNoBarcode && (
                    <button
                      type="button"
                      onClick={() => setShowScanner(true)}
                      className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 active:scale-95 transition"
                    >
                      <Scan className="w-4 h-4" />
                      <span>Tara</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Product Name */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">Ürün Adı *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn: Tam Yağlı Süt 1L"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Category & Unit */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Kategori</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Örn: Süt & Kahvaltı"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Birim</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Adet">Adet</option>
                    <option value="Kg">Kg</option>
                    <option value="Paket">Paket</option>
                    <option value="Koli">Koli</option>
                    <option value="Litre">Litre</option>
                  </select>
                </div>
              </div>

              {/* Buy Price & Sale Price */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-amber-400 block mb-1">
                    Alış Fiyatı (₺) {isNoBarcode ? '(Opsiyonel)' : '*'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required={!isNoBarcode}
                    value={buyPrice}
                    onChange={(e) => setBuyPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-950 border border-amber-500/50 rounded-xl px-3 py-2 text-xs text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-emerald-400 block mb-1">Satış Fiyatı (₺) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-950 border border-emerald-500/60 rounded-xl px-3 py-2 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-400"
                  />
                </div>
              </div>

              {/* Real-time Profit Badge */}
              {price && buyPrice && (
                <div className="bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Birim Başı Kâr:</span>
                  <span className={`font-mono font-bold ${parseFloat(price) >= parseFloat(buyPrice) ? 'text-emerald-400' : 'text-rose-400'}`}>
                    ₺{(parseFloat(price) - parseFloat(buyPrice)).toFixed(2)}
                    {parseFloat(buyPrice) > 0 && ` (%${(((parseFloat(price) - parseFloat(buyPrice)) / parseFloat(buyPrice)) * 100).toFixed(0)})`}
                  </span>
                </div>
              )}

              {/* Tax Rate & Current Stock */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">KDV Oranı</label>
                  <select
                    value={taxRate}
                    onChange={(e) => setTaxRate(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="1">%1 (Temel Gıda / Ekmek)</option>
                    <option value="10">%10 (Gıda / Hizmet)</option>
                    <option value="20">%20 (Genel / Temizlik)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Mevcut Stok</label>
                  <input
                    type="number"
                    step="0.1"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Quick Pos Toggle */}
              <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-white block">Kasa Hızlı Butonlarında Göster</span>
                  <span className="text-[10px] text-slate-400">Sık satılan ürünler arasına ekler</span>
                </div>
                <input
                  type="checkbox"
                  checked={isQuick}
                  onChange={(e) => setIsQuick(e.target.checked)}
                  className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3 rounded-2xl text-sm shadow-lg shadow-emerald-500/20 active:scale-98 transition mt-2"
              >
                {editingProduct ? 'Değişiklikleri Kaydet' : 'Ürünü Kaydet'}
              </button>
            </form>

          </div>
        </div>
      )}

      {/* Barcode Scanner Modal for autofilling barcode */}
      {showScanner && (
        <BarcodeScanner
          onScan={(code) => {
            setBarcode(code);
            handleBarcodeBlurOrLookup(code);
            setShowScanner(false);
          }}
          onClose={() => setShowScanner(false)}
          continuous={false}
        />
      )}

    </div>
  );
}
