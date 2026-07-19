import type { Plugin } from "vite";
import { packageNameFromSpecifier } from "./server-externals-manifest.js";

export type ServerBuildExternals = string[] | true;

/**
 * Match a bare import against the configured server externals list.
 *
 * Accepts exact specifier matches (`@opentelemetry/semantic-conventions`) and
 * package-name matches for subpath imports (`@scope/pkg/sub` → `@scope/pkg`).
 */
export function matchServerExternal(id: string, externals: ServerBuildExternals): boolean {
  if (externals === true) return false;
  if (!Array.isArray(externals) || externals.length === 0) return false;
  if (externals.includes(id)) return true;
  const pkg = packageNameFromSpecifier(id);
  return pkg !== null && externals.includes(pkg);
}

/**
 * Force `serverExternalPackages` / SSR externals to stay external at the
 * Rolldown resolve layer.
 *
 * Why config is not enough: Nitro's service `configEnvironment` only puts
 * `/^nitro/` on `rollupOptions.external`, and Vite's `shouldExternalize` still
 * node-resolves listed packages — when resolve fails (bun isolated installs,
 * transitive-only deps) the package is NOT marked external, Rolldown emits
 * `UNRESOLVED_IMPORT`, and Vite turns that into a hard build failure.
 *
 * Returning `{ id, external: true }` from `resolveId` short-circuits that path:
 * Rolldown never tries to resolve the package from disk.
 */
export function createForceServerExternalsPlugin(options: {
  getExternals: () => ServerBuildExternals;
  /** When true the plugin is a no-op (Workers bundle everything). */
  isDisabled?: () => boolean;
}): Plugin {
  const { getExternals, isDisabled } = options;

  return {
    name: "vinext:force-server-externals",
    enforce: "pre",
    apply: "build",
    applyToEnvironment(env) {
      if (isDisabled?.()) return false;
      // Nitro registers the final bundler as `nitro`; RSC/SSR services are the
      // environments that emit chunks under `.nitro/vite/services/*`.
      return env.name === "rsc" || env.name === "ssr" || env.name === "nitro";
    },
    resolveId: {
      // Bare / scoped package imports (`react`, `@scope/pkg`, …).
      filter: { id: /^(?:@[^/]+\/[^/]|[A-Za-z0-9])/ },
      handler(id) {
        if (isDisabled?.()) return null;
        if (!matchServerExternal(id, getExternals())) return null;
        return { id, external: true };
      },
    },
  };
}
