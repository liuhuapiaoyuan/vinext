/**
 * Deploy-time KV population for App Router prerendered artifacts.
 *
 * Reads `dist/server/vinext-prerender.json` and `dist/server/prerendered-routes/*`,
 * converts rendered App Router HTML/RSC artifacts into the same serialized
 * KVCacheEntry shape written by KVCacheHandler.set(), and returns Wrangler KV
 * bulk import records for deploy-time upload.
 */
export type KVBulkPair = {
  key: string;
  value: string;
  expiration_ttl?: number;
  metadata?: Record<string, unknown>;
};
export declare function buildPrerenderKVPairs(
  serverDir: string,
  options?: {
    appPrefix?: string;
    now?: number;
    ttlSeconds?: number;
  },
): {
  routeCount: number;
  pairs: KVBulkPair[];
};
