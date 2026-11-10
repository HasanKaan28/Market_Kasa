import { useEffect, useState, type JSX } from 'react';
import { Button } from '@/design';
import { SettingsSection } from './MarketSections';
import {
  APK_URL,
  isNewer,
  latestReleaseVersion,
  type DesktopUpdates,
  type UpdateStatus,
} from './updates';

export type { DesktopUpdates, UpdateStatus } from './updates';

const STATUS_TEXT: Partial<Record<UpdateStatus['kind'], string>> = {
  checking: 'Denetleniyor…',
  current: 'Güncel',
  error: 'Güncelleme denetlenemedi.',
};

/**
 * The app's version and, on the desktop and on Android, the way to the next one. The web app has
 * no section: its service worker takes a new release by itself.
 */
export function UpdateSection({
  version,
  desktop,
  android = false,
  latestVersion = latestReleaseVersion,
}: {
  version: string;
  desktop?: DesktopUpdates;
  android?: boolean;
  latestVersion?: () => Promise<string | null>;
}): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>();
  const [latest, setLatest] = useState<string | null>();

  useEffect(() => {
    if (!desktop) {
      return;
    }
    const stop = desktop.onStatus(setStatus);
    void desktop.check();
    return stop;
  }, [desktop]);

  useEffect(() => {
    if (desktop || !android) {
      return;
    }
    let live = true;
    latestVersion().then(
      (found) => live && setLatest(found),
      () => live && setLatest(null),
    );
    return () => {
      live = false;
    };
  }, [desktop, android, latestVersion]);

  if (!desktop && !android) {
    return null;
  }

  let line: string | undefined;
  let action: JSX.Element | undefined;
  if (desktop) {
    line =
      status?.kind === 'downloading'
        ? `İndiriliyor %${status.percent}`
        : status?.kind === 'installing'
          ? 'Kuruluyor; uygulama yeniden açılacak.'
          : status?.kind === 'ready'
            ? `Sürüm ${status.version} indirildi; program kapanınca kendiliğinden kurulur.`
            : status?.kind === 'available'
              ? `Yeni sürüm ${status.version} hazır.`
              : status && STATUS_TEXT[status.kind];
    action =
      status?.kind === 'available' ? (
        <Button variant="primary" onClick={() => void desktop.install()}>
          {`Güncelle (${status.version})`}
        </Button>
      ) : status?.kind === 'ready' ? (
        <Button variant="primary" onClick={() => void desktop.install()}>
          {`Şimdi kur (${status.version})`}
        </Button>
      ) : status?.kind === 'current' || status?.kind === 'error' ? (
        <Button onClick={() => void desktop.check()}>Denetle</Button>
      ) : undefined;
  } else if (latest !== undefined) {
    if (latest && isNewer(latest, version)) {
      action = (
        <a
          href={APK_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 font-medium text-white"
        >
          {`Yeni sürümü indir (${latest})`}
        </a>
      );
      line = 'İndirilen dosyayı açıp kurun; verileriniz kalır.';
    } else {
      line = latest ? 'Güncel' : 'Güncelleme denetlenemedi.';
    }
  }

  return (
    <SettingsSection
      id="update-heading"
      title="Güncelleme"
      description={`Sürüm ${version}`}
      action={action}
    >
      {line ? (
        <p role="status" className="text-text-2">
          {line}
        </p>
      ) : null}
    </SettingsSection>
  );
}
