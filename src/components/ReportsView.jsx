import React, { useState, useMemo } from 'react';
import { 
  BarChart3, Calendar, DollarSign, TrendingUp, ShoppingBag, 
  CreditCard, Banknote, UserCheck, Printer, RotateCcw, Eye, Download, X
} from 'lucide-react';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import ReceiptModal from './ReceiptModal';
import { jsPDF } from 'jspdf';
import { useAuth } from '../context/AuthContext';
import { sync } from '../utils/sync';

export default function ReportsView() {
  const { hasPermission } = useAuth();
  const [period, setPeriod] = useState('today'); // today | yesterday | week | month | all
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [showZReportModal, setShowZReportModal] = useState(false);

  const sales = useLiveQuery(() => db.sales.reverse().toArray(), []);
  const storeSettings = useLiveQuery(async () => {
    const list = await db.settings.toArray();
    return list.reduce((acc, cur) => ({ ...acc, [cur.key]: cur.value }), {});
  }, []);

  // Filter sales by date period
  const filteredSales = useMemo(() => {
    if (!sales) return [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - (24 * 60 * 60 * 1000);
    const weekStart = todayStart - (7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return sales.filter(s => {
      const saleTime = new Date(s.date).getTime();
      if (period === 'today') return saleTime >= todayStart;
      if (period === 'yesterday') return saleTime >= yesterdayStart && saleTime < todayStart;
      if (period === 'week') return saleTime >= weekStart;
      if (period === 'month') return saleTime >= monthStart;
      return true;
    });
  }, [sales, period]);

  // Aggregate stats
  const stats = useMemo(() => {
    const completed = filteredSales.filter(s => s.status !== 'cancelled');
    const totalRevenue = completed.reduce((sum, s) => sum + s.grandTotal, 0);
    const totalProfit = completed.reduce((sum, s) => sum + (s.profit || 0), 0);
    const totalTax = completed.reduce((sum, s) => sum + (s.taxTotal || 0), 0);
    const salesCount = completed.length;
    const avgCart = salesCount > 0 ? totalRevenue / salesCount : 0;

    const cashTotal = completed.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.grandTotal, 0);
    const cardTotal = completed.filter(s => s.paymentMethod === 'card').reduce((sum, s) => sum + s.grandTotal, 0);
    const debtTotal = completed.filter(s => s.paymentMethod === 'debt').reduce((sum, s) => sum + s.grandTotal, 0);

    // Top selling items
    const itemMap = {};
    completed.forEach(s => {
      s.items?.forEach(it => {
        if (!itemMap[it.name]) {
          itemMap[it.name] = { name: it.name, count: 0, revenue: 0 };
        }
        itemMap[it.name].count += it.quantity;
        itemMap[it.name].revenue += it.total;
      });
    });
    const topItems = Object.values(itemMap).sort((a, b) => b.count - a.count).slice(0, 5);

    return {
      totalRevenue,
      totalProfit,
      totalTax,
      salesCount,
      avgCart,
      cashTotal,
      cardTotal,
      debtTotal,
      topItems
    };
  }, [filteredSales]);

  // Refund / Cancel sale
  const handleCancelSale = async (sale) => {
    if (confirm(`Fiş #${sale.receiptNo} satışını iptal edip ürün stoklarını geri yüklemek istiyor musunuz?`)) {
      // Restore stocks
      for (const item of sale.items) {
        const prod = await db.products.get(item.id);
        if (prod) {
          await db.products.update(prod.id, { stock: prod.stock + item.quantity });
        }
      }

      // If debt, reduce customer balance
      if (sale.paymentMethod === 'debt' && sale.customerId) {
        const cust = await db.customers.get(sale.customerId);
        if (cust) {
          await db.customers.update(cust.id, { balance: Math.max(0, cust.balance - sale.grandTotal) });
          await db.customerTransactions.add({
            customerId: cust.id,
            type: 'payment',
            amount: sale.grandTotal,
            date: new Date().toISOString(),
            note: `İptal: Fiş #${sale.receiptNo}`,
            receiptNo: sale.receiptNo
          });
        }
      }

      // Mark sale as cancelled
      await db.sales.update(sale.id, { status: 'cancelled' });
    }
  };

  const handleDownloadZReportPDF = () => {
    try {
      const doc = new jsPDF({ unit: 'mm', format: [80, 180] });
      doc.setFont('courier', 'bold');
      doc.setFontSize(13);
      doc.text(storeSettings?.storeName || 'MARKET KASA', 40, 10, { align: 'center' });
      doc.setFontSize(10);
      doc.text('GÜN SONU Z-RAPORU', 40, 16, { align: 'center' });
      
      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      doc.text(`Tarih: ${new Date().toLocaleString('tr-TR')}`, 5, 23);
      doc.text('------------------------------------------', 40, 27, { align: 'center' });

      let y = 33;
      doc.text(`Toplam Fiş Adedi   : ${stats.salesCount}`, 5, y); y += 5;
      doc.text(`Nakit Tahsilat     : ₺${stats.cashTotal.toFixed(2)}`, 5, y); y += 5;
      doc.text(`Kredi Kartı        : ₺${stats.cardTotal.toFixed(2)}`, 5, y); y += 5;
      doc.text(`Veresiye Satış     : ₺${stats.debtTotal.toFixed(2)}`, 5, y); y += 5;
      doc.text(`KDV Toplamı        : ₺${stats.totalTax.toFixed(2)}`, 5, y); y += 5;
      doc.text('------------------------------------------', 40, y, { align: 'center' }); y += 5;
      
      doc.setFont('courier', 'bold');
      doc.setFontSize(10);
      doc.text(`GENEL CİRO        : ₺${stats.totalRevenue.toFixed(2)}`, 5, y); y += 6;
      doc.text(`TAHMİNİ NET KAR   : ₺${stats.totalProfit.toFixed(2)}`, 5, y); y += 6;

      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      doc.text('------------------------------------------', 40, y, { align: 'center' }); y += 5;
      doc.text('EN ÇOK SATAN ÜRÜNLER:', 5, y); y += 5;
      stats.topItems.forEach((it, idx) => {
        doc.text(`${idx + 1}. ${it.name.substring(0, 15)} (${it.count} adet)`, 5, y); y += 4;
      });

      doc.save(`Z-Raporu-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-57px-60px)] max-w-lg mx-auto bg-slate-950 overflow-hidden">
      
      {/* Top Header */}
      <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-400" />
            <span>Kasa Raporları & Z-Raporu</span>
          </h2>

          <button
            onClick={() => setShowZReportModal(true)}
            className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 active:scale-95 transition"
          >
            <Printer className="w-4 h-4" />
            <span>Z-Raporu Al</span>
          </button>
        </div>

        {/* Date Filter Tabs */}
        <div className="grid grid-cols-5 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-semibold">
          {[
            { id: 'today', label: 'Bugün' },
            { id: 'yesterday', label: 'Dün' },
            { id: 'week', label: '7 Gün' },
            { id: 'month', label: 'Bu Ay' },
            { id: 'all', label: 'Tümü' }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setPeriod(t.id)}
              className={`py-1.5 rounded-lg text-center transition ${
                period === t.id
                  ? 'bg-slate-800 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reports Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        
        {/* Main KPI Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gradient-to-br from-emerald-950/40 to-slate-900 border border-emerald-500/30 p-3.5 rounded-2xl">
            <span className="text-[10px] uppercase font-bold text-emerald-400 block tracking-wider">Toplam Ciro</span>
            <div className="text-2xl font-black text-white font-mono mt-1">
              ₺{stats.totalRevenue.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              {stats.salesCount} Satış Fişi
            </span>
          </div>

          <div className="bg-gradient-to-br from-blue-950/40 to-slate-900 border border-blue-500/30 p-3.5 rounded-2xl">
            <span className="text-[10px] uppercase font-bold text-blue-400 block tracking-wider">Tahmini Net Kâr</span>
            <div className="text-2xl font-black text-blue-400 font-mono mt-1">
              ₺{stats.totalProfit.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Alış-Satış Marjı
            </span>
          </div>
        </div>

        {/* Breakdown by Payment Method */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Ödeme Kanalları</span>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                <Banknote className="w-3 h-3" /> Nakit
              </span>
              <p className="text-xs font-black text-white font-mono mt-1">₺{stats.cashTotal.toFixed(2)}</p>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-blue-400 flex items-center gap-1">
                <CreditCard className="w-3 h-3" /> Kart
              </span>
              <p className="text-xs font-black text-white font-mono mt-1">₺{stats.cardTotal.toFixed(2)}</p>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
              <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                <UserCheck className="w-3 h-3" /> Veresiye
              </span>
              <p className="text-xs font-black text-white font-mono mt-1">₺{stats.debtTotal.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Top Selling Products */}
        {stats.topItems.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">En Çok Satan Ürünler</span>
            <div className="space-y-1.5">
              {stats.topItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs bg-slate-950 p-2 rounded-xl border border-slate-800/60">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 font-bold flex items-center justify-center text-[10px]">
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-white">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 font-mono text-[11px]">{item.count} adet</span>
                    <span className="text-emerald-400 font-bold font-mono">₺{item.revenue.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sales History List */}
        <div className="space-y-2 pt-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block px-1">Fiş Geçmişi</span>
          {filteredSales.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              Seçilen periyotta satış hareketi bulunamadı.
            </div>
          ) : (
            filteredSales.map((sale) => (
              <div
                key={sale.id}
                className={`bg-slate-900 border rounded-2xl p-3 flex items-center justify-between gap-2 transition ${
                  sale.status === 'cancelled'
                    ? 'border-rose-900/40 opacity-60'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono font-bold text-slate-300">{sale.receiptNo}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                      sale.paymentMethod === 'cash' ? 'bg-emerald-500/20 text-emerald-400' :
                      sale.paymentMethod === 'card' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {sale.paymentMethod === 'cash' ? 'Nakit' : sale.paymentMethod === 'card' ? 'Kart' : 'Veresiye'}
                    </span>
                    {sale.status === 'cancelled' && (
                      <span className="text-[9px] bg-rose-500/20 text-rose-400 px-1 rounded font-bold">
                        İPTAL EDİLDİ
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {new Date(sale.date).toLocaleDateString('tr-TR')} {new Date(sale.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} • {sale.items.length} Kalem Ürün
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <span className={`text-sm font-black font-mono block ${sale.status === 'cancelled' ? 'line-through text-slate-500' : 'text-emerald-400'}`}>
                      ₺{sale.grandTotal.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setSelectedReceipt(sale)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                      title="Fişi Görüntüle / Yazdır"
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    {hasPermission('canCancelSale') && sale.status !== 'cancelled' && (
                      <button
                        onClick={() => handleCancelSale(sale)}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 transition"
                        title="Fişi İptal Et / İade Al"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

      </div>

      {/* Z-Report Modal */}
      {showZReportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 safe-bottom">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Printer className="w-5 h-5 text-emerald-400" />
                <span>Gün Sonu Z-Raporu</span>
              </h3>
              <button onClick={() => setShowZReportModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Thermal Print Style Z-Report Box */}
            <div className="bg-white text-black p-4 rounded-xl font-mono text-xs space-y-2 border border-slate-300 select-text">
              <div className="text-center font-bold">
                <p className="text-sm">{storeSettings?.storeName || 'KURŞUNLU MARKET'}</p>
                <p className="text-[10px] text-gray-600">MALİ DEĞERİ OLMAYAN Z RAPORU</p>
                <p className="text-[10px] text-gray-500">{new Date().toLocaleString('tr-TR')}</p>
              </div>

              <div className="border-t border-b border-dashed border-gray-400 py-1.5 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>Toplam Fiş Adedi:</span>
                  <span>{stats.salesCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Nakit Kasa Girişi:</span>
                  <span>₺{stats.cashTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Kredi Kartı Toplamı:</span>
                  <span>₺{stats.cardTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Veresiye Satış:</span>
                  <span>₺{stats.debtTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>KDV Matrah Toplamı:</span>
                  <span>₺{stats.totalTax.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex justify-between font-black text-sm pt-1">
                <span>GÜNLÜK CİRO:</span>
                <span>₺{stats.totalRevenue.toFixed(2)}</span>
              </div>

              <div className="flex justify-between font-bold text-xs text-emerald-800 pt-0.5">
                <span>TAHMİNİ NET KÂR:</span>
                <span>₺{stats.totalProfit.toFixed(2)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => window.print()}
                className="py-2.5 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-700"
              >
                <Printer className="w-4 h-4" />
                <span>Yazdır</span>
              </button>

              <button
                onClick={handleDownloadZReportPDF}
                className="py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20"
              >
                <Download className="w-4 h-4" />
                <span>PDF İndir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {selectedReceipt && (
        <ReceiptModal
          sale={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
          storeInfo={{
            name: storeSettings?.storeName || 'KURŞUNLU MARKET',
            address: storeSettings?.storeAddress || 'Merkez Mah.',
            phone: storeSettings?.storePhone || '0212 555 0011',
            taxId: storeSettings?.taxId || 'VKN: 1234567890',
            footer: storeSettings?.receiptFooter || 'Teşekkür Ederiz!'
          }}
        />
      )}

    </div>
  );
}
