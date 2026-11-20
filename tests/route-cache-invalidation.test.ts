import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { appRouter, invalidateAppRouteCache } from "../packages/vinext/src/routing/app-router.js";
import { invalidateRouteCache, pagesRouter } from "../packages/vinext/src/routing/pages-router.js";

const mocks = vi.hoisted(() => ({
  buildAppRouteGraph: vi.fn(),
  glob: vi.fn(),
}));

// The fork's scanner skips the scan entirely when the pages directory does not
// exist (see `isDirectory` in routing/file-matcher.ts), and the mocked `glob`
// only takes over once a scan starts. Point the cache at a real, empty
// directory so the in-flight invalidation retry is what the test exercises.
const pagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-route-cache-"));

afterAll(() => {
  fs.rmSync(pagesDir, { recursive: true, force: true });
});

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  glob: mocks.glob,
}));

vi.mock("../packages/vinext/src/routing/app-route-graph.js", () => ({
  buildAppRouteGraph: mocks.buildAppRouteGraph,
  computeAppRouteStaticSiblings: vi.fn(),
  computeRootParamNames: vi.fn(),
  convertSegmentsToRouteParts: vi.fn(),
}));

beforeEach(() => {
  mocks.buildAppRouteGraph.mockReset();
  mocks.glob.mockReset();
  invalidateAppRouteCache();
  invalidateRouteCache(pagesDir);
});

describe("route cache invalidation", () => {
  it("retries an App Router scan invalidated while it is in flight", async () => {
    let markStarted!: () => void;
    let releaseScan!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const scanReleased = new Promise<void>((resolve) => (releaseScan = resolve));

    mocks.buildAppRouteGraph
      .mockImplementationOnce(async () => {
        markStarted();
        await scanReleased;
        return { routes: [{ pattern: "/old" }], routeManifest: {} };
      })
      .mockResolvedValueOnce({ routes: [{ pattern: "/new" }], routeManifest: {} });

    const routesPromise = appRouter("/virtual/app");
    await started;
    invalidateAppRouteCache();
    releaseScan();

    await expect(routesPromise).resolves.toEqual([{ pattern: "/new" }]);
    expect(mocks.buildAppRouteGraph).toHaveBeenCalledTimes(2);
  });

  it("retries a Pages Router scan invalidated while it is in flight", async () => {
    let markStarted!: () => void;
    let releaseScan!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const scanReleased = new Promise<void>((resolve) => (releaseScan = resolve));

    mocks.glob
      .mockImplementationOnce(async function* () {
        yield "index.tsx";
        markStarted();
        await scanReleased;
      })
      .mockImplementationOnce(async function* () {
        yield "index.tsx";
        yield "new.tsx";
      });

    const routesPromise = pagesRouter(pagesDir);
    await started;
    const concurrentRoutesPromise = pagesRouter(pagesDir);
    invalidateRouteCache(pagesDir);
    releaseScan();

    const expectedRoutes = [
      expect.objectContaining({ pattern: "/" }),
      expect.objectContaining({ pattern: "/new" }),
    ];
    await expect(routesPromise).resolves.toEqual(expectedRoutes);
    await expect(concurrentRoutesPromise).resolves.toEqual(expectedRoutes);
    expect(mocks.glob).toHaveBeenCalledTimes(2);
  });
});
