export declare const DEFAULT_CDN_VERSION_METADATA_BINDING = "CF_VERSION_METADATA";
/** Options accepted by {@link cdnAdapter}, forwarded to the runtime factory. */
export type CdnAdapterOptions = {
  /** Version metadata binding used to verify version-overridden requests. */
  versionMetadataBinding?: string;
};
/**
 * Cloudflare CDN cache adapter - edge-managed page-level ISR backed by the
 * Cloudflare Workers Cache.
 *
 * Unlike the data adapter (which stores cache entries in a durable store and
 * serves HIT/STALE itself), this adapter delegates serving to Workers Cache on
 * a named Worker entrypoint. The default entrypoint always runs middleware and
 * request-time routing before dispatching to cached or uncached response-stage
 * entrypoints.
 *
 * The emitted Wrangler configuration enables Workers Cache only for that
 * response-stage export, so cache hits do not start the application stage.
 * The generated deployment config automatically enables Workers Cache for the
 * cached response entrypoint and adds the version metadata binding used by
 * warmup. The uncached response entrypoint keeps bypass and probe renders out
 * of the gateway without enabling Workers Cache for them.
 *
 * The adapter adds a transport-only URL digest so distinct response-stage
 * identities cannot collide. Workers Cache owns this key independently of
 * zone Cache Rules.
 */
export declare function cdnAdapter(options?: CdnAdapterOptions): {
  adapter: string;
  options: CdnAdapterOptions | undefined;
  output: {
    entry: string;
    matchesBuild({
      plugins,
    }: {
      plugins: readonly {
        name?: string;
      }[];
    }): boolean;
    transformHostEntry({ code, id }: { code: string; id: string }): string | null;
    finalizeBuildOutput({
      outDir,
      isPrimaryServerOutput,
    }: {
      outDir: string;
      isPrimaryServerOutput: boolean;
    }): Promise<void>;
    type: "multi-stage";
  };
  capabilities: {
    buildIdentity: "response-header";
    isResponsePolicyHeader: (name: string) => boolean;
    requestRouting: "uncached-stage";
    responseVary: "verbatim";
    routeCacheability: "probe-manifest";
  };
};
