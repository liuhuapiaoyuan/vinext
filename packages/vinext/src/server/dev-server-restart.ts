import path from "node:path";
import { findNextConfigPath } from "../config/next-config.js";
import { normalizePathSeparators } from "../utils/path.js";

type DevServerRestartPolicyConfig = {
  configFile: string | false;
  configFileDependencies: string[];
};

/**
 * Absolute paths whose changes should trigger a Vite dev-server restart via
 * `configFileDependencies`.
 *
 * Vite also restarts on `.env*` file changes through its built-in env watcher.
 * vinext narrows `configFileDependencies` to only the loaded vite config and
 * next.config so edits to imported helpers (tailwind.config, etc.) do not tear
 * down the dev server.
 */
export function getDevServerRestartWatchPaths(
  config: Pick<DevServerRestartPolicyConfig, "configFile">,
  root: string,
): string[] {
  const paths: string[] = [];

  if (config.configFile) {
    paths.push(normalizePathSeparators(path.resolve(config.configFile)));
  }

  const nextConfigPath = findNextConfigPath(normalizePathSeparators(root));
  if (nextConfigPath) {
    paths.push(normalizePathSeparators(path.resolve(nextConfigPath)));
  }

  return paths;
}

/**
 * Apply vinext's dev-server restart policy to a fully resolved Vite config.
 *
 * Call from `configResolved` during `serve` (not preview): drop transitive
 * vite-config imports from `configFileDependencies` and keep only vite/next
 * config entrypoints.
 */
export function applyDevServerRestartPolicy(
  config: DevServerRestartPolicyConfig,
  root: string,
): void {
  config.configFileDependencies = getDevServerRestartWatchPaths(config, root);
}
