import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { applyInvoiceResult, requestInvoice } from '@/data/invoices';
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
