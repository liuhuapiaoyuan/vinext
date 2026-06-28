/**
 * Dev-only response headers stripped by the App Router dev middleware
 * before the response reaches the client.
 *
 * Keeps wire-format parsing and Node `ServerResponse` interception out of
 * `index.ts` and action execution modules.
 */

import type { ServerResponse } from "node:http";
import { VINEXT_ACTION_LOG_HEADER, VINEXT_TIMING_HEADER } from "./headers.js";
import { logServerAction, logRequest, now, type RequestLogOptions } from "./request-log.js";
import { parseServerActionLogHeader } from "./server-action-logger.js";
import { withServerActionSourceLocation } from "./server-action-source-location.js";

export type DevResponseMetrics = {
  compileMs?: number;
  renderMs?: number;
  actionLogRaw?: string;
};

export function parseVinextTimingHeader(
  raw: unknown,
  reqStart: number,
): Pick<DevResponseMetrics, "compileMs" | "renderMs"> {
  const [handlerStart, inHandlerCompileMs, renderMs] = String(raw)
    .split(",")
    .map((v) => Number(v));

  const metrics: Pick<DevResponseMetrics, "compileMs" | "renderMs"> = {};

  if (
    !Number.isNaN(handlerStart) &&
    !Number.isNaN(inHandlerCompileMs) &&
    inHandlerCompileMs !== -1
  ) {
    metrics.compileMs = Math.max(0, Math.round(handlerStart - reqStart)) + inHandlerCompileMs;
  }
  if (!Number.isNaN(renderMs) && renderMs !== -1) {
    metrics.renderMs = renderMs;
  }

  return metrics;
}

function consumeDevInternalHeader(
  name: string,
  value: unknown,
  reqStart: number,
  metrics: DevResponseMetrics,
): boolean {
  const lowerName = name.toLowerCase();
  if (lowerName === VINEXT_TIMING_HEADER) {
    Object.assign(metrics, parseVinextTimingHeader(value, reqStart));
    return true;
  }
  if (lowerName === VINEXT_ACTION_LOG_HEADER) {
    metrics.actionLogRaw = String(value);
    return true;
  }
  return false;
}

function stripDevInternalHeadersFromObject(
  headers: Record<string, unknown>,
  reqStart: number,
  metrics: DevResponseMetrics,
): void {
  for (const key of Object.keys(headers)) {
    if (consumeDevInternalHeader(key, headers[key], reqStart, metrics)) {
      delete headers[key];
    }
  }
}

/** Intercept dev-only headers on a Node response and capture their payloads. */
export function interceptDevResponseHeaders(
  res: ServerResponse,
  reqStart: number,
  metrics: DevResponseMetrics,
): void {
  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = function (name, value) {
    if (consumeDevInternalHeader(String(name), value, reqStart, metrics)) {
      return res;
    }
    return origSetHeader(name, value);
  };

  const origAppendHeader = res.appendHeader?.bind(res);
  if (origAppendHeader) {
    res.appendHeader = function (name, value) {
      if (consumeDevInternalHeader(String(name), value, reqStart, metrics)) {
        return res;
      }
      return origAppendHeader(name, value);
    };
  }

  const origWriteHead = res.writeHead.bind(res);
  // oxlint-disable-next-line typescript/no-explicit-any
  res.writeHead = function (statusCode, ...args: any[]) {
    let headers: Record<string, unknown> | undefined;
    const [reasonOrHeaders, maybeHeaders] = args;
    if (typeof reasonOrHeaders === "string") {
      headers = maybeHeaders;
    } else {
      headers = reasonOrHeaders;
    }

    if (headers && typeof headers === "object" && !Array.isArray(headers)) {
      stripDevInternalHeadersFromObject(headers, reqStart, metrics);
    }

    return origWriteHead(statusCode, ...args);
  };
}

export function flushDevRequestLogs(
  metrics: DevResponseMetrics,
  options: RequestLogOptions,
  projectRoot = process.cwd(),
): void {
  logRequest(options);

  const actionLog = metrics.actionLogRaw ? parseServerActionLogHeader(metrics.actionLogRaw) : null;
  if (actionLog) {
    logServerAction(withServerActionSourceLocation(actionLog, projectRoot), projectRoot);
  }
}

function shouldSkipDevRequestLogUrl(url: string): boolean {
  const [pathname] = url.split("?");
  return (
    url.startsWith("/@") ||
    url.startsWith("/__vite") ||
    url.startsWith("/node_modules") ||
    (url.includes(".") && !pathname.endsWith(".html") && !pathname.endsWith(".rsc"))
  );
}

/** Install App Router request + server action logging on the Vite dev server. */
export function installAppRouterDevRequestLogging(
  middlewares: {
    use: (
      handler: (
        req: import("node:http").IncomingMessage,
        res: ServerResponse,
        next: (err?: unknown) => void,
      ) => void,
    ) => void;
  },
  projectRoot = process.cwd(),
): void {
  middlewares.use((req, res, next) => {
    const url = req.url ?? "/";
    if (shouldSkipDevRequestLogUrl(url)) {
      return next();
    }

    const reqStart = now();
    const metrics: DevResponseMetrics = {};
    interceptDevResponseHeaders(res, reqStart, metrics);

    res.on("finish", () => {
      const logUrl = url.replace(/\.rsc(\?|$)/, "$1");
      const totalMs = now() - reqStart;
      const resolvedRenderMs =
        metrics.renderMs !== undefined
          ? metrics.renderMs
          : metrics.compileMs !== undefined
            ? Math.max(0, Math.round(totalMs - metrics.compileMs))
            : undefined;

      flushDevRequestLogs(
        metrics,
        {
          method: req.method ?? "GET",
          url: logUrl,
          status: res.statusCode,
          totalMs,
          compileMs: metrics.compileMs,
          renderMs: resolvedRenderMs,
        },
        projectRoot,
      );
    });

    next();
  });
}
