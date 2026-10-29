import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AppData } from '@/app/appData';
import { createCustomer } from '@/data/customers';
import { createProduct } from '@/data/products';
import { recentSales, recordSale } from '@/data/sales';
import { createStaff } from '@/data/staff';
import { PosScreen } from '@/pos/PosScreen';
import { ProductsScreen } from '@/products/ProductsScreen';
import { ReportsScreen } from '@/reports/ReportsScreen';
import { createTestData, renderWithData } from '@/test/renderWithData';
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
    ).toEqual(['Kasa', 'Müşteriler']);
  });

  it('asks a permitted person to approve a discount', async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    await createProduct(data.db, milk, before());
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
  });

  it('sells over the credit limit only with approval', async () => {
    const { data, ayse } = await team();
    signedIn(ayse.id);
    await createProduct(data.db, milk, before());
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
});
