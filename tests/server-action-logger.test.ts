import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { VINEXT_ACTION_LOG_HEADER } from "../packages/vinext/src/server/headers.js";
import {
  applyServerActionLogHeader,
  createServerActionLogInfo,
  formatActionArgs,
  parseServerActionLogHeader,
  resolveServerActionLogMeta,
  serializeServerActionLogHeader,
} from "../packages/vinext/src/server/server-action-logger.js";
import { logServerAction } from "../packages/vinext/src/server/request-log.js";
import { withEnvVar } from "./env-test-helpers.js";

describe("server-action-logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves function name and location from x-rsc-action ids", () => {
    expect(
      resolveServerActionLogMeta("/app/nextjs-compat/action-node-mw/actions.ts#echoAction"),
    ).toEqual({
      functionName: "echoAction",
      location: "app/nextjs-compat/action-node-mw/actions.ts",
    });
  });

  it("treats hoist-prefixed exports as inline actions", () => {
    expect(resolveServerActionLogMeta("/app/page.tsx#$$hoist_0_formGetHeader")).toEqual({
      functionName: "",
      location: "app/page.tsx",
    });
  });

  it("skips use-cache server function ids", () => {
    expect(resolveServerActionLogMeta("/app/cache.ts#$$RSC_SERVER_CACHE_0")).toBeNull();
  });

  it("formats primitive and object arguments", () => {
    expect(formatActionArgs([5])).toBe("5");
    expect(formatActionArgs([1, 2, 3])).toBe("1, 2, 3");
    expect(formatActionArgs([{ name: "test", value: 42 }])).toBe('{"name":"test","value":42}');
  });

  it("round-trips log payloads through the response header", () => {
    const info = {
      functionName: "successAction",
      args: [5],
      location: "app/actions.ts",
      duration: 3,
    };

    const headers = new Headers();
    applyServerActionLogHeader(headers, info);

    const headerValue = headers.get(VINEXT_ACTION_LOG_HEADER)!;
    expect(headerValue).toBe(serializeServerActionLogHeader(info));
    expect(parseServerActionLogHeader(headerValue)).toEqual(info);
  });

  it("accepts non-ASCII args in HTTP headers via base64 encoding", () => {
    const info = {
      functionName: "getPendingAdminMandatoryAnnouncements",
      args: [{ title: "系统公告" }],
      location: "src/sys-announcement/actions.ts",
      duration: 2,
    };

    const headers = new Headers();
    expect(() => applyServerActionLogHeader(headers, info)).not.toThrow();

    const parsed = parseServerActionLogHeader(headers.get(VINEXT_ACTION_LOG_HEADER)!);
    expect(parsed).toMatchObject({
      functionName: "getPendingAdminMandatoryAnnouncements",
      args: [{ title: "系统公告" }],
      location: "src/sys-announcement/actions.ts",
      duration: 2,
    });
  });

  it("truncates long string arguments in dev logs", () => {
    const longText = "中".repeat(200);
    const formatted = formatActionArgs([longText]);
    expect(formatted.length).toBeLessThan(longText.length + 10);
    expect(formatted).toContain("...");
  });

  it("keeps leading arg content when the header payload exceeds the budget", () => {
    const hugeArgs = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      title: `公告-${"中".repeat(100)}-${i}`,
      payload: "x".repeat(500),
    }));

    const info = {
      functionName: "bulkAction",
      args: hugeArgs,
      location: "app/actions.ts",
      duration: 5,
    };

    const headers = new Headers();
    expect(() => applyServerActionLogHeader(headers, info)).not.toThrow();

    const parsed = parseServerActionLogHeader(headers.get(VINEXT_ACTION_LOG_HEADER)!);
    expect(parsed?.functionName).toBe("bulkAction");
    expect(parsed?.args.length).toBeGreaterThan(0);
    expect(parsed?.args).not.toEqual(["..."]);

    const formatted = formatActionArgs(parsed!.args);
    expect(formatted).toContain("公告");
    expect(formatted).toContain("...");
  });

  it("still parses legacy raw JSON action log headers", () => {
    const legacy = '{"functionName":"a","args":[],"location":"app/a.ts","duration":1}';
    expect(parseServerActionLogHeader(legacy)).toEqual({
      functionName: "a",
      args: [],
      location: "app/a.ts",
      duration: 1,
    });
  });

  it("creates log info only in development", () => {
    withEnvVar("NODE_ENV", "production", () => {
      expect(
        createServerActionLogInfo({
          actionId: "/app/actions.ts#successAction",
          args: [5],
          durationMs: 2,
        }),
      ).toBeNull();
    });

    withEnvVar("NODE_ENV", "development", () => {
      expect(
        createServerActionLogInfo({
          actionId: "/app/actions.ts#successAction",
          args: [5],
          durationMs: 2,
        }),
      ).toEqual({
        functionName: "successAction",
        args: [5],
        location: "app/actions.ts",
        duration: 2,
      });
    });
  });

  it("prints the Next.js-style nested action log line", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    logServerAction({
      functionName: "successAction",
      args: [5],
      location: "app/actions.ts",
      duration: 1,
    });

    expect(writeSpy).toHaveBeenCalledWith(" └─ ƒ successAction(5) in 1ms app/actions.ts\n");
  });
});
