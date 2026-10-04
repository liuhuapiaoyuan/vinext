import { isCSSRequest } from "vite";
import type { HotUpdateOptions, Plugin } from "vite";

export type ClientReferenceLookup = (id: string) => boolean;

export type GraphModule = {
  id?: string | null;
  importers?: Iterable<GraphModule>;
  type?: string;
  url?: string;
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
  const visited = new Set<string>();

  function recurse(mod: GraphModule): boolean {
    if (!mod.id) return false;
    if (isClientReference(mod.id)) return true;
    if (visited.has(mod.id)) return false;
    visited.add(mod.id);
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

const SCRIPT_REQUEST_RE = /\.(?:[cm]?[jt]sx?)(?:\?|$)/i;

function isScriptRequest(id: string): boolean {
  return SCRIPT_REQUEST_RE.test(id);
}

function hasOnlyCssImporters(mods: readonly GraphModule[]): boolean {
  if (mods.length === 0) return false;

  return mods.every((mod) => {
    if (!mod.id || !mod.importers) return false;
    const importers = [...mod.importers];
    return (
      importers.length > 0 &&
      importers.every((importer) => !!importer.id && isCSSRequest(importer.id))
    );
  });
}

function withoutCssImporters(ctx: HotUpdateOptions): HotUpdateOptions {
  if (!isScriptRequest(ctx.file) || isCSSRequest(ctx.file)) return ctx;

  let changed = false;
  const modules = ctx.modules.map((mod) => {
    const importers = [...mod.importers];
    const filteredImporters = new Set(
      importers.filter((importer) => !importer.id || !isCSSRequest(importer.id)),
    );
    if (filteredImporters.size === importers.length) return mod;

    changed = true;
    return new Proxy(mod, {
      get(target, property, receiver) {
        if (property === "importers") return filteredImporters;
        return Reflect.get(target, property, receiver);
      },
    });
  });

  return changed ? { ...ctx, modules } : ctx;
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
  if (isCSSRequest(ctx.file)) return false;

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
      const environmentName = this.environment?.name;
      if (environmentName === "rsc") {
        if (
          shouldSuppressRscHotUpdate(ctx) ||
          (isScriptRequest(ctx.file) && hasOnlyCssImporters(ctx.modules))
        ) {
          return [];
        }
      }

      return originalHandler.call(
        this,
        environmentName === "client" ? withoutCssImporters(ctx) : ctx,
      );
    }

    return {
      ...plugin,
      hotUpdate: typeof original === "function" ? wrapped : { ...original, handler: wrapped },
    };
  });
}
