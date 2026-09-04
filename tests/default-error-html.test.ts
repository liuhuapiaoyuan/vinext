/**
 * Default last-resort 500 HTML must match Next.js `pages/_error.tsx`.
 *
 * Ported assertions from:
 *   tests/e2e/pages-router-prod/default-error.browser.spec.ts
 *   .nextjs-ref/packages/next/src/pages/_error.tsx
 */
import fs from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  buildDefaultErrorPageResponse,
  DEFAULT_ERROR_PAGE_HTML,
} from "../packages/vinext/src/server/default-error-html.js";
import vinextNitroErrorHandler from "../packages/vinext/src/server/nitro-error-handler.js";
import {
  applyVinextNitroErrorHandler,
  resolveVinextNitroErrorHandlerPath,
  shouldApplyVinextNitroErrorHandler,
} from "../packages/vinext/src/server/nitro-error-handler-setup.js";

describe("buildDefaultErrorPageResponse", () => {
  it("returns the Next.js default 500 document", async () => {
    const response = buildDefaultErrorPageResponse();
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate",
    );

    const body = await response.text();
    expect(body).toContain("<title>500: Internal Server Error</title>");
    expect(body).toContain("<h2");
    expect(body).toContain("Internal Server Error.");
    expect(body).toContain("next-error-h1");
    expect(body).not.toContain('"unhandled":true');
    expect(body).not.toContain('"error":true');
  });

  it("exposes the raw HTML body", () => {
    expect(DEFAULT_ERROR_PAGE_HTML).toContain("<!DOCTYPE html>");
    expect(DEFAULT_ERROR_PAGE_HTML).toContain("500: Internal Server Error");
  });
});

describe("vinextNitroErrorHandler", () => {
  it("returns the built-in 500 HTML instead of Nitro JSON", async () => {
    const response = vinextNitroErrorHandler();
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Internal Server Error.");
  });
});

describe("applyVinextNitroErrorHandler", () => {
  it("installs the built-in handler when unset", () => {
    const options: { errorHandler?: unknown } = {};
    expect(applyVinextNitroErrorHandler(options)).toBe(true);
    expect(typeof options.errorHandler).toBe("string");
    expect(fs.existsSync(options.errorHandler as string)).toBe(true);
    expect(resolveVinextNitroErrorHandlerPath()).toBe(options.errorHandler);
  });

  it("does not override a user-supplied handler", () => {
    const options = { errorHandler: "./error.ts" };
    expect(applyVinextNitroErrorHandler(options)).toBe(false);
    expect(options.errorHandler).toBe("./error.ts");
  });

  it("treats empty values as unset", () => {
    expect(shouldApplyVinextNitroErrorHandler(undefined)).toBe(true);
    expect(shouldApplyVinextNitroErrorHandler(null)).toBe(true);
    expect(shouldApplyVinextNitroErrorHandler("")).toBe(true);
    expect(shouldApplyVinextNitroErrorHandler([])).toBe(true);
    expect(shouldApplyVinextNitroErrorHandler("./error.ts")).toBe(false);
    expect(shouldApplyVinextNitroErrorHandler(["./error.ts"])).toBe(false);
    expect(shouldApplyVinextNitroErrorHandler(() => undefined)).toBe(false);
  });
});
