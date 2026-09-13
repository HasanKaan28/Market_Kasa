import React, { useState, useMemo } from 'react';
import { 
  X, Printer, Download, FileText, Calendar, 
  Building2, CheckCircle2, DollarSign, FileSpreadsheet, Share2,
  ArrowRight, Layers, Clock
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { jsPDF } from 'jspdf';

// Helper: Convert Turkish numbers to words (e.g. 1450.50 -> Bin Dört Yüz Elli Türk Lirası Elli Kuruş)
export function numberToTurkishWords(amount) {
  if (isNaN(amount) || amount === 0) return 'Sıfır Türk Lirası';
  const birler = ['', 'Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi', 'Sekiz', 'Dokuz'];
  const onlar = ['', 'On', 'Yirmi', 'Otuz', 'Kırk', 'Elli', 'Altmış', 'Yetmiş', 'Seksen', 'Doksan'];
  const basamaklar = ['', 'Bin', 'Milyon', 'Milyar'];

  function ucBasamak(n) {
    let res = '';
    const yuz = Math.floor(n / 100);
    const on = Math.floor((n % 100) / 10);
    const bir = n % 10;
    if (yuz > 0) res += (yuz === 1 ? 'Yüz ' : birler[yuz] + ' Yüz ');
    if (on > 0) res += onlar[on] + ' ';
    if (bir > 0) res += birler[bir] + ' ';
    return res.trim();
  }

  const tam = Math.floor(Math.abs(amount));
  const kurus = Math.round((Math.abs(amount) - tam) * 100);

  let tamStr = '';
  if (tam === 0) {
    tamStr = 'Sıfır';
  } else {
    let t = tam;
    let bIdx = 0;
    const parts = [];
    while (t > 0) {
      const u = t % 1000;
      if (u > 0) {
        let uStr = ucBasamak(u);
        if (bIdx === 1 && u === 1) {
          parts.unshift('Bin');
        } else {
          parts.unshift((uStr ? uStr + ' ' : '') + basamaklar[bIdx]);
        }
      }
      t = Math.floor(t / 1000);
      bIdx++;
    }
    tamStr = parts.join(' ').trim();
  }

  let result = '#' + tamStr + ' Türk Lirası';
  if (kurus > 0) {
    result += ' ' + ucBasamak(kurus) + ' Kuruş';
  }
  result += '#';
  return result;
}

export default function DailyInvoiceModal({ onClose, defaultDate, defaultStartDate, defaultEndDate }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  // Date Range States
  const [startDate, setStartDate] = useState(() => defaultStartDate || defaultDate || todayStr);
  const [endDate, setEndDate] = useState(() => defaultEndDate || defaultDate || todayStr);

  const isRange = startDate !== endDate;
  const invoiceTitle = isRange ? 'DÖNEMSEL SATIŞ İCMAL FATURASI' : 'GÜNLÜK SATIŞ FATURASI';
  const periodLabel = isRange 
    ? `${new Date(startDate).toLocaleDateString('tr-TR')} - ${new Date(endDate).toLocaleDateString('tr-TR')}`
    : new Date(startDate).toLocaleDateString('tr-TR');

  const [invoiceNo, setInvoiceNo] = useState(() => {
    const sClean = (defaultStartDate || defaultDate || todayStr).replace(/-/g, '');
    const eClean = (defaultEndDate || defaultDate || todayStr).replace(/-/g, '');
    if (sClean === eClean) return `GSF-${sClean}-001`;
    return `DSF-${sClean}-${eClean.slice(4)}-001`;
  });

  // Fetch settings for Store details (tax ID, address, store name)
  const storeSettings = useLiveQuery(async () => {
    const list = await db.settings.toArray();
    return list.reduce((acc, cur) => ({ ...acc, [cur.key]: cur.value }), {});
  }, []);

  // Fetch all sales
  const allSales = useLiveQuery(() => db.sales.toArray(), []) || [];

  // Filter sales for the selected date or date range (excluding cancelled)
  const daySales = useMemo(() => {
    if (!allSales || allSales.length === 0) return [];
    
    // Support range comparison
    const sTime = new Date(`${startDate}T00:00:00`).getTime();
    const eTime = new Date(`${endDate}T23:59:59.999`).getTime();

    return allSales.filter(s => {
      if (s.status === 'cancelled') return false;
      const sTimestamp = new Date(s.date).getTime();
      return sTimestamp >= sTime && sTimestamp <= eTime;
    });
  }, [allSales, startDate, endDate]);

  // Aggregate items across all sales in the date range
  const { 
    aggregatedItems, 
    totals, 
    taxBreakdown, 
    paymentBreakdown 
  } = useMemo(() => {
    const itemMap = {};
    let grandTotal = 0;
    let totalDiscount = 0;

    const payments = {
      cash: 0,
      card: 0,
      debt: 0
    };

    const taxTiers = {
      1: { matrah: 0, tax: 0 },
      10: { matrah: 0, tax: 0 },
      20: { matrah: 0, tax: 0 }
    };

    daySales.forEach(sale => {
      grandTotal += (sale.grandTotal || 0);
      totalDiscount += (sale.discount || 0);

      // Payments
      if (sale.paymentMethod === 'cash') payments.cash += (sale.grandTotal || 0);
      else if (sale.paymentMethod === 'card') payments.card += (sale.grandTotal || 0);
      else if (sale.paymentMethod === 'debt') payments.debt += (sale.grandTotal || 0);
      else if (sale.paymentMethod === 'split' && sale.splitDetails) {
        payments.cash += (sale.splitDetails.cash || 0);
        payments.card += (sale.splitDetails.card || 0);
      } else {
        payments.cash += (sale.grandTotal || 0);
      }

      // Items
      (sale.items || []).forEach(it => {
        const key = `${it.name}_${it.taxRate || 1}_${it.price}`;
        if (!itemMap[key]) {
          itemMap[key] = {
            id: it.id,
            name: it.name,
            barcode: it.barcode || '',
            unit: it.unit || 'Adet',
            taxRate: it.taxRate || 1,
            unitPriceWithTax: it.price || 0,
            quantity: 0,
            totalWithTax: 0
          };
        }
        itemMap[key].quantity += (it.quantity || 1);
        itemMap[key].totalWithTax += (it.total || (it.price * (it.quantity || 1)));
      });
    });

    const itemsList = Object.values(itemMap).map((it, index) => {
      const rate = it.taxRate;
      const matrah = it.totalWithTax / (1 + (rate / 100));
      const taxAmount = it.totalWithTax - matrah;
      const unitPriceWithoutTax = matrah / (it.quantity || 1);

      // Accumulate tax breakdown
      if (!taxTiers[rate]) {
        taxTiers[rate] = { matrah: 0, tax: 0 };
      }
      taxTiers[rate].matrah += matrah;
      taxTiers[rate].tax += taxAmount;

      return {
        lineNo: index + 1,
        ...it,
        matrah,
        taxAmount,
        unitPriceWithoutTax
      };
    });

    const totalMatrah = itemsList.reduce((sum, i) => sum + i.matrah, 0);
    const totalTax = itemsList.reduce((sum, i) => sum + i.taxAmount, 0);

    return {
      aggregatedItems: itemsList,
      totals: {
        totalMatrah,
        totalTax,
        totalDiscount,
        grandTotal,
        receiptCount: daySales.length
      },
      taxBreakdown: taxTiers,
      paymentBreakdown: payments
    };
  }, [daySales]);

  // Fast Presets
  const applyPreset = (type) => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (type === 'today') {
      setStartDate(today);
      setEndDate(today);
      setInvoiceNo(`GSF-${today.replace(/-/g, '')}-001`);
    } else if (type === 'yesterday') {
      const yDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      setStartDate(yDate);
      setEndDate(yDate);
      setInvoiceNo(`GSF-${yDate.replace(/-/g, '')}-001`);
    } else if (type === 'week') {
      const wStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      setStartDate(wStart);
      setEndDate(today);
      setInvoiceNo(`DSF-${wStart.replace(/-/g, '')}-${today.replace(/-/g, '').slice(4)}-001`);
    } else if (type === 'month') {
      const mStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      setStartDate(mStart);
      setEndDate(today);
      setInvoiceNo(`DSF-${mStart.replace(/-/g, '')}-${today.replace(/-/g, '').slice(4)}-001`);
    }
  };

  // Browser Print
  const handlePrint = () => {
    window.print();
  };

  // Export CSV
  const handleExportCSV = () => {
    if (aggregatedItems.length === 0) return;
    const headers = ['Sıra No', 'Ürün Adı', 'Barkod', 'Birim', 'Miktar', 'Birim Fiyat (KDV Hariç)', 'KDV %', 'KDV Tutarı', 'Toplam Tutar (KDV Dahil)'];
    const rows = aggregatedItems.map(it => [
      it.lineNo,
      `"${it.name}"`,
      `"${it.barcode}"`,
      `"${it.unit}"`,
      it.quantity,
      it.unitPriceWithoutTax.toFixed(2),
      `%${it.taxRate}`,
      it.taxAmount.toFixed(2),
      it.totalWithTax.toFixed(2)
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `satis_faturasi_${startDate}_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // PDF Download (jsPDF)
  const handleDownloadPDF = () => {
    try {
      const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      const sName = storeSettings?.storeName || 'KURŞUNLU MARKET';
      const sAddr = storeSettings?.storeAddress || 'Merkez Mah.';
      const sPhone = storeSettings?.storePhone || '';
      const sTax = storeSettings?.taxId || 'VKN: 1234567890';

      // Header Brand
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(30, 64, 175); // Blue 800
      doc.text(sName, 15, 20);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(sAddr, 15, 26);
      doc.text(`Tel: ${sPhone} | ${sTax}`, 15, 31);

      // Invoice Title Badge
      doc.setFillColor(239, 246, 255);
      doc.roundedRect(120, 12, 75, 26, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(30, 58, 138);
      doc.text(invoiceTitle, 157.5, 18, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85);
      doc.text(`Fatura No : ${invoiceNo}`, 124, 24);
      doc.text(`Dönem     : ${periodLabel}`, 124, 29);
      doc.text(`Toplam Fiş: ${totals.receiptCount} Adet Satış`, 124, 34);

      // Divider
      doc.setDrawColor(203, 213, 225);
      doc.line(15, 42, 195, 42);

      // Buyer Info
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 41, 59);
      doc.text('MÜŞTERİ / ALICI BİLGİLERİ:', 15, 49);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text('Ünvan: Muhtelif Müşteriler (Nihai Tüketici - Kasa Satışları İcmali)', 15, 54);
      doc.text('Vergi Dairesi / VKN: Nihai Tüketici (TCKN: 11111111111)', 15, 59);
      doc.text(`Açıklama: ${periodLabel} dönemine ait perakende kasa satış icmal faturasıdır.`, 15, 64);

      // Table Header
      let y = 72;
      doc.setFillColor(241, 245, 249);
      doc.rect(15, y, 180, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);

      doc.text('No', 17, y + 5.5);
      doc.text('Mal / Hizmet Açıklaması', 28, y + 5.5);
      doc.text('Miktar', 98, y + 5.5, { align: 'right' });
      doc.text('Birim Fiyat', 125, y + 5.5, { align: 'right' });
      doc.text('KDV %', 145, y + 5.5, { align: 'center' });
      doc.text('KDV Tutarı', 168, y + 5.5, { align: 'right' });
      doc.text('Tutar (₺)', 193, y + 5.5, { align: 'right' });

      y += 8;

      // Table Rows
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);

      aggregatedItems.forEach((it) => {
        if (y > 240) {
          doc.addPage();
          y = 20;
        }

        doc.text(String(it.lineNo), 17, y + 5);
        const nameText = it.name.length > 35 ? it.name.substring(0, 35) + '...' : it.name;
        doc.text(nameText, 28, y + 5);
        doc.text(`${it.quantity} ${it.unit}`, 98, y + 5, { align: 'right' });
        doc.text(`₺${it.unitPriceWithoutTax.toFixed(2)}`, 125, y + 5, { align: 'right' });
        doc.text(`%${it.taxRate}`, 145, y + 5, { align: 'center' });
        doc.text(`₺${it.taxAmount.toFixed(2)}`, 168, y + 5, { align: 'right' });
        doc.text(`₺${it.totalWithTax.toFixed(2)}`, 193, y + 5, { align: 'right' });

        doc.setDrawColor(241, 245, 249);
        doc.line(15, y + 7, 195, y + 7);
        y += 7;
      });

      // Bottom Totals Card
      y = Math.max(y + 6, 210);
      if (y > 230) {
        doc.addPage();
        y = 30;
      }

      // KDV Breakdown Box (Left)
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(15, y, 90, 38, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('KDV İcmal Dağılımı', 20, y + 7);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);

      let ky = y + 13;
      Object.keys(taxBreakdown).forEach(k => {
        const tObj = taxBreakdown[k];
        if (tObj.matrah > 0) {
          doc.text(`%${k} KDV Matrahı: ₺${tObj.matrah.toFixed(2)}  (KDV: ₺${tObj.tax.toFixed(2)})`, 20, ky);
          ky += 5;
        }
      });
      doc.text(`Tahsilat: Nakit: ₺${paymentBreakdown.cash.toFixed(2)} | Kart: ₺${paymentBreakdown.card.toFixed(2)}`, 20, ky);

      // Financial Summary Box (Right)
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(110, y, 85, 38, 2, 2, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text('KDV Hariç Matrah Toplamı:', 115, y + 8);
      doc.text(`₺${totals.totalMatrah.toFixed(2)}`, 190, y + 8, { align: 'right' });

      doc.text('Hesaplanan Toplam KDV:', 115, y + 15);
      doc.text(`₺${totals.totalTax.toFixed(2)}`, 190, y + 15, { align: 'right' });

      doc.setDrawColor(203, 213, 225);
      doc.line(115, y + 20, 190, y + 20);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(30, 64, 175);
      doc.text('ÖDENECEK TOPLAM:', 115, y + 28);
      doc.text(`₺${totals.grandTotal.toFixed(2)}`, 190, y + 28, { align: 'right' });

      // Words amount
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Yazıyla: ${numberToTurkishWords(totals.grandTotal)}`, 15, y + 46);

      // Stamp & Signature Box
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Düzenleyen (Kaşe / İmza)', 40, y + 60, { align: 'center' });
      doc.text('Teslim Alan', 160, y + 60, { align: 'center' });
      doc.line(20, y + 75, 65, y + 75);
      doc.line(140, y + 75, 180, y + 75);

      doc.save(`Satis-Faturasi-${startDate}_${endDate}.pdf`);
    } catch (err) {
      console.error('Fatura PDF hatası:', err);
      alert('Fatura PDF oluşturulurken hata: ' + err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in">
      <div className="bg-white border border-slate-200 w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden">
        
        {/* Top Operational Bar (Controls & Actions) */}
        <div className="px-4 sm:px-6 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5 shrink-0 print:hidden">
          
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-1.5">
                <span>{invoiceTitle}</span>
                <span className={`text-[10px] font-mono px-2 py-0.2 rounded-full font-bold ${
                  isRange ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                }`}>
                  {isRange ? 'Dönemsel İcmal' : 'Günlük Fatura'}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Seçilen tarih aralığındaki tüm satışları kümülatif fatura formatında dökün.
              </p>
            </div>
          </div>

          {/* Quick Presets & Date Range Selector */}
          <div className="flex items-center gap-1.5 flex-wrap">
            
            {/* Presets */}
            <div className="flex items-center gap-1 bg-slate-200/80 p-0.5 rounded-xl text-[10px] font-bold">
              <button
                type="button"
                onClick={() => applyPreset('today')}
                className={`px-2 py-1 rounded-lg transition ${
                  startDate === todayStr && endDate === todayStr ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Bugün
              </button>
              <button
                type="button"
                onClick={() => applyPreset('yesterday')}
                className="px-2 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition"
              >
                Dün
              </button>
              <button
                type="button"
                onClick={() => applyPreset('week')}
                className="px-2 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition"
              >
                Son 7 Gün
              </button>
              <button
                type="button"
                onClick={() => applyPreset('month')}
                className="px-2 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition"
              >
                Bu Ay
              </button>
            </div>

            {/* Date Pickers */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-2 py-1 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="text-[11px] font-bold text-slate-800 focus:outline-none cursor-pointer w-[105px]"
                title="Başlangıç Tarihi"
              />
              <span className="text-slate-400 font-bold">-</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="text-[11px] font-bold text-slate-800 focus:outline-none cursor-pointer w-[105px]"
                title="Bitiş Tarihi"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrint}
                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition active:scale-95 shadow-sm shadow-blue-200"
                title="A4 Fatura Yazdır"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Yazdır (A4)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadPDF}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition active:scale-95 shadow-sm shadow-emerald-200"
                title="PDF Olarak İndir"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">PDF</span>
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition active:scale-95"
                title="Excel / CSV Olarak İndir"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden md:inline">CSV</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition ml-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

          </div>
        </div>

        {/* Scrollable Printable A4 Invoice Sheet */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-8 bg-slate-100 flex justify-center print:p-0 print:bg-white">
          <div className="w-full max-w-[210mm] min-h-[297mm] bg-white border border-slate-300 shadow-xl rounded-2xl p-6 sm:p-10 flex flex-col justify-between text-slate-800 font-sans print:border-none print:shadow-none print:rounded-none print:p-6 print:m-0">
            
            {/* Top Sheet: Header */}
            <div>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b-2 border-blue-900 pb-5">
                {/* Seller Store Info */}
                <div className="space-y-1 max-w-sm">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-6 h-6 text-blue-800" />
                    <h1 className="text-xl sm:text-2xl font-black text-blue-950 tracking-tight">
                      {storeSettings?.storeName || 'KURŞUNLU MARKET'}
                    </h1>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    {storeSettings?.storeAddress || 'Merkez Mah. Atatürk Cad. No: 42'}
                  </p>
                  <div className="text-xs text-slate-600 font-mono space-x-2">
                    <span>Tel: {storeSettings?.storePhone || '0212 555 00 11'}</span>
                    <span>•</span>
                    <span className="font-bold text-slate-800">{storeSettings?.taxId || 'VKN: 1234567890'}</span>
                  </div>
                </div>

                {/* Invoice Meta Box */}
                <div className="bg-blue-50/80 border border-blue-200/80 rounded-2xl p-4 text-right sm:min-w-[250px] space-y-1">
                  <span className="text-[11px] font-black uppercase tracking-widest text-blue-800 block">
                    {invoiceTitle}
                  </span>
                  <div className="text-xs text-slate-700 font-mono space-y-0.5">
                    <div>Fatura No: <strong className="text-slate-900 font-black">{invoiceNo}</strong></div>
                    <div>Dönem / Tarih: <strong>{periodLabel}</strong></div>
                    <div>Toplam Fiş: <strong className="text-blue-700">{totals.receiptCount} Satış</strong></div>
                  </div>
                </div>
              </div>

              {/* Customer / Recipient Info */}
              <div className="my-4 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">MÜŞTERİ / ALICI BİLGİLERİ</span>
                  <p className="font-bold text-slate-900 mt-0.5">Muhtelif Müşteriler (Nihai Tüketici - Kasa Satışları İcmali)</p>
                  <p className="text-slate-500 text-[11px]">Vergi No: 11111111111 (Nihai Tüketici) | Adres: Muhtelif</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">BELGE NİTELİĞİ & AÇIKLAMA</span>
                  <p className="text-slate-600 mt-0.5 leading-snug">
                    Bu fatura 213 Sayılı Vergi Usul Kanunu uyarınca, <strong>{periodLabel}</strong> tarihleri arasındaki kasa satışlarının kümülatif perakende dökümünü içerir.
                  </p>
                </div>
              </div>

              {/* Items Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 uppercase text-[10px] tracking-wider">
                      <th className="py-2.5 px-3 w-10 text-center">No</th>
                      <th className="py-2.5 px-3">Mal / Hizmet Açıklaması</th>
                      <th className="py-2.5 px-3 text-right">Miktar</th>
                      <th className="py-2.5 px-3 text-right">Birim Fiyat (KDV Hariç)</th>
                      <th className="py-2.5 px-3 text-center">KDV %</th>
                      <th className="py-2.5 px-3 text-right">KDV Tutarı</th>
                      <th className="py-2.5 px-3 text-right">Toplam Tutar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {aggregatedItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-10 text-slate-400 text-xs">
                          {periodLabel} tarihleri arasında tamamlanmış bir satış kaydı bulunamadı.
                        </td>
                      </tr>
                    ) : (
                      aggregatedItems.map((it) => (
                        <tr key={it.lineNo} className="hover:bg-slate-50 transition font-medium text-slate-700">
                          <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-400">{it.lineNo}</td>
                          <td className="py-2 px-3 font-bold text-slate-900">
                            <span>{it.name}</span>
                            {it.barcode && <span className="text-[10px] font-mono text-slate-400 ml-1.5">[{it.barcode}]</span>}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{it.quantity} {it.unit}</td>
                          <td className="py-2 px-3 text-right font-mono">₺{it.unitPriceWithoutTax.toFixed(2)}</td>
                          <td className="py-2 px-3 text-center font-mono">%{it.taxRate}</td>
                          <td className="py-2 px-3 text-right font-mono">₺{it.taxAmount.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">₺{it.totalWithTax.toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom Sheet: Tax Breakdown, Totals & Signatures */}
            <div className="pt-6 space-y-4">
              
              {/* Summary Grids */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Left: KDV & Payment Method Breakdown */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                    KDV MATRAH & TAHSİLAT DAĞILIMI
                  </span>
                  
                  <div className="space-y-1 font-mono text-[11px]">
                    {Object.keys(taxBreakdown).map(rate => {
                      const tObj = taxBreakdown[rate];
                      if (tObj.matrah <= 0) return null;
                      return (
                        <div key={rate} className="flex justify-between border-b border-slate-200/60 pb-0.5">
                          <span className="text-slate-600">%{rate} KDV Matrahı: ₺{tObj.matrah.toFixed(2)}</span>
                          <span className="font-bold text-slate-800">KDV: ₺{tObj.tax.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] font-mono">
                    <span className="text-slate-500">Tahsilat Kanalları:</span>
                    <span className="font-bold text-slate-700">
                      Nakit: ₺{paymentBreakdown.cash.toFixed(2)} | Kart: ₺{paymentBreakdown.card.toFixed(2)}
                      {paymentBreakdown.debt > 0 && ` | Veresiye: ₺${paymentBreakdown.debt.toFixed(2)}`}
                    </span>
                  </div>
                </div>

                {/* Right: Totals Box */}
                <div className="bg-gradient-to-br from-blue-50/90 to-slate-50 border border-blue-200 rounded-xl p-3.5 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600 font-mono">
                    <span>KDV Hariç Ara Toplam (Matrah):</span>
                    <span className="font-bold text-slate-800">₺{totals.totalMatrah.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-slate-600 font-mono">
                    <span>Hesaplanan Toplam KDV:</span>
                    <span className="font-bold text-slate-800">₺{totals.totalTax.toFixed(2)}</span>
                  </div>

                  {totals.totalDiscount > 0 && (
                    <div className="flex justify-between text-rose-600 font-mono">
                      <span>Uygulanan İndirimler:</span>
                      <span>-₺{totals.totalDiscount.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="border-t border-blue-200 pt-2 mt-1 flex justify-between items-baseline">
                    <span className="text-sm font-black text-blue-950 uppercase">GENEL TOPLAM:</span>
                    <span className="text-xl font-black font-mono text-blue-700">₺{totals.grandTotal.toFixed(2)}</span>
                  </div>
                </div>

              </div>

              {/* Amount in Turkish Words */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 font-mono">
                <span className="font-bold text-slate-700">Yazıyla: </span>
                <span className="font-semibold text-blue-900">{numberToTurkishWords(totals.grandTotal)}</span>
              </div>

              {/* Stamp & Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-4 text-center text-xs">
                <div>
                  <p className="font-bold text-slate-800">Düzenleyen (Kaşe / İmza)</p>
                  <p className="text-[11px] text-slate-500">{storeSettings?.storeName || 'Kurşunlu Market'}</p>
                  <div className="mt-8 border-b border-dashed border-slate-400 w-36 mx-auto"></div>
                </div>

                <div>
                  <p className="font-bold text-slate-800">Teslim Alan</p>
                  <p className="text-[11px] text-slate-500">Nihai Tüketici Perakende Satış</p>
                  <div className="mt-8 border-b border-dashed border-slate-400 w-36 mx-auto"></div>
                </div>
              </div>

            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
