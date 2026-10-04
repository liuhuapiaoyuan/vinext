import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { invalidateMetadataFileCache } from "../packages/vinext/src/server/metadata-routes.js";
import {
  createMetadataRouteEntriesSource,
  createMetadataRouteEntryData,
  createMetadataRouteEntrySource,
} from "../packages/vinext/src/server/metadata-route-build-data.js";
import type { MetadataFileRoute } from "../packages/vinext/src/server/metadata-routes.js";

const imagePath = path.resolve("tests/fixtures/images/test-4x3.png");

function createRoute(route: Partial<MetadataFileRoute>): MetadataFileRoute {
  return {
    type: "opengraph-image",
    isDynamic: false,
    filePath: imagePath,
    routePrefix: "",
    routeSegments: [],
    servedUrl: "/opengraph-image.png",
    contentType: "image/png",
    ...route,
  };
}

describe("metadata route build data", () => {
  it("embeds static image route data with content hash, dimensions, alt text, and base64", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-"));
    const altFilePath = path.join(tempDir, "opengraph-image.alt.txt");
    fs.writeFileSync(altFilePath, "Static OG alt");

    const route = createRoute({
      altFilePath,
      routePrefix: "/blog",
      routeSegments: ["blog"],
      servedUrl: "/blog/opengraph-image.png",
    });

    const entryData = createMetadataRouteEntryData(route);

    expect(entryData.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(entryData.fileDataBase64).toBe(fs.readFileSync(imagePath).toString("base64"));
    expect(entryData.headData).toEqual({
      kind: "openGraph",
      href: `/blog/opengraph-image.png?${entryData.contentHash}`,
      type: "image/png",
      width: 4,
      height: 3,
      alt: "Static OG alt",
    });
  });

  it("uses any sizes for static svg icon routes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-"));
    const svgPath = path.join(tempDir, "icon.svg");
    fs.writeFileSync(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M0 0h32v32H0z"/></svg>',
    );

    const entryData = createMetadataRouteEntryData(
      createRoute({
        type: "icon",
        filePath: svgPath,
        servedUrl: "/icon.svg",
        contentType: "image/svg+xml",
      }),
    );

    expect(entryData.headData).toEqual({
      kind: "icon",
      href: `/icon.svg?${entryData.contentHash}`,
      type: "image/svg+xml",
      sizes: "any",
    });
  });

  it("builds favicon head data from static image dimensions", () => {
    const entryData = createMetadataRouteEntryData(
      createRoute({
        type: "favicon",
        servedUrl: "/favicon.ico",
        contentType: "image/x-icon",
      }),
    );

    expect(entryData.headData).toEqual({
      kind: "favicon",
      href: `/favicon.ico?${entryData.contentHash}`,
      type: "image/x-icon",
      sizes: "4x3",
    });
  });

  it("does not read image dimensions for static non-image metadata routes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-"));
    const robotsPath = path.join(tempDir, "robots.txt");
    fs.writeFileSync(robotsPath, "User-Agent: *\nDisallow:");

    const entryData = createMetadataRouteEntryData(
      createRoute({
        type: "robots",
        filePath: robotsPath,
        servedUrl: "/robots.txt",
        contentType: "text/plain",
      }),
    );

    expect(entryData.headData).toBeNull();
    expect(entryData.fileDataBase64).toBe(fs.readFileSync(robotsPath).toString("base64"));
  });

  it("omits alt text when no static alt file is present", () => {
    const entryData = createMetadataRouteEntryData(
      createRoute({
        type: "twitter-image",
        servedUrl: "/twitter-image.png",
      }),
    );

    expect(entryData.headData).toEqual({
      kind: "twitter",
      href: `/twitter-image.png?${entryData.contentHash}`,
      type: "image/png",
      width: 4,
      height: 3,
      alt: undefined,
    });
  });

  it("fails with a path-specific error when a metadata file cannot be read", () => {
    const missingPath = path.join(os.tmpdir(), "vinext-missing-metadata-file.png");

    expect(() =>
      createMetadataRouteEntryData(
        createRoute({
          filePath: missingPath,
          servedUrl: "/missing/opengraph-image.png",
        }),
      ),
    ).toThrow(
      `[vinext] Failed to read metadata route file ${missingPath} for /missing/opengraph-image.png`,
    );
  });

  it("fails with a path-specific error when image dimensions cannot be read", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-"));
    const corruptImagePath = path.join(tempDir, "opengraph-image.png");
    fs.writeFileSync(corruptImagePath, "not an image");

    expect(() =>
      createMetadataRouteEntryData(
        createRoute({
          filePath: corruptImagePath,
          servedUrl: "/corrupt/opengraph-image.png",
        }),
      ),
    ).toThrow(
      `[vinext] Failed to read metadata image dimensions for ${corruptImagePath} (/corrupt/opengraph-image.png)`,
    );
  });

  it("serializes dynamic metadata route entries with module and pattern wiring", () => {
    const route = createRoute({
      type: "sitemap",
      isDynamic: true,
      routePrefix: "/docs/[section]",
      routeSegments: ["docs", "[section]"],
      servedUrl: "/docs/[section]/sitemap.xml",
      contentType: "application/xml",
    });

    const entryData = createMetadataRouteEntryData(route);
    const source = createMetadataRouteEntrySource({
      entryData,
      moduleName: "__metadataRouteModule",
      patternParts: ["docs", ":section", "sitemap.xml"],
    });

    expect(entryData.headData).toBeUndefined();
    expect(entryData.fileDataBase64).toBeUndefined();
    expect(source).toContain('type: "sitemap"');
    expect(source).toContain('routePrefix: "/docs/[section]"');
    expect(source).toContain('servedUrl: "/docs/[section]/sitemap.xml"');
    expect(source).toContain("module: __metadataRouteModule");
    expect(source).toContain('patternParts: ["docs",":section","sitemap.xml"]');
  });

  it("builds metadata route entry sources with module names and dynamic pattern parts", () => {
    const route = createRoute({
      type: "opengraph-image",
      isDynamic: true,
      routePrefix: "/shop/[...slug]",
      routeSegments: ["shop", "[...slug]"],
      servedUrl: "/shop/[...slug]/opengraph-image",
    });

    const entries = createMetadataRouteEntriesSource(
      [route],
      new Map([[imagePath, "__metadataImageModule"]]),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("module: __metadataImageModule");
    expect(entries[0]).toContain('patternParts: ["shop",":slug+","opengraph-image"]');
  });

  it("fails when a dynamic metadata route has not been registered for import", () => {
    const route = createRoute({
      type: "opengraph-image",
      isDynamic: true,
      routePrefix: "",
      routeSegments: [],
      servedUrl: "/opengraph-image",
    });

    expect(() => createMetadataRouteEntriesSource([route], new Map())).toThrow(
      `[vinext] Missing generated module import for dynamic metadata route ${imagePath}`,
    );
  });

  it("reuses static file facts across repeated source builds", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-cache-"));
    const filePath = path.join(tempDir, "opengraph-image.png");
    const altFilePath = path.join(tempDir, "opengraph-image.alt.txt");
    fs.copyFileSync(imagePath, filePath);
    fs.writeFileSync(altFilePath, "Cached alt");
    const route = createRoute({ filePath, altFilePath });
    const readFileSpy = vi.spyOn(fs, "readFileSync");

    createMetadataRouteEntriesSource([route], new Map());
    createMetadataRouteEntriesSource([route], new Map());

    expect(readFileSpy.mock.calls.filter(([file]) => file === filePath)).toHaveLength(1);
    expect(readFileSpy.mock.calls.filter(([file]) => file === altFilePath)).toHaveLength(1);
    readFileSpy.mockRestore();
  });

  it("does not share mutable entry data between cache hits", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-immutable-"));
    const filePath = path.join(tempDir, "opengraph-image.png");
    const altFilePath = path.join(tempDir, "opengraph-image.alt.txt");
    fs.copyFileSync(imagePath, filePath);
    fs.writeFileSync(altFilePath, "Immutable alt");
    const route = createRoute({ filePath, altFilePath });

    const first = createMetadataRouteEntryData(route);
    if (first.headData?.kind === "openGraph") first.headData.alt = "mutated";
    const second = createMetadataRouteEntryData(route);

    expect(second.headData).toMatchObject({ alt: "Immutable alt", width: 4, height: 3 });
  });

  it("revalidates alt text for edits, deletion, and replacement", () => {
    // Next.js reference: packages/next/src/build/webpack/loaders/next-metadata-image-loader.ts
    // checks existsSync for the sibling .alt.txt file on every loader evaluation.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-alt-"));
    const filePath = path.join(tempDir, "opengraph-image.png");
    const altFilePath = path.join(tempDir, "opengraph-image.alt.txt");
    fs.copyFileSync(imagePath, filePath);
    fs.writeFileSync(altFilePath, "Alt one");
    const route = createRoute({ filePath, altFilePath });

    expect(createMetadataRouteEntryData(route).headData).toMatchObject({ alt: "Alt one" });
    fs.writeFileSync(altFilePath, "Alt two");
    expect(createMetadataRouteEntryData(route).headData).toMatchObject({ alt: "Alt two" });
    fs.unlinkSync(altFilePath);
    expect(createMetadataRouteEntryData(route).headData).toMatchObject({ alt: undefined });
    fs.writeFileSync(altFilePath, "Alt three");
    expect(createMetadataRouteEntryData(route).headData).toMatchObject({ alt: "Alt three" });
  });

  it("revalidates content, dimensions, and hash when a file is replaced", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-replace-"));
    const filePath = path.join(tempDir, "opengraph-image.png");
    fs.copyFileSync(imagePath, filePath);
    const route = createRoute({ filePath });

    const first = createMetadataRouteEntryData(route);
    fs.copyFileSync(path.resolve("tests/fixtures/images/test-8x6.jpg"), filePath);
    const second = createMetadataRouteEntryData(route);

    expect(second.contentHash).not.toBe(first.contentHash);
    expect(second.headData).toMatchObject({ width: 8, height: 6 });
    expect(second.fileDataBase64).toBe(fs.readFileSync(filePath).toString("base64"));
  });

  it("does not cache failed image parsing, allowing a same-process retry", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-retry-"));
    const filePath = path.join(tempDir, "opengraph-image.png");
    fs.writeFileSync(filePath, "not an image");
    const route = createRoute({ filePath });

    expect(() => createMetadataRouteEntryData(route)).toThrow(
      `[vinext] Failed to read metadata image dimensions for ${filePath}`,
    );
    fs.copyFileSync(imagePath, filePath);
    expect(createMetadataRouteEntryData(route).headData).toMatchObject({ width: 4, height: 3 });
  });

  it("clears content facts when metadata routes are invalidated before a rebuild", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-metadata-route-rebuild-"));
    const filePath = path.join(tempDir, "opengraph-image.png");
    fs.copyFileSync(imagePath, filePath);
    const route = createRoute({ filePath });
    const readFileSpy = vi.spyOn(fs, "readFileSync");

    createMetadataRouteEntryData(route);
    invalidateMetadataFileCache();
    readFileSpy.mockClear();
    createMetadataRouteEntryData(route);

    expect(readFileSpy.mock.calls.filter(([file]) => file === filePath)).toHaveLength(1);
    readFileSpy.mockRestore();
  });
});
