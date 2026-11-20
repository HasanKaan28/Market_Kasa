import { useState, type FormEvent, type JSX } from 'react';
import { useActor } from '@/app/actor';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { saveMarketSettings } from '@/data/settings';
import { Button, SelectField, TextField } from '@/design';
import { isValidScaleConfig, type ScaleConfig } from '@/domain/scaleBarcode';
import { SettingsSection } from './MarketSections';

const CODE_OPTIONS = [
  { value: '4', label: '4 hane' },
  { value: '5', label: '5 hane' },
  { value: '6', label: '6 hane' },
] as const;

const VALUE_OPTIONS = [
  { value: 'weight', label: 'Ağırlık (gram)' },
  { value: 'price', label: 'Tutar (kuruş)' },
] as const;

type Draft = { enabled: boolean; prefixes: string; codeDigits: string; value: string };

const draftOf = (scale: ScaleConfig): Draft => ({
  enabled: scale.enabled,
  prefixes: scale.prefixes.join(', '),
  codeDigits: String(scale.codeDigits),
  value: scale.value,
});

/**
 * How the shop's scale prints its labels, the same on every register: which two-digit starts
 * mark a scale label, how long the scale's item code is, and whether the label carries the
 * weight or the price.
 */
export function ScaleSection({ onDone }: { onDone(message: string): void }): JSX.Element {
  const { db } = useData();
  const actor = useActor();
  const { scale } = useMarketSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const shown = draft ?? draftOf(scale);
  const change = (patch: Partial<Draft>) => setDraft({ ...shown, ...patch });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: ScaleConfig = {
      enabled: shown.enabled,
      prefixes: [...new Set(shown.prefixes.split(/[\s,;]+/).filter(Boolean))],
      codeDigits: Number(shown.codeDigits),
      value: shown.value === 'price' ? 'price' : 'weight',
    };
    if (!isValidScaleConfig(next)) {
      setError('Ön ekler 20 ile 29 arasında iki haneli olmalı (ör. 27, 28).');
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      await saveMarketSettings(db, { scale: next }, new Date(), actor);
      setDraft(null);
      onDone('Terazi ayarı kaydedildi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      id="scale-heading"
      title="Terazi"
      description="Terazinin bastığı barkod: hangi rakamlarla başladığı, ürün kodunun kaç hane olduğu, içinde ağırlık mı tutar mı olduğu. Ürünün barkoduna terazideki ürün kodunu yazın (ör. 123)."
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={shown.enabled}
            onChange={(event) => change({ enabled: event.target.checked })}
            className="size-5 accent-accent"
          />
          Terazi barkodunu oku
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <TextField
              label="Ön ekler"
              value={shown.prefixes}
              onChange={(event) => change({ prefixes: event.target.value })}
            />
          </div>
          <div className="w-32">
            <SelectField
              label="Ürün kodu"
              options={CODE_OPTIONS}
              value={shown.codeDigits}
              onChange={(event) => change({ codeDigits: event.target.value })}
            />
          </div>
          <div className="w-44">
            <SelectField
              label="Barkoddaki değer"
              options={VALUE_OPTIONS}
              value={shown.value}
              onChange={(event) => change({ value: event.target.value })}
            />
          </div>
          <Button type="submit" disabled={saving || draft === null}>
            Terazi ayarını kaydet
          </Button>
        </div>
        {error ? (
          <p role="alert" className="font-medium text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </SettingsSection>
  );
}
