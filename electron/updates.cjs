// Desktop updates from the GitHub release: the app checks when it starts and when asked, says what
// it found, and downloads and installs only when the person presses "Güncelle".

/**
 * Connects electron-updater to the window. Status reaches the page on `updates:status`; the page
 * calls `updates:check` and `updates:install`. A build that is not installed never checks.
 */
function wireUpdates({ autoUpdater, ipcMain, getWindow, isPackaged }) {
  autoUpdater.autoDownload = false;
  // A downloaded update the person did not install now goes in when the app closes.
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (status) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('updates:status', status);
    }
  };

  autoUpdater.on('checking-for-update', () => send({ kind: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ kind: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ kind: 'current' }));
  autoUpdater.on('download-progress', (progress) =>
    send({ kind: 'downloading', percent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) => {
    send({ kind: 'installing', version: info.version });
    // Not silent, so the installer's progress shows; the app opens again when it is done.
    autoUpdater.quitAndInstall(false, true);
  });
  // An offline shop is normal: the page says the check failed, nothing more.
  autoUpdater.on('error', () => send({ kind: 'error' }));

  ipcMain.handle('updates:check', async () => {
    if (!isPackaged) {
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      send({ kind: 'error' });
    }
  });
  ipcMain.handle('updates:install', async () => {
    if (!isPackaged) {
      return;
    }
    try {
      await autoUpdater.downloadUpdate();
    } catch {
      send({ kind: 'error' });
    }
  });
}

module.exports = { wireUpdates };
