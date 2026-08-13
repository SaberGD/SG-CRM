
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

