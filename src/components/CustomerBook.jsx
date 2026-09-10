import React, { useState } from 'react';
import { 
  Plus, Search, Phone, MapPin, User, ArrowUpRight, 
  ArrowDownLeft, MessageCircle, FileText, X, Check, DollarSign 
} from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../context/AuthContext';
import { sync } from '../utils/sync';
import { googleDriveSync } from '../utils/googleDriveSync';

export default function CustomerBook() {
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showAddDebtModal, setShowAddDebtModal] = useState(false);
  const [actionAmount, setActionAmount] = useState('');
  const [actionNote, setActionNote] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [limit, setLimit] = useState('2000');
  const [notes, setNotes] = useState('');

  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const transactions = useLiveQuery(
    () => selectedCustomer ? db.customerTransactions.where('customerId').equals(selectedCustomer.id).reverse().toArray() : [],
    [selectedCustomer]
  );

  // Filter customers
  const filteredCustomers = customers?.filter(c => {
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
  }) || [];

  // Totals
  const totalDebt = customers?.reduce((sum, c) => sum + (c.balance || 0), 0) || 0;
  const customersWithDebt = customers?.filter(c => c.balance > 0).length || 0;

  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newCust = {
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      balance: 0,
      limit: parseFloat(limit) || 2000,
      notes: notes.trim(),
      createdAt: new Date().toISOString()
    };
    const newId = await db.customers.add(newCust);
    sync.broadcast('CUSTOMER_SAVED', { customer: { id: newId, ...newCust } });
    googleDriveSync.triggerOnSaleSync();

    setName('');
    setPhone('');
    setAddress('');
    setLimit('2000');
    setNotes('');
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

  const sendWhatsAppReminder = (customer) => {
    if (!customer.phone) {
      alert('Müşterinin telefon numarası kayıtlı değil!');
      return;
    }
    const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
    const phoneWithCountry = cleanPhone.startsWith('90') ? cleanPhone : (cleanPhone.startsWith('0') ? '9' + cleanPhone : '90' + cleanPhone);
    const msg = `Merhaba Sayın ${customer.name},\nMarketimizde bulunan veresiye hesabınızın güncel bakiye tutarı: *₺${customer.balance.toFixed(2)}*'dir.\nMüsait bir zamanınızda bekler, hayırlı günler dileriz.`;
    window.open(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-57px-60px)] max-w-lg mx-auto bg-slate-950 overflow-hidden">
      
      {/* Top Header & Summary */}
      <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span>Veresiye Defteri</span>
            <span className="text-xs bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded-full border border-slate-700">
              {customers?.length || 0} Kişi
            </span>
          </h2>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow-lg shadow-emerald-500/20 active:scale-95 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Müşteri</span>
          </button>
        </div>

        {/* Debt Overview Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Piyasadaki Toplam Alacak</span>
            <span className="text-xl font-black text-rose-400 font-mono">
              ₺{totalDebt.toFixed(2)}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Borçlu Müşteri</span>
            <span className="text-xl font-black text-amber-400 font-mono">
              {customersWithDebt} <span className="text-xs font-normal text-slate-400">Kişi</span>
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Müşteri adı veya telefon ile ara..."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
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
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-3.5 flex items-center justify-between gap-3 cursor-pointer active:scale-98 transition shadow-sm"
            >
              <div className="space-y-1 min-w-0">
                <h4 className="text-sm font-bold text-white truncate">{cust.name}</h4>
                <div className="flex items-center gap-3 text-xs text-slate-400">
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
                  cust.balance > 0 ? 'text-rose-400' : 'text-emerald-400'
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
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">{selectedCustomer.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{selectedCustomer.phone || 'Telefon kaydı yok'}</p>
              </div>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Balance & Action Bar */}
            <div className="p-4 bg-slate-950 border-b border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500">Mevcut Borç Tutarı</span>
                  <div className="text-2xl font-black text-rose-400 font-mono">
                    ₺{selectedCustomer.balance.toFixed(2)}
                  </div>
                </div>

                {selectedCustomer.phone && selectedCustomer.balance > 0 && (
                  <button
                    onClick={() => sendWhatsAppReminder(selectedCustomer)}
                    className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>WhatsApp Hatırlat</span>
                  </button>
                )}
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
