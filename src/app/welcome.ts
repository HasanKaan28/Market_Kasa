import type { ServerConfig } from '@/server/config';
import type { DeviceSettings } from './device';

/** Set once the shop chooses to try the app without a server; the screen then stays away. */
export const WELCOME_SKIPPED = 'mk2.welcomeSkipped';

/** The first screen shows on a build with a server, on a device not yet bound to a market. */
export function shouldWelcome(
  settings: DeviceSettings,
  server: ServerConfig | null,
  storage: Pick<Storage, 'getItem'>,
): boolean {
  if (!server || settings.paired) {
    return false;
  }
  try {
    return storage.getItem(WELCOME_SKIPPED) !== '1';
  } catch {
    return true;
  }
}

/** Brings the first screen back on the next start, after the shop chose to try offline. */
export function reopenWelcome(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(WELCOME_SKIPPED);
  } catch {
    // Without storage the flag was never kept, so the screen shows anyway.
  }
}
