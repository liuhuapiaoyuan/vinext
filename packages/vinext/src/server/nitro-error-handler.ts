/**
 * Nitro last-resort error handler.
 *
 * Replaces Nitro's default production JSON
 * `{ "error": true, "status": 500, "unhandled": true }` with Next.js's
 * default `_error` HTML page. vinext installs this via `nitro.setup`
 * when the app has not set its own `errorHandler`.
 *
 * Keep this file free of Nitro imports so Cloudflare-only installs never
 * evaluate `nitro` — Nitro loads it by filesystem path at bundle time.
 */

import { buildDefaultErrorPageResponse } from "./default-error-html.js";

export default function vinextNitroErrorHandler(): Response {
  return buildDefaultErrorPageResponse();
}
