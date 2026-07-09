import fs from "node:fs";
import path from "pathslash";
import { builtinModules } from "node:module";
import type { Plugin } from "vite";

const BUILTIN_MODULES = new Set(
  builtinModules.flatMap((name) =>
    name.startsWith("node:") ? [name, name.slice(5)] : [name, `node:${name}`],
  ),
);

/**
 * Extract an npm package name from an absolute filesystem path that contains
 * a `node_modules` segment (POSIX or Windows). Returns null when the path is
 * not a node_modules package path.
 */
export function packageNameFromNodeModulesPath(filePath: string): string | null {
  const normalized = filePath.replaceAll("\\", "/");
  const marker = "/node_modules/";
  const idx = normalized.lastIndexOf(marker);
  if (idx === -1) return null;

  const after = normalized.slice(idx + marker.length);
  if (!after || after.startsWith(".")) return null;

  if (after.startsWith("@")) {
    const parts = after.split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
    return null;
  }

  const packageName = after.split("/")[0] || null;
  if (!packageName || BUILTIN_MODULES.has(packageName)) {
    return null;
  }
  return packageName;
}

/**
 * Extract the npm package name from a module specifier.
 *
 * Returns null for:
 *  - Relative imports ("./foo", "../bar")
 *  - Node built-ins ("node:fs")
 *  - Package self-references ("#imports")
 *  - Non-package schemes ("virtual:...")
 *
 * Absolute / `file:` paths through `node_modules` are recovered to a package
 * name (needed when Nitro rewrites externals to resolved filesystem paths).
 *
 * Exported for reuse by the Nitro traceDeps propagation in index.ts, which
 * needs package names (not subpath specifiers) for Nitro's include regex.
 */
export function packageNameFromSpecifier(specifier: string): string | null {
  if (!specifier || specifier.startsWith("#")) {
    return null;
  }

  // Relative imports stay in the bundle graph — never npm packages.
  if (specifier.startsWith(".")) {
    return null;
  }

  // Absolute / Windows paths (and file: URLs) may be externalized by Nitro's
  // service build as resolved node_modules paths. Recover the package name so
  // the compiled-hook whole-package copy still runs.
  if (
    specifier.startsWith("/") ||
    specifier.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(specifier) ||
    specifier.startsWith("file:")
  ) {
    let pathPart = specifier;
    if (specifier.startsWith("file://")) {
      try {
        pathPart = decodeURIComponent(new URL(specifier).pathname);
        // On Windows, URL.pathname is "/C:/..." — strip the leading slash.
        if (/^\/[a-zA-Z]:\//.test(pathPart)) {
          pathPart = pathPart.slice(1);
        }
      } catch {
        return null;
      }
    } else if (specifier.startsWith("file:")) {
      pathPart = specifier.slice("file:".length);
    }
    return packageNameFromNodeModulesPath(pathPart);
  }

  // External specifiers can include non-package schemes such as
  // "virtual:vite-rsc". Those are never npm packages.
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)) {
    return null;
  }

  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return null;
  }

  const packageName = specifier.split("/")[0] || null;
  if (!packageName || BUILTIN_MODULES.has(specifier) || BUILTIN_MODULES.has(packageName)) {
    return null;
  }
  return packageName;
}

/**
 * vinext:server-externals-manifest
 *
 * A `writeBundle` plugin that collects the packages left external by the
 * SSR/RSC bundler and writes them to `<outDir>/vinext-externals.json`.
 *
 * With `noExternal: true`, Vite bundles almost everything — only packages
 * explicitly listed in `ssr.external` / `resolve.external` remain as live
 * imports in the server bundle. Those packages are exactly what a standalone
 * deployment needs in `node_modules/`.
 *
 * Using the bundler's own import graph (`chunk.imports` + `chunk.dynamicImports`)
 * is authoritative: no text parsing, no regex, no guessing.
 *
 * The written JSON is an array of package-name strings, e.g.:
 *   ["react", "react-dom", "react-dom/server"]
 *
 * `emitStandaloneOutput` reads this file and uses it as the seed list for the
 * BFS `node_modules/` copy, replacing the old regex-scan approach.
 *
 * The optional `onExternalPackage` callback fires for every collected package
 * name. Nitro builds use it to gather the same authoritative externals list
 * in-process (the manifest file lands under Nitro's service build dir, not
 * dist/server, so the callback avoids path discovery entirely).
 */
export function createServerExternalsManifestPlugin(
  pluginOptions: { onExternalPackage?: (packageName: string) => void } = {},
): Plugin {
  // Destructured at factory scope: the writeBundle handler's own first
  // parameter is also named `options` (rollup output options) and would
  // shadow the factory parameter inside the handler.
  const { onExternalPackage } = pluginOptions;
  // Accumulate external specifiers across all server environments (rsc + ssr).
  // Both environments run writeBundle; we merge their results so Pages Router
  // builds (ssr only) and App Router builds (rsc + ssr) both produce a
  // complete manifest.
  const externals = new Set<string>();
  let outDir: string | null = null;

  return {
    name: "vinext:server-externals-manifest",
    apply: "build",
    enforce: "post",

    writeBundle: {
      sequential: true,
      order: "post",
      handler(options, bundle) {
        const envName = this.environment?.name;
        // Only collect from server environments (rsc = App Router RSC build,
        // ssr = Pages Router SSR build or App Router SSR build).
        if (envName !== "rsc" && envName !== "ssr") return;

        const dir = options.dir;
        if (!dir) return;

        // Use the first server env's outDir parent as the canonical server dir.
        // For Pages Router: options.dir IS dist/server.
        // For App Router RSC: options.dir is dist/server.
        // For App Router SSR: options.dir is dist/server/ssr.
        // We always want dist/server as the manifest location.
        if (!outDir) {
          // The server bundle outputs to dist/server for all environments except
          // App Router SSR, which outputs to dist/server/ssr. We always want
          // dist/server as the manifest location. Rather than hard-coding "ssr",
          // treat any sub-directory of dist/server (basename !== "server") as a
          // sub-env and walk up one level. This handles any future sub-directory
          // environments (e.g. "edge") without code changes.
          // Note: using basename rather than a walk-up avoids misfiring when a
          // user's project path contains a "server" segment above the dist output
          // (e.g. /home/user/server/my-app/).
          outDir = path.basename(dir) === "server" ? dir : path.dirname(dir);
        }

        const bundleFiles = new Set(Object.keys(bundle));
        for (const item of Object.values(bundle)) {
          if (item.type !== "chunk") continue;
          // In Rollup output, item.imports normally contains filenames of other
          // chunks in the bundle. But externalized packages remain as bare npm
          // specifiers (e.g. "react", "@mdx-js/react") since they were never
          // bundled into chunk files. packageNameFromSpecifier filters out chunk
          // filenames (relative/absolute paths) and extracts the package name from
          // bare specifiers — which is exactly what the standalone BFS needs.
          for (const specifier of [...item.imports, ...item.dynamicImports]) {
            if (bundleFiles.has(specifier)) {
              continue;
            }
            const pkg = packageNameFromSpecifier(specifier);
            if (pkg) {
              externals.add(pkg);
              onExternalPackage?.(pkg);
            }
          }
        }

        // After the last expected writeBundle call, flush to disk.
        // We flush on every call since we don't know ahead of time how many
        // environments will fire — overwriting with the accumulated set is safe.
        if (outDir && fs.existsSync(outDir)) {
          const manifestPath = path.join(outDir, "vinext-externals.json");
          fs.writeFileSync(manifestPath, JSON.stringify([...externals], null, 2) + "\n", "utf-8");
        }
      },
    },
  };
}
