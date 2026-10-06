import type { RscPluginManager } from "@vitejs/plugin-rsc";
import type { BuildEnvironment, Plugin, ResolvedConfig, ViteBuilder } from "vite";

/**
 * plugin-rsc keeps each environment's Rollup output on `manager.bundles`.
 * Those objects hold chunk source, per-module source, and sourcemaps until
 * the whole build exits, so later environments stack on top of them.
 * Metadata needed by later stages (file names, module ids, CSS asset bytes)
 * stays. Source text is dropped as soon as the stage that reads it has finished.
 */
export type ReleaseableBundleOutput = {
  type: string;
  code?: string;
  modules?: Record<string, unknown>;
  map?: unknown;
  source?: string | Uint8Array;
};

export type ReleaseableBundles = Record<
  string,
  Record<string, ReleaseableBundleOutput> | undefined
>;

export function releaseEnvironmentBundle(
  bundles: ReleaseableBundles,
  environmentName: string,
  keepMetadata: boolean,
): void {
  if (!keepMetadata) {
    delete bundles[environmentName];
    return;
  }

  const bundle = bundles[environmentName];
  if (!bundle) return;
  for (const output of Object.values(bundle)) {
    if (output.type === "chunk") {
      output.code = "";
      output.modules = {};
      output.map = null;
    }
  }

  // The client build copies RSC CSS and other assets during its own
  // generateBundle. After that copy, the bytes are in the client output.
  if (environmentName === "client") {
    const rscBundle = bundles.rsc;
    if (!rscBundle) return;
    for (const output of Object.values(rscBundle)) {
      if (output.type === "asset") output.source = "";
    }
  }
}

function collectGarbage(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
}

function logResidentMemory(label: string): void {
  if (process.env.VINEXT_BUILD_RSS !== "1") return;
  const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  console.log(`[vinext] rss before ${label}: ${rssMb} MB`);
}

export function createReleaseRscBuildMemoryPlugin(options: {
  getManager: (config: ResolvedConfig) => Promise<RscPluginManager | undefined>;
}): Plugin {
  let wrapped = false;
  return {
    name: "vinext:release-rsc-build-memory",
    apply: "build",
    buildApp: {
      order: "pre",
      async handler(builder: ViteBuilder) {
        if (wrapped) return;
        wrapped = true;
        const build = builder.build.bind(builder);
        builder.build = async (environment: BuildEnvironment) => {
          // The previous build's return value is only dead after that await
          // finished, so collect at the start of the next environment.
          collectGarbage();
          logResidentMemory(environment.name);
          const output = await build(environment);
          const manager = await options.getManager(builder.config);
          if (manager) {
            releaseEnvironmentBundle(
              manager.bundles as ReleaseableBundles,
              environment.name,
              environment.config.build.write !== false,
            );
          }
          return output;
        };
      },
    },
  };
}
