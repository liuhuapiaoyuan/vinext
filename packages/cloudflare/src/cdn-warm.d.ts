import {
  type PrerenderPathManifest,
  type PrerenderRoutePattern,
} from "vinext/internal/build/prerender-paths";
import {
  type PrerenderManifest,
  type PrerenderedPathSelectionOptions,
} from "vinext/internal/server/prerender-manifest";
export type CdnWarmOptions = {
  targetUrl: string;
  paths: readonly string[];
  /** Pages Router JSON data identities used by client navigation. */
  pagesDataPaths?: readonly string[];
  /** Statically eligible App Route Handler request identities. */
  routeHandlerPaths?: readonly string[];
  routePatterns?: Readonly<Record<string, PrerenderRoutePattern>>;
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
  /** Bound the whole warm phase, including queued targets and retries. */
  phaseTimeoutMs?: number;
  /** Retry a newly staged version or preview alias until its routing has propagated. */
  propagatingTarget?: boolean;
  /** @internal Matching skipped targets that may be transient while a staged version propagates. */
  retrySkippedTargetKeys?: ReadonlySet<string>;
  /** Require the response to come from a reusable cache entry, not merely an eligible MISS. */
  requireCacheHit?: boolean;
  strict?: boolean;
  /** Cache-admission signal exposed by the deployed adapter. */
  statusSource?: "cloudflare" | "data-cache" | "vinext";
  fetchImpl?: typeof fetch;
};
export declare const DEFAULT_CDN_WARM_CONCURRENCY = 25;
export declare const DEFAULT_CDN_WARM_TIMEOUT_MS = 10000;
export declare const DEFAULT_STAGED_READINESS_RETRIES = 60;
export declare const DEFAULT_STAGED_READINESS_INTERVAL_MS = 1000;
export declare const DEFAULT_STAGED_READINESS_PHASE_TIMEOUT_MS = 120000;
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
  skippedTargets: CdnWarmTarget[];
  warmedPlan: CdnWarmRequestPlan;
  retryPlan: CdnWarmRequestPlan;
};
export type CdnWarmRequestPlan = {
  loadingShellPaths: string[];
  pagesDataPaths: string[];
  paths: string[];
  rscPaths: string[];
  routeHandlerPaths?: string[];
  routePatterns?: Record<string, PrerenderRoutePattern>;
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
  appPaths?: string[];
  buildId?: string;
  buildIdentity?: string;
  deploymentId?: string;
  fallbackRoutePatterns?: PrerenderRoutePattern[];
  loadingShellPaths: string[];
  pagesDataPaths?: string[];
  pagesPaths?: string[];
  paths: string[];
  routeHandlerPaths?: string[];
  routePatterns?: Record<string, PrerenderRoutePattern>;
  rscBuildId?: string;
  rscPaths: string[];
};
type PrerenderWarmPlanOptions = {
  includeCanonicalRsc?: boolean;
  includeFallbackShells?: boolean;
  strict?: boolean;
};
export declare function createPrerenderWarmPlan(
  root: string,
  manifest: PrerenderPathManifest,
  options?: PrerenderWarmPlanOptions,
): PrerenderWarmPlan;
export declare function readPrerenderWarmPlan(
  root: string,
  options?: PrerenderWarmPlanOptions,
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
export type CdnWarmTarget = {
  headers?: HeadersInit;
  kind: "app-route" | "html" | "pages-data" | "rsc-full" | "rsc-loading-shell";
  label: string;
  pathname: string;
  sourcePathname: string;
  route?: PrerenderRoutePattern;
};
export declare function createCdnWarmTargets(
  options: Pick<
    CdnWarmOptions,
    | "deploymentId"
    | "headers"
    | "loadingShellPaths"
    | "pagesDataPaths"
    | "paths"
    | "routeHandlerPaths"
    | "routePatterns"
    | "rscPaths"
  >,
): Promise<CdnWarmTarget[]>;
export declare class CdnOperationProgress {
  private readonly isTTY;
  private lastLineLength;
  update(completed: number, total: number, label: string, phase?: string): void;
  finish(): void;
}
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
    phaseTimeoutMs?: number;
    prerenderSecret?: string;
    probeIntervalMs?: number;
    requiredConsecutiveSuccesses?: number;
  },
): Promise<CdnWarmReadinessResult>;
export declare function warmCdnCache(options: CdnWarmOptions): Promise<CdnWarmResult>;
export declare function warmCdnCacheFromPrerender(
  options: PrerenderCdnWarmOptions,
): Promise<CdnWarmResult>;
export {};
