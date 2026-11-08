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
