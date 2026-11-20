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
const LAST_OWNER = 'Son sahip kalmalı: rolü değiştirilemez, pasife alınamaz.';

async function team() {
  const data = createTestData();
  const kaan = await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '482100' }, before());
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

  it('offers the owner a backup of the whole market', async () => {
    const { data, kaan } = await team();
    await settingsAs(data, kaan.id);
    const section = await screen.findByRole('region', { name: 'Yedek' });
    expect(within(section).getByRole('button', { name: 'Yedek al' })).toBeEnabled();
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
    // An owner's PIN is six digits.
    await userEvent.type(within(dialog).getByLabelText('PIN'), '4821');
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '4821');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(
      await within(dialog).findByText('Sahip ve yönetici PIN’i 6 rakamdır.'),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('PIN'), '73');
    await userEvent.clear(within(dialog).getByLabelText('PIN tekrar'));
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '482174');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await within(dialog).findByText('PIN’ler aynı değil.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('PIN tekrar'));
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '482173');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('button', { name: 'Kilitle' })).toBeInTheDocument();
    const [kaan] = await data.db.staff.toArray();
    expect(kaan).toMatchObject({ name: 'Kaan', role: 'owner' });
    expect(JSON.parse(localStorage.getItem('mk2.staff') ?? 'null')).toMatchObject({
      staffId: kaan?.id,
    });
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
    // A manager gets a new six-digit PIN with the new role.
    await userEvent.type(within(dialog).getByLabelText('Yeni PIN'), '246813');
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '246813');
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
    expect(await within(dialog).findByText(LAST_OWNER)).toBeInTheDocument();
    // Nor made anything but an owner.
    await userEvent.selectOptions(within(dialog).getByLabelText('Rol'), 'Yönetici');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await within(dialog).findByText(LAST_OWNER)).toBeInTheDocument();
  });
  it('asks six digits for a new manager PIN, and keeps a short one already set', async () => {
    const { data, kaan } = await team();
    // A manager from before the six-digit rule: made one with the PIN they had as a cashier.
    const mehmet = await createStaff(
      data.db,
      { name: 'Mehmet', role: 'cashier', pin: '2222' },
      before(),
    );
    await updateStaff(data.db, mehmet.id, { role: 'manager' }, before());
    await settingsAs(data, kaan.id);
    await userEvent.click(await screen.findByRole('button', { name: /Mehmet/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Mehmet' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'PIN’i değiştir' }));
    expect(within(dialog).getByText('Sahip ve yönetici için 6 rakam.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Yeni PIN'), '9999');
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '9999{Enter}');
    expect(
      await within(dialog).findByText('Sahip ve yönetici PIN’i 6 rakamdır.'),
    ).toBeInTheDocument();
    // The PIN set before still opens the register.
    expect(await checkPin(data.db, mehmet.id, '2222', new Date())).toMatchObject({ ok: true });
    await userEvent.type(within(dialog).getByLabelText('Yeni PIN'), '99');
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '99{Enter}');
    expect(await screen.findByText('PIN değiştirildi · Mehmet')).toBeInTheDocument();
    expect(await checkPin(data.db, mehmet.id, '999999', new Date())).toMatchObject({ ok: true });
  });

  it('sets how soon an owner or a manager is locked out when idle', async () => {
    const { data, kaan } = await team();
    await settingsAs(data, kaan.id);
    const section = await screen.findByRole('region', { name: 'Otomatik kilit' });
    const choice = within(section).getByLabelText('Hareketsiz kalınca kilitle');
    expect(choice).toHaveValue('0');
    expect(
      within(choice)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Kapalı', '3 dk', '10 dk', '30 dk']);
    await userEvent.selectOptions(choice, '10 dk');
    await userEvent.click(within(section).getByRole('button', { name: 'Kilit ayarını kaydet' }));
    expect(await screen.findByText('Otomatik kilit kaydedildi.')).toBeInTheDocument();
    expect(await loadMarketSettings(data.db)).toMatchObject({ idleLockMinutes: 10 });
  });

  it('asks a new six-digit PIN when a cashier is made a manager', async () => {
    const { data, kaan, ayse } = await team();
    await settingsAs(data, kaan.id);
    await userEvent.click(await screen.findByRole('button', { name: /Ayşe/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ayşe' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Rol'), 'Yönetici');
    expect(
      within(dialog).getByText('Yönetici ve sahip için 6 rakamlı yeni PIN gerekir.'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(
      await within(dialog).findByText('Sahip ve yönetici PIN’i 6 rakamdır.'),
    ).toBeInTheDocument();
    expect((await data.db.staff.get(ayse.id))?.role).toBe('cashier');
    await userEvent.type(within(dialog).getByLabelText('Yeni PIN'), '135790');
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '135790');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await vi.waitFor(async () => expect((await data.db.staff.get(ayse.id))?.role).toBe('manager'));
    expect(await checkPin(data.db, ayse.id, '135790', new Date())).toMatchObject({ ok: true });
  });

  it("checks a manager's new PIN against the saved role, not one only chosen", async () => {
    const { data, kaan } = await team();
    const mehmet = await createStaff(
      data.db,
      { name: 'Mehmet', role: 'manager', pin: '246800' },
      before(),
    );
    await settingsAs(data, kaan.id);
    await userEvent.click(await screen.findByRole('button', { name: /Mehmet/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Mehmet' });
    // Kasiyer is chosen but not saved: Mehmet is still a manager when the PIN is saved.
    await userEvent.selectOptions(within(dialog).getByLabelText('Rol'), 'Kasiyer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'PIN’i değiştir' }));
    const form = within(dialog).getByRole('form', { name: 'PIN değiştir' });
    await userEvent.type(within(form).getByLabelText('Yeni PIN'), '2468');
    await userEvent.type(within(form).getByLabelText('PIN tekrar'), '2468{Enter}');
    expect(
      await within(form).findByText('Sahip ve yönetici PIN’i 6 rakamdır.'),
    ).toBeInTheDocument();
    expect(await checkPin(data.db, mehmet.id, '246800', new Date())).toMatchObject({ ok: true });
  });

  it('keeps the new customer credit limit for the whole market', async () => {
    const { data, kaan } = await team();
    await settingsAs(data, kaan.id);
    const section = await screen.findByRole('region', { name: 'Veresiye' });
    const limit = within(section).getByLabelText('Yeni müşteri veresiye limiti');
    expect(limit).toHaveValue('500,00');
    await userEvent.clear(limit);
    await userEvent.click(within(section).getByRole('button', { name: 'Limiti kaydet' }));
    expect(await within(section).findByText('Bir tutar girin.')).toBeInTheDocument();
    await userEvent.type(limit, '750');
    await userEvent.click(within(section).getByRole('button', { name: 'Limiti kaydet' }));
    expect(await screen.findByText('Veresiye ayarı kaydedildi.')).toBeInTheDocument();
    expect(await loadMarketSettings(data.db)).toMatchObject({ newCustomerLimit: 75000 });
  });

  it('keeps the register code while its drawer is open, and warns before a code used before', async () => {
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
      await within(register).findByText(
        'K2 koduyla daha önce satış yapılmış. Bu kod başka bir kasanınsa fiş numaraları karışır; yine de kullanmak için yeniden kaydedin.',
      ),
    ).toBeInTheDocument();
    expect(localStorage.getItem('mk2.device')).toBeNull();
    // It may be this register's own old code: saved on the second try.
    await userEvent.click(within(register).getByRole('button', { name: 'Kasayı kaydet' }));
    expect(
      await within(register).findByText('Kaydedildi. Uygulama yeniden açıldığında geçerli olur.'),
    ).toBeInTheDocument();
    expect(localStorage.getItem('mk2.device')).toContain('"deviceCode":"K2"');
  });

  it('edits the market and this register', async () => {
    const { data, kaan } = await team();
    await settingsAs(data, kaan.id);
    await userEvent.selectOptions(await screen.findByLabelText('Gün dönümü'), '02:00');
    await userEvent.click(screen.getByRole('button', { name: 'Market ayarını kaydet' }));
    expect(await screen.findByText('Market ayarı kaydedildi.')).toBeInTheDocument();
    expect(await loadMarketSettings(data.db)).toMatchObject({ cutoffMinutes: 120 });
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
