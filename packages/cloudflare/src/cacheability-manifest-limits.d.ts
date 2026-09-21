export declare const MAX_CACHEABILITY_MANIFEST_BYTES: number;
export declare function cacheabilityManifestByteLimitError(
  manifestBytes: number,
  limit?: number,
): Error;
