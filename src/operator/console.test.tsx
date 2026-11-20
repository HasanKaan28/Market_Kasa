import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  ActivationCode,
  LogEntry,
  MarketDetail,
  OperatorClient,
  OperatorMarket,
  Overview,
} from './api';
import { addDays, dayInTurkey } from './model';
import { OperatorApp } from './OperatorApp';

type Answer = { data?: unknown; error?: { message: string } };
type Answers = Record<string, Answer | ((args?: Record<string, unknown>) => Answer)>;

const today = dayInTurkey(new Date().toISOString());
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const kursunlu: OperatorMarket = {
  id: 'kursunlu-ab12cd',
  name: 'Kurşunlu Market',
  status: 'active',
  createdAt: '2026-11-01T09:00:00Z',
  activatedAt: '2026-11-01T09:00:00Z',
  activationCode: null,
  devices: 2,
  lastSyncAt: hoursAgo(1),
  ownerEmail: 'sahip-1@example.com',
  staff: 3,
  sales30: { count: 40, total: 456700 },
  lastSaleAt: hoursAgo(2),
  plan: 'Yıllık',
  planUntil: addDays(today, 200),
};
const yildiz: OperatorMarket = {
  id: 'yildiz-77aa00',
  name: 'Yıldız Bakkal',
  status: 'suspended',
  createdAt: '2026-11-15T09:00:00Z',
  activatedAt: '2026-11-15T09:00:00Z',
  activationCode: 'ABCD-2345',
  devices: 1,
  lastSyncAt: hoursAgo(24 * 10),
  ownerEmail: 'sahip-2@example.com',
  staff: 1,
  sales30: { count: 900, total: 9_000_000 },
  lastSaleAt: hoursAgo(24 * 10),
  plan: null,
  planUntil: null,
};
const sessiz: OperatorMarket = {
  ...kursunlu,
  id: 'sessiz-001122',
  name: 'Sessiz Market',
  createdAt: '2026-11-18T09:00:00Z',
  lastSyncAt: hoursAgo(24 * 9),
  sales30: { count: 0, total: 0 },
  plan: null,
  planUntil: null,
};

const overview: Overview = {
  markets: { total: 3, active: 2, suspended: 1, new30: 3 },
  codes: { issued: 9, used: 3, unused: 4, expired: 1, revoked: 1 },
  devices: { total: 4, seenToday: 2 },
  sales: { today: { count: 3, total: 12550 }, last30: { count: 940, total: 9_456_700 } },
  expiringCodes: [{ code: 'WXYZ-6789', note: 'Ece Market', expiresAt: hoursAgo(-48) }],
  planDue: [{ id: kursunlu.id, name: kursunlu.name, plan: 'Aylık', planUntil: addDays(today, 3) }],
  quiet: [{ id: sessiz.id, name: sessiz.name, lastSyncAt: sessiz.lastSyncAt }],
};

const detail: MarketDetail = {
  id: kursunlu.id,
  name: kursunlu.name,
  status: 'active',
  createdAt: kursunlu.createdAt,
  activatedAt: kursunlu.activatedAt,
  activationCode: 'QRST-2345',
  code: { note: 'Emin abi', createdAt: '2026-10-30T09:00:00Z', usedAt: '2026-11-01T09:00:00Z' },
  people: [
    { email: 'sahip-1@example.com', role: 'owner' },
    { email: 'yonetici-1@example.com', role: 'manager' },
  ],
  devices: [
    {
      id: 'd1',
      code: 'K1',
      name: 'Kasa 1',
      platform: 'windows',
      createdAt: '2026-11-01T09:00:00Z',
      lastSeenAt: hoursAgo(1),
      revokedAt: null,
    },
    {
      id: 'd2',
      code: 'K2',
      name: 'Eski tablet',
      platform: 'android',
      createdAt: '2026-11-02T09:00:00Z',
      lastSeenAt: null,
      revokedAt: '2026-11-10T09:00:00Z',
    },
  ],
  staff: { active: 3, archived: 1 },
  rowCounts: [
    { table: 'products', count: 1250 },
    { table: 'sales', count: 940 },
  ],
  bytes: 2_400_000,
  lastSyncAt: hoursAgo(1),
  lastSaleAt: hoursAgo(2),
  sales: {
    today: { count: 3, total: 12550 },
    last30: { count: 40, total: 456700 },
    all: { count: 940, total: 9_456_700 },
  },
  voids30: 2,
  returns30: { count: 1, total: 3000 },
  activeDevices30: 1,
  info: {
    plan: 'Yıllık',
    planUntil: addDays(today, 200),
    note: 'Öğlen arar.',
    updatedAt: hoursAgo(5),
  },
};

const codes: ActivationCode[] = [
  {
    code: 'WXYZ-6789',
    note: 'Ece Market',
    createdAt: '2026-11-19T09:00:00Z',
    expiresAt: hoursAgo(-48),
    usedAt: null,
    revokedAt: null,
    status: 'unused',
    marketId: null,
    marketName: null,
    usedByEmail: null,
  },
  {
    code: 'ABCD-2345',
    note: 'Yıldız Bakkal',
    createdAt: '2026-11-10T09:00:00Z',
    expiresAt: '2026-12-10T09:00:00Z',
    usedAt: '2026-11-15T09:00:00Z',
    revokedAt: null,
    status: 'used',
    marketId: yildiz.id,
    marketName: yildiz.name,
    usedByEmail: 'sahip-2@example.com',
  },
  {
    code: 'MNPQ-4567',
    note: 'Eski deneme',
    createdAt: '2026-10-01T09:00:00Z',
    expiresAt: '2026-10-31T09:00:00Z',
    usedAt: null,
    revokedAt: null,
    status: 'expired',
    marketId: null,
    marketName: null,
    usedByEmail: null,
  },
];

const entry = (id: number, action: string, details: Record<string, unknown>): LogEntry => ({
  id,
  at: '2026-11-20T09:00:00Z',
  action,
  marketId: action.startsWith('code.') ? null : kursunlu.id,
  marketName: action.startsWith('code.') ? null : kursunlu.name,
  operatorEmail: 'operator@example.com',
  details,
});

const page = Array.from({ length: 50 }, (_, index) =>
  entry(100 - index, 'device.revoke', { code: `K${index}`, name: `Kasa ${index}` }),
);

function fakeClient(extra: Answers = {}) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const answers: Answers = {
    op_claim: { data: false },
    op_whoami: { data: true },
    op_overview: { data: overview },
    op_list_markets: { data: [kursunlu, yildiz, sessiz] },
    op_market: { data: detail },
    op_list_codes: { data: codes },
    op_history: (args) =>
      args?.market_id
        ? { data: [entry(5, 'market.note', { length: 11 })] }
        : args?.before_id
          ? {
              data: [
                entry(1, 'code.issue', { count: 1, days: 30, note: 'Ece', codes: ['WXYZ-6789'] }),
              ],
            }
          : { data: page },
    ...extra,
  };
  const client: OperatorClient = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: {} } as unknown } })),
      signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: null })),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    async rpc(fn, args) {
      calls.push({ fn, args });
      const found = answers[fn];
      const answer = (typeof found === 'function' ? found(args) : found) ?? {};
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  };
  return { client, calls };
}

const callOf = (calls: { fn: string; args?: Record<string, unknown> }[], fn: string) =>
  calls.find((call) => call.fn === fn);

async function openTab(name: string) {
  await userEvent.click(await screen.findByRole('tab', { name }));
}

describe('the overview', () => {
  it('shows totals across markets, and the lists that need a look', async () => {
    const { client } = fakeClient();
    render(<OperatorApp client={client} />);
    expect(await screen.findByRole('heading', { name: 'Özet' })).toBeInTheDocument();
    const sales = await screen.findByLabelText('Satış');
    expect(sales).toHaveTextContent('₺125,50');
    expect(sales).toHaveTextContent('Son 30 gün · 940 satış');
    expect(screen.getByLabelText('Kodlar')).toHaveTextContent('Süresi dolan');
    expect(screen.getByText('WXYZ-6789')).toBeInTheDocument();
    expect(
      screen.getByText('Yalnız hatırlatma; markete hiçbir kısıt getirmez.'),
    ).toBeInTheDocument();
    expect(screen.getByText('3 gün var')).toBeInTheDocument();
    expect(screen.getByText('Sessiz Market')).toBeInTheDocument();
  });

  it('extends a code ending this week by 30 days', async () => {
    const { client, calls } = fakeClient({
      op_extend_code: { data: { code: 'WXYZ-6789', expiresAt: '2026-12-22T09:00:00Z' } },
    });
    render(<OperatorApp client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'WXYZ-6789: 30 gün uzat' }));
    await waitFor(() =>
      expect(callOf(calls, 'op_extend_code')?.args).toEqual({ code: 'WXYZ-6789', days: 30 }),
    );
    expect(await screen.findByText('WXYZ-6789: son gün 22 Ara 2026.')).toBeInTheDocument();
  });

  it('moves a plan date on by a month from that date, keeping the plan name', async () => {
    const { client, calls } = fakeClient({ op_set_market_plan: { data: {} } });
    render(<OperatorApp client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Kurşunlu Market: +1 ay' }));
    await waitFor(() =>
      expect(callOf(calls, 'op_set_market_plan')?.args).toEqual({
        market_id: kursunlu.id,
        plan: 'Aylık',
        plan_until: addDays(today, 33),
      }),
    );
  });

  it('opens a quiet market’s detail', async () => {
    const { client, calls } = fakeClient();
    render(<OperatorApp client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: /Sessiz Market/ }));
    expect(await screen.findByRole('heading', { name: 'Kurşunlu Market' })).toBeInTheDocument();
    expect(callOf(calls, 'op_market')?.args).toEqual({ market_id: sessiz.id });
  });
});

describe('the markets', () => {
  const names = () =>
    screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
      .filter((text) => text && /Market|Bakkal/.test(text));

  it('lists each market with its registers, staff, sales and plan', async () => {
    const { client } = fakeClient();
    render(<OperatorApp client={client} />);
    await openTab('Marketler');
    const row = (await screen.findByRole('button', { name: 'Kurşunlu Market' })).closest('li');
    expect(row).not.toBeNull();
    const item = within(row as HTMLElement);
    expect(item.getByText('2 cihaz · 3 personel')).toBeInTheDocument();
    expect(item.getByText('40 satış · ₺4.567,00')).toBeInTheDocument();
    expect(item.getByText('Yıllık')).toBeInTheDocument();
    expect(item.getByText('sahip-1@example.com')).toBeInTheDocument();
    expect(screen.getByText('3 / 3 market')).toBeInTheDocument();
  });

  it('searches, filters by state and sorts', async () => {
    const { client } = fakeClient();
    render(<OperatorApp client={client} />);
    await openTab('Marketler');
    await screen.findByRole('button', { name: 'Kurşunlu Market' });
    expect(names()).toEqual(['Sessiz Market', 'Yıldız Bakkal', 'Kurşunlu Market']);

    await userEvent.selectOptions(screen.getByLabelText('Sırala'), 'sales');
    expect(names()).toEqual(['Yıldız Bakkal', 'Kurşunlu Market', 'Sessiz Market']);
    await userEvent.selectOptions(screen.getByLabelText('Sırala'), 'name');
    expect(names()).toEqual(['Kurşunlu Market', 'Sessiz Market', 'Yıldız Bakkal']);

    await userEvent.click(screen.getByLabelText('Askıda'));
    expect(names()).toEqual(['Yıldız Bakkal']);
    await userEvent.click(screen.getByLabelText('Sessiz'));
    expect(names()).toEqual(['Sessiz Market']);
    await userEvent.click(screen.getByLabelText('Tümü'));

    await userEvent.type(screen.getByLabelText('Market ara'), 'sahip-2');
    expect(names()).toEqual(['Yıldız Bakkal']);
    await userEvent.clear(screen.getByLabelText('Market ara'));
    await userEvent.type(screen.getByLabelText('Market ara'), 'yok böyle');
    expect(screen.getByText('Bu aramaya uyan market yok.')).toBeInTheDocument();
  });

  it('opens a market’s detail and comes back', async () => {
    const { client } = fakeClient();
    render(<OperatorApp client={client} />);
    await openTab('Marketler');
    await userEvent.click(await screen.findByRole('button', { name: 'Kurşunlu Market' }));
    expect(await screen.findByRole('heading', { name: 'Bilgiler' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Geri' }));
    expect(await screen.findByRole('heading', { name: 'Marketler' })).toBeInTheDocument();
  });
});

describe('a market’s detail', () => {
  async function openDetail(extra: Answers = {}) {
    const fake = fakeClient(extra);
    render(<OperatorApp client={fake.client} />);
    await openTab('Marketler');
    await userEvent.click(await screen.findByRole('button', { name: 'Kurşunlu Market' }));
    await screen.findByRole('heading', { name: 'Bilgiler' });
    return fake;
  }

  it('shows who runs it, the code that opened it, its sales, records and registers', async () => {
    await openDetail();
    const info = screen.getByRole('region', { name: 'Bilgiler' });
    expect(info).toHaveTextContent('sahip-1@example.com');
    expect(info).toHaveTextContent('yonetici-1@example.com');
    expect(info).toHaveTextContent('QRST-2345 · Emin abi');
    expect(info).toHaveTextContent('3 kişi · 1 ayrılmış');
    const usage = screen.getByRole('region', { name: 'Satış' });
    expect(usage).toHaveTextContent('₺94.567,00');
    expect(usage).toHaveTextContent('2 iptal · 1 iade (₺30,00)');
    expect(usage).toHaveTextContent('Ürün');
    expect(usage).toHaveTextContent('2,3 MB');
    expect(screen.getByLabelText('K1 · Kasa 1')).toHaveTextContent('Windows');
    expect(screen.getByLabelText('K2 · Eski tablet')).toHaveTextContent('İptal edildi');
    expect(screen.getByRole('region', { name: 'Son işlemler' })).toHaveTextContent('Özel not');
  });

  it('asks, naming the market, before it revokes a register', async () => {
    const { calls } = await openDetail({ op_revoke_device: { data: null } });
    const k1 = screen.getByLabelText('K1 · Kasa 1');
    await userEvent.click(within(k1).getByRole('button', { name: 'Cihazı iptal et…' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Kurşunlu Market: K1 · Kasa 1');
    expect(callOf(calls, 'op_revoke_device')).toBeUndefined();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cihazı iptal et' }));
    await waitFor(() =>
      expect(callOf(calls, 'op_revoke_device')?.args).toEqual({ device_id: 'd1' }),
    );
    expect(within(screen.getByLabelText('K2 · Eski tablet')).queryByRole('button')).toBeNull();
  });

  it('shows why a confirmed change failed, and keeps the dialog open', async () => {
    await openDetail({ op_revoke_device: { error: { message: 'device_revoked' } } });
    await userEvent.click(
      within(screen.getByLabelText('K1 · Kasa 1')).getByRole('button', {
        name: 'Cihazı iptal et…',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cihazı iptal et' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Cihaz zaten iptal edilmiş.',
    );
  });

  it('asks, naming the market, before it suspends it', async () => {
    const { calls } = await openDetail({ op_set_market_status: { data: null } });
    await userEvent.click(screen.getByRole('button', { name: 'Askıya al…' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Market askıya alınsın mı?');
    expect(dialog).toHaveTextContent('Kurşunlu Market:');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    expect(callOf(calls, 'op_set_market_status')).toBeUndefined();

    await userEvent.click(screen.getByRole('button', { name: 'Askıya al…' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Askıya al' }),
    );
    await waitFor(() =>
      expect(callOf(calls, 'op_set_market_status')?.args).toEqual({
        market_id: kursunlu.id,
        status: 'suspended',
      }),
    );
  });

  it('keeps the operator’s plan record and note, said to restrict nothing', async () => {
    const { calls } = await openDetail({
      op_set_market_plan: { data: {} },
      op_set_market_note: { data: null },
    });
    const plan = screen.getByRole('region', { name: 'Paket' });
    expect(plan).toHaveTextContent('hiçbir kısıt getirmez');
    await userEvent.clear(within(plan).getByLabelText('Paket adı'));
    await userEvent.type(within(plan).getByLabelText('Paket adı'), 'Deneme');
    await userEvent.click(within(plan).getByRole('button', { name: 'Tarihi temizle' }));
    await userEvent.click(within(plan).getByRole('button', { name: 'Paketi kaydet' }));
    await waitFor(() =>
      expect(callOf(calls, 'op_set_market_plan')?.args).toEqual({
        market_id: kursunlu.id,
        plan: 'Deneme',
        plan_until: null,
      }),
    );

    const note = screen.getByRole('region', { name: 'Özel not' });
    await userEvent.type(within(note).getByLabelText('Not'), ' Salı');
    await userEvent.click(within(note).getByRole('button', { name: 'Notu kaydet' }));
    await waitFor(() =>
      expect(callOf(calls, 'op_set_market_note')?.args).toEqual({
        market_id: kursunlu.id,
        note: 'Öğlen arar. Salı',
      }),
    );
  });
});

describe('the codes', () => {
  it('issues one code and offers it on WhatsApp and to copy', async () => {
    const { client, calls } = fakeClient({ op_issue_code: { data: '7KQ4-M2XD' } });
    render(<OperatorApp client={client} />);
    await openTab('Kodlar');
    await userEvent.type(await screen.findByLabelText('Not'), 'Kurşunlu Market');
    await userEvent.click(screen.getByLabelText('7 gün'));
    await userEvent.click(screen.getByRole('button', { name: 'Kod üret' }));

    const issued = await screen.findByLabelText('Üretilen kod');
    expect(issued).toHaveTextContent('7KQ4-M2XD');
    expect(callOf(calls, 'op_issue_code')?.args).toEqual({ note: 'Kurşunlu Market', days: 7 });
    const link = within(issued).getByRole('link', { name: 'WhatsApp’ta gönder' });
    expect(link.getAttribute('href')).toContain(encodeURIComponent('7KQ4-M2XD'));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(within(issued).getByRole('button', { name: 'Kopyala' }));
    expect(writeText).toHaveBeenCalledWith('7KQ4-M2XD');
  });

  it('issues many codes at once with a custom validity', async () => {
    const { client, calls } = fakeClient({
      op_issue_codes: { data: ['AAAA-1111', 'BBBB-2222', 'CCCC-3333'] },
    });
    render(<OperatorApp client={client} />);
    await openTab('Kodlar');
    await userEvent.type(await screen.findByLabelText('Not'), 'Fuar');
    await userEvent.clear(screen.getByLabelText('Adet'));
    await userEvent.type(screen.getByLabelText('Adet'), '3');
    await userEvent.click(screen.getByLabelText('Özel'));
    await userEvent.type(screen.getByLabelText('Gün'), '45');
    await userEvent.click(screen.getByRole('button', { name: '3 kod üret' }));

    expect(await screen.findByLabelText('Üretilen kodlar')).toHaveTextContent('CCCC-3333');
    expect(callOf(calls, 'op_issue_codes')?.args).toEqual({ note: 'Fuar', days: 45, count: 3 });
  });

  it('refuses a code without a note before asking the server', async () => {
    const { client, calls } = fakeClient();
    render(<OperatorApp client={client} />);
    await openTab('Kodlar');
    await userEvent.click(await screen.findByRole('button', { name: 'Kod üret' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not yazın');
    expect(callOf(calls, 'op_issue_code')).toBeUndefined();
  });

  it('filters by state with counts, searches, and opens the market a code opened', async () => {
    const { client, calls } = fakeClient();
    render(<OperatorApp client={client} />);
    await openTab('Kodlar');
    expect(await screen.findByText('MNPQ-4567')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Kullanıldı (1)'));
    expect(screen.queryByText('MNPQ-4567')).toBeNull();
    expect(screen.getByText(/sahip-2@example.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Tümü (3)'));
    await userEvent.type(screen.getByLabelText('Kod ara'), 'ece');
    expect(screen.getByText('1 kod')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Kod ara'));

    await userEvent.click(screen.getByRole('button', { name: 'Yıldız Bakkal' }));
    await waitFor(() => expect(callOf(calls, 'op_market')?.args).toEqual({ market_id: yildiz.id }));
  });

  it('asks before it revokes a code, naming it', async () => {
    const { client, calls } = fakeClient({ op_revoke_code: { data: null } });
    render(<OperatorApp client={client} />);
    await openTab('Kodlar');
    const row = (await screen.findByText('WXYZ-6789')).closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'İptal et…' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('WXYZ-6789 · Ece Market');
    await userEvent.click(within(dialog).getByRole('button', { name: 'İptal et' }));
    await waitFor(() =>
      expect(callOf(calls, 'op_revoke_code')?.args).toEqual({ code: 'WXYZ-6789' }),
    );
  });
});

describe('the history', () => {
  it('shows each change with what it changed, and loads older pages', async () => {
    const { client, calls } = fakeClient();
    render(<OperatorApp client={client} />);
    await openTab('Geçmiş');
    expect(await screen.findByText('K0 · Kasa 0')).toBeInTheDocument();
    expect(screen.getAllByText('Cihaz iptal edildi')).toHaveLength(50);
    await userEvent.click(screen.getByRole('button', { name: 'Daha eskiler' }));
    expect(await screen.findByText('WXYZ-6789 · 30 gün · Ece')).toBeInTheDocument();
    expect(calls.filter((call) => call.fn === 'op_history').at(-1)?.args).toEqual({
      lim: 50,
      before_id: 51,
      market_id: null,
    });
    expect(screen.queryByRole('button', { name: 'Daha eskiler' })).toBeNull();
  });
});
