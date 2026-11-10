import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { requestInvoice } from '@/data/invoices';
import { voidSale } from '@/data/voids';
import { renderWithData } from '@/test/renderWithData';
import { ReceiptsDialog } from './ReceiptsDialog';
import { DEFAULT_RECEIPT_SETTINGS } from './receiptSettings';

const at = new Date('2026-10-29T09:00:00Z');

async function twoSales(db: MarketDb) {
  const milk = await createProduct(db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
  const sell = () =>
    recordSale(db, {
      deviceCode: 'K1',
      at,
      lines: [{ productId: milk.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 4250 }],
    });
  return [await sell(), await sell()] as const;
}

describe('ReceiptsDialog', () => {
  it('lists recent sales and marks voided ones', async () => {
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onReturn={vi.fn()}
        onVoid={vi.fn()}
        onInvoice={vi.fn()}
        onPrint={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    const [first] = await twoSales(data.db);
    await voidSale(data.db, { saleId: first.id, reason: 'Yanlış', deviceCode: 'K1', at });
    // The live list may first show an earlier state; wait for both receipts and the badge.
    expect(await screen.findByText('K1-20261029-0001')).toBeInTheDocument();
    expect(await screen.findByText('K1-20261029-0002')).toBeInTheDocument();
    expect(await screen.findAllByText('İptal edildi')).toHaveLength(1);
  });

  it('finds a receipt by its last four digits', async () => {
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onReturn={vi.fn()}
        onVoid={vi.fn()}
        onInvoice={vi.fn()}
        onPrint={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    await twoSales(data.db);
    await screen.findByText('K1-20261029-0001');
    await userEvent.type(screen.getByLabelText('Fiş no'), '0002');
    await vi.waitFor(() => {
      expect(screen.queryByText('K1-20261029-0001')).not.toBeInTheDocument();
      expect(screen.getByText('K1-20261029-0002')).toBeInTheDocument();
    });
  });

  it('shows a receipt and starts a return or a void', async () => {
    const onReturn = vi.fn();
    const onVoid = vi.fn();
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onReturn={onReturn}
        onVoid={onVoid}
        onInvoice={vi.fn()}
        onPrint={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    const [first] = await twoSales(data.db);
    await userEvent.click(await screen.findByRole('button', { name: /K1-20261029-0001/ }));
    const detail = await screen.findByRole('region', { name: 'Fiş K1-20261029-0001' });
    expect(detail).toHaveTextContent('Süt');
    expect(detail).toHaveTextContent('1 × ₺42,50');
    expect(detail).toHaveTextContent('₺42,50');
    await userEvent.click(within(detail).getByRole('button', { name: 'İade al' }));
    expect(onReturn).toHaveBeenCalledWith(expect.objectContaining({ id: first.id }));
    await userEvent.click(within(detail).getByRole('button', { name: 'Satışı iptal et' }));
    expect(onVoid).toHaveBeenCalledWith(expect.objectContaining({ id: first.id }));
  });

  it('blocks a second void and a return on a voided sale', async () => {
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onReturn={vi.fn()}
        onVoid={vi.fn()}
        onInvoice={vi.fn()}
        onPrint={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    const [first] = await twoSales(data.db);
    await voidSale(data.db, { saleId: first.id, reason: 'Yanlış', deviceCode: 'K1', at });
    await userEvent.click(await screen.findByRole('button', { name: /K1-20261029-0001/ }));
    const detail = await screen.findByRole('region', { name: 'Fiş K1-20261029-0001' });
    await vi.waitFor(() =>
      expect(within(detail).getByRole('button', { name: 'Satışı iptal et' })).toBeDisabled(),
    );
    expect(within(detail).getByRole('button', { name: 'İade al' })).toBeDisabled();
  });

  it('flags a receipt that needs checking', async () => {
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onReturn={vi.fn()}
        onVoid={vi.fn()}
        onInvoice={vi.fn()}
        onPrint={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    const [first] = await twoSales(data.db);
    const stamp = { occurredAt: at.toISOString(), businessDate: '2026-10-29' };
    // A void and a return made on two devices that had not seen each other yet.
    await data.db.saleVoids.add({
      id: 'v1',
      saleId: first.id,
      reason: 'X',
      deviceCode: 'K2',
      ...stamp,
    });
    await data.db.returns.add({
      id: 'r1',
      saleId: first.id,
      deviceCode: 'K1',
      lines: [
        {
          productId: first.lines[0]?.productId ?? '',
          name: 'Süt',
          qtyMilli: 1000,
          net: 4250,
          vat: 42,
        },
      ],
      refunds: [{ method: 'cash', amount: 4250 }],
      amount: 4250,
      vat: 42,
      ...stamp,
    });
    expect(await screen.findByText('Kontrol gerekli')).toBeInTheDocument();
  });

  it('finds an older receipt by its last four digits', async () => {
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onReturn={vi.fn()}
        onVoid={vi.fn()}
        onInvoice={vi.fn()}
        onPrint={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    const milk = await createProduct(data.db, { name: 'Süt', sellPrice: 4250, vatRate: 1 }, at);
    for (let minute = 0; minute < 55; minute += 1) {
      await recordSale(data.db, {
        deviceCode: 'K1',
        at: new Date(at.getTime() + minute * 60_000),
        lines: [{ productId: milk.id, qtyMilli: 1000 }],
        payments: [{ method: 'cash', amount: 4250 }],
      });
    }
    await userEvent.type(screen.getByLabelText('Fiş no'), '0001');
    expect(await screen.findByText('K1-20261029-0001')).toBeInTheDocument();
  });

  it('drops the not-fiscal line once an invoice is asked for', async () => {
    const onInvoice = vi.fn();
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onReturn={vi.fn()}
        onVoid={vi.fn()}
        onInvoice={onInvoice}
        onPrint={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    const [first, second] = await twoSales(data.db);
    await requestInvoice(
      data.db,
      { saleId: first.id, buyer: { kind: 'person', name: 'Ayşe' }, deviceCode: 'K1' },
      at,
    );
    await userEvent.click(await screen.findByRole('button', { name: /K1-20261029-0001/ }));
    const detail = await screen.findByRole('region', { name: 'Fiş K1-20261029-0001' });
    expect(
      await within(detail).findByRole('button', { name: 'Fatura · Beklemede' }),
    ).toBeDisabled();
    expect(within(detail).getByRole('article')).not.toHaveTextContent('Bilgi fişidir');

    await userEvent.click(within(detail).getByRole('button', { name: 'Fişlere dön' }));
    await userEvent.click(await screen.findByRole('button', { name: /K1-20261029-0002/ }));
    const other = await screen.findByRole('region', { name: 'Fiş K1-20261029-0002' });
    expect(within(other).getByRole('article')).toHaveTextContent('Bilgi fişidir');
    await userEvent.click(await within(other).findByRole('button', { name: 'Fatura kes' }));
    expect(onInvoice).toHaveBeenCalledWith(expect.objectContaining({ id: second.id }));
  });

  it('shows the receipt and shares it on WhatsApp', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={DEFAULT_RECEIPT_SETTINGS}
        onClose={vi.fn()}
        onReturn={vi.fn()}
        onVoid={vi.fn()}
        onInvoice={vi.fn()}
        onPrint={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    await twoSales(data.db);
    await userEvent.click(await screen.findByRole('button', { name: /K1-20261029-0001/ }));
    expect(await screen.findByRole('article', { name: 'Fiş K1-20261029-0001' })).toHaveTextContent(
      'Bilgi fişidir, mali değeri yoktur.',
    );
    expect(screen.queryByRole('button', { name: 'Yazdır' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    const url = String(open.mock.calls[0]?.[0]);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(url.slice('https://wa.me/?text='.length));
    expect(text).toContain('K1-20261029-0001');
    // Laid out for a phone even with 80 mm paper (the default), in a monospaced block.
    expect(text.startsWith('```\n')).toBe(true);
    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
    open.mockRestore();
  });

  it('titles the receipt with the shop name', async () => {
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={{ ...DEFAULT_RECEIPT_SETTINGS, shopName: 'Kurşunlu Market' }}
        onClose={vi.fn()}
        onReturn={vi.fn()}
        onVoid={vi.fn()}
        onInvoice={vi.fn()}
        onPrint={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    await twoSales(data.db);
    await userEvent.click(await screen.findByRole('button', { name: /K1-20261029-0001/ }));
    const receipt = await screen.findByRole('article', { name: 'Fiş K1-20261029-0001' });
    expect(receipt).toHaveTextContent('Kurşunlu Market');
    expect(receipt).not.toHaveTextContent('Market Kasa');
  });

  it('offers printing only when it is on', async () => {
    const onPrint = vi.fn();
    const { data } = await renderWithData(
      <ReceiptsDialog
        open
        settings={{ ...DEFAULT_RECEIPT_SETTINGS, printing: true }}
        onClose={vi.fn()}
        onReturn={vi.fn()}
        onVoid={vi.fn()}
        onInvoice={vi.fn()}
        onPrint={onPrint}
        onSettings={vi.fn()}
      />,
    );
    const [first] = await twoSales(data.db);
    await userEvent.click(await screen.findByRole('button', { name: /K1-20261029-0001/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yazdır' }));
    expect(onPrint).toHaveBeenCalledWith(expect.objectContaining({ id: first.id }));
  });
});
