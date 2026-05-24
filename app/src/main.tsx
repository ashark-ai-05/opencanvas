import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SharePage } from './share/SharePage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installAuthFetch } from './lib/auth-fetch';
import './styles/globals.css';

// Wrap globalThis.fetch BEFORE any module fires a backend request. In
// packaged Electron this attaches the X-OpenCanvas-Token header from
// the preload bridge; in Vite dev it's a no-op (proxy injects).
installAuthFetch();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

// Tiny route branch — avoids pulling in a router for one extra page.
// `/share/<uuid>` renders the read-only SharePage; everything else
// loads the main App. The backend's SPA fallback ensures /share/*
// resolves to the same index.html so we can route client-side.
const shareMatch = window.location.pathname.match(
  /^\/share\/([a-f0-9-]{36})\/?$/i,
);

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      {shareMatch ? <SharePage shareId={shareMatch[1]!} /> : <App />}
    </ErrorBoundary>
  </StrictMode>
);
