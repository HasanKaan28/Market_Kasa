import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeCamera, removeCamera } from '@/test/camera';
import { CameraButton } from './CameraButton';
import { CameraScanner } from './CameraScanner';

// ZXing, which reads where the browser's detector cannot: a reader that sees one code.
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    async decodeFromStream(
      _stream: unknown,
      _video: unknown,
      onResult: (result: { getText(): string }) => void,
    ) {
      setTimeout(() => onResult({ getText: () => '8690000000024' }), 50);
      return { stop: vi.fn() };
    }
  },
}));

afterEach(removeCamera);

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
    expect(
      await screen.findByText('Okundu: 8690000000017', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
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

  it('counts a code held in view once and shows what it counted', async () => {
    fakeCamera([['8690000000017']]);
    const onScan = vi.fn(async () => 'Çay: 1 adet');
    render(<CameraScanner open continuous onClose={vi.fn()} onScan={onScan} />);
    expect(await screen.findByText('Çay: 1 adet')).toBeInTheDocument();
    // Held in front of the camera for over a second more: still one.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('takes one code when it closes on the first', async () => {
    fakeCamera([['8690000000017', '8690000000024']]);
    const onScan = vi.fn();
    const onClose = vi.fn();
    render(<CameraScanner open onClose={onClose} onScan={onScan} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onScan).toHaveBeenCalledExactlyOnceWith('8690000000017');
  });

  it('reads with ZXing where the detector reads no formats', async () => {
    fakeCamera([['8690000000017']], undefined, { formats: [] });
    const onScan = vi.fn();
    render(<CameraScanner open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('8690000000024'));
  });
});

describe('CameraButton', () => {
  it('offers the camera only where the browser has one', async () => {
    const onScan = vi.fn();
    const { unmount } = render(<CameraButton onScan={onScan} />);
    expect(screen.queryByRole('button', { name: 'Kamerayla okut' })).not.toBeInTheDocument();
    unmount();
    fakeCamera([['8690000000017']]);
    render(<CameraButton onScan={onScan} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kamerayla okut' }));
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('8690000000017'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Kamerayla okut' })).not.toBeInTheDocument(),
    );
  });
});
