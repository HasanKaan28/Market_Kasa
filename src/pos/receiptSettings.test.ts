import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECEIPT_SETTINGS,
  loadReceiptSettings,
  saveReceiptSettings,
  type ReceiptSettings,
} from './receiptSettings';

const stored = (value: unknown) => ({ getItem: () => JSON.stringify(value) });

describe('receipt settings', () => {
  it('falls back to printing off', () => {
    expect(DEFAULT_RECEIPT_SETTINGS).toMatchObject({ printing: false, autoPrint: false });
    expect(loadReceiptSettings({ getItem: () => null })).toEqual(DEFAULT_RECEIPT_SETTINGS);
    expect(loadReceiptSettings({ getItem: () => 'not json' })).toEqual(DEFAULT_RECEIPT_SETTINGS);
    expect(
      loadReceiptSettings({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_RECEIPT_SETTINGS);
    expect(loadReceiptSettings(stored({ ...DEFAULT_RECEIPT_SETTINGS, paperWidth: 70 }))).toEqual(
      DEFAULT_RECEIPT_SETTINGS,
    );
  });

  it('round-trips settings', () => {
    const store = new Map<string, string>();
    const settings: ReceiptSettings = {
      printing: true,
      autoPrint: true,
      paperWidth: 58,
      header: 'Atatürk Cad. 5',
      footer: 'Teşekkürler',
    };
    saveReceiptSettings(settings, { setItem: (key, value) => void store.set(key, value) });
    expect(loadReceiptSettings({ getItem: (key) => store.get(key) ?? null })).toEqual(settings);
  });

  it('keeps header and footer short and auto print tied to printing', () => {
    const loaded = loadReceiptSettings(
      stored({
        ...DEFAULT_RECEIPT_SETTINGS,
        autoPrint: true,
        header: ['1', '2', '3', '4'].join('\n'),
        footer: 'x'.repeat(60),
      }),
    );
    expect(loaded).toMatchObject({ autoPrint: false, header: '1\n2\n3', footer: 'x'.repeat(48) });
  });
});
