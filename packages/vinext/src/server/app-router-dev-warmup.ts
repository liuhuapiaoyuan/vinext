import type { Logger, ViteDevServer } from "vite";

export type AppRouterDevWarmupTargets = {
  rsc: readonly string[];
  ssr: readonly string[];
  client: readonly string[];
};

export const APP_ROUTER_DEV_WARMUP_ENVIRONMENTS = ["rsc", "ssr", "client"] as const;

export type AppRouterDevWarmupEnvironment = (typeof APP_ROUTER_DEV_WARMUP_ENVIRONMENTS)[number];

/**
 * Per-environment entry modules to warm.
 *
 * These are the bare vinext virtual module ids (e.g. `virtual:vinext-rsc-entry`),
 * NOT the `/@id/__x00__` URL form. `environment.warmupRequest()` /
 * `environment.transformRequest()` resolve through `pluginContainer.resolveId`
 * directly (only the HTTP transform middleware unwraps `/@id/__x00__`), and
 * vinext's `resolveId` matches the bare specifier. Warming each entry cascades
 * to its whole static import graph via `dev.preTransformRequests`, so only the
 * real entry points are listed here.
 */
export function getAppRouterDevWarmupTargets(options: {
  hybridPagesDir: boolean;
}): AppRouterDevWarmupTargets {
  return {
    rsc: ["virtual:vinext-rsc-entry"],
    ssr: ["virtual:vinext-app-ssr-entry"],
    client: [
      "virtual:vinext-app-browser-entry",
      ...(options.hybridPagesDir ? ["virtual:vinext-client-entry"] : []),
    ],
  };
}

type WarmupEnvironment = {
  warmupRequest?: (url: string) => Promise<void> | void;
};

type WarmupCapableServer = {
  environments?: Partial<Record<AppRouterDevWarmupEnvironment, WarmupEnvironment | undefined>>;
};

/**
 * Pre-transform the App Router virtual entry modules in the rsc, ssr, and
 * client environments concurrently.
 *
 * This deliberately bypasses Vite's `dev.warmup` option. That path globs real
 * files relative to root and rewrites each entry through `fileToUrl`, which
 * mangles a virtual specifier into an unresolvable `/@fs/@id/__x00__virtual:...`
 * request (the resulting "Pre-transform error: Failed to load url" means the
 * warmup silently does nothing). Calling `environment.warmupRequest()` directly
 * with the bare virtual id feeds it straight into `transformRequest` ->
 * `resolveId`. With `dev.preTransformRequests` enabled, warming each entry
 * cascades to its whole static import graph, and warming the three environments
 * in parallel overlaps their otherwise-sequential compilation.
 */
export async function warmupAppRouterVirtualEntries(
  server: WarmupCapableServer,
  targets: AppRouterDevWarmupTargets,
): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const name of APP_ROUTER_DEV_WARMUP_ENVIRONMENTS) {
    const environment = server.environments?.[name];
    const warmupRequest = environment?.warmupRequest;
    if (typeof warmupRequest !== "function") continue;
    for (const id of targets[name]) {
      // Swallow per-entry failures: a warmup miss must never break dev startup,
      // and the real request path will surface any genuine module error.
      jobs.push(Promise.resolve(warmupRequest.call(environment, id)).catch(() => {}));
    }
  }
  await Promise.all(jobs);
}

export type AppRouterDevWarmupOptions = {
  basePath?: string;
  hybridPagesDir?: boolean;
  logger?: Logger;
};

/**
 * Warm the App Router dev server before the first browser navigation.
 *
 * Runs two complementary passes concurrently:
 *  1. Pre-transform the rsc/ssr/client virtual entries in parallel so each
 *     environment's module graph compiles at the same time instead of the ssr
 *     graph waiting until the first rsc render reaches `handleSsr`.
 *  2. Issue an internal document request so the full RSC -> SSR render path is
 *     executed once. The probe reuses the transforms from pass 1 (Vite dedupes
 *     concurrent `transformRequest` calls by module id), so the two passes
 *     overlap rather than duplicate work.
 */
export async function warmupAppRouterDevServer(
  server: ViteDevServer,
  options: AppRouterDevWarmupOptions = {},
): Promise<void> {
  const logger = options.logger ?? server.config.logger;
  const started = performance.now();
  logger.info("[vinext] Warming up App Router dev server...", { timestamp: true });

  const targets = getAppRouterDevWarmupTargets({ hybridPagesDir: options.hybridPagesDir === true });

  await Promise.all([
    warmupAppRouterVirtualEntries(server, targets),
    probeDocumentRequest(server, options, logger),
  ]);

  const elapsed = Math.round(performance.now() - started);
  logger.info(`[vinext] App Router dev warmup finished in ${elapsed}ms`, { timestamp: true });
}

/**
 * Run an internal document request so the RSC/SSR render path (not just the
 * module transforms) is initialized before the first browser navigation.
 */
async function probeDocumentRequest(
  server: ViteDevServer,
  options: AppRouterDevWarmupOptions,
  logger: Logger,
): Promise<void> {
  const origin = resolveDevServerOrigin(server);
  if (!origin) return;

  const pathname = normalizeWarmupPath(options.basePath);
  try {
    const response = await fetch(`${origin}${pathname}`, {
      headers: { Accept: "text/html" },
      // Avoid following user redirects (especially auth redirects to external
      // origins) during startup warmup. The initial request is enough to warm
      // middleware/config redirect handling, and real navigation will follow it.
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      return;
    }
    if (!response.ok) {
      logger.warn(`[vinext] Dev warmup probe for ${pathname} returned ${response.status}`);
      return;
    }
    await response.arrayBuffer();
  } catch (error) {
    logger.warn(
      `[vinext] Dev warmup probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function resolveDevServerOrigin(server: ViteDevServer): string | null {
  const local = server.resolvedUrls?.local?.[0];
  if (local) return local.replace(/\/$/, "");

  const address = server.httpServer?.address();
  if (!address || typeof address === "string") return null;

  const host =
    address.address === "::" || address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
  const formattedHost = host.includes(":") ? `[${host}]` : host;
  return `http://${formattedHost}:${address.port}`;
}

function normalizeWarmupPath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "/";
  return basePath.endsWith("/") ? basePath.slice(0, -1) || "/" : basePath;
}
