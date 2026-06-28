import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  locationToTerminalFileUrl,
  shouldUseTerminalFormat,
  supportsTerminalHyperlinks,
  terminalHyperlink,
} from "../packages/vinext/src/server/terminal-link.js";
import { withEnvVar } from "./env-test-helpers.js";

describe("terminal-link", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("encodes parentheses in file URLs for OSC 8 hyperlinks", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vinext-terminal-link-"));
    try {
      const location = "app/(dashboard)/actions.ts:12:14";
      const url = locationToTerminalFileUrl(location, root)!;
      expect(url).toContain("%28dashboard%29");
      expect(url.endsWith(":12:14")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("encodes square brackets in file URLs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vinext-terminal-link-"));
    try {
      const location = "app/blog/[slug]/page.tsx:3:1";
      const url = locationToTerminalFileUrl(location, root)!;
      expect(url).toContain("%5Bslug%5D");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("wraps text in OSC 8 sequences when hyperlinks are supported", () => {
    withEnvVar("FORCE_HYPERLINK", "1", () => {
      expect(terminalHyperlink("app/page.tsx", "file:///tmp/app/page.tsx")).toBe(
        "\x1b]8;;file:///tmp/app/page.tsx\x1b\\app/page.tsx\x1b]8;;\x1b\\",
      );
    });
  });

  it("returns plain text when hyperlinks are disabled", () => {
    withEnvVar("FORCE_HYPERLINK", "0", () => {
      expect(terminalHyperlink("app/page.tsx", "file:///tmp/app/page.tsx")).toBe("app/page.tsx");
    });
  });

  it("detects VS Code integrated terminal even when stdout is piped", () => {
    vi.stubEnv("FORCE_COLOR", undefined);
    vi.stubEnv("NO_COLOR", undefined);
    vi.stubEnv("TERM_PROGRAM", "vscode");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });
    try {
      expect(shouldUseTerminalFormat()).toBe(true);
      expect(supportsTerminalHyperlinks()).toBe(true);
    } finally {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
      delete (process.stderr as { isTTY?: boolean }).isTTY;
    }
  });

  it("respects FORCE_COLOR when turbo/pnpm pipes stdout", () => {
    withEnvVar("NO_COLOR", undefined, () => {
      withEnvVar("FORCE_COLOR", "1", () => {
        Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
        try {
          expect(shouldUseTerminalFormat()).toBe(true);
        } finally {
          delete (process.stdout as { isTTY?: boolean }).isTTY;
        }
      });
    });
  });
});
