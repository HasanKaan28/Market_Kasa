import { useEffect, useState, type JSX } from 'react';
import { Button, Logo } from '@/design';
import type { DesktopUpdates, UpdateStatus } from '@/settings/updates';

type Shown =
  | { kind: 'downloading'; version?: string; percent: number }
  | { kind: 'installing'; version: string };

/**
 * The desktop app's "Güncelleme yükleniyor" screen: over everything while an update found at
 * start downloads, since the app will close and reopen when it is done. "Sonra kur" puts it off
 * until the app closes, so a slow line never keeps the register from selling.
 */
export function UpdateOverlay({ desktop }: { desktop?: DesktopUpdates }): JSX.Element | null {
  const [shown, setShown] = useState<Shown | null>(null);
  const [putOff, setPutOff] = useState(false);

  useEffect(() => {
    if (!desktop) {
      return;
    }
    return desktop.onStatus((status: UpdateStatus) => {
      setShown((current) => {
        switch (status.kind) {
          case 'available':
            return status.installNow
              ? { kind: 'downloading', version: status.version, percent: 0 }
              : null;
          case 'downloading':
            return status.installNow
              ? {
                  kind: 'downloading',
                  percent: status.percent,
                  ...(current?.version ? { version: current.version } : {}),
                }
              : null;
          case 'installing':
            return { kind: 'installing', version: status.version };
          default:
            return null;
        }
      });
    });
  }, [desktop]);

  if (!desktop || !shown || (putOff && shown.kind === 'downloading')) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-overlay-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg p-4"
    >
      <div className="flex w-full max-w-md flex-col gap-5 rounded-control border border-line bg-surface p-6">
        <div className="flex items-center gap-3">
          <Logo className="size-11" />
          <h1 id="update-overlay-title" className="text-xl font-semibold">
            Güncelleme yükleniyor
          </h1>
        </div>
        {shown.kind === 'installing' ? (
          <p>Kuruluyor; program yeniden açılacak.</p>
        ) : (
          <>
            <p>
              {shown.version ? `Sürüm ${shown.version} indiriliyor` : 'Yeni sürüm indiriliyor'}
              {` %${shown.percent}`}. Bitince program kendini kapatıp yeni sürümle açılacak.
            </p>
            <div
              role="progressbar"
              aria-label="İndirme"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={shown.percent}
              className="h-2 overflow-hidden rounded-full bg-bg"
            >
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${shown.percent}%` }}
              />
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setPutOff(true);
                void desktop.defer();
              }}
            >
              Sonra kur
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
