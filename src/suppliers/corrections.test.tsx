import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@/app/SessionProvider';
import type { AppData } from '@/app/appData';
import { reversedPurchaseIds } from '@/data/corrections';
import { createProduct } from '@/data/products';
import { recordPurchase } from '@/data/purchases';
import { createStaff } from '@/data/staff';
import { stockOf } from '@/data/stock';
import { addSupplierInvoice, recordSupplierPayment } from '@/data/supplierLedger';
import { createSupplier, supplierBalance } from '@/data/suppliers';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { SupplierDialog } from './SupplierDialog';

const before = () => new Date(Date.now() - 60_000);

/** A supplier owed for one delivery on account: 12 milks at ₺30,00, invoice F-77. */
async function owed(data: AppData) {
  const eti = await createSupplier(data.db, { name: 'Eti' }, before());
  const milk = await createProduct(
    data.db,
    { name: 'Süt', sellPrice: 4250, buyPrice: 3000, vatRate: 1 },
    before(),
  );
  const purchase = await recordPurchase(
    data.db,
    {
      deviceCode: 'K1',
      supplierId: eti.id,
      invoiceNo: 'F-77',
      payment: 'on_account',
      lines: [{ productId: milk.id, qtyMilli: 12000 }],
    },
    before(),
  );
  return { eti, milk, purchase };
}

async function open(data: AppData, supplierId: string, onDone = vi.fn()) {
  await renderWithData(
    <SessionProvider>
      <SupplierDialog open supplierId={supplierId} onClose={vi.fn()} onDone={onDone} />
    </SessionProvider>,
    data,
  );
  return screen.findByRole('dialog', { name: 'Eti' });
}

describe('taking back and correcting a supplier invoice', () => {
  it('takes a delivery on account back with a reason and shows it struck through', async () => {
    const data = createTestData();
    const { eti, milk, purchase } = await owed(data);
    const onDone = vi.fn();
    const dialog = await open(data, eti.id, onDone);
    const invoices = await within(dialog).findByRole('list', { name: 'Faturalar' });
    await userEvent.click(within(invoices).getByRole('button', { name: 'Geri al: Fatura F-77' }));

    const form = await within(dialog).findByRole('form', { name: 'Geri al' });
    expect(within(form).getByText(/ürün fiyatları değişmez/i)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Geri al' }));
    expect(await within(form).findByText('Neden geri alındığını yazın.')).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Neden'), 'Yanlış fatura');
    await userEvent.click(within(form).getByRole('button', { name: 'Geri al' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Fatura geri alındı.'));
    expect(await supplierBalance(data.db, eti.id)).toBe(0);
    expect(await stockOf(data.db, milk.id)).toBe(0);
    expect(await reversedPurchaseIds(data.db, [purchase.id])).toEqual(new Set([purchase.id]));
    const row = (await within(invoices).findByText('Geri alındı')).closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByRole('button', { name: /Geri al:/ })).toBeNull();
    const statement = within(dialog).getByRole('table', { name: 'Ekstre' });
    expect(within(statement).getByText('Geri alındı')).toBeInTheDocument();
    expect(
      within(statement).getByText(/Geri alma: Fatura F-77 · Yanlış fatura/),
    ).toBeInTheDocument();
  });

  it('corrects a goods receipt after showing the old and the new total', async () => {
    const data = createTestData();
    const { eti, milk, purchase } = await owed(data);
    const onDone = vi.fn();
    const dialog = await open(data, eti.id, onDone);
    const invoices = await within(dialog).findByRole('list', { name: 'Faturalar' });
    await userEvent.click(within(invoices).getByRole('button', { name: 'Düzelt: Fatura F-77' }));

    const correction = await screen.findByRole('dialog', { name: 'Faturayı düzelt' });
    const line = await within(correction).findByRole('group', { name: 'Süt' });
    expect(within(line).getByLabelText('Miktar')).toHaveValue('12');
    expect(within(line).getByLabelText('Alış fiyatı')).toHaveValue('30,00');
    expect(within(correction).getByLabelText('Fatura no')).toHaveValue('F-77');
    await userEvent.clear(within(line).getByLabelText('Miktar'));
    await userEvent.type(within(line).getByLabelText('Miktar'), '10');
    await userEvent.click(within(correction).getByRole('button', { name: 'Onayla' }));

    expect(await within(correction).findByText('Eski toplam: ₺360,00')).toBeInTheDocument();
    expect(within(correction).getByText('Yeni toplam: ₺300,00')).toBeInTheDocument();
    await userEvent.click(within(correction).getByRole('button', { name: 'Evet, düzelt' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Fatura düzeltildi: ₺300,00.'));
    expect(await supplierBalance(data.db, eti.id)).toBe(30000);
    expect(await stockOf(data.db, milk.id)).toBe(10000);
    const corrected = (await data.db.purchases.toArray()).find((row) => row.id !== purchase.id);
    expect(corrected).toMatchObject({ correctsId: purchase.id, invoiceNo: 'F-77' });
    // The draft of an ordinary goods receipt on this device is not touched by a correction.
    expect(localStorage.getItem('mk2.goodsReceipt')).toBeNull();
  });

  it('corrects a payment after showing the old and the new amount', async () => {
    const data = createTestData();
    const eti = await createSupplier(data.db, { name: 'Eti' }, before());
    await addSupplierInvoice(
      data.db,
      { supplierId: eti.id, amount: 50000, purchaseId: 'p1' },
      before(),
    );
    const old = await recordSupplierPayment(
      data.db,
      { deviceCode: 'K1', supplierId: eti.id, amount: 30000, method: 'bank', note: 'Havale' },
      before(),
    );
    const onDone = vi.fn();
    const dialog = await open(data, eti.id, onDone);
    const statement = await within(dialog).findByRole('table', { name: 'Ekstre' });
    await userEvent.click(
      within(statement).getByRole('button', { name: 'Düzelt: Ödeme (banka): Havale' }),
    );

    const form = await within(dialog).findByRole('form', { name: 'Ödemeyi düzelt' });
    expect(within(form).getByLabelText('Tutar')).toHaveValue('300,00');
    expect(within(form).getByRole('radio', { name: 'Banka' })).toBeChecked();
    await userEvent.clear(within(form).getByLabelText('Tutar'));
    await userEvent.type(within(form).getByLabelText('Tutar'), '250');
    await userEvent.click(within(form).getByRole('button', { name: 'Onayla' }));
    expect(await within(form).findByText('Eski tutar: ₺300,00')).toBeInTheDocument();
    expect(within(form).getByText('Yeni tutar: ₺250,00')).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Evet, düzelt' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Ödeme düzeltildi: ₺250,00.'));
    expect(await supplierBalance(data.db, eti.id)).toBe(25000);
    const payments = (await data.db.supplierLedger.toArray()).filter(
      (entry) => entry.kind === 'payment',
    );
    expect(payments.find((entry) => entry.id !== old.id)).toMatchObject({ correctsId: old.id });
  });

  it('takes a payment back and shows it struck through', async () => {
    const data = createTestData();
    const eti = await createSupplier(data.db, { name: 'Eti' }, before());
    await addSupplierInvoice(
      data.db,
      { supplierId: eti.id, amount: 50000, purchaseId: 'p1' },
      before(),
    );
    await recordSupplierPayment(
      data.db,
      { deviceCode: 'K1', supplierId: eti.id, amount: 30000, method: 'bank' },
      before(),
    );
    const onDone = vi.fn();
    const dialog = await open(data, eti.id, onDone);
    const statement = await within(dialog).findByRole('table', { name: 'Ekstre' });
    await userEvent.click(
      within(statement).getByRole('button', { name: 'Geri al: Ödeme (banka)' }),
    );
    const form = await within(dialog).findByRole('form', { name: 'Geri al' });
    await userEvent.type(within(form).getByLabelText('Neden'), 'İki kez girildi');
    await userEvent.click(within(form).getByRole('button', { name: 'Geri al' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Ödeme geri alındı.'));
    expect(await supplierBalance(data.db, eti.id)).toBe(50000);
    expect(await within(statement).findByText('Geri alındı')).toBeInTheDocument();
    expect(within(statement).queryByRole('button', { name: /Ödeme \(banka\)/ })).toBeNull();
  });

  it('asks a manager or the owner to approve it for someone who may not', async () => {
    const data = createTestData();
    await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '482100' }, before());
    const deniz = await createStaff(
      data.db,
      { name: 'Deniz', role: 'stock', pin: '1234' },
      before(),
    );
    localStorage.setItem('mk2.staff', deniz.id);
    const { eti } = await owed(data);
    const dialog = await open(data, eti.id);
    const invoices = await within(dialog).findByRole('list', { name: 'Faturalar' });
    await userEvent.click(within(invoices).getByRole('button', { name: 'Geri al: Fatura F-77' }));

    const approval = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    expect(within(dialog).queryByRole('form', { name: 'Geri al' })).toBeNull();
    await within(approval).findByRole('option', { name: 'Kaan · Sahip' });
    await userEvent.type(within(approval).getByLabelText('PIN'), '482100');
    await userEvent.click(within(approval).getByRole('button', { name: 'Onayla' }));

    expect(await within(dialog).findByRole('form', { name: 'Geri al' })).toBeInTheDocument();
    await waitFor(async () =>
      expect((await data.db.auditLog.toArray()).map((entry) => entry.action)).toContain('approval'),
    );
  });

  it('asks approval for a hand-made change to what is owed, for its amount', async () => {
    const data = createTestData();
    const kaan = await createStaff(
      data.db,
      { name: 'Kaan', role: 'owner', pin: '482100' },
      before(),
    );
    const deniz = await createStaff(
      data.db,
      { name: 'Deniz', role: 'stock', pin: '1234' },
      before(),
    );
    localStorage.setItem('mk2.staff', deniz.id);
    const { eti } = await owed(data);
    const onDone = vi.fn();
    const dialog = await open(data, eti.id, onDone);
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Düzeltme' }));
    const form = await within(dialog).findByRole('form', { name: 'Düzeltme' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Borç düş' }));
    await userEvent.type(within(form).getByLabelText('Tutar'), '100');
    await userEvent.type(within(form).getByLabelText('Neden'), 'İskonto');
    await userEvent.click(within(form).getByRole('button', { name: 'Düzeltmeyi kaydet' }));

    const approval = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    expect(within(approval).getByText('Eti: borç −₺100,00')).toBeInTheDocument();
    expect(await supplierBalance(data.db, eti.id)).toBe(36000);
    await within(approval).findByRole('option', { name: 'Kaan · Sahip' });
    await userEvent.type(within(approval).getByLabelText('PIN'), '482100');
    await userEvent.click(within(approval).getByRole('button', { name: 'Onayla' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Düzeltme kaydedildi.'));
    expect(await supplierBalance(data.db, eti.id)).toBe(26000);
    // Both can land in the same millisecond: compared in the order of their actions.
    const log = (await data.db.auditLog.toArray()).sort((a, b) => a.action.localeCompare(b.action));
    expect(log).toMatchObject([
      {
        action: 'approval',
        staffId: deniz.id,
        entityId: eti.id,
        after: { permission: 'correctSupplier', approverId: kaan.id, amount: -10000 },
      },
      {
        action: 'supplierLedger.adjust',
        entity: 'supplierLedger',
        staffId: deniz.id,
        after: { supplierId: eti.id, amount: -10000, note: 'İskonto' },
      },
    ]);
  });
});
