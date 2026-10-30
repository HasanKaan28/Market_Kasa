import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Screens } from '@/app/Screens';
import { SessionProvider } from '@/app/SessionProvider';
import { closeCashSession, openCashSession } from '@/data/cash';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { loadMarketSettings } from '@/data/settings';
import { checkPin, createStaff, updateStaff } from '@/data/staff';
import { createTestData, renderWithData } from '@/test/renderWithData';

const before = () => new Date(Date.now() - 60_000);

async function team() {
  const data = createTestData();
  const kaan = await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
  const ayse = await createStaff(data.db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, before());
  return { data, kaan, ayse };
}

async function settingsAs(data: ReturnType<typeof createTestData>, staffId?: string) {
  if (staffId) {
    localStorage.setItem('mk2.staff', staffId);
  }
  await renderWithData(
    <SessionProvider>
      <Screens route="settings" />
    </SessionProvider>,
    data,
  );
}

describe('SettingsScreen', () => {
  it('lets only the owner manage staff', async () => {
    const { data, ayse } = await team();
    await settingsAs(data, ayse.id);
    expect(await screen.findByText('Bu ekran için yetkiniz yok.')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Ana menü' });
    expect(within(nav).queryByRole('link', { name: 'Ayarlar' })).not.toBeInTheDocument();
  });

  it('adds the first person as the owner and signs them in', async () => {
    const data = createTestData();
    await settingsAs(data);
    expect(await screen.findByRole('heading', { name: 'Ayarlar', level: 1 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yeni personel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yeni personel' });
    expect(within(dialog).getByLabelText('Rol')).toHaveValue('owner');
    expect(within(dialog).getByLabelText('Rol')).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'Kaan');
    await userEvent.type(within(dialog).getByLabelText('PIN'), '4821');
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '4822');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await within(dialog).findByText('PIN’ler aynı değil.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('PIN tekrar'));
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '4821');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('button', { name: 'Kilitle' })).toBeInTheDocument();
    const [kaan] = await data.db.staff.toArray();
    expect(kaan).toMatchObject({ name: 'Kaan', role: 'owner' });
    expect(localStorage.getItem('mk2.staff')).toBe(kaan?.id);
  });

  it('changes a role and a permission', async () => {
    const { data, kaan, ayse } = await team();
    await settingsAs(data, kaan.id);
    await userEvent.click(await screen.findByRole('button', { name: /Ayşe/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ayşe' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Rol'), 'Yönetici');
    // Staff, devices, settings and exports belong to owners alone.
    expect(
      within(dialog).queryByRole('checkbox', { name: 'Personel, cihaz, ayar, dışa aktarma' }),
    ).not.toBeInTheDocument();
    const reports = within(dialog).getByRole('checkbox', { name: 'Raporlar' });
    expect(reports).toBeChecked();
    await userEvent.click(reports);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await vi.waitFor(async () =>
      expect(await data.db.staff.get(ayse.id)).toMatchObject({
        role: 'manager',
        permissions: { reports: false },
      }),
    );
  });

  it('renews a PIN and archives a person', async () => {
    const { data, kaan, ayse } = await team();
    await settingsAs(data, kaan.id);
    await userEvent.click(await screen.findByRole('button', { name: /Ayşe/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Ayşe' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'PIN’i değiştir' }));
    await userEvent.type(within(dialog).getByLabelText('Yeni PIN'), '9999');
    // Enter in the PIN fields saves the PIN, not the rest of the form.
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '9999{Enter}');
    expect(await screen.findByText('PIN değiştirildi · Ayşe')).toBeInTheDocument();
    expect(await checkPin(data.db, ayse.id, '9999', new Date())).toMatchObject({ ok: true });

    await userEvent.click(await screen.findByRole('button', { name: /Ayşe/ }));
    dialog = await screen.findByRole('dialog', { name: 'Ayşe' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pasife al' }));
    expect(await screen.findByText('Ayşe pasife alındı.')).toBeInTheDocument();
    expect((await data.db.staff.get(ayse.id))?.archivedAt).toBeDefined();

    // The last owner stays.
    await userEvent.click(await screen.findByRole('button', { name: /Kaan/ }));
    dialog = await screen.findByRole('dialog', { name: 'Kaan' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pasife al' }));
    expect(await within(dialog).findByText('Son sahip pasife alınamaz.')).toBeInTheDocument();
  });
  it('keeps the register code while its drawer is open or taken by another register', async () => {
    const { data, kaan } = await team();
    await openCashSession(data.db, { deviceCode: 'K1', openingCash: 5000 }, new Date());
    await settingsAs(data, kaan.id);
    const register = await screen.findByRole('region', { name: 'Bu kasa' });
    await userEvent.clear(within(register).getByLabelText('Kasa kodu'));
    await userEvent.type(within(register).getByLabelText('Kasa kodu'), 'K3');
    await userEvent.click(within(register).getByRole('button', { name: 'Kasayı kaydet' }));
    expect(
      await within(register).findByText(
        'Kasa açık: önce gün sonunu (Z) alın, sonra kodu değiştirin.',
      ),
    ).toBeInTheDocument();
    expect(localStorage.getItem('mk2.device')).toBeNull();
    await closeCashSession(data.db, { deviceCode: 'K1', countedCash: 5000 }, new Date());
    // K2 has rung up sales: its code is taken.
    const tea = await createProduct(
      data.db,
      { name: 'Çay', sellPrice: 1000, vatRate: 1 },
      new Date(),
    );
    await recordSale(data.db, {
      deviceCode: 'K2',
      at: new Date(),
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      payments: [{ method: 'card', amount: 1000 }],
    });
    await userEvent.clear(within(register).getByLabelText('Kasa kodu'));
    await userEvent.type(within(register).getByLabelText('Kasa kodu'), 'K2');
    await userEvent.click(within(register).getByRole('button', { name: 'Kasayı kaydet' }));
    expect(
      await within(register).findByText('K2 kodunu başka bir kasa kullanıyor.'),
    ).toBeInTheDocument();
    expect(localStorage.getItem('mk2.device')).toBeNull();
  });

  it('edits the market and this register', async () => {
    const { data, kaan } = await team();
    await settingsAs(data, kaan.id);
    await userEvent.selectOptions(await screen.findByLabelText('Gün dönümü'), '02:00');
    await userEvent.click(screen.getByRole('button', { name: 'Market ayarını kaydet' }));
    expect(await screen.findByText('Market ayarı kaydedildi.')).toBeInTheDocument();
    expect(await loadMarketSettings(data.db)).toEqual({ cutoffMinutes: 120 });
    const license = screen.getByRole('region', { name: 'Lisans' });
    expect(within(license).getByText(/Bilinmiyor/)).toBeInTheDocument();
    const register = screen.getByRole('region', { name: 'Bu kasa' });
    await userEvent.clear(within(register).getByLabelText('Kasa adı'));
    await userEvent.type(within(register).getByLabelText('Kasa adı'), 'Ön kasa');
    await userEvent.clear(within(register).getByLabelText('Kasa kodu'));
    await userEvent.type(within(register).getByLabelText('Kasa kodu'), 'K2');
    await userEvent.click(within(register).getByRole('button', { name: 'Kasayı kaydet' }));
    expect(await screen.findByText(/yeniden açıldığında/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('mk2.device') ?? '{}')).toMatchObject({
      deviceName: 'Ön kasa',
      deviceCode: 'K2',
    });
  });
  it('shows the latest entries to the owner', async () => {
    const { data, kaan, ayse } = await team();
    const actor = { deviceCode: 'K1', staffId: kaan.id };
    await updateStaff(data.db, ayse.id, { role: 'manager' }, new Date(), actor);
    await settingsAs(data, kaan.id);
    const log = await screen.findByRole('region', { name: 'İz kaydı' });
    expect(await within(log).findByText('Ayşe: rol Kasiyer → Yönetici')).toBeInTheDocument();
    // A change made on the screen is logged as the person signed in.
    await userEvent.selectOptions(await screen.findByLabelText('Gün dönümü'), '02:00');
    await userEvent.click(screen.getByRole('button', { name: 'Market ayarını kaydet' }));
    expect(await within(log).findByText('Gün dönümü 00:00 → 02:00')).toBeInTheDocument();
    expect(within(log).getAllByText('Kaan')).toHaveLength(2);
  });
});
