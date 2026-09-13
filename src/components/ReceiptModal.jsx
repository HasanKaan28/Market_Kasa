import React from 'react';
import { Printer, Share2, CheckCircle2, ArrowRight, Download } from 'lucide-react';
import { jsPDF } from 'jspdf';

export default function ReceiptModal({ sale, onClose, storeInfo }) {
  if (!sale) return null;

  const isRefund = sale.isRefund || sale.grandTotal < 0 || sale.receiptNo?.startsWith('IAD');
  const displayTotal = Math.abs(sale.grandTotal || 0);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    try {
      const doc = new jsPDF({
        unit: 'mm',
        format: [80, 200]
      });

      doc.setFont('courier', 'bold');
      doc.setFontSize(12);
      doc.text(storeInfo?.name || 'MARKET KASA', 40, 10, { align: 'center' });

      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      doc.text(storeInfo?.address || 'Merkez Mah.', 40, 15, { align: 'center' });
      doc.text(`Tel: ${storeInfo?.phone || ''} | ${storeInfo?.taxId || ''}`, 40, 19, { align: 'center' });
      doc.text('------------------------------------------', 40, 23, { align: 'center' });

      doc.setFont('courier', 'bold');
      doc.text(isRefund ? '*** İADE GİDER PUSULASI ***' : '*** SATIŞ BİLGİ FİŞİ ***', 40, 27, { align: 'center' });
      doc.setFont('courier', 'normal');
      doc.text(`Fiş No: ${sale.receiptNo}`, 5, 32);
      doc.text(`Tarih : ${new Date(sale.date).toLocaleString('tr-TR')}`, 5, 36);
      doc.text('------------------------------------------', 40, 40, { align: 'center' });

      let y = 45;
      doc.text('Ürün                     Adet    Tutar', 5, y);
      y += 4;
      doc.text('------------------------------------------', 40, y, { align: 'center' });
      y += 5;

      sale.items.forEach((item) => {
        const name = item.name.substring(0, 18).padEnd(18, ' ');
        const qty = `${Math.abs(item.quantity)} ${item.unit || 'Adet'}`.padEnd(8, ' ');
        const total = `₺${Math.abs(item.total).toFixed(2)}`.padStart(8, ' ');
        doc.text(`${name} ${qty} ${total}`, 5, y);
        y += 5;
      });

      doc.text('------------------------------------------', 40, y, { align: 'center' });
      y += 5;
      doc.setFont('courier', 'bold');
      doc.setFontSize(10);
      doc.text(`${isRefund ? 'İADE EDİLEN' : 'TOPLAM'}: ₺${displayTotal.toFixed(2)}`, 75, y, { align: 'right' });
      y += 5;

      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      const payText = sale.paymentMethod === 'cash' ? 'NAKİT' : sale.paymentMethod === 'card' ? 'KREDİ KARTI' : 'VERESİYE';
      doc.text(`${isRefund ? 'İade Şekli' : 'Ödeme Türü'}: ${payText}`, 5, y);
      y += 4;
      if (sale.paymentMethod === 'cash' && !isRefund) {
        doc.text(`Alınan: ₺${(sale.cashGiven || sale.grandTotal).toFixed(2)}`, 5, y);
        y += 4;
        doc.text(`Para Üstü: ₺${(sale.changeGiven || 0).toFixed(2)}`, 5, y);
        y += 5;
      }

      doc.text('------------------------------------------', 40, y, { align: 'center' });
      y += 5;
      doc.text(storeInfo?.footer || (isRefund ? 'İade İşlemi Tamamlandı.' : 'Teşekkür Ederiz!'), 40, y, { align: 'center' });

      doc.save(`${isRefund ? 'Iade' : 'Fis'}-${sale.receiptNo}.pdf`);
    } catch (err) {
      console.error('PDF oluşturma hatası:', err);
    }
  };

  const handleShareWhatsApp = () => {
    let text = `🧾 *${storeInfo?.name || 'MARKET'} ${isRefund ? 'İADE GİDER MAKBUZU' : 'BİLGİ FİŞİ'}*\n`;
    text += `Fiş No: ${sale.receiptNo}\n`;
    text += `Tarih: ${new Date(sale.date).toLocaleString('tr-TR')}\n`;
    text += `--------------------------------\n`;
    sale.items.forEach((item) => {
      text += `• ${item.name} x${Math.abs(item.quantity)} = ₺${Math.abs(item.total).toFixed(2)}\n`;
    });
    text += `--------------------------------\n`;
    text += `*${isRefund ? 'İADE EDİLEN TUTAR' : 'TOPLAM TUTAR'}: ₺${displayTotal.toFixed(2)}*\n`;
    text += `${isRefund ? 'İade Şekli' : 'Ödeme'}: ${sale.paymentMethod === 'cash' ? 'Nakit' : sale.paymentMethod === 'card' ? 'Kredi Kartı' : 'Veresiye'}\n`;
    if (!isRefund && sale.paymentMethod === 'cash' && sale.changeGiven > 0) {
      text += `Para Üstü: ₺${sale.changeGiven.toFixed(2)}\n`;
    }
    if (sale.customerName) {
      text += `Cari / Müşteri: ${sale.customerName}\n`;
    }
    text += `\n${storeInfo?.footer || (isRefund ? 'İade işlemi başarıyla gerçekleştirilmiştir.' : 'Bizi tercih ettiğiniz için teşekkür ederiz!')}`;

    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const paymentLabel = {
    cash: 'NAKİT',
    card: 'KREDİ KARTI',
    debt: 'VERESİYE',
    split: 'PARÇALI'
  }[sale.paymentMethod] || 'NAKİT';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 safe-top safe-bottom">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-sm max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up">
        
        {/* Header Success Badge */}
        <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 fill-emerald-500/20" />
            <span className="font-bold text-sm">Satış Tamamlandı</span>
          </div>
          <span className="text-xs font-mono text-emerald-300 font-semibold bg-emerald-500/20 px-2 py-0.5 rounded">
            ₺{sale.grandTotal.toFixed(2)}
          </span>
        </div>

        {/* Scrollable Receipt Preview (Thermal 80mm Style) */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-950">
          <div
            id="thermal-receipt-area"
            className="bg-white text-black p-4 rounded-xl font-mono text-xs shadow-inner select-text border border-slate-200"
          >
            {/* Store Header */}
            <div className="text-center mb-3">
              <h3 className="font-black text-sm tracking-wider uppercase">{storeInfo?.name || 'KURŞUNLU MARKET'}</h3>
              <p className="text-[10px] text-gray-600 mt-0.5">{storeInfo?.address || 'Merkez Mah. Atatürk Cad.'}</p>
              <p className="text-[10px] text-gray-600">Tel: {storeInfo?.phone || '0212 555 0011'}</p>
              <p className="text-[10px] text-gray-500">{storeInfo?.taxId || 'VKN: 1234567890'}</p>
            </div>

            {isRefund && (
              <div className="bg-amber-100 border border-amber-400 text-amber-950 font-bold text-center py-1 rounded my-1.5 text-xs tracking-wider">
                🔄 ÜRÜN İADE MAKBUZU
              </div>
            )}

            <div className="border-t border-b border-dashed border-gray-400 py-1.5 my-2 text-[10px] flex justify-between text-gray-700">
              <span>{isRefund ? 'İade No:' : 'Fiş:'} {sale.receiptNo}</span>
              <span>{new Date(sale.date).toLocaleDateString('tr-TR')} {new Date(sale.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            {/* Items table */}
            <div className="space-y-1.5 my-3 text-[11px]">
              {sale.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start">
                  <div className="flex-1 pr-2">
                    <p className="font-bold leading-tight">{item.name}</p>
                    <p className="text-[10px] text-gray-500">
                      {Math.abs(item.quantity)} {item.unit || 'Adet'} x ₺{item.price.toFixed(2)} (%{item.taxRate} KDV)
                    </p>
                  </div>
                  <span className="font-bold whitespace-nowrap">₺{Math.abs(item.total).toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Totals Breakdown */}
            <div className="border-t border-dashed border-gray-400 pt-2 space-y-1 text-[11px]">
              <div className="flex justify-between text-gray-600">
                <span>Ara Toplam:</span>
                <span>₺{Math.abs(sale.subtotal || 0).toFixed(2)}</span>
              </div>
              {sale.discount > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>İndirim:</span>
                  <span>-₺{sale.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600">
                <span>KDV Toplamı:</span>
                <span>₺{Math.abs(sale.taxTotal || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-black border-t-2 border-black pt-1 mt-1">
                <span>{isRefund ? 'İADE EDİLEN TUTAR:' : 'TOPLAM:'}</span>
                <span>₺{displayTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Details */}
            <div className="bg-gray-100 p-2 rounded mt-3 text-[10px] space-y-0.5">
              <div className="flex justify-between font-bold">
                <span>{isRefund ? 'İADE ŞEKLİ:' : 'ÖDEME TÜRÜ:'}</span>
                <span>{paymentLabel}</span>
              </div>
              {sale.paymentMethod === 'cash' && !isRefund && (
                <>
                  <div className="flex justify-between text-gray-600">
                    <span>Alınan Nakit:</span>
                    <span>₺{(sale.cashGiven || sale.grandTotal).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-gray-900 border-t border-gray-300 pt-0.5">
                    <span>Para Üstü:</span>
                    <span className="text-emerald-700 font-black">₺{(sale.changeGiven || 0).toFixed(2)}</span>
                  </div>
                </>
              )}
              {sale.customerName && (
                <div className="flex justify-between text-amber-700 font-bold border-t border-gray-300 pt-0.5">
                  <span>{isRefund ? 'İade Düşülen Müşteri:' : 'Müşteri (Veresiye):'}</span>
                  <span>{sale.customerName}</span>
                </div>
              )}
            </div>

            {/* Barcode Graphic Footer */}
            <div className="mt-4 text-center">
              <div className="inline-flex flex-col items-center">
                <div className="flex gap-[2px] h-8 items-center">
                  {[4, 2, 6, 1, 3, 5, 2, 4, 1, 7, 3, 2, 5, 1, 4, 3, 2].map((w, i) => (
                    <div key={i} className="bg-black h-full" style={{ width: `${w}px` }}></div>
                  ))}
                </div>
                <span className="text-[9px] text-gray-500 font-mono mt-1 tracking-widest">{sale.receiptNo}</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-2 font-medium">
                {storeInfo?.footer || 'Mali Değeri Yoktur - Bilgi Fişidir'}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 px-3 rounded-xl text-xs font-semibold border border-slate-700 active:scale-95 transition"
            >
              <Printer className="w-4 h-4 text-blue-400" />
              <span>Yazdır</span>
            </button>

            <button
              onClick={handleDownloadPDF}
              className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 px-3 rounded-xl text-xs font-semibold border border-slate-700 active:scale-95 transition"
            >
              <Download className="w-4 h-4 text-amber-400" />
              <span>PDF İndir</span>
            </button>
          </div>

          <button
            onClick={handleShareWhatsApp}
            className="flex items-center justify-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 py-2.5 px-3 rounded-xl text-xs font-semibold active:scale-95 transition"
          >
            <Share2 className="w-4 h-4" />
            <span>WhatsApp ile Fiş Paylaş</span>
          </button>

          <button
            onClick={onClose}
            className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3 px-4 rounded-xl text-sm shadow-lg shadow-emerald-500/20 active:scale-98 transition mt-1"
          >
            <span>Yeni Satışa Başla</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    </div>
  );
}
