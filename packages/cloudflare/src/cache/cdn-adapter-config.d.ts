type WranglerWorkerExport = {
  cache?: {
    enabled: boolean;
  };
  type?: string;
  [key: string]: unknown;
};
type WranglerOutputConfig = {
  compatibility_date?: string;
  compatibility_flags?: string[];
  exports?: Record<string, WranglerWorkerExport>;
  version_metadata?: unknown;
  [key: string]: unknown;
};
type VersionMetadataOptions = {
  binding: string;
  bindingIsExplicit: boolean;
};
export declare function configureCdnVersionMetadata(
  config: WranglerOutputConfig,
  options: VersionMetadataOptions,
): WranglerOutputConfig;
/** Add the per-entrypoint Workers Cache policy to an emitted Wrangler config. */
export declare function configureWorkersCacheEntrypoints(
  config: WranglerOutputConfig,
): WranglerOutputConfig;
/** Apply the complete CDN adapter policy to the primary generated config. */
export declare function finalizeCdnAdapterBuildOutput({
  outDir,
  isPrimaryServerOutput,
  binding,
  bindingIsExplicit,
}: {
  outDir: string;
  isPrimaryServerOutput: boolean;
  binding: string;
  bindingIsExplicit: boolean;
}): Promise<void>;
export {};
