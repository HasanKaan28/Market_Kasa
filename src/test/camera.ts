import { vi } from 'vitest';

let undo: (() => void) | undefined;

/**
 * A back camera whose frames show the codes in `reads`, one frame per read and the last one
 * repeating, read by a BarcodeDetector the way the browser's would be. With `failure`, opening
 * the camera fails with a DOMException of that name. `removeCamera` undoes it.
 */
export function fakeCamera(reads: string[][], failure?: string) {
  removeCamera();
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
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
  undo = () => {
    play.mockRestore();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  };
  return { track, getUserMedia };
}

export function removeCamera(): void {
  undo?.();
  undo = undefined;
}
