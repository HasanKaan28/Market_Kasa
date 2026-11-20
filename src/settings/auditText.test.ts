import { describe, expect, it } from 'vitest';
import type { AuditRecord } from '@/data/types';
import { describeAudit } from './auditText';

const names = { staff: () => 'Ayşe', product: () => 'Süt' };
const entry = (record: Partial<AuditRecord>): AuditRecord => ({
  id: 'a1',
  deviceCode: 'K1',
  action: 'approval',
  entity: 'approval',
  occurredAt: '2026-11-12T09:00:00.000Z',
  businessDate: '2026-11-12',
  ...record,
});

describe('describeAudit', () => {
  it('tells a goods receipt taken back and one corrected', () => {
    expect(
      describeAudit(
        entry({
          action: 'purchase.reverse',
          entity: 'purchase',
          before: { total: 36000, invoiceNo: 'F-77' },
          after: { reason: 'Yanlış fatura' },
        }),
        names,
      ),
    ).toBe('Alış faturası F-77 geri alındı · ₺360,00 · Yanlış fatura');
    expect(
      describeAudit(
        entry({
          action: 'purchase.correct',
          entity: 'purchase',
          before: { total: 36000 },
          after: { total: 32000, invoiceNo: 'F-78' },
        }),
        names,
      ),
    ).toBe('Alış faturası düzeltildi · ₺360,00 → ₺320,00');
  });

  it('tells a supplier payment taken back and one corrected', () => {
    expect(
      describeAudit(
        entry({
          action: 'supplierPayment.reverse',
          entity: 'supplierLedger',
          before: { amount: 30000 },
          after: { reason: 'İki kez girildi' },
        }),
        names,
      ),
    ).toBe('Tedarikçi ödemesi geri alındı · ₺300,00 · İki kez girildi');
    expect(
      describeAudit(
        entry({
          action: 'supplierPayment.correct',
          entity: 'supplierLedger',
          before: { amount: 30000 },
          after: { amount: 25000 },
        }),
        names,
      ),
    ).toBe('Tedarikçi ödemesi düzeltildi · ₺300,00 → ₺250,00');
  });

  it('tells what an approval was for', () => {
    expect(
      describeAudit(
        entry({
          after: {
            permission: 'discount',
            approverId: 's1',
            amount: 500,
            summary: 'Sepet indirimi ₺5,00 · sepet ₺42,50',
          },
        }),
        names,
      ),
    ).toBe('İndirim onayı · Sepet indirimi ₺5,00 · sepet ₺42,50 · onaylayan Ayşe');
    expect(
      describeAudit(entry({ after: { permission: 'discount', approverId: 's1' } }), names),
    ).toBe('İndirim onayı · onaylayan Ayşe');
  });

  it('tells a supplier balance changed by hand', () => {
    expect(
      describeAudit(
        entry({
          action: 'supplierLedger.adjust',
          entity: 'supplierLedger',
          after: { supplierId: 'x', amount: -2500, note: 'İskonto' },
        }),
        names,
      ),
    ).toBe('Tedarikçi borcu elle düzeltildi · −₺25,00 · İskonto');
  });

  it('tells each market setting changed', () => {
    expect(
      describeAudit(
        entry({
          action: 'settings.update',
          entity: 'settings',
          before: { newCustomerLimit: 50000 },
          after: { newCustomerLimit: 75000 },
        }),
        names,
      ),
    ).toBe('Yeni müşteri veresiye limiti ₺500,00 → ₺750,00');
    expect(
      describeAudit(
        entry({
          action: 'settings.update',
          entity: 'settings',
          before: { idleLockMinutes: 10 },
          after: { idleLockMinutes: 0 },
        }),
        names,
      ),
    ).toBe('Otomatik kilit 10 dk → Kapalı');
    expect(
      describeAudit(
        entry({
          action: 'settings.update',
          entity: 'settings',
          before: { cutoffMinutes: 0 },
          after: { cutoffMinutes: 120 },
        }),
        names,
      ),
    ).toBe('Gün dönümü 00:00 → 02:00');
  });
});
