import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/geist';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // A new deployment's worker calls skipWaiting() and clients.claim(), so it
  // takes over an already-open tab. Reload once at that moment: without this,
  // the tab keeps painting the previous cached shell (and its title and icons)
  // and a refresh appears to do nothing.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed service-worker registration must never break the planner.
    });
  });
}
