import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { saveMarketSettings } from '@/data/settings';
import { archiveStaff, createStaff } from '@/data/staff';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { AppShell } from './AppShell';
import { SessionProvider } from './SessionProvider';

const at = new Date('2026-10-29T09:00:00Z');

/** Kaan the owner and Ayşe the cashier; the market asks for PINs unless `requirePin` is false. */
async function staffData({ requirePin = true }: { requirePin?: boolean } = {}) {
  const data = createTestData();
  const kaan = await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '482100' }, at);
  const ayse = await createStaff(data.db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, at);
  if (requirePin) {
    await saveMarketSettings(data.db, { requirePin: true }, at);
  }
  return { data, kaan, ayse };
}

const HOUR = 60 * 60_000;

/** As this device keeps it: who signed in, and when the PIN was typed. */
function storedSignIn(): { staffId: string; signedInAt: string } | null {
  const raw = localStorage.getItem('mk2.staff');
  return raw === null ? null : (JSON.parse(raw) as { staffId: string; signedInAt: string });
}

function signedInAgo(staffId: string, ms: number) {
  localStorage.setItem(
    'mk2.staff',
    JSON.stringify({ staffId, signedInAt: new Date(Date.now() - ms).toISOString() }),
  );
}

async function signInAs(name: string, pin: string) {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  await userEvent.type(screen.getByLabelText('PIN'), pin);
  await userEvent.click(screen.getByRole('button', { name: 'Giriş' }));
}

function Shell() {
  return (
    <AppShell marketName="Bakkal" deviceName="Kasa 1" syncState="online" activeNav="pos">
      <p>Kasa ekranı</p>
    </AppShell>
  );
}

describe('SessionProvider', () => {
  it('asks for a PIN when staff are set up', async () => {
    const { data, ayse } = await staffData();
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('heading', { name: 'Kim kasada?' })).toBeInTheDocument();
    expect(screen.queryByText('Kasa ekranı')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Ayşe/ }));
    await userEvent.type(screen.getByLabelText('PIN'), '0000');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş' }));
    expect(await screen.findByText('PIN yanlış. 4 deneme kaldı.')).toBeInTheDocument();
    for (const digit of ['1', '2', '3', '4']) {
      await userEvent.click(screen.getByRole('button', { name: digit }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Giriş' }));
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    expect(storedSignIn()).toMatchObject({ staffId: ayse.id });
  });

  it('opens straight in when no staff are set up', async () => {
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
    );
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kilitle' })).not.toBeInTheDocument();
  });

  it('signs out with Kilitle', async () => {
    const { data, ayse } = await staffData();
    localStorage.setItem('mk2.staff', ayse.id);
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Ayşe')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kilitle' }));
    expect(await screen.findByRole('heading', { name: 'Kim kasada?' })).toBeInTheDocument();
    expect(localStorage.getItem('mk2.staff')).toBeNull();
  });

  it("locks an owner session after the market's idle time", async () => {
    const { data, kaan } = await staffData();
    await saveMarketSettings(data.db, { idleLockMinutes: 3 }, at);
    // A minute lasts 100 ms here: the lock comes after 300 ms with no input.
    await renderWithData(
      <SessionProvider minuteMs={100}>
        <Shell />
      </SessionProvider>,
      data,
    );
    await signInAs('Kaan', '482100');
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    expect(storedSignIn()).toMatchObject({ staffId: kaan.id });
    expect(
      await screen.findByRole('heading', { name: 'Kim kasada?' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(localStorage.getItem('mk2.staff')).toBeNull();
  });

  it('keeps a cashier signed in however long the register is idle', async () => {
    const { data, ayse } = await staffData();
    await saveMarketSettings(data.db, { idleLockMinutes: 3 }, at);
    localStorage.setItem('mk2.staff', ayse.id);
    await renderWithData(
      <SessionProvider minuteMs={30}>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByText('Kasa ekranı')).toBeInTheDocument();
  });

  it('never locks an idle owner unless the market turns the lock on', async () => {
    const { data } = await staffData();
    await renderWithData(
      <SessionProvider minuteMs={10}>
        <Shell />
      </SessionProvider>,
      data,
    );
    await signInAs('Kaan', '482100');
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    // Thirty "minutes" and more with no input: the lock is off unless set.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.getByText('Kasa ekranı')).toBeInTheDocument();
  });

  it('brings an owner back after the app is restarted', async () => {
    const { data, kaan } = await staffData();
    signedInAgo(kaan.id, 23 * HOUR);
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
  });

  it("asks an owner's PIN again a day after it was typed", async () => {
    const { data, kaan } = await staffData();
    signedInAgo(kaan.id, 25 * HOUR);
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('heading', { name: 'Kim kasada?' })).toBeInTheDocument();
    expect(screen.queryByText('Kasa ekranı')).not.toBeInTheDocument();
    expect(localStorage.getItem('mk2.staff')).toBeNull();
  });

  it("asks an owner's PIN again when the day runs out with the app open", async () => {
    const { data, kaan } = await staffData();
    // A day lasts a second here; signed in 800 ms "ago", 200 ms are left.
    signedInAgo(kaan.id, 800);
    await renderWithData(
      <SessionProvider privilegedSessionMs={1000}>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Kim kasada?' }, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it('keeps a cashier signed in however long ago the PIN was typed', async () => {
    const { data, ayse } = await staffData();
    signedInAgo(ayse.id, 30 * 24 * HOUR);
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
  });

  it('counts a sign-in kept by an earlier version as made now', async () => {
    const { data, kaan } = await staffData();
    // Before the sign-in time was kept, only the id was.
    localStorage.setItem('mk2.staff', kaan.id);
    const before = Date.now();
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    await waitFor(() => expect(storedSignIn()).toMatchObject({ staffId: kaan.id }));
    expect(Date.parse(storedSignIn()?.signedInAt ?? '')).toBeGreaterThanOrEqual(before);
  });

  it('never opens without a PIN once the market has had staff', async () => {
    const data = createTestData();
    await data.db.meta.put({ key: 'hadStaff', value: true });
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('heading', { name: 'Kasa kilitli' })).toBeInTheDocument();
    expect(screen.queryByText('Kasa ekranı')).not.toBeInTheDocument();
  });

  it('remembers that the market has had staff', async () => {
    const { data } = await staffData();
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('heading', { name: 'Kim kasada?' })).toBeInTheDocument();
    await waitFor(async () =>
      expect(await data.db.meta.get('hadStaff')).toMatchObject({ value: true }),
    );
  });

  it('leaves a session whose person was archived', async () => {
    const { data, ayse } = await staffData();
    localStorage.setItem('mk2.staff', ayse.id);
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    await archiveStaff(data.db, ayse.id, new Date());
    expect(await screen.findByRole('heading', { name: 'Kim kasada?' })).toBeInTheDocument();
  });
});

describe('SessionProvider without PINs', () => {
  function renderShell(data: ReturnType<typeof createTestData>, props = {}) {
    return renderWithData(
      <SessionProvider {...props}>
        <Shell />
      </SessionProvider>,
      data,
    );
  }

  it('opens as the owner without asking anything', async () => {
    const { data } = await staffData({ requirePin: false });
    await renderShell(data);
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    expect(screen.getByText('Kaan')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Kim kasada?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kilitle' })).not.toBeInTheDocument();
  });

  it('opens as the person last at the register', async () => {
    const { data, ayse } = await staffData({ requirePin: false });
    signedInAgo(ayse.id, HOUR);
    await renderShell(data);
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    expect(screen.getByText('Ayşe')).toBeInTheDocument();
  });

  it('opens as the owner when the last person has left', async () => {
    const { data, ayse } = await staffData({ requirePin: false });
    signedInAgo(ayse.id, HOUR);
    await archiveStaff(data.db, ayse.id, at);
    await renderShell(data);
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    expect(screen.getByText('Kaan')).toBeInTheDocument();
  });

  it('never signs the owner out after a day or when idle', async () => {
    const { data, kaan } = await staffData({ requirePin: false });
    await saveMarketSettings(data.db, { idleLockMinutes: 3 }, at);
    signedInAgo(kaan.id, 800);
    await renderShell(data, { minuteMs: 10, privilegedSessionMs: 1000 });
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    // Past the shortened day and thirty idle "minutes".
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.getByText('Kasa ekranı')).toBeInTheDocument();
    expect(screen.getByText('Kaan')).toBeInTheDocument();
  });

  it("does not ask an owner's PIN a day after the last sign-in", async () => {
    const { data, kaan } = await staffData({ requirePin: false });
    signedInAgo(kaan.id, 25 * HOUR);
    await renderShell(data);
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    expect(screen.getByText('Kaan')).toBeInTheDocument();
  });

  it('switches the person with one tap', async () => {
    const { data, ayse } = await staffData({ requirePin: false });
    await renderShell(data);
    expect(await screen.findByText('Kaan')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kişi değiştir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kişi değiştir' });
    await userEvent.click(await within(dialog).findByRole('button', { name: /Ayşe/ }));
    expect(await screen.findByText('Ayşe')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument();
    expect(storedSignIn()).toMatchObject({ staffId: ayse.id });
  });

  it('stays locked when the market has had staff and none is left', async () => {
    const data = createTestData();
    await data.db.meta.put({ key: 'hadStaff', value: true });
    await renderShell(data);
    expect(await screen.findByRole('heading', { name: 'Kasa kilitli' })).toBeInTheDocument();
  });

  it('keeps a person picked today when another register turns the PIN on', async () => {
    const { data } = await staffData({ requirePin: false });
    await renderShell(data);
    await userEvent.click(await screen.findByRole('button', { name: 'Kişi değiştir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kişi değiştir' });
    await userEvent.click(await within(dialog).findByRole('button', { name: /Kaan/ }));
    await saveMarketSettings(data.db, { requirePin: true }, new Date());
    expect(await screen.findByRole('button', { name: 'Kilitle' })).toBeInTheDocument();
    expect(screen.getByText('Kasa ekranı')).toBeInTheDocument();
  });

  it('asks for a PIN when another register turns it on and nobody was picked here', async () => {
    const { data } = await staffData({ requirePin: false });
    await renderShell(data);
    expect(await screen.findByText('Kaan')).toBeInTheDocument();
    await saveMarketSettings(data.db, { requirePin: true }, new Date());
    expect(await screen.findByRole('heading', { name: 'Kim kasada?' })).toBeInTheDocument();
  });
});
