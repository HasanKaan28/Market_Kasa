import React, { useState, useMemo } from 'react';
import { X, Banknote, CreditCard, UserCheck, Split, Check, AlertCircle, Plus, Sparkles } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import confetti from 'canvas-confetti';
import { playCashRegisterSound } from '../utils/sound';

export default function PaymentModal({ total, onComplete, onClose }) {
  const [method, setMethod] = useState('cash'); // cash | card | debt | split
  const [cashGiven, setCashGiven] = useState(total.toString());
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [splitCash, setSplitCash] = useState((Math.floor(total / 2)).toString());

  const customers = useLiveQuery(() => db.customers.toArray(), []);

  const numCashGiven = parseFloat(cashGiven) || 0;
  const changeGiven = Math.max(0, numCashGiven - total);
  const isCashSufficient = numCashGiven >= total - 0.01;

  // Split payment calculations
  const numSplitCash = parseFloat(splitCash) || 0;
  const splitCard = Math.max(0, total - numSplitCash);

  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers?.find(c => String(c.id) === String(selectedCustomerId)) || null;
  }, [customers, selectedCustomerId]);

  const handleKeypadPress = (val) => {
    if (val === 'C') {
      setCashGiven('0');
    } else if (val === 'backspace') {
      setCashGiven(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
    } else if (val === '.') {
      if (!cashGiven.includes('.')) setCashGiven(prev => prev + '.');
    } else {
      setCashGiven(prev => prev === '0' ? val : prev + val);
    }
  };

  const setPresetCash = (amount) => {
    setCashGiven(amount.toString());
  };

  const handleCreateCustomer = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!newCustomerName.trim()) {
      alert('Lütfen müşteri adını girin!');
      return;
    }
    const nowIso = new Date().toISOString();
    const id = await db.customers.add({
      name: newCustomerName.trim(),
      phone: newCustomerPhone.trim(),
      balance: 0,
      limit: 2500,
      createdAt: nowIso,
      updatedAt: nowIso
    });
    setSelectedCustomerId(String(id));
    setShowAddCustomer(false);
    setNewCustomerName('');
    setNewCustomerPhone('');
  };

  const handleFinalize = () => {
    if (method === 'cash' && !isCashSufficient) {
      alert('Alınan nakit tutar toplam tutardan az olamaz!');
      return;
    }
    if (method === 'debt' && !selectedCustomerId) {
      alert('Lütfen veresiye yazılacak müşteriyi seçin!');
      return;
    }

    // Fire celebratory confetti & sound
    try {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.7 }
      });
    } catch {}

    playCashRegisterSound();

    onComplete({
      paymentMethod: method,
      cashGiven: method === 'cash' ? numCashGiven : (method === 'split' ? numSplitCash : total),
      changeGiven: method === 'cash' ? changeGiven : 0,
      customerId: method === 'debt' ? (selectedCustomer ? selectedCustomer.id : selectedCustomerId) : null,
      customerName: method === 'debt' ? (selectedCustomer ? selectedCustomer.name : 'Müşteri') : null,
      splitDetails: method === 'split' ? { cash: numSplitCash, card: splitCard } : null
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center safe-bottom animate-fade-in">
      <div className="bg-white border border-slate-200 w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tahsilat / Ödeme</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black text-emerald-600">₺{total.toFixed(2)}</span>
              <span className="text-xs text-slate-500 font-medium">Ödenecek Tutar</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-slate-100 text-slate-500 hover:text-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Method Switcher Tabs */}
        <div className="grid grid-cols-4 gap-1 p-2 bg-slate-100 border-b border-slate-200">
          <button
            onClick={() => { setMethod('cash'); setCashGiven(total.toString()); }}
            className={`flex flex-col items-center py-2 px-1 rounded-xl text-xs font-bold transition ${
              method === 'cash'
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Banknote className="w-5 h-5 mb-0.5" />
            <span>Nakit</span>
          </button>

          <button
            onClick={() => setMethod('card')}
            className={`flex flex-col items-center py-2 px-1 rounded-xl text-xs font-bold transition ${
              method === 'card'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-200'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <CreditCard className="w-5 h-5 mb-0.5" />
            <span>Kredi Kartı</span>
          </button>

          <button
            onClick={() => setMethod('debt')}
            className={`flex flex-col items-center py-2 px-1 rounded-xl text-xs font-bold transition ${
              method === 'debt'
                ? 'bg-amber-500 text-white shadow-md shadow-amber-200'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <UserCheck className="w-5 h-5 mb-0.5" />
            <span>Veresiye</span>
          </button>

          <button
            onClick={() => setMethod('split')}
            className={`flex flex-col items-center py-2 px-1 rounded-xl text-xs font-bold transition ${
              method === 'split'
                ? 'bg-violet-500 text-white shadow-md shadow-violet-200'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Split className="w-5 h-5 mb-0.5" />
            <span>Parçalı</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* TAB 1: NAKİT */}
          {method === 'cash' && (
            <div className="space-y-3">
              {/* Change calculation card */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800/80 border border-slate-700 p-3 rounded-2xl">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Alınan Nakit</span>
                  <div className="text-xl sm:text-2xl font-black text-white font-mono mt-0.5">
                    ₺{numCashGiven.toFixed(2)}
                  </div>
                </div>

                <div className={`p-3 rounded-2xl border transition-colors ${
                  isCashSufficient
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400'
                    : 'bg-rose-950/40 border-rose-500/50 text-rose-400'
                }`}>
                  <span className="text-[10px] uppercase font-bold tracking-wider">
                    {isCashSufficient ? 'Para Üstü' : 'Eksik Tutar'}
                  </span>
                  <div className="text-xl sm:text-2xl font-black font-mono mt-0.5">
                    ₺{isCashSufficient ? changeGiven.toFixed(2) : (total - numCashGiven).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Quick Cash Presets */}
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  onClick={() => setPresetCash(total)}
                  className="bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 py-2 rounded-xl text-xs font-bold active:scale-95 transition"
                >
                  Tam Tutar
                </button>
                {[50, 100, 200, 500].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setPresetCash(amt)}
                    className="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 py-2 rounded-xl text-xs font-bold active:scale-95 transition"
                  >
                    ₺{amt}
                  </button>
                ))}
              </div>

              {/* Touch Numpad */}
              <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto pt-1">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '.'].map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleKeypadPress(key)}
                    className={`h-11 rounded-xl text-lg font-bold flex items-center justify-center transition active:scale-95 ${
                      key === 'C'
                        ? 'bg-rose-900/30 text-rose-400 border border-rose-700/50 hover:bg-rose-900/50'
                        : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: KREDİ KARTI */}
          {method === 'card' && (
            <div className="py-6 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-16 h-16 rounded-3xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 animate-pulse">
                <CreditCard className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">Banka / POS Cihazı</h4>
                <p className="text-xs text-slate-400 max-w-xs mt-1">
                  Müşterinin kartını banka pos cihazından <b>₺{total.toFixed(2)}</b> olarak çekin. Onay alındığında alttaki butona tıklayın.
                </p>
              </div>
              <div className="bg-slate-800/80 px-4 py-2 rounded-xl text-xs font-mono text-blue-300 border border-blue-500/20">
                Temassız / Çip / QR Kod ile Ödeme
              </div>
            </div>
          )}

          {/* TAB 3: VERESİYE */}
          {method === 'debt' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-600">Müşteri Seçin</label>
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(!showAddCustomer)}
                  className="text-xs text-emerald-400 font-semibold flex items-center gap-1 hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showAddCustomer ? 'Listeye Dön' : 'Yeni Müşteri Ekle'}</span>
                </button>
              </div>

              {showAddCustomer ? (
                <form onSubmit={handleCreateCustomer} className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700 space-y-2">
                  <p className="text-xs font-bold text-emerald-400">Hızlı Müşteri Kaydı</p>
                  <input
                    type="text"
                    placeholder="Müşteri Adı Soyadı *"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="tel"
                    placeholder="Telefon Numarası (Opsiyonel)"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={handleCreateCustomer}
                    className="w-full bg-emerald-500 text-slate-950 font-bold py-2 rounded-xl text-xs active:scale-95 transition"
                  >
                    Kaydet ve Bu Müşteriye Yaz
                  </button>
                </form>
              ) : (
                <div className="space-y-2">
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3 py-3 text-sm text-slate-800 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">-- Müşteri Seçin --</option>
                    {customers?.map((cust) => (
                      <option key={cust.id} value={cust.id}>
                        {cust.name} (Mevcut Borç: ₺{(Number(cust.balance) || 0).toFixed(2)})
                      </option>
                    ))}
                  </select>

                  {selectedCustomer && (
                    <div className="bg-amber-950/20 border border-amber-500/30 p-3 rounded-2xl space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Mevcut Borç:</span>
                        <span className="text-white font-mono font-bold">₺{(Number(selectedCustomer.balance) || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Bu Satış:</span>
                        <span className="text-amber-400 font-mono font-bold">+₺{total.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold border-t border-amber-500/20 pt-1 text-amber-300">
                        <span>Yeni Toplam Borç:</span>
                        <span className="font-mono">₺{((Number(selectedCustomer.balance) || 0) + total).toFixed(2)}</span>
                      </div>
                      {selectedCustomer.notes && (
                        <p className="text-[10px] text-slate-400 italic mt-1">Not: {selectedCustomer.notes}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: PARÇALI */}
          {method === 'split' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">Tutarı nakit ve kart olarak paylaştırın:</p>
              
              <div className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                    <Banknote className="w-4 h-4" /> Nakit Tutarı
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-white">₺</span>
                    <input
                      type="number"
                      value={splitCash}
                      onChange={(e) => setSplitCash(e.target.value)}
                      max={total}
                      min={0}
                      step="0.5"
                      className="w-24 bg-white border border-slate-200 rounded-lg px-2 py-1 text-right font-mono text-sm text-emerald-600 font-bold focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-700/60 pt-2">
                  <span className="text-xs font-bold text-blue-400 flex items-center gap-1">
                    <CreditCard className="w-4 h-4" /> Kalan Kart Tutarı
                  </span>
                  <span className="text-sm font-black font-mono text-blue-400">
                    ₺{splitCard.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer Checkout Finalize Button */}
        <div className="p-4 bg-slate-950 border-t border-slate-800">
          <button
            type="button"
            onClick={handleFinalize}
            disabled={method === 'cash' && !isCashSufficient}
            className={`w-full py-3.5 px-4 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-xl active:scale-98 transition ${
              method === 'cash' && !isCashSufficient
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
            }`}
          >
            <Check className="w-5 h-5" />
            <span>
              {method === 'cash'
                ? `Satışı Tamamla (${changeGiven > 0 ? `Üst: ₺${changeGiven.toFixed(2)}` : 'Nakit'})`
                : method === 'card'
                ? 'Kart Ödemesini Onayla'
                : method === 'debt'
                ? 'Veresiye Hesabına Kaydet'
                : 'Parçalı Satışı Tamamla'}
            </span>
          </button>
        </div>

      </div>
    </div>
  );
}
