import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import { Capacitor } from '@capacitor/core';
import { App } from './app/App';
import { loadDeviceSettings } from './app/device';
import { CustomerDisplay } from './display/CustomerDisplay';
import './app/app.css';
import { registerServiceWorker } from './pwa/register';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing');
}

// The customer display is its own window: it shows the register's cart and starts nothing else.
const customerDisplay = window.location.hash === '#/display';

createRoot(container).render(
  <StrictMode>
    {customerDisplay ? <CustomerDisplay marketName={loadDeviceSettings().marketName} /> : <App />}
  </StrictMode>,
);

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
