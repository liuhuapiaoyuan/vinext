import type { ViteDevServer } from "vite";
import type { DevLockfile } from "./dev-lockfile.js";

function closeHttpConnections(server: ViteDevServer): void {
  const httpServer = server.httpServer as { closeAllConnections?: () => void } | null | undefined;
  httpServer?.closeAllConnections?.();
}

function closeWebSockets(server: ViteDevServer): void {
  const wsServer = (server as ViteDevServer & { ws?: { close?: () => void | Promise<void> } }).ws;
  void wsServer?.close?.();
}

/**
 * Synchronously tear down the dev server and exit.
 *
 * Do not await {@link ViteDevServer.close} — Vite waits for open browser
 * keep-alive/WebSocket connections to drain, which is exactly why Ctrl+C
 * appears to hang until the user closes the tab.
 */
export function forceDevServerExit(server: ViteDevServer, lockfile?: DevLockfile, code = 0): never {
  closeWebSockets(server);
  closeHttpConnections(server);

  const httpServer = server.httpServer;
  if (httpServer?.listening) {
    try {
      httpServer.close();
    } catch {
      // Best effort.
    }
  }

  lockfile?.release();

  // Fire-and-forget — we must not await this before exiting.
  void server.close().catch(() => {});

  process.exit(code);
}

export type DevServerShutdownOptions = {
  getServer?: () => ViteDevServer | undefined;
  lockfile?: DevLockfile;
  getLockfile?: () => DevLockfile | undefined;
};

function resolveLockfile(options: DevServerShutdownOptions): DevLockfile | undefined {
  return options.getLockfile?.() ?? options.lockfile;
}

/**
 * Install Ctrl+C / SIGTERM handlers that force-exit the dev server.
 *
 * Call this before `createServer()` so Turbo restarts and long cold starts
 * still respond to signals. Turbo forwards SIGTERM when restarting persistent
 * dev tasks; Vite's default handler waits for browser tabs to disconnect.
 */
export function installDevServerShutdownHandlers(options: DevServerShutdownOptions): void {
  let exiting = false;

  const onSignal = (signal: "SIGINT" | "SIGTERM") => {
    const code = signal === "SIGINT" ? 130 : 143;
    if (exiting) {
      process.exit(code);
    }
    exiting = true;

    const lockfile = resolveLockfile(options);
    const server = options.getServer?.();
    if (server) {
      forceDevServerExit(server, lockfile, code);
    }

    lockfile?.release();
    process.exit(code);
  };

  process.prependListener("SIGINT", () => onSignal("SIGINT"));
  process.prependListener("SIGTERM", () => onSignal("SIGTERM"));
}
