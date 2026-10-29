import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { addSupplierInvoice, recordSupplierPayment } from '@/data/supplierLedger';
import { archiveSupplier, createSupplier, supplierBalance } from '@/data/suppliers';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { SupplierDialog } from './SupplierDialog';
import { SuppliersScreen } from './SuppliersScreen';

const at = new Date('2026-10-20T09:00:00Z');

function rowsOf(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? ''),
    );
}

describe('SuppliersScreen', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('opens from the menu', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Ana menü' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Tedarikçiler' }));
    expect(
      await screen.findByRole('heading', { name: 'Tedarikçiler', level: 1 }),
    ).toBeInTheDocument();
  });

  it('lists suppliers with their balance', async () => {
    const data = createTestData();
    const eti = await createSupplier(data.db, { name: 'Eti', phone: '02125550011' }, at);
    await createSupplier(data.db, { name: 'Ülker' }, at);
    await addSupplierInvoice(data.db, { supplierId: eti.id, amount: 30000, purchaseId: 'p1' }, at);
    await renderWithData(<SuppliersScreen />, data);
    const table = await screen.findByRole('table', { name: 'Tedarikçiler' });
    expect(rowsOf(table)).toEqual([
      ['Eti', '02125550011', '₺300,00'],
      ['Ülker', '—', '₺0,00'],
    ]);
  });

  it('adds a supplier and refuses a second with the same name', async () => {
    const data = createTestData();
    await createSupplier(data.db, { name: 'Eti' }, at);
    await renderWithData(<SuppliersScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni tedarikçi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yeni tedarikçi' });
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'ETİ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await within(dialog).findByText('Bu adla bir tedarikçi var.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('Ad'));
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'Pınar');
    await userEvent.type(within(dialog).getByLabelText('Vergi no'), '123 456 7890');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('button', { name: 'Pınar' })).toBeInTheDocument();
    expect(await data.db.suppliers.where('name').equals('Pınar').first()).toMatchObject({
      taxNo: '1234567890',
    });
  });
});

describe('SupplierDialog', () => {
  it('pays a supplier by bank transfer and shows it in the statement', async () => {
    const data = createTestData();
    const eti = await createSupplier(data.db, { name: 'Eti' }, at);
    await addSupplierInvoice(
      data.db,
      { supplierId: eti.id, amount: 30000, purchaseId: 'p1', note: 'F-77' },
      at,
    );
    const onDone = vi.fn();
    await renderWithData(
      <SupplierDialog open supplierId={eti.id} onClose={vi.fn()} onDone={onDone} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Eti' });
    expect(await within(dialog).findByText('Bakiye: ₺300,00')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ödeme yap' }));
    expect(within(dialog).getByLabelText('Tutar')).toHaveValue('300,00');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Banka' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ödemeyi kaydet' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Ödeme kaydedildi: ₺300,00.'));
    expect(await supplierBalance(data.db, eti.id)).toBe(0);
    const statement = await within(dialog).findByRole('table', { name: 'Ekstre' });
    expect(within(statement).getByText('Ödeme (banka)')).toBeInTheDocument();
    expect(within(statement).getByText('Fatura F-77')).toBeInTheDocument();
  });

  it('says an overpayment is one, and keeps an overpaid supplier from being archived', async () => {
    const data = createTestData();
    const eti = await createSupplier(data.db, { name: 'Eti' }, at);
    await recordSupplierPayment(
      data.db,
      { deviceCode: 'K1', supplierId: eti.id, amount: 5000, method: 'cash' },
      at,
    );
    await renderWithData(
      <SupplierDialog open supplierId={eti.id} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Eti' });
    expect(await within(dialog).findByText('Bakiye: Fazla ödeme ₺50,00')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Arşivle' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ödeme yap' }));
    await userEvent.clear(within(dialog).getByLabelText('Tutar'));
    await userEvent.type(within(dialog).getByLabelText('Tutar'), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ödemeyi kaydet' }));
    expect(within(dialog).getByText('Tutar sıfırdan büyük olmalı.')).toBeInTheDocument();
  });

  it('corrects a supplier balance with a reason', async () => {
    const data = createTestData();
    const eti = await createSupplier(data.db, { name: 'Eti' }, at);
    const onDone = vi.fn();
    await renderWithData(
      <SupplierDialog open supplierId={eti.id} onClose={vi.fn()} onDone={onDone} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Eti' });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Düzeltme' }));
    await userEvent.type(within(dialog).getByLabelText('Tutar'), '300');
    await userEvent.type(within(dialog).getByLabelText('Neden'), 'açılış borcu');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Düzeltmeyi kaydet' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Düzeltme kaydedildi.'));
    expect(await supplierBalance(data.db, eti.id)).toBe(30000);
    expect(await within(dialog).findByText('Düzeltme: açılış borcu')).toBeInTheDocument();
  });

  it('prints the supplier statement under its own title', async () => {
    const data = createTestData();
    const eti = await createSupplier(data.db, { name: 'Eti' }, at);
    await recordSupplierPayment(
      data.db,
      { deviceCode: 'K1', supplierId: eti.id, amount: 5000, method: 'cash' },
      at,
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await renderWithData(
      <SupplierDialog open supplierId={eti.id} onClose={vi.fn()} onDone={vi.fn()} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Eti' });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Ekstreyi yazdır' }));
    expect(print).toHaveBeenCalledTimes(1);
    const printed = document.getElementById('print-root');
    expect(printed).toHaveTextContent('Tedarikçi ekstresi');
    expect(printed).toHaveTextContent('Bakiye: Fazla ödeme ₺50,00');
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });

  it('keeps an archived supplier with a balance in the list', async () => {
    const data = createTestData();
    const gone = await createSupplier(data.db, { name: 'Pınar' }, at);
    await archiveSupplier(data.db, gone.id, at);
    // Another register's delivery on account, pulled after the archive.
    await data.db.supplierLedger.add({
      id: 'pulled-1',
      supplierId: gone.id,
      kind: 'invoice',
      amount: 30000,
      occurredAt: at.toISOString(),
      businessDate: '2026-10-20',
    });
    await renderWithData(<SuppliersScreen />, data);
    const table = await screen.findByRole('table', { name: 'Tedarikçiler' });
    expect(rowsOf(table)).toEqual([['PınarArşivli', '—', '₺300,00']]);
  });
});
