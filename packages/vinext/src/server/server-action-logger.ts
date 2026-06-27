/**
 * Dev-only Server Action logging — metadata and wire-format helpers.
 *
 * Terminal output lives in `request-log.ts`. Dev middleware interception lives
 * in `dev-response-headers.ts`.
 *
 * Ported from Next.js:
 * - packages/next/src/server/dev/server-action-logger.ts
 * - packages/next/src/server/dev/log-requests.ts
 *
 * https://github.com/vercel/next.js/pull/88277
 */

import { VINEXT_ACTION_LOG_HEADER } from "./headers.js";

export type ServerActionLogInfo = {
  functionName: string;
  args: unknown[];
  location: string;
  duration: number;
};

const INLINE_ACTION_PREFIXES = ["$$RSC_SERVER_ACTION_", "$$hoist_"] as const;
const USE_CACHE_ACTION_PREFIX = "$$RSC_SERVER_CACHE_";

export function isDevServerActionLoggingEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

function isInlineActionExport(exportedName: string): boolean {
  return INLINE_ACTION_PREFIXES.some((prefix) => exportedName.startsWith(prefix));
}

function isUseCacheActionExport(exportedName: string): boolean {
  return exportedName.startsWith(USE_CACHE_ACTION_PREFIX);
}

/**
 * Resolve display metadata from an `x-rsc-action` / `next-action` action id.
 *
 * Action ids encode module path and export name:
 *   `/app/actions/actions.ts#echoAction`
 */
export function resolveServerActionLogMeta(
  actionId: string | null,
): Pick<ServerActionLogInfo, "functionName" | "location"> | null {
  if (!actionId) return null;

  const hashIndex = actionId.lastIndexOf("#");
  if (hashIndex <= 0) return null;

  const exportedName = actionId.slice(hashIndex + 1);
  if (isUseCacheActionExport(exportedName)) return null;

  const location = actionId.slice(0, hashIndex).replace(/\\/g, "/").replace(/^\//, "");

  let functionName: string;
  if (isInlineActionExport(exportedName)) {
    functionName = "";
  } else if (exportedName === "default") {
    functionName = "default";
  } else {
    functionName = exportedName;
  }

  return { functionName, location };
}

function formatArg(arg: unknown, depth = 0): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return JSON.stringify(arg);
  if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") {
    return String(arg);
  }
  if (typeof arg === "symbol") return String(arg);
  if (typeof arg === "function") return "[Function]";

  if (depth >= 2) return "[Object]";

  if (Array.isArray(arg)) {
    const items = arg.slice(0, 3).map((item) => formatArg(item, depth + 1));
    if (arg.length > 3) items.push("...");
    return `[${items.join(",")}]`;
  }

  if (typeof arg === "object") {
    try {
      const entries = Object.entries(arg as Record<string, unknown>).slice(0, 3);
      const formatted = entries.map(
        ([key, value]) => `${JSON.stringify(key)}:${formatArg(value, depth + 1)}`,
      );
      if (Object.keys(arg as object).length > 3) formatted.push("...");
      return `{${formatted.join(",")}}`;
    } catch {
      return "[Object]";
    }
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return "[unserializable]";
  }
}

/** Format action arguments for the dev log line. */
export function formatActionArgs(args: unknown[]): string {
  return args.map((arg) => formatArg(arg)).join(", ");
}

export function serializeServerActionLogHeader(info: ServerActionLogInfo): string {
  return JSON.stringify(info);
}

export function parseServerActionLogHeader(value: string): ServerActionLogInfo | null {
  try {
    const parsed = JSON.parse(value) as Partial<ServerActionLogInfo>;
    if (
      typeof parsed.functionName === "string" &&
      Array.isArray(parsed.args) &&
      typeof parsed.location === "string" &&
      typeof parsed.duration === "number"
    ) {
      return parsed as ServerActionLogInfo;
    }
  } catch {
    // ignore malformed header payloads
  }
  return null;
}

export function applyServerActionLogHeader(
  headers: Headers,
  info: ServerActionLogInfo | null,
): void {
  if (!info) return;
  headers.set(VINEXT_ACTION_LOG_HEADER, serializeServerActionLogHeader(info));
}

export function createServerActionLogInfo(options: {
  actionId: string | null;
  args: readonly unknown[];
  durationMs: number;
}): ServerActionLogInfo | null {
  if (!isDevServerActionLoggingEnabled()) return null;

  const meta = resolveServerActionLogMeta(options.actionId);
  if (!meta) return null;

  const args = Array.isArray(options.args) ? options.args : [options.args];

  return {
    ...meta,
    args: [...args],
    duration: options.durationMs,
  };
}
