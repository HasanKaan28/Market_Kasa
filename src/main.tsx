import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/fonts.css';
// Receipts, barcodes and cart amounts print in a monospaced face.
import '@fontsource/ibm-plex-mono/500.css';
import { Capacitor } from '@capacitor/core';
import { App } from './app/App';
import { loadDeviceSettings } from './app/device';
import { CustomerDisplay } from './display/CustomerDisplay';
import { isOperatorHash } from './operator/route';
import './app/app.css';
import { registerServiceWorker } from './pwa/register';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing');
}

// The customer display is its own window: it shows the register's cart and starts nothing else.
const customerDisplay = window.location.hash === '#/display';
// The developer's operator panel: its own sign-in and session, never the register's data. No
// screen links to it; it is opened by its address.
const operator = isOperatorHash(window.location.hash);

// Moving into or out of the panel in the same tab starts the page again, so the register and the
// panel never run side by side.
window.addEventListener('hashchange', () => {
  if (isOperatorHash(window.location.hash) !== operator) {
    window.location.reload();
  }
});

const root = createRoot(container);
if (operator) {
  // Loaded only on its own address, so the register's bundle does not carry it.
  void import('./operator/OperatorPanel').then(({ default: OperatorPanel }) =>
    root.render(
      <StrictMode>
        <OperatorPanel />
      </StrictMode>,
    ),
  );
} else {
  root.render(
    <StrictMode>
      {customerDisplay ? <CustomerDisplay marketName={loadDeviceSettings().marketName} /> : <App />}
    </StrictMode>,
  );
}

// Development only: `await seedDemo()` in the console fills an empty market for screenshots.
if (import.meta.env.DEV) {
  void import('./demo/seedDemo').then(({ seedDemo }) => Object.assign(window, { seedDemo }));
}

void registerServiceWorker(
  {
    prod: import.meta.env.PROD,
    native: Capacitor.isNativePlatform(),
    protocol: window.location.protocol,
    hostname: window.location.hostname,
  },
  __APP_VERSION__,
);
