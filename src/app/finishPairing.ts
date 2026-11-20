import { clearStoredCarts } from '@/pos/held';
import { saveDeviceSettings, type DeviceSettings } from './device';

/**
 * Keeps the settings of a device just bound to its market. The carts stored before belong to
 * the database the device used until now: their products do not exist in the new market, so they
 * go. False when the settings could not be saved; then nothing changes.
 */
export function finishPairing(
  next: DeviceSettings,
  { save = saveDeviceSettings, clearCarts = clearStoredCarts } = {},
): boolean {
  if (!save(next)) {
    return false;
  }
  clearCarts();
  return true;
}
