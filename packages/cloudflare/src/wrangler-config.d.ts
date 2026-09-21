/** Narrow Wrangler config projection shared by deploy-time features. */
type WranglerConfig = {
  accountId?: string;
  kvNamespaceId?: string;
  customDomain?: string;
  name?: string;
  legacyEnv?: boolean;
  env?: Record<string, WranglerEnvironmentConfig>;
};
type WranglerEnvironmentConfig = {
  customDomain?: string;
  name?: string;
};
/**
 * Parse the Wrangler fields used by TPR and staged CDN warming.
 */
export declare function parseWranglerConfig(
  root: string,
  configPath?: string,
): WranglerConfig | null;
export {};
