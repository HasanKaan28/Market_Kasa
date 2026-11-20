import { Copy, LogOut, RefreshCw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type JSX,
  type ReactNode,
} from 'react';
import { Button, ChoiceGroup, Dialog, Logo, TextField, ToastRegion, useToast } from '@/design';
import { formatDateTime } from '@/pos/format';
import {
  messageOf,
  operatorApi,
  type ActivationCode,
  type CodeStatus,
  type OperatorApi,
  type OperatorClient,
  type OperatorMarket,
} from './api';

type Phase = 'loading' | 'signedOut' | 'denied' | 'operator';

/**
 * The developer's operator panel (#/operator): his own sign-in, then activation codes and
 * markets. It has its own Supabase session and never opens a register's database or session.
 */
export function OperatorApp({ client }: { client: OperatorClient | null }): JSX.Element {
  const api = useMemo(() => (client ? operatorApi(client) : null), [client]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string>();

  /** After every sign-in: the one-time claim first, then whether this account is an operator. */
  const enter = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      await api.claim();
    } catch {
      // A claim that fails changes nothing; the check below decides.
    }
    try {
      await api.whoami();
      setPhase('operator');
    } catch (failure) {
      if (failure instanceof Error && failure.message.includes('not_operator')) {
        setPhase('denied');
      } else {
        setError(messageOf(failure));
        setPhase('signedOut');
      }
    }
  }, [api]);

  useEffect(() => {
    if (!client) {
      return;
    }
    let live = true;
    void client.auth.getSession().then(({ data }) => {
      if (!live) {
        return;
      }
      if (data.session) {
        void enter();
      } else {
        setPhase('signedOut');
      }
    });
    return () => {
      live = false;
    };
  }, [client, enter]);

  async function signOut() {
    await client?.auth.signOut({ scope: 'local' });
    setError(undefined);
    setPhase('signedOut');
  }

  if (!client || !api) {
    return (
      <Frame>
        <p className="text-text-2">Bu sürümde sunucu ayarlı değil.</p>
      </Frame>
    );
  }
  if (phase === 'loading') {
    return (
      <Frame>
        <p className="text-text-2">Yükleniyor…</p>
      </Frame>
    );
  }
  if (phase === 'signedOut') {
    return <SignIn client={client} initialError={error} onSignedIn={enter} />;
  }
  if (phase === 'denied') {
    return (
      <Frame>
        <p role="alert" className="font-semibold text-danger">
          Bu hesabın yetkisi yok.
        </p>
        <Button onClick={() => void signOut()}>Çıkış yap</Button>
      </Frame>
    );
  }
  return <Panel api={api} onSignOut={() => void signOut()} />;
}

function Frame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <section className="flex w-full max-w-[420px] flex-col gap-5 rounded-plate border border-line bg-surface p-6">
        <header className="flex items-center gap-3">
          <Logo />
          <h1 className="font-display text-xl font-semibold tracking-[-0.01em]">Operatör</h1>
        </header>
        {children}
      </section>
    </main>
  );
}

type Mode = 'signIn' | 'signUp';

function SignIn({
  client,
  initialError,
  onSignedIn,
}: {
  client: OperatorClient;
  initialError?: string;
  onSignedIn(): Promise<void>;
}): JSX.Element {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credentials = { email: email.trim(), password };
    if (!credentials.email || !password) {
      setError('E-posta ve şifre gerekli.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const { data, error: failure } =
        mode === 'signIn'
          ? await client.auth.signInWithPassword(credentials)
          : await client.auth.signUp(credentials);
      if (failure) {
        setError(messageOf(failure));
        return;
      }
      if (!data.session) {
        setNotice('E-postanı onayla, sonra giriş yap.');
        setMode('signIn');
        return;
      }
      setPassword('');
      await onSignedIn();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame>
      <ChoiceGroup<Mode>
        legend="Hesap"
        name="operator-mode"
        options={[
          { value: 'signIn', label: 'Giriş yap' },
          { value: 'signUp', label: 'Hesap oluştur' },
        ]}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setError(undefined);
        }}
      />
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <TextField
          label="E-posta"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Şifre"
          type="password"
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm font-medium text-text-2">
            {notice}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {mode === 'signIn' ? 'Giriş yap' : 'Hesap oluştur'}
        </Button>
      </form>
    </Frame>
  );
}

const CODE_STATUS: Record<CodeStatus, { label: string; tone: string }> = {
  unused: { label: 'Kullanılmadı', tone: 'bg-success-bg text-success' },
  used: { label: 'Kullanıldı', tone: 'bg-bg text-text-2' },
  expired: { label: 'Süresi doldu', tone: 'bg-warning-bg text-warning' },
  revoked: { label: 'İptal', tone: 'bg-danger-bg text-danger' },
};

type Confirm = {
  title: string;
  description: string;
  action: string;
  danger: boolean;
  run(): Promise<unknown>;
  done: string;
};

function Panel({ api, onSignOut }: { api: OperatorApi; onSignOut(): void }): JSX.Element {
  const toast = useToast();
  const [codes, setCodes] = useState<ActivationCode[] | null>(null);
  const [markets, setMarkets] = useState<OperatorMarket[] | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const show = toast.show;

  // Each bump reads the codes and markets again.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let live = true;
    Promise.all([api.listCodes(), api.listMarkets()]).then(
      ([nextCodes, nextMarkets]) => {
        if (live) {
          setCodes(nextCodes);
          setMarkets(nextMarkets);
        }
      },
      (failure: unknown) => {
        if (live) {
          show(messageOf(failure));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [api, show, version]);

  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await run();
      show(done);
      refresh();
    } catch (failure) {
      show(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-bg">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <Logo />
          <h1 className="font-display text-xl font-semibold tracking-[-0.01em]">Operatör</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Yenile"
            icon={<RefreshCw aria-hidden="true" size={18} />}
            onClick={refresh}
          />
          <Button
            variant="ghost"
            icon={<LogOut aria-hidden="true" size={18} />}
            onClick={onSignOut}
          >
            Çıkış
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 p-4">
        <IssueCode api={api} onIssued={refresh} onMessage={show} />

        <Section title="Kodlar">
          {codes === null ? (
            <p className="text-text-2">Yükleniyor…</p>
          ) : codes.length === 0 ? (
            <p className="text-text-2">Henüz kod yok.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {codes.map((code) => (
                <li key={code.code} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-label font-medium">{code.code}</span>
                      <span
                        className={`rounded-chip px-2 py-0.5 text-meta font-semibold ${CODE_STATUS[code.status].tone}`}
                      >
                        {CODE_STATUS[code.status].label}
                      </span>
                    </div>
                    <span className="break-words">{code.note}</span>
                    <span className="text-meta text-muted">
                      {code.status === 'used' && code.usedAt
                        ? `Kullanıldı ${formatDateTime(code.usedAt)}${code.marketName ? ` · ${code.marketName}` : ''}`
                        : `Son gün ${formatDateTime(code.expiresAt)} · Üretildi ${formatDateTime(code.createdAt)}`}
                    </span>
                  </div>
                  {code.status === 'unused' || code.status === 'expired' ? (
                    <div className="flex gap-2">
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void act(() => api.extendCode(code.code, 30), 'Kod 30 gün uzatıldı.')
                        }
                      >
                        30 gün uzat
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            title: 'Kod iptal edilsin mi?',
                            description: `${code.code} artık market açamaz.`,
                            action: 'İptal et',
                            danger: true,
                            run: () => api.revokeCode(code.code),
                            done: 'Kod iptal edildi.',
                          })
                        }
                      >
                        İptal et
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Marketler">
          {markets === null ? (
            <p className="text-text-2">Yükleniyor…</p>
          ) : markets.length === 0 ? (
            <p className="text-text-2">Henüz market yok.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {markets.map((market) => {
                const active = market.status === 'active';
                return (
                  <li key={market.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold break-words">{market.name}</span>
                        <span
                          className={`rounded-chip px-2 py-0.5 text-meta font-semibold ${
                            active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
                          }`}
                        >
                          {active ? 'Etkin' : 'Askıda'}
                        </span>
                      </div>
                      <span className="text-meta break-all text-muted">
                        {market.ownerEmail ?? 'Sahip yok'}
                      </span>
                      <span className="text-meta text-muted">
                        {[
                          `${market.devices} kasa`,
                          market.lastSyncAt
                            ? `Son eşitleme ${formatDateTime(market.lastSyncAt)}`
                            : 'Hiç eşitlenmedi',
                          `Açıldı ${formatDateTime(market.createdAt)}`,
                        ].join(' · ')}
                      </span>
                    </div>
                    <Button
                      variant={active ? 'danger' : 'primary'}
                      disabled={busy}
                      onClick={() =>
                        setConfirm(
                          active
                            ? {
                                title: 'Market askıya alınsın mı?',
                                description: `${market.name}: kasalar eşitlenmez, çevrimdışı satış sürer.`,
                                action: 'Askıya al',
                                danger: true,
                                run: () => api.setMarketStatus(market.id, 'suspended'),
                                done: 'Market askıya alındı.',
                              }
                            : {
                                title: 'Market etkinleştirilsin mi?',
                                description: `${market.name}: kasalar yeniden eşitlenir.`,
                                action: 'Etkinleştir',
                                danger: false,
                                run: () => api.setMarketStatus(market.id, 'active'),
                                done: 'Market etkinleştirildi.',
                              },
                        )
                      }
                    >
                      {active ? 'Askıya al' : 'Etkinleştir'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        title={confirm?.title ?? ''}
        description={confirm?.description}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(null)}>Vazgeç</Button>
          <Button
            variant={confirm?.danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => {
              const chosen = confirm;
              setConfirm(null);
              if (chosen) {
                void act(chosen.run, chosen.done);
              }
            }}
          >
            {confirm?.action}
          </Button>
        </div>
      </Dialog>
      <ToastRegion message={toast.message} />
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-3 rounded-plate border border-line bg-surface p-4 sm:p-5">
      <h2 className="font-display text-label font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function IssueCode({
  api,
  onIssued,
  onMessage,
}: {
  api: OperatorApi;
  onIssued(): void;
  onMessage(message: string): void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [days, setDays] = useState('30');
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dayCount = Number(days);
    if (!note.trim()) {
      setError('Not yazın: kodun kime verildiği.');
      return;
    }
    if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 365) {
      setError('Gün 1–365 arası olmalı.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      setIssued(await api.issueCode(note.trim(), dayCount));
      setNote('');
      onIssued();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      onMessage('Kopyalandı.');
    } catch {
      onMessage('Kopyalanamadı. Kodu elle seçin.');
    }
  }

  return (
    <Section title="Kod üret">
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <TextField
            label="Not"
            hint="Kime verildiği, ör. market adı ve telefon"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <TextField
            label="Gün"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          Kod üret
        </Button>
      </form>
      {issued ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-bg p-4">
          <output
            aria-label="Üretilen kod"
            className="font-mono text-[2.25rem] leading-none font-medium tracking-[0.08em] select-all"
          >
            {issued}
          </output>
          <Button icon={<Copy aria-hidden="true" size={18} />} onClick={() => void copy(issued)}>
            Kopyala
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
