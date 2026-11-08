import { useState, type FormEvent, type JSX } from 'react';
import { Button, SelectField, TextField } from '@/design';
import type { OnboardingResult } from '@/server/onboarding';
import { pairedSettings, type OwnedMarket } from '@/server/pairing';
import type { DeviceSettings } from './device';

type Credentials = { email: string; password: string };

export type WelcomeScreenProps = {
  current: DeviceSettings;
  open(input: Credentials & { marketName: string }): Promise<OnboardingResult>;
  join(input: Credentials & { marketId?: string }): Promise<OnboardingResult>;
  onDone(settings: DeviceSettings): void;
  onSkip(): void;
};

const failed = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

/**
 * The app's first screen: open the shop's market with its own email, or sign another device into
 * it. Either way this device becomes one of the market's registers; the password is not kept.
 */
export function WelcomeScreen({
  current,
  open,
  join,
  onDone,
  onSkip,
}: WelcomeScreenProps): JSX.Element {
  const [mode, setMode] = useState<'choose' | 'open' | 'join'>('choose');
  const [marketName, setMarketName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [markets, setMarkets] = useState<OwnedMarket[]>();
  const [marketId, setMarketId] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  function settle(result: OnboardingResult) {
    if ('claimed' in result) {
      const name = `Kasa ${result.claimed.deviceCode}`;
      onDone(pairedSettings(current, result.claimed, name, false));
    } else if ('markets' in result) {
      setMarkets(result.markets);
      setMarketId(result.markets[0]?.id ?? '');
    } else {
      setNotice('E-postanıza gelen bağlantıya tıklayın, sonra “Markete giriş yap” ile girin.');
    }
  }

  async function run(task: () => Promise<OnboardingResult>) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      settle(await task());
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  function submitOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalı.');
      return;
    }
    if (password !== repeat) {
      setError('Şifreler aynı değil.');
      return;
    }
    void run(() => open({ marketName: marketName.trim(), email: email.trim(), password }));
  }

  function submitJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(() =>
      join({ email: email.trim(), password, ...(markets && marketId ? { marketId } : {}) }),
    );
  }

  function choose(next: 'open' | 'join') {
    setMode(next);
    setError(undefined);
    setNotice(undefined);
    setMarkets(undefined);
  }

  const messages = (
    <>
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="font-medium">
          {notice}
        </p>
      ) : null}
    </>
  );

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-control border border-line bg-surface p-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-control bg-text text-lg font-bold text-white"
          >
            K
          </span>
          <div>
            <h1 className="text-xl font-semibold">Market Kasa</h1>
            <p className="text-sm text-text-2">
              {mode === 'open'
                ? 'Yeni market'
                : mode === 'join'
                  ? 'Bu cihazı marketinize ekleyin'
                  : 'Hoş geldiniz'}
            </p>
          </div>
        </div>

        {mode === 'choose' ? (
          <div className="flex flex-col gap-3">
            <Button variant="primary" onClick={() => choose('open')}>
              Market kur
            </Button>
            <Button onClick={() => choose('join')}>Markete giriş yap</Button>
            <p className="text-sm text-text-2">
              Marketi ilk kez kuruyorsanız “Market kur”. Başka bir cihazda kurduysanız aynı e-posta
              ve şifreyle “Markete giriş yap”: bu cihaz o marketin yeni kasası olur.
            </p>
            <Button variant="ghost" onClick={onSkip}>
              İnternetsiz dene
            </Button>
          </div>
        ) : null}

        {mode === 'open' ? (
          <form className="flex flex-col gap-3" onSubmit={submitOpen}>
            <TextField
              label="Market adı"
              value={marketName}
              maxLength={60}
              required
              onChange={(event) => setMarketName(event.target.value)}
            />
            <TextField
              label="E-posta"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Şifre"
              type="password"
              autoComplete="new-password"
              hint="En az 8 karakter. Bu şifreyle başka cihazları da bağlarsınız."
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label="Şifre (tekrar)"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
            {messages}
            <Button type="submit" variant="primary" disabled={busy}>
              Marketi kur
            </Button>
            <Button variant="ghost" onClick={() => setMode('choose')}>
              Geri
            </Button>
          </form>
        ) : null}

        {mode === 'join' ? (
          <form className="flex flex-col gap-3" onSubmit={submitJoin}>
            <TextField
              label="E-posta"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Şifre"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {markets ? (
              <SelectField
                label="Market"
                value={marketId}
                onChange={(event) => setMarketId(event.target.value)}
                options={markets.map((market) => ({ value: market.id, label: market.name }))}
              />
            ) : null}
            {messages}
            <Button type="submit" variant="primary" disabled={busy || !password}>
              Giriş yap
            </Button>
            <Button variant="ghost" onClick={() => setMode('choose')}>
              Geri
            </Button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
