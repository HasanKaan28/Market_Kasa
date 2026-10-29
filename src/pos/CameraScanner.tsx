import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { Dialog } from '@/design';
import { startCameraScan } from './camera';

export type CameraScannerProps = {
  open: boolean;
  onClose(): void;
  /** Called with each code read, as a scanner's code would be. */
  onScan(code: string): void;
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
  const [lastCode, setLastCode] = useState<string>();
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
    startCameraScan(video, (code) => {
      const current = latest.current;
      current.onScan(code);
      if (current.continuous) {
        setLastCode(code);
      } else {
        current.onClose();
      }
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
        {lastCode ? (
          <p role="status" className="font-medium">
            {`Okundu: ${lastCode}`}
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
