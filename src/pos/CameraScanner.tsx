import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { Dialog } from '@/design';
import { startCameraScan } from './camera';

export type CameraScannerProps = {
  open: boolean;
  onClose(): void;
  /**
   * Called with each code read, as a scanner's code would be. In continuous mode what it returns
   * ("Çay: 3 adet", "Bu barkod kayıtlı değil.") is shown, so the screen behind can stay hidden.
   */
  onScan(code: string): void | string | undefined | Promise<string | undefined>;
  /** Keeps reading after a code, as a count does; otherwise the first code closes it. */
  continuous?: boolean;
};

type CameraState = { kind: 'starting' } | { kind: 'reading' } | { kind: 'failed'; message: string };

/**
 * Reads barcodes with the device's camera, in a dialog opened by a button. The camera is
 * released however the dialog closes: its button, Escape, or the first code read.
 */
export function CameraScanner({
  open,
  onClose,
  onScan,
  continuous = false,
}: CameraScannerProps): JSX.Element {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CameraState>({ kind: 'starting' });
  const [lastRead, setLastRead] = useState<string>();
  // The callbacks of the latest render, so a code read later never calls a stale one.
  const latest = useRef({ onClose, onScan, continuous });
  useLayoutEffect(() => {
    latest.current = { onClose, onScan, continuous };
  });

  useEffect(() => {
    if (!open || !video) {
      return;
    }
    let stop: (() => void) | undefined;
    let closed = false;
    let taken = false;
    startCameraScan(video, (code) => {
      const current = latest.current;
      // Closing on the first code takes only that one, even when a frame shows two.
      if (taken) {
        return;
      }
      if (!current.continuous) {
        taken = true;
        void current.onScan(code);
        current.onClose();
        return;
      }
      void Promise.resolve(current.onScan(code)).then((result) => {
        if (!closed) {
          setLastRead(result ?? `Okundu: ${code}`);
        }
      });
    }).then(
      (stopCamera) => {
        if (closed) {
          stopCamera();
          return;
        }
        stop = stopCamera;
        setState({ kind: 'reading' });
      },
      (error: unknown) => {
        if (!closed) {
          setState({ kind: 'failed', message: cameraError(error) });
        }
      },
    );
    return () => {
      closed = true;
      stop?.();
    };
  }, [open, video]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Kamerayla okut">
      <div className="flex flex-col gap-3">
        <video
          ref={setVideo}
          muted
          playsInline
          aria-label="Kamera görüntüsü"
          className="aspect-[4/3] w-full rounded-control bg-text object-cover"
        />
        {state.kind === 'failed' ? (
          <p role="alert" className="font-medium text-danger">
            {state.message}
          </p>
        ) : (
          <p className="text-text-2">
            {state.kind === 'reading' ? 'Barkodu kameraya gösterin.' : 'Kamera açılıyor…'}
          </p>
        )}
        {lastRead ? (
          <p role="status" className="font-medium">
            {lastRead}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function cameraError(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Kamera izni verilmedi.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Kamera bulunamadı.';
  }
  return 'Kamera açılamadı.';
}
