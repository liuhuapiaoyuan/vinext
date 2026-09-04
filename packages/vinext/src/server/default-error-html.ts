/**
 * Default HTML 500 page matching Next.js `pages/_error.tsx`.
 *
 * Last-resort document when a request escapes vinext (Nitro unhandled errors,
 * adapter crashes) and React `error.tsx` / `global-error.tsx` never run.
 * Markup matches Next.js:
 *   - `<title>` is `500: Internal Server Error` (no trailing period)
 *   - `<h2>` is `Internal Server Error.` (trailing period)
 *
 * See:
 *   .nextjs-ref/packages/next/src/pages/_error.tsx
 *   tests/e2e/pages-router-prod/default-error.browser.spec.ts
 */

import { NEVER_CACHE_CONTROL } from "./cache-control.js";

const STATUS = 500;
const TITLE = "Internal Server Error";
const MESSAGE = "Internal Server Error.";

const CSS = `body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}`;

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/><title>${STATUS}: ${TITLE}</title><meta name="next-head-count" content="2"/><style data-next-hide-fouc="true">body{display:none}</style><noscript data-next-hide-fouc="true"><style>body{display:block}</style></noscript></head><body><div id="__next"><div style="font-family:system-ui,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;;height:100vh;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center"><div style="line-height:48px"><style>${CSS}</style><h1 class="next-error-h1" style="display:inline-block;margin:0 20px 0 0;padding-right:23px;font-size:24px;font-weight:500;vertical-align:top">${STATUS}</h1><div style="display:inline-block"><h2 style="font-size:14px;font-weight:400;line-height:28px">${MESSAGE}</h2></div></div></div></div></body></html>`;

/**
 * Build the Next.js-compatible default 500 HTML response.
 * Content-type is `text/html; charset=utf-8`. Cache-Control matches the
 * App Router global-error path so intermediaries do not store the crash page.
 */
export function buildDefaultErrorPageResponse(): Response {
  return new Response(HTML, {
    status: STATUS,
    headers: {
      "Cache-Control": NEVER_CACHE_CONTROL,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/** Exported for tests / callers that need the raw HTML body. */
export const DEFAULT_ERROR_PAGE_HTML = HTML;
