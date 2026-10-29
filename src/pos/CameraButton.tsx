import { Camera } from 'lucide-react';
import { useState, type JSX } from 'react';
import { Button } from '@/design';
import { CameraScanner } from './CameraScanner';

export type CameraButtonProps = {
  /** Called with each code read, as the screen's scanner handler would be. */
  onScan(code: string): void;
  /** Keeps the camera open after a code, as a count does. */
  continuous?: boolean;
};

/** Whether this browser can open a camera at all (a secure page with media devices). */
function hasCamera(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** "Kamerayla okut": opens the camera on request, and shows nothing where there is none. */
export function CameraButton({ onScan, continuous = false }: CameraButtonProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!hasCamera()) {
    return null;
  }
  return (
    <>
      <Button icon={<Camera aria-hidden="true" size={18} />} onClick={() => setOpen(true)}>
        Kamerayla okut
      </Button>
      {open ? (
        <CameraScanner
          open
          continuous={continuous}
          onClose={() => setOpen(false)}
          onScan={onScan}
        />
      ) : null}
    </>
  );
}
