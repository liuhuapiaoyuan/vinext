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

function memoizeModuleIdCanonicalizer(
  canonicalizeModuleId: (id: string) => string,
): (id: string) => string {
  const cache = new Map<string, string>();
  return (id) => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const canonicalId = canonicalizeModuleId(id);
    cache.set(id, canonicalId);
    return canonicalId;
  };
}

type ActionOwnerReachabilityIndex = {
  collect(roots: readonly string[]): {
    clientReferenceImportIds: Set<string>;
    serverReferenceIds: Set<string>;
  };
};

type ActionOwnerGraphNode = {
  children: string[];
  clientReferenceImportIds: Set<string>;
  serverReferenceIds: Set<string>;
};

/**
 * Build one reachability index for all route roots in a build pass.
 *
 * Routes share layouts, loading boundaries, and client components. Walking the
 * Rolldown graph independently for every route made those shared subgraphs
 * expensive in large applications. SCC compression keeps cyclic imports
 * correct while allowing each shared component's action set to be computed
 * once and reused by every route that reaches it.
 */
function createActionOwnerReachabilityIndex(
  options: {
    canonicalizeModuleId?: (id: string) => string;
    getModuleInfo: (id: string) => ActionOwnerModuleInfo | null;
    rootSets: readonly (readonly string[])[];
  } & ActionOwnerReferenceMaps,
): ActionOwnerReachabilityIndex {
  const canonicalizeModuleId = memoizeModuleIdCanonicalizer(
    options.canonicalizeModuleId ?? ((id: string) => id),
  );
  const graph = new Map<string, ActionOwnerGraphNode>();
  const pending: string[] = [];
  const scheduled = new Set<string>();

  for (const roots of options.rootSets) {
    for (const root of roots) {
      const canonicalRoot = canonicalizeModuleId(root);
      if (scheduled.has(canonicalRoot)) continue;
      scheduled.add(canonicalRoot);
      pending.push(canonicalRoot);
    }
  }

  for (let index = 0; index < pending.length; index++) {
    const id = pending[index]!;
    if (graph.has(id)) continue;

    const clientReferenceImportIds = new Set<string>();
    const clientReference = options.clientReferenceMetaMap[id];
    if (clientReference) clientReferenceImportIds.add(clientReference.importId);

    const serverReferenceIds = new Set<string>();
    const serverReference = options.serverReferenceMetaMap.get(id);
    if (serverReference) {
      for (const exportName of serverReference.exportNames) {
        serverReferenceIds.add(`${serverReference.referenceKey}#${exportName}`);
      }
    }

    const info = options.getModuleInfo(id);
    const children: string[] = [];
    const childIds = new Set<string>();
    const addChild = (importedId: string) => {
      const child = canonicalizeModuleId(importedId);
      if (childIds.has(child)) return;
      childIds.add(child);
      children.push(child);
      if (!scheduled.has(child)) {
        scheduled.add(child);
        pending.push(child);
      }
    };
    for (const importedId of info?.importedIds ?? []) addChild(importedId);
    for (const importedId of info?.dynamicallyImportedIds ?? []) addChild(importedId);

    graph.set(id, { children, clientReferenceImportIds, serverReferenceIds });
  }

  // Tarjan's algorithm without recursion. A large app graph can exceed the
  // JavaScript call stack, and the iterative form also avoids per-route stack
  // allocations.
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const componentByNode = new Map<string, number>();
  let componentCount = 0;
  let nextIndex = 0;

  for (const start of graph.keys()) {
    if (indices.has(start)) continue;
    indices.set(start, nextIndex);
    lowLinks.set(start, nextIndex++);
    stack.push(start);
    onStack.add(start);
    const frames: { id: string; nextChild: number }[] = [{ id: start, nextChild: 0 }];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const node = graph.get(frame.id)!;
      const child = node.children[frame.nextChild++];

      if (child !== undefined) {
        if (!indices.has(child)) {
          indices.set(child, nextIndex);
          lowLinks.set(child, nextIndex++);
          stack.push(child);
          onStack.add(child);
          frames.push({ id: child, nextChild: 0 });
        } else if (onStack.has(child)) {
          lowLinks.set(frame.id, Math.min(lowLinks.get(frame.id)!, indices.get(child)!));
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent && onStack.has(frame.id)) {
        lowLinks.set(parent.id, Math.min(lowLinks.get(parent.id)!, lowLinks.get(frame.id)!));
      }
      if (lowLinks.get(frame.id) !== indices.get(frame.id)) continue;

      const component = componentCount++;
      while (true) {
        const member = stack.pop()!;
        onStack.delete(member);
        componentByNode.set(member, component);
        if (member === frame.id) break;
      }
    }
  }
  indices.clear();
  lowLinks.clear();
  stack.length = 0;
  onStack.clear();

  const componentChildren = Array.from({ length: componentCount }, () => new Set<number>());
  const componentClientReferences = Array.from({ length: componentCount }, () => new Set<string>());
  const componentServerReferences = Array.from({ length: componentCount }, () => new Set<string>());
  const componentIndegrees = Array.from({ length: componentCount }, () => 0);

  for (const [id, node] of graph) {
    const component = componentByNode.get(id)!;
    for (const importId of node.clientReferenceImportIds) {
      componentClientReferences[component]!.add(importId);
    }
    for (const actionId of node.serverReferenceIds) {
      componentServerReferences[component]!.add(actionId);
    }
    for (const child of node.children) {
      const childComponent = componentByNode.get(child)!;
      if (childComponent === component || componentChildren[component]!.has(childComponent))
        continue;
      componentChildren[component]!.add(childComponent);
      componentIndegrees[childComponent]!++;
    }
  }

  // Component edges point from importer to imported module. Process the
  // reverse topological order so every child summary is ready before its
  // importer summary is assembled.
  const componentQueue = componentIndegrees
    .map((degree, component) => (degree === 0 ? component : -1))
    .filter((component) => component !== -1);
  const componentOrder: number[] = [];
  for (let index = 0; index < componentQueue.length; index++) {
    const component = componentQueue[index]!;
    componentOrder.push(component);
    for (const child of componentChildren[component]!) {
      componentIndegrees[child]!--;
      if (componentIndegrees[child] === 0) componentQueue.push(child);
    }
  }
  for (const component of componentOrder.reverse()) {
    for (const child of componentChildren[component]!) {
      for (const importId of componentClientReferences[child]!) {
        componentClientReferences[component]!.add(importId);
      }
      for (const actionId of componentServerReferences[child]!) {
        componentServerReferences[component]!.add(actionId);
      }
    }
  }
  graph.clear();
  componentChildren.length = 0;
  componentIndegrees.length = 0;

  return {
    collect(roots) {
      const clientReferenceImportIds = new Set<string>();
      const serverReferenceIds = new Set<string>();
      for (const root of roots) {
        const component = componentByNode.get(canonicalizeModuleId(root));
        if (component === undefined) continue;
        for (const importId of componentClientReferences[component]!) {
          clientReferenceImportIds.add(importId);
        }
        for (const actionId of componentServerReferences[component]!) {
          serverReferenceIds.add(actionId);
        }
      }
      return { clientReferenceImportIds, serverReferenceIds };
    },
  };
}

export function collectReachableActionReferences(
  options: {
    canonicalizeModuleId?: (id: string) => string;
    getModuleInfo: (id: string) => ActionOwnerModuleInfo | null;
    roots: readonly string[];
  } & ActionOwnerReferenceMaps,
): {
  clientReferenceImportIds: Set<string>;
  serverReferenceIds: Set<string>;
} {
  return createActionOwnerReachabilityIndex({
    ...options,
    rootSets: [options.roots],
  }).collect(options.roots);
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
  const routeRoots = options.routes.map((route) => actionOwnerRouteEntryIds(route));
  const rootSets = options.sharedRoots?.length ? [...routeRoots, options.sharedRoots] : routeRoots;
  const reachabilityIndex = createActionOwnerReachabilityIndex({
    canonicalizeModuleId: options.canonicalizeModuleId,
    clientReferenceMetaMap: options.clientReferenceMetaMap,
    getModuleInfo,
    rootSets,
    serverReferenceMetaMap: options.serverReferenceMetaMap,
  });
  const routeReachability: ActionOwnerRouteReachability = new Map(
    options.routes.map((route, routeIndex) => [
      route.pattern,
      reachabilityIndex.collect(routeRoots[routeIndex]!),
    ]),
  );
  if (options.sharedRoots?.length) {
    routeReachability.set("*", reachabilityIndex.collect(options.sharedRoots));
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
  const reachabilityEntries = [...options.routeReachability.values()];
  const rootSets = reachabilityEntries.map((reachability) => [
    ...reachability.clientReferenceImportIds,
  ]);
  const reachabilityIndex = createActionOwnerReachabilityIndex({
    canonicalizeModuleId: options.canonicalizeModuleId,
    clientReferenceMetaMap: options.clientReferenceMetaMap,
    getModuleInfo,
    rootSets,
    serverReferenceMetaMap: options.serverReferenceMetaMap,
  });

  for (const [routeIndex, reachability] of reachabilityEntries.entries()) {
    const clientReachability = reachabilityIndex.collect(rootSets[routeIndex]!);
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
