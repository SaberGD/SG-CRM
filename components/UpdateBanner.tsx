import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const CHECK_EVERY_MS = 2 * 60 * 1000;

// Tells people when a newer version has been deployed (same as the accounting and training
// systems). It only shows a banner and never reloads by itself, so nobody loses a half-filled form.
const UpdateBanner: React.FC = () => {
  const [available, setAvailable] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const check = async () => {
      if (busy.current || document.visibilityState === 'hidden') return;
      busy.current = true;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.id && data.id !== __APP_BUILD_ID__) setAvailable(true);
      } catch {
        /* offline or blocked: try again later */
      } finally {
        busy.current = false;
      }
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    check();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, []);

  const refresh = async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs || []).map((r) => r.unregister()));
      const keys = await caches?.keys?.();
      await Promise.all((keys || []).map((k) => caches.delete(k)));
    } catch {
      /* reloading is enough if cleanup fails */
    }
    window.location.reload();
  };

  if (!available) return null;
  return (
    <div role="status" className="sg-update-banner">
      <div>
        <RefreshCw size={18} aria-hidden="true" />
        <span>نزل تحديث جديد للسيستم</span>
        <button type="button" onClick={refresh}>حدّث دلوقتي</button>
      </div>
    </div>
  );
};

export default UpdateBanner;
