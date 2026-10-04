import { describe, expect, it, vi } from "vitest";
import { createDevWatchEventCoalescer } from "../packages/vinext/src/server/dev-watch-coalescer.js";

describe("createDevWatchEventCoalescer", () => {
  it("keeps only the final event for a path and flushes paths together", () => {
    vi.useFakeTimers();
    try {
      const onFlush = vi.fn();
      const coalescer = createDevWatchEventCoalescer(onFlush, {
        delayMs: 75,
        normalize: (filePath) => filePath.replaceAll("\\", "/").toLowerCase(),
      });

      coalescer.enqueue("unlink", "C:\\project\\app\\page.tsx");
      coalescer.enqueue("add", "c:/project/app/page.tsx");
      coalescer.enqueue("add", "c:/project/app/layout.tsx");

      expect(onFlush).not.toHaveBeenCalled();
      vi.advanceTimersByTime(75);

      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith([
        { filePath: "c:/project/app/page.tsx", kind: "add" },
        { filePath: "c:/project/app/layout.tsx", kind: "add" },
      ]);
      coalescer.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not flush queued events after disposal", () => {
    vi.useFakeTimers();
    try {
      const onFlush = vi.fn();
      const coalescer = createDevWatchEventCoalescer(onFlush, { delayMs: 75 });
      coalescer.enqueue("add", "/project/app/page.tsx");
      coalescer.dispose();
      vi.advanceTimersByTime(75);

      expect(onFlush).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a bounded window even when events keep arriving", () => {
    vi.useFakeTimers();
    try {
      const onFlush = vi.fn();
      const coalescer = createDevWatchEventCoalescer(onFlush, { delayMs: 75 });
      coalescer.enqueue("unlink", "/project/app/page.tsx");
      vi.advanceTimersByTime(60);
      coalescer.enqueue("add", "/project/app/page.tsx");
      vi.advanceTimersByTime(14);
      expect(onFlush).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith([{ filePath: "/project/app/page.tsx", kind: "add" }]);
      coalescer.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
