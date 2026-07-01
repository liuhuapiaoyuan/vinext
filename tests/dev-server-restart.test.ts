import { describe, it, expect, afterEach } from "vite-plus/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { resolveConfig } from "vite";
import vinext from "../packages/vinext/src/index.js";
import {
  applyDevServerRestartPolicy,
  getDevServerRestartWatchPaths,
} from "../packages/vinext/src/server/dev-server-restart.js";
import { normalizePathSeparators } from "../packages/vinext/src/utils/path.js";

type DevServerRestartPolicyConfig = Parameters<typeof applyDevServerRestartPolicy>[0];

function normalizePaths(paths: string[]): string[] {
  return paths.map((entry) => normalizePathSeparators(path.resolve(entry))).sort();
}

describe("getDevServerRestartWatchPaths", () => {
  it("includes only the loaded vite config and next.config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vinext-restart-unit-"));
    try {
      const viteConfig = path.join(root, "vite.config.ts");
      const nextConfig = path.join(root, "next.config.ts");
      await fs.writeFile(viteConfig, "export default {};");
      await fs.writeFile(nextConfig, "export default {};");

      expect(
        normalizePaths(getDevServerRestartWatchPaths({ configFile: viteConfig }, root)),
      ).toEqual(normalizePaths([nextConfig, viteConfig]));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("omits vite config when Vite runs with configFile: false", () => {
    const root = path.join(os.tmpdir(), "vinext-restart-unit-no-vite");
    expect(getDevServerRestartWatchPaths({ configFile: false }, root)).toEqual([]);
  });
});

describe("applyDevServerRestartPolicy", () => {
  it("replaces transitive vite-config imports during dev serve", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vinext-restart-policy-"));
    try {
      const viteConfig = path.join(root, "vite.config.ts");
      await fs.writeFile(viteConfig, "export default {};");
      const config: DevServerRestartPolicyConfig = {
        configFile: viteConfig,
        configFileDependencies: [
          viteConfig,
          path.join(root, "tailwind.config.ts"),
          path.join(root, "postcss.config.js"),
        ],
      };

      applyDevServerRestartPolicy(config, root);

      expect(normalizePaths(config.configFileDependencies)).toEqual(normalizePaths([viteConfig]));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("vinext dev-server restart policy", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      tmpDir = undefined;
    }
  });

  async function writeMinimalApp(root: string) {
    await fs.mkdir(path.join(root, "app"), { recursive: true });
    await fs.writeFile(
      path.join(root, "app", "layout.tsx"),
      "export default function Layout({ children }: { children: React.ReactNode }) { return children; }",
    );
    await fs.writeFile(
      path.join(root, "app", "page.tsx"),
      "export default function Page() { return <p>hi</p>; }",
    );
  }

  it("restricts configFileDependencies while keeping default env restarts", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vinext-restart-int-"));
    await writeMinimalApp(tmpDir);
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({ type: "module" }));
    await fs.writeFile(path.join(tmpDir, "tailwind.config.ts"), "export default { content: [] };");
    await fs.writeFile(path.join(tmpDir, "next.config.ts"), "export default {};");
    await fs.writeFile(path.join(tmpDir, ".env"), "NEXT_PUBLIC_TEST=1");
    await fs.writeFile(
      path.join(tmpDir, "vite.config.ts"),
      ['import tailwind from "./tailwind.config.ts";', "void tailwind;", "export default {};"].join(
        "\n",
      ),
    );

    const viteConfigPath = path.join(tmpDir, "vite.config.ts");
    const nextConfigPath = path.join(tmpDir, "next.config.ts");
    const tailwindConfigPath = path.join(tmpDir, "tailwind.config.ts");

    const config = await resolveConfig(
      {
        root: tmpDir,
        configFile: viteConfigPath,
        plugins: [vinext()],
      },
      "serve",
    );

    expect(config.envDir).not.toBe(false);
    if (config.envDir !== false) {
      expect(normalizePathSeparators(config.envDir)).toBe(normalizePathSeparators(tmpDir));
    }
    expect(normalizePaths(config.configFileDependencies)).toEqual(
      normalizePaths([viteConfigPath, nextConfigPath]),
    );
    expect(config.configFileDependencies).not.toContain(
      normalizePathSeparators(path.resolve(tailwindConfigPath)),
    );
  });
});
