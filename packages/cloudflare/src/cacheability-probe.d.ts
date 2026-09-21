import { type CacheabilityManifest } from "vinext/internal/server/cacheability-manifest";
import type { PrerenderRoutePattern } from "vinext/internal/build/prerender-paths";
import type { CdnWarmTarget } from "./cdn-warm.js";
export declare const DEFAULT_CACHEABILITY_PROBE_PHASE_TIMEOUT_MS = 120000;
export declare const DEFAULT_CACHEABILITY_PROBE_RETRIES = 2;
export declare const DEFAULT_CACHEABILITY_PROBE_RETRY_DELAY_MS = 1000;
export type CacheabilityProbeProgress = {
  completed: number;
  dynamic: number;
  failed: number;
  probed: number;
  skipped: number;
  static: number;
  total: number;
};
export type CacheabilityProbeResult = {
  cacheableTargets: CdnWarmTarget[];
  classified: number;
  dynamic: number;
  failures: string[];
  manifest: CacheabilityManifest;
  probed: number;
  skipped: number;
  /** Paired representations admitted only if their own final warm render remains cacheable. */
  speculativeTargets: CdnWarmTarget[];
};
export declare function readPrerenderSecret(root: string): string;
export declare function probeStagedWorkerCacheability(options: {
  buildId: string;
  concurrency?: number;
  expectedResponseBuildId?: string;
  fallbackRoutePatterns?: readonly PrerenderRoutePattern[];
  fetchImpl?: typeof fetch;
  headers?: HeadersInit;
  retries?: number;
  retryDelayMs?: number;
  root: string;
  targets: readonly CdnWarmTarget[];
  targetUrl: string;
  timeoutMs?: number;
  phaseTimeoutMs?: number;
  onProgress?: (progress: CacheabilityProbeProgress) => void;
  /** @internal Apply stricter artifact bounds for focused coordinator tests. */
  manifestLimits?: {
    maxBytes?: number;
  };
}): Promise<CacheabilityProbeResult>;
