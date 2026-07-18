/** Key prefix for cache entries. */
export declare const ENTRY_PREFIX = "cache:";
export type KvKeySpace = {
  /** Prefix shared by every cache entry, including entries with hashed logical keys. */
  entryPrefix: string;
  entryKey(logicalKey: string): string;
  tagKey(tag: string): string;
};
/**
 * Create the deterministic key namespace shared by runtime cache operations
 * and deploy-time prerender population.
 */
export declare function createKvKeySpace(appPrefix: string | undefined): KvKeySpace;
