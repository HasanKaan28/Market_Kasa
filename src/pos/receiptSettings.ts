/** How this device prints receipts (DESIGN §12); kept on the device, not synced. */
export type ReceiptSettings = {
  printing: boolean;
  autoPrint: boolean;
  paperWidth: 58 | 80;
  header: string;
  footer: string;
};

// Printing stays off until the shop turns it on (the owner's choice: printing is optional).
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  printing: false,
  autoPrint: false,
  paperWidth: 80,
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
  const { printing, autoPrint, paperWidth, header, footer } = value as Record<string, unknown>;
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
    header: shortText(header),
    footer: shortText(footer),
  };
}
