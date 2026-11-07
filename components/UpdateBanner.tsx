import React, { useEffect, useRef, useState } from 'react';

// Saber Group "new version" banner: the same file and the same look in every system.
// Each build writes /version.json with an id that is also baked into the bundle as
// __APP_BUILD_ID__. When they differ, a newer deploy is live and the banner shows up.
// It never reloads by itself, so nobody loses a half-filled form.
// Inline styles on purpose: it looks the same whatever CSS (Tailwind, CDN, plain) a system uses.

const CHECK_EVERY_MS = 2 * 60 * 1000;

const wrapStyle: React.CSSProperties = {
  position: 'fixed', left: 16, right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
  zIndex: 2147483000, display: 'flex', justifyContent: 'center', pointerEvents: 'none',
};
const pillStyle: React.CSSProperties = {
  pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12, maxWidth: 460,
  padding: '12px 14px 12px 16px', borderRadius: 16, background: '#1c1917', color: '#fff',
  border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
  fontFamily: "Cairo, 'Segoe UI', Tahoma, sans-serif", fontSize: 14, lineHeight: 1.5, direction: 'rtl',
};
const buttonStyle: React.CSSProperties = {
  flexShrink: 0, minHeight: 36, padding: '6px 14px', border: 0, borderRadius: 10,
  background: '#c4321f', color: '#fff', font: 'inherit', fontWeight: 800, cursor: 'pointer',
};

const UpdateBanner: React.FC = () => {
  const [available, setAvailable] = useState(false);
  const [reloading, setReloading] = useState(false);
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
    setReloading(true);
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs || []).map((r) => r.unregister()));
      const keys = await window.caches?.keys?.();
      await Promise.all((keys || []).map((k) => window.caches.delete(k)));
    } catch {
      /* reloading is enough if cleanup fails */
    }
    window.location.reload();
  };

  if (!available) return null;
  return (
    <div role="status" aria-live="polite" style={wrapStyle}>
      <div style={pillStyle}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff9d5c" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
        <span>نزل تحديث جديد للسيستم</span>
        <button type="button" onClick={refresh} disabled={reloading} style={{ ...buttonStyle, opacity: reloading ? 0.7 : 1 }}>
          {reloading ? 'بيحدّث…' : 'حدّث دلوقتي'}
        </button>
      </div>
    </div>
  );
};

export default UpdateBanner;
