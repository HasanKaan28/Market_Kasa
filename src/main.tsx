import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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
