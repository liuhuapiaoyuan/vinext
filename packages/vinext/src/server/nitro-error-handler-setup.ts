/**
 * Install vinext's default Nitro `errorHandler` unless the app already
 * configured one. Nitro's production default serializes unhandled errors as
 * `{ error: true, status: 500, unhandled: true }`; vinext substitutes the
 * Next.js `_error` HTML page instead.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { toSlash } from "pathslash";

export type NitroErrorHandlerOptions = {
  errorHandler?: unknown;
};

/**
 * True when the app left `errorHandler` unset so vinext may install its
 * built-in page. Any non-empty string, array, or function is treated as
 * user-owned and left alone.
 */
export function shouldApplyVinextNitroErrorHandler(errorHandler: unknown): boolean {
  if (errorHandler == null || errorHandler === false) return true;
  if (typeof errorHandler === "string") return errorHandler.trim() === "";
  if (Array.isArray(errorHandler)) return errorHandler.length === 0;
  return false;
}

export function resolveVinextNitroErrorHandlerPath(): string {
  const jsPath = fileURLToPath(new URL("./nitro-error-handler.js", import.meta.url));
  if (fs.existsSync(jsPath)) return toSlash(jsPath);
  const tsPath = jsPath.replace(/\.js$/i, ".ts");
  if (fs.existsSync(tsPath)) return toSlash(tsPath);
  return toSlash(jsPath);
}

/** Mutates `options.errorHandler` when the app has not set one. */
export function applyVinextNitroErrorHandler(options: NitroErrorHandlerOptions): boolean {
  if (!shouldApplyVinextNitroErrorHandler(options.errorHandler)) return false;
  options.errorHandler = resolveVinextNitroErrorHandlerPath();
  return true;
}
