/**
 * TPR: traffic-aware pre-warm route selection
 *
 * Uses Cloudflare zone analytics to determine which routes should be fed into
 * the standard CDN pre-warming flow.
 *
 * Flow:
 *   1. Parse wrangler config to find the custom domain
 *   2. Resolve the Cloudflare zone for the custom domain
 *   3. Query zone analytics (GraphQL) for top pages by request count
 *   4. Return the ranked candidates for standard route resolution and selection
 *
 * TPR is an experimental feature enabled via
 * --experimental-traffic-aware-warm-cache. It gracefully skips when no custom
 * domain, API token, or traffic data exists.
 */
import { parseWranglerConfig } from "./wrangler-config.js";
export { parseWranglerConfig };
export type TPROptions = {
  /** Project root directory. */
  root: string;
  /** Wrangler config path, relative to root unless absolute. */
  config?: string;
  /** Wrangler environment whose custom domain should be analyzed. */
  env?: string;
  /** Explicit domain used to resolve the analytics zone, overriding Wrangler routes. */
  hostname?: string;
  /** Analytics lookback window in hours. Default: 24. */
  window: number;
};
export type TPRRouteResult = {
  routes: TrafficEntry[];
  /** If TPR was skipped, the reason. */
  skipped?: string;
};
export type TrafficEntry = {
  path: string;
  requests: number;
};
export type SelectedRoutes = {
  routes: TrafficEntry[];
  totalRequests: number;
  coveredRequests: number;
  coveragePercent: number;
};
/**
 * Generate zone lookup candidates from shortest (2-part) to longest.
 * Tries the most common case first (e.g., "example.com") and progressively
 * adds labels for multi-part TLDs (e.g., "co.uk" → "example.co.uk").
 *
 * "shop.example.com"    → ["example.com", "shop.example.com"]
 * "shop.example.co.uk"  → ["co.uk", "example.co.uk", "shop.example.co.uk"]
 * "example.com"         → ["example.com"]
 */
export declare function domainCandidates(domain: string): string[];
/** Filter out non-page requests (static assets, API routes, internal routes). */
export declare function filterTrafficPaths(entries: TrafficEntry[]): TrafficEntry[];
/**
 * Walk the ranked traffic list, accumulating request counts until the
 * coverage target is met or the hard cap is reached.
 */
export declare function selectRoutes(
  traffic: TrafficEntry[],
  coverageTarget: number,
  limit: number,
): SelectedRoutes;
/**
 * Resolve ranked traffic paths. The standard CDN pre-warming flow owns route
 * matching, coverage selection, rendering, and cache admission.
 */
export declare function resolveTPRRoutes(options: TPROptions): Promise<TPRRouteResult>;
