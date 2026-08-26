import {
  type PrerenderManifest,
  type PrerenderedPathSelectionOptions,
} from "vinext/internal/server/prerender-manifest";
export type CdnWarmOptions = {
  targetUrl: string;
  paths: readonly string[];
  /** App Router ISR paths whose definitive client-navigation payload is warmed. */
  rscPaths?: readonly string[];
  /** App Router paths whose deterministic loading-boundary payload is warmed. */
  loadingShellPaths?: readonly string[];
  /** Build identity that the warmed RSC response must have been rendered by. */
  expectedRscBuildId?: string;
  /** Application build identity stamped by the configured CDN adapter. */
  expectedBuildId?: string;
  deploymentId?: string;
  headers?: HeadersInit;
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  /** Retry a newly staged version or preview alias until its routing has propagated. */
  propagatingTarget?: boolean;
  strict?: boolean;
  fetchImpl?: typeof fetch;
};
export declare const DEFAULT_CDN_WARM_CONCURRENCY = 25;
export declare const DEFAULT_CDN_WARM_TIMEOUT_MS = 10000;
export type PrerenderCdnWarmOptions = Omit<CdnWarmOptions, "paths"> & {
  root: string;
  includeFallbackShells?: boolean;
  /** Use the manifest build identity unless the configured adapter cannot expose it. */
  validateBuildIdentity?: boolean;
};
export type CdnWarmResult = {
  total: number;
  warmed: number;
  skipped: number;
  failed: number;
  failures: Array<{
    path: string;
    error: string;
  }>;
  retryPlan: CdnWarmRequestPlan;
};
export type CdnWarmRequestPlan = {
  loadingShellPaths: string[];
  paths: string[];
  rscPaths: string[];
};
export type CdnWarmReadinessResult =
  | {
      ready: true;
    }
  | {
      error: string;
      ready: false;
    };
export type PrerenderWarmPlan = {
  buildId?: string;
  buildIdentity?: string;
  deploymentId?: string;
  loadingShellPaths: string[];
  paths: string[];
  rscBuildId?: string;
  rscPaths: string[];
};
export declare function readPrerenderWarmPlan(
  root: string,
  options?: {
    includeFallbackShells?: boolean;
    strict?: boolean;
  },
): PrerenderWarmPlan;
export declare function readPrerenderWarmPaths(
  root: string,
  options?: {
    includeFallbackShells?: boolean;
    strict?: boolean;
  },
): string[];
export declare function getWarmPathsFromPrerenderManifest(
  manifest: PrerenderManifest,
  options?: PrerenderedPathSelectionOptions,
): string[];
export declare function buildWarmupUrl(targetUrl: string, pathname: string): URL;
/**
 * Wait until version-override requests consistently reach the uploaded build
 * before any real cache key is filled. Every probe has a unique query key, so
 * an early response cannot make a later readiness attempt pass from cache.
 */
export declare function waitForCdnWarmTargetReadiness(
  options: Pick<
    CdnWarmOptions,
    | "deploymentId"
    | "expectedBuildId"
    | "expectedRscBuildId"
    | "fetchImpl"
    | "headers"
    | "retries"
    | "targetUrl"
    | "timeoutMs"
  > & {
    plan: CdnWarmRequestPlan;
    maxAttempts?: number;
    probeIntervalMs?: number;
    requiredConsecutiveSuccesses?: number;
  },
): Promise<CdnWarmReadinessResult>;
export declare function warmCdnCache(options: CdnWarmOptions): Promise<CdnWarmResult>;
export declare function warmCdnCacheFromPrerender(
  options: PrerenderCdnWarmOptions,
): Promise<CdnWarmResult>;
