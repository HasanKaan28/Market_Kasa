import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE, loadDeviceSettings } from './device';

const stored = (value: string | null) => ({ getItem: () => value });

describe('loadDeviceSettings', () => {
  it('falls back to the default device', () =>
    expect(loadDeviceSettings(stored(null))).toEqual(DEFAULT_DEVICE));

  it('uses stored settings when they are valid', () => {
    const settings = {
      marketId: 'kursunlu',
      marketName: 'Kurşunlu Market',
      deviceCode: 'K2',
      deviceName: 'Kasa 2',
    };
    expect(loadDeviceSettings(stored(JSON.stringify(settings)))).toEqual(settings);
  });

  it('ignores invalid or unreadable settings', () => {
    const badId = { ...DEFAULT_DEVICE, marketId: 'Kurşunlu' };
    expect(loadDeviceSettings(stored(JSON.stringify(badId)))).toEqual(DEFAULT_DEVICE);
    expect(loadDeviceSettings(stored('not json'))).toEqual(DEFAULT_DEVICE);
    expect(
      loadDeviceSettings({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_DEVICE);
  });
});
