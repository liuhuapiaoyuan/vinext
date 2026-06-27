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

    expect(headers.get(VINEXT_ACTION_LOG_HEADER)).toBe(serializeServerActionLogHeader(info));
    expect(parseServerActionLogHeader(headers.get(VINEXT_ACTION_LOG_HEADER)!)).toEqual(info);
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
