import type { AuditRecord } from '@/data/types';
import { formatTRY } from '@/domain/money';
import { PERMISSION_LABELS, ROLE_LABELS, type Permission, type Role } from '@/domain/permissions';

export type AuditNames = {
  staff(id: string | undefined): string;
  product(id: string | undefined): string;
};

/** One line saying what an audit entry changed, in the owner's words. */
export function describeAudit(record: AuditRecord, names: AuditNames): string {
  const before = record.before ?? {};
  const after = record.after ?? {};
  const person = names.staff(record.entityId);
  switch (record.action) {
    case 'staff.create':
      return `${person} eklendi · ${roleLabel(after.role)}`;
    case 'staff.update': {
      const parts = [
        'name' in after ? `ad ${String(before.name)} → ${String(after.name)}` : null,
        'role' in after ? `rol ${roleLabel(before.role)} → ${roleLabel(after.role)}` : null,
        'permissions' in after ? 'izinler değişti' : null,
      ].filter((part) => part !== null);
      return `${person}: ${parts.join(', ')}`;
    }
    case 'staff.pin':
      return `${person}: PIN değiştirildi`;
    case 'staff.archive':
      return `${person} pasife alındı`;
    case 'staff.restore':
      return `${person} geri alındı`;
    case 'settings.update': {
      const parts = [
        'cutoffMinutes' in after
          ? `Gün dönümü ${clock(before.cutoffMinutes)} → ${clock(after.cutoffMinutes)}`
          : null,
        'newCustomerLimit' in after
          ? `Yeni müşteri veresiye limiti ${price(before.newCustomerLimit)} → ${price(after.newCustomerLimit)}`
          : null,
        'idleLockMinutes' in after
          ? `Otomatik kilit ${lockLabel(before.idleLockMinutes)} → ${lockLabel(after.idleLockMinutes)}`
          : null,
        'scale' in after ? 'Terazi ayarı değişti' : null,
        'requirePin' in after
          ? `PIN sor ${onOff(before.requirePin)} → ${onOff(after.requirePin)}`
          : null,
      ].filter((part) => part !== null);
      return parts.length > 0 ? parts.join(', ') : 'Market ayarı değişti';
    }
    case 'product.price': {
      const product = names.product(record.entityId);
      const parts = [
        'sellPrice' in after
          ? `satış ${price(before.sellPrice)} → ${price(after.sellPrice)}`
          : null,
        'buyPrice' in after ? `alış ${price(before.buyPrice)} → ${price(after.buyPrice)}` : null,
      ].filter((part) => part !== null);
      return `${product}: ${parts.join(', ')}`;
    }
    case 'approval': {
      const label = PERMISSION_LABELS[after.permission as Permission] ?? String(after.permission);
      const summary = typeof after.summary === 'string' ? ` · ${after.summary}` : '';
      const who = names.staff(String(after.approverId));
      return after.pinless === true
        ? `${label} (PIN sorulmadı)${summary} · yapan ${who}`
        : `${label} onayı${summary} · onaylayan ${who}`;
    }
    case 'purchase.reverse': {
      const invoice =
        typeof before.invoiceNo === 'string'
          ? `Alış faturası ${before.invoiceNo}`
          : 'Alış faturası';
      return `${invoice} geri alındı · ${price(before.total)} · ${String(after.reason)}`;
    }
    case 'purchase.correct':
      return `Alış faturası düzeltildi · ${price(before.total)} → ${price(after.total)}`;
    case 'supplierPayment.reverse':
      return `Tedarikçi ödemesi geri alındı · ${price(before.amount)} · ${String(after.reason)}`;
    case 'supplierPayment.correct':
      return `Tedarikçi ödemesi düzeltildi · ${price(before.amount)} → ${price(after.amount)}`;
    case 'supplierLedger.adjust':
      return `Tedarikçi borcu elle düzeltildi · ${signed(after.amount)} · ${String(after.note)}`;
  }
}

function roleLabel(role: unknown): string {
  return ROLE_LABELS[role as Role] ?? String(role);
}

function clock(minutes: unknown): string {
  const value = typeof minutes === 'number' ? minutes : 0;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function price(amount: unknown): string {
  return typeof amount === 'number' ? formatTRY(amount) : '—';
}

function lockLabel(minutes: unknown): string {
  return minutes === 0 ? 'Kapalı' : typeof minutes === 'number' ? `${minutes} dk` : '—';
}

/** A setting that is on or off; absent counts as off. */
function onOff(value: unknown): string {
  return value === true ? 'açık' : 'kapalı';
}

/** "+₺25,00" added, "−₺25,00" taken off. */
function signed(amount: unknown): string {
  if (typeof amount !== 'number') {
    return '—';
  }
  return amount < 0 ? `−${formatTRY(-amount)}` : `+${formatTRY(amount)}`;
}
