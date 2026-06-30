import { execSync } from "node:child_process";
import net from "node:net";

/** Returns true when `pid` refers to a running process. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

/** Force-terminate a dev-server process tree (browser tabs often keep it alive). */
export function terminateProcessTree(pid: number): void {
  if (!isPidAlive(pid)) return;

  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore" });
      return;
    }
    process.kill(pid, "SIGKILL");
  } catch {
    // Already exited or access denied — best effort.
  }
}

export async function waitUntilPidExits(pid: number, timeoutMs: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return true;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isPidAlive(pid);
}

function normalizeDevListenHost(hostname: string | boolean | undefined): string[] {
  if (typeof hostname !== "string") {
    return ["127.0.0.1", "0.0.0.0"];
  }
  if (hostname === "localhost") {
    return ["127.0.0.1", "0.0.0.0"];
  }
  if (hostname === "0.0.0.0" || hostname === "::") {
    return ["0.0.0.0", "127.0.0.1"];
  }
  return [hostname.includes(":") ? `[${hostname}]` : hostname];
}

async function isPortAvailableOnHost(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function isPortAvailable(
  port: number,
  hostname: string | boolean | undefined,
): Promise<boolean> {
  for (const host of normalizeDevListenHost(hostname)) {
    if (!(await isPortAvailableOnHost(port, host))) return false;
  }
  return true;
}

/**
 * Parse Windows `netstat -ano -p tcp` output for listening PIDs on `port`.
 *
 * Do not match the English `LISTENING` token — localized Windows builds use
 * other state labels. Listening sockets are identified by remote `0.0.0.0:0`
 * or `[::]:0`.
 */
export function parseWindowsNetstatListeningPids(port: number, output: string): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("TCP")) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const localAddress = parts[1] ?? "";
    const remoteAddress = parts[2] ?? "";
    const localPortMatch = localAddress.match(/:(\d+)$/);
    if (!localPortMatch || Number.parseInt(localPortMatch[1]!, 10) !== port) continue;
    if (remoteAddress !== "0.0.0.0:0" && remoteAddress !== "[::]:0") continue;

    const pid = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

export function findListeningPids(port: number): number[] {
  try {
    if (process.platform === "win32") {
      const output = execSync("netstat -ano -p tcp", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return parseWindowsNetstatListeningPids(port, output);
    }

    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .trim()
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line, 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/** Kill every process currently listening on `port`. */
export async function terminateDevListenPortHolders(
  port: number,
  hostname: string | boolean | undefined,
): Promise<void> {
  for (const pid of findListeningPids(port)) {
    if (pid === process.pid) continue;
    terminateProcessTree(pid);
    await waitUntilPidExits(pid, 2_000);
  }

  // Best effort even when netstat/lsof cannot identify the owner.
  if (!(await isPortAvailable(port, hostname))) {
    for (const pid of findListeningPids(port)) {
      if (pid === process.pid) continue;
      terminateProcessTree(pid);
      await waitUntilPidExits(pid, 1_000);
    }
  }
}

/**
 * Ensure the dev listen port is free before `server.listen()`.
 *
 * Turbo monorepos restart `vinext dev` while browser tabs still hold
 * connections to the previous instance. The old process can outlive SIGTERM
 * and keep listening until those tabs close.
 */
export async function ensureDevListenPortFree(
  port: number,
  hostname: string | boolean | undefined,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await isPortAvailable(port, hostname)) return;
    await terminateDevListenPortHolders(port, hostname);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Port ${port} is still in use after stopping prior vinext dev servers. ` +
      "Close browser tabs on the old dev URL or stop the process holding the port, then retry.",
  );
}
