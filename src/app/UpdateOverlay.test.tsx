import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopUpdates, UpdateStatus } from '@/settings/updates';
import { UpdateOverlay } from './UpdateOverlay';

function desktop() {
  let listener: ((status: UpdateStatus) => void) | undefined;
  const bridge: DesktopUpdates = {
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    defer: vi.fn(async () => undefined),
    onStatus(callback) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  return { bridge, emit: (status: UpdateStatus) => act(() => listener?.(status)) };
}

describe('UpdateOverlay', () => {
  it('covers the screen while a startup update downloads, then while it installs', () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    emit({ kind: 'available', version: '2.0.6', installNow: true });
    const dialog = screen.getByRole('dialog', { name: 'Güncelleme yükleniyor' });
    expect(dialog).toHaveTextContent('Sürüm 2.0.6 indiriliyor');

    emit({ kind: 'downloading', percent: 42, installNow: true });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByRole('dialog')).toHaveTextContent('%42');

    emit({ kind: 'installing', version: '2.0.6' });
    expect(screen.getByRole('dialog')).toHaveTextContent('Kuruluyor; program yeniden açılacak.');
    expect(screen.queryByRole('button', { name: 'Sonra kur' })).toBeNull();
  });

  it('stays away from an update that waits for the app to close', () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    emit({ kind: 'available', version: '2.0.6', installNow: false });
    emit({ kind: 'downloading', percent: 42, installNow: false });
    emit({ kind: 'ready', version: '2.0.6' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets the shop put it off and get back to work', async () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    emit({ kind: 'downloading', percent: 5, installNow: true });
    await userEvent.click(screen.getByRole('button', { name: 'Sonra kur' }));
    expect(bridge.defer).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Progress still arriving from before the press does not bring it back.
    emit({ kind: 'downloading', percent: 6, installNow: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives up on a failed download and lets the register work', () => {
    const { bridge, emit } = desktop();
    render(<UpdateOverlay desktop={bridge} />);
    emit({ kind: 'downloading', percent: 5, installNow: true });
    emit({ kind: 'error' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
