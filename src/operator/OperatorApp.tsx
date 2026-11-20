import { History, KeyRound, LayoutDashboard, LogOut, Store } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Button,
  ChoiceGroup,
  Logo,
  TextField,
  ToastRegion,
  useBottomBar,
  useToast,
} from '@/design';
import { messageOf, operatorApi, type OperatorApi, type OperatorClient } from './api';
import { CodesTab } from './CodesTab';
import { HistoryTab } from './HistoryTab';
import { MarketDetail } from './MarketDetail';
import { MarketsTab } from './MarketsTab';
import { OverviewTab } from './OverviewTab';

type Phase = 'loading' | 'signedOut' | 'denied' | 'operator';

/**
 * The developer's operator panel (#/operator): his own sign-in, then an overview, the markets
 * and each one's detail, activation codes and the log of every change made here. It has its own Supabase session and never opens a register's database or session.
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

type Tab = 'overview' | 'markets' | 'codes' | 'history';
const TABS: readonly { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Özet', icon: LayoutDashboard },
  { id: 'markets', label: 'Marketler', icon: Store },
  { id: 'codes', label: 'Kodlar', icon: KeyRound },
  { id: 'history', label: 'Geçmiş', icon: History },
];

/** Under 640 px the tabs sit at the bottom, under the thumb, as the app's own do. */
const PHONE = '(max-width: 639px)';

function Panel({ api, onSignOut }: { api: OperatorApi; onSignOut(): void }): JSX.Element {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  // A market opened from any tab; its detail takes the panel until "Geri".
  const [opened, setOpened] = useState<string | null>(null);
  const bar = useBottomBar<HTMLDivElement>(PHONE);
  const notify = toast.show;

  function choose(next: Tab) {
    setTab(next);
    setOpened(null);
    window.scrollTo?.({ top: 0 });
  }

  function open(marketId: string) {
    setOpened(marketId);
    window.scrollTo?.({ top: 0 });
  }

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    const at = TABS.findIndex((item) => item.id === tab);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(at + step + TABS.length) % TABS.length]?.id ?? tab;
    choose(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-10 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2">
          <Logo />
          <h1 className="font-display text-xl font-semibold tracking-[-0.01em]">Operatör</h1>
          <Button
            variant="ghost"
            className="ml-auto"
            icon={<LogOut aria-hidden="true" size={18} />}
            onClick={onSignOut}
          >
            Çıkış
          </Button>
        </div>
        <div
          ref={bar}
          role="tablist"
          aria-label="Operatör"
          onKeyDown={onTabKey}
          className="mx-auto flex max-w-3xl gap-1 px-4 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:gap-0 max-sm:border-t max-sm:border-line max-sm:bg-surface max-sm:px-0 max-sm:pb-[env(safe-area-inset-bottom)]"
        >
          {TABS.map((item) => {
            const Icon = item.icon;
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(item.id)}
                className={`flex min-h-touch items-center justify-center gap-2 font-semibold transition-colors max-sm:min-w-0 max-sm:flex-1 max-sm:flex-col max-sm:gap-0.5 max-sm:py-2 max-sm:text-meta sm:border-b-2 sm:px-3 ${
                  selected
                    ? 'text-text max-sm:text-accent sm:border-accent'
                    : 'text-text-2 hover:text-text sm:border-transparent'
                }`}
              >
                <Icon aria-hidden="true" size={20} strokeWidth={selected ? 2.25 : 1.75} />
                <span className="max-sm:max-w-full max-sm:truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </header>
      <main
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="mx-auto flex max-w-3xl min-w-0 flex-col gap-6 px-4 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:pb-[calc(6rem+env(safe-area-inset-bottom))]"
      >
        {opened ? (
          <MarketDetail
            key={opened}
            api={api}
            marketId={opened}
            notify={notify}
            onBack={() => setOpened(null)}
          />
        ) : tab === 'overview' ? (
          <OverviewTab api={api} onOpen={open} notify={notify} />
        ) : tab === 'markets' ? (
          <MarketsTab api={api} onOpen={open} />
        ) : tab === 'codes' ? (
          <CodesTab api={api} onOpen={open} notify={notify} />
        ) : (
          <HistoryTab api={api} onOpen={open} />
        )}
      </main>
      <ToastRegion message={toast.message} />
    </div>
  );
}
