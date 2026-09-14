import { describe, expect, it } from "vite-plus/test";
import {
  isBenignBrowserErrorMessage,
  shouldIgnoreWindowErrorEvent,
} from "../packages/vinext/src/client/benign-browser-error.js";

describe("isBenignBrowserErrorMessage", () => {
  it("matches Chromium ResizeObserver loop notifications", () => {
    expect(
      isBenignBrowserErrorMessage("ResizeObserver loop completed with undelivered notifications."),
    ).toBe(true);
  });

  it("matches the older Chrome / Firefox wording", () => {
    expect(isBenignBrowserErrorMessage("ResizeObserver loop limit exceeded")).toBe(true);
  });

  it("rejects real script errors", () => {
    expect(isBenignBrowserErrorMessage("uncaught timer error")).toBe(false);
    expect(isBenignBrowserErrorMessage("Script error.")).toBe(false);
    expect(isBenignBrowserErrorMessage("")).toBe(false);
    expect(isBenignBrowserErrorMessage(undefined)).toBe(false);
    expect(isBenignBrowserErrorMessage(null)).toBe(false);
  });
});

describe("shouldIgnoreWindowErrorEvent", () => {
  // Ported from Next.js: packages/next/src/next-devtools/userspace/app/errors/use-error-handler.ts
  // https://github.com/vercel/next.js/blob/canary/packages/next/src/next-devtools/userspace/app/errors/use-error-handler.ts
  // https://github.com/vercel/next.js/pull/74643
  it("ignores ResizeObserver notifications that only set event.message", () => {
    expect(
      shouldIgnoreWindowErrorEvent({
        error: null,
        message: "ResizeObserver loop completed with undelivered notifications.",
      }),
    ).toBe(true);
  });

  it("ignores ResizeObserver even when an Error instance is attached", () => {
    expect(
      shouldIgnoreWindowErrorEvent({
        error: new Error("ResizeObserver loop limit exceeded"),
        message: "ResizeObserver loop limit exceeded",
      }),
    ).toBe(true);
  });

  it("ignores window.error events that have no error instance", () => {
    expect(shouldIgnoreWindowErrorEvent({ error: null, message: "Script error." })).toBe(true);
    expect(shouldIgnoreWindowErrorEvent({ error: undefined, message: "something else" })).toBe(
      true,
    );
  });

  it("still reports real thrown Errors", () => {
    expect(
      shouldIgnoreWindowErrorEvent({
        error: new Error("uncaught timer error"),
        message: "uncaught timer error",
      }),
    ).toBe(false);
  });

  it("still reports non-Error throws that set event.error", () => {
    expect(
      shouldIgnoreWindowErrorEvent({
        error: "string throw",
        message: "Uncaught string throw",
      }),
    ).toBe(false);
  });
});
