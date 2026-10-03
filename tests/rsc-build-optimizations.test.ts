import { describe, expect, it, vi } from "vitest";
import { optimizeServerReferenceDeletes } from "../packages/vinext/src/plugins/rsc-build-optimizations.js";

describe("RSC build optimizations", () => {
  it("skips metadata rebuilds for claims that do not exist", () => {
    const replaceClaim = vi.fn();
    const deleteClaim = vi.fn();
    const serverReferences = { replaceClaim, deleteClaim } as unknown as Parameters<
      typeof optimizeServerReferenceDeletes
    >[0];

    optimizeServerReferenceDeletes(serverReferences);

    serverReferences.deleteClaim("rsc:use-server", "/app/page.tsx");
    expect(deleteClaim).not.toHaveBeenCalled();

    serverReferences.replaceClaim("rsc:use-server", "/app/actions.ts", {
      importId: "/app/actions.ts",
      referenceKey: "actions",
      exportNames: ["submit"],
    });
    serverReferences.deleteClaim("rsc:use-server", "/app/actions.ts");
    serverReferences.deleteClaim("rsc:use-server", "/app/actions.ts");

    expect(replaceClaim).toHaveBeenCalledTimes(1);
    expect(deleteClaim).toHaveBeenCalledTimes(1);
  });
});
