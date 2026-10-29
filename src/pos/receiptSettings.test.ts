import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE } from '@/app/device';
import {
  DEFAULT_RECEIPT_SETTINGS,
  loadReceiptSettings,
  receiptContext,
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
      shopName: 'Kurşunlu Market',
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
        shopName: ' Kurşunlu Market \nikinci satır',
        header: ['1', '2', '3', '4'].join('\n'),
        footer: 'x'.repeat(60),
      }),
    );
    expect(loaded).toMatchObject({
      autoPrint: false,
      shopName: 'Kurşunlu Market',
      header: '1\n2\n3',
      footer: 'x'.repeat(48),
    });
  });

  it('keeps settings saved before the shop name existed', () => {
    const saved = {
      printing: true,
      autoPrint: true,
      paperWidth: 58,
      header: 'Atatürk Cad. 5',
      footer: '',
    };
    expect(loadReceiptSettings(stored(saved))).toEqual({ ...saved, shopName: '' });
  });

  it('titles the receipt with the shop name, else the market name', () => {
    const named = { ...DEFAULT_RECEIPT_SETTINGS, shopName: 'Kurşunlu Market', header: 'Adres' };
    expect(receiptContext(DEFAULT_DEVICE, named)).toEqual({
      marketName: 'Kurşunlu Market',
      deviceName: 'Kasa 1',
      header: 'Adres',
      footer: '',
    });
    expect(receiptContext(DEFAULT_DEVICE, DEFAULT_RECEIPT_SETTINGS).marketName).toBe('Market Kasa');
  });
});
