import { describe, expect, it } from "vite-plus/test";
import {
  hasNonClientImporter,
  isInsideClientBoundary,
  shouldSuppressRscHotUpdate,
  wrapRscHotUpdatePlugins,
  type GraphModule,
} from "../packages/vinext/src/plugins/rsc-client-owned-hmr.js";

function node(id: string, importers: GraphModule[] = []): GraphModule {
  const mod: GraphModule = { id, importers: [] };
  (mod as { importers: GraphModule[] }).importers = importers;
  return mod;
}

describe("rsc client-owned HMR", () => {
  it("walks importers to find a use-client reference", () => {
    const client = node("/app/files-upload-menu.tsx");
    const helper = node("/app/upload-library-file.ts", [client]);
    const isClientReference = (id: string) => id.endsWith("files-upload-menu.tsx");

    expect(isInsideClientBoundary([helper], isClientReference)).toBe(true);
    expect(isInsideClientBoundary([client], isClientReference)).toBe(true);
    expect(isInsideClientBoundary([node("/app/orphan.ts")], isClientReference)).toBe(false);
  });

  it("detects a real server importer in the RSC graph", () => {
    const page = node("/app/page.tsx");
    const helper = node("/app/upload-library-file.ts", [page]);
    const isClientReference = (id: string) => id.endsWith("files-upload-menu.tsx");

    expect(hasNonClientImporter([helper], isClientReference)).toBe(true);
    expect(
      hasNonClientImporter(
        [node("/app/helper.ts", [node("/app/files-upload-menu.tsx")])],
        isClientReference,
      ),
    ).toBe(false);
  });

  it("suppresses RSC HMR when only the client graph owns an unmarked helper", () => {
    const clientBoundary = node("/app/files-upload-menu.tsx");
    const clientHelper = node("/app/upload-library-file.ts", [clientBoundary]);
    const rscHelper = node("/app/upload-library-file.ts");

    const ctx = {
      file: "/app/upload-library-file.ts",
      modules: [rscHelper],
      server: {
        environments: {
          client: {
            moduleGraph: {
              getModuleById(id: string) {
                if (id === "/app/upload-library-file.ts") return clientHelper;
                return undefined;
              },
            },
          },
        },
        config: {
          plugins: [
            {
              name: "rsc:minimal",
              api: {
                manager: {
                  clientReferenceMetaMap: {
                    "/app/files-upload-menu.tsx": {},
                  },
                },
              },
            },
          ],
        },
      },
    };

    expect(shouldSuppressRscHotUpdate(ctx as never)).toBe(true);
  });

  it("does not suppress RSC HMR when a Server Component also imports the file", () => {
    const page = node("/app/page.tsx");
    const helper = node("/app/shared.ts", [page]);
    const clientBoundary = node("/app/menu.tsx");
    const clientHelper = node("/app/shared.ts", [clientBoundary]);

    const ctx = {
      file: "/app/shared.ts",
      modules: [helper],
      server: {
        environments: {
          client: {
            moduleGraph: {
              getModuleById(id: string) {
                if (id === "/app/shared.ts") return clientHelper;
                return undefined;
              },
            },
          },
        },
        config: {
          plugins: [
            {
              name: "rsc:minimal",
              api: {
                manager: {
                  clientReferenceMetaMap: { "/app/menu.tsx": {} },
                },
              },
            },
          ],
        },
      },
    };

    expect(shouldSuppressRscHotUpdate(ctx as never)).toBe(false);
  });

  it("does not pass unchanged CSS importers to the client HMR hook", async () => {
    let receivedImporters: GraphModule[] = [];
    const cssImporter = node("/app/styles.css");
    const changed = node("/app/page.tsx", [cssImporter]);
    const wrapped = wrapRscHotUpdatePlugins([
      {
        name: "rsc",
        hotUpdate(ctx) {
          receivedImporters = [...(ctx.modules[0]?.importers ?? [])];
        },
      },
    ]);

    const hotUpdate = wrapped[0]?.hotUpdate;
    expect(hotUpdate).toBeTypeOf("function");
    if (typeof hotUpdate !== "function") throw new Error("expected function");

    await hotUpdate.call(
      { environment: { name: "client" } } as never,
      {
        file: "/app/page.tsx",
        modules: [changed],
        server: { environments: {}, config: { plugins: [] } },
      } as never,
    );

    expect(receivedImporters).toEqual([]);
    expect(changed.importers).toEqual([cssImporter]);
  });

  it("retains non-CSS importers while dropping unchanged CSS importers", async () => {
    let receivedImporters: GraphModule[] = [];
    const cssImporter = node("/app/styles.css");
    const serverImporter = node("/app/layout.tsx");
    const changed = node("/app/shared.ts", [cssImporter, serverImporter]);
    const wrapped = wrapRscHotUpdatePlugins([
      {
        name: "rsc",
        hotUpdate(ctx) {
          receivedImporters = [...(ctx.modules[0]?.importers ?? [])];
        },
      },
    ]);

    const hotUpdate = wrapped[0]?.hotUpdate;
    expect(hotUpdate).toBeTypeOf("function");
    if (typeof hotUpdate !== "function") throw new Error("expected function");

    await hotUpdate.call(
      { environment: { name: "client" } } as never,
      {
        file: "/app/shared.ts",
        modules: [changed],
        server: { environments: {} },
      } as never,
    );

    expect(receivedImporters).toEqual([serverImporter]);
    expect(changed.importers).toEqual([cssImporter, serverImporter]);
  });

  it("does not short-circuit a direct CSS edit", async () => {
    let called = false;
    const cssImporter = node("/app/page.tsx");
    const changed = node("/app/styles.css", [cssImporter]);
    const wrapped = wrapRscHotUpdatePlugins([
      {
        name: "rsc",
        hotUpdate(ctx) {
          called = true;
          expect(ctx.modules[0]?.importers).toEqual([cssImporter]);
        },
      },
    ]);

    const hotUpdate = wrapped[0]?.hotUpdate;
    expect(hotUpdate).toBeTypeOf("function");
    if (typeof hotUpdate !== "function") throw new Error("expected function");

    await hotUpdate.call(
      { environment: { name: "client" } } as never,
      {
        file: "/app/styles.css",
        modules: [changed],
        server: { environments: {} },
      } as never,
    );

    expect(called).toBe(true);
  });

  it("skips RSC work when every changed script module has only CSS importers", async () => {
    let called = false;
    const changed = node("/app/page.tsx", [node("/app/styles.css")]);
    const wrapped = wrapRscHotUpdatePlugins([
      {
        name: "rsc",
        hotUpdate() {
          called = true;
        },
      },
    ]);

    const hotUpdate = wrapped[0]?.hotUpdate;
    expect(hotUpdate).toBeTypeOf("function");
    if (typeof hotUpdate !== "function") throw new Error("expected function");

    const result = await hotUpdate.call(
      { environment: { name: "rsc" } } as never,
      {
        file: "/app/page.tsx",
        modules: [changed],
        server: { environments: {}, config: { plugins: [] } },
      } as never,
    );

    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it("wraps the rsc plugin hotUpdate hook", async () => {
    let called = false;
    const wrapped = wrapRscHotUpdatePlugins([
      {
        name: "rsc",
        async hotUpdate() {
          called = true;
        },
      },
    ]);

    const hotUpdate = wrapped[0]?.hotUpdate;
    expect(hotUpdate).toBeTypeOf("function");
    if (typeof hotUpdate !== "function") throw new Error("expected function");

    const result = await hotUpdate.call(
      { environment: { name: "rsc" } } as never,
      {
        file: "/app/upload-library-file.ts",
        modules: [node("/app/upload-library-file.ts")],
        server: {
          environments: {
            client: {
              moduleGraph: {
                getModuleById(id: string) {
                  if (id !== "/app/upload-library-file.ts") return undefined;
                  return node("/app/upload-library-file.ts", [node("/app/menu.tsx")]);
                },
              },
            },
          },
          config: {
            plugins: [
              {
                name: "rsc:minimal",
                api: { manager: { clientReferenceMetaMap: { "/app/menu.tsx": {} } } },
              },
            ],
          },
        },
      } as never,
    );

    expect(result).toEqual([]);
    expect(called).toBe(false);
  });
});
