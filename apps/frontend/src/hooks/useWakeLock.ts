import { useEffect } from "react";

/**
 * Keeps the screen awake while a display page is open.
 *
 * A tablet mounted next to a fermenter is useless the moment its screen
 * sleeps, and every mobile OS sleeps by default. The Screen Wake Lock API is
 * the supported way to say "not while this is showing".
 *
 * Two things it must survive. The lock is released automatically whenever the
 * page is hidden — switching tabs, locking the device — and is NOT restored
 * on return, so it has to be re-acquired on `visibilitychange`. And it is
 * absent on older browsers (Safari only gained it in iOS 16.4), which is
 * exactly the vintage of the spare tablet likely to end up on a wall, so a
 * missing API degrades silently rather than throwing.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire(): Promise<void> {
      try {
        const lock = await navigator.wakeLock.request("screen");
        // The effect may have been torn down while the request was in
        // flight; releasing immediately keeps us from leaking the lock.
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Denied (battery saver, no user activation yet, unsupported
        // surface). Nothing to recover — the screen simply sleeps as it
        // would have without this hook.
      }
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release();
    };
  }, [enabled]);
}
