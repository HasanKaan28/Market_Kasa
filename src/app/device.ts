import { MARKET_ID } from '@/data/db';

/** Which market this device belongs to and which register it is. */
export type DeviceSettings = {
  marketId: string;
  marketName: string;
  deviceCode: string;
  deviceName: string;
};

export const DEFAULT_DEVICE: DeviceSettings = {
  marketId: 'yerel',
  marketName: 'Market Kasa',
  deviceCode: 'K1',
  deviceName: 'Kasa 1',
};

const STORAGE_KEY = 'mk2.device';
const DEVICE_CODE = /^[A-Z][A-Z0-9]{0,3}$/;
const MAX_NAME_LENGTH = 60;

/** The stored settings, or the default when they are missing, invalid or unreadable. */
export function loadDeviceSettings(storage?: Pick<Storage, 'getItem'>): DeviceSettings {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return isDeviceSettings(parsed)
      ? {
          marketId: parsed.marketId,
          marketName: parsed.marketName,
          deviceCode: parsed.deviceCode,
          deviceName: parsed.deviceName,
        }
      : DEFAULT_DEVICE;
  } catch {
    return DEFAULT_DEVICE;
  }
}

function isDeviceSettings(value: unknown): value is DeviceSettings {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { marketId, marketName, deviceCode, deviceName } = value as Record<string, unknown>;
  return (
    typeof marketId === 'string' &&
    MARKET_ID.test(marketId) &&
    typeof deviceCode === 'string' &&
    DEVICE_CODE.test(deviceCode) &&
    isName(marketName) &&
    isName(deviceName)
  );
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_NAME_LENGTH;
}
