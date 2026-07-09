import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Plugin } from "vite-plus";
import vinext from "../packages/vinext/src/index.js";
import {
  collectNitroRouteRules,
  convertToNitroPattern,
  generateNitroRouteRules,
  mergeNitroRouteRules,
  type NitroRouteRuleConfig,
} from "../packages/vinext/src/build/nitro-route-rules.js";

const tempDirs: string[] = [];

type NitroSetupTarget = {
  options: {
    dev?: boolean;
    preset?: string;
    routeRules?: Record<string, NitroRouteRuleConfig>;
    traceDeps?: string[];
    output?: { serverDir?: string };
  };
  hooks?: {
    hook: (name: string, fn: (...args: unknown[]) => void | Promise<void>) => unknown;
  };
  logger?: {
    warn?: (message: string) => void;
    info?: (message: string) => void;
  };
};

type NitroSetupPlugin = {
  nitro?: {
    setup?: (nitro: NitroSetupTarget) => Promise<void> | void;
  };
} & Plugin;

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function isPlugin(plugin: unknown): plugin is Plugin {
  return !!plugin && !Array.isArray(plugin) && typeof plugin === "object" && "name" in plugin;
}

function findNamedPlugin(plugins: ReturnType<typeof vinext>, name: string) {
  return plugins.find((plugin): plugin is Plugin => isPlugin(plugin) && plugin.name === name);
}

function makeTempProject(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "test-project", private: true }, null, 2),
  );
  return root;
}

function writeProjectFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createAppProject(): string {
  const root = makeTempProject("vinext-nitro-app-");
  writeProjectFile(
    root,
    "app/layout.tsx",
    "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  writeProjectFile(
    root,
    "app/page.tsx",
    "export default function Home() { return <div>home</div>; }\n",
  );
  writeProjectFile(
    root,
    "app/blog/[slug]/page.tsx",
    [
      "export const revalidate = 60;",
      "export default async function BlogPage() {",
      "  return <div>blog</div>;",
      "}",
      "",
    ].join("\n"),
  );
  return root;
}

function createPagesProject(): string {
  const root = makeTempProject("vinext-nitro-pages-");
  writeProjectFile(
    root,
    "pages/index.tsx",
    "export default function Home() { return <div>home</div>; }\n",
  );
  writeProjectFile(
    root,
    "pages/blog/[slug].tsx",
    [
      "export async function getStaticProps() {",
      "  return { props: {}, revalidate: 45 };",
      "}",
      "",
      "export default function BlogPage() {",
      "  return <div>blog</div>;",
      "}",
      "",
    ].join("\n"),
  );
  return root;
}

async function initializeNitroPlugins(
  root: string,
  userConfig: Record<string, unknown> = {},
): Promise<{ plugins: ReturnType<typeof vinext>; nitroPlugin: NitroSetupPlugin }> {
  const plugins = vinext({ appDir: root, rsc: false }) as ReturnType<typeof vinext>;
  const configPlugin = findNamedPlugin(plugins, "vinext:config") as Plugin & {
    config?: (
      config: { root: string; plugins: unknown[] },
      env: { command: "build"; mode: string },
    ) => Promise<unknown>;
  };
  if (!configPlugin?.config) {
    throw new Error("vinext:config plugin not found");
  }

  // Passing empty plugins array means hasNitroPlugin=false in the closure,
  // but the nitro.setup hook doesn't gate on hasNitroPlugin (Nitro calls it directly).
  await configPlugin.config(
    { root, plugins: [], ...userConfig },
    { command: "build", mode: "production" },
  );

  const nitroPlugin = findNamedPlugin(plugins, "vinext:nitro-route-rules") as NitroSetupPlugin;
  if (!nitroPlugin?.nitro?.setup) {
    throw new Error("vinext:nitro-route-rules plugin not found");
  }

  return { plugins, nitroPlugin };
}

async function initializeNitroSetupPlugin(
  root: string,
  userConfig: Record<string, unknown> = {},
): Promise<NitroSetupPlugin> {
  const { nitroPlugin } = await initializeNitroPlugins(root, userConfig);
  return nitroPlugin;
}

describe("convertToNitroPattern", () => {
  it("leaves static routes unchanged", () => {
    expect(convertToNitroPattern("/")).toBe("/");
    expect(convertToNitroPattern("/about")).toBe("/about");
    expect(convertToNitroPattern("/blog/featured")).toBe("/blog/featured");
  });

  it("converts :param segments to /* single-segment wildcards", () => {
    expect(convertToNitroPattern("/blog/:slug")).toBe("/blog/*");
    expect(convertToNitroPattern("/users/:id/posts")).toBe("/users/*/posts");
  });

  it("converts :param+ catch-all segments to /** globs", () => {
    expect(convertToNitroPattern("/docs/:slug+")).toBe("/docs/**");
  });

  it("converts :param* optional catch-all segments to /** globs", () => {
    expect(convertToNitroPattern("/docs/:slug*")).toBe("/docs/**");
  });

  it("handles consecutive dynamic segments correctly", () => {
    expect(convertToNitroPattern("/:a/:b")).toBe("/*/*");
    expect(convertToNitroPattern("/blog/:year/:month/:slug")).toBe("/blog/*/*/*");
    expect(convertToNitroPattern("/api/:version/:resource/:id")).toBe("/api/*/*/*");
  });

  it("distinguishes single-segment params from catch-all params", () => {
    // Mixed: single segment followed by catch-all
    expect(convertToNitroPattern("/blog/:year/:slug+")).toBe("/blog/*/**");
    // Optional catch-all behaves like catch-all
    expect(convertToNitroPattern("/shop/:category/:id*")).toBe("/shop/*/**");
  });
});

describe("generateNitroRouteRules", () => {
  it("returns empty object when no ISR routes exist", () => {
    const rows = [
      { pattern: "/", type: "static" as const },
      { pattern: "/about", type: "ssr" as const },
      { pattern: "/api/data", type: "api" as const },
    ];

    expect(generateNitroRouteRules(rows)).toEqual({});
  });

  it("converts dynamic segments to Nitro glob patterns", () => {
    const rows = [
      { pattern: "/", type: "isr" as const, revalidate: 120 },
      { pattern: "/blog/:slug", type: "isr" as const, revalidate: 60 },
      { pattern: "/docs/:slug+", type: "isr" as const, revalidate: 30 },
      { pattern: "/products/:id*", type: "isr" as const, revalidate: 15 },
    ];

    expect(generateNitroRouteRules(rows)).toEqual({
      "/": { swr: 120 },
      "/blog/*": { swr: 60 },
      "/docs/**": { swr: 30 },
      "/products/**": { swr: 15 },
    });
  });

  // In practice, buildReportRows never produces an ISR row with Infinity
  // (classifyAppRoute maps Infinity to "static"), but generateNitroRouteRules
  // should handle it defensively since Infinity serializes to null in JSON.
  it("ignores Infinity revalidate defensively", () => {
    const rows = [
      { pattern: "/isr", type: "isr" as const, revalidate: Infinity },
      { pattern: "/valid", type: "isr" as const, revalidate: 10 },
    ];

    expect(generateNitroRouteRules(rows)).toEqual({
      "/valid": { swr: 10 },
    });
  });
});

describe("mergeNitroRouteRules", () => {
  it("merges generated swr into existing exact rules with unrelated fields", () => {
    const result = mergeNitroRouteRules(
      {
        "/blog/**": { headers: { "x-test": "1" } },
      },
      {
        "/blog/**": { swr: 60 },
      },
    );

    expect(result.routeRules).toEqual({
      "/blog/**": {
        headers: { "x-test": "1" },
        swr: 60,
      },
    });
    expect(result.skippedRoutes).toEqual([]);
  });

  it("does not override explicit user cache rules on exact collisions", () => {
    const result = mergeNitroRouteRules(
      {
        "/blog/**": { cache: { swr: true, maxAge: 600 } },
      },
      {
        "/blog/**": { swr: 60 },
      },
    );

    expect(result.routeRules).toEqual({
      "/blog/**": { cache: { swr: true, maxAge: 600 } },
    });
    expect(result.skippedRoutes).toEqual(["/blog/**"]);
  });
});

describe("collectNitroRouteRules", () => {
  it("collects App Router ISR rules from scanned routes", async () => {
    const root = createAppProject();

    const routeRules = await collectNitroRouteRules({
      appDir: path.join(root, "app"),
      pagesDir: null,
      pageExtensions: ["tsx", "ts", "jsx", "js"],
    });

    expect(routeRules).toEqual({
      "/blog/*": { swr: 60 },
    });
  });

  it("collects Pages Router ISR rules from scanned routes", async () => {
    const root = createPagesProject();

    const routeRules = await collectNitroRouteRules({
      appDir: null,
      pagesDir: path.join(root, "pages"),
      pageExtensions: ["tsx", "ts", "jsx", "js"],
    });

    expect(routeRules).toEqual({
      "/blog/*": { swr: 45 },
    });
  });
});

describe("vinext Nitro setup integration", () => {
  it("propagates server externals to Nitro traceDeps", async () => {
    const root = createAppProject();
    writeProjectFile(
      root,
      "next.config.mjs",
      `export default { serverExternalPackages: ["custom-apm", "@scope/traced"] };\n`,
    );
    const nitroPlugin = await initializeNitroSetupPlugin(root);
    const nitro = {
      options: {
        dev: false,
        routeRules: {},
        traceDeps: ["existing-trace", "pg"],
      },
    };

    await nitroPlugin.nitro!.setup!(nitro);

    expect(nitro.options.traceDeps?.slice(0, 2)).toEqual(["existing-trace", "pg"]);
    expect(nitro.options.traceDeps).toContain("pg");
    expect(nitro.options.traceDeps).toContain("mongodb");
    expect(nitro.options.traceDeps).toContain("custom-apm");
    expect(nitro.options.traceDeps).toContain("@scope/traced");
    // Native/wasm OG-image deps stay external in the RSC environment and
    // must be traced into .output when used.
    expect(nitro.options.traceDeps).toContain("satori");
    expect(nitro.options.traceDeps).toContain("@resvg/resvg-js");
    expect(nitro.options.traceDeps).toContain("yoga-wasm-web");
    expect(new Set(nitro.options.traceDeps).size).toBe(nitro.options.traceDeps?.length);
  });

  it("copies bundler externals into Nitro's server dir on the compiled hook", async () => {
    const root = createAppProject();
    writeProjectFile(
      root,
      "node_modules/dep-a/package.json",
      JSON.stringify({
        name: "dep-a",
        version: "1.0.0",
        main: "index.js",
        dependencies: { "dep-b": "1.0.0" },
      }),
    );
    writeProjectFile(root, "node_modules/dep-a/index.js", "module.exports = {};\n");
    writeProjectFile(
      root,
      "node_modules/dep-b/package.json",
      JSON.stringify({ name: "dep-b", version: "1.0.0", main: "index.js" }),
    );
    writeProjectFile(root, "node_modules/dep-b/index.js", "module.exports = {};\n");

    const { plugins, nitroPlugin } = await initializeNitroPlugins(root);

    // Simulate the RSC service build leaving dep-a (and an uninstalled
    // package) external — this is what populates the shared collector.
    const manifestPlugin = findNamedPlugin(
      plugins,
      "vinext:server-externals-manifest",
    ) as Plugin & {
      writeBundle?: { handler: (...args: unknown[]) => void };
    };
    if (!manifestPlugin?.writeBundle?.handler) {
      throw new Error("vinext:server-externals-manifest plugin not found");
    }
    const serviceDir = path.join(root, "node_modules", ".nitro", "vite", "services", "rsc");
    fs.mkdirSync(serviceDir, { recursive: true });
    manifestPlugin.writeBundle.handler.call(
      { environment: { name: "rsc" } },
      { dir: serviceDir },
      {
        "index.js": {
          type: "chunk",
          imports: ["dep-a", "ghost-pkg"],
          dynamicImports: [],
        },
      },
    );

    const registered: Array<[string, (...args: unknown[]) => void | Promise<void>]> = [];
    const warn = vi.fn();
    const serverDir = path.join(root, ".output", "server");
    const nitro: NitroSetupTarget = {
      options: { dev: false, routeRules: {}, output: { serverDir } },
      hooks: {
        hook: (name, fn) => {
          registered.push([name, fn]);
        },
      },
      logger: { warn, info: vi.fn() },
    };

    await nitroPlugin.nitro!.setup!(nitro);

    const compiledHooks = registered.filter(([name]) => name === "compiled");
    expect(compiledHooks).toHaveLength(1);
    await compiledHooks[0]![1]();

    // Whole packages plus transitive runtime deps land in .output/server/node_modules.
    expect(fs.existsSync(path.join(serverDir, "node_modules", "dep-a", "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(serverDir, "node_modules", "dep-a", "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(serverDir, "node_modules", "dep-b", "index.js"))).toBe(true);
    // Unresolvable manifest entries are skipped with a warning, not a crash.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost-pkg"));
  });

  it("copies serverExternalPackages even when writeBundle only sees absolute paths", async () => {
    // Regression: Nitro/nf3 leaves a partial @opentelemetry tree (package.json
    // + build/esm only). The compiled hook must overlay the full package from
    // the app's node_modules using serverExternalPackages / traceDeps, even if
    // chunk.imports were rewritten to absolute paths that the collector used
    // to ignore.
    const root = createAppProject();
    writeProjectFile(
      root,
      "next.config.mjs",
      `export default { serverExternalPackages: ["@scope/otel-exporter"] };\n`,
    );
    writeProjectFile(
      root,
      "node_modules/@scope/otel-exporter/package.json",
      JSON.stringify({
        name: "@scope/otel-exporter",
        version: "1.0.0",
        main: "build/src/index.js",
        module: "build/esm/index.js",
      }),
    );
    writeProjectFile(
      root,
      "node_modules/@scope/otel-exporter/build/src/index.js",
      "module.exports = {};\n",
    );
    writeProjectFile(root, "node_modules/@scope/otel-exporter/build/esm/index.js", "export {};\n");

    const { plugins, nitroPlugin } = await initializeNitroPlugins(root);

    const manifestPlugin = findNamedPlugin(
      plugins,
      "vinext:server-externals-manifest",
    ) as Plugin & {
      writeBundle?: { handler: (...args: unknown[]) => void };
    };
    if (!manifestPlugin?.writeBundle?.handler) {
      throw new Error("vinext:server-externals-manifest plugin not found");
    }
    const serviceDir = path.join(root, "node_modules", ".nitro", "vite", "services", "rsc");
    fs.mkdirSync(serviceDir, { recursive: true });
    // Absolute path form — previously dropped by packageNameFromSpecifier.
    const absImport = path.join(
      root,
      "node_modules",
      "@scope",
      "otel-exporter",
      "build",
      "src",
      "index.js",
    );
    manifestPlugin.writeBundle.handler.call(
      { environment: { name: "rsc" } },
      { dir: serviceDir },
      {
        "index.js": {
          type: "chunk",
          imports: [absImport],
          dynamicImports: [],
        },
      },
    );

    // Simulate nf3's partial copy: package.json + esm only (main file missing).
    const serverDir = path.join(root, ".output", "server");
    const partialPkg = path.join(serverDir, "node_modules", "@scope", "otel-exporter");
    writeProjectFile(
      partialPkg,
      "package.json",
      JSON.stringify({
        name: "@scope/otel-exporter",
        version: "1.0.0",
        main: "build/src/index.js",
        module: "build/esm/index.js",
      }),
    );
    writeProjectFile(partialPkg, "build/esm/index.js", "export {};\n");

    const registered: Array<[string, (...args: unknown[]) => void | Promise<void>]> = [];
    const nitro: NitroSetupTarget = {
      options: { dev: false, routeRules: {}, output: { serverDir } },
      hooks: {
        hook: (name, fn) => {
          registered.push([name, fn]);
        },
      },
      logger: { warn: vi.fn(), info: vi.fn() },
    };

    await nitroPlugin.nitro!.setup!(nitro);
    const compiledHooks = registered.filter(([name]) => name === "compiled");
    expect(compiledHooks).toHaveLength(1);
    await compiledHooks[0]![1]();

    expect(fs.existsSync(path.join(partialPkg, "build", "src", "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(partialPkg, "build", "esm", "index.js"))).toBe(true);
  });

  it("copies user serverExternalPackages when writeBundle collector is empty", async () => {
    const root = createAppProject();
    writeProjectFile(
      root,
      "next.config.mjs",
      `export default { serverExternalPackages: ["custom-otel"] };\n`,
    );
    writeProjectFile(
      root,
      "node_modules/custom-otel/package.json",
      JSON.stringify({ name: "custom-otel", version: "1.0.0", main: "index.js" }),
    );
    writeProjectFile(root, "node_modules/custom-otel/index.js", "module.exports = {};\n");

    const nitroPlugin = await initializeNitroSetupPlugin(root);
    const registered: Array<[string, (...args: unknown[]) => void | Promise<void>]> = [];
    const serverDir = path.join(root, ".output", "server");
    const nitro: NitroSetupTarget = {
      options: { dev: false, routeRules: {}, output: { serverDir } },
      hooks: {
        hook: (name, fn) => {
          registered.push([name, fn]);
        },
      },
      logger: { warn: vi.fn(), info: vi.fn() },
    };

    await nitroPlugin.nitro!.setup!(nitro);
    // No writeBundle simulation — collector stays empty; user-declared
    // serverExternalPackages must still drive the whole-package copy.
    const compiledHooks = registered.filter(([name]) => name === "compiled");
    expect(compiledHooks).toHaveLength(1);
    await compiledHooks[0]![1]();

    expect(fs.existsSync(path.join(serverDir, "node_modules", "custom-otel", "index.js"))).toBe(
      true,
    );
  });

  it("heals nf3 partial packages already present in .output without user seeds", async () => {
    // Even if the bundler collector and next.config seeds miss a package,
    // anything nf3 already dropped into .output/server/node_modules must be
    // replaced with a full tree from the app install (OTel main-file gap).
    const root = createAppProject();
    writeProjectFile(
      root,
      "node_modules/@scope/partial-otel/package.json",
      JSON.stringify({
        name: "@scope/partial-otel",
        version: "1.0.0",
        main: "build/src/index.js",
        module: "build/esm/index.js",
      }),
    );
    writeProjectFile(
      root,
      "node_modules/@scope/partial-otel/build/src/index.js",
      "module.exports = {};\n",
    );
    writeProjectFile(root, "node_modules/@scope/partial-otel/build/esm/index.js", "export {};\n");

    const nitroPlugin = await initializeNitroSetupPlugin(root);
    const serverDir = path.join(root, ".output", "server");
    const partialPkg = path.join(serverDir, "node_modules", "@scope", "partial-otel");
    writeProjectFile(
      partialPkg,
      "package.json",
      JSON.stringify({
        name: "@scope/partial-otel",
        version: "1.0.0",
        main: "build/src/index.js",
        module: "build/esm/index.js",
      }),
    );
    writeProjectFile(partialPkg, "build/esm/index.js", "export {};\n");

    const registered: Array<[string, (...args: unknown[]) => void | Promise<void>]> = [];
    const nitro: NitroSetupTarget = {
      options: { dev: false, routeRules: {}, output: { serverDir } },
      hooks: {
        hook: (name, fn) => {
          registered.push([name, fn]);
        },
      },
      logger: { warn: vi.fn(), info: vi.fn() },
    };

    await nitroPlugin.nitro!.setup!(nitro);
    await registered.filter(([name]) => name === "compiled")[0]![1]();

    expect(fs.existsSync(path.join(partialPkg, "build", "src", "index.js"))).toBe(true);
  });

  it("does not register the compiled copy hook in Nitro dev", async () => {
    const root = createAppProject();
    const nitroPlugin = await initializeNitroSetupPlugin(root);
    const registered: string[] = [];
    const nitro: NitroSetupTarget = {
      options: { dev: true, routeRules: {} },
      hooks: {
        hook: (name) => {
          registered.push(name);
        },
      },
    };

    await nitroPlugin.nitro!.setup!(nitro);

    expect(registered).toEqual([]);
  });

  it("propagates user vite ssr.external entries to Nitro traceDeps as package names", async () => {
    const root = createAppProject();
    const nitroPlugin = await initializeNitroSetupPlugin(root, {
      ssr: { external: ["custom-native", "@scope/pkg/subpath", "lodash/merge"] },
    });
    const nitro: NitroSetupTarget = {
      options: {
        dev: false,
        routeRules: {},
      },
    };

    await nitroPlugin.nitro!.setup!(nitro);

    expect(nitro.options.traceDeps).toContain("custom-native");
    // Subpath specifiers are reduced to package names — Nitro matches
    // traceDeps against resolved node_modules paths.
    expect(nitro.options.traceDeps).toContain("@scope/pkg");
    expect(nitro.options.traceDeps).toContain("lodash");
    expect(nitro.options.traceDeps).not.toContain("lodash/merge");
  });

  it("merges generated route rules into Nitro before build", async () => {
    const root = createAppProject();
    const nitroPlugin = await initializeNitroSetupPlugin(root);
    const warn = vi.fn();
    const nitro = {
      options: {
        dev: false,
        routeRules: {
          "/blog/*": { headers: { "x-test": "1" } },
        },
      },
      logger: { warn },
    };

    await nitroPlugin.nitro!.setup!(nitro);

    expect(nitro.options.routeRules).toEqual({
      "/blog/*": {
        headers: { "x-test": "1" },
        swr: 60,
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps user cache rules intact and warns once", async () => {
    const root = createAppProject();
    const nitroPlugin = await initializeNitroSetupPlugin(root);
    const warn = vi.fn();
    const nitro = {
      options: {
        dev: false,
        routeRules: {
          "/blog/*": { swr: 600 },
        },
      },
      logger: { warn },
    };

    await nitroPlugin.nitro!.setup!(nitro);

    expect(nitro.options.routeRules).toEqual({
      "/blog/*": { swr: 600 },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("/blog/*");
  });

  it("propagates server externals but skips route rule generation during Nitro dev", async () => {
    const root = createAppProject();
    const nitroPlugin = await initializeNitroSetupPlugin(root);
    const nitro = {
      options: {
        dev: true,
        routeRules: {},
        traceDeps: ["existing-trace"],
      },
    };

    await nitroPlugin.nitro!.setup!(nitro);

    expect(nitro.options.routeRules).toEqual({});
    expect(nitro.options.traceDeps?.slice(0, 1)).toEqual(["existing-trace"]);
    expect(nitro.options.traceDeps).toContain("pg");
    expect(nitro.options.traceDeps).toContain("mongodb");
  });
});
