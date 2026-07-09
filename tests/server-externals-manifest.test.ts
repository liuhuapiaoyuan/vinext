import { describe, expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createServerExternalsManifestPlugin,
  packageNameFromNodeModulesPath,
  packageNameFromSpecifier,
} from "../packages/vinext/src/plugins/server-externals-manifest.js";

describe("createServerExternalsManifestPlugin", () => {
  it("ignores bundle files, virtual modules, and node builtins when writing the manifest", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-externals-manifest-"));
    const outDir = path.join(tmpDir, "dist", "server");
    fs.mkdirSync(outDir, { recursive: true });

    try {
      const plugin = createServerExternalsManifestPlugin();
      const writeBundle = (plugin.writeBundle as { handler: Function }).handler;

      writeBundle.call(
        { environment: { name: "ssr" } },
        { dir: outDir },
        {
          "index.js": {
            type: "chunk",
            imports: [
              "react",
              "@scope/pkg/subpath",
              "ipaddr.js",
              "index.js",
              "assets/chunk-abc.js",
              "virtual:vite-rsc",
              "crypto",
              "fs/promises",
              "node:path",
            ],
            dynamicImports: ["react-dom/server.edge"],
          },
          "assets/chunk-abc.js": {
            type: "chunk",
            imports: [],
            dynamicImports: [],
          },
        },
      );

      const manifest = JSON.parse(
        fs.readFileSync(path.join(outDir, "vinext-externals.json"), "utf-8"),
      ) as string[];

      expect(manifest.sort()).toEqual(["@scope/pkg", "ipaddr.js", "react", "react-dom"].sort());
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("collects packages from absolute node_modules import paths", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-externals-abs-"));
    const outDir = path.join(tmpDir, "dist", "server");
    fs.mkdirSync(outDir, { recursive: true });

    try {
      const collected: string[] = [];
      const plugin = createServerExternalsManifestPlugin({
        onExternalPackage: (name) => collected.push(name),
      });
      const writeBundle = (plugin.writeBundle as { handler: Function }).handler;

      writeBundle.call(
        { environment: { name: "rsc" } },
        { dir: outDir },
        {
          "index.js": {
            type: "chunk",
            imports: [
              "/app/node_modules/@opentelemetry/exporter-logs-otlp-http/build/src/index.js",
              "/app/.output/server/node_modules/pino/index.js",
            ],
            dynamicImports: [],
          },
        },
      );

      expect(collected.sort()).toEqual(["@opentelemetry/exporter-logs-otlp-http", "pino"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("packageNameFromSpecifier", () => {
  it("extracts bare and scoped package names", () => {
    expect(packageNameFromSpecifier("react")).toBe("react");
    expect(packageNameFromSpecifier("react-dom/server")).toBe("react-dom");
    expect(packageNameFromSpecifier("@opentelemetry/exporter-logs-otlp-http")).toBe(
      "@opentelemetry/exporter-logs-otlp-http",
    );
    expect(
      packageNameFromSpecifier("@opentelemetry/exporter-logs-otlp-http/build/src/index.js"),
    ).toBe("@opentelemetry/exporter-logs-otlp-http");
  });

  it("returns null for relative imports and virtual schemes", () => {
    expect(packageNameFromSpecifier("./chunk.js")).toBeNull();
    expect(packageNameFromSpecifier("../lib.js")).toBeNull();
    expect(packageNameFromSpecifier("virtual:vite-rsc")).toBeNull();
    expect(packageNameFromSpecifier("#imports")).toBeNull();
    expect(packageNameFromSpecifier("node:fs")).toBeNull();
  });

  it("recovers package names from absolute node_modules paths", () => {
    expect(
      packageNameFromSpecifier(
        "/app/node_modules/@opentelemetry/exporter-logs-otlp-http/build/src/index.js",
      ),
    ).toBe("@opentelemetry/exporter-logs-otlp-http");
    expect(packageNameFromSpecifier("/app/.output/server/node_modules/pino/index.js")).toBe("pino");
  });

  it.runIf(process.platform === "win32")(
    "recovers package names from Windows absolute paths",
    () => {
      expect(
        packageNameFromSpecifier(
          "D:\\projects\\app\\node_modules\\@opentelemetry\\exporter-logs-otlp-http\\build\\src\\index.js",
        ),
      ).toBe("@opentelemetry/exporter-logs-otlp-http");
    },
  );
});

describe("packageNameFromNodeModulesPath", () => {
  it("uses the last node_modules segment for nested installs", () => {
    expect(
      packageNameFromNodeModulesPath(
        "/app/node_modules/.pnpm/foo@1/node_modules/@scope/pkg/dist/index.js",
      ),
    ).toBe("@scope/pkg");
  });
});
