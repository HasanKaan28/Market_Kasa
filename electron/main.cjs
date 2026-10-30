const { app, BrowserWindow, Menu, dialog, net, protocol, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  APP_HOST,
  CONTENT_SECURITY_POLICY,
  devToolsAllowed,
  isExternalUrl,
  resolveAppFile,
} = require('./security.cjs');

const DIST = path.join(__dirname, '../dist');
const APP_ORIGIN = `app://${APP_HOST}`;

// The app is served from its own origin rather than file://, so web security and the sandbox
// can stay on and its data lives under one stable origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const gotTheLock = app.requestSingleInstanceLock();

let mainWindow = null;

async function serveApp(request) {
  const file = resolveAppFile(DIST, request.url);
  if (!file) {
    return new Response('Not found', { status: 404 });
  }
  const response = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 650,
    title: 'Market Kasa',
    backgroundColor: '#F5F6F8',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: devToolsAllowed(app.isPackaged),
    },
  });

  // Links such as WhatsApp go to the system browser; no window of ours ever opens on them.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url) => {
    console.error('Load failed:', errorCode, errorDescription, url);
  });

  const view = [
    { role: 'reload', label: 'Yenile (F5)' },
    { role: 'forceReload', label: 'Zorla yenile' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'Tam ekran (F11)' },
  ];
  if (devToolsAllowed(app.isPackaged)) {
    view.push({ role: 'toggleDevTools', label: 'Geliştirici araçları' });
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'Görünüm', submenu: view },
      {
        label: 'Yardım',
        submenu: [
          {
            label: 'Market Kasa hakkında',
            click: () =>
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Market Kasa',
                message: `Market Kasa\nSürüm ${app.getVersion()}`,
              }),
          },
        ],
      },
    ]),
  );

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
    protocol.handle('app', serveApp);
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
