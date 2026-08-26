export declare function parseWorkerDeploymentUrl(output: string): string | null;
/**
 * Parse the concrete hostname that Wrangler reports after applying Worker
 * triggers. Catch-all routes are valid warmup targets even though they are not
 * canonical deployment URLs for general CLI reporting.
 */
export declare function parseCdnWarmupDeploymentUrl(output: string): string | null;
