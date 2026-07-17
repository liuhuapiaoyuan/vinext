/**
 * RSC HMR abort helpers.
 *
 * Rapid saves while long agent SSE/streams are open must cancel superseded
 * HMR `/_rsc` fetches immediately. Those stale fetches otherwise stack on the
 * browser's per-host HTTP/1.1 connection pool and make the page look dead
 * even though the Vite process is still healthy. Agent streams are owned by
 * app code and are intentionally not aborted here.
 */

export function isBenignRscHmrAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/**
 * Track the in-flight RSC HMR fetch AbortController. Calling `begin()` aborts
 * any previous controller and returns a fresh signal for the new update.
 */
export function createRscHmrAbortTracker(): {
  begin: () => AbortSignal;
  clearIfCurrent: (signal: AbortSignal) => void;
} {
  let active: AbortController | null = null;

  return {
    begin() {
      active?.abort();
      const next = new AbortController();
      active = next;
      return next.signal;
    },
    clearIfCurrent(signal: AbortSignal) {
      if (active?.signal === signal) {
        active = null;
      }
    },
  };
}
