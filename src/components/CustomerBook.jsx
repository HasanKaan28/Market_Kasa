import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Search, Phone, MapPin, User, ArrowUpRight, 
  ArrowDownLeft, MessageCircle, FileText, X, Check, DollarSign, Bell, CalendarDays 
} from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';

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
  const [search, setSearch] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showAddDebtModal, setShowAddDebtModal] = useState(false);
  const [showSettledCustomers, setShowSettledCustomers] = useState(false);
  const [actionAmount, setActionAmount] = useState('');
  const [actionNote, setActionNote] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [limit, setLimit] = useState('2000');
  const [notes, setNotes] = useState('');
  const [reminderFrequency, setReminderFrequency] = useState('weekly');
  const [autoReminderEnabled, setAutoReminderEnabled] = useState(true);

  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const transactions = useLiveQuery(
    () => selectedCustomer ? db.customerTransactions.where('customerId').equals(selectedCustomer.id).reverse().toArray() : [],
    [selectedCustomer]
  );

  // Filter customers
  const filteredCustomers = customers?.filter(c => {
    if (c.archived) return false;
    const q = search.toLowerCase();
    const matchesQuery = c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
    if (!matchesQuery) return false;
    if (!showSettledCustomers && c.balance <= 0) return false;
    return true;
  }) || [];

  const dueReminderCustomers = useMemo(
    () => (customers || []).filter(c => c.balance > 0 && c.autoReminderEnabled && c.phone && (!c.nextReminderAt || new Date(c.nextReminderAt).getTime() <= Date.now())),
    [customers]
  );

  // Totals
  const totalDebt = customers?.reduce((sum, c) => sum + (c.balance || 0), 0) || 0;
  const customersWithDebt = customers?.filter(c => c.balance > 0).length || 0;

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
      const msg = `Merhaba Sayın ${customer.name},\nMarketimizde bulunan veresiye hesabınızın güncel bakiye tutarı: *₺${(customer.balance || 0).toFixed(2)}*'dir.\nMüsait bir zamanınızda ödeme yapmayı rica ederiz. Teşekkür ederiz.`;
      if (customer.phone) {
        openWhatsAppChat(customer.phone, msg);
      }
      }
    }, 60000);

    return () => clearInterval(timer);
  }, [customers]);

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

    setName('');
    setPhone('');
    setAddress('');
    setLimit('2000');
    setNotes('');
    setReminderFrequency('weekly');
    setAutoReminderEnabled(true);
    setIsAddModalOpen(false);
  };

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

    // Update local state
    setSelectedCustomer(prev => ({ ...prev, balance: newBalance }));
    setActionAmount('');
    setActionNote('');
    setShowPaymentModal(false);
  };

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
      note: actionNote.trim() || 'Manuel Borç / Alışveriş'
    };
    await db.customerTransactions.add(tx);

    sync.broadcast('CUSTOMER_BALANCE_UPDATED', {
      customerId: selectedCustomer.id,
      newBalance,
      transaction: tx
    });
    googleDriveSync.triggerOnSaleSync();

    setSelectedCustomer(prev => ({ ...prev, balance: newBalance }));
    setActionAmount('');
    setActionNote('');
    setShowAddDebtModal(false);
  };

  const sendWhatsAppReminder = async (customer, options = {}) => {
    if (!customer.phone) {
      alert('Müşterinin telefon numarası kayıtlı değil!');
      return;
    }

    const normalizedPhone = normalizePhoneNumber(customer.phone || '');
    if (!normalizedPhone) {
      alert('Müşteri telefon numarası geçerli değil.');
      return;
    }

    const msg = `Merhaba Sayın ${customer.name},\nMarketimizde bulunan veresiye hesabınızın güncel bakiye tutarı: *₺${(customer.balance || 0).toFixed(2)}*'dir.\nMüsait bir zamanınızda ödeme yapmayı rica ederiz. Teşekkür ederiz.`;
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

  const handleToggleReminder = async (customerId, enabled) => {
    const customer = customers?.find(c => c.id === customerId);
    if (!customer) return;

    const next = enabled ? getNextReminderDate(customer.reminderFrequency || 'weekly', new Date()) : null;
    await db.customers.update(customerId, {
      autoReminderEnabled: enabled,
      nextReminderAt: next
    });
  };

  const handleArchiveSettledCustomer = async (customerId) => {
    const customer = customers?.find(c => c.id === customerId);
    if (!customer) return;

    await db.customers.update(customerId, {
      archived: true,
      archivedAt: new Date().toISOString(),
      autoReminderEnabled: false,
      nextReminderAt: null
    });

    setSelectedCustomer(null);
    setShowSettledCustomers(false);
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-57px-60px)] max-w-lg mx-auto bg-slate-50 text-slate-800 overflow-hidden">
      
      {/* Top Header & Summary */}
      <div className="p-3 bg-white border-b border-slate-200 space-y-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>Veresiye Defteri</span>
            <span className="text-xs bg-slate-100 text-slate-600 font-mono px-2 py-0.5 rounded-full border border-slate-200">
              {customers?.filter(c => c.balance > 0).length || 0} Kişi
            </span>
          </h2>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettledCustomers(prev => !prev)}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition ${
                showSettledCustomers
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              {showSettledCustomers ? 'Tümü' : 'Borçlular'}
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow-lg shadow-blue-200 active:scale-95 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Yeni Müşteri</span>
            </button>
          </div>
        </div>
 
        {/* Debt Overview Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Piyasadaki Toplam Alacak</span>
            <span className="text-xl font-black text-rose-500 font-mono">
              ₺{totalDebt.toFixed(2)}
            </span>
          </div>
 
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Borçlu Müşteri</span>
            <span className="text-xl font-black text-amber-600 font-mono">
              {customersWithDebt} <span className="text-xs font-normal text-slate-500">Kişi</span>
            </span>
          </div>
        </div>

        {dueReminderCustomers.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-200">
            <Bell className="w-3.5 h-3.5" />
            <span>{dueReminderCustomers.length} müşteriye otomatik hatırlatma hazır.</span>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Müşteri adı veya telefon ile ara..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-2.5 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Customers List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredCustomers.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <p className="text-sm font-semibold">Müşteri bulunamadı.</p>
            <p className="text-xs text-slate-600 mt-1">Veresiye alışveriş yapacak müşterileri buradan ekleyebilirsiniz.</p>
          </div>
        ) : (
          filteredCustomers.map((cust) => (
            <div
              key={cust.id}
              onClick={() => setSelectedCustomer(cust)}
              className="bg-white border border-slate-200 hover:border-blue-200 rounded-2xl p-3.5 flex items-center justify-between gap-3 cursor-pointer active:scale-98 transition shadow-sm"
            >
              <div className="space-y-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-900 truncate">{cust.name}</h4>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {cust.phone && (
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <Phone className="w-3 h-3 text-slate-500" />
                      {cust.phone}
                    </span>
                  )}
                  {cust.address && (
                    <span className="flex items-center gap-1 text-[11px] truncate max-w-[120px]">
                      <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                      {cust.address}
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="text-[10px] text-slate-500 uppercase block font-bold">Bakiye</span>
                <span className={`text-base font-black font-mono ${
                  cust.balance > 0 ? 'text-rose-500' : 'text-emerald-600'
                }`}>
                  ₺{cust.balance.toFixed(2)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Customer Detail & Transactions Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 safe-bottom animate-fade-in">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            
            {/* Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-slate-900">{selectedCustomer.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedCustomer.phone || 'Telefon kaydı yok'}</p>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="p-1.5 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Balance & Action Bar */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">Mevcut Borç Tutarı</span>
                  <div className="text-2xl font-black text-rose-500 font-mono">
                    ₺{selectedCustomer.balance.toFixed(2)}
                  </div>
                </div>

                {selectedCustomer.phone && (
                  <button
                    onClick={() => sendWhatsAppReminder(selectedCustomer)}
                    className="bg-blue-100 text-blue-700 border border-blue-200 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition shadow-sm"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>WhatsApp Hatırlat</span>
                  </button>
                )}

                {selectedCustomer.balance <= 0 && (
                  <button
                    type="button"
                    onClick={() => handleArchiveSettledCustomer(selectedCustomer.id)}
                    className="bg-red-100 text-red-600 border border-red-200 px-2.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-95 transition shadow-sm"
                    title="Borcu kapatılan müşteriyi defterden kaldır"
                  >
                    <X className="w-4 h-4" />
                    <span>Defterden Kaldır</span>
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2 shadow-sm">
                <div className="flex items-center justify-between text-[11px] text-slate-700">
                  <span className="flex items-center gap-1.5"><Bell className="w-3.5 h-3.5 text-amber-500" />Otomatik hatırlatma</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextState = !selectedCustomer.autoReminderEnabled;
                      handleToggleReminder(selectedCustomer.id, nextState);
                      setSelectedCustomer(prev => ({ ...prev, autoReminderEnabled: nextState }));
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full ${selectedCustomer.autoReminderEnabled ? 'bg-blue-500' : 'bg-slate-300'}`}
                    aria-label="Otomatik hatırlatma"
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition ${selectedCustomer.autoReminderEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase text-slate-500 block">Sıklık</label>
                    <select
                      value={selectedCustomer.reminderFrequency || 'weekly'}
                      onChange={async (e) => {
                        const frequency = e.target.value;
                        await db.customers.update(selectedCustomer.id, {
                          reminderFrequency: frequency,
                          nextReminderAt: getNextReminderDate(frequency, new Date())
                        });
                        setSelectedCustomer(prev => ({ ...prev, reminderFrequency: frequency, nextReminderAt: getNextReminderDate(frequency, new Date()) }));
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] text-slate-700 focus:outline-none focus:border-blue-500"
                    >
                      <option value="weekly">Haftalık</option>
                      <option value="monthly">Aylık</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase text-slate-500 block">Son Hatırlatma</label>
                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-700">
                      <CalendarDays className="w-3 h-3 text-slate-500" />
                      <span>{selectedCustomer.lastReminderAt ? new Date(selectedCustomer.lastReminderAt).toLocaleDateString('tr-TR') : 'Henüz yok'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              {hasPermission('canManageDebt') && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => { setShowPaymentModal(true); setActionAmount(selectedCustomer.balance.toString()); }}
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 active:scale-95 transition"
                  >
                    <ArrowDownLeft className="w-4 h-4" />
                    <span>Tahsilat Al (Borç Düş)</span>
                  </button>

                  <button
                    onClick={() => { setShowAddDebtModal(true); setActionAmount(''); }}
                    className="bg-slate-800 hover:bg-slate-700 text-rose-400 border border-rose-500/30 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 active:scale-95 transition"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>Manuel Borç Ekle</span>
                  </button>
                </div>
              )}
            </div>

            {/* Transaction Ledger History */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Hesap Hareketleri</h4>
              {(!transactions || transactions.length === 0) ? (
                <p className="text-xs text-slate-500 text-center py-6">Kayıtlı işlem hareketi yok.</p>
              ) : (
                transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-2.5 flex items-center justify-between"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                          tx.type === 'payment'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          {tx.type === 'payment' ? 'Tahsilat / Ödeme' : 'Veresiye / Borç'}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(tx.date).toLocaleDateString('tr-TR')} {new Date(tx.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-white font-medium">{tx.note || 'İşlem'}</p>
                    </div>

                    <span className={`text-sm font-black font-mono ${
                      tx.type === 'payment' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {tx.type === 'payment' ? '-' : '+'}₺{tx.amount.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>

          </div>
        </div>
      )}

      {/* Collect Payment Modal */}
      {showPaymentModal && selectedCustomer && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleRecordPayment} className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-5 space-y-3 shadow-2xl">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span>Tahsilat Kaydet ({selectedCustomer.name})</span>
            </h4>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Ödenen Tutar (₺)</label>
              <input
                type="number"
                step="0.01"
                required
                value={actionAmount}
                onChange={(e) => setActionAmount(e.target.value)}
                className="w-full bg-slate-950 border border-emerald-500/50 rounded-xl px-3 py-2 text-lg text-emerald-400 font-mono font-bold focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Açıklama / Not</label>
              <input
                type="text"
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                placeholder="Örn: Nakit Elden Ödedi"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="py-2.5 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold"
              >
                İptal
              </button>
              <button
                type="submit"
                className="py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black shadow-lg shadow-emerald-500/20"
              >
                Tahsilatı Onayla
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Manual Debt Add Modal */}
      {showAddDebtModal && selectedCustomer && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleAddManualDebt} className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-5 space-y-3 shadow-2xl">
            <h4 className="text-sm font-bold text-white">Manuel Borç Ekle ({selectedCustomer.name})</h4>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Borç Tutarı (₺)</label>
              <input
                type="number"
                step="0.01"
                required
                value={actionAmount}
                onChange={(e) => setActionAmount(e.target.value)}
                className="w-full bg-slate-950 border border-rose-500/50 rounded-xl px-3 py-2 text-lg text-rose-400 font-mono font-bold focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Açıklama / Alınanlar</label>
              <input
                type="text"
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                placeholder="Örn: 2 Paket Sigara, 1 Ekmek"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddDebtModal(false)}
                className="py-2.5 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold"
              >
                İptal
              </button>
              <button
                type="submit"
                className="py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black shadow-lg shadow-rose-600/20"
              >
                Borcu Kaydet
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add New Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 safe-bottom">
          <form onSubmit={handleCreateCustomer} className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between pb-1 border-b border-slate-800">
              <h3 className="font-bold text-white text-sm">Yeni Müşteri Kartı</h3>
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
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Telefon Numarası</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Örn: 0532 000 00 00"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-300 font-bold block mb-1">Adres / Daire</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Örn: D: 5"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-bold block mb-1">Borç Limiti (₺)</label>
                <input
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-300 font-bold block mb-1">Notlar</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Örn: Ay başında öder"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200">
                <span>Otomatik hatırlat</span>
                <input
                  type="checkbox"
                  checked={autoReminderEnabled}
                  onChange={(e) => setAutoReminderEnabled(e.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>

              <div>
                <label className="text-[11px] text-slate-300 font-bold block mb-1">Hatırlatma sıklığı</label>
                <select
                  value={reminderFrequency}
                  onChange={(e) => setReminderFrequency(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2 py-2 text-[11px] text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="weekly">Haftalık</option>
                  <option value="monthly">Aylık</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3 rounded-2xl text-sm shadow-lg shadow-emerald-500/20 active:scale-98 transition mt-2"
            >
              Müşteriyi Kaydet
            </button>
          </form>
        </div>
      )}

    </div>
  );
}
