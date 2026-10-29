import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeCamera, removeCamera } from '@/test/camera';
import { CameraButton } from './CameraButton';
import { CameraScanner } from './CameraScanner';

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
