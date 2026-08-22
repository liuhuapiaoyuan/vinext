import type { HotUpdateOptions, Plugin } from "vite";

export type ClientReferenceLookup = (id: string) => boolean;

export type GraphModule = {
  id?: string | null;
  importers?: Iterable<GraphModule>;
};

export type ClientModuleGraph = {
  getModuleById: (id: string) => GraphModule | undefined;
  getModulesByFile?: (file: string) => Iterable<GraphModule> | undefined;
};

/**
 * Same walk as @vitejs/plugin-rsc `isInsideClientBoundary`: a module is inside
 * the client boundary if it or any importer is a `"use client"` reference.
 */
export function isInsideClientBoundary(
  mods: readonly GraphModule[],
  isClientReference: ClientReferenceLookup,
): boolean {
  const visited = new Set<GraphModule>();

  function recurse(mod: GraphModule): boolean {
    if (!mod.id) return false;
    if (isClientReference(mod.id)) return true;
    if (visited.has(mod)) return false;
    visited.add(mod);
    if (!mod.importers) return false;
    for (const importer of mod.importers) {
      if (recurse(importer)) return true;
    }
    return false;
  }

  return mods.some((mod) => recurse(mod));
}

export function hasNonClientImporter(
  mods: readonly GraphModule[],
  isClientReference: ClientReferenceLookup,
): boolean {
  for (const mod of mods) {
    if (!mod.importers) continue;
    for (const importer of mod.importers) {
      if (importer.id && !isClientReference(importer.id)) return true;
    }
  }
  return false;
}

function findClientGraphModules(
  file: string,
  modules: readonly GraphModule[],
  clientGraph: ClientModuleGraph | undefined,
): GraphModule[] {
  if (!clientGraph) return [];

  const found: GraphModule[] = [];
  const seen = new Set<string>();

  const add = (clientMod: GraphModule | undefined) => {
    if (clientMod?.id && !seen.has(clientMod.id)) {
      seen.add(clientMod.id);
      found.push(clientMod);
    }
  };

  for (const mod of modules) {
    if (!mod.id) continue;
    add(clientGraph.getModuleById(mod.id));
  }

  if (found.length === 0) {
    add(clientGraph.getModuleById(file));
    const byFile = clientGraph.getModulesByFile?.(file);
    if (byFile) {
      for (const clientMod of byFile) add(clientMod);
    }
  }

  return found;
}

function getClientReferenceLookup(server: HotUpdateOptions["server"]): ClientReferenceLookup {
  const plugin = server.config.plugins.find((entry) => entry.name === "rsc:minimal") as
    | { api?: { manager?: { clientReferenceMetaMap?: Record<string, unknown> } } }
    | undefined;
  const map = plugin?.api?.manager?.clientReferenceMetaMap;
  if (!map) return () => false;
  return (id) => Object.hasOwn(map, id);
}

/**
 * plugin-rsc only inspects the *current* environment graph. An unmarked helper
 * imported from `"use client"` (and optionally importing `"use server"`) often
 * appears in the RSC graph without those client importers, so HMR treats it as
 * a server module and sends `rsc:update` in a loop.
 *
 * Next.js: `"use client"` is a boundary — unmarked descendants stay client-owned
 * unless a Server Component also imports them.
 */
export function shouldSuppressRscHotUpdate(ctx: {
  file: string;
  modules: readonly GraphModule[];
  server: HotUpdateOptions["server"];
}): boolean {
  const isClientReference = getClientReferenceLookup(ctx.server);
  if (isInsideClientBoundary(ctx.modules, isClientReference)) {
    return false;
  }

  const clientModules = findClientGraphModules(
    ctx.file,
    ctx.modules,
    ctx.server.environments.client?.moduleGraph,
  );
  if (clientModules.length === 0) return false;
  if (!isInsideClientBoundary(clientModules, isClientReference)) return false;

  return !hasNonClientImporter(ctx.modules, isClientReference);
}

export function wrapRscHotUpdatePlugins(plugins: Plugin[]): Plugin[] {
  return plugins.map((plugin) => {
    if (plugin.name !== "rsc" || !plugin.hotUpdate) return plugin;

    const original = plugin.hotUpdate;
    const originalHandler = typeof original === "function" ? original : original.handler;

    async function wrapped(this: ThisParameterType<typeof originalHandler>, ctx: HotUpdateOptions) {
      if (this.environment?.name === "rsc" && shouldSuppressRscHotUpdate(ctx)) {
        return [];
      }
      return originalHandler.call(this, ctx);
    }

    return {
      ...plugin,
      hotUpdate: typeof original === "function" ? wrapped : { ...original, handler: wrapped },
    };
  });
}
