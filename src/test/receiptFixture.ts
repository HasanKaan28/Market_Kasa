import type { ReceiptModel } from '@/pos/receipt';

/** A discounted cash sale's receipt, as `buildReceipt` lays it out. */
export const sampleReceipt: ReceiptModel = {
  header: ['Kurşunlu Market'],
  device: 'Kasa 1',
  receiptNo: 'K1-20261029-0001',
  dateTime: '29.10.2026 12:00',
  lines: [
    { name: 'Ekmek', detail: '2 × ₺15,00', amount: '₺30,00' },
    { name: 'Süt', detail: '1 × ₺42,50', discount: 'İndirim −₺2,50', amount: '₺40,00' },
  ],
  totals: [
    { label: 'Ara toplam', amount: '₺70,00' },
    { label: 'Sepet indirimi', amount: '−₺5,00' },
    { label: 'Toplam', amount: '₺65,00' },
  ],
  vat: [{ label: 'KDV %1 (dahil)', amount: '₺0,64' }],
  payments: [
    { label: 'Nakit', amount: '₺65,00' },
    { label: 'Alınan', amount: '₺100,00' },
    { label: 'Para üstü', amount: '₺35,00' },
  ],
  marks: [],
  footer: ['Bilgi fişidir, mali değeri yoktur.'],
};
