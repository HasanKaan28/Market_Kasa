import type { JSX } from 'react';
import { useLicense } from './license';

/** A line under the shell's header while the licence nears its end, is in grace, or has run out. */
export function LicenseBanner(): JSX.Element | null {
  const license = useLicense();
  const text =
    license.kind === 'warning'
      ? license.daysLeft === 0
        ? 'Lisans bugün bitiyor.'
        : `Lisans ${license.daysLeft} gün sonra bitiyor.`
      : license.kind === 'grace'
        ? license.graceDaysLeft === 0
          ? 'Lisans süresi doldu. Satış için bugün son gün.'
          : `Lisans süresi doldu. Satış ${license.graceDaysLeft} gün daha açık; sonra kapanır.`
        : license.kind === 'readOnly'
          ? 'Lisans süresi doldu. Satış kapalı; veriler okunabilir ve dışa aktarılabilir.'
          : null;
  if (text === null) {
    return null;
  }
  const tone =
    license.kind === 'readOnly' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning';
  return (
    <p role="status" className={`px-5 py-2 text-sm font-medium ${tone}`}>
      {text}
    </p>
  );
}
