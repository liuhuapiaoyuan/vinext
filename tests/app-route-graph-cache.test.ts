import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  appRouteGraph,
  invalidateAppRouteCache,
} from "../packages/vinext/src/routing/app-router.js";

const mocks = vi.hoisted(() => ({
  buildAppRouteGraph: vi.fn(),
}));

vi.mock("../packages/vinext/src/routing/app-route-graph.js", () => ({
  buildAppRouteGraph: mocks.buildAppRouteGraph,
  computeAppRouteStaticSiblings: vi.fn(),
  computeRootParamNames: vi.fn(),
  convertSegmentsToRouteParts: vi.fn(),
}));

beforeEach(() => {
  mocks.buildAppRouteGraph.mockReset();
  invalidateAppRouteCache();
});

describe("App Router route graph cache", () => {
  it("shares one scan between concurrent calls for the same key", async () => {
    let releaseScan!: () => void;
    let markStarted!: () => void;
    const scanStarted = new Promise<void>((resolve) => (markStarted = resolve));
    mocks.buildAppRouteGraph.mockImplementationOnce(async () => {
      markStarted();
      await new Promise<void>((resolve) => (releaseScan = resolve));
      return { routes: [{ pattern: "/shared" }], routeManifest: {} };
    });

    const first = appRouteGraph("/virtual/app");
    await scanStarted;
    const second = appRouteGraph("/virtual/app");
    releaseScan();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { routes: [{ pattern: "/shared" }], routeManifest: {} },
      { routes: [{ pattern: "/shared" }], routeManifest: {} },
    ]);
    expect(mocks.buildAppRouteGraph).toHaveBeenCalledTimes(1);
  });

  it("retries a shared scan when a watcher invalidates it in flight", async () => {
    let releaseScan!: () => void;
    let markStarted!: () => void;
    const scanStarted = new Promise<void>((resolve) => (markStarted = resolve));
    mocks.buildAppRouteGraph
      .mockImplementationOnce(async () => {
        markStarted();
        await new Promise<void>((resolve) => (releaseScan = resolve));
        return { routes: [{ pattern: "/stale" }], routeManifest: {} };
      })
      .mockResolvedValueOnce({ routes: [{ pattern: "/fresh" }], routeManifest: {} });

    const first = appRouteGraph("/virtual/app");
    await scanStarted;
    const second = appRouteGraph("/virtual/app");
    invalidateAppRouteCache();
    releaseScan();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { routes: [{ pattern: "/fresh" }], routeManifest: {} },
      { routes: [{ pattern: "/fresh" }], routeManifest: {} },
    ]);
    expect(mocks.buildAppRouteGraph).toHaveBeenCalledTimes(2);
  });

  it("removes a rejected scan so the next call can retry", async () => {
    const failure = new Error("scan failed");
    mocks.buildAppRouteGraph
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ routes: [{ pattern: "/recovered" }], routeManifest: {} });

    await expect(appRouteGraph("/virtual/app")).rejects.toBe(failure);
    await expect(appRouteGraph("/virtual/app")).resolves.toEqual({
      routes: [{ pattern: "/recovered" }],
      routeManifest: {},
    });
    expect(mocks.buildAppRouteGraph).toHaveBeenCalledTimes(2);
  });

  it("isolates in-flight scans by app directory and extensions", async () => {
    mocks.buildAppRouteGraph.mockImplementation(
      async (appDir: string, matcher: { extensions: string[] }) => ({
        routes: [{ pattern: `${appDir}:${matcher.extensions.join(",")}` }],
        routeManifest: {},
      }),
    );

    const [appATypeScript, appBTypeScript, appAJavaScript] = await Promise.all([
      appRouteGraph("/virtual/app-a", ["tsx"]),
      appRouteGraph("/virtual/app-b", ["tsx"]),
      appRouteGraph("/virtual/app-a", ["js"]),
    ]);

    expect(appATypeScript.routes).toEqual([{ pattern: "/virtual/app-a:tsx" }]);
    expect(appBTypeScript.routes).toEqual([{ pattern: "/virtual/app-b:tsx" }]);
    expect(appAJavaScript.routes).toEqual([{ pattern: "/virtual/app-a:js" }]);
    expect(mocks.buildAppRouteGraph).toHaveBeenCalledTimes(3);
  });
});
