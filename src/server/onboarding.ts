import type { ServerClient } from './client';
import {
  createPairingCode,
  pairDevice,
  type ClaimedDevice,
  type OwnedMarket,
  type Platform,
} from './pairing';

/** A device bound to its market, a choice of markets, or an email still to confirm. */
export type OnboardingResult =
  { claimed: ClaimedDevice } | { markets: OwnedMarket[] } | { confirmEmail: true };

const OFFLINE = 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

function explainSignUp(message: string): string {
  if (/password/i.test(message)) {
    return 'Şifre en az 8 karakter olmalı.';
  }
  if (/email/i.test(message)) {
    return 'E-posta adresi geçersiz.';
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Çok fazla deneme oldu. Birkaç dakika sonra yeniden deneyin.';
  }
  return OFFLINE;
}

function explainMarket(message: string): string {
  if (message.includes('too_many_markets')) {
    return 'Bu hesapla en çok 3 market açılabilir.';
  }
  if (message.includes('bad_name')) {
    return 'Market adı 1–60 karakter olmalı.';
  }
  return OFFLINE;
}

/**
 * The first screen's "Market kur": signs the shop up with its own email (or in, if the email
 * already has an account), opens its market and binds this device as its first register. The
 * owner's session is dropped at the end; only the register's own session stays on the device.
 */
export async function openMarket({
  owner,
  device,
  email,
  password,
  marketName,
  platform,
}: {
  owner: ServerClient;
  device: ServerClient;
  email: string;
  password: string;
  marketName: string;
  platform: Platform;
}): Promise<OnboardingResult> {
  const credentials = { email: email.trim(), password };
  const signUp = await owner.auth.signUp(credentials);
  if (signUp.error) {
    if (!/already registered/i.test(signUp.error.message)) {
      throw new Error(explainSignUp(signUp.error.message));
    }
    const signIn = await owner.auth.signInWithPassword(credentials);
    if (signIn.error) {
      throw new Error(
        /invalid login/i.test(signIn.error.message)
          ? 'Bu e-postanın hesabı var ama şifre yanlış.'
          : OFFLINE,
      );
    }
  } else if (!signUp.data.session) {
    // The project asks new accounts to confirm their email before they can sign in.
    return { confirmEmail: true };
  }
  let code: string;
  try {
    const opened = await owner.rpc('create_own_market', { name: marketName.trim() });
    if (opened.error) {
      throw new Error(explainMarket(opened.error.message));
    }
    const market = opened.data as OwnedMarket;
    const made = await owner.rpc('create_pairing', { market_id: market.id });
    if (made.error) {
      throw new Error(OFFLINE);
    }
    code = String(made.data);
  } finally {
    await owner.auth.signOut({ scope: 'local' });
  }
  return {
    claimed: await pairDevice({ device, code, deviceCode: '', deviceName: '', platform }),
  };
}

/**
 * "Markete giriş yap" on another device: the owner signs in once, and this device joins their
 * market as the next free register (K2, K3…).
 */
export async function joinMarket({
  owner,
  device,
  email,
  password,
  marketId,
  platform,
}: {
  owner: ServerClient;
  device: ServerClient;
  email: string;
  password: string;
  marketId?: string;
  platform: Platform;
}): Promise<OnboardingResult> {
  const made = await createPairingCode({
    owner,
    email,
    password,
    ...(marketId ? { marketId } : {}),
  });
  if ('markets' in made) {
    return { markets: made.markets };
  }
  return {
    claimed: await pairDevice({
      device,
      code: made.code,
      deviceCode: '',
      deviceName: '',
      platform,
    }),
  };
}
