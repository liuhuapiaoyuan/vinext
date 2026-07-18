import {
  type PrerenderManifest,
  type PrerenderedPathSelectionOptions,
} from "vinext/internal/server/prerender-manifest";
export type CdnWarmOptions = {
  targetUrl: string;
  paths: readonly string[];
  headers?: HeadersInit;
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  strict?: boolean;
  fetchImpl?: typeof fetch;
};
export declare const DEFAULT_CDN_WARM_TIMEOUT_MS = 5000;
export type PrerenderCdnWarmOptions = Omit<CdnWarmOptions, "paths"> & {
  root: string;
  includeFallbackShells?: boolean;
};
export type CdnWarmResult = {
  total: number;
  warmed: number;
  failed: number;
  failures: Array<{
    path: string;
    error: string;
  }>;
};
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
export declare function warmCdnCache(options: CdnWarmOptions): Promise<CdnWarmResult>;
export declare function warmCdnCacheFromPrerender(
  options: PrerenderCdnWarmOptions,
): Promise<CdnWarmResult>;
