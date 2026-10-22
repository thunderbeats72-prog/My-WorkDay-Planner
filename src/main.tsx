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

/**
 * Hand the screen over from the static cover to the app.
 *
 * `#boot` is painted by `index.html` before any JavaScript runs, so the first
 * thing anyone sees is the mark rather than an empty white box. Two frames
 * after the first React paint is the right moment to fade it: one frame can be
 * dropped by a busy main thread and show the app half-painted underneath.
 *
 * If the bundle fails entirely, the inline fallback in `index.html` removes the
 * cover after a few seconds — a stuck logo is worse than an empty page, because
 * it looks like progress.
 */
const boot = document.getElementById('boot');
if (boot) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      boot.classList.add('is-done');
      window.setTimeout(() => boot.remove(), 460);
    });
  });
}

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
