import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "pathslash";
import type { RscPluginManager } from "@vitejs/plugin-rsc";
import type { Plugin, ResolvedConfig, ViteBuilder } from "vite";
import type { ActionOwnerRouteReachability } from "./action-owner-manifest.js";

const ASSETS_MANIFEST_FILE = "__vite_rsc_assets_manifest.js";

export const ISOLATED_RSC_BUILD_PHASES = [
  "client-references",
  "server-references",
  "rsc",
  "client",
  "ssr",
  "nitro",
] as const;

export type IsolatedRscBuildPhase = (typeof ISOLATED_RSC_BUILD_PHASES)[number];

type PersistedClaim = {
  id: string;
  owner: string;
  meta: {
    importId: string;
    referenceKey: string;
    exportNames: string[];
  };
};

type PersistedChunk = {
  type: "chunk";
  fileName: string;
  name?: string;
  isEntry?: boolean;
  facadeModuleId: string | null;
  moduleIds: string[];
  imports: string[];
  importedCss: string[];
  importedAssets: string[];
};

type PersistedAsset = {
  type: "asset";
  fileName: string;
  names: string[];
};

type PersistedOutput = PersistedChunk | PersistedAsset;

type PersistedReachability = Record<
  string,
  { clientReferenceImportIds: string[]; serverReferenceIds: string[] }
>;

type IsolationState = {
  clientReferenceMetaMap: RscPluginManager["clientReferenceMetaMap"];
  claims: PersistedClaim[];
  serverResourcesMetaMap: RscPluginManager["serverResourcesMetaMap"];
  environmentImportMetaMap: RscPluginManager["environmentImportMetaMap"];
  bundles: Record<string, PersistedOutput[]>;
  bundleDirs: Record<string, string>;
  assetsManifestCode?: string;
  actionOwnerReachability?: PersistedReachability;
};

const EMPTY_STATE: IsolationState = {
  clientReferenceMetaMap: {},
  claims: [],
  serverResourcesMetaMap: {},
  environmentImportMetaMap: {},
  bundles: {},
  bundleDirs: {},
};

export function isolationBuildPhase(): IsolatedRscBuildPhase | undefined {
  const phase = process.env.VINEXT_BUILD_ISOLATION_PHASE;
  if (!phase) return undefined;
  if (!(ISOLATED_RSC_BUILD_PHASES as readonly string[]).includes(phase)) {
    throw new Error(`[vinext] Unknown build isolation phase "${phase}".`);
  }
  return phase as IsolatedRscBuildPhase;
}

export function hasAppRouterDirectory(root: string): boolean {
  return fs.existsSync(path.join(root, "app")) || fs.existsSync(path.join(root, "src", "app"));
}

export function isolationStatePath(root: string): string {
  return path.join(root, "node_modules", ".vinext", "isolated-rsc-build.json");
}

export function readIsolationState(root: string): IsolationState {
  const file = isolationStatePath(root);
  if (!fs.existsSync(file)) return structuredClone(EMPTY_STATE);
  return { ...structuredClone(EMPTY_STATE), ...JSON.parse(fs.readFileSync(file, "utf8")) };
}

export function updateIsolationState(root: string, patch: Partial<IsolationState>): IsolationState {
  const current = readIsolationState(root);
  const next: IsolationState = {
    ...current,
    ...patch,
    bundles: { ...current.bundles, ...patch.bundles },
    bundleDirs: { ...current.bundleDirs, ...patch.bundleDirs },
  };
  const file = isolationStatePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next));
  return next;
}

export function saveActionOwnerReachability(
  root: string,
  reachability: ActionOwnerRouteReachability,
): void {
  const actionOwnerReachability: PersistedReachability = {};
  for (const [id, entry] of reachability) {
    actionOwnerReachability[id] = {
      clientReferenceImportIds: [...entry.clientReferenceImportIds],
      serverReferenceIds: [...entry.serverReferenceIds],
    };
  }
  updateIsolationState(root, { actionOwnerReachability });
}

export function loadActionOwnerReachability(root: string): ActionOwnerRouteReachability {
  const map: ActionOwnerRouteReachability = new Map();
  for (const [id, entry] of Object.entries(
    readIsolationState(root).actionOwnerReachability ?? {},
  )) {
    map.set(id, {
      clientReferenceImportIds: new Set(entry.clientReferenceImportIds),
      serverReferenceIds: new Set(entry.serverReferenceIds),
    });
  }
  return map;
}

function readClaims(manager: RscPluginManager): PersistedClaim[] {
  const claims: PersistedClaim[] = [];
  for (const [id, owners] of manager.serverReferences.claimMap) {
    for (const [owner, meta] of owners) {
      claims.push({
        id,
        owner,
        meta: {
          importId: meta.importId,
          referenceKey: meta.referenceKey,
          exportNames: [...meta.exportNames],
        },
      });
    }
  }
  return claims;
}

function slimBundle(bundle: Record<string, unknown>): PersistedOutput[] {
  const outputs: PersistedOutput[] = [];
  for (const output of Object.values(bundle)) {
    if (!output || typeof output !== "object") continue;
    const record = output as {
      type?: string;
      fileName?: string;
      names?: string[];
      name?: string;
      isEntry?: boolean;
      facadeModuleId?: string | null;
      moduleIds?: string[];
      imports?: string[];
      viteMetadata?: { importedCss?: Iterable<string>; importedAssets?: Iterable<string> };
    };
    if (record.type === "asset" && record.fileName) {
      outputs.push({ type: "asset", fileName: record.fileName, names: record.names ?? [] });
    } else if (record.type === "chunk" && record.fileName) {
      outputs.push({
        type: "chunk",
        fileName: record.fileName,
        name: record.name,
        isEntry: record.isEntry,
        facadeModuleId: record.facadeModuleId ?? null,
        moduleIds: record.moduleIds ?? [],
        imports: record.imports ?? [],
        importedCss: [...(record.viteMetadata?.importedCss ?? [])],
        importedAssets: [...(record.viteMetadata?.importedAssets ?? [])],
      });
    }
  }
  return outputs;
}

function isRuntimeAsset(value: unknown): value is { runtime: string } {
  return (
    !!value &&
    typeof value === "object" &&
    value.constructor?.name === "RuntimeAsset" &&
    typeof (value as { runtime?: unknown }).runtime === "string"
  );
}

export function serializeAssetsManifest(value: unknown): string {
  const replacements: Array<[string, string]> = [];
  let result = JSON.stringify(
    value,
    (_key, inner) => {
      if (!isRuntimeAsset(inner)) return inner;
      const placeholder = `__runtime_placeholder_${replacements.length}__`;
      replacements.push([placeholder, inner.runtime]);
      return placeholder;
    },
    2,
  );
  if (result === undefined) return "undefined";
  for (const [placeholder, runtime] of replacements) {
    result = result.replaceAll(`"${placeholder}"`, runtime);
  }
  return result;
}

function saveManager(
  root: string,
  manager: RscPluginManager,
  bundle?: { env: string; dir: string },
) {
  const patch: Partial<IsolationState> = {
    clientReferenceMetaMap: manager.clientReferenceMetaMap,
    claims: readClaims(manager),
    serverResourcesMetaMap: manager.serverResourcesMetaMap,
    environmentImportMetaMap: manager.environmentImportMetaMap,
  };
  if (bundle) {
    const output = manager.bundles[bundle.env] as Record<string, unknown> | undefined;
    if (output) {
      patch.bundles = { [bundle.env]: slimBundle(output) };
      patch.bundleDirs = { [bundle.env]: bundle.dir };
    }
  }
  updateIsolationState(root, patch);
}

function hydrateManager(root: string, manager: RscPluginManager, loadAssetBytes: boolean) {
  const state = readIsolationState(root);
  manager.clientReferenceMetaMap = state.clientReferenceMetaMap;
  manager.serverResourcesMetaMap = state.serverResourcesMetaMap;
  manager.environmentImportMetaMap = state.environmentImportMetaMap;
  for (const claim of state.claims) {
    manager.serverReferences.replaceClaim(claim.owner, claim.id, claim.meta);
  }
  for (const [env, outputs] of Object.entries(state.bundles)) {
    const dir = state.bundleDirs[env];
    const bundle: Record<string, unknown> = {};
    for (const output of outputs) {
      if (output.type === "asset") {
        const assetPath = dir ? path.join(dir, output.fileName) : "";
        bundle[output.fileName] = {
          type: "asset",
          fileName: output.fileName,
          names: output.names,
          source:
            loadAssetBytes && assetPath && fs.existsSync(assetPath)
              ? fs.readFileSync(assetPath)
              : "",
        };
      } else {
        bundle[output.fileName] = {
          type: "chunk",
          fileName: output.fileName,
          name: output.name,
          isEntry: Boolean(output.isEntry),
          facadeModuleId: output.facadeModuleId,
          moduleIds: output.moduleIds,
          imports: output.imports,
          viteMetadata: {
            importedCss: new Set(output.importedCss),
            importedAssets: new Set(output.importedAssets),
          },
        };
      }
    }
    manager.bundles[env] = bundle as RscPluginManager["bundles"][string];
  }
  return state;
}

function isInsideDir(child: string, parent: string): boolean {
  const normalizedChild = path.normalize(child);
  const normalizedParent = path.normalize(parent).replace(/\/$/, "");
  return normalizedChild.startsWith(`${normalizedParent}/`);
}

function requireEnvironment(builder: ViteBuilder, name: "rsc" | "ssr" | "client") {
  const environment = builder.environments[name];
  if (!environment) {
    throw new Error(`[vinext] Isolated build requires a "${name}" environment.`);
  }
  return environment;
}

function logPhaseRss(phase: IsolatedRscBuildPhase): void {
  const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  console.log(`[vinext] phase ${phase} rss ${rssMb} MB`);
}

async function runIsolatedPhase(
  builder: ViteBuilder,
  manager: RscPluginManager,
  phase: IsolatedRscBuildPhase,
): Promise<void> {
  logPhaseRss(phase);
  const root = builder.config.root;
  if (phase === "nitro") {
    for (const name of ["rsc", "ssr", "client"] as const) {
      const environment = builder.environments[name];
      if (environment) environment.isBuilt = true;
    }
    return;
  }

  const rsc = requireEnvironment(builder, "rsc");
  const ssr = requireEnvironment(builder, "ssr");
  const client = requireEnvironment(builder, "client");
  const rscOutDir = rsc.config.build.outDir;
  const ssrOutDir = ssr.config.build.outDir;
  const tempRscOutDir = path.join(root, "node_modules", ".vite-rsc-temp", "rsc");
  const rscInsideSsr = isInsideDir(rscOutDir, ssrOutDir);

  if (phase === "client-references") {
    manager.isScanBuild = true;
    rsc.config.build.write = false;
    await builder.build(rsc);
    saveManager(root, manager);
    return;
  }

  if (phase === "server-references") {
    hydrateManager(root, manager, false);
    manager.isScanBuild = true;
    ssr.config.build.write = false;
    await builder.build(ssr);
    saveManager(root, manager);
    return;
  }

  if (phase === "rsc") {
    hydrateManager(root, manager, false);
    manager.isScanBuild = false;
    await builder.build(rsc);
    manager.stabilize();
    let bundleDir = rscOutDir;
    if (rscInsideSsr) {
      fs.rmSync(tempRscOutDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(tempRscOutDir), { recursive: true });
      fs.renameSync(rscOutDir, tempRscOutDir);
      bundleDir = tempRscOutDir;
    }
    saveManager(root, manager, { env: "rsc", dir: bundleDir });
    return;
  }

  if (phase === "client") {
    hydrateManager(root, manager, true);
    manager.stabilize();
    manager.isScanBuild = false;
    await builder.build(client);
    if (manager.buildAssetsManifest) {
      updateIsolationState(root, {
        assetsManifestCode: `export default ${serializeAssetsManifest(manager.buildAssetsManifest)}`,
      });
    }
    saveManager(root, manager, { env: "client", dir: client.config.build.outDir });
    return;
  }

  hydrateManager(root, manager, false);
  manager.isScanBuild = false;
  await builder.build(ssr);
  if (rscInsideSsr && fs.existsSync(tempRscOutDir)) {
    fs.rmSync(rscOutDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(rscOutDir), { recursive: true });
    fs.renameSync(tempRscOutDir, rscOutDir);
  }
  const manifestCode = readIsolationState(root).assetsManifestCode;
  if (manifestCode) {
    for (const outDir of [rscOutDir, ssrOutDir]) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, ASSETS_MANIFEST_FILE), manifestCode);
    }
  }
  manager.writeEnvironmentImportsManifest();
}

export function createIsolatedRscBuildPlugin(options: {
  getManager: (config: ResolvedConfig) => Promise<RscPluginManager | undefined>;
}): Plugin {
  return {
    name: "vinext:isolated-rsc-build",
    apply: "build",
    buildApp: {
      order: "pre",
      async handler(builder) {
        const phase = isolationBuildPhase();
        if (!phase) return;
        const manager = await options.getManager(builder.config);
        if (!manager) {
          throw new Error(
            "[vinext] Isolated build could not find the RSC plugin. Set VINEXT_BUILD_ISOLATION=0 to build in one process.",
          );
        }
        await runIsolatedPhase(builder, manager, phase);
        if (phase !== "nitro") process.exit(0);
      },
    },
  };
}

export function runIsolatedProductionBuild(options: {
  execPath: string;
  cliPath: string;
  args: string[];
  cwd: string;
  root: string;
}): void {
  fs.rmSync(isolationStatePath(options.root), { force: true });
  for (const [index, phase] of ISOLATED_RSC_BUILD_PHASES.entries()) {
    console.log(
      `\n[vinext] isolated build ${index + 1}/${ISOLATED_RSC_BUILD_PHASES.length} ${phase}`,
    );
    const child = spawnSync(options.execPath, [options.cliPath, "build", ...options.args], {
      cwd: options.cwd,
      stdio: "inherit",
      env: { ...process.env, VINEXT_BUILD_ISOLATION_PHASE: phase },
    });
    if (child.error) throw child.error;
    if ((child.status ?? 1) !== 0) process.exit(child.status ?? 1);
  }
}
