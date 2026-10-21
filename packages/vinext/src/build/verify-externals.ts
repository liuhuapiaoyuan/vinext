import fs from "node:fs";
import path from "pathslash";

/**
 * Parse the bare package specifiers a bundled server file imports.
 *
 * Only specifiers that must resolve from `node_modules` at runtime are
 * returned: relative paths, absolute paths, URLs, virtual modules, `#imports`
 * and `node:*` builtins are ignored. Package subpaths are reduced to their
 * package name (e.g. `@aws-sdk/client-s3/lib/x.js` → `@aws-sdk/client-s3`).
 */
const SPECIFIER_RE =
  /\bfrom\s*["']([^"'\n]+)["']|\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)|(?:^|[;}\n])\s*import\s+["']([^"'\n]+)["']/gm;

/**
 * Whether a matched string can name an npm package.
 *
 * Rejects anything that cannot be resolved through `node_modules`: relative and
 * absolute paths, `#imports`, URL/virtual schemes, and `node:` builtins. Also
 * rejects strings that only *look* like specifiers inside template literals or
 * error messages — e.g. `${t}` from `from `${t}...``` or the text
 * `"use server"` — because a false positive here would fail a valid build.
 */
function looksLikePackageSpecifier(specifier: string): boolean {
  if (!specifier) return false;
  if (/^[./#]/.test(specifier)) return false;
  // Any URL scheme (node:, data:, http:, virtual:, file:, nitro: …).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)) return false;
  // Whitespace, template interpolation, and JSX-ish characters never occur in
  // a real module specifier.
  if (/[\s${}<>"'`]/.test(specifier)) return false;
  // Only bare package names: "pkg", "@scope/pkg", with optional subpaths.
  return /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+(?:\/[^\s]*)?$/.test(specifier);
}

const BUILTIN_PREFIX = "node:";

function toPackageName(specifier: string): string | null {
  // Rejects non-package strings before any name extraction, including matches
  // that came from template literals rather than real import statements.
  if (!looksLikePackageSpecifier(specifier)) return null;
  if (specifier.startsWith(BUILTIN_PREFIX)) return null;
  // Bare builtins such as "fs" / "fs/promises" are provided by the runtime.
  const [maybeScope] = specifier.split("/");
  if (!specifier.startsWith("@") && NODE_BUILTINS.has(maybeScope)) return null;

  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return specifier.split("/")[0] ?? null;
}

const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

/** Extract every package name imported by the given file contents. */
export function collectImportedPackages(code: string): Set<string> {
  const found = new Set<string>();
  for (const match of code.matchAll(SPECIFIER_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    const packageName = toPackageName(specifier);
    if (packageName) found.add(packageName);
  }
  return found;
}

/** Recursively list `.mjs`/`.js` files under a directory, skipping node_modules. */
function listServerChunks(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listServerChunks(full, out);
    } else if (entry.isFile() && /\.m?js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** True when a package exists in the output node_modules with a loadable package.json. */
function isInstalled(nodeModulesDir: string, packageName: string): boolean {
  return fs.existsSync(path.join(nodeModulesDir, packageName, "package.json"));
}

export type MissingExternalReport = {
  /** Packages imported by the output but absent from `.output/server/node_modules`. */
  missing: string[];
  /** Map of missing package name → the output files that import it. */
  importers: Record<string, string[]>;
};

/**
 * Verify that every package the emitted server code imports is present in the
 * output's own `node_modules`.
 *
 * This is the correctness backstop for standalone deploys: an image that only
 * copies `.output` has no root `node_modules` to fall back on, so a single
 * missing package turns every route that imports it into a runtime 500 while
 * the build itself still exits 0. Scanning the emitted files and comparing
 * against what actually shipped catches that class of failure at build time.
 *
 * `serverDir` is the Nitro server output directory (containing
 * `node_modules/` and the built chunks).
 */
export function findMissingExternals(serverDir: string): MissingExternalReport {
  const nodeModulesDir = path.join(serverDir, "node_modules");
  const importers: Record<string, string[]> = {};
  const files = listServerChunks(serverDir);

  const cache = new Map<string, boolean>();
  for (const file of files) {
    let code: string;
    try {
      code = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const packageName of collectImportedPackages(code)) {
      // Runtime-provided packages are never shipped in the output.
      if (packageName === "vinext") continue;
      let installed = cache.get(packageName);
      if (installed === undefined) {
        installed = isInstalled(nodeModulesDir, packageName);
        cache.set(packageName, installed);
      }
      if (installed) continue;
      const rel = path.relative(serverDir, file);
      (importers[packageName] ??= []).push(rel);
    }
  }

  return { missing: Object.keys(importers).sort(), importers };
}
