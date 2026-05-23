import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installAuthFetch } from './lib/auth-fetch';
import './styles/globals.css';

// Wrap globalThis.fetch BEFORE any module fires a backend request. In
// packaged Electron this attaches the X-OpenCanvas-Token header from
// the preload bridge; in Vite dev it's a no-op (proxy injects).
installAuthFetch();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
