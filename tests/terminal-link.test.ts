import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  formatTerminalLocationLabel,
  locationToTerminalFileUrl,
  needsOsc8FileLink,
  shouldEmitDevFileHyperlinks,
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

  it("encodes parentheses in editor URLs for route groups", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vinext-terminal-link-"));
    try {
      withEnvVar("NODE_ENV", "development", () => {
        const location = "src/app/admin/(system)/notification/my-messages/actions.ts:37:14";
        const url = locationToTerminalFileUrl(location, root)!;
        expect(url).toMatch(/^vscode:\/\/file\//);
        expect(url).toContain("%28system%29");
        expect(url.endsWith(":37:14")).toBe(true);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("encodes square brackets in file URLs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vinext-terminal-link-"));
    try {
      withEnvVar("NODE_ENV", "development", () => {
        const location = "app/blog/[slug]/page.tsx:3:1";
        const url = locationToTerminalFileUrl(location, root)!;
        expect(url).toContain("%5Bslug%5D");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("wraps text in OSC 8 sequences when hyperlinks are supported", () => {
    withEnvVar("FORCE_HYPERLINK", "1", () => {
      expect(terminalHyperlink("app/page.tsx", "vscode://file/tmp/app/page.tsx:1:1")).toBe(
        "\x1b]8;;vscode://file/tmp/app/page.tsx:1:1\x1b\\app/page.tsx\x1b]8;;\x1b\\",
      );
    });
  });

  it("returns plain text when hyperlinks are disabled", () => {
    withEnvVar("FORCE_HYPERLINK", "0", () => {
      expect(terminalHyperlink("app/page.tsx", "vscode://file/tmp/app/page.tsx:1:1")).toBe(
        "app/page.tsx",
      );
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

  it("emits dev hyperlinks under turbo even when stdout is piped", () => {
    withEnvVar("NODE_ENV", "development", () => {
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
      Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });
      try {
        expect(shouldEmitDevFileHyperlinks()).toBe(true);
      } finally {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
        delete (process.stderr as { isTTY?: boolean }).isTTY;
      }
    });
  });

  it("uses OSC 8 for paths with parentheses or brackets", () => {
    expect(needsOsc8FileLink("app/actions.ts:2:3")).toBe(false);
    expect(needsOsc8FileLink("app/(dashboard)/page.tsx:1:1")).toBe(true);
    expect(needsOsc8FileLink("app/blog/[slug]/page.tsx:1:1")).toBe(true);
  });

  it("wraps all dev locations in OSC 8 with plain link text", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vinext-terminal-link-"));
    try {
      withEnvVar("FORCE_HYPERLINK", "1", () => {
        const location = "app/actions.ts:2:3";
        const label = formatTerminalLocationLabel(location, root);
        expect(label).toContain("\x1b]8;;");
        expect(label).not.toContain("\x1b[34m");
        expect(label).toContain(location);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses plain OSC 8 text for route group paths", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vinext-terminal-link-"));
    try {
      withEnvVar("FORCE_HYPERLINK", "1", () => {
        withEnvVar("NODE_ENV", "development", () => {
          const location = "app/(dashboard)/actions.ts:12:14";
          const label = formatTerminalLocationLabel(location, root);
          expect(label).toContain("\x1b]8;;vscode://file/");
          expect(label).not.toContain("\x1b[34m");
          expect(label).toContain(location);
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
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
