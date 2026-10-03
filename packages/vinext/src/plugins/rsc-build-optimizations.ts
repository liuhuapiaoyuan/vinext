import type { RscPluginManager } from "@vitejs/plugin-rsc";
import type { Plugin, ResolvedConfig } from "vite";

type ServerReferences = RscPluginManager["serverReferences"];

/**
 * Avoid rebuilding plugin-rsc's complete server-reference metadata map when a
 * transformed module never owned a claim. The upstream transform calls
 * deleteClaim for every module, while deriveMetaMap() walks every existing
 * claim on each call. Build-time transforms are one-shot, so tracking claim
 * ownership is enough to preserve the observable delete behavior and makes
 * the common no-claim path constant time.
 */
export function optimizeServerReferenceDeletes(serverReferences: ServerReferences): void {
  const claimedIdsByOwner = new Map<string, Set<string>>();
  const originalReplaceClaim = serverReferences.replaceClaim.bind(serverReferences);
  const originalDeleteClaim = serverReferences.deleteClaim.bind(serverReferences);

  serverReferences.replaceClaim = (owner, id, meta) => {
    let claimedIds = claimedIdsByOwner.get(owner);
    if (!claimedIds) {
      claimedIds = new Set<string>();
      claimedIdsByOwner.set(owner, claimedIds);
    }
    claimedIds.add(id);
    originalReplaceClaim(owner, id, meta);
  };

  serverReferences.deleteClaim = (owner, id) => {
    const claimedIds = claimedIdsByOwner.get(owner);
    if (!claimedIds?.delete(id)) return;
    if (claimedIds.size === 0) claimedIdsByOwner.delete(owner);
    originalDeleteClaim(owner, id);
  };
}

export function createRscBuildOptimizationsPlugin(options: {
  getManager: (config: ResolvedConfig) => Promise<RscPluginManager | undefined>;
}): Plugin {
  return {
    name: "vinext:rsc-build-optimizations",
    async configResolved(resolvedConfig) {
      if (resolvedConfig.command !== "build") return;
      const manager = await options.getManager(resolvedConfig);
      if (manager) optimizeServerReferenceDeletes(manager.serverReferences);
    },
  };
}
