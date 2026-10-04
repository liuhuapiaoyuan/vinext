import { createHash } from "node:crypto";
import fs from "node:fs";
import { imageSize } from "image-size";
import path from "pathslash";
import { routePatternParts } from "../routing/route-pattern.js";
import {
  getMetadataRouteKind,
  type MetadataFileRoute,
  type MetadataRouteHeadData,
} from "./metadata-routes.js";

type ImageDimensions = {
  width?: number;
  height?: number;
};

type MetadataHeadDataInput = {
  route: MetadataFileRoute;
  contentHash: string;
  dimensions: ImageDimensions;
  altText?: string;
};

type MetadataRouteEntrySourceInput = {
  entryData: MetadataRouteEntryData;
  moduleName?: string;
  patternParts?: readonly string[] | null;
};

type MetadataRouteEntryData = {
  type: MetadataFileRoute["type"];
  isDynamic: boolean;
  routePrefix: string;
  routeSegments: readonly string[];
  servedUrl: string;
  contentType: string;
  contentHash: string;
  headData?: MetadataRouteHeadData | null;
  fileDataBase64?: string;
};

type MetadataFileStat = Readonly<{
  realPath: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
}>;

type CachedMetadataFileFacts = Readonly<{
  stat: MetadataFileStat;
  contentHash: string;
  dimensions: Readonly<ImageDimensions>;
  fileDataBase64?: string;
}>;

type CachedMetadataAltText = Readonly<{
  stat: MetadataFileStat | null;
  text?: string;
}>;

const MAX_METADATA_FILE_CACHE_ENTRIES = 64;
const MAX_METADATA_FILE_CACHE_BYTES = 16 * 1024 * 1024;
const metadataFileFactsCache = new Map<string, CachedMetadataFileFacts>();
const metadataAltTextCache = new Map<string, CachedMetadataAltText>();
let metadataFileFactsCacheBytes = 0;

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      (error as { code?: unknown }).code === "ENOTDIR")
  );
}

function readMetadataFileStat(filePath: string, allowMissing = false): MetadataFileStat | null {
  let realPath: string;
  try {
    realPath = fs.realpathSync.native(filePath);
  } catch (error) {
    if (allowMissing && isMissingFileError(error)) return null;
    throw error;
  }

  try {
    const stat = fs.statSync(realPath);
    return Object.freeze({
      realPath,
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      birthtimeMs: stat.birthtimeMs,
    });
  } catch (error) {
    if (allowMissing && isMissingFileError(error)) return null;
    throw error;
  }
}

function metadataFileCacheKey(filePath: string, stat: MetadataFileStat | null): string {
  if (!stat) return `missing:${path.resolve(filePath)}`;
  if (stat.dev !== 0 || stat.ino !== 0) {
    return `identity:${stat.realPath}:${stat.dev}:${stat.ino}`;
  }
  return `path:${stat.realPath}`;
}

function sameMetadataFileStat(a: MetadataFileStat, b: MetadataFileStat): boolean {
  return (
    a.realPath === b.realPath &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.birthtimeMs === b.birthtimeMs
  );
}

function rememberMetadataFileFacts(key: string, facts: CachedMetadataFileFacts): void {
  const previous = metadataFileFactsCache.get(key);
  if (previous) {
    metadataFileFactsCacheBytes -= previous.fileDataBase64?.length ?? 0;
    metadataFileFactsCache.delete(key);
  }
  const bytes = facts.fileDataBase64?.length ?? 0;
  if (bytes > MAX_METADATA_FILE_CACHE_BYTES) return;
  metadataFileFactsCache.set(key, facts);
  metadataFileFactsCacheBytes += bytes;
  while (metadataFileFactsCache.size > MAX_METADATA_FILE_CACHE_ENTRIES) {
    const oldestKey = metadataFileFactsCache.keys().next().value as string;
    const oldest = metadataFileFactsCache.get(oldestKey);
    metadataFileFactsCacheBytes -= oldest?.fileDataBase64?.length ?? 0;
    metadataFileFactsCache.delete(oldestKey);
  }
  while (metadataFileFactsCacheBytes > MAX_METADATA_FILE_CACHE_BYTES) {
    const oldestKey = metadataFileFactsCache.keys().next().value as string;
    const oldest = metadataFileFactsCache.get(oldestKey);
    metadataFileFactsCacheBytes -= oldest?.fileDataBase64?.length ?? 0;
    metadataFileFactsCache.delete(oldestKey);
  }
}

function rememberMetadataAltText(key: string, facts: CachedMetadataAltText): void {
  metadataAltTextCache.delete(key);
  metadataAltTextCache.set(key, facts);
  while (metadataAltTextCache.size > MAX_METADATA_FILE_CACHE_ENTRIES) {
    metadataAltTextCache.delete(metadataAltTextCache.keys().next().value as string);
  }
}

function createMetadataContentHash(buffer: Buffer): string {
  return createHash("sha1").update(buffer).digest("hex").slice(0, 16);
}

function readMetadataRouteFile(route: MetadataFileRoute): Buffer {
  try {
    return fs.readFileSync(route.filePath);
  } catch (error) {
    const reason = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new Error(
      `[vinext] Failed to read metadata route file ${route.filePath} for ${route.servedUrl}${reason}`,
      { cause: error },
    );
  }
}

function readMetadataRouteTextFile(filePath: string, route: MetadataFileRoute): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new Error(
      `[vinext] Failed to read metadata route file ${filePath} for ${route.servedUrl}${reason}`,
      { cause: error },
    );
  }
}

function readMetadataRouteAltText(route: MetadataFileRoute): string | undefined {
  if (!route.altFilePath) return undefined;

  const stat = readMetadataFileStat(route.altFilePath, true);
  const key = metadataFileCacheKey(route.altFilePath, stat);
  const cached = metadataAltTextCache.get(key);
  if (
    cached &&
    ((cached.stat === null && stat === null) ||
      (cached.stat !== null && stat !== null && sameMetadataFileStat(cached.stat, stat)))
  ) {
    return cached.text;
  }

  if (!stat) {
    const facts = Object.freeze({ stat: null });
    rememberMetadataAltText(key, facts);
    return undefined;
  }

  const facts = Object.freeze({
    stat,
    text: readMetadataRouteTextFile(route.altFilePath, route),
  });
  rememberMetadataAltText(key, facts);
  return facts.text;
}

function readMetadataImageDimensions(buffer: Buffer, route: MetadataFileRoute): ImageDimensions {
  try {
    const dimensions = imageSize(buffer);
    return {
      width: dimensions.width,
      height: dimensions.height,
    };
  } catch (error) {
    const reason = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new Error(
      `[vinext] Failed to read metadata image dimensions for ${route.filePath} (${route.servedUrl})${reason}`,
      { cause: error },
    );
  }
}

function resolveIconSizes(
  routeKind: MetadataRouteHeadData["kind"],
  isSvgRoute: boolean,
  dimensions: ImageDimensions,
): string | undefined {
  if (routeKind !== "favicon" && routeKind !== "icon" && routeKind !== "apple") {
    return undefined;
  }
  if (isSvgRoute) {
    return "any";
  }
  if (dimensions.width && dimensions.height) {
    return `${dimensions.width}x${dimensions.height}`;
  }
  return "any";
}

function createMetadataHeadData(input: MetadataHeadDataInput): MetadataRouteHeadData | null {
  const { route, contentHash, dimensions, altText } = input;
  const routeKind = getMetadataRouteKind(route);
  if (!routeKind) {
    return null;
  }
  if (routeKind === "manifest") {
    return { kind: "manifest", href: route.servedUrl };
  }

  const href = `${route.servedUrl}?${contentHash}`;
  const isSvgRoute =
    route.contentType === "image/svg+xml" || route.servedUrl.toLowerCase().endsWith(".svg");

  if (routeKind === "favicon" || routeKind === "icon" || routeKind === "apple") {
    return {
      kind: routeKind,
      href,
      type: route.contentType,
      sizes: resolveIconSizes(routeKind, isSvgRoute, dimensions),
    };
  }

  return {
    kind: routeKind,
    href,
    type: route.contentType,
    width: dimensions.width,
    height: dimensions.height,
    alt: altText,
  };
}

function createBaseEntryData(
  route: MetadataFileRoute,
  contentHash: string,
): MetadataRouteEntryData {
  return {
    type: route.type,
    isDynamic: route.isDynamic,
    routePrefix: route.routePrefix,
    routeSegments: route.routeSegments ?? [],
    servedUrl: route.servedUrl,
    contentType: route.contentType,
    contentHash,
  };
}

function readStaticMetadataImageDimensions(
  route: MetadataFileRoute,
  buffer: Buffer,
): ImageDimensions {
  return route.contentType.startsWith("image/") ? readMetadataImageDimensions(buffer, route) : {};
}

function readMetadataFileFacts(
  route: MetadataFileRoute,
  options: { includeDimensions: boolean; includeBase64: boolean },
): CachedMetadataFileFacts {
  let stat: MetadataFileStat | null;
  try {
    stat = readMetadataFileStat(route.filePath);
  } catch {
    readMetadataRouteFile(route);
    throw new Error(`[vinext] Failed to stat metadata route file ${route.filePath}`);
  }
  if (!stat) {
    throw new Error(`[vinext] Metadata route file disappeared: ${route.filePath}`);
  }

  const key = metadataFileCacheKey(route.filePath, stat);
  const cached = metadataFileFactsCache.get(key);
  if (
    cached &&
    sameMetadataFileStat(cached.stat, stat) &&
    (!options.includeDimensions ||
      cached.dimensions.width !== undefined ||
      cached.dimensions.height !== undefined ||
      !route.contentType.startsWith("image/")) &&
    (!options.includeBase64 || cached.fileDataBase64 !== undefined)
  ) {
    return cached;
  }

  const buffer = readMetadataRouteFile(route);
  const dimensions = options.includeDimensions
    ? readStaticMetadataImageDimensions(route, buffer)
    : {};
  const facts = Object.freeze({
    stat,
    contentHash: createMetadataContentHash(buffer),
    dimensions: Object.freeze(dimensions),
    ...(options.includeBase64 ? { fileDataBase64: buffer.toString("base64") } : {}),
  });
  rememberMetadataFileFacts(key, facts);
  return facts;
}

/** Clear build-time metadata content facts. Call when the dev server invalidates app files. */
export function clearMetadataRouteBuildDataCache(): void {
  metadataFileFactsCache.clear();
  metadataAltTextCache.clear();
  metadataFileFactsCacheBytes = 0;
}

export function createMetadataRouteEntryData(route: MetadataFileRoute): MetadataRouteEntryData {
  const facts = readMetadataFileFacts(route, {
    includeDimensions: !route.isDynamic && route.contentType.startsWith("image/"),
    includeBase64: !route.isDynamic,
  });
  const entryData = createBaseEntryData(route, facts.contentHash);

  if (route.isDynamic) {
    if (route.type === "manifest") {
      return {
        ...entryData,
        headData: { kind: "manifest", href: route.servedUrl },
      };
    }
    return entryData;
  }

  return {
    ...entryData,
    headData: createMetadataHeadData({
      route,
      contentHash: facts.contentHash,
      dimensions: facts.dimensions,
      altText: readMetadataRouteAltText(route),
    }),
    fileDataBase64: facts.fileDataBase64,
  };
}

function pushEntryProperty(lines: string[], key: string, value: unknown): void {
  if (value !== undefined) {
    lines.push(`${key}: ${JSON.stringify(value)},`);
  }
}

function createMetadataRoutePatternParts(route: MetadataFileRoute): readonly string[] | null {
  if (!route.isDynamic || !route.servedUrl.includes("[")) {
    return null;
  }
  return routePatternParts(route.servedUrl);
}

function getDynamicMetadataRouteModuleName(
  route: MetadataFileRoute,
  moduleNames: ReadonlyMap<string, string>,
): string | undefined {
  if (!route.isDynamic) {
    return undefined;
  }
  const moduleName = moduleNames.get(route.filePath);
  if (!moduleName) {
    throw new Error(
      `[vinext] Missing generated module import for dynamic metadata route ${route.filePath}`,
    );
  }
  return moduleName;
}

export function createMetadataRouteEntrySource(input: MetadataRouteEntrySourceInput): string {
  const { entryData, moduleName, patternParts } = input;
  const lines: string[] = [];

  pushEntryProperty(lines, "type", entryData.type);
  pushEntryProperty(lines, "isDynamic", entryData.isDynamic);
  pushEntryProperty(lines, "routePrefix", entryData.routePrefix);
  pushEntryProperty(lines, "routeSegments", entryData.routeSegments);
  pushEntryProperty(lines, "servedUrl", entryData.servedUrl);
  pushEntryProperty(lines, "contentType", entryData.contentType);
  pushEntryProperty(lines, "contentHash", entryData.contentHash);
  pushEntryProperty(lines, "headData", entryData.headData);
  pushEntryProperty(lines, "fileDataBase64", entryData.fileDataBase64);

  if (moduleName) {
    lines.push(`module: ${moduleName},`);
  }
  if (patternParts) {
    lines.push(`patternParts: ${JSON.stringify(patternParts)},`);
  }

  return `  {\n    ${lines.join("\n    ")}\n  }`;
}

export function createMetadataRouteEntriesSource(
  routes: readonly MetadataFileRoute[],
  moduleNames: ReadonlyMap<string, string>,
): string[] {
  return routes.map((route) =>
    createMetadataRouteEntrySource({
      entryData: createMetadataRouteEntryData(route),
      moduleName: getDynamicMetadataRouteModuleName(route, moduleNames),
      patternParts: createMetadataRoutePatternParts(route),
    }),
  );
}
