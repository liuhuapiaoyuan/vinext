import path, { toSlash } from "pathslash";
import { isPathInsideOrEqual } from "../utils/path.js";

/**
 * Globs merged into Vite `server.watch.ignored` during `vinext dev`.
 *
 * Vite 8 watches the whole project root. Two consequences we have to stop:
 * 1. `reloadOnTsconfigChange` full-reloads the browser on any `tsconfig.json`
 *    mtime (including formatter / editor touches).
 * 2. Generated output, local DBs, and other non-source writes look like HMR.
 *
 * User `server.watch.ignored` is concatenated by Vite's mergeConfig; these
 * patterns are extra, not a replacement.
 */
export const VINEXT_DEV_WATCH_IGNORE_GLOBS = [
  "**/.output/**",
  "**/.next/**",
  "**/.vinext/**",
  "**/*.db",
  "**/*.db-journal",
  "**/*.db-wal",
  "**/*.db-shm",
  "**/coverage/**",
  "**/tsconfig.json",
  "**/tsconfig.*.json",
  "**/jsconfig.json",
  "**/next-env.d.ts",
] as const;

const ALWAYS_WATCH_ROOT_FILE_RE =
  /^(vite\.config|next\.config|postcss\.config|instrumentation|instrumentation-client|middleware|proxy)\.[^/]+$/;

function basenamePosix(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash === -1 ? relativePath : relativePath.slice(slash + 1);
}

function isTsconfigLikeFileName(fileName: string): boolean {
  return (
    fileName === "tsconfig.json" ||
    fileName === "jsconfig.json" ||
    /^tsconfig\.[^/]+\.json$/.test(fileName)
  );
}

function isAlwaysIgnoredFileName(fileName: string): boolean {
  if (isTsconfigLikeFileName(fileName) || fileName === "next-env.d.ts") return true;
  return /\.db(?:-journal|-wal|-shm)?$/.test(fileName);
}

function isGeneratedDirSegment(relativePath: string): boolean {
  return /(?:^|\/)(?:\.output|\.next|\.vinext|coverage)(?:\/|$)/.test(relativePath);
}

function isAlwaysWatchedRootFile(fileName: string): boolean {
  if (fileName === ".env" || fileName.startsWith(".env.")) return true;
  return ALWAYS_WATCH_ROOT_FILE_RE.test(fileName);
}

export type VinextDevWatchIgnoreOptions = {
  /** Vite project root (absolute). */
  root: string;
  /**
   * Directory that contains `app/` / `pages/` (`<root>` or `<root>/src`, or a
   * custom `vinext({ appDir })` target).
   */
  sourceDir: string;
};

/**
 * True when a watcher event for `file` should be dropped.
 *
 * Files outside the Vite root stay watched so monorepo workspace packages
 * (imported via `addWatchFile`) still HMR. `tsconfig.json` is ignored even
 * outside the root — Vite matches any path ending in `/tsconfig.json`.
 */
export function shouldIgnoreDevWatchFile(
  file: string,
  options: VinextDevWatchIgnoreOptions,
): boolean {
  const root = toSlash(path.resolve(options.root));
  const sourceDir = toSlash(path.resolve(options.sourceDir));
  const normalized = toSlash(file);
  const relativePath = toSlash(path.relative(root, normalized));
  const fileName = basenamePosix(relativePath === "" ? normalized : relativePath);

  if (relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    return isAlwaysIgnoredFileName(fileName) || isGeneratedDirSegment(normalized);
  }

  // Ignoring the project root itself would disable the whole watcher.
  if (relativePath === "" || relativePath === ".") return false;

  if (isAlwaysIgnoredFileName(fileName) || isGeneratedDirSegment(relativePath)) {
    return true;
  }

  if (relativePath === "public" || relativePath.startsWith("public/")) return false;

  const sourceRel = toSlash(path.relative(root, sourceDir));
  if (sourceRel === "" || sourceRel === ".") {
    return false;
  }

  if (isPathInsideOrEqual(sourceDir, normalized)) return false;

  if (!relativePath.includes("/") && isAlwaysWatchedRootFile(fileName)) {
    return false;
  }

  return true;
}

export function getVinextDevWatchIgnored(
  options: VinextDevWatchIgnoreOptions,
): Array<string | ((file: string) => boolean)> {
  return [
    ...VINEXT_DEV_WATCH_IGNORE_GLOBS,
    (file: string) => shouldIgnoreDevWatchFile(file, options),
  ];
}
