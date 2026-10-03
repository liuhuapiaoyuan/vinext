import type { RscPluginManager } from "@vitejs/plugin-rsc";
import type { Rollup } from "vite";
import type { AppRoute } from "../routing/app-route-graph.js";

type ActionOwnerRoute = Pick<
  AppRoute,
  | "errorPath"
  | "errorPaths"
  | "forbiddenPath"
  | "forbiddenPaths"
  | "layoutErrorPaths"
  | "layouts"
  | "loadingPath"
  | "loadingPaths"
  | "notFoundPath"
  | "notFoundPaths"
  | "pagePath"
  | "parallelSlots"
  | "pattern"
  | "siblingIntercepts"
  | "templates"
  | "unauthorizedPath"
  | "unauthorizedPaths"
>;

export type ActionOwnerRouteReachability = Map<
  string,
  {
    clientReferenceImportIds: Set<string>;
    serverReferenceIds: Set<string>;
  }
>;

type ActionOwnerModuleInfo = Pick<Rollup.ModuleInfo, "dynamicallyImportedIds" | "importedIds">;

type ActionOwnerReferenceMaps = {
  clientReferenceMetaMap: RscPluginManager["clientReferenceMetaMap"];
  serverReferenceMetaMap: RscPluginManager["serverReferences"]["metaMap"];
};

export function actionOwnerRouteEntryIds(route: ActionOwnerRoute): string[] {
  return [
    route.pagePath,
    ...route.layouts,
    ...route.templates,
    route.loadingPath,
    ...(route.loadingPaths ?? []),
    route.errorPath,
    ...(route.layoutErrorPaths ?? []),
    ...(route.errorPaths ?? []),
    route.notFoundPath,
    ...(route.notFoundPaths ?? []),
    route.forbiddenPath,
    ...(route.forbiddenPaths ?? []),
    route.unauthorizedPath,
    ...(route.unauthorizedPaths ?? []),
    ...route.parallelSlots.flatMap((slot) => [
      slot.pagePath,
      slot.defaultPath,
      slot.layoutPath,
      ...(slot.configLayoutPaths ?? []),
      slot.loadingPath,
      ...(slot.loadingPaths ?? []),
      slot.errorPath,
      slot.notFoundPath,
      ...slot.interceptingRoutes.flatMap((intercept) => [
        intercept.pagePath,
        ...intercept.layoutPaths,
        ...(intercept.loadingPaths ?? []),
        intercept.notFoundPath,
      ]),
    ]),
    ...route.siblingIntercepts.flatMap((intercept) => [
      intercept.pagePath,
      ...intercept.layoutPaths,
      ...(intercept.loadingPaths ?? []),
      intercept.notFoundPath,
    ]),
  ].filter((value): value is string => typeof value === "string");
}

// Every route walks the same module graph, and each Rolldown getModuleInfo()
// call crosses into native code, so look each module up once per build pass.
function memoizeModuleInfo(
  getModuleInfo: (id: string) => ActionOwnerModuleInfo | null,
): (id: string) => ActionOwnerModuleInfo | null {
  const cache = new Map<string, ActionOwnerModuleInfo | null>();
  return (id) => {
    let info = cache.get(id);
    if (info === undefined) {
      info = getModuleInfo(id);
      cache.set(id, info);
    }
    return info;
  };
}

type ReachableActionReferences = {
  clientReferenceImportIds: Set<string>;
  serverReferenceIds: Set<string>;
};

const EMPTY_REACHABLE_REFERENCES: ReachableActionReferences = {
  clientReferenceImportIds: new Set(),
  serverReferenceIds: new Set(),
};

export function collectReachableActionReferences(
  options: {
    canonicalizeModuleId?: (id: string) => string;
    getModuleInfo: (id: string) => ActionOwnerModuleInfo | null;
    /**
     * Reachable references from a module are the same for every route. Reuse
     * this map across routes so a shared layout is walked once.
     */
    memo?: Map<string, ReachableActionReferences>;
    roots: readonly string[];
  } & ActionOwnerReferenceMaps,
): ReachableActionReferences {
  const canonicalizeModuleId = options.canonicalizeModuleId ?? ((id: string) => id);
  const memo = options.memo ?? new Map<string, ReachableActionReferences>();
  const stack = new Set<string>();

  const visit = (id: string): { cyclic: boolean; refs: ReachableActionReferences } => {
    const cached = memo.get(id);
    if (cached) return { cyclic: false, refs: cached };
    // A back edge produces an empty partial. The ancestor that owns the cycle
    // still unions every descendant's own references before returning.
    if (stack.has(id)) return { cyclic: true, refs: EMPTY_REACHABLE_REFERENCES };

    stack.add(id);
    const clientReferenceImportIds = new Set<string>();
    const serverReferenceIds = new Set<string>();
    const clientReference = options.clientReferenceMetaMap[id];
    if (clientReference) {
      clientReferenceImportIds.add(clientReference.importId);
    }
    const serverReference = options.serverReferenceMetaMap.get(id);
    if (serverReference) {
      for (const exportName of serverReference.exportNames) {
        serverReferenceIds.add(`${serverReference.referenceKey}#${exportName}`);
      }
    }

    let cyclic = false;
    const info = options.getModuleInfo(id);
    for (const importedId of [
      ...(info?.importedIds ?? []),
      ...(info?.dynamicallyImportedIds ?? []),
    ]) {
      const child = visit(importedId);
      cyclic = cyclic || child.cyclic;
      for (const importId of child.refs.clientReferenceImportIds) {
        clientReferenceImportIds.add(importId);
      }
      for (const actionId of child.refs.serverReferenceIds) {
        serverReferenceIds.add(actionId);
      }
    }
    stack.delete(id);

    const refs = { clientReferenceImportIds, serverReferenceIds };
    // Cycle participants are incomplete until the ancestor finishes, so only
    // acyclic nodes are safe to reuse from another root.
    if (!cyclic) memo.set(id, refs);
    return { cyclic, refs };
  };

  const clientReferenceImportIds = new Set<string>();
  const serverReferenceIds = new Set<string>();
  for (const root of options.roots) {
    const { refs } = visit(canonicalizeModuleId(root));
    for (const importId of refs.clientReferenceImportIds) clientReferenceImportIds.add(importId);
    for (const actionId of refs.serverReferenceIds) serverReferenceIds.add(actionId);
  }
  return { clientReferenceImportIds, serverReferenceIds };
}

export function collectRscActionReachability(
  options: {
    canonicalizeModuleId?: (id: string) => string;
    getModuleInfo: (id: string) => ActionOwnerModuleInfo | null;
    routes: readonly ActionOwnerRoute[];
    sharedRoots?: readonly string[];
  } & ActionOwnerReferenceMaps,
): ActionOwnerRouteReachability {
  const getModuleInfo = memoizeModuleInfo(options.getModuleInfo);
  const memo = new Map<string, ReachableActionReferences>();
  const routeReachability: ActionOwnerRouteReachability = new Map(
    options.routes.map((route) => [
      route.pattern,
      collectReachableActionReferences({
        canonicalizeModuleId: options.canonicalizeModuleId,
        clientReferenceMetaMap: options.clientReferenceMetaMap,
        getModuleInfo,
        memo,
        roots: actionOwnerRouteEntryIds(route),
        serverReferenceMetaMap: options.serverReferenceMetaMap,
      }),
    ]),
  );
  if (options.sharedRoots?.length) {
    routeReachability.set(
      "*",
      collectReachableActionReferences({
        canonicalizeModuleId: options.canonicalizeModuleId,
        clientReferenceMetaMap: options.clientReferenceMetaMap,
        getModuleInfo,
        memo,
        roots: options.sharedRoots,
        serverReferenceMetaMap: options.serverReferenceMetaMap,
      }),
    );
  }
  return routeReachability;
}

export async function resolveClientReferenceImportIds(options: {
  canonicalizeModuleId?: (id: string) => string;
  resolveId: (id: string) => Promise<string | null>;
  routeReachability: ActionOwnerRouteReachability;
}): Promise<void> {
  const canonicalizeModuleId = options.canonicalizeModuleId ?? ((id: string) => id);
  const uniqueImportIds = new Set<string>();
  for (const reachability of options.routeReachability.values()) {
    for (const importId of reachability.clientReferenceImportIds) uniqueImportIds.add(importId);
  }

  const resolvedIdsByImportId = new Map<string, string>();
  const importIds = [...uniqueImportIds];
  const concurrency = Math.min(32, importIds.length);
  let nextIndex = 0;
  async function resolveWorker(): Promise<void> {
    while (nextIndex < importIds.length) {
      const importId = importIds[nextIndex++]!;
      resolvedIdsByImportId.set(
        importId,
        canonicalizeModuleId((await options.resolveId(importId)) ?? importId),
      );
    }
  }
  if (concurrency > 0) {
    await Promise.all(Array.from({ length: concurrency }, () => resolveWorker()));
  }

  for (const reachability of options.routeReachability.values()) {
    const resolvedImportIds = new Set<string>();
    for (const importId of reachability.clientReferenceImportIds) {
      resolvedImportIds.add(resolvedIdsByImportId.get(importId)!);
    }
    reachability.clientReferenceImportIds = resolvedImportIds;
  }
}

export function addClientActionReachability(
  options: {
    canonicalizeModuleId?: (id: string) => string;
    getModuleInfo: (id: string) => ActionOwnerModuleInfo | null;
    routeReachability: ActionOwnerRouteReachability;
  } & ActionOwnerReferenceMaps,
): void {
  const getModuleInfo = memoizeModuleInfo(options.getModuleInfo);
  const memo = new Map<string, ReachableActionReferences>();
  for (const reachability of options.routeReachability.values()) {
    const clientReachability = collectReachableActionReferences({
      canonicalizeModuleId: options.canonicalizeModuleId,
      clientReferenceMetaMap: options.clientReferenceMetaMap,
      getModuleInfo,
      memo,
      roots: [...reachability.clientReferenceImportIds],
      serverReferenceMetaMap: options.serverReferenceMetaMap,
    });
    for (const actionId of clientReachability.serverReferenceIds) {
      reachability.serverReferenceIds.add(actionId);
    }
  }
}

export function buildActionOwnerManifest(
  routeReachability: ActionOwnerRouteReachability,
): Record<string, string[]> {
  const manifest: Record<string, string[]> = {};
  for (const [pattern, reachability] of routeReachability) {
    for (const actionId of reachability.serverReferenceIds) {
      (manifest[actionId] ??= []).push(pattern);
    }
  }
  return manifest;
}
