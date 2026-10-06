import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadActionOwnerReachability,
  readIsolationState,
  saveActionOwnerReachability,
  serializeAssetsManifest,
  updateIsolationState,
} from "../packages/vinext/src/build/isolated-rsc-build.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-isolated-"));
  roots.push(root);
  return root;
}

describe("isolated RSC build state", () => {
  it("round-trips action owner reachability", () => {
    const root = tempRoot();
    const reachability = new Map([
      [
        "/app/page.tsx",
        {
          clientReferenceImportIds: new Set(["/app/button.tsx"]),
          serverReferenceIds: new Set(["/app/actions.ts"]),
        },
      ],
    ]);

    saveActionOwnerReachability(root, reachability);
    const loaded = loadActionOwnerReachability(root);

    expect(loaded.get("/app/page.tsx")?.clientReferenceImportIds.has("/app/button.tsx")).toBe(true);
    expect(loaded.get("/app/page.tsx")?.serverReferenceIds.has("/app/actions.ts")).toBe(true);
  });

  it("merges bundle metadata without dropping earlier phases", () => {
    const root = tempRoot();
    updateIsolationState(root, {
      bundles: {
        rsc: [
          {
            type: "chunk",
            fileName: "index.js",
            facadeModuleId: null,
            moduleIds: [],
            imports: [],
            importedCss: [],
            importedAssets: [],
          },
        ],
      },
      bundleDirs: { rsc: "/tmp/rsc" },
    });
    updateIsolationState(root, {
      bundles: { client: [{ type: "asset", fileName: "style.css", names: ["style.css"] }] },
      bundleDirs: { client: "/tmp/client" },
    });

    const state = readIsolationState(root);
    expect(state.bundles.rsc?.[0]?.fileName).toBe("index.js");
    expect(state.bundles.client?.[0]?.fileName).toBe("style.css");
    expect(state.bundleDirs).toEqual({ rsc: "/tmp/rsc", client: "/tmp/client" });
  });

  it("inlines runtime asset expressions in the assets manifest", () => {
    const runtime = new (class RuntimeAsset {
      runtime: string;
      constructor(value: string) {
        this.runtime = value;
      }
    })("assetUrl");

    expect(serializeAssetsManifest({ bootstrapScriptContent: runtime })).toBe(
      '{\n  "bootstrapScriptContent": assetUrl\n}',
    );
  });
});
