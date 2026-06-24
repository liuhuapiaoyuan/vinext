import { describe, expect, it, vi } from "vite-plus/test";
import { handleAppRouterImageOptimizationRequest } from "../packages/vinext/src/server/app-router-image-optimization.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+X8n26QAAAABJRU5ErkJggg==",
  "base64",
);

describe("handleAppRouterImageOptimizationRequest", () => {
  it("serves imported static media without redirecting to an absolute http URL", async () => {
    const fetchAsset = vi.fn(async (assetRequest: Request) => {
      expect(new URL(assetRequest.url).pathname).toBe(
        "/_next/static/media/xingbao-button.3109ba66.png",
      );
      return new Response(PNG_1X1, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });

    const response = await handleAppRouterImageOptimizationRequest(
      new Request(
        "http://x2.qxai666.com/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Fxingbao-button.3109ba66.png&w=941&q=75",
        { headers: { Accept: "image/webp,image/*" } },
      ),
      { basePath: "", env: { ASSETS: { fetch: fetchAsset } } },
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get("Location")).toBeNull();
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect((await response!.arrayBuffer()).byteLength).toBe(PNG_1X1.length);
  });

  it("strips basePath before matching the image optimization endpoint", async () => {
    const fetchAsset = vi.fn(
      async () =>
        new Response(PNG_1X1, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
    );

    const response = await handleAppRouterImageOptimizationRequest(
      new Request("http://example.test/docs/_next/image?url=%2Fimg.jpg&w=640&q=75"),
      { basePath: "/docs", env: { ASSETS: { fetch: fetchAsset } } },
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(fetchAsset).toHaveBeenCalledTimes(1);
  });

  it("returns null when ASSETS is unavailable so the RSC handler can fall back", async () => {
    const response = await handleAppRouterImageOptimizationRequest(
      new Request("http://example.test/_next/image?url=%2Fimg.jpg&w=640&q=75"),
      { basePath: "", env: {} },
    );
    expect(response).toBeNull();
  });
});
