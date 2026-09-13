import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Search, Phone, MapPin, User, ArrowUpRight, 
  ArrowDownLeft, MessageCircle, FileText, X, Check, DollarSign, 
  Bell, CalendarDays, Clock, AlertTriangle, ShieldAlert, 
  Download, Printer, ChevronRight, TrendingUp, Users, ArrowUpDown, 
  Calendar, CheckCircle2, History, Percent
} from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';
import { playCashRegisterSound, playBarcodeBeep } from '../utils/sound';
import { jsPDF } from 'jspdf';

const REMINDER_INTERVALS = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000
};

function normalizePhoneNumber(input = '') {
  if (!input) return '';
  let digits = input.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('+')) digits = digits.slice(1);

  if (digits.startsWith('90')) return digits;
  if (digits.startsWith('0')) return `90${digits.slice(1)}`;
  if (digits.startsWith('5')) return `90${digits}`;

  if (digits.length === 10 && !digits.startsWith('9')) return `90${digits}`;
  return digits;
}

function openWhatsAppChat(phone, text) {
  const normalizedPhone = normalizePhoneNumber(phone || '');
  if (!normalizedPhone) return false;

  const url = `https://api.whatsapp.com/send?phone=${normalizedPhone}&text=${encodeURIComponent(text)}`;
  const popup = window.open(url, '_blank');
  if (!popup) {
    window.location.href = url;
  }
  return true;
}

function getNextReminderDate(frequency = 'weekly', fromDate = new Date()) {
  const ms = REMINDER_INTERVALS[frequency] || REMINDER_INTERVALS.weekly;
  return new Date(fromDate.getTime() + ms).toISOString();
}

export default function CustomerBook() {
  const { hasPermission } = useAuth();

  // Search, Filters & Sorting
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('with_debt'); // 'with_debt' | 'overdue' | 'all' | 'settled' | 'reminders'
  const [sortBy, setSortBy] = useState('highest_debt'); // 'highest_debt' | 'oldest_debt' | 'newest_debt' | 'name_asc'

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showAddDebtModal, setShowAddDebtModal] = useState(false);
  const [actionAmount, setActionAmount] = useState('');
  const [actionNote, setActionNote] = useState('');

  // Form state for new customer
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [limit, setLimit] = useState('2000');
  const [notes, setNotes] = useState('');
  const [reminderFrequency, setReminderFrequency] = useState('weekly');
  const [autoReminderEnabled, setAutoReminderEnabled] = useState(true);

  // Live queries
  const customers = useLiveQuery(() => db.customers.toArray(), []) || [];
  const allTransactions = useLiveQuery(() => db.customerTransactions.toArray(), []) || [];

  // Selected customer's specific transactions
  const transactions = useMemo(() => {
    if (!selectedCustomer) return [];
    return allTransactions
      .filter(tx => tx.customerId === selectedCustomer.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [allTransactions, selectedCustomer]);

  // Compute Debt Aging, First Debt Date, and Last Activity for every customer
  const enrichedCustomers = useMemo(() => {
    const txMap = {};
    allTransactions.forEach(tx => {
      if (!txMap[tx.customerId]) txMap[tx.customerId] = [];
      txMap[tx.customerId].push(tx);
    });

    const now = Date.now();

    return customers.map(c => {
      const cTxs = txMap[c.id] || [];
      cTxs.sort((a, b) => new Date(a.date) - new Date(b.date));

      const balance = Number(c.balance) || 0;
      let firstDebtDate = null;
      let lastActivityDate = null;
      let daysWaiting = 0;

      if (cTxs.length > 0) {
        lastActivityDate = cTxs[cTxs.length - 1].date;
        const debtTxs = cTxs.filter(t => t.type === 'debt');
        if (debtTxs.length > 0) {
          firstDebtDate = debtTxs[0].date;
        }
      }

      if (!firstDebtDate && c.createdAt) {
        firstDebtDate = c.createdAt;
      }

      if (balance > 0 && firstDebtDate) {
        const diffMs = now - new Date(firstDebtDate).getTime();
        daysWaiting = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      }

      const custLimit = Number(c.limit) || 2000;
      const limitUsagePercent = custLimit > 0 ? Math.min(100, Math.round((balance / custLimit) * 100)) : 0;
      const isOverLimit = balance > custLimit;
      const isOverdue = balance > 0 && daysWaiting >= 30;

      return {
        ...c,
        balance,
        firstDebtDate,
        lastActivityDate,
        daysWaiting,
        custLimit,
        limitUsagePercent,
        isOverLimit,
        isOverdue,
        txCount: cTxs.length
      };
    });
  }, [customers, allTransactions]);

  // Global KPI Summary Metrics
  const stats = useMemo(() => {
    let totalDebt = 0;
    let overdueDebt = 0;
    let overdueCount = 0;
    let debtCustomerCount = 0;
    let totalWaitingDays = 0;

    enrichedCustomers.forEach(c => {
      if (c.balance > 0) {
        totalDebt += c.balance;
        debtCustomerCount += 1;
        totalWaitingDays += c.daysWaiting;

        if (c.daysWaiting >= 30) {
          overdueDebt += c.balance;
          overdueCount += 1;
        }
      }
    });

    const avgWaitingDays = debtCustomerCount > 0 ? Math.round(totalWaitingDays / debtCustomerCount) : 0;

    return {
      totalDebt,
      overdueDebt,
      overdueCount,
      debtCustomerCount,
      avgWaitingDays,
      totalCustomers: enrichedCustomers.length
    };
  }, [enrichedCustomers]);

  // Filter and Sort Customers
  const filteredCustomers = useMemo(() => {
    let list = enrichedCustomers.filter(c => !c.archived);

    // Filter by mode
    if (filterMode === 'with_debt') {
      list = list.filter(c => c.balance > 0);
    } else if (filterMode === 'overdue') {
      list = list.filter(c => c.isOverdue);
    } else if (filterMode === 'settled') {
      list = list.filter(c => c.balance <= 0);
    } else if (filterMode === 'reminders') {
      list = list.filter(c => c.balance > 0 && c.autoReminderEnabled && c.phone && (!c.nextReminderAt || new Date(c.nextReminderAt).getTime() <= Date.now()));
    }

    // Text search (name, phone, address, notes)
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(c => 
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q)) ||
        (c.notes && c.notes.toLowerCase().includes(q))
      );
    }

    // Sorting
    return list.sort((a, b) => {
      if (sortBy === 'highest_debt') return b.balance - a.balance;
      if (sortBy === 'oldest_debt') return b.daysWaiting - a.daysWaiting;
      if (sortBy === 'newest_debt') return a.daysWaiting - b.daysWaiting;
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name, 'tr');
      return 0;
    });
  }, [enrichedCustomers, filterMode, search, sortBy]);

  // WhatsApp reminder background runner
  useEffect(() => {
    if (!customers || customers.length === 0) return;

    const timer = setInterval(async () => {
      const now = Date.now();
      const due = customers.filter(c => c.balance > 0 && c.autoReminderEnabled && c.phone && (!c.nextReminderAt || new Date(c.nextReminderAt).getTime() <= now));

      for (const customer of due) {
        const next = getNextReminderDate(customer.reminderFrequency || 'weekly', new Date());
        await db.customers.update(customer.id, {
          lastReminderAt: new Date().toISOString(),
          nextReminderAt: next
        });
        const msg = `Merhaba Sayın ${customer.name},\nMarketimizde bulunan veresiye hesabınızın güncel bakiye tutarı: *₺${(customer.balance || 0).toFixed(2)}*'dir.\nMüsait bir zamanınızda ödeme yapmayı rica ederiz. Hayırlı günler dileriz.`;
        if (customer.phone) {
          openWhatsAppChat(customer.phone, msg);
        }
      }
    }, 60000);

    return () => clearInterval(timer);
  }, [customers]);

  // Create new customer
  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    const normalizedPhone = normalizePhoneNumber(phone);
    const newCust = {
      name: name.trim(),
      phone: normalizedPhone,
      address: address.trim(),
      balance: 0,
      limit: parseFloat(limit) || 2000,
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
      autoReminderEnabled: autoReminderEnabled,
      reminderFrequency: reminderFrequency,
      lastReminderAt: null,
      nextReminderAt: getNextReminderDate(reminderFrequency)
    };

    const newId = await db.customers.add(newCust);
    sync.broadcast('CUSTOMER_SAVED', { customer: { id: newId, ...newCust } });
    googleDriveSync.triggerOnSaleSync();
    playCashRegisterSound();

    setName('');
    setPhone('');
    setAddress('');
    setLimit('2000');
    setNotes('');
    setReminderFrequency('weekly');
    setAutoReminderEnabled(true);
    setIsAddModalOpen(false);
  };

  // Record Payment (Tahsilat Al)
  const handleRecordPayment = async (e) => {
    e.preventDefault();
    const amount = parseFloat(actionAmount);
    if (!amount || amount <= 0 || !selectedCustomer) return;

    const newBalance = Math.max(0, (selectedCustomer.balance || 0) - amount);

    await db.customers.update(selectedCustomer.id, { balance: newBalance });
    const tx = {
      customerId: selectedCustomer.id,
      type: 'payment',
      amount: amount,
      date: new Date().toISOString(),
      note: actionNote.trim() || 'Nakit Tahsilat'
    };
    await db.customerTransactions.add(tx);

    sync.broadcast('CUSTOMER_BALANCE_UPDATED', {
      customerId: selectedCustomer.id,
      newBalance,
      transaction: tx
    });
    googleDriveSync.triggerOnSaleSync();
    playCashRegisterSound();

    setSelectedCustomer(prev => ({ ...prev, balance: newBalance }));
    setActionAmount('');
    setActionNote('');
    setShowPaymentModal(false);
  };

  // Add Manual Debt (Borç Ekle)
  const handleAddManualDebt = async (e) => {
    e.preventDefault();
    const amount = parseFloat(actionAmount);
    if (!amount || amount <= 0 || !selectedCustomer) return;

    const newBalance = (selectedCustomer.balance || 0) + amount;

    await db.customers.update(selectedCustomer.id, { balance: newBalance });
    const tx = {
      customerId: selectedCustomer.id,
      type: 'debt',
      amount: amount,
      date: new Date().toISOString(),
      note: actionNote.trim() || 'Manuel Veresiye Alışveriş'
    };
    await db.customerTransactions.add(tx);

    sync.broadcast('CUSTOMER_BALANCE_UPDATED', {
      customerId: selectedCustomer.id,
      newBalance,
      transaction: tx
    });
    googleDriveSync.triggerOnSaleSync();
    playBarcodeBeep();

    setSelectedCustomer(prev => ({ ...prev, balance: newBalance }));
    setActionAmount('');
    setActionNote('');
    setShowAddDebtModal(false);
  };

  // Send WhatsApp Reminder
  const sendWhatsAppReminder = async (customer, options = {}) => {
    if (!customer.phone) {
      alert('Müşterinin kayıtlı telefon numarası bulunamadı!');
      return;
    }

    const normalizedPhone = normalizePhoneNumber(customer.phone || '');
    if (!normalizedPhone) {
      alert('Geçerli bir telefon numarası girilmemiş.');
      return;
    }

    const msg = `Merhaba Sayın ${customer.name},\nMarketimizde bulunan veresiye hesabınızın güncel bakiye tutarı: *₺${(customer.balance || 0).toFixed(2)}*'dir.\nMüsait bir zamanınızda ödeme yapmanızı rica eder, iyi günler dileriz.`;
    const now = new Date();

    if (options.isAuto && customer.id) {
      const updatedFrequency = customer.reminderFrequency || 'weekly';
      const nextReminder = getNextReminderDate(updatedFrequency, now);
      await db.customers.update(customer.id, {
        lastReminderAt: now.toISOString(),
        nextReminderAt: nextReminder
      });
    }

    openWhatsAppChat(normalizedPhone, msg);
  };

  // Toggle Reminder
  const handleToggleReminder = async (customerId, enabled) => {
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return;

    const next = enabled ? getNextReminderDate(customer.reminderFrequency || 'weekly', new Date()) : null;
    await db.customers.update(customerId, {
      autoReminderEnabled: enabled,
      nextReminderAt: next
    });
  };

  // Archive Settled Customer
  const handleArchiveSettledCustomer = async (customerId) => {
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return;

    await db.customers.update(customerId, {
      archived: true,
      archivedAt: new Date().toISOString(),
      autoReminderEnabled: false,
      nextReminderAt: null
    });

    setSelectedCustomer(null);
  };

  // Download Official PDF Statement for Customer
  const handleDownloadCustomerStatementPDF = (customer) => {
    const custTxs = allTransactions
      .filter(tx => tx.customerId === customer.id)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    let y = 18;

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('MÜŞTERİ HESAP EKSTRESİ', 14, y);
    y += 7;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Müşteri: ${customer.name}`, 14, y);
    doc.text(`Telefon: ${customer.phone || 'Kayıtlı Değil'}`, 14, y + 5);
    doc.text(`Tarih: ${new Date().toLocaleDateString('tr-TR')}`, 140, y);
    y += 12;

    // Summary Box
    doc.setDrawColor(200);
    doc.setFillColor(245, 247, 250);
    doc.rect(14, y, 182, 18, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`Kredi Limiti: TL ${(customer.limit || 2000).toFixed(2)}`, 18, y + 11);
    doc.setTextColor(customer.balance > 0 ? 180 : 0, 0, 0);
    doc.text(`GÜNCEL BORÇ BAKİYESİ: TL ${(customer.balance || 0).toFixed(2)}`, 110, y + 11);
    doc.setTextColor(0, 0, 0);
    y += 24;

    // Table Header
    doc.setFillColor(220, 230, 242);
    doc.rect(14, y, 182, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Tarih & Saat', 16, y + 5.5);
    doc.text('İşlem Türü', 48, y + 5.5);
    doc.text('Açıklama / Not', 85, y + 5.5);
    doc.text('Borç (TL)', 145, y + 5.5, { align: 'right' });
    doc.text('Ödenen (TL)', 168, y + 5.5, { align: 'right' });
    doc.text('Kalan (TL)', 193, y + 5.5, { align: 'right' });
    y += 9;

    // Table Rows
    doc.setFont('helvetica', 'normal');
    let running = 0;

    custTxs.forEach((tx) => {
      if (y > 275) {
        doc.addPage();
        y = 15;
      }

      const debt = tx.type === 'debt' ? tx.amount : 0;
      const payment = tx.type === 'payment' ? tx.amount : 0;
      running += (debt - payment);

      doc.setFontSize(8);
      const dateStr = new Date(tx.date).toLocaleDateString('tr-TR') + ' ' + new Date(tx.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      doc.text(dateStr, 16, y + 4);
      doc.text(tx.type === 'debt' ? 'Veresiye Alışveriş' : 'Nakit Tahsilat', 48, y + 4);
      doc.text(String(tx.note || '-').slice(0, 30), 85, y + 4);
      doc.text(debt > 0 ? debt.toFixed(2) : '-', 145, y + 4, { align: 'right' });
      doc.text(payment > 0 ? payment.toFixed(2) : '-', 168, y + 4, { align: 'right' });
      doc.text(running.toFixed(2), 193, y + 4, { align: 'right' });

      doc.setDrawColor(235);
      doc.line(14, y + 6, 196, y + 6);
      y += 7;
    });

    doc.save(`Musteri_Ekstresi_${customer.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Export Customers to CSV
  const handleExportCustomersCSV = () => {
    if (filteredCustomers.length === 0) return;

    let csv = 'ID;Musteri Adi;Telefon;Adres;Guncel Borc;Borc Limiti;Bekleme Suresi (Gun);Ilk Borc Tarihi;Son Islem;Notlar\n';
    filteredCustomers.forEach(c => {
      csv += `"${c.id || ''}";"${c.name || ''}";"${c.phone || ''}";"${c.address || ''}";"${(c.balance || 0).toFixed(2)}";"${(c.limit || 0).toFixed(2)}";"${c.daysWaiting || 0}";"${c.firstDebtDate ? c.firstDebtDate.slice(0, 10) : ''}";"${c.lastActivityDate ? c.lastActivityDate.slice(0, 10) : ''}";"${c.notes || ''}"\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `veresiye_musteri_listesi_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Render Debt Waiting Badge
  const renderAgingBadge = (customer) => {
    if (customer.balance <= 0) {
      return (
        <span className="bg-slate-800 text-slate-400 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Borcu Yok</span>
        </span>
      );
    }

    const days = customer.daysWaiting;

    if (days >= 30) {
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2.5 py-0.5 rounded-lg text-xs font-black flex items-center gap-1.5 animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>{days} Gündür Bekliyor (Gecikmiş)</span>
          </span>
          {customer.firstDebtDate && (
            <span className="text-[10px] text-slate-400 font-mono pl-1">
              İlk Borç: {new Date(customer.firstDebtDate).toLocaleDateString('tr-TR')}
            </span>
          )}
        </div>
      );
    }

    if (days >= 15) {
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{days} Gündür Bekliyor</span>
          </span>
          {customer.firstDebtDate && (
            <span className="text-[10px] text-slate-400 font-mono pl-1">
              İlk Borç: {new Date(customer.firstDebtDate).toLocaleDateString('tr-TR')}
            </span>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2.5 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-sky-400" />
          <span>{days === 0 ? 'Bugün Eklendi' : `${days} Gündür Bekliyor`}</span>
        </span>
        {customer.firstDebtDate && (
          <span className="text-[10px] text-slate-400 font-mono pl-1">
            Tarih: {new Date(customer.firstDebtDate).toLocaleDateString('tr-TR')}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-57px-60px)] md:h-[calc(100dvh-60px)] max-w-7xl mx-auto px-2 sm:px-4 py-2 space-y-2 overflow-hidden antialiased bg-slate-950 text-slate-100">
      
      {/* ================= 1. TOP HEADER & SUMMARY BANNER ================= */}
      <div className="shrink-0 p-3 bg-slate-900 border border-slate-800 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
              <span>Veresiye & Müşteri Borç Defteri</span>
              <span className="text-[11px] bg-blue-500/20 text-blue-300 font-mono px-2 py-0.5 rounded-full border border-blue-500/30">
                {stats.totalCustomers} Kayıtlı Kişi
              </span>
            </h1>
            <p className="text-xs text-slate-400 hidden sm:block">
              Müşteri borçlarını satır satır izleyin, bekleme süresini (borç yaşını) görün ve tek tıkla tahsilat yapın.
            </p>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCustomersCSV}
            className="p-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:text-white transition"
            title="Excel / CSV Listesi İndir"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3.5 py-2 rounded-xl text-xs sm:text-sm flex items-center gap-1.5 shadow-lg shadow-blue-500/20 active:scale-95 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Müşteri Ekle</span>
          </button>
        </div>
      </div>

      {/* ================= 2. KPI METRIC SUMMARY CARDS ================= */}
      <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        
        {/* Total Market Receivable */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Piyasadaki Toplam Alacak</span>
            <DollarSign className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-1">
            <span className="text-lg sm:text-2xl font-black text-rose-400 font-mono">
              ₺{stats.totalDebt.toFixed(2)}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">{stats.debtCustomerCount} borçlu müşteriden alacak</span>
        </div>

        {/* Overdue Debts (>30 Days) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Gecikmiş Alacaklar (&gt;30 Gün)</span>
            <AlertTriangle className={`w-4 h-4 ${stats.overdueCount > 0 ? 'text-amber-400 animate-pulse' : 'text-slate-500'}`} />
          </div>
          <div className="mt-1">
            <span className={`text-lg sm:text-2xl font-black font-mono ${stats.overdueCount > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
              ₺{stats.overdueDebt.toFixed(2)}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">{stats.overdueCount} kişi 1 aydan uzun süredir ödemedi</span>
        </div>

        {/* Average Debt Age */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Ortalama Bekleme Süresi</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-1">
            <span className="text-lg sm:text-2xl font-black text-sky-400 font-mono">
              {stats.avgWaitingDays} <span className="text-xs font-normal text-slate-400">Gün</span>
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">Borçların ortalama rafta durma süresi</span>
        </div>

        {/* Debt-free / Settled Rate */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Borçsuz / Temiz Hesap</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-1">
            <span className="text-lg sm:text-2xl font-black text-emerald-400 font-mono">
              {stats.totalCustomers - stats.debtCustomerCount} <span className="text-xs font-normal text-slate-400">Kişi</span>
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-1">Gününde ödeyen veya borcu 0 olanlar</span>
        </div>

      </div>

      {/* ================= 3. SEARCH & QUICK FILTER TABS ================= */}
      <div className="shrink-0 bg-slate-900 border border-slate-800 p-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 shadow-sm">
        
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="İsim, telefon, adres veya nota göre ara..."
            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition shadow-inner font-medium"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <button
            type="button"
            onClick={() => setFilterMode('with_debt')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 border ${
              filterMode === 'with_debt'
                ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                : 'bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-300 shadow-2xs'
            }`}
          >
            <span>Borçlular</span>
            <span className={`px-1.5 py-0.2 text-[10px] rounded-md font-mono ${filterMode === 'with_debt' ? 'bg-black/25 text-white' : 'bg-slate-100 text-slate-700'}`}>{stats.debtCustomerCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('overdue')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 border ${
              filterMode === 'overdue'
                ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                : 'bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-300 shadow-2xs'
            }`}
          >
            <AlertTriangle className={`w-3 h-3 ${filterMode === 'overdue' ? 'text-amber-200' : 'text-amber-600'}`} />
            <span>Gecikmiş (&gt;30 Gün)</span>
            <span className={`px-1.5 py-0.2 text-[10px] rounded-md font-mono ${filterMode === 'overdue' ? 'bg-black/25 text-white' : 'bg-slate-100 text-slate-700'}`}>{stats.overdueCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap border ${
              filterMode === 'all'
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-300 shadow-2xs'
            }`}
          >
            <span>Tüm Müşteriler ({stats.totalCustomers})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('settled')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap border ${
              filterMode === 'settled'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-slate-300 shadow-2xs'
            }`}
          >
            <span>Borcu Olmayanlar</span>
          </button>
        </div>

        {/* Sort Selector */}
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-medium"
          >
            <option value="highest_debt">En Yüksek Borç</option>
            <option value="oldest_debt">En Uzun Bekleyen (En Eski)</option>
            <option value="newest_debt">En Yeni Borç</option>
            <option value="name_asc">İsim (A-Z)</option>
          </select>
        </div>

      </div>

      {/* ================= 4. ROW-BASED MODERN CUSTOMER LIST ================= */}
      <div className="flex-1 overflow-y-auto space-y-2 overscroll-contain pr-1">
        {filteredCustomers.length === 0 ? (
          <div className="py-20 text-center text-slate-500 bg-slate-900/50 border border-slate-800 rounded-3xl">
            <Users className="w-12 h-12 mx-auto mb-2 opacity-30 text-slate-400" />
            <p className="text-sm font-bold text-slate-300">Kriterlere uygun müşteri bulunamadı.</p>
            <p className="text-xs text-slate-500 mt-1">Arama terimini temizleyebilir veya "Tüm Müşteriler" sekmesine geçebilirsiniz.</p>
          </div>
        ) : (
          filteredCustomers.map((cust) => (
            <div
              key={cust.id}
              className="bg-slate-900 hover:bg-slate-850/80 border border-slate-800/90 hover:border-blue-500/40 rounded-2xl p-3 sm:p-4 shadow-sm transition-all duration-150 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 group"
            >
              
              {/* Left Column: Customer Profile, Phone, Address */}
              <div className="flex items-start gap-3 min-w-0 flex-1">
                {/* Initial Avatar */}
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm shrink-0 shadow-inner ${
                  cust.balance > 0 
                    ? cust.isOverdue ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}>
                  {cust.name.slice(0, 2).toUpperCase()}
                </div>

                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 
                      onClick={() => setSelectedCustomer(cust)}
                      className="text-sm sm:text-base font-black text-white hover:text-blue-400 cursor-pointer transition truncate"
                    >
                      {cust.name}
                    </h3>

                    {cust.isOverLimit && (
                      <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3" />
                        Limit Aşımı!
                      </span>
                    )}

                    {cust.autoReminderEnabled && cust.phone && (
                      <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700/60 px-1.5 py-0.2 rounded font-mono" title="Otomatik Hatırlatma Açık">
                        🔔 Oto
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                    {cust.phone ? (
                      <a 
                        href={`tel:${cust.phone}`}
                        className="flex items-center gap-1 hover:text-white font-mono text-[11px] transition"
                        title="Telefonla Ara"
                      >
                        <Phone className="w-3 h-3 text-slate-500" />
                        <span>{cust.phone}</span>
                      </a>
                    ) : (
                      <span className="text-slate-600 text-[11px]">Telefon Yok</span>
                    )}

                    {cust.address && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-400 truncate max-w-[200px]" title={cust.address}>
                        <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="truncate">{cust.address}</span>
                      </span>
                    )}

                    {cust.notes && (
                      <span className="text-[11px] text-slate-500 italic max-w-[150px] truncate" title={cust.notes}>
                        • {cust.notes}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Middle-Left Column: Debt Aging (Ne Zamandan Beri Durduğu) */}
              <div className="w-full lg:w-48 shrink-0 flex flex-row lg:flex-col justify-between lg:justify-center items-start gap-1 py-1 lg:py-0 border-t lg:border-t-0 lg:border-l border-slate-800 lg:pl-4">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Borç Yaşı / Bekleme</span>
                {renderAgingBadge(cust)}
              </div>

              {/* Middle-Right Column: Limit & Limit Progress Bar */}
              <div className="w-full lg:w-40 shrink-0 space-y-1 py-1 lg:py-0 border-t lg:border-t-0 lg:border-l border-slate-800 lg:pl-4">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-slate-400 text-[10px]">Limit Durumu</span>
                  <span className={cust.isOverLimit ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                    %{cust.limitUsagePercent}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                  <div 
                    className={`h-full transition-all duration-300 ${
                      cust.isOverLimit ? 'bg-rose-500' : cust.limitUsagePercent > 75 ? 'bg-amber-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(100, cust.limitUsagePercent)}%` }}
                  />
                </div>
                <div className="text-[10px] text-slate-500 font-mono flex justify-between">
                  <span>Limit: ₺{cust.custLimit.toFixed(0)}</span>
                  <span>{cust.txCount} Hareket</span>
                </div>
              </div>

              {/* Personal Debt Amount Column */}
              <div className="w-full lg:w-36 shrink-0 text-left lg:text-right py-1 lg:py-0 border-t lg:border-t-0 lg:border-l border-slate-800 lg:pl-4 flex flex-row lg:flex-col justify-between items-center lg:items-end">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Kişisel Borç</span>
                <span className={`text-base sm:text-xl font-black font-mono ${
                  cust.balance > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}>
                  ₺{cust.balance.toFixed(2)}
                </span>
              </div>

              {/* Right Column: Quick Actions */}
              <div className="w-full lg:w-auto shrink-0 flex items-center justify-end gap-1.5 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800/80">
                {/* Tahsilat Al (Borç Düş) */}
                {hasPermission('canManageDebt') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomer(cust);
                      setActionAmount(cust.balance > 0 ? cust.balance.toString() : '');
                      setActionNote('');
                      setShowPaymentModal(true);
                    }}
                    className="flex-1 lg:flex-none px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1 shadow-md shadow-emerald-500/20 active:scale-95 transition"
                    title="Ödeme / Tahsilat Al"
                  >
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                    <span>Tahsilat</span>
                  </button>
                )}

                {/* Borç Ekle */}
                {hasPermission('canManageDebt') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomer(cust);
                      setActionAmount('');
                      setActionNote('');
                      setShowAddDebtModal(true);
                    }}
                    className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 border border-slate-700 transition active:scale-95"
                    title="Manuel Veresiye Borç Ekle"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                )}

                {/* WhatsApp Hatırlat */}
                {cust.phone && cust.balance > 0 && (
                  <button
                    type="button"
                    onClick={() => sendWhatsAppReminder(cust)}
                    className="p-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition active:scale-95"
                    title="WhatsApp ile Borç Hatırlatması Gönder"
                  >
                    <MessageCircle className="w-4 h-4" />
                  </button>
                )}

                {/* Ekstre & Detay */}
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(cust)}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition active:scale-95"
                  title="Hesap Hareketleri ve Ekstre İncele"
                >
                  <FileText className="w-4 h-4" />
                </button>
              </div>

            </div>
          ))
        )}
      </div>

      {/* ================= MODAL: CUSTOMER DETAIL & FULL STATEMENT ================= */}
      {selectedCustomer && !showPaymentModal && !showAddDebtModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold">
                  {selectedCustomer.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-black text-white">{selectedCustomer.name}</h3>
                  <p className="text-xs text-slate-400 font-mono">{selectedCustomer.phone || 'Telefon kaydı yok'}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Balance, Debt Aging & Quick Actions Banner */}
            <div className="p-4 bg-slate-950/60 border-b border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-3 bg-slate-900 p-3 rounded-2xl border border-slate-800">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">Mevcut Borç Tutarı</span>
                  <div className={`text-2xl font-black font-mono ${selectedCustomer.balance > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    ₺{selectedCustomer.balance.toFixed(2)}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">Limit: ₺{(selectedCustomer.limit || 2000).toFixed(0)}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadCustomerStatementPDF(selectedCustomer)}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-sm"
                    title="Resmi Hesap Ekstresi PDF İndir"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>PDF Ekstre</span>
                  </button>

                  {selectedCustomer.phone && selectedCustomer.balance > 0 && (
                    <button
                      onClick={() => sendWhatsAppReminder(selectedCustomer)}
                      className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-95 transition"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              {hasPermission('canManageDebt') && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setShowPaymentModal(true); setActionAmount(selectedCustomer.balance.toString()); setActionNote(''); }}
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 active:scale-95 transition"
                  >
                    <ArrowDownLeft className="w-4 h-4" />
                    <span>Tahsilat Al (Borç Düş)</span>
                  </button>

                  <button
                    onClick={() => { setShowAddDebtModal(true); setActionAmount(''); setActionNote(''); }}
                    className="bg-slate-800 hover:bg-slate-700 text-rose-400 border border-rose-500/30 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 active:scale-95 transition"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>Manuel Borç Ekle</span>
                  </button>
                </div>
              )}
            </div>

            {/* Transaction Ledger History List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 overscroll-contain">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Hesap Hareketleri Defteri</span>
                <span className="text-[10px] text-slate-500 font-mono">{transactions.length} İşlem</span>
              </h4>

              {transactions.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">Kayıtlı işlem hareketi bulunamadı.</p>
              ) : (
                transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between font-mono text-xs hover:border-slate-700 transition"
                  >
                    <div className="space-y-0.5 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold font-sans ${
                          tx.type === 'payment'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}>
                          {tx.type === 'payment' ? 'Tahsilat / Ödeme' : 'Veresiye / Borç'}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(tx.date).toLocaleDateString('tr-TR')} {new Date(tx.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-white font-sans truncate">{tx.note || 'İşlem'}</p>
                    </div>

                    <span className={`text-sm font-black shrink-0 ${
                      tx.type === 'payment' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {tx.type === 'payment' ? '-' : '+'}₺{Number(tx.amount || 0).toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-500">Kayıt Tarihi: {selectedCustomer.createdAt ? new Date(selectedCustomer.createdAt).toLocaleDateString('tr-TR') : '-'}</span>
              {selectedCustomer.balance <= 0 && (
                <button
                  type="button"
                  onClick={() => handleArchiveSettledCustomer(selectedCustomer.id)}
                  className="text-rose-400 hover:underline text-xs"
                >
                  Müşteriyi Arşivle / Kaldır
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ================= MODAL: RECORD PAYMENT (TAHSİLAT) ================= */}
      {showPaymentModal && selectedCustomer && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <form onSubmit={handleRecordPayment} className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-5 space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>Tahsilat Al ({selectedCustomer.name})</span>
              </h4>
              <button type="button" onClick={() => setShowPaymentModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex justify-between text-xs font-mono">
              <span className="text-slate-400">Mevcut Borç:</span>
              <span className="font-bold text-rose-400">₺{selectedCustomer.balance.toFixed(2)}</span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-300 font-bold">Ödenen Tutar (₺)</label>
                {selectedCustomer.balance > 0 && (
                  <button
                    type="button"
                    onClick={() => setActionAmount(selectedCustomer.balance.toString())}
                    className="text-[10px] text-emerald-400 hover:underline font-bold"
                  >
                    Tüm Borcu Kapat
                  </button>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={actionAmount}
                onChange={(e) => setActionAmount(e.target.value)}
                className="w-full bg-slate-950 border border-emerald-500/50 rounded-xl px-3 py-2 text-xl text-emerald-400 font-mono font-black focus:outline-none focus:border-emerald-500"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Açıklama / Not</label>
              <input
                type="text"
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                placeholder="Örn: Nakit elden ödendi..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                İptal
              </button>
              <button
                type="submit"
                className="py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black shadow-lg shadow-emerald-500/20 active:scale-95 transition"
              >
                Tahsilatı Kaydet
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL: ADD MANUAL DEBT (BORÇ EKLE) ================= */}
      {showAddDebtModal && selectedCustomer && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <form onSubmit={handleAddManualDebt} className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-5 space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4 text-rose-400" />
                <span>Manuel Borç Ekle ({selectedCustomer.name})</span>
              </h4>
              <button type="button" onClick={() => setShowAddDebtModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Borç Tutarı (₺)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={actionAmount}
                onChange={(e) => setActionAmount(e.target.value)}
                className="w-full bg-slate-950 border border-rose-500/50 rounded-xl px-3 py-2 text-xl text-rose-400 font-mono font-black focus:outline-none focus:border-rose-500"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Açıklama / Alınan Ürünler</label>
              <input
                type="text"
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                placeholder="Örn: 2 Paket Sigara, 1 Ekmek"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddDebtModal(false)}
                className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                İptal
              </button>
              <button
                type="submit"
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black shadow-lg shadow-rose-600/20 active:scale-95 transition"
              >
                Borcu Kaydet
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL: ADD NEW CUSTOMER ================= */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
          <form onSubmit={handleCreateCustomer} className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="font-black text-white text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />
                <span>Yeni Müşteri Kartı</span>
              </h3>
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Müşteri Adı Soyadı *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Örn: Mehmet Özkan"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-semibold"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Telefon Numarası</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Örn: 0532 000 00 00"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-300 font-bold block mb-1">Adres / Daire</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Örn: Kat: 3 D: 5"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-bold block mb-1">Borç Limiti (₺)</label>
                <input
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Notlar</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Örn: Ayın 1'inde veya 15'inde öder"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[11px] text-slate-300 cursor-pointer">
                <span>Oto. Hatırlatma</span>
                <input
                  type="checkbox"
                  checked={autoReminderEnabled}
                  onChange={(e) => setAutoReminderEnabled(e.target.checked)}
                  className="h-4 w-4 accent-blue-600 rounded cursor-pointer"
                />
              </label>

              <div>
                <select
                  value={reminderFrequency}
                  onChange={(e) => setReminderFrequency(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-[11px] text-white focus:outline-none focus:border-blue-500 font-medium"
                >
                  <option value="weekly">Haftalık Hatırlat</option>
                  <option value="monthly">Aylık Hatırlat</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-2.5 rounded-xl text-xs sm:text-sm shadow-lg shadow-blue-600/20 active:scale-98 transition mt-2"
            >
              Müşteriyi Kaydet
            </button>
          </form>
        </div>
      )}

    </div>
  );
}
