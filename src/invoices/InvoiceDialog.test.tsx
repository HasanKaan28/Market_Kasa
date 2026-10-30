import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { InvoiceDialog } from './InvoiceDialog';

const at = new Date('2026-10-30T09:00:00Z');

async function oneSale() {
  const data = createTestData();
  const bread = await createProduct(data.db, { name: 'Ekmek', sellPrice: 1500, vatRate: 1 }, at);
  const sale = await recordSale(data.db, {
    deviceCode: 'K1',
    at,
    lines: [{ productId: bread.id, qtyMilli: 2000 }],
    payments: [{ method: 'cash', amount: 3000 }],
  });
  return { data, sale };
}

describe('InvoiceDialog', () => {
  it('checks the buyer before asking', async () => {
    const { data, sale } = await oneSale();
    const onRequested = vi.fn();
    await renderWithData(
      <InvoiceDialog open sale={sale} onClose={vi.fn()} onRequested={onRequested} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Fatura kes' });
    expect(dialog).toHaveTextContent(`${sale.receiptNo} · ₺30,00`);
    const ask = within(dialog).getByRole('button', { name: 'Fatura iste' });

    await userEvent.click(ask);
    expect(await within(dialog).findByText('Ad soyad gerekli.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Ad soyad'), 'Ayşe Yılmaz');
    await userEvent.type(within(dialog).getByLabelText('TCKN (isteğe bağlı)'), '10000000147');
    await userEvent.click(ask);
    expect(await within(dialog).findByText('TCKN geçersiz.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Kurumsal' }));
    await userEvent.type(within(dialog).getByLabelText('VKN'), '1234567891');
    await userEvent.click(ask);
    expect(await within(dialog).findByText('Unvan gerekli.')).toBeInTheDocument();
    expect(within(dialog).getByText('VKN geçersiz.')).toBeInTheDocument();
    expect(within(dialog).getByText('Vergi dairesi gerekli.')).toBeInTheDocument();
    expect(within(dialog).getByText('Adres gerekli.')).toBeInTheDocument();
    expect(onRequested).not.toHaveBeenCalled();

    // Back to a person: the typed details are still there.
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Bireysel' }));
    await userEvent.clear(within(dialog).getByLabelText('TCKN (isteğe bağlı)'));
    await userEvent.type(within(dialog).getByLabelText('TCKN (isteğe bağlı)'), '10000000146');
    await userEvent.click(ask);
    await vi.waitFor(() => expect(onRequested).toHaveBeenCalledTimes(1));
    expect(onRequested.mock.calls[0]?.[0]).toMatchObject({
      saleId: sale.id,
      status: 'pending',
      deviceCode: 'K1',
      buyer: { kind: 'person', name: 'Ayşe Yılmaz', tckn: '10000000146' },
    });
  });

  it('keeps a long address on several lines', async () => {
    const { data, sale } = await oneSale();
    const onRequested = vi.fn();
    await renderWithData(
      <InvoiceDialog open sale={sale} onClose={vi.fn()} onRequested={onRequested} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Fatura kes' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Kurumsal' }));
    await userEvent.type(within(dialog).getByLabelText('Unvan'), 'Kurşunlu Gıda');
    await userEvent.type(within(dialog).getByLabelText('VKN'), '1234567890');
    await userEvent.type(within(dialog).getByLabelText('Vergi dairesi'), 'Kurşunlu');
    await userEvent.type(within(dialog).getByLabelText('Adres'), 'Çarşı Mah.{enter}Kurşunlu');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fatura iste' }));
    await vi.waitFor(() => expect(onRequested).toHaveBeenCalledTimes(1));
    expect(onRequested.mock.calls[0]?.[0]).toMatchObject({
      buyer: { kind: 'company', address: 'Çarşı Mah.\nKurşunlu' },
    });
  });
});
