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
    case 'settings.update':
      return `Gün dönümü ${clock(before.cutoffMinutes)} → ${clock(after.cutoffMinutes)}`;
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
    case 'approval':
      return `${PERMISSION_LABELS[after.permission as Permission] ?? String(after.permission)} onayı · onaylayan ${names.staff(String(after.approverId))}`;
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
