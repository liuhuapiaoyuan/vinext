import { describe, expect, it } from "vite-plus/test";
import {
  createRscHmrAbortTracker,
  isBenignRscHmrAbortError,
} from "../packages/vinext/src/server/app-browser-hmr-abort.js";

describe("isBenignRscHmrAbortError", () => {
  it("accepts DOMException AbortError", () => {
    expect(isBenignRscHmrAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("accepts Error named AbortError", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(isBenignRscHmrAbortError(error)).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isBenignRscHmrAbortError(new Error("boom"))).toBe(false);
    expect(isBenignRscHmrAbortError("string")).toBe(false);
    expect(isBenignRscHmrAbortError(null)).toBe(false);
  });
});

describe("createRscHmrAbortTracker", () => {
  it("aborts the previous signal when begin() is called again", () => {
    const tracker = createRscHmrAbortTracker();
    const first = tracker.begin();
    expect(first.aborted).toBe(false);

    const second = tracker.begin();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
  });

  it("clearIfCurrent only clears the active signal", () => {
    const tracker = createRscHmrAbortTracker();
    const first = tracker.begin();
    tracker.clearIfCurrent(first);

    const second = tracker.begin();
    tracker.clearIfCurrent(first);
    expect(second.aborted).toBe(false);

    const third = tracker.begin();
    expect(second.aborted).toBe(true);
    expect(third.aborted).toBe(false);
  });
});
