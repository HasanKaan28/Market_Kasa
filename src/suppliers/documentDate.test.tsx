import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { recordPurchase } from '@/data/purchases';
import { createSupplier } from '@/data/suppliers';
import { GoodsReceipt } from '@/stock/GoodsReceipt';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { scan } from '@/test/scan';
import { SupplierInvoices } from './SupplierInvoices';
import { SupplierPaymentForm } from './SupplierPaymentForm';

afterEach(disposeTestData);

const yesterday = () => {
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(day);
};
const shown = (day: string) => day.split('-').reverse().join('.');

describe('the date on an invoice and a payment', () => {
  it('records the invoice date written at Mal kabul', async () => {
    const data = createTestData();
    await createProduct(
      data.db,
      { name: 'Süt', barcode: '8690000000012', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      new Date(),
    );
    const onDone = vi.fn();
    await renderWithData(<GoodsReceipt onDone={onDone} />, data);
    await scan('8690000000012');
    await screen.findByRole('group', { name: 'Süt' });
    await userEvent.type(screen.getByLabelText('Fatura tarihi'), yesterday());
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await data.db.purchases.toArray()).toMatchObject([{ documentDate: yesterday() }]);
  });

  it('records the payment date written in the payment form', async () => {
    const data = createTestData();
    const supplier = await createSupplier(data.db, { name: 'Toptancı' }, new Date());
    const onSaved = vi.fn();
    await renderWithData(
      <SupplierPaymentForm
        supplierId={supplier.id}
        balance={0}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
      data,
    );
    await userEvent.type(screen.getByLabelText('Tutar'), '100');
    await userEvent.click(screen.getByRole('radio', { name: 'Banka' }));
    await userEvent.type(screen.getByLabelText('Ödeme tarihi'), yesterday());
    await userEvent.click(screen.getByRole('button', { name: 'Ödemeyi kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await data.db.supplierLedger.toArray()).toMatchObject([
      { kind: 'payment', documentDate: yesterday() },
    ]);
  });

  it('lists an invoice under its own date', async () => {
    const data = createTestData();
    const supplier = await createSupplier(data.db, { name: 'Toptancı' }, new Date());
    const milk = await createProduct(
      data.db,
      { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
      new Date(),
    );
    await recordPurchase(
      data.db,
      {
        deviceCode: 'K1',
        supplierId: supplier.id,
        invoiceNo: 'F-77',
        invoiceDate: yesterday(),
        lines: [{ productId: milk.id, qtyMilli: 1000 }],
      },
      new Date(),
    );
    await renderWithData(<SupplierInvoices supplierId={supplier.id} />, data);
    expect(await screen.findByText(shown(yesterday()))).toBeInTheDocument();
  });
});
