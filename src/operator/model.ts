/** What the operator panel shows: dates, counts, sums and the words for each state and change. */
import { formatTRY } from '@/domain/money';
import { whatsappLink } from '@/pos/receiptText';
import type { CodeStatus } from './api';

/** Where a new shop installs the app; the code's message names it. */
export const APP_URL = 'https://hasankaan28.github.io/Market_Kasa/app/';

/** The message that carries a code to the shop. */
export function codeMessage(code: string): string {
  return `Market Kasa kurulum kodunuz: ${code}\nUygulama: ${APP_URL} → Market kur`;
}

/** A WhatsApp share link for a code, to any contact. */
export function codeShareLink(code: string): string {
  return whatsappLink(codeMessage(code));
}

/** A day as the operator reads it: 20 Kas 2026. */
export function dayText(at: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(at.length === 10 ? `${at}T12:00:00+03:00` : at));
}

/** A moment as the operator reads it: 20 Kas 2026 14:05. */
export function dateTimeText(at: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(at));
}

/** How long ago something happened, as one says it. */
export function agoText(at: string | null, now: Date, never = 'Hiç'): string {
  if (at === null) {
    return never;
  }
  const minutes = Math.floor((now.getTime() - Date.parse(at)) / 60_000);
  if (minutes < 2) {
    return 'Az önce';
  }
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} saat önce`;
  }
  return `${Math.floor(hours / 24)} gün önce`;
}

/** Whole days from today (in Turkey) to a day, YYYY-MM-DD; negative once it has passed. */
export function daysUntil(day: string, now: Date): number {
  const today = dayInTurkey(now.toISOString());
  return Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

/** The day (YYYY-MM-DD) a moment falls on in Turkey, for a date input. */
export function dayInTurkey(at: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(at));
}

/** A day plus some days, YYYY-MM-DD in and out. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A plan date in a few words and how urgent it is; a reminder only, it limits nothing. */
export function planDateText(
  day: string,
  now: Date,
): { text: string; tone: 'ok' | 'warning' | 'danger' } {
  const left = daysUntil(day, now);
  if (left > 7) {
    return { text: `${left} gün var`, tone: 'ok' };
  }
  if (left > 0) {
    return { text: `${left} gün var`, tone: 'warning' };
  }
  if (left === 0) {
    return { text: 'Bugün', tone: 'warning' };
  }
  return { text: `${-left} gün geçti`, tone: 'danger' };
}

/** A count with Turkish digit grouping: 12.345. */
export function countText(count: number): string {
  return new Intl.NumberFormat('tr-TR').format(count);
}

/** A sum in kuruş as lira: ₺1.234,50. */
export function moneyText(kurus: number): string {
  return formatTRY(Math.round(kurus));
}

/** A size in bytes as one says it: 12,4 KB. */
export function bytesText(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/** The synced tables, as the shop names them. */
const TABLES: Record<string, string> = {
  products: 'Ürün',
  categories: 'Kategori',
  customers: 'Müşteri',
  suppliers: 'Tedarikçi',
  staff: 'Personel',
  settings: 'Ayar',
  invoices: 'Fatura',
  sales: 'Satış',
  saleVoids: 'Satış iptali',
  returns: 'İade',
  stockMovements: 'Stok hareketi',
  stockCounts: 'Sayım',
  purchases: 'Alış',
  purchaseVoids: 'Alış iptali',
  ledger: 'Veresiye hareketi',
  supplierLedger: 'Tedarikçi hesabı',
  cashMovements: 'Kasa hareketi',
  cashSessions: 'Kasa oturumu',
  auditLog: 'İşlem kaydı',
  tabs: 'Açık hesap',
};

export function tableLabel(table: string): string {
  return TABLES[table] ?? table;
}

const PLATFORMS: Record<string, string> = {
  windows: 'Windows',
  android: 'Android',
  web: 'Tarayıcı',
};

export function platformLabel(platform: string): string {
  return PLATFORMS[platform] ?? platform;
}

export const CODE_STATUS: Record<CodeStatus, { label: string; tone: string }> = {
  unused: { label: 'Kullanılmadı', tone: 'bg-success-bg text-success' },
  used: { label: 'Kullanıldı', tone: 'bg-bg text-text-2' },
  expired: { label: 'Süresi doldu', tone: 'bg-warning-bg text-warning' },
  revoked: { label: 'İptal', tone: 'bg-danger-bg text-danger' },
};

const ACTIONS: Record<string, string> = {
  'code.issue': 'Kod üretildi',
  'code.revoke': 'Kod iptal edildi',
  'code.extend': 'Kod uzatıldı',
  'market.status': 'Durum değişti',
  'market.plan': 'Paket kaydı',
  'market.note': 'Özel not',
  'device.revoke': 'Cihaz iptal edildi',
};

export function actionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const obj = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** What a log line changed, in a few words; empty when the label says it all. */
export function actionDetail(action: string, details: Record<string, unknown>): string {
  switch (action) {
    case 'code.issue': {
      const count = Number(details.count ?? 1);
      const codes = Array.isArray(details.codes) ? details.codes.map(String) : [];
      const head = count === 1 && codes[0] ? codes[0] : `${count} kod`;
      const note = str(details.note);
      return `${head} · ${Number(details.days)} gün${note ? ` · ${note}` : ''}`;
    }
    case 'code.revoke':
      return [str(details.code), str(details.note)].filter(Boolean).join(' · ');
    case 'code.extend': {
      const to = str(details.to);
      return `${str(details.code) ?? ''} · +${Number(details.days)} gün${to ? ` · son gün ${dayText(to)}` : ''}`;
    }
    case 'market.status':
      return details.to === 'active' ? 'Etkinleştirildi' : 'Askıya alındı';
    case 'market.plan': {
      const side = (value: unknown) => {
        const { plan, until } = obj(value);
        const parts = [str(plan), str(until) ? dayText(str(until) as string) : null].filter(
          Boolean,
        );
        return parts.length > 0 ? parts.join(', ') : 'yok';
      };
      return `${side(details.from)} → ${side(details.to)}`;
    }
    case 'market.note':
      return Number(details.length) > 0 ? 'Kaydedildi' : 'Silindi';
    case 'device.revoke':
      return [str(details.code), str(details.name)].filter(Boolean).join(' · ');
    default:
      return '';
  }
}
