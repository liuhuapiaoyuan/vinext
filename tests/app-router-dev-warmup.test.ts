import { describe, expect, it, vi } from "vitest";
import {
  getAppRouterDevWarmupTargets,
  warmupAppRouterDevServer,
  warmupAppRouterVirtualEntries,
} from "../packages/vinext/src/server/app-router-dev-warmup.js";

describe("app-router dev warmup", () => {
  it("targets the bare virtual entry ids (not the /@id/__x00__ URL form)", () => {
    const targets = getAppRouterDevWarmupTargets({ hybridPagesDir: false });
    expect(targets.rsc).toEqual(["virtual:vinext-rsc-entry"]);
    expect(targets.ssr).toEqual(["virtual:vinext-app-ssr-entry"]);
    expect(targets.client).toEqual(["virtual:vinext-app-browser-entry"]);
  });

  it("includes hybrid Pages client entry when pages/ is present", () => {
    const hybrid = getAppRouterDevWarmupTargets({ hybridPagesDir: true });
    expect(hybrid.client).toContain("virtual:vinext-client-entry");

    const appOnly = getAppRouterDevWarmupTargets({ hybridPagesDir: false });
    expect(appOnly.client).not.toContain("virtual:vinext-client-entry");
  });

  it("warms each environment's virtual entries via warmupRequest, in parallel", async () => {
    const calls: Array<{ env: string; url: string }> = [];
    const makeEnv = (env: string) => ({
      warmupRequest: vi.fn(async (url: string) => {
        calls.push({ env, url });
      }),
    });
    const server = {
      environments: { rsc: makeEnv("rsc"), ssr: makeEnv("ssr"), client: makeEnv("client") },
    };

    const targets = getAppRouterDevWarmupTargets({ hybridPagesDir: false });
    await warmupAppRouterVirtualEntries(server, targets);

    // Bare virtual ids only — never the broken `/@fs/@id/...` form.
    expect(calls.every(({ url }) => url.startsWith("virtual:vinext-"))).toBe(true);
    expect(server.environments.rsc.warmupRequest).toHaveBeenCalledWith("virtual:vinext-rsc-entry");
    expect(server.environments.ssr.warmupRequest).toHaveBeenCalledWith(
      "virtual:vinext-app-ssr-entry",
    );
    expect(server.environments.client.warmupRequest).toHaveBeenCalledWith(
      "virtual:vinext-app-browser-entry",
    );
  });

  it("tolerates missing environments and warmupRequest failures", async () => {
    const server = {
      environments: {
        rsc: {
          warmupRequest: vi.fn(async () => {
            throw new Error("transform boom");
          }),
        },
        // ssr + client intentionally absent
      },
    };

    const targets = getAppRouterDevWarmupTargets({ hybridPagesDir: false });
    await expect(warmupAppRouterVirtualEntries(server, targets)).resolves.toBeUndefined();
    expect(server.environments.rsc.warmupRequest).toHaveBeenCalled();
  });

  it("does not follow warmup probe redirects", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { Location: "https://auth.example.test/login" },
      }),
    );
    const warmupRequest = vi.fn();
    const server = {
      config: { logger },
      environments: {
        rsc: { warmupRequest },
        ssr: { warmupRequest },
        client: { warmupRequest },
      },
      resolvedUrls: { local: ["http://127.0.0.1:4173/"] },
    };

    try {
      await warmupAppRouterDevServer(server as any);

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:4173/",
        expect.objectContaining({ redirect: "manual" }),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
