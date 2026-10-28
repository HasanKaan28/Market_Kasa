import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import { App } from './app/App';
import './app/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
