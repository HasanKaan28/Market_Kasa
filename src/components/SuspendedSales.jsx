import React from 'react';
import { X, Clock, ShoppingBag, ArrowRight, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

export default function SuspendedSales({ onRestore, onClose }) {
  const suspended = useLiveQuery(() => db.suspendedSales.toArray(), []);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (confirm('Bu bekletilen sepeti silmek istiyor musunuz?')) {
      await db.suspendedSales.delete(id);
    }
  };

  const handleSelect = async (sale) => {
    await db.suspendedSales.delete(sale.id);
    onRestore(sale.items);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 safe-bottom">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up">
        
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-white text-base">Askıya Alınan Sepetler</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {(!suspended || suspended.length === 0) ? (
            <div className="text-center py-10 text-slate-400">
              <ShoppingBag className="w-12 h-12 mx-auto text-slate-600 mb-2 stroke-1" />
              <p className="text-sm font-medium">Bekleyen sepet bulunmuyor.</p>
              <p className="text-xs text-slate-500 mt-1">Kasa ekranındaki "Beklet" butonu ile müşteri sepetini askıya alabilirsiniz.</p>
            </div>
          ) : (
            suspended.map((sale) => {
              const totalAmount = sale.items.reduce((sum, it) => sum + it.total, 0);
              const itemCount = sale.items.reduce((sum, it) => sum + it.quantity, 0);
              const timeStr = new Date(sale.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

              return (
                <div
                  key={sale.id}
                  onClick={() => handleSelect(sale)}
                  className="bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-2xl p-3.5 cursor-pointer active:scale-98 transition group flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded">
                        {timeStr}
                      </span>
                      <span className="text-xs text-slate-400 font-medium">
                        {sale.note || `${itemCount} Adet Ürün`}
                      </span>
                    </div>
                    <div className="text-lg font-black text-emerald-400 font-mono">
                      ₺{totalAmount.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-slate-400 line-clamp-1">
                      {sale.items.map(i => `${i.name} (${i.quantity})`).join(', ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => handleDelete(sale.id, e)}
                      className="p-2 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                      title="Sepeti Sil"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-slate-950 transition">
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  );
}
