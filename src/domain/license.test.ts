import { describe, expect, it } from 'vitest';
import { licenseState } from './license';

// Noon in Istanbul on a day of 2026.
const on = (day: string) => new Date(`${day}T09:00:00Z`);

describe('licenseState', () => {
  it('follows the licence through warning, grace and read-only', () => {
    // The licence runs through 5 November.
    const expires = '2026-11-05';
    expect(licenseState(expires, on('2026-10-28'))).toEqual({ kind: 'active', daysLeft: 8 });
    expect(licenseState(expires, on('2026-10-29'))).toEqual({ kind: 'warning', daysLeft: 7 });
    expect(licenseState(expires, on('2026-11-05'))).toEqual({ kind: 'warning', daysLeft: 0 });
    expect(licenseState(expires, on('2026-11-06'))).toEqual({ kind: 'grace', graceDaysLeft: 2 });
    expect(licenseState(expires, on('2026-11-08'))).toEqual({ kind: 'grace', graceDaysLeft: 0 });
    expect(licenseState(expires, on('2026-11-09'))).toEqual({ kind: 'readOnly' });
  });

  it('knows nothing without licence information', () => {
    expect(licenseState(null, on('2026-10-29'))).toEqual({ kind: 'unknown' });
    expect(licenseState('not a date', on('2026-10-29'))).toEqual({ kind: 'unknown' });
  });
});
