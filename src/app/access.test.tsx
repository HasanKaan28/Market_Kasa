import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppData } from '@/app/appData';
import { createCustomer, customerBalance } from '@/data/customers';
import { recordAdjustment } from '@/data/ledger';
import { saveMarketSettings } from '@/data/settings';
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
  const kaan = await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '482100' }, before());
  const mehmet = await createStaff(
    data.db,
    { name: 'Mehmet', role: 'manager', pin: '222222', permissions: { seeCost: false } },
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

  it('asks a permitted person to approve a discount for the amount typed', async () => {
    const { data, ayse, mehmet } = await team();
    signedIn(ayse.id);
    await register(data);
    // The dialog opens for anyone; the approval is asked for the discount itself.
    await userEvent.click(screen.getByRole('button', { name: 'İndirim' }));
    const discount = await screen.findByRole('dialog', { name: 'Sepet indirimi' });
    await userEvent.type(within(discount).getByLabelText('İndirim'), '5');
    await userEvent.click(within(discount).getByRole('button', { name: 'Uygula' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    expect(within(dialog).getByText('Sepet indirimi ₺5,00 · sepet ₺42,50')).toBeInTheDocument();
    await within(dialog).findByRole('option', { name: 'Kaan · Sahip' });
    const options = within(within(dialog).getByLabelText('Onaylayan')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Kaan · Sahip',
      'Mehmet · Yönetici',
    ]);
    await approve('Mehmet · Yönetici', '9999');
    expect(await within(dialog).findByText('PIN yanlış. 4 deneme kaldı.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('PIN'), '222222');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Onayla' }));
    await vi.waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('₺37,50'));
    expect(screen.queryByRole('dialog', { name: 'Sepet indirimi' })).not.toBeInTheDocument();
    // The approval is on record: who asked, who approved, for what and how much.
    await vi.waitFor(async () =>
      expect(await data.db.auditLog.toArray()).toMatchObject([
        {
          action: 'approval',
          staffId: ayse.id,
          after: {
            permission: 'discount',
            approverId: mehmet.id,
            amount: 500,
            summary: 'Sepet indirimi ₺5,00 · sepet ₺42,50',
          },
        },
      ]),
    );
  });

  it('leaves the cart as it was when a discount is not approved', async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    await register(data);
    await userEvent.click(screen.getByRole('button', { name: 'İndirim' }));
    const discount = await screen.findByRole('dialog', { name: 'Sepet indirimi' });
    await userEvent.type(within(discount).getByLabelText('İndirim'), '5');
    await userEvent.click(within(discount).getByRole('button', { name: 'Uygula' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(dialog).not.toBeInTheDocument());
    // What was typed is still there to change or approve again.
    expect(screen.getByRole('dialog', { name: 'Sepet indirimi' })).toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('₺42,50');
    expect(await data.db.auditLog.count()).toBe(0);
  });

  it('sells over the credit limit only with approval', async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    await createCustomer(data.db, { name: 'Ahmet Yılmaz', creditLimit: 1000 }, before());
    await register(data);
    await userEvent.click(screen.getByRole('button', { name: 'Veresiye' }));
    await userEvent.type(await screen.findByLabelText('Müşteri ara'), 'ahmet');
    await userEvent.click(await screen.findByRole('button', { name: /Ahmet Yılmaz/ }));
    await approve('Kaan · Sahip', '482100');
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
    await recordAdjustment(
      data.db,
      { customerId: ahmet.id, amount: 30000, note: 'Eski borç' },
      before(),
    );
    await renderWithData(
      <SessionProvider>
        <CustomersScreen />
      </SessionProvider>,
      data,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Ahmet Yılmaz' }));
    // The adjustment is typed first; the approval is asked for its amount on save.
    await userEvent.click(await screen.findByRole('button', { name: 'Düzeltme' }));
    const adjustment = await screen.findByRole('form', { name: 'Düzeltme' });
    await userEvent.click(within(adjustment).getByRole('radio', { name: 'Borç düş' }));
    await userEvent.type(within(adjustment).getByLabelText('Tutar'), '100');
    await userEvent.type(within(adjustment).getByLabelText('Neden'), 'İndirim');
    await userEvent.click(within(adjustment).getByRole('button', { name: 'Düzeltmeyi kaydet' }));
    const approval = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    expect(within(approval).getByText('Ahmet Yılmaz: borç −₺100,00')).toBeInTheDocument();
    await approve('Kaan · Sahip', '482100');
    await vi.waitFor(async () => expect(await customerBalance(data.db, ahmet.id)).toBe(20000));
    expect((await data.db.auditLog.toArray()).at(-1)).toMatchObject({
      action: 'approval',
      entityId: ahmet.id,
      after: { permission: 'overLimit', entity: 'customer', amount: -10000 },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Düzenle' }));
    const form = await screen.findByRole('dialog', { name: 'Müşteriyi düzenle' });
    await userEvent.clear(within(form).getByLabelText('Limit'));
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    await approve('Kaan · Sahip', '482100');
    await vi.waitFor(async () =>
      expect((await data.db.customers.get(ahmet.id))?.creditLimit).toBe(0),
    );
  });

  it('asks approval for a card collection, which leaves nothing in the drawer', async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    const ahmet = await createCustomer(data.db, { name: 'Ahmet Yılmaz' }, before());
    await recordAdjustment(
      data.db,
      { customerId: ahmet.id, amount: 30000, note: 'Eski borç' },
      before(),
    );
    await renderWithData(
      <SessionProvider>
        <CustomersScreen />
      </SessionProvider>,
      data,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Ahmet Yılmaz' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tahsilat al' }));
    const payment = await screen.findByRole('form', { name: 'Tahsilat' });
    await userEvent.click(within(payment).getByRole('radio', { name: 'Kart' }));
    await userEvent.click(within(payment).getByRole('button', { name: 'Tahsilatı kaydet' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    expect(within(dialog).getByText('Ahmet Yılmaz: kartla tahsilat ₺300,00')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await customerBalance(data.db, ahmet.id)).toBe(30000);
    // In cash it goes into the drawer and shows on the Z, so it needs nobody's say.
    await userEvent.click(within(payment).getByRole('radio', { name: 'Nakit' }));
    await userEvent.click(within(payment).getByRole('button', { name: 'Tahsilatı kaydet' }));
    await vi.waitFor(async () => expect(await customerBalance(data.db, ahmet.id)).toBe(0));
  });

  it("gives a customer a cashier adds the market's limit, not none", async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    await renderWithData(
      <SessionProvider>
        <CustomersScreen />
      </SessionProvider>,
      data,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni müşteri' }));
    const form = await screen.findByRole('dialog', { name: 'Yeni müşteri' });
    expect(await within(form).findByDisplayValue('500,00')).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Ad'), 'Veli');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    await vi.waitFor(async () =>
      expect(await data.db.customers.toArray()).toMatchObject([
        { name: 'Veli', creditLimit: 50000 },
      ]),
    );
    // No limit at all, or a higher one, is a manager's call.
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni müşteri' }));
    const second = await screen.findByRole('dialog', { name: 'Yeni müşteri' });
    await userEvent.type(within(second).getByLabelText('Ad'), 'Can');
    await userEvent.clear(within(second).getByLabelText('Limit'));
    await userEvent.click(within(second).getByRole('button', { name: 'Kaydet' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    expect(within(dialog).getByText('Yeni müşteri Can: limit yok')).toBeInTheDocument();
    await approve('Kaan · Sahip', '482100');
    await vi.waitFor(async () =>
      expect(
        (await data.db.customers.toArray()).find((customer) => customer.name === 'Can'),
      ).toMatchObject({ creditLimit: 0 }),
    );
  });

  it("gives a customer added at the register the market's limit", async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    await saveMarketSettings(data.db, { newCustomerLimit: 20000 }, before());
    await register(data);
    await userEvent.click(screen.getByRole('button', { name: 'Veresiye' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni müşteri' }));
    await userEvent.type(await screen.findByLabelText('Müşteri adı'), 'Veli');
    expect(await screen.findByText('Veresiye limiti: ₺200,00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    expect(await screen.findByText(/Satış tamamlandı/)).toBeInTheDocument();
    expect(await data.db.customers.toArray()).toMatchObject([{ name: 'Veli', creditLimit: 20000 }]);
  });

  it('shows the sales and purchases tab of Faturalar only with reports', async () => {
    const { data, ayse, kaan } = await team();
    signedIn(ayse.id);
    const { unmount } = await renderWithData(
      <SessionProvider>
        <Screens route="invoices" />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('tab', { name: 'e-Arşiv' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Alış ve satış' })).toBeNull();
    unmount();
    signedIn(kaan.id);
    await renderWithData(
      <SessionProvider>
        <Screens route="invoices" />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('tab', { name: 'Alış ve satış' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('asks approval for a credit sale with its customer and amount', async () => {
    const data = createTestData();
    const kaan = await createStaff(
      data.db,
      { name: 'Kaan', role: 'owner', pin: '482100' },
      before(),
    );
    const ayse = await createStaff(
      data.db,
      { name: 'Ayşe', role: 'cashier', pin: '1234', permissions: { creditSale: false } },
      before(),
    );
    signedIn(ayse.id);
    const ahmet = await createCustomer(data.db, { name: 'Ahmet Yılmaz' }, before());
    await register(data);
    // The customer is picked first; the approval is asked for this customer and this amount.
    await userEvent.click(screen.getByRole('button', { name: 'Veresiye' }));
    await userEvent.type(await screen.findByLabelText('Müşteri ara'), 'ahmet');
    await userEvent.click(await screen.findByRole('button', { name: /Ahmet Yılmaz/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    expect(
      within(dialog).getByText('Ahmet Yılmaz: veresiye ₺42,50 · sepet ₺42,50'),
    ).toBeInTheDocument();
    await approve('Kaan · Sahip', '482100');
    expect(await screen.findByText(/Satış tamamlandı/)).toBeInTheDocument();
    expect((await data.db.auditLog.toArray()).at(-1)).toMatchObject({
      action: 'approval',
      entityId: ahmet.id,
      after: {
        permission: 'creditSale',
        approverId: kaan.id,
        entity: 'customer',
        amount: 4250,
        summary: 'Ahmet Yılmaz: veresiye ₺42,50 · sepet ₺42,50',
      },
    });
  });

  it('asks approval for the credit part of a split payment', async () => {
    const data = createTestData();
    await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '482100' }, before());
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
    await approve('Kaan · Sahip', '482100');
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
    // The button, not F9: under load the key can land before the register listens for it.
    await userEvent.click(await screen.findByRole('button', { name: /Son fişler/ }));
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(sale.receiptNo) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Fatura kes' }));
    // Zeynep's own permissions leave invoicing out: an owner approves it.
    await approve('Kaan · Sahip', '482100');
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

  it('leaves bringing v1 customers over to the owners', async () => {
    const { data, mehmet, kaan } = await team();
    signedIn(mehmet.id);
    const { unmount } = await renderWithData(
      <SessionProvider>
        <CustomersScreen />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('button', { name: 'Yeni müşteri' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "v1'den aktar" })).toBeNull();
    unmount();
    signedIn(kaan.id);
    await renderWithData(
      <SessionProvider>
        <CustomersScreen />
      </SessionProvider>,
      data,
    );
    await userEvent.click(await screen.findByRole('button', { name: "v1'den aktar" }));
    expect(await screen.findByRole('dialog', { name: "v1'den müşteri aktar" })).toBeInTheDocument();
  });

  it('says when nobody can approve', async () => {
    // Two registers offline can each demote an owner, and the sync leaves none.
    const data = createTestData();
    const kaan = await createStaff(
      data.db,
      { name: 'Kaan', role: 'owner', pin: '482100' },
      before(),
    );
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
