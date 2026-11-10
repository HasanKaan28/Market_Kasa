import type { DeviceSettings } from '@/app/device';
import type { ServerClient } from './client';

export type OwnedMarket = { id: string; name: string };

/** A code for one market, or the owner's markets when they must pick one first. */
export type PairingCodeResult = { code: string; market: OwnedMarket } | { markets: OwnedMarket[] };

export type ClaimedDevice = {
  marketId: string;
  marketName: string;
  deviceId: string;
  deviceCode: string;
};

export type Platform = 'windows' | 'android' | 'web';

/** What the server's refusals mean to the person at the register. */
const MESSAGES: Record<string, string> = {
  not_owner: 'Bu hesap bu marketin sahibi değil.',
  pairing_invalid: 'Kod geçersiz ya da süresi doldu. Yeni kod üretin.',
  already_registered: 'Bu kasa zaten bir markete bağlı.',
  bad_device_code: 'Kasa kodu bir harf ve en çok üç harf ya da rakam olmalı (K1, K2).',
  bad_platform: 'Bu cihaz türü desteklenmiyor.',
};
const OFFLINE = 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

/** A refusal because another register holds the code; the person may take it over. */
export type TakenError = Error & { taken: true };

function explain(message: string, deviceCode?: string): string {
  if (message.includes('device_code_taken')) {
    return `${deviceCode ?? 'Bu'} kodu bu markette kullanılıyor.`;
  }
  const known = Object.keys(MESSAGES).find((key) => message.includes(key));
  return known ? (MESSAGES[known] as string) : OFFLINE;
}

/**
 * Signs the owner in, makes a ten-minute pairing code for their market and signs out again.
 * With several markets and none chosen, returns the markets instead.
 */
export async function createPairingCode({
  owner,
  email,
  password,
  marketId,
}: {
  owner: ServerClient;
  email: string;
  password: string;
  marketId?: string;
}): Promise<PairingCodeResult> {
  const signIn = await owner.auth.signInWithPassword({ email: email.trim(), password });
  if (signIn.error) {
    throw new Error(
      /invalid login/i.test(signIn.error.message) ? 'E-posta ya da şifre yanlış.' : OFFLINE,
    );
  }
  try {
    const owned = await owner.rpc('owner_markets');
    if (owned.error) {
      throw new Error(explain(owned.error.message));
    }
    const markets = (owned.data ?? []) as OwnedMarket[];
    if (markets.length === 0) {
      throw new Error('Bu hesabın sahibi olduğu market yok.');
    }
    const market = marketId
      ? markets.find((item) => item.id === marketId)
      : markets.length === 1
        ? markets[0]
        : undefined;
    if (!market) {
      return { markets };
    }
    const made = await owner.rpc('create_pairing', { market_id: market.id });
    if (made.error) {
      throw new Error(explain(made.error.message));
    }
    return { code: String(made.data), market };
  } finally {
    // Only this sign-in ends; the owner's sessions on other devices stay.
    await owner.auth.signOut({ scope: 'local' });
  }
}

/** Signs the register in on its own and binds it to the market the code was made for. */
export async function pairDevice({
  device,
  code,
  deviceCode,
  deviceName,
  platform,
  replace = false,
}: {
  device: ServerClient;
  code: string;
  deviceCode: string;
  deviceName: string;
  platform: Platform;
  /** Take the code over from the register that holds it; that register is revoked. */
  replace?: boolean;
}): Promise<ClaimedDevice> {
  const registerCode = deviceCode.trim().toUpperCase();
  const { data } = await device.auth.getSession();
  if (data.session) {
    // A claim whose answer was lost already bound this session: take that result. A revoked
    // register can never claim again with its old session, so it starts a new one.
    const mine = await currentDevice(device);
    if (mine && !mine.revoked) {
      return withoutRevoked(mine);
    }
    if (mine) {
      await device.auth.signOut({ scope: 'local' });
      await signInAnonymously(device);
    }
  } else {
    await signInAnonymously(device);
  }
  const claimed = await device.rpc('claim_device', {
    code: code.trim().toUpperCase(),
    device_code: registerCode,
    device_name: deviceName.trim(),
    platform,
    replace,
  });
  if (claimed.error) {
    if (claimed.error.message.includes('already_registered')) {
      const mine = await currentDevice(device);
      if (mine && !mine.revoked) {
        return withoutRevoked(mine);
      }
    }
    const error = new Error(explain(claimed.error.message, registerCode));
    if (claimed.error.message.includes('device_code_taken')) {
      Object.assign(error, { taken: true });
    }
    throw error;
  }
  return claimed.data as ClaimedDevice;
}

async function signInAnonymously(device: ServerClient): Promise<void> {
  const signIn = await device.auth.signInAnonymously();
  if (signIn.error) {
    throw new Error(OFFLINE);
  }
}

type MyDevice = ClaimedDevice & { revoked: boolean };

async function currentDevice(device: ServerClient): Promise<MyDevice | null> {
  const { data, error } = await device.rpc('my_device');
  return error ? null : ((data ?? null) as MyDevice | null);
}

function withoutRevoked({ marketId, marketName, deviceId, deviceCode }: MyDevice): ClaimedDevice {
  return { marketId, marketName, deviceId, deviceCode };
}

/**
 * The register's settings once it stops syncing so it can be paired again: its database, and
 * every queued operation in it, stay where they are.
 */
export function unpairedSettings(current: DeviceSettings): DeviceSettings {
  const unpaired = { ...current, databaseId: current.databaseId ?? current.marketId };
  delete unpaired.paired;
  return unpaired;
}

/**
 * The register's settings once paired. `keepData` keeps this register's database, and with it
 * the queue of everything done here so far, which then goes to the market; otherwise the
 * register starts on a new, empty database and the old one stays where it was.
 */
export function pairedSettings(
  current: DeviceSettings,
  claimed: ClaimedDevice,
  deviceName: string,
  keepData: boolean,
): DeviceSettings {
  return {
    marketId: claimed.marketId,
    marketName: claimed.marketName,
    deviceCode: claimed.deviceCode,
    deviceName: deviceName.trim(),
    databaseId: keepData ? (current.databaseId ?? current.marketId) : claimed.marketId,
    paired: true,
  };
}

/** Which kind of register this is, for the server's list of devices. */
export function currentPlatform(): Platform {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/electron/i.test(agent)) {
    return 'windows';
  }
  return /android/i.test(agent) ? 'android' : 'web';
}
