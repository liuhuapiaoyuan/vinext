// Chromium (and historically Firefox) fire a window `error` event when a
// ResizeObserver callback mutates layout in the same frame. The leftover
// notifications are deferred to the next frame — they are not lost, and
// the page is usually fine. Next.js overlay skips these; see
// https://github.com/vercel/next.js/pull/74643 and
// https://github.com/vercel/next.js/discussions/51551
//
// Chrome: "ResizeObserver loop completed with undelivered notifications."
// Older Chrome / Firefox: "ResizeObserver loop limit exceeded"

const RESIZE_OBSERVER_LOOP =
  /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i;

export function isBenignBrowserErrorMessage(message: string | undefined | null): boolean {
  return typeof message === "string" && RESIZE_OBSERVER_LOOP.test(message);
}

/**
 * Window `error` events that must not open the vinext overlay.
 *
 * Next.js only reports when `event.error` is present (`use-error-handler.ts`).
 * ResizeObserver notifications are the common case: `event.message` is set
 * and `event.error` is null, so they never print to the console either.
 */
export function shouldIgnoreWindowErrorEvent(event: {
  readonly error?: unknown;
  readonly message?: string;
}): boolean {
  if (isBenignBrowserErrorMessage(event.message)) return true;
  if (event.error instanceof Error && isBenignBrowserErrorMessage(event.error.message)) {
    return true;
  }
  return event.error == null;
}
