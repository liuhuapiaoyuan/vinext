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

async function findImageLoaderPlugin(plugins: ReturnType<typeof vinext>) {
  const collected = await collectPlugins(plugins);
  const plugin = collected.find((p) => p.name === "vinext:image-loader-file");
  if (!plugin?.resolveId || typeof plugin.resolveId === "function") {
    throw new Error("vinext:image-loader-file resolveId hook not found");
  }
  return plugin.resolveId as {
    handler: (id: string, importer?: string) => string | undefined;
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

  it("resolveId redirects default-image-loader imports from next/image shim", async () => {
    const loaderPath = path.join(tmpDir, "my-loader.js");
    fs.writeFileSync(
      loaderPath,
      "export default function myLoader({ src, width }) { return `https://cdn.example/${src}?w=${width}`; }\n",
    );
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

    // Prime _imageLoaderFile by running vinext:config once.
    const configPlugin = (await collectPlugins(plugins)).find((p) => p.name === "vinext:config");
    const configHook = configPlugin?.config;
    const runConfig = (typeof configHook === "function" ? configHook : configHook?.handler) as
      | ((config: { root: string }, env: { command: string; mode: string }) => Promise<unknown>)
      | undefined;
    await runConfig?.({ root: tmpDir }, { command: "serve", mode: "development" });

    const resolveId = await findImageLoaderPlugin(plugins);
    const imageShimPath = path
      .resolve(import.meta.dirname, "../packages/vinext/src/shims/image.tsx")
      .replace(/\\/g, "/");

    expect(resolveId.handler("./default-image-loader.js", imageShimPath)).toBe(loaderPath);
    expect(resolveId.handler(loaderPath.replace(/\\/g, "/"), imageShimPath)).toBeUndefined();
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
