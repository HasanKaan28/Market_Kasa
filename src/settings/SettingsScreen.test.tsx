import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Screens } from '@/app/Screens';
import { SessionProvider } from '@/app/SessionProvider';
import { checkPin, createStaff } from '@/data/staff';
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
    await userEvent.type(within(dialog).getByLabelText('PIN tekrar'), '9999');
    await userEvent.click(within(dialog).getByRole('button', { name: 'PIN’i kaydet' }));
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
});
