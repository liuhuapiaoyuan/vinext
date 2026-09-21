/**
 * vinext-cloudflare deploy — one-command Cloudflare Workers deployment.
 *
 * Takes any Next.js app and deploys it to Cloudflare Workers:
 *
 *   1. Validates the project was prepared by `vinext init --platform=cloudflare`
 *   2. Runs the Vite build
 *   3. Deploys to Cloudflare Workers via Wrangler
 */
import { spawn } from "node:child_process";
import { type VinextCacheConfig } from "vinext/internal/config/prerender";
import { type ProjectInfo } from "vinext/internal/utils/project";
import { type TrafficEntry } from "./tpr.js";
import { parseWranglerConfig } from "./wrangler-config.js";
import {
  type CdnWarmOptions,
  type CdnWarmRequestPlan,
  type PrerenderWarmPlan,
} from "./cdn-warm.js";
import { type WranglerDeploymentStatus, type WranglerVersionTraffic } from "./version-deploy.js";
import { type KVBulkPair } from "./prerender-kv-populate.js";
export declare const DEFAULT_CDN_WARM_PROMOTION_DELAY_MS = 15000;
export type DeployOptions = {
  /** Project root directory */
  root: string;
  /** Deploy to preview environment (default: production) */
  preview?: boolean;
  /** Wrangler environment name from wrangler.jsonc env.<name> */
  env?: string;
  /** Custom project name for the Worker */
  name?: string;
  /** Wrangler config path, relative to root unless absolute */
  config?: string;
  /** Skip the build step (assume already built) */
  skipBuild?: boolean;
  /** Dry run — validate setup but don't build or deploy */
  dryRun?: boolean;
  /** Print raw output from internal Wrangler commands. */
  verbose?: boolean;
  /** Pre-render all discovered routes into the dist output after building */
  prerenderAll?: boolean;
  /** Maximum number of routes to prerender in parallel */
  prerenderConcurrency?: number;
  /** Warm Cloudflare's CDN cache by requesting build-discovered paths for the uploaded version */
  warmCdnCache?: boolean;
  /** Explicit production origin to use for CDN discovery, probing, and warming */
  warmCdnTarget?: string;
  /** Maximum number of CDN warmup requests to issue in parallel */
  warmCdnConcurrency?: number;
  /** Per-request CDN warmup timeout in milliseconds */
  warmCdnTimeout?: number;
  /** Number of CDN warmup retries for transient failures */
  warmCdnRetries?: number;
  /** Maximum duration of staged Worker path discovery */
  warmCdnDiscoveryTimeout?: number;
  /** Number of transient staged Worker path discovery retries */
  warmCdnDiscoveryRetries?: number;
  /** Abort after this duration without a completed cacheability probe */
  warmCdnProbeTimeout?: number;
  /** Number of transient staged Worker cacheability probe retries */
  warmCdnProbeRetries?: number;
  /** Re-request warmed identities and require reusable CDN hits before promotion */
  warmCdnCertify?: boolean;
  /** Maximum duration of staged Worker readiness verification */
  warmCdnReadinessTimeout?: number;
  /** Number of staged Worker readiness retries */
  warmCdnReadinessRetries?: number;
  /** Consecutive successful probes required before warming the staged Worker */
  warmCdnReadinessProbes?: number;
  /** Delay between staged Worker readiness probes in milliseconds */
  warmCdnReadinessProbeDelay?: number;
  /** Promote even when staged CDN warmup cannot be completed */
  dangerouslyPromoteOnCdnWarmError?: boolean;
  /** Promote the uploaded Worker version to 100% traffic (default: true) */
  warmCdnPromote?: boolean;
  /** Delay between successful warmup and promotion in milliseconds */
  warmCdnPromotionDelay?: number;
  /** Include PPR fallback-shell placeholder paths during CDN warmup */
  warmCdnIncludeFallbacks?: boolean;
  /** Select CDN pre-warm routes using traffic analytics */
  experimentalTPR?: boolean;
  /** TPR: traffic coverage percentage target (0–100, default: 90) */
  tprCoverage?: number;
  /** TPR: hard cap on selected routes (default: 1000) */
  tprLimit?: number;
  /** TPR: analytics lookback window in hours (default: 24) */
  tprWindow?: number;
};
export declare function parseDeployArgs(args: string[]): {
  help: boolean;
  preview: boolean;
  env: string | undefined;
  name: string | undefined;
  config: string | undefined;
  skipBuild: boolean;
  dryRun: boolean;
  verbose: boolean;
  prerenderAll: boolean;
  prerenderConcurrency: number | undefined;
  warmCdnCache: boolean;
  warmCdnTarget: string | undefined;
  warmCdnConcurrency: number | undefined;
  warmCdnTimeout: number | undefined;
  warmCdnRetries: number | undefined;
  warmCdnDiscoveryTimeout: number | undefined;
  warmCdnDiscoveryRetries: number | undefined;
  warmCdnProbeTimeout: number | undefined;
  warmCdnProbeRetries: number | undefined;
  warmCdnCertify: boolean;
  warmCdnReadinessTimeout: number | undefined;
  warmCdnReadinessRetries: number | undefined;
  warmCdnReadinessProbes: number | undefined;
  warmCdnReadinessProbeDelay: number | undefined;
  dangerouslyPromoteOnCdnWarmError: boolean;
  warmCdnPromote: boolean;
  warmCdnPromotionDelay: number | undefined;
  warmCdnIncludeFallbacks: boolean;
  experimentalTPR: boolean;
  tprCoverage: number | undefined;
  tprLimit: number | undefined;
  tprWindow: number | undefined;
};
/**
 * Run a function with `process.env.CLOUDFLARE_ENV` set to the given value,
 * restoring the previous state (whether set or absent) after the function
 * resolves or throws.
 *
 * The `@cloudflare/vite-plugin` reads `CLOUDFLARE_ENV` from `process.env` to
 * drive the multi-environment merge applied to the emitted `wrangler.json`.
 * Without this propagation the `--env <name>` CLI flag is silently ignored at
 * build time and the top-level config is emitted regardless. See issue #1210.
 *
 * Passing `undefined` is a no-op; the callback runs with `process.env` untouched.
 */
export declare function withCloudflareEnv<T>(
  env: string | undefined,
  fn: () => Promise<T>,
): Promise<T>;
type WranglerDeployArgs = {
  args: string[];
  env: string | undefined;
};
type WranglerKVBulkPutArgs = {
  args: string[];
  env: string | undefined;
};
export declare function validateWranglerEnvName(env: string): string;
export declare function buildWranglerDeployArgs(
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config">,
): WranglerDeployArgs;
export declare function buildWranglerKVBulkPutArgs(options: {
  binding: string;
  env?: string;
  filePath: string;
}): WranglerKVBulkPutArgs;
/**
 * Resolve Wrangler's JavaScript CLI entrypoint in node_modules.
 *
 * Invoking the JavaScript file through `process.execPath` avoids the `.cmd`
 * shim and command shell that package managers create on Windows.
 */
export declare function resolveWranglerBin(
  root: string,
  resolvePackageJson?: (root: string) => string | null,
): string;
export declare function buildNodeCliInvocation(
  scriptPath: string,
  args: string[],
  nodeExecutable?: string,
): {
  file: string;
  args: string[];
};
export declare function buildWranglerInvocation(
  root: string,
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config">,
  nodeExecutable?: string,
): {
  file: string;
  args: string[];
  env: string | undefined;
};
export declare function runWranglerKVBulkPut(
  root: string,
  options: {
    binding: string;
    env?: string;
    pairs: KVBulkPair[];
    tempDir?: string;
  },
  execute?: typeof spawn,
  nodeExecutable?: string,
): Promise<void>;
export declare function runWranglerDeploy(
  root: string,
  options: Pick<DeployOptions, "preview" | "env" | "name" | "config" | "verbose"> & {
    promote?: boolean;
  },
  execute?: typeof spawn,
): Promise<string>;
export declare function hasCdnWarmRequests(
  plan: Omit<CdnWarmRequestPlan, "pagesDataPaths"> & {
    pagesDataPaths?: readonly string[];
  },
): boolean;
export declare function selectTPRWarmPlan(
  plan: PrerenderWarmPlan,
  traffic: readonly TrafficEntry[],
  coverage: number,
  limit: number,
): PrerenderWarmPlan;
export declare function projectRequiresRouteCacheabilityProbeManifest(
  project: Pick<ProjectInfo, "isAppRouter" | "isPagesRouter">,
  cacheConfig: VinextCacheConfig | null,
): boolean;
type CdnWarmDeployOptions = Pick<
  DeployOptions,
  | "preview"
  | "env"
  | "name"
  | "config"
  | "verbose"
  | "warmCdnTarget"
  | "warmCdnConcurrency"
  | "warmCdnTimeout"
  | "warmCdnRetries"
  | "warmCdnDiscoveryTimeout"
  | "warmCdnDiscoveryRetries"
  | "warmCdnProbeTimeout"
  | "warmCdnProbeRetries"
  | "warmCdnCertify"
  | "warmCdnReadinessTimeout"
  | "warmCdnReadinessRetries"
  | "warmCdnReadinessProbes"
  | "warmCdnReadinessProbeDelay"
  | "dangerouslyPromoteOnCdnWarmError"
  | "warmCdnPromote"
  | "warmCdnPromotionDelay"
> &
  Pick<
    CdnWarmOptions,
    | "deploymentId"
    | "expectedBuildId"
    | "expectedRscBuildId"
    | "loadingShellPaths"
    | "pagesDataPaths"
    | "routeHandlerPaths"
    | "routePatterns"
    | "rscPaths"
    | "statusSource"
  > & {
    /** Allow optional route selection to discover no warmable requests. */
    allowEmptyWarmPlan?: boolean;
    /** Probe a staged Worker and upload the resulting manifest as a second version. */
    cacheabilityProbe?: boolean;
    discoverWarmPlan?: (target: {
      headers?: HeadersInit;
      targetUrl: string;
    }) => Promise<PrerenderWarmPlan>;
    /** Narrow the final warm requests without changing discovery or probe metadata. */
    selectWarmPlan?: (plan: PrerenderWarmPlan) => PrerenderWarmPlan;
  };
export declare function deployWithCdnWarmup(
  root: string,
  paths: readonly string[],
  options: CdnWarmDeployOptions,
): Promise<string>;
export declare function resolveCdnWarmupTargetUrl(
  root: string,
  deployedUrl: string | null,
): string | null;
export declare function resolveCdnWarmupTargetUrl(
  root: string,
  deployedUrl: string | null,
  options: Pick<DeployOptions, "preview" | "env" | "config" | "warmCdnTarget">,
): string | null;
export declare function getZeroPercentStagingTraffic(
  deployment: WranglerDeploymentStatus | null,
  versionId: string,
): WranglerVersionTraffic[] | null;
type ParsedWranglerConfig = NonNullable<ReturnType<typeof parseWranglerConfig>>;
export declare function resolveWorkerNameForVersionOverride(
  config: ParsedWranglerConfig | null,
  options: Pick<DeployOptions, "preview" | "env" | "name">,
): string | undefined;
export declare function buildVersionOverrideHeaders(
  workerName: string | undefined,
  versionId: string,
): HeadersInit | undefined;
export declare function deploy(options: DeployOptions): Promise<void>;
export {};
