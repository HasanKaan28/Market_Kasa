import { describe, expect, it } from 'vitest';
import type { ReceiptModel } from './receipt';
import { receiptText, whatsappLink, whatsappText } from './receiptText';

const model: ReceiptModel = {
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

const gap = (n: number) => ' '.repeat(n);
const rule = '-'.repeat(32);

describe('receiptText', () => {
  it('fits the paper width', () => {
    expect(receiptText(model, 32)).toBe(
      [
        `${gap(8)}Kurşunlu Market`,
        `Kasa 1${gap(10)}29.10.2026 12:00`,
        'Fiş K1-20261029-0001',
        rule,
        `Ekmek${gap(21)}₺30,00`,
        '  2 × ₺15,00',
        `Süt${gap(23)}₺40,00`,
        '  1 × ₺42,50',
        '  İndirim −₺2,50',
        rule,
        `Ara toplam${gap(16)}₺70,00`,
        `Sepet indirimi${gap(12)}−₺5,00`,
        `Toplam${gap(20)}₺65,00`,
        `KDV %1 (dahil)${gap(13)}₺0,64`,
        rule,
        `Nakit${gap(21)}₺65,00`,
        `Alınan${gap(19)}₺100,00`,
        `Para üstü${gap(17)}₺35,00`,
        rule,
        `${gap(3)}Bilgi fişidir, mali değeri`,
        `${gap(12)}yoktur.`,
      ].join('\n'),
    );
    for (const columns of [32, 48] as const) {
      for (const line of receiptText(model, columns).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(columns);
      }
    }
  });

  it('keeps the amount and shortens a long name', () => {
    const long: ReceiptModel = {
      ...model,
      lines: [
        {
          name: 'Çok uzun bir ürün adı ve devamı var',
          detail: '1 × ₺1.234,50',
          amount: '₺1.234,50',
        },
      ],
      marks: ['İPTAL EDİLDİ'],
      customer: 'Müşteri: Ahmet Yılmaz',
    };
    const lines = receiptText(long, 32).split('\n');
    const row = lines.find((line) => line.endsWith('₺1.234,50') && line.startsWith('Çok'));
    expect(row).toHaveLength(32);
    expect(row).toContain('…');
    expect(lines).toContain('Müşteri: Ahmet Yılmaz');
    expect(lines).toContain('*** İPTAL EDİLDİ ***');
  });

  it('never cuts an emoji in half', () => {
    const emoji: ReceiptModel = {
      ...model,
      header: [`a${'🙂'.repeat(40)}`],
      lines: [{ name: 'Süt Tam Yağlı Günlük 1 🥛🥛🥛🥛', detail: '1 × ₺42,50', amount: '₺42,50' }],
    };
    // Half an emoji makes encodeURIComponent throw, and the WhatsApp button does nothing.
    expect(() => whatsappLink(whatsappText(emoji))).not.toThrow();
    for (const line of receiptText(emoji, 32).split('\n')) {
      expect(Array.from(line).length).toBeLessThanOrEqual(32);
    }
  });
});

describe('whatsappText', () => {
  it('lays the receipt out for a phone, in a monospaced block', () => {
    expect(whatsappText(model)).toBe(['```', receiptText(model, 32), '```'].join('\n'));
  });
});

describe('whatsappLink', () => {
  it('builds WhatsApp links with and without a phone', () => {
    const text = 'Fiş K1';
    expect(whatsappLink(text, '05321234567')).toBe('https://wa.me/905321234567?text=Fi%C5%9F%20K1');
    expect(whatsappLink(text, '5321234567')).toBe('https://wa.me/905321234567?text=Fi%C5%9F%20K1');
    expect(whatsappLink(text, '905321234567')).toBe(
      'https://wa.me/905321234567?text=Fi%C5%9F%20K1',
    );
    expect(whatsappLink(text, '123')).toBe('https://wa.me/?text=Fi%C5%9F%20K1');
    expect(whatsappLink(text)).toBe('https://wa.me/?text=Fi%C5%9F%20K1');
  });
});
