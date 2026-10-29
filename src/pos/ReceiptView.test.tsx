import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleReceipt } from '@/test/receiptFixture';
import { printReceipt } from './printReceipt';
import { ReceiptView } from './ReceiptView';

afterEach(() => {
  document.getElementById('print-root')?.remove();
});

describe('ReceiptView', () => {
  it('shows the receipt lines and footer', () => {
    render(<ReceiptView model={{ ...sampleReceipt, marks: ['İPTAL EDİLDİ'] }} paperWidth={58} />);
    const receipt = screen.getByRole('article', { name: 'Fiş K1-20261029-0001' });
    expect(receipt).toHaveTextContent('Kurşunlu Market');
    expect(receipt).toHaveTextContent('İndirim −₺2,50');
    expect(receipt).toHaveTextContent('Sepet indirimi−₺5,00');
    expect(receipt).toHaveTextContent('İPTAL EDİLDİ');
    expect(receipt).toHaveTextContent('Bilgi fişidir, mali değeri yoktur.');
    // jsdom computes no mm lengths, so read the inline style itself.
    expect(receipt.style.width).toBe('58mm');
  });
});

describe('printReceipt', () => {
  it('fills the print root and calls print', () => {
    let printed = '';
    const print = vi.fn(() => {
      printed = document.getElementById('print-root')?.textContent ?? '';
    });
    printReceipt(sampleReceipt, 80, print);
    expect(print).toHaveBeenCalledTimes(1);
    expect(printed).toContain('K1-20261029-0001');
    expect(printed).toContain('Bilgi fişidir');
    expect(document.getElementById('print-page')?.textContent).toContain('80mm');
  });

  it('clears the print root after printing', () => {
    printReceipt(sampleReceipt, 58, vi.fn());
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(document.getElementById('print-root')).toBeNull();
  });
});
