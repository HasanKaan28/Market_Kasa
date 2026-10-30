import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import { Capacitor } from '@capacitor/core';
import { App } from './app/App';
import './app/app.css';
import { registerServiceWorker } from './pwa/register';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void registerServiceWorker(
  {
    prod: import.meta.env.PROD,
    native: Capacitor.isNativePlatform(),
    protocol: window.location.protocol,
    hostname: window.location.hostname,
  },
  __APP_VERSION__,
);
