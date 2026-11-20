import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActivationCode, OperatorClient, OperatorMarket } from './api';
import { OperatorApp } from './OperatorApp';
import { isOperatorHash } from './route';

type Answer = { data?: unknown; error?: { message: string } };

const market: OperatorMarket = {
  id: 'kursunlu-ab12cd',
  name: 'Kurşunlu Market',
  status: 'active',
  createdAt: '2026-11-01T09:00:00Z',
  activatedAt: '2026-11-01T09:00:00Z',
  activationCode: null,
  devices: 2,
  lastSyncAt: '2026-11-20T09:00:00Z',
  ownerEmail: null,
};

const unused: ActivationCode = {
  code: 'ABCD-2345',
  note: 'Yıldız Bakkal',
  createdAt: '2026-11-20T09:00:00Z',
  expiresAt: '2026-12-20T09:00:00Z',
  usedAt: null,
  revokedAt: null,
  status: 'unused',
  marketId: null,
  marketName: null,
};

/** Credentials made up for each test, so no address or password is written in the code. */
function credentials() {
  return { email: `${crypto.randomUUID()}@example.com`, password: crypto.randomUUID() };
}

function fakeClient(
  answers: Record<string, Answer | ((args?: Record<string, unknown>) => Answer)>,
  { session = null as unknown, signUpSession = { user: {} } as unknown } = {},
) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const auth = {
    getSession: vi.fn(async () => ({ data: { session } })),
    signInWithPassword: vi.fn(async () => ({
      data: { session: { user: {} } as unknown },
      error: null as { message: string } | null,
    })),
    signUp: vi.fn(async () => ({ data: { session: signUpSession }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  const client: OperatorClient = {
    auth,
    async rpc(fn, args) {
      calls.push({ fn, args });
      const entry = answers[fn];
      const answer = (typeof entry === 'function' ? entry(args) : entry) ?? {};
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  };
  return { client, calls, auth };
}

const OPERATOR = {
  op_claim: { data: false },
  op_whoami: { data: true },
  op_list_codes: { data: [unused] },
  op_list_markets: { data: [market] },
};

async function signIn(email: string, password: string) {
  await userEvent.type(await screen.findByLabelText('E-posta'), email);
  await userEvent.type(screen.getByLabelText('Şifre'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));
}

describe('OperatorApp', () => {
  it('signs in with email and password, claims, checks and shows the panel', async () => {
    const { client, calls, auth } = fakeClient(OPERATOR);
    render(<OperatorApp client={client} />);
    const { email, password } = credentials();
    await signIn(email, password);

    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email, password });
    expect(await screen.findByRole('heading', { name: 'Kod üret' })).toBeInTheDocument();
    expect(calls.map((call) => call.fn).slice(0, 2)).toEqual(['op_claim', 'op_whoami']);
    expect(await screen.findByText('ABCD-2345')).toBeInTheDocument();
    expect(screen.getByText('Kurşunlu Market')).toBeInTheDocument();
  });

  it('tells a signed-in account without operator rights that it has none', async () => {
    const { client } = fakeClient({ op_whoami: { error: { message: 'not_operator' } } });
    render(<OperatorApp client={client} />);
    const { email, password } = credentials();
    await signIn(email, password);

    expect(await screen.findByRole('alert')).toHaveTextContent('Bu hesabın yetkisi yok.');
    expect(screen.queryByRole('heading', { name: 'Kod üret' })).not.toBeInTheDocument();
  });

  it('shows a wrong password and stays on the sign-in form', async () => {
    const { client, auth } = fakeClient(OPERATOR);
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    });
    render(<OperatorApp client={client} />);
    const { email, password } = credentials();
    await signIn(email, password);
    expect(await screen.findByRole('alert')).toHaveTextContent('E-posta ya da şifre yanlış.');
  });

  it('creates an account and goes straight in when sign-up gives a session', async () => {
    const { client, calls, auth } = fakeClient(OPERATOR);
    render(<OperatorApp client={client} />);
    await userEvent.click(await screen.findByLabelText('Hesap oluştur'));
    const { email, password } = credentials();
    await userEvent.type(screen.getByLabelText('E-posta'), email);
    await userEvent.type(screen.getByLabelText('Şifre'), password);
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }));

    expect(auth.signUp).toHaveBeenCalledWith({ email, password });
    expect(await screen.findByRole('heading', { name: 'Kod üret' })).toBeInTheDocument();
    expect(calls[0]?.fn).toBe('op_claim');
  });

  it('asks to confirm the email when sign-up gives no session', async () => {
    const { client, calls } = fakeClient(OPERATOR, { signUpSession: null });
    render(<OperatorApp client={client} />);
    await userEvent.click(await screen.findByLabelText('Hesap oluştur'));
    const { email, password } = credentials();
    await userEvent.type(screen.getByLabelText('E-posta'), email);
    await userEvent.type(screen.getByLabelText('Şifre'), password);
    await userEvent.click(screen.getByRole('button', { name: 'Hesap oluştur' }));

    expect(await screen.findByText('E-postanı onayla, sonra giriş yap.')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('opens straight to the panel with a kept session', async () => {
    const { client } = fakeClient(OPERATOR, { session: { user: {} } });
    render(<OperatorApp client={client} />);
    expect(await screen.findByRole('heading', { name: 'Kod üret' })).toBeInTheDocument();
  });

  it('issues a code with a note and days, and shows it big with a copy button', async () => {
    const { client, calls } = fakeClient(
      { ...OPERATOR, op_issue_code: { data: '7KQ4-M2XD' } },
      { session: { user: {} } },
    );
    render(<OperatorApp client={client} />);
    await userEvent.type(await screen.findByLabelText('Not'), 'Kurşunlu Market');
    await userEvent.clear(screen.getByLabelText('Gün'));
    await userEvent.type(screen.getByLabelText('Gün'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Kod üret' }));

    expect(await screen.findByLabelText('Üretilen kod')).toHaveTextContent('7KQ4-M2XD');
    expect(calls.find((call) => call.fn === 'op_issue_code')?.args).toEqual({
      note: 'Kurşunlu Market',
      days: 7,
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Kopyala' }));
    expect(writeText).toHaveBeenCalledWith('7KQ4-M2XD');
  });

  it('asks before it suspends a market', async () => {
    const { client, calls } = fakeClient(
      { ...OPERATOR, op_set_market_status: { data: null } },
      { session: { user: {} } },
    );
    render(<OperatorApp client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Askıya al' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Market askıya alınsın mı?');
    expect(calls.some((call) => call.fn === 'op_set_market_status')).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Askıya al' }));
    await waitFor(() =>
      expect(calls.find((call) => call.fn === 'op_set_market_status')?.args).toEqual({
        market_id: 'kursunlu-ab12cd',
        status: 'suspended',
      }),
    );
  });

  it('signs out of its own session only', async () => {
    const { client, auth } = fakeClient(OPERATOR, { session: { user: {} } });
    render(<OperatorApp client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Çıkış' }));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await screen.findByLabelText('E-posta')).toBeInTheDocument();
  });

  it('says so when the build has no server', () => {
    render(<OperatorApp client={null} />);
    expect(screen.getByText('Bu sürümde sunucu ayarlı değil.')).toBeInTheDocument();
  });
});

describe('the operator route', () => {
  it('opens only on #/operator', () => {
    expect(isOperatorHash('#/operator')).toBe(true);
    expect(isOperatorHash('#/pos')).toBe(false);
    expect(isOperatorHash('#/operatorx')).toBe(false);
    expect(isOperatorHash('')).toBe(false);
  });
});
