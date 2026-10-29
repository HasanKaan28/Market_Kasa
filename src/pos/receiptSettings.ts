import type { DeviceSettings } from '@/app/device';
import type { ReceiptContext } from './receipt';

/** How this device prints receipts (DESIGN §12); kept on the device, not synced. */
export type ReceiptSettings = {
  printing: boolean;
  autoPrint: boolean;
  paperWidth: 58 | 80;
  /** The receipt's top line; empty means the market's own name. */
  shopName: string;
  header: string;
  footer: string;
};

// Printing stays off until the shop turns it on (the owner's choice: printing is optional).
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  printing: false,
  autoPrint: false,
  paperWidth: 80,
  shopName: '',
  header: '',
  footer: '',
};

const STORAGE_KEY = 'mk2.receipt';
const MAX_LINES = 3;
const MAX_LINE_LENGTH = 48;

export function loadReceiptSettings(storage?: Pick<Storage, 'getItem'>): ReceiptSettings {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return readSettings(parsed) ?? DEFAULT_RECEIPT_SETTINGS;
  } catch {
    return DEFAULT_RECEIPT_SETTINGS;
  }
}

export function saveReceiptSettings(
  settings: ReceiptSettings,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: the settings last for this session only.
  }
}

/** What a receipt takes from this device's settings: its top line, register, header and footer. */
export function receiptContext(
  device: DeviceSettings,
  settings: ReceiptSettings,
): Pick<ReceiptContext, 'marketName' | 'deviceName' | 'header' | 'footer'> {
  return {
    marketName: settings.shopName || device.marketName,
    deviceName: device.deviceName,
    header: settings.header,
    footer: settings.footer,
  };
}

/** The first line only, trimmed and at most 48 characters: what fits the receipt's top line. */
export function shortLine(text: string): string {
  return shortText((text.split('\n')[0] ?? '').trim());
}

/** At most three lines of 48 characters: what fits a receipt header or footer. */
export function shortText(text: string): string {
  return text
    .split('\n')
    .slice(0, MAX_LINES)
    .map((line) => line.slice(0, MAX_LINE_LENGTH))
    .join('\n');
}

function readSettings(value: unknown): ReceiptSettings | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { printing, autoPrint, paperWidth, shopName, header, footer } = value as Record<
    string,
    unknown
  >;
  if (
    typeof printing !== 'boolean' ||
    typeof autoPrint !== 'boolean' ||
    (paperWidth !== 58 && paperWidth !== 80) ||
    typeof header !== 'string' ||
    typeof footer !== 'string'
  ) {
    return null;
  }
  return {
    printing,
    autoPrint: printing && autoPrint,
    paperWidth,
    // Settings saved before the shop name existed have none.
    shopName: typeof shopName === 'string' ? shortLine(shopName) : '',
    header: shortText(header),
    footer: shortText(footer),
  };
}
