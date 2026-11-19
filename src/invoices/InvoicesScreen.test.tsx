import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { reversePurchase } from '@/data/corrections';
import { applyInvoiceResult, requestInvoice } from '@/data/invoices';
import { recordPurchase } from '@/data/purchases';
import { createSupplier } from '@/data/suppliers';
import { createProduct } from '@/data/products';
import { recordReturn } from '@/data/returns';
import { recordSale } from '@/data/sales';
import { voidSale } from '@/data/voids';
import type { InvoiceBuyer } from '@/data/types';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { settlePending } from './fakeGateway';
import { InvoicesScreen } from './InvoicesScreen';

const at = new Date('2026-10-30T09:00:00Z');
const later = new Date('2026-10-30T10:00:00Z');
const ayse: InvoiceBuyer = { kind: 'person', name: 'Ayşe Yılmaz' };
const gida: InvoiceBuyer = {
  kind: 'company',
  title: 'Kurşunlu Gıda',
  taxId: '1234567890',
  taxOffice: 'Kurşunlu',
  address: 'Çarşı Mah.',
};

async function threeSales(db: MarketDb) {
  const tea = await createProduct(db, { name: 'Çay', sellPrice: 9000, vatRate: 1 }, at);
  const sell = (qty: number) =>
    recordSale(db, {
      deviceCode: 'K1',
      at,
      lines: [{ productId: tea.id, qtyMilli: qty * 1000 }],
      payments: [{ method: 'cash', amount: qty * 9000 }],
    });
  return { tea, sales: [await sell(1), await sell(2), await sell(3)] as const };
}

/** The e-Arşiv invoices asked for on sales have a tab of their own. */
async function openArchive() {
  await userEvent.click(await screen.findByRole('tab', { name: 'e-Arşiv' }));
}

function row(receiptNo: string) {
  const cell = screen.getAllByText(receiptNo)[0];
  const tr = cell?.closest('tr');
  if (!tr) {
    throw new Error(`No row for ${receiptNo}`);
  }
  return within(tr);
}

describe('InvoicesScreen', () => {
  it('lists invoices with their state', async () => {
    const data = createTestData();
    const { tea, sales } = await threeSales(data.db);
    const [first, second, third] = sales;
    const pending = await requestInvoice(
      data.db,
      { saleId: first.id, buyer: ayse, deviceCode: 'K1' },
      at,
    );
    const issued = await requestInvoice(
      data.db,
      { saleId: second.id, buyer: gida, deviceCode: 'K1' },
      at,
    );
    await applyInvoiceResult(data.db, issued.id, { ok: true, ettn: 'ETTN-0001' }, later);
    const failed = await requestInvoice(
      data.db,
      { saleId: third.id, buyer: ayse, deviceCode: 'K1' },
      at,
    );
    await applyInvoiceResult(data.db, failed.id, { ok: false, error: 'TCKN doğrulanamadı' }, later);
    await recordReturn(data.db, {
      saleId: second.id,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: later,
    });
    // K2 asked for the first sale too before the two registers synced.
    await data.db.invoices.put({
      ...pending,
      id: 'from-k2',
      deviceCode: 'K2',
      createdAt: later.toISOString(),
      updatedAt: later.toISOString(),
    });

    await renderWithData(<InvoicesScreen />, data);
    expect(await screen.findByRole('heading', { name: 'Faturalar', level: 1 })).toBeInTheDocument();
    await openArchive();
    expect(await screen.findByText('4 fatura · 2 beklemede')).toBeInTheDocument();

    const issuedRow = row(second.receiptNo);
    expect(issuedRow.getByText('Kurşunlu Gıda')).toBeInTheDocument();
    expect(issuedRow.getByText('₺180,00')).toBeInTheDocument();
    expect(issuedRow.getByText('Kesildi')).toBeInTheDocument();
    expect(issuedRow.getByText('ETTN-0001')).toBeInTheDocument();
    expect(issuedRow.getByText('İade var')).toBeInTheDocument();
    expect(issuedRow.getByText('İptal sağlayıcı üzerinden yapılır.')).toBeInTheDocument();
    expect(issuedRow.queryByRole('button')).toBeNull();

    const failedRow = row(third.receiptNo);
    expect(failedRow.getByText('Hata')).toBeInTheDocument();
    expect(failedRow.getByText('TCKN doğrulanamadı')).toBeInTheDocument();
    expect(failedRow.getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();

    const rows = screen.getAllByText(first.receiptNo).map((cell) => cell.closest('tr'));
    expect(rows).toHaveLength(2);
    expect(rows.filter((tr) => tr?.textContent?.includes('Aynı fişe ikinci istek'))).toHaveLength(
      1,
    );
  });

  it('retries a failed invoice and cancels a pending one', async () => {
    const data = createTestData();
    const { sales } = await threeSales(data.db);
    const [first, second] = sales;
    await requestInvoice(data.db, { saleId: first.id, buyer: ayse, deviceCode: 'K1' }, at);
    const failed = await requestInvoice(
      data.db,
      { saleId: second.id, buyer: gida, deviceCode: 'K1' },
      at,
    );
    await applyInvoiceResult(data.db, failed.id, { ok: false, error: 'VKN yok' }, later);
    await renderWithData(<InvoicesScreen />, data);
    await openArchive();

    await screen.findByText('2 fatura · 1 beklemede');
    await userEvent.click(row(second.receiptNo).getByRole('button', { name: 'Yeniden dene' }));
    expect(await screen.findByText('Fatura yeniden gönderilecek.')).toBeInTheDocument();
    expect(await screen.findByText('2 fatura · 2 beklemede')).toBeInTheDocument();
    expect(row(second.receiptNo).queryByText('VKN yok')).toBeNull();

    await userEvent.click(row(first.receiptNo).getByRole('button', { name: 'İptal et' }));
    expect(await screen.findByText('Fatura isteği iptal edildi.')).toBeInTheDocument();
    expect(await screen.findByText('2 fatura · 1 beklemede')).toBeInTheDocument();
    expect(row(first.receiptNo).getByText('İptal edildi')).toBeInTheDocument();
    expect(row(first.receiptNo).queryByRole('button')).toBeNull();
  });
});

describe('InvoicesScreen after a void', () => {
  it('marks the invoice of a voided sale', async () => {
    const data = createTestData();
    const { sales } = await threeSales(data.db);
    const [first] = sales;
    const invoice = await requestInvoice(
      data.db,
      { saleId: first.id, buyer: gida, deviceCode: 'K1' },
      at,
    );
    await applyInvoiceResult(data.db, invoice.id, { ok: true, ettn: 'ETTN-9' }, later);
    await voidSale(data.db, { saleId: first.id, reason: 'Yanlış', deviceCode: 'K1', at: later });
    await renderWithData(<InvoicesScreen />, data);
    await openArchive();
    await screen.findByText('1 fatura · 0 beklemede');
    expect(row(first.receiptNo).getByText('Satış iptal edildi')).toBeInTheDocument();
    expect(row(first.receiptNo).getByText('Kesildi')).toBeInTheDocument();
  });
});

describe('settlePending', () => {
  it('settles pending requests through a stand-in provider', async () => {
    const data = createTestData();
    const { sales } = await threeSales(data.db);
    const [first, second] = sales;
    const one = await requestInvoice(
      data.db,
      { saleId: first.id, buyer: ayse, deviceCode: 'K1' },
      at,
    );
    const two = await requestInvoice(
      data.db,
      { saleId: second.id, buyer: gida, deviceCode: 'K1' },
      at,
    );
    const settled = await settlePending(
      data.db,
      (invoice) =>
        invoice.buyer.kind === 'company'
          ? { ok: false, error: 'Unvan uyuşmuyor' }
          : { ok: true, ettn: `ETTN-${invoice.saleId}` },
      later,
    );
    expect(settled).toBe(2);
    expect(await data.db.invoices.get(one.id)).toMatchObject({
      status: 'issued',
      ettn: `ETTN-${first.id}`,
    });
    expect(await data.db.invoices.get(two.id)).toMatchObject({
      status: 'failed',
      error: 'Unvan uyuşmuyor',
    });
    expect(await settlePending(data.db, () => ({ ok: true, ettn: 'x' }), later)).toBe(0);
  });
});

describe('InvoicesScreen, sales and purchases', () => {
  /** Today: a cash sale of ₺90,00, and a delivery on account from Eti, F-77, of ₺360,00. */
  async function today(db: MarketDb) {
    const now = new Date();
    const tea = await createProduct(db, { name: 'Çay', sellPrice: 9000, vatRate: 1 }, now);
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at: now,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    const eti = await createSupplier(db, { name: 'Eti' }, now);
    const purchase = await recordPurchase(
      db,
      {
        deviceCode: 'K1',
        supplierId: eti.id,
        invoiceNo: 'F-77',
        payment: 'on_account',
        lines: [{ productId: tea.id, qtyMilli: 12_000, buyPrice: 3000 }],
      },
      now,
    );
    return { sale, purchase };
  }

  it('lists the range’s sales and purchases with their totals, and filters them', async () => {
    const data = createTestData();
    const { sale } = await today(data.db);
    await renderWithData(<InvoicesScreen />, data);
    expect(await screen.findByRole('tab', { name: 'Alış ve satış' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('Satış: ₺90,00 · 1 fiş')).toBeInTheDocument();
    expect(screen.getByText('Alış: ₺360,00 · 1 fatura')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Satışlar ve alışlar' });
    const saleRow = row(sale.receiptNo);
    expect(saleRow.getByText('Satış')).toBeInTheDocument();
    expect(saleRow.getByText('Nakit')).toBeInTheDocument();
    const purchaseRow = within(within(table).getByText('F-77').closest('tr') as HTMLElement);
    expect(purchaseRow.getByText('Alış')).toBeInTheDocument();
    expect(purchaseRow.getByText('Eti')).toBeInTheDocument();
    expect(purchaseRow.getByText('Veresiye')).toBeInTheDocument();
    expect(purchaseRow.getByText('₺360,00')).toBeInTheDocument();

    // The list is read again for a filter: what it drops goes once the new rows are in.
    await userEvent.click(screen.getByRole('radio', { name: 'Alış' }));
    await waitFor(() => expect(within(table).queryByText(sale.receiptNo)).toBeNull());
    expect(within(table).getByText('F-77')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Satış' }));
    await waitFor(() => expect(within(table).queryByText('F-77')).toBeNull());
    expect(within(table).getByText(sale.receiptNo)).toBeInTheDocument();

    // A range with nothing in it.
    await userEvent.clear(screen.getByLabelText('Başlangıç'));
    await userEvent.type(screen.getByLabelText('Başlangıç'), '2020-01-01');
    await userEvent.clear(screen.getByLabelText('Bitiş'));
    await userEvent.type(screen.getByLabelText('Bitiş'), '2020-01-31');
    expect(await screen.findByText('Bu aralıkta belge yok.')).toBeInTheDocument();
    expect(screen.getByText('Satış: ₺0,00 · 0 fiş')).toBeInTheDocument();
  });

  it('opens a purchase’s lines and a sale’s receipt', async () => {
    const data = createTestData();
    const { sale } = await today(data.db);
    await renderWithData(<InvoicesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'F-77' }));
    const lines = await screen.findByRole('table', { name: 'Fatura F-77' });
    expect(within(lines).getByText('Çay')).toBeInTheDocument();
    expect(within(lines).getByText('12 adet')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: sale.receiptNo }));
    const receipt = await screen.findByRole('region', { name: `Fiş ${sale.receiptNo}` });
    expect(within(receipt).getAllByText(/90,00/).length).toBeGreaterThan(0);
  });

  it('strikes through a purchase taken back and a voided sale, and leaves them out of the totals', async () => {
    const data = createTestData();
    const { sale, purchase } = await today(data.db);
    await voidSale(data.db, {
      saleId: sale.id,
      reason: 'Yanlış',
      deviceCode: 'K1',
      at: new Date(),
    });
    await reversePurchase(data.db, { purchaseId: purchase.id, reason: 'Yanlış' }, new Date(), {
      deviceCode: 'K1',
    });
    await renderWithData(<InvoicesScreen />, data);
    expect(await screen.findByText('Satış: ₺0,00 · 0 fiş')).toBeInTheDocument();
    expect(screen.getByText('Alış: ₺0,00 · 0 fatura')).toBeInTheDocument();
    const purchaseRow = within(screen.getByText('F-77').closest('tr') as HTMLElement);
    expect(purchaseRow.getByText('Geri alındı')).toBeInTheDocument();
    expect(row(sale.receiptNo).getByText('İptal edildi')).toBeInTheDocument();
  });
});
