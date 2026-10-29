import { useState, type FormEvent, type JSX, type ReactNode } from 'react';
import { useActor } from '@/app/actor';
import { useData } from '@/app/appData';
import { saveDeviceSettings } from '@/app/device';
import { useMarketSettings } from '@/app/marketSettings';
import { saveMarketSettings } from '@/data/settings';
import { Button, SelectField, TextField } from '@/design';
import { ReceiptSettingsDialog } from '@/pos/ReceiptSettingsDialog';
import { loadReceiptSettings, saveReceiptSettings } from '@/pos/receiptSettings';

// The day may turn on the hour from midnight to noon (DESIGN §9).
const CUTOFF_OPTIONS = Array.from({ length: 13 }, (_, hour) => ({
  value: String(hour * 60),
  label: `${String(hour).padStart(2, '0')}:00`,
}));

/** A titled block of the settings screen, named for assistive technology by its heading. */
export function SettingsSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}): JSX.Element {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-control border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-text-2">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The settings every register of the market shares: when the business day turns. */
export function MarketSection({ onDone }: { onDone(message: string): void }): JSX.Element {
  const { db } = useData();
  const actor = useActor();
  const { cutoffMinutes } = useMarketSettings();
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = chosen ?? String(cutoffMinutes);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveMarketSettings(db, { cutoffMinutes: Number(value) }, new Date(), actor);
      setChosen(null);
      onDone('Market ayarı kaydedildi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      id="market-heading"
      title="Market"
      description="Bütün kasalarda aynıdır. Gün dönümünden önceki satışlar bir önceki güne yazılır; yazılmış kayıtlar değişmez."
    >
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void save(event)}>
        <div className="w-40">
          <SelectField
            label="Gün dönümü"
            options={CUTOFF_OPTIONS}
            value={value}
            onChange={(event) => setChosen(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={saving || value === String(cutoffMinutes)}>
          Market ayarını kaydet
        </Button>
      </form>
    </SettingsSection>
  );
}

/** This device's own names and register code; the app reads them when it starts. */
export function RegisterSection(): JSX.Element {
  const { settings } = useData();
  const [marketName, setMarketName] = useState(settings.marketName);
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  const [deviceCode, setDeviceCode] = useState(settings.deviceCode);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = saveDeviceSettings({ ...settings, marketName, deviceName, deviceCode });
    setMessage(
      saved
        ? { text: 'Kaydedildi. Uygulama yeniden açıldığında geçerli olur.', error: false }
        : {
            text: 'Kaydedilemedi: adlar 1–60 karakter, kasa kodu bir harf ve en çok üç harf ya da rakam olmalı (K1, K2).',
            error: true,
          },
    );
  }

  return (
    <SettingsSection
      id="register-heading"
      title="Bu kasa"
      description="Fişte ve raporlarda görünen adlar ile fiş numarasının başındaki kasa kodu."
    >
      <form className="flex flex-col gap-3" onSubmit={save}>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Market adı"
            value={marketName}
            onChange={(event) => setMarketName(event.target.value)}
          />
          <TextField
            label="Kasa adı"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
          />
          <TextField
            label="Kasa kodu"
            autoComplete="off"
            maxLength={4}
            value={deviceCode}
            onChange={(event) => setDeviceCode(event.target.value.toUpperCase())}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">Kasayı kaydet</Button>
          {message ? (
            <p role="status" className={message.error ? 'text-danger' : 'text-text-2'}>
              {message.text}
            </p>
          ) : null}
          {message && !message.error ? (
            <Button variant="ghost" onClick={() => window.location.reload()}>
              Şimdi yeniden aç
            </Button>
          ) : null}
        </div>
      </form>
    </SettingsSection>
  );
}

/** The receipt's printing and wording, the same dialog the register opens. */
export function ReceiptSection({ onDone }: { onDone(message: string): void }): JSX.Element {
  const { settings } = useData();
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection
      id="receipt-heading"
      title="Fiş"
      description="Fiş yazdırma, kâğıt genişliği, üst ve alt yazılar."
      action={<Button onClick={() => setOpen(true)}>Fiş ayarları</Button>}
    >
      {open ? (
        <ReceiptSettingsDialog
          open
          settings={loadReceiptSettings()}
          marketName={settings.marketName}
          onClose={() => setOpen(false)}
          onSave={(next) => {
            saveReceiptSettings(next);
            setOpen(false);
            onDone('Fiş ayarları kaydedildi.');
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
