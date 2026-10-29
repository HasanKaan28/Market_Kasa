import type { JSX } from 'react';
import { TextField } from '@/design';
import type { DiscountMode } from './discountInput';

const MODES: readonly { mode: DiscountMode; label: string }[] = [
  { mode: 'amount', label: 'Tutar (₺)' },
  { mode: 'percent', label: 'Yüzde (%)' },
];

/** The discount input shared by the line and cart dialogs: an amount or a percentage. */
export function DiscountField({
  mode,
  value,
  error,
  onModeChange,
  onChange,
}: {
  mode: DiscountMode;
  value: string;
  error?: string;
  onModeChange(mode: DiscountMode): void;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex gap-2">
        <legend className="sr-only">İndirim türü</legend>
        {MODES.map((option) => (
          <label
            key={option.mode}
            className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-control border border-line-strong font-medium has-checked:border-accent has-checked:bg-accent has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
          >
            <input
              type="radio"
              name="discountMode"
              checked={mode === option.mode}
              onChange={() => onModeChange(option.mode)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <TextField
        label="İndirim"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        error={error}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
