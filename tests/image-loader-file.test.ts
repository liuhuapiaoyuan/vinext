import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Plugin, PluginOption } from "vite-plus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import vinext from "../packages/vinext/src/index.js";

function isPlugin(plugin: PluginOption): plugin is Plugin {
  return !!plugin && !Array.isArray(plugin) && typeof plugin === "object" && "name" in plugin;
}

async function collectPlugins(plugins: PluginOption[]): Promise<Plugin[]> {
  const collected: Plugin[] = [];
  for (const plugin of plugins) {
    const resolved = await plugin;
    if (!resolved) continue;
    if (Array.isArray(resolved)) {
      collected.push(...(await collectPlugins(resolved)));
    } else if (isPlugin(resolved)) {
      collected.push(resolved);
    }
  }
  return collected;
}

async function findConfigPlugin(plugins: ReturnType<typeof vinext>) {
  const collected = await collectPlugins(plugins);
  const plugin = collected.find((p) => p.name === "vinext:config");
  if (!plugin || !("config" in plugin)) {
    throw new Error("vinext:config plugin not found");
  }
  return plugin as {
    config?: (
      config: { root: string },
      env: { command: "serve"; mode: string },
    ) => Promise<{ resolve?: { alias?: Record<string, string> } }>;
  };
}

describe("images.loaderFile runtime wiring", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-image-loader-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("default-image-loader routes through /_next/image", async () => {
    const loader = await import("../packages/vinext/src/shims/default-image-loader.js");
    expect(loader.default({ src: "/hero.jpg", width: 640, quality: 80 })).toBe(
      "/_next/image?url=%2Fhero.jpg&w=640&q=80",
    );
  });

  it("vinext:config aliases default-image-loader to loaderFile", async () => {
    const loaderPath = path.join(tmpDir, "my-loader.js");
    fs.writeFileSync(loaderPath, "export default function myLoader() { return ''; }\n");
    fs.mkdirSync(path.join(tmpDir, "pages"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "pages", "index.tsx"),
      "export default function Page() { return null; }\n",
    );

    const plugins = vinext({
      disableAppRouter: true,
      nextConfig: {
        images: {
          loader: "custom",
          loaderFile: "./my-loader.js",
        },
      },
    });
    const configPlugin = await findConfigPlugin(plugins);
    const resolved = await configPlugin.config?.(
      { root: tmpDir },
      { command: "serve", mode: "development" },
    );

    const alias = resolved?.resolve?.alias as Record<string, string> | undefined;
    const loaderAlias = Object.entries(alias ?? {}).find(([, value]) => value === loaderPath);
    expect(loaderAlias?.[0].replace(/\\/g, "/")).toContain("default-image-loader");
  });

  it("getImageProps uses images.loaderFile when configured", async () => {
    vi.stubEnv("__VINEXT_IMAGE_LOADER_CONFIGURED", "true");
    vi.doMock("../packages/vinext/src/shims/default-image-loader.js", () => ({
      default: ({ src, width, quality }: { src: string; width: number; quality?: number }) =>
        `https://cdn.example.com${src}?w=${width}&q=${quality ?? 75}`,
    }));

    const { getImageProps } = await import("../packages/vinext/src/shims/image.js");
    const result = getImageProps({
      src: "/photo.jpg",
      alt: "Configured loader",
      width: 800,
      height: 600,
    });

    expect(result.props.src).toBe("https://cdn.example.com/photo.jpg?w=800&q=75");
    expect(result.props.src).not.toContain("/_next/image");
  });
});
