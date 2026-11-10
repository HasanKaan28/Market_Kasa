import type { InvoiceStatus } from '@/data/types';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  pending: 'Beklemede',
  issued: 'Kesildi',
  failed: 'Hata',
  cancelled: 'İptal edildi',
};
