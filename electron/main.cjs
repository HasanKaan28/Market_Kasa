const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Tekil Kopya Kilidi (Single Instance Lock)
const gotTheLock = app.requestSingleInstanceLock();

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 650,
    title: 'Market Kasa - Masaüstü POS',
    backgroundColor: '#020617', // Slate 950
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // dist/index.html dosyasını yükle
  const indexPath = path.join(__dirname, '../dist/index.html');
  mainWindow.loadFile(indexPath);

  const menuTemplate = [
    {
      label: 'Görünüm',
      submenu: [
        { role: 'reload', label: 'Yenile (F5)' },
        { role: 'forceReload', label: 'Zorla Yenile' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tam Ekran (F11)' },
        { role: 'toggleDevTools', label: 'Geliştirici Araçları' }
      ]
    },
    {
      label: 'Yardım',
      submenu: [
        {
          label: 'Market Kasa Hakkında',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Market Kasa POS',
              message: 'Market Kasa POS - Windows Masaüstü Sürümü\nSürüm: 1.0.0\nGoogle Drive & Yerel Ağ Canlı Senkronizasyon Destekli'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
