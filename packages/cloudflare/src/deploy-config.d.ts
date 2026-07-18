import type { VinextCacheConfig } from "vinext/internal/cache-adapters";
/**
 * Check whether an existing vite.config file already imports and uses the
 * Cloudflare Vite plugin. This is a heuristic text scan — it doesn't execute
 * the config — so it may produce false negatives for unusual configurations.
 *
 * Returns true when the config both imports the package and invokes
 * `cloudflare(...)` in the plugin list.
 */
export declare function viteConfigHasCloudflarePlugin(root: string): boolean;
/**
 * Detect whether the Vite config assigns a CDN or data cache adapter — i.e. the
 * `cdn` or `data` field of the `vinext({ cache })` option is given a value.
 * This is a source-level check on those exact object fields, not a fuzzy scan
 * for adapter names. Mirrors {@link viteConfigHasCloudflarePlugin}'s leniency:
 * an unreadable or absent config is treated as configured so a deploy is never
 * blocked on a false negative.
 */
export declare function viteConfigHasCacheAdapter(root: string): boolean;
export type ResolvedKvDataAdapterConfig = {
  binding: string;
  appPrefix?: string;
  ttlSeconds?: number;
};
export declare function resolveKvDataAdapterConfig(
  cache: VinextCacheConfig | null | undefined,
): ResolvedKvDataAdapterConfig | null;
export declare function viteConfigHasImageAdapter(root: string): boolean;
/**
 * Detect whether an existing user-authored Worker entry wires up a cache
 * backend imperatively via one of the `setCacheHandler` / `setDataCacheHandler`
 * / `setCdnCacheAdapter` setters. These setters are deprecated in favour of the
 * declarative `vinext({ cache })` option, but older apps that scaffolded a KV
 * cache handler into their Worker entry must keep working — so a deploy should
 * not be blocked when the Worker entry already configures a backend.
 *
 * This is a heuristic text scan (it doesn't execute the entry), mirroring
 * {@link viteConfigHasCacheAdapter}'s leniency: an unreadable Worker entry is
 * treated as configured so a deploy is never blocked on a false negative. A
 * missing Worker entry returns false (nothing to inspect — defer to other
 * checks).
 */
export declare function workerEntryHasCacheHandler(root: string): boolean;
/**
 * Build the error thrown when an ISR/cached app is deployed without a cache
 * adapter configured in the Vite config. Production deployments need a
 * persistent cache backend; vinext no longer scaffolds one into the Worker
 * entry, so it must be declared via `vinext({ cache })`.
 */
export declare function formatMissingCacheAdapterError(options: { configFile?: string }): string;
export declare function formatImageOptimizationHint(): string;
