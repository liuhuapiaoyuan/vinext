import { builtinModules } from "node:module";

const BUILTIN_MODULES = new Set(
  builtinModules.flatMap((name) =>
    name.startsWith("node:") ? [name, name.slice(5)] : [name, `node:${name}`],
  ),
);

export const BARE_PACKAGE_SPECIFIER_RE =
  /^(?:(?<scoped>@[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+)|(?<unscoped>[A-Za-z0-9_~-][A-Za-z0-9._~-]*))(?:\/[^?#]*)?$/;

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
 * Relative and absolute paths, package imports, URL/virtual schemes, malformed
 * scoped names, and Node builtins are not npm package references. Absolute /
 * `file:` paths through `node_modules` are recovered to a package name (needed
 * when Nitro rewrites externals to resolved filesystem paths).
 */
export function packageNameFromSpecifier(specifier: string): string | null {
  if (!specifier || specifier.startsWith("#") || specifier.startsWith(".")) {
    return null;
  }

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

  const match = BARE_PACKAGE_SPECIFIER_RE.exec(specifier);
  const packageName = match?.groups?.scoped ?? match?.groups?.unscoped ?? null;
  if (!packageName || BUILTIN_MODULES.has(packageName)) return null;
  return packageName;
}
