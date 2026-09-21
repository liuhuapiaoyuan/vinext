import { type CacheabilityManifest } from "vinext/internal/server/cacheability-manifest";
/**
 * Write the version-specific manifest into the built Worker artifact.
 * The application build already imports this stable module asset, so the
 * completed dist directory remains the exact input to the final upload.
 */
export declare function writeCacheabilityManifestArtifact(
  root: string,
  configuredPath: string | undefined,
  manifest: CacheabilityManifest,
): string;
