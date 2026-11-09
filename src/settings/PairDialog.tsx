import { useState, type FormEvent, type JSX } from 'react';
import type { DeviceSettings } from '@/app/device';
import { Button, ChoiceGroup, Dialog, SelectField, TextField } from '@/design';
import type { ServerConfig } from '@/server/config';
import {
  pairedSettings,
  type ClaimedDevice,
  type OwnedMarket,
  type PairingCodeResult,
} from '@/server/pairing';

export type PairDialogProps = {
  current: DeviceSettings;
  /** Operations done on this register that have not reached any server. */
  pendingCount: number;
  createCode(input: {
    email: string;
    password: string;
    marketId?: string;
  }): Promise<PairingCodeResult>;
  claim(input: {
    code: string;
    deviceCode: string;
    deviceName: string;
    replace?: boolean;
  }): Promise<ClaimedDevice>;
  /** Saves the paired settings; false when this device could not keep them. */
  onPaired(settings: DeviceSettings): boolean | void;
  onClose(): void;
};

const failed = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

/**
 * Binds this register to its market. The owner makes a ten-minute code by signing in, here or on
 * another computer; the register claims it. The owner's password is never kept.
 */
export function PairDialog({
  current,
  pendingCount,
  createCode,
  claim,
  onPaired,
  onClose,
}: PairDialogProps): JSX.Element {
  const [code, setCode] = useState('');
  const [deviceCode, setDeviceCode] = useState(current.deviceCode);
  const [deviceName, setDeviceName] = useState(current.deviceName);
  // Nothing done here reaches the market unless chosen: it may be trial data.
  const [keepData, setKeepData] = useState<'empty' | 'send'>('empty');
  const [owner, setOwner] = useState<{
    email: string;
    password: string;
    markets?: OwnedMarket[];
    marketId: string;
  }>();
  const [made, setMade] = useState<string>();
  const [error, setError] = useState<string>();
  // Another register holds the code: set once the server says so, ticked to take it over.
  const [takeover, setTakeover] = useState<boolean>();
  const [busy, setBusy] = useState(false);

  async function makeCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!owner || busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await createCode({
        email: owner.email,
        password: owner.password,
        ...(owner.marketId ? { marketId: owner.marketId } : {}),
      });
      if ('markets' in result) {
        setOwner({ ...owner, markets: result.markets, marketId: result.markets[0]?.id ?? '' });
        return;
      }
      setCode(result.code);
      setMade(`Kod: ${result.code} · ${result.market.name} · 10 dakika geçerli`);
      setOwner(undefined);
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const claimed = await claim({
        code,
        deviceCode: deviceCode.trim().toUpperCase(),
        deviceName,
        ...(takeover ? { replace: true } : {}),
      });
      if (onPaired(pairedSettings(current, claimed, deviceName, keepData === 'send')) === false) {
        setError(
          'Bağlandı ama bu cihazda kaydedilemedi. Tarayıcının depolama iznini kontrol edin.',
        );
      }
    } catch (reason) {
      if ((reason as { taken?: boolean }).taken && takeover === undefined) {
        setTakeover(false);
      }
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Sunucuya bağla"
      description="Bağlanan kasalar aynı marketin satışını, stoğunu ve veresiyesini görür."
    >
      {owner ? (
        <form
          className="flex flex-col gap-3 rounded-control border border-line p-3"
          onSubmit={(event) => void makeCode(event)}
        >
          <p className="text-sm text-text-2">
            Sahip hesabıyla bir kez giriş yapılır; şifre bu kasada saklanmaz.
          </p>
          <TextField
            label="E-posta"
            type="email"
            autoComplete="off"
            value={owner.email}
            onChange={(event) => setOwner({ ...owner, email: event.target.value })}
          />
          <TextField
            label="Şifre"
            type="password"
            autoComplete="off"
            value={owner.password}
            onChange={(event) => setOwner({ ...owner, password: event.target.value })}
          />
          {owner.markets ? (
            <SelectField
              label="Market"
              value={owner.marketId}
              onChange={(event) => setOwner({ ...owner, marketId: event.target.value })}
              options={owner.markets.map((market) => ({ value: market.id, label: market.name }))}
            />
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !owner.email || !owner.password}>
              Kodu üret
            </Button>
            <Button variant="ghost" onClick={() => setOwner(undefined)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : null}

      <form className="flex flex-col gap-3" onSubmit={(event) => void pair(event)}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow">
            <TextField
              label="Bağlantı kodu"
              autoComplete="off"
              maxLength={8}
              hint="Sahibin ürettiği 8 karakterlik kod."
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {owner ? null : (
            <Button
              variant="ghost"
              onClick={() => setOwner({ email: '', password: '', marketId: '' })}
            >
              Kod üret
            </Button>
          )}
        </div>
        {made ? <p className="font-medium">{made}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Kasa kodu"
            autoComplete="off"
            maxLength={4}
            value={deviceCode}
            onChange={(event) => setDeviceCode(event.target.value.toUpperCase())}
          />
          <TextField
            label="Kasa adı"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
          />
        </div>
        {pendingCount > 0 ? (
          <ChoiceGroup<'empty' | 'send'>
            legend="Bu kasada yapılmış işlemler"
            name="keep-data"
            value={keepData}
            onChange={setKeepData}
            options={[
              { value: 'empty', label: 'Boş başla' },
              { value: 'send', label: `Bu kasadaki ${pendingCount} işlemi markete gönder` },
            ]}
          />
        ) : null}
        {takeover !== undefined ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={takeover}
              onChange={(event) => setTakeover(event.target.checked)}
              className="size-5"
            />
            {`${deviceCode.trim().toUpperCase()} kasasının yerine geç (eski kasa iptal edilir)`}
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="font-medium text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || code.trim().length !== 8}>
          Bağla
        </Button>
      </form>
    </Dialog>
  );
}

/** The register section's pairing control: hidden in a build without a server. */
export function PairingAction({
  config,
  paired,
  lost = false,
  onOpen,
  onRepair,
  onWelcome,
}: {
  config: ServerConfig | null;
  paired: boolean;
  /** The server no longer knows this register, or revoked it. */
  lost?: boolean;
  onOpen(): void;
  onRepair?(): void;
  /** Back to the first screen ("Market kur" / "Markete giriş yap"), for a device tried offline. */
  onWelcome?(): void;
}): JSX.Element | null {
  if (!config) {
    return null;
  }
  if (paired && lost) {
    return <Button onClick={onRepair}>Yeniden bağla</Button>;
  }
  if (paired) {
    return <p className="text-sm font-medium text-success">Sunucuya bağlı</p>;
  }
  if (!onWelcome) {
    return <Button onClick={onOpen}>Sunucuya bağla</Button>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={onWelcome}>
        Market kur ya da giriş yap
      </Button>
      <Button onClick={onOpen}>Kodla bağla</Button>
    </div>
  );
}
