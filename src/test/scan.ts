import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

/**
 * Sends a code the way a keyboard-wedge scanner does: Shift held around each capital letter,
 * every key in one quick burst, then Enter. The characters land in whatever field has focus,
 * as they do in a browser, so a test can check that the scanner takes them back out.
 *
 * The register times keys by their events, which jsdom stamps from `Date.now()`. A scanner sends
 * its burst within milliseconds; a test run with every worker busy can space the same keys 50 ms
 * apart and turn the scan into typing. The clock stands still for the burst, as a scanner's does.
 */
export async function scan(code: string): Promise<void> {
  const keys = Array.from(code, (char) => (/[A-Z]/.test(char) ? `{Shift>}${char}{/Shift}` : char));
  const alreadyFake = vi.isFakeTimers();
  if (!alreadyFake) {
    vi.useFakeTimers({ toFake: ['Date'] });
  }
  try {
    await userEvent.setup({ delay: null }).keyboard(`${keys.join('')}{Enter}`);
  } finally {
    if (!alreadyFake) {
      vi.useRealTimers();
    }
  }
}
