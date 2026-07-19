import { describe, expect, it } from "vite-plus/test";
import {
  createForceServerExternalsPlugin,
  matchServerExternal,
} from "../packages/vinext/src/plugins/force-server-externals.js";

describe("matchServerExternal", () => {
  it("matches exact package names", () => {
    expect(
      matchServerExternal("@opentelemetry/semantic-conventions", [
        "@opentelemetry/semantic-conventions",
      ]),
    ).toBe(true);
  });

  it("matches package name for subpath imports", () => {
    expect(
      matchServerExternal("@opentelemetry/semantic-conventions/incubating", [
        "@opentelemetry/semantic-conventions",
      ]),
    ).toBe(true);
  });

  it("does not match unrelated packages", () => {
    expect(matchServerExternal("lodash", ["@opentelemetry/semantic-conventions"])).toBe(false);
  });

  it("returns false for external: true (handled by resolve.external)", () => {
    expect(matchServerExternal("@opentelemetry/semantic-conventions", true)).toBe(false);
  });
});

describe("createForceServerExternalsPlugin", () => {
  it("marks configured server externals as external via resolveId", () => {
    let externals: string[] | true = ["@opentelemetry/semantic-conventions", "sharp"];
    const plugin = createForceServerExternalsPlugin({
      getExternals: () => externals,
    });

    expect(plugin.applyToEnvironment?.({ name: "rsc" } as never)).toBe(true);
    expect(plugin.applyToEnvironment?.({ name: "nitro" } as never)).toBe(true);
    expect(plugin.applyToEnvironment?.({ name: "client" } as never)).toBe(false);

    const resolveId = plugin.resolveId;
    const handler =
      typeof resolveId === "object" && resolveId && "handler" in resolveId
        ? resolveId.handler
        : null;
    expect(handler).toBeTypeOf("function");

    const result = (handler as (id: string) => { id: string; external: true } | null).call(
      {},
      "@opentelemetry/semantic-conventions",
    );
    expect(result).toEqual({
      id: "@opentelemetry/semantic-conventions",
      external: true,
    });

    expect((handler as (id: string) => unknown).call({}, "react")).toBeNull();
  });

  it("is disabled for Cloudflare builds", () => {
    const plugin = createForceServerExternalsPlugin({
      getExternals: () => ["sharp"],
      isDisabled: () => true,
    });
    expect(plugin.applyToEnvironment?.({ name: "rsc" } as never)).toBe(false);
  });
});
