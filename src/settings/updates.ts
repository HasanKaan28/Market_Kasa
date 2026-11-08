import { Capacitor } from '@capacitor/core';

/** What the desktop app's updater reports (electron/updates.cjs). */
export type UpdateStatus =
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'current' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'installing'; version: string }
  | { kind: 'error' };

/** The bridge the desktop app's preload script puts on `window.marketKasa.updates`. */
export type DesktopUpdates = {
  check(): Promise<unknown>;
  install(): Promise<unknown>;
  onStatus(callback: (status: UpdateStatus) => void): () => void;
};

const RELEASES = 'https://github.com/HasanKaan28/Market_Kasa/releases';
export const APK_URL = `${RELEASES}/latest/download/Market-Kasa.apk`;

/** The version of the latest published release, from GitHub. */
export async function latestReleaseVersion(): Promise<string | null> {
  const response = await fetch(
    'https://api.github.com/repos/HasanKaan28/Market_Kasa/releases/latest',
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  if (!response.ok) {
    return null;
  }
  const { tag_name: tag } = (await response.json()) as { tag_name?: string };
  return typeof tag === 'string' ? tag.replace(/^v/, '') : null;
}

/** True when `latest` is a later x.y.z than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const parts = (version: string) => version.split(/[.-]/).slice(0, 3).map(Number);
  const [a, b] = [parts(latest), parts(current)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}

/** Where this app runs, for the update section: the desktop bridge, or an Android phone. */
export function updateTarget(): { desktop?: DesktopUpdates; android: boolean } {
  const bridge = (window as { marketKasa?: { updates?: DesktopUpdates } }).marketKasa?.updates;
  return {
    ...(bridge ? { desktop: bridge } : {}),
    android: Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  };
}
