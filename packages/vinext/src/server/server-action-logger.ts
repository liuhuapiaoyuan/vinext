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

/** Max characters per string arg in dev action logs. */
const MAX_ARG_STRING_LENGTH = 80;

/** Max UTF-8 bytes for the JSON payload before base64 encoding. */
const MAX_HEADER_JSON_BYTES = 2048;

const INLINE_ACTION_PREFIXES = ["$$RSC_SERVER_ACTION_", "$$hoist_"] as const;
const USE_CACHE_ACTION_PREFIX = "$$RSC_SERVER_CACHE_";

function truncateString(value: string, maxLength = MAX_ARG_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

/** Shrink args for dev logs and HTTP header transport. */
type ArgSanitizeLimits = {
  maxStringLength: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxDepth: number;
};

const DEFAULT_ARG_SANITIZE_LIMITS: ArgSanitizeLimits = {
  maxStringLength: MAX_ARG_STRING_LENGTH,
  maxArrayItems: 3,
  maxObjectKeys: 3,
  maxDepth: 2,
};

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeOpaqueArg(arg: object): string {
  if (Array.isArray(arg)) return `[Array(${arg.length})]`;
  if (typeof FormData !== "undefined" && arg instanceof FormData) return "[FormData]";
  if (typeof Blob !== "undefined" && arg instanceof Blob) return `[${arg.constructor.name}]`;
  return `[${arg.constructor.name}]`;
}

function sanitizeArgForLog(
  arg: unknown,
  depth = 0,
  limits: ArgSanitizeLimits = DEFAULT_ARG_SANITIZE_LIMITS,
): unknown {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg === "string") return truncateString(arg, limits.maxStringLength);
  if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") {
    return arg;
  }
  if (typeof arg === "symbol") return String(arg);
  if (typeof arg === "function") return "[Function]";

  if (depth >= limits.maxDepth) return "[Object]";

  if (Array.isArray(arg)) {
    const items = arg
      .slice(0, limits.maxArrayItems)
      .map((item) => sanitizeArgForLog(item, depth + 1, limits));
    if (arg.length > limits.maxArrayItems) items.push("...");
    return items;
  }

  if (typeof arg === "object") {
    // Flight decodeReply can return lazy values. Avoid Object.entries/getters on
    // non-plain objects — dev logging must never materialize action args.
    if (!isPlainObject(arg)) {
      return describeOpaqueArg(arg);
    }

    try {
      const entries = Object.entries(arg as Record<string, unknown>).slice(0, limits.maxObjectKeys);
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of entries) {
        sanitized[key] = sanitizeArgForLog(value, depth + 1, limits);
      }
      if (Object.keys(arg as object).length > limits.maxObjectKeys) {
        sanitized["..."] = "...";
      }
      return sanitized;
    } catch {
      return "[Object]";
    }
  }

  try {
    return truncateString(JSON.stringify(arg), limits.maxStringLength);
  } catch {
    return "[unserializable]";
  }
}

/** Snapshot args without spreading lazy Flight arrays or throwing on bad payloads. */
function safeArgsSnapshotForLog(args: readonly unknown[]): unknown[] {
  let length: number;
  try {
    length = args.length;
  } catch {
    return ["(args unavailable)"];
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index++) {
    try {
      snapshot.push(sanitizeArgForLog(args[index]));
    } catch {
      snapshot.push("(arg unavailable)");
    }
  }
  return snapshot;
}

function sanitizeArgsForLog(
  args: unknown[],
  limits: ArgSanitizeLimits = DEFAULT_ARG_SANITIZE_LIMITS,
): unknown[] {
  return args.map((arg) => sanitizeArgForLog(arg, 0, limits));
}

function headerJsonByteLength(info: ServerActionLogInfo): number {
  return Buffer.byteLength(JSON.stringify(info), "utf8");
}

/** Keep as much leading arg content as possible while staying under the header budget. */
function fitLogInfoForHeader(info: ServerActionLogInfo): ServerActionLogInfo {
  const limits: ArgSanitizeLimits = { ...DEFAULT_ARG_SANITIZE_LIMITS };
  let maxArgs = info.args.length;

  while (true) {
    const args = sanitizeArgsForLog(info.args.slice(0, maxArgs), limits);
    if (maxArgs < info.args.length) {
      args.push("...");
    }

    const candidate: ServerActionLogInfo = {
      functionName: info.functionName,
      args,
      location: info.location,
      duration: info.duration,
    };

    if (headerJsonByteLength(candidate) <= MAX_HEADER_JSON_BYTES) {
      return candidate;
    }

    if (limits.maxStringLength > 16) {
      limits.maxStringLength = Math.max(16, Math.floor(limits.maxStringLength / 2));
      continue;
    }
    if (limits.maxArrayItems > 1) {
      limits.maxArrayItems--;
      continue;
    }
    if (limits.maxObjectKeys > 1) {
      limits.maxObjectKeys--;
      continue;
    }
    if (limits.maxDepth > 0) {
      limits.maxDepth--;
      continue;
    }
    if (maxArgs > 1) {
      maxArgs--;
      continue;
    }
    if (limits.maxStringLength > 1) {
      limits.maxStringLength = Math.max(1, Math.floor(limits.maxStringLength / 2));
      continue;
    }

    const firstArg = info.args[0];
    const prefix =
      typeof firstArg === "string"
        ? truncateString(firstArg, 1)
        : truncateString(formatArg(firstArg), 1);

    return {
      functionName: info.functionName,
      args: [prefix, "..."],
      location: info.location,
      duration: info.duration,
    };
  }
}

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
  if (typeof arg === "string") return JSON.stringify(truncateString(arg));
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

function encodeHeaderPayload(json: string): string {
  // HTTP header values must be ByteStrings; base64 keeps Unicode args transport-safe.
  return Buffer.from(json, "utf8").toString("base64");
}

function decodeHeaderPayload(value: string): string {
  // Backward compat: older vinext versions wrote raw JSON.
  if (value.startsWith("{")) return value;
  return Buffer.from(value, "base64").toString("utf8");
}

function prepareLogInfoForHeader(info: ServerActionLogInfo): ServerActionLogInfo {
  const prepared: ServerActionLogInfo = {
    ...info,
    args: sanitizeArgsForLog(info.args),
  };

  if (headerJsonByteLength(prepared) <= MAX_HEADER_JSON_BYTES) {
    return prepared;
  }

  return fitLogInfoForHeader(info);
}

export function serializeServerActionLogHeader(info: ServerActionLogInfo): string {
  return encodeHeaderPayload(JSON.stringify(prepareLogInfoForHeader(info)));
}

export function parseServerActionLogHeader(value: string): ServerActionLogInfo | null {
  try {
    const parsed = JSON.parse(decodeHeaderPayload(value)) as Partial<ServerActionLogInfo>;
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

  try {
    const args = Array.isArray(options.args) ? options.args : [options.args];

    return {
      ...meta,
      args: safeArgsSnapshotForLog(args),
      duration: options.durationMs,
    };
  } catch {
    // Dev logging must never break action responses.
    return {
      ...meta,
      args: ["(args unavailable)"],
      duration: options.durationMs,
    };
  }
}
