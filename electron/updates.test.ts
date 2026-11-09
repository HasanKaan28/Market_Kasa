import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import updates from './updates.cjs';

const { wireUpdates } = updates;

/** electron-updater's autoUpdater, as far as the app uses it. */
function fakeUpdater() {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  });
  return updater;
}

function fakeIpc() {
  const handlers = new Map<string, () => unknown>();
  return {
    handlers,
    handle: (channel: string, handler: () => unknown) => handlers.set(channel, handler),
  };
}

function setup() {
  const updater = fakeUpdater();
  const ipc = fakeIpc();
  const sent: unknown[] = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: (_c: string, s: unknown) => sent.push(s) },
  };
  const clock = { now: 0 };
  const timers: { ms: number; run: () => void }[] = [];
  wireUpdates({
    autoUpdater: updater,
    ipcMain: ipc,
    getWindow: () => window,
    isPackaged: true,
    now: () => clock.now,
    every: (run: () => void, ms: number) => timers.push({ ms, run }),
  });
  return { updater, ipc, sent, clock, timers };
}

const MINUTE = 60_000;

describe('desktop updates', () => {
  it('looks for a new release when it starts and every few hours, and downloads it unasked', () => {
    const { updater, timers } = setup();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(4 * 60 * MINUTE);
    timers[0]?.run();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('installs at once an update that is ready while the app is just starting', () => {
    const { updater, sent, clock } = setup();
    clock.now = 30_000;
    updater.emit('update-downloaded', { version: '2.0.5' });
    expect(sent.at(-1)).toEqual({ kind: 'installing', version: '2.0.5' });
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('leaves a register at work alone: the update waits for the app to close or for a press', async () => {
    const { updater, ipc, sent, clock } = setup();
    clock.now = 10 * MINUTE;
    updater.emit('update-downloaded', { version: '2.0.5' });
    expect(sent.at(-1)).toEqual({ kind: 'ready', version: '2.0.5' });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    await ipc.handlers.get('updates:install')?.();
    expect(sent.at(-1)).toEqual({ kind: 'installing', version: '2.0.5' });
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('tells the window what it found', async () => {
    const { updater, ipc, sent } = setup();
    sent.length = 0;

    await ipc.handlers.get('updates:check')?.();
    expect(updater.checkForUpdates).toHaveBeenCalled();
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '2.0.1' });
    expect(sent).toEqual([{ kind: 'checking' }, { kind: 'available', version: '2.0.1' }]);

    updater.emit('update-not-available', { version: '2.0.0' });
    expect(sent.at(-1)).toEqual({ kind: 'current' });
  });

  it('downloads, shows progress and installs when asked', async () => {
    const { updater, ipc, sent, clock } = setup();
    clock.now = 10 * MINUTE;
    updater.emit('update-available', { version: '2.0.1' });
    await ipc.handlers.get('updates:install')?.();
    expect(updater.downloadUpdate).toHaveBeenCalled();

    updater.emit('download-progress', { percent: 41.6 });
    expect(sent.at(-1)).toEqual({ kind: 'downloading', percent: 42 });
    updater.emit('update-downloaded', { version: '2.0.1' });
    expect(sent.at(-1)).toEqual({ kind: 'installing', version: '2.0.1' });
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('reports a failed check instead of crashing', async () => {
    const { updater, ipc, sent } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await expect(ipc.handlers.get('updates:check')?.()).resolves.toBeUndefined();
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(sent.at(-1)).toEqual({ kind: 'error' });
  });

  it('does nothing in a build that is not installed', async () => {
    const updater = fakeUpdater();
    const ipc = fakeIpc();
    const every = vi.fn();
    wireUpdates({
      autoUpdater: updater,
      ipcMain: ipc,
      getWindow: () => null,
      isPackaged: false,
      every,
    });
    await ipc.handlers.get('updates:check')?.();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(every).not.toHaveBeenCalled();
  });
});
