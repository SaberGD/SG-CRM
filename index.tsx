
// Safely patch window.fetch property descriptor to prevent "Cannot set property fetch of #<Window> which has only a getter" errors
if (typeof window !== 'undefined') {
  try {
    const originalFetch = window.fetch;
    let currentFetch = originalFetch;
    Object.defineProperty(window, 'fetch', {
      get() {
        return currentFetch;
      },
      set(newFetch) {
        currentFetch = typeof newFetch === 'function' ? newFetch : currentFetch;
      },
      configurable: true,
      enumerable: true,
    });
  } catch (e) {
    // Ignore if non-configurable
  }
}

import React from 'react';

// Chunk-reload guard: the FTP deploy replaces the asset files, so a tab opened before a deploy
// can ask for a page file that no longer exists. Reload ONCE (flag in sessionStorage) to get the
// new files; if it still fails, the error screen shows instead of a reload loop.
const RELOAD_FLAG = 'sg-chunk-reloaded';
const isChunkError = (msg: string) => /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(msg);
const reloadOnce = () => {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch { return false; }
  window.location.reload();
  return true;
};
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e: Event) => { if (reloadOnce()) e.preventDefault(); });
  window.addEventListener('unhandledrejection', (e) => { if (isChunkError(String((e as PromiseRejectionEvent).reason?.message || e.reason || ''))) reloadOnce(); });
  // A good load clears the flag after a while, so the next deploy can reload again.
  window.setTimeout(() => { try { sessionStorage.removeItem(RELOAD_FLAG); } catch {} }, 30000);
}
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

