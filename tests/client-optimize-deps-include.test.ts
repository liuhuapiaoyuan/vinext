import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  VINEXT_OPTIONAL_CLIENT_OPTIMIZE_DEPS_INCLUDE,
  VINEXT_SHIM_OPTIMIZE_DEPS_INCLUDE,
  filterInstalledOptimizeDepsInclude,
  mergeOptimizeDepsInclude,
  resolveClientOptimizeDepsInclude,
} from "../packages/vinext/src/plugins/client-optimize-deps-include.js";

describe("client optimizeDeps include", () => {
  it("always includes next/* shims that resolve via vinext aliases", () => {
    expect(VINEXT_SHIM_OPTIMIZE_DEPS_INCLUDE).toContain("next/dynamic");
    expect(VINEXT_SHIM_OPTIMIZE_DEPS_INCLUDE).toContain("next/image");
    expect(VINEXT_SHIM_OPTIMIZE_DEPS_INCLUDE).not.toContain("next/link");
    expect(VINEXT_SHIM_OPTIMIZE_DEPS_INCLUDE).not.toContain("next/script");
  });

  it("deduplicates merged include groups", () => {
    expect(mergeOptimizeDepsInclude(["react", "nuqs"], ["nuqs", "sonner"])).toEqual([
      "react",
      "nuqs",
      "sonner",
    ]);
  });

  it("filters optional entries to packages installed in the project", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const installed = filterInstalledOptimizeDepsInclude(
      repoRoot,
      VINEXT_OPTIONAL_CLIENT_OPTIMIZE_DEPS_INCLUDE,
    );

    // Monorepo root has react/next but not the full admin UI stack.
    expect(installed).not.toEqual([...VINEXT_OPTIONAL_CLIENT_OPTIMIZE_DEPS_INCLUDE]);
    expect(
      installed.every((entry) => VINEXT_OPTIONAL_CLIENT_OPTIMIZE_DEPS_INCLUDE.includes(entry)),
    ).toBe(true);
  });

  it("includes shims unconditionally and optional deps only when installed", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const include = resolveClientOptimizeDepsInclude(repoRoot, ["react"]);

    expect(include).toContain("next/dynamic");
    expect(include).toContain("next/image");
    expect(include).toContain("react");
    expect(new Set(include).size).toBe(include.length);
  });
});
