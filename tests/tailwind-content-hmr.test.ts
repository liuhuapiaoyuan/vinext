import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { wrapTailwindContentHmrPlugins } from "../packages/vinext/src/plugins/tailwind-content-hmr.js";

function scannerFromCandidates() {
  return {
    getCandidatesWithPositions({ content }: { content: string }) {
      return [...new Set(content.match(/(?:[a-z]+:)?[a-z-]+-\d+/gi) ?? [])].map((candidate) => ({
        candidate,
      }));
    },
  };
}

describe("Tailwind content HMR", () => {
  it("skips script edits when the Tailwind candidate set is unchanged", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vinext-tailwind-hmr-"));
    const file = path.join(directory, "page.tsx");
    let delegated = 0;
    const plugin = {
      name: "@tailwindcss/vite:generate:serve",
      hotUpdate: () => {
        delegated += 1;
        return "delegated";
      },
    };

    try {
      wrapTailwindContentHmrPlugins([plugin as never], { loadScanner: scannerFromCandidates });
      await writeFile(file, 'export const color = "text-red-500";');
      const hotUpdate = Reflect.get(plugin, "hotUpdate") as unknown as (
        this: unknown,
        ctx: unknown,
      ) => Promise<unknown>;

      expect(await hotUpdate.call({}, { file })).toBe("delegated");

      await writeFile(file, 'export const color = "text-red-500";\nexport const value = 1;');
      expect(await hotUpdate.call({}, { file })).toEqual([]);
      expect(delegated).toBe(1);

      await writeFile(file, 'export const color = "text-blue-500";');
      expect(await hotUpdate.call({}, { file })).toBe("delegated");
      expect(delegated).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the original hook for CSS and non-Tailwind plugins", async () => {
    const plugin = {
      name: "@tailwindcss/vite:generate:serve",
      hotUpdate: {
        handler: async () => "tailwind",
      },
    };
    const other = {
      name: "other-plugin",
      hotUpdate: () => "other",
    };

    wrapTailwindContentHmrPlugins([plugin as never, other as never], {
      loadScanner: scannerFromCandidates,
    });

    const tailwindHandler = Reflect.get(plugin.hotUpdate, "handler") as (
      this: unknown,
      ctx: { file: string },
    ) => Promise<unknown>;
    expect(await tailwindHandler.call({}, { file: "/app/styles.css" })).toBe("tailwind");
    expect(other.hotUpdate()).toBe("other");
  });
});
