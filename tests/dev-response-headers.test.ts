import { describe, expect, it } from "vite-plus/test";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import {
  VINEXT_ACTION_LOG_HEADER,
  VINEXT_TIMING_HEADER,
} from "../packages/vinext/src/server/headers.js";
import {
  flushDevRequestLogs,
  interceptDevResponseHeaders,
  parseVinextTimingHeader,
} from "../packages/vinext/src/server/dev-response-headers.js";

function createMockResponse(): ServerResponse & {
  forwardedHeaders: Record<string, string | number | string[]>;
} {
  const forwardedHeaders: Record<string, string | number | string[]> = {};
  const res = new EventEmitter() as ServerResponse & {
    forwardedHeaders: Record<string, string | number | string[]>;
  };
  res.forwardedHeaders = forwardedHeaders;
  res.statusCode = 200;
  res.setHeader = ((name: string, value: string | number | readonly string[]) => {
    forwardedHeaders[name.toLowerCase()] = Array.isArray(value)
      ? [...value]
      : (value as string | number);
    return res;
  }) as typeof res.setHeader;
  res.appendHeader = ((name: string, value: string | number | readonly string[]) => {
    const key = name.toLowerCase();
    const existing = forwardedHeaders[key];
    const values = Array.isArray(value) ? [...value] : [value as string | number];
    if (existing === undefined) {
      forwardedHeaders[key] = values.length === 1 ? values[0]! : values;
    } else if (Array.isArray(existing)) {
      forwardedHeaders[key] = [...existing, ...values];
    } else {
      forwardedHeaders[key] = [existing, ...values];
    }
    return res;
  }) as typeof res.appendHeader;
  res.writeHead = ((statusCode: number, maybeHeaders?: Record<string, string>) => {
    res.statusCode = statusCode;
    if (maybeHeaders) {
      for (const [name, value] of Object.entries(maybeHeaders)) {
        forwardedHeaders[name.toLowerCase()] = value;
      }
    }
    return res;
  }) as typeof res.writeHead;
  return res;
}

describe("dev-response-headers", () => {
  it("parses compile and render timing from the internal timing header", () => {
    expect(parseVinextTimingHeader("150,25,40", 100)).toEqual({
      compileMs: 75,
      renderMs: 40,
    });
  });

  it("strips internal dev headers before they reach the client", () => {
    const reqStart = 100;
    const metrics = {};
    const res = createMockResponse();
    interceptDevResponseHeaders(res, reqStart, metrics);

    res.setHeader(VINEXT_TIMING_HEADER, "150,25,40");
    res.setHeader(
      VINEXT_ACTION_LOG_HEADER,
      '{"functionName":"a","args":[],"location":"app/a.ts","duration":1}',
    );
    res.setHeader("content-type", "text/html");

    expect(metrics).toEqual({
      compileMs: 75,
      renderMs: 40,
      actionLogRaw: '{"functionName":"a","args":[],"location":"app/a.ts","duration":1}',
    });
    expect(res.forwardedHeaders).toEqual({
      "content-type": "text/html",
    });
  });

  it("strips internal dev headers written through appendHeader", () => {
    const reqStart = 100;
    const metrics = {};
    const res = createMockResponse();
    interceptDevResponseHeaders(res, reqStart, metrics);

    res.appendHeader(
      VINEXT_ACTION_LOG_HEADER,
      '{"functionName":"a","args":[],"location":"app/a.ts","duration":1}',
    );
    res.appendHeader("vary", "RSC");

    expect(metrics).toEqual({
      actionLogRaw: '{"functionName":"a","args":[],"location":"app/a.ts","duration":1}',
    });
    expect(res.forwardedHeaders).toEqual({
      vary: "RSC",
    });
  });

  it("flushes request and server action logs together", () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      flushDevRequestLogs(
        {
          actionLogRaw:
            '{"functionName":"successAction","args":[5],"location":"app/actions.ts","duration":2}',
        },
        {
          method: "POST",
          url: "/",
          status: 200,
          totalMs: 45,
        },
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(writes).toEqual([
      " POST / 200 in 45ms\n",
      " └─ ƒ successAction(5) in 2ms app/actions.ts\n",
    ]);
  });
});
