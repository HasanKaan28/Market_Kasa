import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraScanner } from './CameraScanner';

/**
 * A camera that shows, frame by frame, the codes in `reads` (the last frame repeats), read by a
 * BarcodeDetector the way the browser's would be.
 */
function fakeCamera(reads: string[][], failure?: string) {
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn(async () => {
    if (failure) {
      throw new DOMException('camera', failure);
    }
    return { getTracks: () => [track] };
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  let frame = 0;
  class FakeDetector {
    async detect() {
      const codes = reads[Math.min(frame, reads.length - 1)] ?? [];
      frame += 1;
      return codes.map((rawValue) => ({ rawValue }));
    }
  }
  vi.stubGlobal('BarcodeDetector', FakeDetector);
  return { track, getUserMedia };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('CameraScanner', () => {
  it('reads a code and closes', async () => {
    const { getUserMedia } = fakeCamera([[], ['8690000000017']]);
    const onScan = vi.fn();
    const onClose = vi.fn();
    render(<CameraScanner open onClose={onClose} onScan={onScan} />);
    expect(screen.getByRole('dialog', { name: 'Kamerayla okut' })).toBeInTheDocument();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('8690000000017'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    });
  });

  it('keeps reading in continuous mode without repeating a code at once', async () => {
    fakeCamera([['BRK-0042'], ['BRK-0042'], ['BRK-0042'], ['8690000000017']]);
    const onScan = vi.fn();
    const onClose = vi.fn();
    render(<CameraScanner open continuous onClose={onClose} onScan={onScan} />);
    expect(await screen.findByText('Okundu: 8690000000017', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(onScan.mock.calls).toEqual([['BRK-0042'], ['8690000000017']]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops the camera when it closes', async () => {
    const { track } = fakeCamera([[]]);
    const { rerender } = render(<CameraScanner open onClose={vi.fn()} onScan={vi.fn()} />);
    expect(await screen.findByText('Barkodu kameraya gösterin.')).toBeInTheDocument();
    expect(track.stop).not.toHaveBeenCalled();
    rerender(<CameraScanner open={false} onClose={vi.fn()} onScan={vi.fn()} />);
    expect(track.stop).toHaveBeenCalled();
  });

  it('says when the camera is not allowed or missing', async () => {
    fakeCamera([], 'NotAllowedError');
    const onClose = vi.fn();
    const { unmount } = render(<CameraScanner open onClose={onClose} onScan={vi.fn()} />);
    expect(await screen.findByText('Kamera izni verilmedi.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalled();
    unmount();
    fakeCamera([], 'NotFoundError');
    render(<CameraScanner open onClose={vi.fn()} onScan={vi.fn()} />);
    expect(await screen.findByText('Kamera bulunamadı.')).toBeInTheDocument();
  });
});
