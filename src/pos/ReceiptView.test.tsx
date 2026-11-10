import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleReceipt } from '@/test/receiptFixture';
import { pageSizeRule } from './printPage';
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
    // The printable width of 58 mm paper; jsdom computes no mm lengths, so read the style.
    expect(receipt.style.width).toBe('48mm');
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
    expect(document.getElementById('print-page')?.textContent).toMatch(/size: 80mm \d+mm;/);
    expect(document.body).toHaveClass('printing-receipt');
  });

  it('clears the print root after printing', () => {
    printReceipt(sampleReceipt, 58, vi.fn());
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(document.getElementById('print-root')).toBeNull();
    expect(document.getElementById('print-page')).toBeNull();
    expect(document.body).not.toHaveClass('printing-receipt');
  });

  it('sizes the page to the paper width and the receipt height', () => {
    expect(pageSizeRule(80, 378)).toBe('@page { size: 80mm 106mm; margin: 0; }');
    expect(pageSizeRule(58, 0)).toBe('@page { size: 58mm 40mm; margin: 0; }');
  });
});
