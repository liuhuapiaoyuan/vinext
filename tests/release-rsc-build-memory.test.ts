import { describe, expect, it } from "vitest";
import { releaseEnvironmentBundle } from "../packages/vinext/src/build/release-rsc-build-memory.js";

describe("release RSC build memory", () => {
  it("drops a scan bundle instead of keeping its source", () => {
    const source = "x".repeat(1000);
    const bundles = {
      rsc: {
        "index.js": {
          type: "chunk",
          code: source,
          modules: { "/app/page.tsx": { code: source } },
          facadeModuleId: "/app/page.tsx",
        },
      },
    };

    releaseEnvironmentBundle(bundles, "rsc", false);

    expect(bundles.rsc).toBeUndefined();
  });

  it("keeps chunk identity and drops source after a real build", () => {
    const source = "y".repeat(1000);
    const bundles = {
      rsc: {
        "index.js": {
          type: "chunk",
          code: source,
          modules: { "/app/page.tsx": { code: source } },
          map: { mappings: "AAAA" },
          facadeModuleId: "/app/page.tsx",
          fileName: "index.js",
        },
        "style.css": {
          type: "asset",
          source: "body{}",
          fileName: "style.css",
        },
      },
    };

    releaseEnvironmentBundle(bundles, "rsc", true);

    expect(bundles.rsc["index.js"]?.code).toBe("");
    expect(bundles.rsc["index.js"]?.modules).toEqual({});
    expect(bundles.rsc["index.js"]?.map).toBeNull();
    expect(bundles.rsc["index.js"]?.facadeModuleId).toBe("/app/page.tsx");
    expect(bundles.rsc["style.css"]?.source).toBe("body{}");
  });

  it("drops RSC asset bytes after the client build has copied them", () => {
    const bundles = {
      rsc: {
        "style.css": { type: "asset", source: "body{}" },
      },
      client: {
        "index.js": {
          type: "chunk",
          code: "client",
          modules: { "/app/client.tsx": { code: "client" } },
        },
      },
    };

    releaseEnvironmentBundle(bundles, "client", true);

    expect(bundles.client["index.js"]?.code).toBe("");
    expect(bundles.rsc["style.css"]?.source).toBe("");
  });
});
