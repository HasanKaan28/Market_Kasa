import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, Plus, Trash2, Scan, CheckCircle2, ArrowRight, 
  Boxes, DollarSign, Calendar, Building2, Upload, Download, 
  RotateCcw, Sparkles, Printer, FileSpreadsheet, AlertTriangle, 
  Search, X, Check, CreditCard, Banknote, Clock, History, HelpCircle
} from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { playBarcodeBeep, playErrorBeep, playCashRegisterSound } from '../utils/sound';
import BarcodeScanner from './BarcodeScanner';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';
import { lookupBarcodeInCatalogOrOnline } from '../data/barcodeCatalog';
import { jsPDF } from 'jspdf';
import { useAuth } from '../context/AuthContext';

export default function PurchaseInvoiceView({ onNavigate, onOpenPayments }) {
  const { currentUser } = useAuth();

  // Active View Tab: 'new' (Yeni Alış Faturası Girişi) | 'history' (Geçmiş Faturalar)
  const [activeTab, setActiveTab] = useState('new');

  // Supplier & Invoice Header Data
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' | 'card' | 'debt'
  const [invoiceNotes, setInvoiceNotes] = useState('');

  // Row Input States (Fast Barcode Line Adder)
  const [barcodeInput, setBarcodeInput] = useState('');
  const [rowQuantity, setRowQuantity] = useState(1);
  const [rowBuyPrice, setRowBuyPrice] = useState('');
  const [rowSellPrice, setRowSellPrice] = useState('');
  const [rowName, setRowName] = useState('');
  const [rowTaxRate, setRowTaxRate] = useState(1);
  const [rowCategory, setRowCategory] = useState('Genel');
  const [matchedProduct, setMatchedProduct] = useState(null);
  const [isNewProduct, setIsNewProduct] = useState(false);

  // Line items currently on the invoice table
  const [invoiceItems, setInvoiceItems] = useState([]);

  // UI States
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [successModal, setSuccessModal] = useState(null); // Saved invoice details
  const [selectedHistoryInvoice, setSelectedHistoryInvoice] = useState(null);
  const [historySearch, setHistorySearch] = useState('');
  const [isSearchingBarcode, setIsSearchingBarcode] = useState(false);

  // References for fast keyboard navigation
  const barcodeInputRef = useRef(null);
  const quantityInputRef = useRef(null);
  const buyPriceInputRef = useRef(null);
  const sellPriceInputRef = useRef(null);
  const nameInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Live queries
  const allDbProducts = useLiveQuery(() => db.products.toArray(), []) || [];
  const products = useMemo(() => allDbProducts.filter(p => !p.needsPricing && p.price > 0), [allDbProducts]);
  const pastInvoices = useLiveQuery(() => db.purchaseInvoices ? db.purchaseInvoices.reverse().toArray() : [], []) || [];

  // Unique past suppliers for instant autocomplete/quick pick
  const pastSuppliers = useMemo(() => {
    const set = new Set();
    pastInvoices.forEach(inv => {
      if (inv.supplierName) set.add(inv.supplierName.trim());
    });
    return Array.from(set);
  }, [pastInvoices]);

  // Auto focus barcode input on mount or when activeTab changes
  useEffect(() => {
    if (activeTab === 'new' && barcodeInputRef.current) {
      setTimeout(() => barcodeInputRef.current?.focus(), 100);
    }
  }, [activeTab]);

  // Lookup product when barcode input changes or Enter is pressed
  const handleBarcodeLookup = async (code) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;

    setIsSearchingBarcode(true);
    // 1. Önce yerel veritabanında ara
    const found = products.find(p => p.barcode === cleanCode) || await db.products.where('barcode').equals(cleanCode).first();
    
    if (found) {
      playBarcodeBeep();
      setMatchedProduct(found);
      setIsNewProduct(false);
      setRowName(found.name);
      setRowBuyPrice(found.buyPrice > 0 ? found.buyPrice.toString() : '');
      setRowSellPrice(found.price > 0 ? found.price.toString() : '');
      setRowTaxRate(found.taxRate || 1);
      setRowCategory(found.category || 'Genel');
      setIsSearchingBarcode(false);

      // Focus directly to quantity input
      setTimeout(() => {
        quantityInputRef.current?.focus();
        quantityInputRef.current?.select();
      }, 50);
      return;
    }

    // 2. Yerel veritabanında yoksa online / hazır katalogda ara
    try {
      const catalogResult = await lookupBarcodeInCatalogOrOnline(cleanCode);
      if (catalogResult) {
        playBarcodeBeep();
        setMatchedProduct(null);
        setIsNewProduct(true);
        setRowName(catalogResult.name || '');
        setRowBuyPrice('');
        setRowSellPrice('');
        setRowTaxRate(catalogResult.taxRate || 1);
        setRowCategory(catalogResult.category || 'Genel');
        setIsSearchingBarcode(false);

        setTimeout(() => {
          quantityInputRef.current?.focus();
          quantityInputRef.current?.select();
        }, 50);
        return;
      }
    } catch (err) {
      console.warn('Barkod katalog sorgusu:', err);
    }

    // 3. Hiçbir yerde yoksa: Sıfırdan yeni ürün girişi
    playBarcodeBeep();
    setMatchedProduct(null);
    setIsNewProduct(true);
    setRowName('');
    setRowBuyPrice('');
    setRowSellPrice('');
    setRowTaxRate(1);
    setRowCategory('Genel');
    setIsSearchingBarcode(false);

    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 50);
  };

  // Add Item to Invoice Table
  const handleAddRow = (e) => {
    if (e) e.preventDefault();

    const cleanBarcode = barcodeInput.trim();
    const cleanName = rowName.trim();
    const qty = Math.max(1, parseInt(rowQuantity) || 1);
    const buyP = parseFloat(rowBuyPrice) || 0;
    const sellP = parseFloat(rowSellPrice) || (buyP > 0 ? Math.round(buyP * 1.35 * 100) / 100 : 0);

    if (!cleanBarcode) {
      alert('Lütfen barkod okutun veya girin.');
      barcodeInputRef.current?.focus();
      return;
    }

    if (!cleanName) {
      alert('Lütfen ürün adını girin.');
      nameInputRef.current?.focus();
      return;
    }

    if (buyP <= 0) {
      alert('Lütfen geçerli bir birim alış fiyatı girin.');
      buyPriceInputRef.current?.focus();
      return;
    }

    // Check if already in invoice table -> update quantity
    const existingIndex = invoiceItems.findIndex(it => it.barcode === cleanBarcode);
    if (existingIndex > -1) {
      const updated = [...invoiceItems];
      const newQty = updated[existingIndex].quantity + qty;
      const currentStock = updated[existingIndex].currentStock || 0;
      updated[existingIndex] = {
        ...updated[existingIndex],
        quantity: newQty,
        buyPrice: buyP,
        sellPrice: sellP,
        totalBuy: newQty * buyP,
        newStock: currentStock + newQty
      };
      setInvoiceItems(updated);
    } else {
      const currentStock = matchedProduct?.stock || 0;
      const newItem = {
        id: matchedProduct?.id || null,
        barcode: cleanBarcode,
        name: cleanName,
        category: rowCategory || 'Genel',
        quantity: qty,
        buyPrice: buyP,
        sellPrice: sellP,
        totalBuy: qty * buyP,
        taxRate: parseInt(rowTaxRate) || 1,
        currentStock: currentStock,
        newStock: currentStock + qty,
        unit: matchedProduct?.unit || 'Adet',
        isNew: isNewProduct || !matchedProduct
      };
      setInvoiceItems(prev => [newItem, ...prev]);
    }

    playBarcodeBeep();

    // Reset row inputs
    setBarcodeInput('');
    setRowQuantity(1);
    setRowBuyPrice('');
    setRowSellPrice('');
    setRowName('');
    setMatchedProduct(null);
    setIsNewProduct(false);

    // Refocus barcode input for continuous super-fast scanning
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 50);
  };

  // Remove row from table
  const handleRemoveRow = (index) => {
    setInvoiceItems(prev => prev.filter((_, idx) => idx !== index));
  };

  // Inline update in table (quantity, buy price, sell price)
  const handleUpdateItem = (index, field, value) => {
    setInvoiceItems(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };

      if (field === 'quantity') {
        const val = Math.max(1, parseInt(value) || 1);
        item.quantity = val;
        item.totalBuy = val * item.buyPrice;
        item.newStock = (item.currentStock || 0) + val;
      } else if (field === 'buyPrice') {
        const val = Math.max(0, parseFloat(value) || 0);
        item.buyPrice = val;
        item.totalBuy = item.quantity * val;
      } else if (field === 'sellPrice') {
        item.sellPrice = Math.max(0, parseFloat(value) || 0);
      }
      updated[index] = item;
      return updated;
    });
  };

  // Financial Totals calculation
  const invoiceTotals = useMemo(() => {
    let grandTotal = 0;
    let subtotal = 0;
    let taxTotal = 0;
    const taxTiers = {
      1: { matrah: 0, tax: 0 },
      10: { matrah: 0, tax: 0 },
      20: { matrah: 0, tax: 0 }
    };

    invoiceItems.forEach(item => {
      const total = item.totalBuy || 0;
      grandTotal += total;
      const rate = item.taxRate || 1;
      const matrah = total / (1 + rate / 100);
      const tax = total - matrah;

      subtotal += matrah;
      taxTotal += tax;

      if (taxTiers[rate]) {
        taxTiers[rate].matrah += matrah;
        taxTiers[rate].tax += tax;
      }
    });

    const totalQty = invoiceItems.reduce((s, i) => s + i.quantity, 0);

    return {
      grandTotal,
      subtotal,
      taxTotal,
      taxTiers,
      totalQty,
      itemCount: invoiceItems.length
    };
  }, [invoiceItems]);

  // Excel / CSV File Import Parser
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result || '');
        const lines = text.split(/\r\n|\n/).filter(l => l.trim().length > 0);
        if (lines.length <= 1) {
          alert('Dosyada geçerli satır bulunamadı.');
          return;
        }

        const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
        const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

        // Detect column indices
        const barcodeIdx = headers.findIndex(h => h.includes('barkod') || h.includes('barcode') || h.includes('ean') || h.includes('kod'));
        const nameIdx = headers.findIndex(h => h.includes('ad') || h.includes('urun') || h.includes('isim') || h.includes('name') || h.includes('tanim'));
        const qtyIdx = headers.findIndex(h => h.includes('adet') || h.includes('miktar') || h.includes('qty') || h.includes('quantity'));
        const buyPriceIdx = headers.findIndex(h => h.includes('alis') || h.includes('fiyat') || h.includes('maliyet') || h.includes('buy'));
        const sellPriceIdx = headers.findIndex(h => h.includes('satis') || h.includes('perakende') || h.includes('price') || h.includes('sell'));
        const taxIdx = headers.findIndex(h => h.includes('kdv') || h.includes('tax'));

        if (barcodeIdx === -1 && nameIdx === -1) {
          alert('Excel/CSV dosyasında "Barkod" veya "Ürün Adı" sütunu tespit edilemedi.');
          return;
        }

        const importedRows = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
          if (cols.length < 2) continue;

          const barcode = barcodeIdx > -1 ? cols[barcodeIdx] : `IMP-${Date.now()}-${i}`;
          const name = nameIdx > -1 ? cols[nameIdx] : `Ürün #${i}`;
          const qty = qtyIdx > -1 ? Math.max(1, parseInt(cols[qtyIdx]) || 1) : 1;
          const buyP = buyPriceIdx > -1 ? parseFloat(cols[buyPriceIdx].replace(',', '.')) || 0 : 0;
          const sellP = sellPriceIdx > -1 ? parseFloat(cols[sellPriceIdx].replace(',', '.')) || (buyP * 1.35) : (buyP * 1.35);
          const tax = taxIdx > -1 ? parseInt(cols[taxIdx]) || 1 : 1;

          if (!barcode && !name) continue;

          // Check if exists in db
          const existingProd = products.find(p => p.barcode === barcode);
          const currentStock = existingProd?.stock || 0;

          importedRows.push({
            id: existingProd?.id || null,
            barcode: barcode || (existingProd ? existingProd.barcode : `IMP-${i}`),
            name: name || existingProd?.name || 'Yeni Ürün',
            category: existingProd?.category || 'Genel',
            quantity: qty,
            buyPrice: buyP || existingProd?.buyPrice || 0,
            sellPrice: sellP || existingProd?.price || (buyP * 1.35),
            totalBuy: qty * (buyP || existingProd?.buyPrice || 0),
            taxRate: tax,
            currentStock: currentStock,
            newStock: currentStock + qty,
            unit: existingProd?.unit || 'Adet',
            isNew: !existingProd
          });
        }

        if (importedRows.length > 0) {
          setInvoiceItems(prev => [...importedRows, ...prev]);
          playCashRegisterSound();
          alert(`✅ ${importedRows.length} adet fatura kalemi başarıyla yüklendi!`);
        } else {
          alert('Dosyadan veri okunamadı. Lütfen CSV/Excel formatını kontrol edin.');
        }
      } catch (err) {
        console.error('CSV import hatası:', err);
        alert('Dosya okunurken hata oluştu: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Submit & Save Purchase Invoice to DB and Update Stocks
  const handleSaveInvoice = async () => {
    if (invoiceItems.length === 0) {
      alert('Lütfen faturaya en az 1 ürün kalemi ekleyin.');
      return;
    }

    const now = new Date();
    const finalSupplier = supplierName.trim() || 'Genel Toptancı';
    const finalInvoiceNo = invoiceNo.trim() || `ALIS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Date.now().toString().slice(-4)}`;

    try {
      // 1. Ürünlerin stoklarını ve fiyatlarını güncelle
      for (const item of invoiceItems) {
        if (item.id) {
          // Mevcut ürün -> stok artır, alış fiyatını güncelle, satış fiyatı girilmişse güncelle
          const currentProd = await db.products.get(item.id);
          if (currentProd) {
            const newStock = (currentProd.stock || 0) + item.quantity;
            await db.products.update(item.id, {
              stock: newStock,
              buyPrice: item.buyPrice > 0 ? item.buyPrice : currentProd.buyPrice,
              price: item.sellPrice > 0 ? item.sellPrice : currentProd.price,
              updatedAt: now.toISOString()
            });
          }
        } else {
          // Yeni ürün -> doğrudan veritabanına ekle
          const existingByBarcode = await db.products.where('barcode').equals(item.barcode).first();
          if (existingByBarcode) {
            const newStock = (existingByBarcode.stock || 0) + item.quantity;
            await db.products.update(existingByBarcode.id, {
              stock: newStock,
              buyPrice: item.buyPrice > 0 ? item.buyPrice : existingByBarcode.buyPrice,
              price: item.sellPrice > 0 ? item.sellPrice : existingByBarcode.price,
              updatedAt: now.toISOString()
            });
          } else {
            await db.products.add({
              barcode: item.barcode,
              name: item.name,
              category: item.category || 'Genel',
              price: item.sellPrice > 0 ? item.sellPrice : (item.buyPrice * 1.35),
              buyPrice: item.buyPrice,
              taxRate: parseInt(item.taxRate) || 1,
              stock: item.quantity,
              unit: item.unit || 'Adet',
              needsPricing: false,
              isQuick: false,
              color: '#3b82f6',
              updatedAt: now.toISOString()
            });
          }
        }
      }

      // 2. Alış Faturasını veritabanına kaydet
      const invoiceRecord = {
        invoiceNo: finalInvoiceNo,
        supplierName: finalSupplier,
        date: invoiceDate,
        createdAt: now.toISOString(),
        items: invoiceItems,
        itemCount: invoiceItems.length,
        totalQuantity: invoiceTotals.totalQty,
        subtotal: invoiceTotals.subtotal,
        taxTotal: invoiceTotals.taxTotal,
        taxTiers: invoiceTotals.taxTiers,
        grandTotal: invoiceTotals.grandTotal,
        paymentMethod: paymentMethod,
        notes: invoiceNotes.trim(),
        createdBy: currentUser?.name || 'Kasiyer'
      };

      if (db.purchaseInvoices) {
        const id = await db.purchaseInvoices.add(invoiceRecord);
        invoiceRecord.id = id;
      }

      // 3. Eşitleme yayınla
      sync.broadcast('STOCK_RESTOCKED', {
        invoiceNo: finalInvoiceNo,
        supplierName: finalSupplier,
        totalQuantity: invoiceTotals.totalQty
      });
      googleDriveSync.triggerOnSaleSync();

      playCashRegisterSound();

      // Show Success Modal with Printable Receipt & Export options
      setSuccessModal({
        ...invoiceRecord,
        savedTime: now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
      });

      // Clear Form
      setInvoiceItems([]);
      setInvoiceNo('');
      setSupplierName('');
      setInvoiceNotes('');
    } catch (err) {
      console.error('Alış faturası kaydetme hatası:', err);
      playErrorBeep();
      alert('Fatura kaydedilirken hata oluştu: ' + err.message);
    }
  };

  // Download PDF Report for Purchase Invoice
  const handleDownloadPDF = (invoice) => {
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      doc.setFont('courier', 'bold');
      doc.setFontSize(16);
      doc.text('MAL KABUL & TOPTANCI ALIŞ FATURASI', 105, 18, { align: 'center' });

      doc.setFontSize(10);
      doc.setFont('courier', 'normal');
      doc.text(`Tedarikçi / Toptancı : ${invoice.supplierName || 'Genel Toptancı'}`, 15, 28);
      doc.text(`Fatura / İrsaliye No: ${invoice.invoiceNo}`, 15, 33);
      doc.text(`Fatura Tarihi      : ${new Date(invoice.date).toLocaleDateString('tr-TR')}`, 15, 38);
      doc.text(`Ödeme Yöntemi      : ${invoice.paymentMethod === 'cash' ? 'Nakit Ödendi' : invoice.paymentMethod === 'card' ? 'Kredi Kartı' : 'Veresiye / Açık Hesap'}`, 15, 43);

      doc.text(`Kayıt Tarihi       : ${new Date(invoice.createdAt).toLocaleString('tr-TR')}`, 120, 28);
      doc.text(`İşlemi Yapan       : ${invoice.createdBy || 'Kasiyer'}`, 120, 33);
      doc.text(`Toplam Kalem       : ${invoice.items?.length || 0} Çeşit`, 120, 38);
      doc.text(`Toplam Adet        : ${invoice.totalQuantity || 0} Adet`, 120, 43);

      doc.line(15, 47, 195, 47);

      // Table Header
      let y = 54;
      doc.setFont('courier', 'bold');
      doc.setFontSize(9);
      doc.text('#', 15, y);
      doc.text('Barkod', 22, y);
      doc.text('Ürün Adı', 60, y);
      doc.text('Adet', 125, y, { align: 'right' });
      doc.text('Alış F.', 145, y, { align: 'right' });
      doc.text('Satış F.', 168, y, { align: 'right' });
      doc.text('Toplam (₺)', 195, y, { align: 'right' });

      doc.line(15, y + 2, 195, y + 2);
      y += 6;

      doc.setFont('courier', 'normal');
      (invoice.items || []).forEach((item, index) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text((index + 1).toString(), 15, y);
        doc.text((item.barcode || '').substring(0, 16), 22, y);
        doc.text((item.name || '').substring(0, 28), 60, y);
        doc.text(`${item.quantity} ${item.unit || 'Adet'}`, 125, y, { align: 'right' });
        doc.text(`₺${(item.buyPrice || 0).toFixed(2)}`, 145, y, { align: 'right' });
        doc.text(`₺${(item.sellPrice || 0).toFixed(2)}`, 168, y, { align: 'right' });
        doc.text(`₺${(item.totalBuy || (item.quantity * item.buyPrice)).toFixed(2)}`, 195, y, { align: 'right' });
        y += 5.5;
      });

      doc.line(15, y, 195, y);
      y += 6;

      // Summary
      doc.setFont('courier', 'bold');
      doc.text(`GENEL ALIŞ TOPLAMI: ₺${(invoice.grandTotal || 0).toFixed(2)}`, 195, y, { align: 'right' });
      y += 5;
      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      doc.text(`Matrah: ₺${(invoice.subtotal || 0).toFixed(2)}  |  KDV Toplamı: ₺${(invoice.taxTotal || 0).toFixed(2)}`, 195, y, { align: 'right' });

      doc.save(`AlisFaturasi-${invoice.invoiceNo}.pdf`);
    } catch (err) {
      console.error('PDF oluşturma hatası:', err);
    }
  };

  // Export Invoice Items to CSV
  const handleExportCSV = (invoice) => {
    const items = invoice.items || [];
    if (items.length === 0) return;

    const headers = ['Sıra', 'Barkod', 'Ürün Adı', 'Miktar', 'Birim', 'Alış Fiyatı (₺)', 'Satış Fiyatı (₺)', 'KDV %', 'Toplam Alış (₺)'];
    const rows = items.map((it, idx) => [
      idx + 1,
      `"${it.barcode}"`,
      `"${it.name}"`,
      it.quantity,
      `"${it.unit || 'Adet'}"`,
      it.buyPrice,
      it.sellPrice,
      it.taxRate || 1,
      it.totalBuy || (it.quantity * it.buyPrice)
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Alis_Faturasi_${invoice.invoiceNo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered History Invoices
  const filteredHistory = useMemo(() => {
    if (!pastInvoices) return [];
    if (!historySearch.trim()) return pastInvoices;
    const q = historySearch.toLowerCase().trim();
    return pastInvoices.filter(inv => 
      inv.invoiceNo?.toLowerCase().includes(q) ||
      inv.supplierName?.toLowerCase().includes(q) ||
      inv.createdBy?.toLowerCase().includes(q) ||
      inv.grandTotal?.toString().includes(q)
    );
  }, [pastInvoices, historySearch]);

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto bg-slate-950 text-slate-100 overflow-hidden relative">
      
      {/* ================= TOP NAVIGATION BAR ================= */}
      <div className="shrink-0 p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
              <span>Toptancı Alış Faturası Girişi</span>
              <span className="text-[11px] bg-blue-500/20 text-blue-300 font-mono px-2 py-0.5 rounded-full border border-blue-500/30">
                Otomatik Stok Yükleme
              </span>
            </h2>
            <p className="text-xs text-slate-400 hidden sm:block">
              Toptancıdan gelen faturayı hızlıca okutun; stoklar anında artsın ve maliyetler güncellensin.
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('new')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              activeTab === 'new'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Yeni Fatura</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Geçmiş Faturalar ({pastInvoices.length})</span>
          </button>
          {onOpenPayments && (
            <button
              type="button"
              onClick={onOpenPayments}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-300"
              title="Toptancı Ödemeleri ve Cari Hesap Ekranına Git"
            >
              <Banknote className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Toptancı Ödemeleri</span>
            </button>
          )}
        </div>
      </div>

      {/* ================= TAB 1: YENİ ALIŞ FATURASI GİRİŞİ ================= */}
      {activeTab === 'new' && (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 p-3 overflow-hidden">
          
          {/* LEFT / TOP: FAST INPUT PANEL */}
          <div className="w-full lg:w-96 xl:w-[420px] shrink-0 flex flex-col gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 overflow-y-auto shadow-xl">
            
            {/* Header: Supplier & Invoice No */}
            <div className="space-y-2.5 pb-3 border-b border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-blue-400 tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Tedarikçi & Fatura Bilgileri</span>
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Adım 1</span>
              </div>

              {/* Supplier autocomplete */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">Toptancı / Tedarikçi Adı *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="Örn: Metro Toptan, Eti Dağıtım, Hal..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                  />
                  {supplierName && (
                    <button onClick={() => setSupplierName('')} className="absolute right-2.5 top-2.5 text-slate-500 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Quick Supplier Chips */}
                {pastSuppliers.length > 0 && !supplierName && (
                  <div className="flex items-center gap-1 mt-1.5 overflow-x-auto no-scrollbar">
                    <span className="text-[10px] text-slate-500 shrink-0">Son:</span>
                    {pastSuppliers.slice(0, 4).map((sup, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSupplierName(sup)}
                        className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700 shrink-0 transition"
                      >
                        {sup}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Invoice No & Date */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Fatura / İrsaliye No</label>
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder="Örn: FAT-2026-01"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Fatura Tarihi</label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Payment Method Selector */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">Fatura Ödeme Durumu</label>
                <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`py-1.5 rounded-lg transition flex items-center justify-center gap-1 ${
                      paymentMethod === 'cash' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Banknote className="w-3.5 h-3.5" />
                    <span>Nakit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className={`py-1.5 rounded-lg transition flex items-center justify-center gap-1 ${
                      paymentMethod === 'card' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Kart/Havale</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('debt')}
                    className={`py-1.5 rounded-lg transition flex items-center justify-center gap-1 ${
                      paymentMethod === 'debt' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Vadeli/Açık</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2: Ultra-Fast Product Row Entry */}
            <form onSubmit={handleAddRow} className="space-y-2.5 flex-1 flex flex-col justify-between">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-emerald-400 tracking-wider flex items-center gap-1.5">
                    <Scan className="w-3.5 h-3.5" />
                    <span>Hızlı Kalem Okut / Ekle</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Adım 2</span>
                </div>

                {/* Barcode scanner & search input */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-300">Barkod *</label>
                    <button
                      type="button"
                      onClick={() => setShowCameraScanner(true)}
                      className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
                    >
                      <Scan className="w-3 h-3" />
                      <span>Kamera</span>
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      ref={barcodeInputRef}
                      type="text"
                      value={barcodeInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBarcodeInput(val);
                        if (val.trim().length >= 8) {
                          handleBarcodeLookup(val);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (barcodeInput.trim()) {
                            handleBarcodeLookup(barcodeInput);
                          }
                        }
                      }}
                      placeholder="Barkodu okutun veya yazın..."
                      className="w-full bg-slate-950 border-2 border-emerald-500/60 focus:border-emerald-400 rounded-xl pl-8 pr-8 py-2 text-xs text-emerald-300 font-mono font-bold placeholder-slate-500 focus:outline-none shadow-inner tracking-wider"
                    />
                    <Scan className="w-3.5 h-3.5 text-emerald-400 absolute left-2.5 top-2.5" />
                    {barcodeInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setBarcodeInput('');
                          setMatchedProduct(null);
                          setRowName('');
                          setRowBuyPrice('');
                          setRowSellPrice('');
                          barcodeInputRef.current?.focus();
                        }}
                        className="absolute right-2.5 top-2.5 text-slate-500 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Product Name */}
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Ürün Adı *</label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    required
                    value={rowName}
                    onChange={(e) => setRowName(e.target.value)}
                    placeholder="Ürün adı..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-semibold"
                  />
                  {matchedProduct && (
                    <p className="text-[10px] text-emerald-400 font-mono mt-0.5">
                      ✓ Sistemde Kayıtlı (Mevcut Stok: {matchedProduct.stock} {matchedProduct.unit || 'Adet'})
                    </p>
                  )}
                  {isNewProduct && (
                    <p className="text-[10px] text-amber-400 font-mono mt-0.5">
                      ★ Yeni Ürün (Faturayla birlikte otomatik sisteme kaydedilecek)
                    </p>
                  )}
                </div>

                {/* Quantity & Quick Pack Buttons */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-300">Fatura Giriş Adedi *</label>
                    <span className="text-[10px] text-slate-400">Koli Çarpanları:</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={quantityInputRef}
                      type="number"
                      min="1"
                      required
                      value={rowQuantity}
                      onChange={(e) => setRowQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          buyPriceInputRef.current?.focus();
                          buyPriceInputRef.current?.select();
                        }
                      }}
                      className="w-24 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-center text-sm font-mono font-black text-white focus:outline-none"
                    />
                    {/* Quick Presets */}
                    <div className="flex items-center gap-1 flex-1">
                      {[6, 12, 24, 48].map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setRowQuantity(q)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${
                            rowQuantity === q
                              ? 'bg-blue-600 text-white border-blue-500'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800'
                          }`}
                        >
                          +{q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Prices (Buy Price & Shelf Sell Price) */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-amber-400 block mb-1">Birim Alış (₺) *</label>
                    <input
                      ref={buyPriceInputRef}
                      type="number"
                      step="0.01"
                      required
                      value={rowBuyPrice}
                      onChange={(e) => setRowBuyPrice(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (rowSellPrice) {
                            handleAddRow();
                          } else {
                            sellPriceInputRef.current?.focus();
                          }
                        }
                      }}
                      placeholder="0.00"
                      className="w-full bg-slate-950 border border-amber-500/50 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-amber-300 font-mono font-bold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-emerald-400 block mb-1">Raf Satış (₺)</label>
                    <input
                      ref={sellPriceInputRef}
                      type="number"
                      step="0.01"
                      value={rowSellPrice}
                      onChange={(e) => setRowSellPrice(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddRow();
                        }
                      }}
                      placeholder="0.00"
                      className="w-full bg-slate-950 border border-emerald-500/50 focus:border-emerald-400 rounded-xl px-3 py-2 text-xs text-emerald-300 font-mono font-bold focus:outline-none"
                    />
                  </div>
                </div>

                {/* Profit Margin Preview & Tax Rate */}
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-slate-400">KDV Oranı:</span>
                    <select
                      value={rowTaxRate}
                      onChange={(e) => setRowTaxRate(parseInt(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 mt-0.5"
                    >
                      <option value="1">%1 Gıda</option>
                      <option value="10">%10 Temel</option>
                      <option value="20">%20 Standart</option>
                    </select>
                  </div>
                  <div>
                    <span className="text-slate-400">Tahmini Kâr:</span>
                    <div className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 mt-0.5 font-mono">
                      {parseFloat(rowBuyPrice) > 0 && parseFloat(rowSellPrice) > 0 ? (
                        <span className={parseFloat(rowSellPrice) >= parseFloat(rowBuyPrice) ? 'text-emerald-400 font-bold' : 'text-rose-400'}>
                          %{(((parseFloat(rowSellPrice) - parseFloat(rowBuyPrice)) / parseFloat(rowBuyPrice)) * 100).toFixed(0)} Kâr
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Add Button */}
              <button
                type="submit"
                className="w-full mt-2 bg-emerald-500 hover:bg-emerald-400 active:scale-98 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20 transition"
              >
                <Plus className="w-4 h-4" />
                <span>Kalemi Faturaya Ekle (Enter)</span>
              </button>
            </form>
          </div>

          {/* RIGHT / MAIN: INVOICE TABLE & SUMMARY */}
          <div className="flex-1 min-h-0 flex flex-col bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            
            {/* Table Header Action Bar */}
            <div className="shrink-0 p-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase text-white tracking-wider">
                  Fatura Kalemleri ({invoiceItems.length})
                </span>
                {invoiceTotals.totalQty > 0 && (
                  <span className="text-xs bg-slate-800 text-slate-300 font-mono px-2 py-0.5 rounded-full border border-slate-700">
                    Toplam {invoiceTotals.totalQty} Adet Ürün
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Excel / CSV Import Trigger */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white px-2.5 py-1.5 rounded-xl text-xs font-bold border border-slate-700 transition flex items-center gap-1.5 active:scale-95"
                  title="Toptancıdan gelen Excel veya CSV faturasını otomatik yükle"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-400" />
                  <span>Excel / CSV Yükle</span>
                </button>

                {invoiceItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Faturadaki tüm ürünler temizlensin mi?')) {
                        setInvoiceItems([]);
                      }
                    }}
                    className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-1.5 rounded-xl text-xs font-bold transition"
                  >
                    Temizle
                  </button>
                )}
              </div>
            </div>

            {/* Items Table */}
            <div className="flex-1 overflow-y-auto p-2 overscroll-contain">
              {invoiceItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500 space-y-3">
                  <div className="w-16 h-16 rounded-3xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-600 shadow-inner">
                    <Boxes className="w-8 h-8 stroke-1 text-blue-400/60" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-300">Henüz Fatura Kalemi Eklenmedi</h4>
                    <p className="text-xs text-slate-500 max-w-sm mt-1">
                      Soldaki formdan barkod okutarak hızlıca ürün ekleyebilir ya da üstteki <strong>"Excel / CSV Yükle"</strong> butonuyla toptancı dosyasını anında içeri alabilirsiniz.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {invoiceItems.map((item, index) => (
                    <div
                      key={index}
                      className="bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-2.5 flex items-center justify-between gap-3 transition"
                    >
                      {/* Left: Index & Name */}
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="w-6 h-6 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-white truncate">
                              {item.name}
                            </span>
                            {item.isNew && (
                              <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1 rounded font-bold">
                                YENİ
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                            <span>{item.barcode}</span>
                            <span>•</span>
                            <span className="text-blue-400">
                              Stok: {item.currentStock} ➔ <strong className="text-emerald-400">{item.newStock}</strong>
                            </span>
                            <span>•</span>
                            <span>KDV %{item.taxRate}</span>
                          </div>
                        </div>
                      </div>

                      {/* Middle & Right: Inputs & Total */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Quantity input */}
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 hidden sm:inline">Adet:</span>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleUpdateItem(index, 'quantity', e.target.value)}
                            className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-1 text-center text-xs font-mono font-bold text-white focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        {/* Buy Price input */}
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-amber-400 hidden sm:inline">Alış:</span>
                          <input
                            type="number"
                            step="0.01"
                            value={item.buyPrice}
                            onChange={(e) => handleUpdateItem(index, 'buyPrice', e.target.value)}
                            className="w-20 bg-slate-900 border border-amber-500/40 rounded-lg px-1.5 py-1 text-right text-xs font-mono font-bold text-amber-300 focus:outline-none focus:border-amber-400"
                          />
                        </div>

                        {/* Shelf Price input */}
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-emerald-400 hidden sm:inline">Satış:</span>
                          <input
                            type="number"
                            step="0.01"
                            value={item.sellPrice}
                            onChange={(e) => handleUpdateItem(index, 'sellPrice', e.target.value)}
                            className="w-20 bg-slate-900 border border-emerald-500/40 rounded-lg px-1.5 py-1 text-right text-xs font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
                          />
                        </div>

                        {/* Total Buy Amount */}
                        <div className="w-24 text-right">
                          <span className="text-xs font-mono font-black text-white block">
                            ₺{item.totalBuy.toFixed(2)}
                          </span>
                        </div>

                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(index)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition"
                          title="Kalemi Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Invoice Footer: Financial Summary & Final Save Button */}
            <div className="shrink-0 p-3 bg-slate-950 border-t border-slate-800 space-y-3">
              
              {/* Financial Breakdown Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-2">
                  <span className="text-[10px] text-slate-400 block font-medium">Toplam Kalem & Adet</span>
                  <span className="font-mono font-black text-white text-sm">
                    {invoiceTotals.itemCount} Kalem / {invoiceTotals.totalQty} Adet
                  </span>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-2">
                  <span className="text-[10px] text-slate-400 block font-medium">Ara Toplam (Matrah)</span>
                  <span className="font-mono font-black text-slate-300 text-sm">
                    ₺{invoiceTotals.subtotal.toFixed(2)}
                  </span>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-2">
                  <span className="text-[10px] text-slate-400 block font-medium">KDV Toplamı</span>
                  <span className="font-mono font-black text-amber-400 text-sm">
                    ₺{invoiceTotals.taxTotal.toFixed(2)}
                  </span>
                </div>

                <div className="bg-blue-950/40 border-2 border-blue-500/60 rounded-xl p-2">
                  <span className="text-[10px] text-blue-300 block font-black uppercase">Fatura Genel Toplamı</span>
                  <span className="font-mono font-black text-white text-base">
                    ₺{invoiceTotals.grandTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Confirm & Save Button */}
              <button
                type="button"
                onClick={handleSaveInvoice}
                disabled={invoiceItems.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-35 text-white font-black py-3 px-4 rounded-xl flex items-center justify-between shadow-xl shadow-blue-600/25 active:scale-98 transition"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                  <span className="text-sm font-bold">Faturayı Onayla & Tüm Ürün Stoklarını Sisteme İşle</span>
                </div>
                <div className="text-lg font-mono font-black">
                  ₺{invoiceTotals.grandTotal.toFixed(2)}
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: GEÇMİŞ ALIŞ FATURALARI ================= */}
      {activeTab === 'history' && (
        <div className="flex-1 min-h-0 flex flex-col p-3 overflow-hidden">
          
          {/* Search Bar */}
          <div className="shrink-0 mb-3 bg-slate-900 border border-slate-800 rounded-2xl p-2.5 flex items-center justify-between gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Fatura no, toptancı adı veya tutar ile arayın..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
              />
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              {historySearch && (
                <button onClick={() => setHistorySearch('')} className="absolute right-3 top-2.5 text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <span className="text-xs font-mono text-slate-400 font-bold shrink-0">
              {filteredHistory.length} Fatura
            </span>
          </div>

          {/* Invoices List */}
          <div className="flex-1 overflow-y-auto space-y-2 overscroll-contain">
            {filteredHistory.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
                <FileText className="w-12 h-12 stroke-1 mb-2 text-slate-600" />
                <p className="text-sm font-bold text-slate-300">Kayıtlı Alış Faturası Bulunamadı</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  "Yeni Fatura" sekmesinden toptancı faturalarınızı girdiğinizde burada listelenecektir.
                </p>
              </div>
            ) : (
              filteredHistory.map((inv) => (
                <div
                  key={inv.id || inv.invoiceNo}
                  className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-3.5 flex items-center justify-between gap-3 transition shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold font-mono text-white">
                        #{inv.invoiceNo}
                      </span>
                      <span className="text-xs font-bold text-blue-300 bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 rounded-full">
                        {inv.supplierName}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        inv.paymentMethod === 'cash'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : inv.paymentMethod === 'card'
                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}>
                        {inv.paymentMethod === 'cash' ? 'Nakit Ödendi' : inv.paymentMethod === 'card' ? 'Kart / Havale' : 'Vadeli / Açık'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-1">
                      <span>Fatura Tarihi: {new Date(inv.date).toLocaleDateString('tr-TR')}</span>
                      <span>•</span>
                      <span>{inv.items?.length || 0} Çeşit Kalem ({inv.totalQuantity || 0} Adet)</span>
                      <span>•</span>
                      <span>Kaydeden: {inv.createdBy || 'Kasiyer'}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    <div className="text-base sm:text-lg font-black font-mono text-white">
                      ₺{(inv.grandTotal || 0).toFixed(2)}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedHistoryInvoice(inv)}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-xl text-xs font-bold border border-slate-700 transition flex items-center gap-1"
                        title="Kalemleri İncele"
                      >
                        <span>İncele</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadPDF(inv)}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1"
                        title="PDF Olarak İndir"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportCSV(inv)}
                        className="bg-slate-800 hover:bg-slate-700 text-emerald-400 px-2.5 py-1.5 rounded-xl text-xs font-bold border border-slate-700 transition"
                        title="Excel CSV İndir"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL 1: SUCCESS RESTOCK CONFIRMATION ================= */}
      {successModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-fade-in">
          <div className="bg-slate-900 border border-slate-750 w-full max-w-lg rounded-3xl p-5 space-y-4 shadow-2xl text-white">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-base font-black text-white">
                  Alış Faturası Başarıyla İşlendi!
                </h3>
                <p className="text-xs text-slate-400">
                  Ürün stokları anında güncellendi ve toptancı faturası arşive kaydedildi.
                </p>
              </div>
            </div>

            {/* Quick stats */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-[10px] text-slate-500 block">Fatura No:</span>
                <span className="font-bold text-white">#{successModal.invoiceNo}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Tedarikçi:</span>
                <span className="font-bold text-blue-400">{successModal.supplierName}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Güncellenen Stok:</span>
                <span className="font-bold text-emerald-400">
                  {successModal.itemCount} Kalem ({successModal.totalQuantity} Adet)
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Fatura Tutarı:</span>
                <span className="font-bold text-white text-sm">
                  ₺{successModal.grandTotal.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleDownloadPDF(successModal)}
                className="bg-blue-600 hover:bg-blue-500 text-white py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md"
              >
                <Printer className="w-4 h-4" />
                <span>Mal Kabul PDF</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportCSV(successModal)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 px-3 rounded-xl text-xs font-bold border border-slate-700 transition flex items-center justify-center gap-1.5"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span>Excel İndir</span>
              </button>
              <button
                type="button"
                onClick={() => setSuccessModal(null)}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 py-2.5 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-1"
              >
                <span>Tamam</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 2: VIEW PAST INVOICE DETAILS ================= */}
      {selectedHistoryInvoice && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-fade-in">
          <div className="bg-slate-900 border border-slate-750 w-full max-w-2xl max-h-[85vh] rounded-3xl flex flex-col shadow-2xl overflow-hidden text-white">
            
            {/* Header */}
            <div className="shrink-0 p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Fatura Detayı: #{selectedHistoryInvoice.invoiceNo}</span>
                  <span className="text-xs bg-blue-500/20 text-blue-300 font-mono px-2 py-0.5 rounded-full">
                    {selectedHistoryInvoice.supplierName}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Tarih: {new Date(selectedHistoryInvoice.date).toLocaleDateString('tr-TR')} • Toplam {selectedHistoryInvoice.items?.length || 0} Kalem Ürün
                </p>
              </div>
              <button
                onClick={() => setSelectedHistoryInvoice(null)}
                className="p-1 rounded-full bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Items table */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 overscroll-contain">
              {selectedHistoryInvoice.items?.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between text-xs font-mono"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <span className="font-bold text-white block truncate">{item.name}</span>
                    <span className="text-[10px] text-slate-500">{item.barcode}</span>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="text-slate-300">
                      {item.quantity} {item.unit || 'Adet'} × ₺{(item.buyPrice || 0).toFixed(2)}
                    </div>
                    <div className="font-black text-emerald-400">
                      ₺{(item.totalBuy || (item.quantity * item.buyPrice)).toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="shrink-0 p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
              <span className="text-sm font-black font-mono">
                TOPLAM: ₺{(selectedHistoryInvoice.grandTotal || 0).toFixed(2)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadPDF(selectedHistoryInvoice)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>PDF İndir</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCSV(selectedHistoryInvoice)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-700 transition"
                >
                  Excel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 3: CAMERA BARCODE SCANNER ================= */}
      {showCameraScanner && (
        <BarcodeScanner
          onScan={(code) => {
            setShowCameraScanner(false);
            setBarcodeInput(code);
            handleBarcodeLookup(code);
          }}
          onClose={() => setShowCameraScanner(false)}
          continuous={false}
        />
      )}

    </div>
  );
}
