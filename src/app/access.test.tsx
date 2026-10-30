import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppData } from '@/app/appData';
import { createCustomer } from '@/data/customers';
import { createProduct } from '@/data/products';
import { recentSales, recordSale } from '@/data/sales';
import { createStaff } from '@/data/staff';
import { invoiceForSale } from '@/data/invoices';
import { PosScreen } from '@/pos/PosScreen';
import { CustomersScreen } from '@/customers/CustomersScreen';
import { ProductsScreen } from '@/products/ProductsScreen';
import { ReportsScreen } from '@/reports/ReportsScreen';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { ApprovalDialog } from './ApprovalDialog';
import { Screens } from './Screens';
import { SessionProvider } from './SessionProvider';

const milk = { barcode: '8690000000017', name: 'Süt', sellPrice: 4250, vatRate: 1 } as const;
const before = () => new Date(Date.now() - 60_000);

async function team() {
  const data = createTestData();
  const kaan = await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
  const mehmet = await createStaff(
    data.db,
    { name: 'Mehmet', role: 'manager', pin: '2222', permissions: { seeCost: false } },
    before(),
  );
  const ayse = await createStaff(data.db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, before());
  await createStaff(data.db, { name: 'Fatma', role: 'cashier', pin: '3333' }, before());
  return { data, kaan, mehmet, ayse };
}

function signedIn(staffId: string) {
  localStorage.setItem('mk2.staff', staffId);
}

function scan(code: string) {
  for (const key of [...code, 'Enter']) {
    fireEvent.keyDown(window, { key });
  }
}

async function register(data: AppData) {
  await renderWithData(
    <SessionProvider>
      <PosScreen />
    </SessionProvider>,
    data,
  );
  expect(await screen.findByText('Ayşe')).toBeInTheDocument();
  // Created once the register is up, so its scanner is listening when the code comes.
  await createProduct(data.db, milk, before());
  scan(milk.barcode);
  expect(await screen.findByText('1 kalem')).toBeInTheDocument();
}

async function approve(name: string, pin: string) {
  const dialog = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
  await within(dialog).findByRole('option', { name });
  await userEvent.selectOptions(within(dialog).getByLabelText('Onaylayan'), name);
  await userEvent.type(within(dialog).getByLabelText('PIN'), pin);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Onayla' }));
  return dialog;
}

describe('access', () => {
  it('hides the screens a person may not use', async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    await renderWithData(
      <SessionProvider>
        <Screens route="reports" />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Bu ekran için yetkiniz yok.')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Kasa', 'Müşteriler', 'Faturalar']);
  });

  it('asks a permitted person to approve a discount', async () => {
    const { data, ayse, mehmet } = await team();
    signedIn(ayse.id);
    await register(data);
    await userEvent.click(screen.getByRole('button', { name: 'İndirim' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    await within(dialog).findByRole('option', { name: 'Kaan · Sahip' });
    const options = within(within(dialog).getByLabelText('Onaylayan')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Kaan · Sahip',
      'Mehmet · Yönetici',
    ]);
    await approve('Mehmet · Yönetici', '9999');
    expect(await within(dialog).findByText('PIN yanlış. 4 deneme kaldı.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('PIN'), '2222');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Onayla' }));
    expect(await screen.findByRole('dialog', { name: 'Sepet indirimi' })).toBeInTheDocument();
    // The approval is on record: who asked, who approved, for what.
    await vi.waitFor(async () =>
      expect(await data.db.auditLog.toArray()).toMatchObject([
        {
          action: 'approval',
          staffId: ayse.id,
          after: { permission: 'discount', approverId: mehmet.id },
        },
      ]),
    );
  });

  it('sells over the credit limit only with approval', async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    await createCustomer(data.db, { name: 'Ahmet Yılmaz', creditLimit: 1000 }, before());
    await register(data);
    await userEvent.click(screen.getByRole('button', { name: 'Veresiye' }));
    await userEvent.type(await screen.findByLabelText('Müşteri ara'), 'ahmet');
    await userEvent.click(await screen.findByRole('button', { name: /Ahmet Yılmaz/ }));
    await approve('Kaan · Sahip', '4821');
    expect(await screen.findByText(/Satış tamamlandı/)).toBeInTheDocument();
    expect((await recentSales(data.db))[0]?.payments).toEqual([{ method: 'credit', amount: 4250 }]);
  });

  it('hides cost and profit without the permission', async () => {
    const { data, mehmet } = await team();
    signedIn(mehmet.id);
    const tea = await createProduct(
      data.db,
      { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 },
      before(),
    );
    await recordSale(data.db, {
      deviceCode: 'K1',
      at: new Date(),
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    await renderWithData(
      <SessionProvider>
        <ReportsScreen />
      </SessionProvider>,
      data,
    );
    const net = await screen.findByRole('group', { name: 'Net satış' });
    expect(await within(net).findByText('₺90,00')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Brüt kâr' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CSV indir' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yazdır' })).toBeInTheDocument();
  });
  it('keeps exports to the owner', async () => {
    const { data, kaan } = await team();
    const ali = await createStaff(data.db, { name: 'Ali', role: 'stock', pin: '5555' }, before());
    signedIn(ali.id);
    const first = await renderWithData(
      <SessionProvider>
        <ProductsScreen />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('button', { name: 'İçe aktar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dışa aktar' })).not.toBeInTheDocument();
    first.unmount();
    signedIn(kaan.id);
    await renderWithData(
      <SessionProvider>
        <ProductsScreen />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('button', { name: 'Dışa aktar' })).toBeInTheDocument();
  });
  it('asks approval before a cashier lifts a credit limit or writes down a debt', async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    const ahmet = await createCustomer(
      data.db,
      { name: 'Ahmet Yılmaz', creditLimit: 1000 },
      before(),
    );
    await renderWithData(
      <SessionProvider>
        <CustomersScreen />
      </SessionProvider>,
      data,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Ahmet Yılmaz' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Düzeltme' }));
    expect(await screen.findByRole('dialog', { name: 'Yetkili onayı' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Düzenle' }));
    const form = await screen.findByRole('dialog', { name: 'Müşteriyi düzenle' });
    await userEvent.clear(within(form).getByLabelText('Limit'));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    await approve('Kaan · Sahip', '4821');
    await vi.waitFor(async () =>
      expect((await data.db.customers.get(ahmet.id))?.creditLimit).toBe(0),
    );
  });

  it('asks approval for the credit part of a split payment', async () => {
    const data = createTestData();
    await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
    const ayse = await createStaff(
      data.db,
      { name: 'Ayşe', role: 'cashier', pin: '1234', permissions: { creditSale: false } },
      before(),
    );
    signedIn(ayse.id);
    await createCustomer(data.db, { name: 'Ahmet Yılmaz' }, before());
    await register(data);
    await userEvent.click(screen.getByRole('button', { name: 'Bölünmüş' }));
    const split = await screen.findByRole('dialog', { name: 'Bölünmüş ödeme' });
    await userEvent.click(within(split).getByRole('button', { name: /Kalanı ekle · Veresiye/ }));
    await userEvent.click(within(split).getByRole('button', { name: 'Müşteri seç' }));
    await userEvent.type(await screen.findByLabelText('Müşteri ara'), 'ahmet');
    await userEvent.click(await screen.findByRole('button', { name: /Ahmet Yılmaz/ }));
    await userEvent.click(within(split).getByRole('button', { name: 'Satışı tamamla' }));
    await approve('Kaan · Sahip', '4821');
    expect(await screen.findByText(/Satış tamamlandı/)).toBeInTheDocument();
  });

  it('keeps the invoices from someone not allowed to invoice', async () => {
    const { data } = await team();
    const zeynep = await createStaff(
      data.db,
      { name: 'Zeynep', role: 'cashier', pin: '5555', permissions: { invoice: false } },
      before(),
    );
    signedIn(zeynep.id);
    await renderWithData(
      <SessionProvider>
        <Screens route="invoices" />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Bu ekran için yetkiniz yok.')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(within(nav).queryByRole('link', { name: 'Faturalar' })).toBeNull();
  });

  it('asks for an invoice from a receipt', async () => {
    const { data } = await team();
    const zeynep = await createStaff(
      data.db,
      { name: 'Zeynep', role: 'cashier', pin: '5555', permissions: { invoice: false } },
      before(),
    );
    signedIn(zeynep.id);
    const product = await createProduct(data.db, milk, before());
    const sale = await recordSale(data.db, {
      deviceCode: 'K1',
      at: before(),
      lines: [{ productId: product.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 4250 }],
    });
    await renderWithData(
      <SessionProvider>
        <PosScreen />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Zeynep')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F9' });
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(sale.receiptNo) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Fatura kes' }));
    // Zeynep's own permissions leave invoicing out: an owner approves it.
    await approve('Kaan · Sahip', '4821');
    const dialog = await screen.findByRole('dialog', { name: 'Fatura kes' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Kurumsal' }));
    await userEvent.type(within(dialog).getByLabelText('Unvan'), 'Kurşunlu Gıda Ltd. Şti.');
    await userEvent.type(within(dialog).getByLabelText('VKN / TCKN'), '1234567890');
    await userEvent.type(within(dialog).getByLabelText('Vergi dairesi'), 'Kurşunlu');
    await userEvent.type(within(dialog).getByLabelText('Adres'), 'Çarşı Mah. No: 3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fatura iste' }));
    expect(
      await screen.findByText(`Fatura isteği alındı · beklemede · ${sale.receiptNo}`),
    ).toBeInTheDocument();
    expect(await invoiceForSale(data.db, sale.id)).toMatchObject({
      status: 'pending',
      staffId: zeynep.id,
      buyer: { kind: 'company', taxId: '1234567890', taxOffice: 'Kurşunlu' },
    });
  });

  it('says when nobody can approve', async () => {
    // Two registers offline can each demote an owner, and the sync leaves none.
    const data = createTestData();
    const kaan = await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
    await createStaff(data.db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, before());
    // As the pull writes it: the server row wins.
    await data.db.staff.update(kaan.id, { role: 'cashier' });
    await renderWithData(
      <ApprovalDialog open permission="voidSale" onApproved={vi.fn()} onClose={vi.fn()} />,
      data,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    expect(
      await within(dialog).findByText('Bu işlemi onaylayabilecek kimse yok.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Onayla' })).toBeNull();
  });
});
