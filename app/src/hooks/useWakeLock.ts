import { useEffect, useRef, useState } from 'react';

// CUSTOM-JOURNAL: keeps the screen awake while `active` is true (used during
// voice recording -- phones otherwise sleep mid-entry and the mic is cut).
// The Screen Wake Lock API releases its sentinel automatically whenever the
// page is hidden, so it is re-requested on `visibilitychange`. Returns
// `supported` so callers can show a hint where the API is missing (older iOS
// Safari / non-secure origins).
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active || !supported) return;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible' || sentinelRef.current) return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          sentinel.release().catch(() => { });
          return;
        }
        sentinelRef.current = sentinel;
        setHeld(true);
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
          setHeld(false);
        });
      } catch (error) {
        // Rejected e.g. on low battery / power-saver mode; recording still works.
        console.warn('Wake lock request failed:', error);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      setHeld(false);
      sentinel?.release().catch(() => { });
    };
  }, [active, supported]);

  return { supported, held };
}
