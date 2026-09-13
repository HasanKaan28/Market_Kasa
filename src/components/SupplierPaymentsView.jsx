import React, { useState, useMemo, useRef } from 'react';
import { 
  Building2, DollarSign, Plus, Search, Calendar, FileText, 
  ArrowUpRight, ArrowDownLeft, CheckCircle2, AlertTriangle, 
  CreditCard, Banknote, Landmark, FileCheck2, Trash2, Printer, 
  Download, Filter, ChevronRight, X, Clock, User, TrendingDown,
  Layers, ArrowRight, ShieldAlert, Sparkles, RefreshCw
} from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { playCashRegisterSound, playBarcodeBeep } from '../utils/sound';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';
import { jsPDF } from 'jspdf';
import { useAuth } from '../context/AuthContext';

export default function SupplierPaymentsView({ onNavigate, onOpenNewInvoice }) {
  const { currentUser } = useAuth();

  // Active Sub-Tab: 'balances' (Toptancı Bakiyeleri) | 'history' (Ödeme Geçmişi Defteri)
  const [activeTab, setActiveTab] = useState('balances');

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [dateRangeFilter, setDateRangeFilter] = useState('all'); // 'all', 'today', 'week', 'month'

  // Modals
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedSupplierForPayment, setSelectedSupplierForPayment] = useState(null);
  const [selectedSupplierStatement, setSelectedSupplierStatement] = useState(null);
  const [selectedPaymentReceipt, setSelectedPaymentReceipt] = useState(null);

  // New Payment Form States
  const [formSupplier, setFormSupplier] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formMethod, setFormMethod] = useState('cash'); // 'cash' | 'bank' | 'card' | 'cheque'
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formReceiptNo, setFormReceiptNo] = useState('');
  const [formNote, setFormNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Live Queries from Dexie
  const invoices = useLiveQuery(() => db.purchaseInvoices ? db.purchaseInvoices.toArray() : [], []) || [];
  const payments = useLiveQuery(() => db.supplierPayments ? db.supplierPayments.toArray() : [], []) || [];

  // Get unique supplier list from both invoices and payments
  const allSuppliers = useMemo(() => {
    const set = new Set();
    invoices.forEach(i => { if (i.supplierName?.trim()) set.add(i.supplierName.trim()); });
    payments.forEach(p => { if (p.supplierName?.trim()) set.add(p.supplierName.trim()); });
    return Array.from(set).sort();
  }, [invoices, payments]);

  // Aggregate supplier balance and ledger metrics
  const supplierLedger = useMemo(() => {
    const ledger = {};

    allSuppliers.forEach(name => {
      ledger[name] = {
        name,
        totalInvoiced: 0,
        debtInvoiced: 0,
        cashInvoiced: 0,
        totalPaid: 0,
        balance: 0,
        invoiceCount: 0,
        paymentCount: 0,
        lastTransactionDate: null
      };
    });

    invoices.forEach(inv => {
      const name = inv.supplierName?.trim();
      if (!name) return;
      if (!ledger[name]) {
        ledger[name] = {
          name, totalInvoiced: 0, debtInvoiced: 0, cashInvoiced: 0,
          totalPaid: 0, balance: 0, invoiceCount: 0, paymentCount: 0, lastTransactionDate: null
        };
      }
      const total = Number(inv.grandTotal) || 0;
      ledger[name].totalInvoiced += total;
      ledger[name].invoiceCount += 1;

      if (inv.paymentMethod === 'debt') {
        ledger[name].debtInvoiced += total;
      } else {
        // Cash or card invoice paid on the spot
        ledger[name].cashInvoiced += total;
      }

      if (!ledger[name].lastTransactionDate || new Date(inv.date || inv.createdAt) > new Date(ledger[name].lastTransactionDate)) {
        ledger[name].lastTransactionDate = inv.date || inv.createdAt;
      }
    });

    payments.forEach(pay => {
      const name = pay.supplierName?.trim();
      if (!name) return;
      if (!ledger[name]) {
        ledger[name] = {
          name, totalInvoiced: 0, debtInvoiced: 0, cashInvoiced: 0,
          totalPaid: 0, balance: 0, invoiceCount: 0, paymentCount: 0, lastTransactionDate: null
        };
      }
      const amt = Number(pay.amount) || 0;
      ledger[name].totalPaid += amt;
      ledger[name].paymentCount += 1;

      if (!ledger[name].lastTransactionDate || new Date(pay.date || pay.createdAt) > new Date(ledger[name].lastTransactionDate)) {
        ledger[name].lastTransactionDate = pay.date || pay.createdAt;
      }
    });

    // Calculate balance: (Debt Invoiced) - (Manual Payments)
    // If debtInvoiced is 0 but totalInvoiced > 0 and was recorded as 'debt', it calculates accurately.
    Object.values(ledger).forEach(sup => {
      sup.balance = Math.max(0, sup.debtInvoiced - sup.totalPaid);
    });

    return ledger;
  }, [allSuppliers, invoices, payments]);

  // Overall Global KPI Statistics
  const stats = useMemo(() => {
    let totalDebt = 0;
    let totalPaidAllTime = 0;
    let totalInvoicedAllTime = 0;

    Object.values(supplierLedger).forEach(sup => {
      totalDebt += sup.balance;
      totalPaidAllTime += sup.totalPaid;
      totalInvoicedAllTime += sup.totalInvoiced;
    });

    // This month payments
    const now = new Date();
    const currentYearMonth = now.toISOString().slice(0, 7); // YYYY-MM
    const thisMonthPaid = payments
      .filter(p => (p.date || p.createdAt || '').startsWith(currentYearMonth))
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    return {
      totalDebt,
      totalPaidAllTime,
      totalInvoicedAllTime,
      thisMonthPaid,
      activeSupplierCount: allSuppliers.length
    };
  }, [supplierLedger, payments, allSuppliers]);

  // Filtered Suppliers List for "Balances" tab
  const filteredSuppliers = useMemo(() => {
    let list = Object.values(supplierLedger);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    // Sort suppliers: those with balance > 0 first, then alphabetically
    return list.sort((a, b) => {
      if (b.balance !== a.balance) return b.balance - a.balance;
      return a.name.localeCompare(b.name, 'tr');
    });
  }, [supplierLedger, searchTerm]);

  // Filtered Payments List for "History" tab
  const filteredPayments = useMemo(() => {
    let list = [...payments];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter(p => 
        p.supplierName?.toLowerCase().includes(q) ||
        p.note?.toLowerCase().includes(q) ||
        p.receiptNo?.toLowerCase().includes(q) ||
        p.createdBy?.toLowerCase().includes(q)
      );
    }

    if (methodFilter !== 'all') {
      list = list.filter(p => p.paymentMethod === methodFilter);
    }

    if (dateRangeFilter !== 'all') {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (dateRangeFilter === 'today') {
        list = list.filter(p => (p.date || '').slice(0, 10) === todayStr);
      } else if (dateRangeFilter === 'week') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        const weekAgo = d.toISOString().slice(0, 10);
        list = list.filter(p => (p.date || '') >= weekAgo);
      } else if (dateRangeFilter === 'month') {
        const monthPrefix = new Date().toISOString().slice(0, 7);
        list = list.filter(p => (p.date || '').startsWith(monthPrefix));
      }
    }

    // Sort descending by date
    return list.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
  }, [payments, searchTerm, methodFilter, dateRangeFilter]);

  // Handle open payment modal for specific supplier
  const handleOpenPayment = (supplierName = '') => {
    setFormSupplier(supplierName || '');
    const supData = supplierName ? supplierLedger[supplierName] : null;
    if (supData && supData.balance > 0) {
      setFormAmount(supData.balance.toString());
    } else {
      setFormAmount('');
    }
    setFormMethod('cash');
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormReceiptNo('');
    setFormNote('');
    setShowPaymentModal(true);
  };

  // Submit New Payment
  const handleSavePayment = async (e) => {
    e?.preventDefault();
    if (!formSupplier.trim()) {
      alert('Lütfen toptancı seçin veya adını girin.');
      return;
    }

    const amountNum = parseFloat(formAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('Lütfen geçerli bir ödeme tutarı girin.');
      return;
    }

    setIsSaving(true);
    try {
      const newPayment = {
        supplierName: formSupplier.trim(),
        amount: amountNum,
        paymentMethod: formMethod,
        date: formDate,
        receiptNo: formReceiptNo.trim(),
        note: formNote.trim(),
        createdBy: currentUser?.name || 'Kasiyer',
        createdAt: new Date().toISOString()
      };

      await db.supplierPayments.add(newPayment);

      // Broadcast and cloud sync
      sync.broadcast('SUPPLIER_PAYMENT_SAVED', newPayment);
      googleDriveSync.triggerOnSaleSync();

      playCashRegisterSound();
      setShowPaymentModal(false);

      // Open receipt view
      setSelectedPaymentReceipt(newPayment);
    } catch (err) {
      console.error('Ödeme kaydedilemedi:', err);
      alert('Ödeme kaydedilirken bir hata oluştu: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Delete Payment Record
  const handleDeletePayment = async (id, payment) => {
    if (!window.confirm(`"${payment.supplierName}" firmasına yapılan ₺${payment.amount?.toFixed(2)} tutarındaki ödeme kaydını silmek istediğinize emin misiniz?`)) {
      return;
    }

    try {
      await db.supplierPayments.delete(id);
      sync.broadcast('SUPPLIER_PAYMENT_DELETED', { id });
      googleDriveSync.triggerOnSaleSync();
      playBarcodeBeep();
    } catch (err) {
      alert('Silme hatası: ' + err.message);
    }
  };

  // Method Labels and Badges
  const getMethodBadge = (method) => {
    switch (method) {
      case 'cash':
        return <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1"><Banknote className="w-3 h-3" /> Nakit</span>;
      case 'bank':
        return <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1"><Landmark className="w-3 h-3" /> Havale/EFT</span>;
      case 'card':
        return <span className="bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1"><CreditCard className="w-3 h-3" /> Kredi Kartı</span>;
      case 'cheque':
        return <span className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1"><FileCheck2 className="w-3 h-3" /> Çek / Senet</span>;
      default:
        return <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md text-[11px]">{method}</span>;
    }
  };

  // Generate PDF Statement for a Supplier
  const handleDownloadSupplierStatementPDF = (supplierName) => {
    const sup = supplierLedger[supplierName];
    if (!sup) return;

    // Filter all invoices and payments of this supplier
    const supInvoices = invoices.filter(i => i.supplierName?.trim().toLowerCase() === supplierName.trim().toLowerCase());
    const supPayments = payments.filter(p => p.supplierName?.trim().toLowerCase() === supplierName.trim().toLowerCase());

    // Combine into chronologic ledger
    const ledgerEntries = [];
    supInvoices.forEach(i => {
      ledgerEntries.push({
        date: i.date || i.createdAt,
        type: 'FATURA',
        docNo: i.invoiceNo || '-',
        desc: `Alış Faturası (${i.itemCount || i.items?.length || 0} Kalem - ${i.paymentMethod === 'debt' ? 'Vadeli' : 'Peşin'})`,
        debt: Number(i.grandTotal) || 0,
        credit: 0
      });
    });

    supPayments.forEach(p => {
      ledgerEntries.push({
        date: p.date || p.createdAt,
        type: 'ÖDEME',
        docNo: p.receiptNo || '-',
        desc: `Toptancı Ödemesi (${p.paymentMethod === 'cash' ? 'Nakit' : p.paymentMethod === 'bank' ? 'Havale' : 'Kart'} - ${p.note || 'Açıklamasız'})`,
        debt: 0,
        credit: Number(p.amount) || 0
      });
    });

    ledgerEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Create PDF
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    let y = 18;

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('TOPTANCI CARİ HESAP EKSTRESİ', 14, y);
    y += 7;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Toptancı Firma: ${supplierName}`, 14, y);
    doc.text(`Tarih: ${new Date().toLocaleDateString('tr-TR')}`, 140, y);
    y += 8;

    // Summary Box
    doc.setDrawColor(200);
    doc.setFillColor(245, 247, 250);
    doc.rect(14, y, 182, 22, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Toplam Alış Tutarı: TL ${sup.totalInvoiced.toFixed(2)}`, 18, y + 8);
    doc.text(`Yapılan Toplam Ödeme: TL ${sup.totalPaid.toFixed(2)}`, 18, y + 16);

    doc.setTextColor(sup.balance > 0 ? 180 : 0, 0, 0);
    doc.text(`GÜNCEL KALAN BORÇ: TL ${sup.balance.toFixed(2)}`, 110, y + 12);
    doc.setTextColor(0, 0, 0);
    y += 28;

    // Table Header
    doc.setFillColor(220, 230, 242);
    doc.rect(14, y, 182, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Tarih', 16, y + 5.5);
    doc.text('İşlem Türü', 38, y + 5.5);
    doc.text('Belge No', 65, y + 5.5);
    doc.text('Açıklama', 95, y + 5.5);
    doc.text('Borç (TL)', 148, y + 5.5, { align: 'right' });
    doc.text('Ödeme (TL)', 172, y + 5.5, { align: 'right' });
    doc.text('Bakiye (TL)', 193, y + 5.5, { align: 'right' });
    y += 9;

    // Table Rows
    doc.setFont('helvetica', 'normal');
    let runningBalance = 0;

    ledgerEntries.forEach((entry, idx) => {
      if (y > 275) {
        doc.addPage();
        y = 15;
      }

      runningBalance += (entry.debt - entry.credit);

      doc.setFontSize(8);
      doc.text(String(entry.date).slice(0, 10), 16, y + 4);
      doc.text(entry.type, 38, y + 4);
      doc.text(String(entry.docNo).slice(0, 12), 65, y + 4);
      doc.text(String(entry.desc).slice(0, 26), 95, y + 4);
      doc.text(entry.debt > 0 ? entry.debt.toFixed(2) : '-', 148, y + 4, { align: 'right' });
      doc.text(entry.credit > 0 ? entry.credit.toFixed(2) : '-', 172, y + 4, { align: 'right' });
      doc.text(runningBalance.toFixed(2), 193, y + 4, { align: 'right' });

      doc.setDrawColor(235);
      doc.line(14, y + 6, 196, y + 6);
      y += 7;
    });

    doc.save(`Cari_Ekstre_${supplierName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Generate Payment Receipt PDF
  const handleDownloadPaymentReceiptPDF = (payment) => {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: [100, 140] });
    let y = 14;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('TOPTANCI ÖDEME MAKBUZU', 50, y, { align: 'center' });
    y += 6;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Tarih: ${payment.date || new Date().toISOString().slice(0, 10)}`, 50, y, { align: 'center' });
    y += 8;

    doc.setDrawColor(180);
    doc.line(10, y, 90, y);
    y += 6;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Toptancı Firma:', 12, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(payment.supplierName), 40, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Ödeme Tutarı:', 12, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`TL ${Number(payment.amount || 0).toFixed(2)}`, 40, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Ödeme Türü:', 12, y);
    doc.setFont('helvetica', 'normal');
    doc.text(payment.paymentMethod === 'cash' ? 'Nakit' : payment.paymentMethod === 'bank' ? 'Havale/EFT' : 'Kart', 40, y);
    y += 6;

    if (payment.receiptNo) {
      doc.setFont('helvetica', 'bold');
      doc.text('Belge / Dekont No:', 12, y);
      doc.setFont('helvetica', 'normal');
      doc.text(payment.receiptNo, 40, y);
      y += 6;
    }

    if (payment.note) {
      doc.setFont('helvetica', 'bold');
      doc.text('Açıklama:', 12, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(payment.note).slice(0, 35), 40, y);
      y += 6;
    }

    doc.setFont('helvetica', 'bold');
    doc.text('Ödemeyi Yapan:', 12, y);
    doc.setFont('helvetica', 'normal');
    doc.text(payment.createdBy || 'Yetkili', 40, y);
    y += 10;

    doc.setDrawColor(180);
    doc.line(10, y, 90, y);
    y += 8;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text('İşbu makbuz toptancıya yapılan ödemenin resmi dökümüdür.', 50, y, { align: 'center' });
    y += 12;

    doc.text('Teslim Eden (Kasa)', 25, y);
    doc.text('Teslim Alan (Toptancı)', 75, y);

    doc.save(`Odeme_Makbuzu_${payment.supplierName.replace(/\s+/g, '_')}_${payment.id || Date.now()}.pdf`);
  };

  // Export All Payments to CSV
  const handleExportPaymentsCSV = () => {
    if (filteredPayments.length === 0) return;

    let csv = 'ID;Tarih;Toptanci;Tutar;Odeme Sekli;Dekont No;Aciklama;Kaydeden\n';
    filteredPayments.forEach(p => {
      csv += `"${p.id || ''}";"${p.date || ''}";"${p.supplierName || ''}";"${(p.amount || 0).toFixed(2)}";"${p.paymentMethod || ''}";"${p.receiptNo || ''}";"${p.note || ''}";"${p.createdBy || ''}"\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `toptanci_odemeleri_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto bg-slate-950 text-slate-100 overflow-hidden relative">
      
      {/* ================= 1. HEADER & KPI METRICS ================= */}
      <div className="shrink-0 p-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
              <span>Toptancı Ödemeleri & Cari Hesap</span>
              <span className="text-[11px] bg-emerald-500/20 text-emerald-300 font-mono px-2 py-0.5 rounded-full border border-emerald-500/30">
                Kasa Çıkışları & Borçlar
              </span>
            </h2>
            <p className="text-xs text-slate-400 hidden sm:block">
              Toptancılara yapılan nakit, havale ve kart ödemelerini kaydedin; güncel açık borç bakiyelerini izleyin.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleOpenPayment('')}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-3.5 py-2 rounded-xl text-xs sm:text-sm flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Ödeme Yap</span>
          </button>

          {/* Sub-view Switcher Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('balances')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'balances'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Toptancı Bakiyeleri ({allSuppliers.length})</span>
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
              <Clock className="w-3.5 h-3.5" />
              <span>Ödeme Defteri ({payments.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* ================= 2. KPI METRIC SUMMARY CARDS ================= */}
      <div className="shrink-0 p-3 grid grid-cols-2 md:grid-cols-4 gap-2.5 bg-slate-900/60 border-b border-slate-800">
        
        {/* Total Debt Card */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Toplam Toptancı Borcu</span>
            <AlertTriangle className={`w-3.5 h-3.5 ${stats.totalDebt > 0 ? 'text-rose-400' : 'text-emerald-400'}`} />
          </div>
          <div className="mt-1.5">
            <span className={`text-base sm:text-xl font-black font-mono ${stats.totalDebt > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              ₺{stats.totalDebt.toFixed(2)}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">Ödenmeyi bekleyen vadeli tutar</span>
        </div>

        {/* This Month Payments */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Bu Ay Yapılan Ödeme</span>
            <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1.5">
            <span className="text-base sm:text-xl font-black font-mono text-emerald-400">
              ₺{stats.thisMonthPaid.toFixed(2)}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">Bu ay kasadan toptancıya çıkan</span>
        </div>

        {/* Total Purchases */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Toplam Mal Alımı</span>
            <FileText className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="mt-1.5">
            <span className="text-base sm:text-xl font-black font-mono text-blue-400">
              ₺{stats.totalInvoicedAllTime.toFixed(2)}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">{invoices.length} adet alış faturası</span>
        </div>

        {/* Total Payments All Time */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Toplam Ödenen Tutar</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
          </div>
          <div className="mt-1.5">
            <span className="text-base sm:text-xl font-black font-mono text-teal-400">
              ₺{stats.totalPaidAllTime.toFixed(2)}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">{payments.length} adet ödeme kaydı</span>
        </div>

      </div>

      {/* ================= 3. SEARCH & FILTERS BAR ================= */}
      <div className="shrink-0 px-3 py-2 bg-slate-900/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={activeTab === 'balances' ? 'Toptancı adına göre ara...' : 'Toptancı, dekont, not ara...'}
            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none transition"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {activeTab === 'history' && (
          <div className="flex items-center gap-2">
            {/* Method filter */}
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="all">Tüm Ödeme Türleri</option>
              <option value="cash">Nakit</option>
              <option value="bank">Havale / EFT</option>
              <option value="card">Kredi Kartı</option>
              <option value="cheque">Çek / Senet</option>
            </select>

            {/* Date filter */}
            <select
              value={dateRangeFilter}
              onChange={(e) => setDateRangeFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="all">Tüm Tarihler</option>
              <option value="today">Bugün</option>
              <option value="week">Son 7 Gün</option>
              <option value="month">Bu Ay</option>
            </select>

            <button
              onClick={handleExportPaymentsCSV}
              disabled={filteredPayments.length === 0}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 transition disabled:opacity-50"
              title="Ödeme Listesini Excel/CSV Olarak İndir"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Excel</span>
            </button>
          </div>
        )}
      </div>

      {/* ================= 4. MAIN CONTENT TABS ================= */}
      <div className="flex-1 overflow-y-auto p-3 overscroll-contain">
        
        {/* ================= TAB 1: SUPPLIER BALANCES (CARİ ÖZET) ================= */}
        {activeTab === 'balances' && (
          <div>
            {filteredSuppliers.length === 0 ? (
              <div className="py-16 text-center text-slate-500">
                <Building2 className="w-12 h-12 mx-auto mb-2 opacity-30 text-slate-400" />
                <p className="text-sm font-bold">Kayıtlı toptancı bulunamadı.</p>
                <p className="text-xs text-slate-600 mt-1">Alış faturası girdiğinizde veya yeni ödeme yaptığınızda toptancılar burada listelenir.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredSuppliers.map((sup, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 shadow-md transition flex flex-col justify-between space-y-3"
                  >
                    <div>
                      {/* Supplier Name & Status Badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-sm font-black text-white truncate flex items-center gap-1.5">
                            <Building2 className="w-4 h-4 text-blue-400 shrink-0" />
                            <span>{sup.name}</span>
                          </h3>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {sup.invoiceCount} Fatura • {sup.paymentCount} Ödeme
                          </span>
                        </div>

                        {sup.balance > 0 ? (
                          <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                            Borç Var
                          </span>
                        ) : (
                          <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                            Borcu Yok
                          </span>
                        )}
                      </div>

                      {/* Financial Figures */}
                      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-800/80 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-500 block">Toplam Alış</span>
                          <span className="font-bold text-slate-200 font-mono">₺{sup.totalInvoiced.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">Ödenen Tutar</span>
                          <span className="font-bold text-emerald-400 font-mono">₺{sup.totalPaid.toFixed(2)}</span>
                        </div>
                      </div>

                      {/* Remaining Balance Banner */}
                      <div className={`mt-3 p-2.5 rounded-xl border flex items-center justify-between font-mono ${
                        sup.balance > 0 
                          ? 'bg-rose-950/40 border-rose-800/60 text-rose-300' 
                          : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      }`}>
                        <span className="text-xs font-semibold">Kalan Borç:</span>
                        <span className="text-sm font-black">₺{sup.balance.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => handleOpenPayment(sup.name)}
                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-95 shadow-sm"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>Ödeme Yap</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDownloadSupplierStatementPDF(sup.name)}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition"
                        title="Resmi Cari Hesap Ekstresi PDF İndir"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Ekstre</span>
                      </button>
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: PAYMENT HISTORY DEFTAR ================= */}
        {activeTab === 'history' && (
          <div>
            {filteredPayments.length === 0 ? (
              <div className="py-16 text-center text-slate-500">
                <Clock className="w-12 h-12 mx-auto mb-2 opacity-30 text-slate-400" />
                <p className="text-sm font-bold">Ödeme kaydı bulunamadı.</p>
                <p className="text-xs text-slate-600 mt-1">Yapılan toptancı ödemeleri burada kronolojik olarak saklanır.</p>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-3">Tarih</th>
                        <th className="p-3">Toptancı Firma</th>
                        <th className="p-3">Ödeme Türü</th>
                        <th className="p-3">Tutar</th>
                        <th className="p-3">Dekont / Belge No</th>
                        <th className="p-3">Açıklama</th>
                        <th className="p-3">Kaydeden</th>
                        <th className="p-3 text-right">İşlem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {filteredPayments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-800/40 transition">
                          <td className="p-3 text-slate-300 whitespace-nowrap">
                            <span className="font-bold">{p.date || String(p.createdAt).slice(0, 10)}</span>
                            {p.createdAt && (
                              <span className="text-[10px] text-slate-500 block">
                                {new Date(p.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-white font-bold font-sans">
                            {p.supplierName}
                          </td>
                          <td className="p-3 whitespace-nowrap font-sans">
                            {getMethodBadge(p.paymentMethod)}
                          </td>
                          <td className="p-3 font-black text-emerald-400 text-sm whitespace-nowrap">
                            ₺{(p.amount || 0).toFixed(2)}
                          </td>
                          <td className="p-3 text-slate-400">
                            {p.receiptNo || '-'}
                          </td>
                          <td className="p-3 text-slate-300 font-sans max-w-xs truncate" title={p.note}>
                            {p.note || '-'}
                          </td>
                          <td className="p-3 text-slate-400 font-sans">
                            {p.createdBy || 'Kasiyer'}
                          </td>
                          <td className="p-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleDownloadPaymentReceiptPDF(p)}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition"
                                title="Ödeme Makbuzu PDF İndir"
                              >
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePayment(p.id, p)}
                                className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition"
                                title="Ödeme Kaydını Sil"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ================= MODAL: RECORD NEW SUPPLIER PAYMENT ================= */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            
            {/* Header */}
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Toptancıya Ödeme Yap</h3>
                  <p className="text-[11px] text-slate-400">Kasadan veya bankadan yapılan ödemeyi işleyin</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSavePayment} className="p-4 space-y-3.5 overflow-y-auto">
              
              {/* Supplier Selection */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Toptancı Firma</label>
                <div className="relative">
                  <input
                    type="text"
                    list="supplier-suggestions"
                    value={formSupplier}
                    onChange={(e) => {
                      setFormSupplier(e.target.value);
                      const sData = supplierLedger[e.target.value.trim()];
                      if (sData && sData.balance > 0 && !formAmount) {
                        setFormAmount(sData.balance.toString());
                      }
                    }}
                    placeholder="Toptancı adı girin veya seçin..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-semibold"
                    required
                  />
                  <datalist id="supplier-suggestions">
                    {allSuppliers.map((s, idx) => (
                      <option key={idx} value={s} />
                    ))}
                  </datalist>
                </div>

                {/* Selected Supplier Balance Tip */}
                {formSupplier && supplierLedger[formSupplier.trim()] && (
                  <div className="mt-1.5 p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">Güncel Kalan Borç:</span>
                    <span className={`font-bold ${supplierLedger[formSupplier.trim()].balance > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      ₺{supplierLedger[formSupplier.trim()].balance.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* Payment Amount */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-300">Ödeme Tutarı (₺)</label>
                  {formSupplier && supplierLedger[formSupplier.trim()]?.balance > 0 && (
                    <button
                      type="button"
                      onClick={() => setFormAmount(supplierLedger[formSupplier.trim()].balance.toString())}
                      className="text-[10px] text-emerald-400 hover:underline font-bold"
                    >
                      Tüm Borcu Kapat (₺{supplierLedger[formSupplier.trim()].balance.toFixed(2)})
                    </button>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-500 text-sm">₺</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-2.5 text-base text-emerald-400 font-mono font-black focus:outline-none focus:border-emerald-500"
                    required
                    autoFocus
                  />
                </div>

                {/* Quick Presets */}
                <div className="grid grid-cols-4 gap-1.5 mt-2">
                  {[500, 1000, 2500, 5000].map(amt => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setFormAmount(amt.toString())}
                      className="py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-[11px] font-mono font-bold transition"
                    >
                      +₺{amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment Method Selector */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Ödeme Yolu</label>
                <div className="grid grid-cols-4 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setFormMethod('cash')}
                    className={`py-2 rounded-lg transition flex flex-col items-center justify-center gap-1 ${
                      formMethod === 'cash' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    <span className="text-[10px]">Nakit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormMethod('bank')}
                    className={`py-2 rounded-lg transition flex flex-col items-center justify-center gap-1 ${
                      formMethod === 'bank' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Landmark className="w-4 h-4" />
                    <span className="text-[10px]">Havale/EFT</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormMethod('card')}
                    className={`py-2 rounded-lg transition flex flex-col items-center justify-center gap-1 ${
                      formMethod === 'card' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    <span className="text-[10px]">Kart</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormMethod('cheque')}
                    className={`py-2 rounded-lg transition flex flex-col items-center justify-center gap-1 ${
                      formMethod === 'cheque' ? 'bg-purple-500 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <FileCheck2 className="w-4 h-4" />
                    <span className="text-[10px]">Çek/Senet</span>
                  </button>
                </div>
              </div>

              {/* Date & Document No */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Ödeme Tarihi</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">Dekont / Belge No</label>
                  <input
                    type="text"
                    value={formReceiptNo}
                    onChange={(e) => setFormReceiptNo(e.target.value)}
                    placeholder="Örn: DKT-1049"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">Açıklama / Not</label>
                <input
                  type="text"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="Örn: Haftalık teslimat nakit ödemesi..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition active:scale-98 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Ödemeyi Kaydet & Kasadan Düş</span>
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* ================= MODAL: PAYMENT SUCCESS & RECEIPT PREVIEW ================= */}
      {selectedPaymentReceipt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm shadow-2xl p-4 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-black text-white">Ödeme Başarıyla Kaydedildi!</h3>
              <p className="text-xs text-slate-400 mt-1">
                "{selectedPaymentReceipt.supplierName}" firmasına ₺{Number(selectedPaymentReceipt.amount).toFixed(2)} ödendi.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-left text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Tarih:</span>
                <span className="text-slate-300">{selectedPaymentReceipt.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ödeme Şekli:</span>
                <span className="text-slate-300">{selectedPaymentReceipt.paymentMethod}</span>
              </div>
              {selectedPaymentReceipt.receiptNo && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Belge No:</span>
                  <span className="text-slate-300">{selectedPaymentReceipt.receiptNo}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleDownloadPaymentReceiptPDF(selectedPaymentReceipt)}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Makbuz İndir</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedPaymentReceipt(null)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
