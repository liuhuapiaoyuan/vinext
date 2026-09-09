import { describe, it, expect, afterEach } from "vite-plus/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { resolveConfig } from "vite";
import vinext from "../packages/vinext/src/index.js";
import { toSlash } from "pathslash";
import {
  getVinextDevWatchIgnored,
  shouldIgnoreDevWatchFile,
  VINEXT_DEV_WATCH_IGNORE_GLOBS,
} from "../packages/vinext/src/server/dev-watch-ignore.js";

function ignoredFns(ignored: unknown): Array<(file: string) => boolean> {
  const list = Array.isArray(ignored) ? ignored : ignored == null ? [] : [ignored];
  return list.filter((entry): entry is (file: string) => boolean => typeof entry === "function");
}

function isIgnored(root: string, sourceDir: string, file: string): boolean {
  return shouldIgnoreDevWatchFile(file, { root, sourceDir });
}

describe("shouldIgnoreDevWatchFile", () => {
  const root = toSlash(path.resolve("/tmp/vinext-watch-root"));
  const srcDir = toSlash(path.join(root, "src"));

  it("never ignores the Vite root directory itself", () => {
    expect(isIgnored(root, srcDir, root)).toBe(false);
  });

  it("does not ignore src-tree files when the app lives under src/", () => {
    expect(isIgnored(root, srcDir, path.join(srcDir, "app/page.tsx"))).toBe(false);
    expect(isIgnored(root, srcDir, path.join(srcDir, "middleware.ts"))).toBe(false);
  });

  it("does not ignore public files or root config/env files", () => {
    expect(isIgnored(root, srcDir, path.join(root, "public/logo.svg"))).toBe(false);
    expect(isIgnored(root, srcDir, path.join(root, "vite.config.ts"))).toBe(false);
    expect(isIgnored(root, srcDir, path.join(root, "next.config.ts"))).toBe(false);
    expect(isIgnored(root, srcDir, path.join(root, ".env.local"))).toBe(false);
  });

  it("ignores tsconfig.json, including Windows-separator paths", () => {
    expect(isIgnored(root, srcDir, path.join(root, "tsconfig.json"))).toBe(true);
    expect(
      shouldIgnoreDevWatchFile(`${root.replaceAll("/", "\\")}\\tsconfig.json`, {
        root,
        sourceDir: srcDir,
      }),
    ).toBe(true);
  });

  it("ignores non-source files at the Vite root in a src/ layout", () => {
    expect(isIgnored(root, srcDir, path.join(root, "package.json"))).toBe(true);
    expect(isIgnored(root, srcDir, path.join(root, "README.md"))).toBe(true);
    expect(isIgnored(root, srcDir, path.join(root, "scripts/plugin-init.ts"))).toBe(true);
  });

  it("still watches workspace-package sources outside the Vite root", () => {
    expect(isIgnored(root, srcDir, path.resolve(root, "../packages/ui/src/button.tsx"))).toBe(
      false,
    );
  });

  it("ignores tsconfig.json even when it lives outside the Vite root", () => {
    expect(isIgnored(root, srcDir, path.resolve(root, "../packages/ui/tsconfig.json"))).toBe(true);
  });

  it("does not extra-ignore app/ sources when they live at the Vite root", () => {
    expect(isIgnored(root, root, path.join(root, "app/page.tsx"))).toBe(false);
    expect(isIgnored(root, root, path.join(root, "lib/utils.ts"))).toBe(false);
    expect(isIgnored(root, root, path.join(root, "tsconfig.json"))).toBe(true);
  });
});

describe("getVinextDevWatchIgnored", () => {
  it("includes the generated-output globs and a path function", () => {
    const ignored = getVinextDevWatchIgnored({
      root: "/tmp/root",
      sourceDir: "/tmp/root/src",
    });
    for (const glob of VINEXT_DEV_WATCH_IGNORE_GLOBS) {
      expect(ignored).toContain(glob);
    }
    expect(ignored.some((entry) => typeof entry === "function")).toBe(true);
  });
});

describe("vinext dev watch ignore policy", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      tmpDir = undefined;
    }
  });

  it("injects ignore rules so src-layout tsconfig.json is ignored during serve", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vinext-watch-ignore-"));
    await fs.mkdir(path.join(tmpDir, "src", "app"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "src", "app", "layout.tsx"),
      "export default function Layout({ children }: { children: React.ReactNode }) { return children; }",
    );
    await fs.writeFile(
      path.join(tmpDir, "src", "app", "page.tsx"),
      "export default function Page() { return <p>hi</p>; }",
    );
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({ type: "module" }));
    await fs.writeFile(path.join(tmpDir, "tsconfig.json"), "{}");
    await fs.writeFile(path.join(tmpDir, "next.config.ts"), "export default {};");
    await fs.writeFile(path.join(tmpDir, "vite.config.ts"), "export default {};");

    const config = await resolveConfig(
      {
        root: tmpDir,
        configFile: path.join(tmpDir, "vite.config.ts"),
        plugins: [vinext()],
      },
      "serve",
    );

    const ignored = config.server.watch?.ignored;
    expect(ignored).toBeDefined();
    for (const glob of VINEXT_DEV_WATCH_IGNORE_GLOBS) {
      expect(Array.isArray(ignored) ? ignored : [ignored]).toContain(glob);
    }

    const tsconfigPath = toSlash(path.join(tmpDir, "tsconfig.json"));
    const srcPage = toSlash(path.join(tmpDir, "src", "app", "page.tsx"));
    expect(ignoredFns(ignored).some((fn) => fn(tsconfigPath))).toBe(true);
    expect(ignoredFns(ignored).some((fn) => fn(srcPage))).toBe(false);
  });

  it("preserves watch: null instead of re-enabling the watcher", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vinext-watch-null-"));
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "app", "layout.tsx"),
      "export default function Layout({ children }: { children: React.ReactNode }) { return children; }",
    );
    await fs.writeFile(
      path.join(tmpDir, "app", "page.tsx"),
      "export default function Page() { return <p>hi</p>; }",
    );
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({ type: "module" }));
    await fs.writeFile(path.join(tmpDir, "vite.config.ts"), "export default {};");

    const config = await resolveConfig(
      {
        root: tmpDir,
        configFile: path.join(tmpDir, "vite.config.ts"),
        server: { watch: null },
        plugins: [vinext()],
      },
      "serve",
    );

    expect(config.server.watch).toBeNull();
  });
});
