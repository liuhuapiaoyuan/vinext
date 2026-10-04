import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "pathslash";
import type { HotUpdateOptions, Plugin } from "vite";

type TailwindCandidate = { candidate: string };

type TailwindScanner = {
  getCandidatesWithPositions: (input: {
    file: string;
    content: string;
    extension: string;
  }) => TailwindCandidate[];
};

type TailwindScannerConstructor = new (options: { sources: [] }) => TailwindScanner;

type TailwindOxideModule = {
  Scanner?: TailwindScannerConstructor;
};

type TailwindHotUpdatePlugin = Plugin & {
  __vinextTailwindContentHmr?: true;
};

type TailwindContentHmrOptions = {
  loadScanner?: () => TailwindScanner | null;
};

const TAILWIND_GENERATE_PLUGIN = "@tailwindcss/vite:generate:serve";
const SCRIPT_FILE_RE = /\.[cm]?[jt]sx?$/i;
const MAX_SIGNATURES = 512;

function loadTailwindScanner(): TailwindScanner | null {
  try {
    // Resolve from the user's project so a symlinked vinext installation uses
    // the same native Oxide package as @tailwindcss/vite.
    const projectRequire = createRequire(path.resolve(process.cwd(), "package.json"));
    const tailwindRequire = createRequire(projectRequire.resolve("@tailwindcss/vite"));
    const oxide = tailwindRequire("@tailwindcss/oxide") as TailwindOxideModule;
    return oxide.Scanner ? new oxide.Scanner({ sources: [] }) : null;
  } catch {
    // Tailwind is optional. A missing or incompatible Oxide package simply
    // disables this optimization and leaves the original plugin untouched.
    return null;
  }
}

function candidateSignature(scanner: TailwindScanner, file: string, content: string): string {
  const extension = path.extname(file).slice(1).toLowerCase();
  const candidates = new Set(
    scanner
      .getCandidatesWithPositions({ file, content, extension })
      .map(({ candidate }) => candidate),
  );
  return [...candidates].sort().join("\u0000");
}

function wrapTailwindHotUpdate(
  plugin: TailwindHotUpdatePlugin,
  options: TailwindContentHmrOptions,
): TailwindHotUpdatePlugin {
  if (!plugin.hotUpdate || plugin.__vinextTailwindContentHmr) return plugin;

  const original = plugin.hotUpdate;
  const originalHandler = typeof original === "function" ? original : original.handler;
  const loadScanner = options.loadScanner ?? loadTailwindScanner;
  const signatures = new Map<string, string>();
  let scanner: TailwindScanner | null | undefined;

  async function wrapped(this: ThisParameterType<typeof originalHandler>, ctx: HotUpdateOptions) {
    if (SCRIPT_FILE_RE.test(ctx.file)) {
      scanner ??= loadScanner();
      if (scanner) {
        try {
          const content = await readFile(ctx.file, "utf8");
          const signature = candidateSignature(scanner, ctx.file, content);
          const previousSignature = signatures.get(ctx.file);
          signatures.delete(ctx.file);
          signatures.set(ctx.file, signature);
          while (signatures.size > MAX_SIGNATURES) {
            const oldest = signatures.keys().next().value;
            if (oldest === undefined) break;
            signatures.delete(oldest);
          }
          if (previousSignature !== undefined && previousSignature === signature) return [];
        } catch {
          signatures.delete(ctx.file);
        }
      }
    }

    return originalHandler.call(this, ctx);
  }

  try {
    plugin.hotUpdate = typeof original === "function" ? wrapped : { ...original, handler: wrapped };
    plugin.__vinextTailwindContentHmr = true;
  } catch {
    // A custom config may freeze plugin objects. Leave such plugins untouched
    // instead of making an optional optimization break dev startup.
  }
  return plugin;
}

/**
 * Avoid regenerating Tailwind's stylesheet for script edits that leave its
 * candidate set unchanged. Tailwind itself remains authoritative whenever a
 * candidate changes, and CSS/source changes are never filtered here.
 */
export function wrapTailwindContentHmrPlugins(
  plugins: readonly Plugin[],
  options: TailwindContentHmrOptions = {},
): readonly Plugin[] {
  for (const plugin of plugins) {
    if (plugin.name === TAILWIND_GENERATE_PLUGIN) {
      wrapTailwindHotUpdate(plugin as TailwindHotUpdatePlugin, options);
    }
  }
  return plugins;
}

/**
 * A Vite plugin that patches the resolved Tailwind plugin in place. Vite
 * invokes hotUpdate on the resolved plugin objects, so returning cloned
 * plugins from a separate hook would leave the original hooks active.
 */
export function createTailwindContentHmrPlugin(): Plugin {
  return {
    name: "vinext:tailwind-content-hmr",
    configResolved(config) {
      wrapTailwindContentHmrPlugins(config.plugins);
    },
  };
}
