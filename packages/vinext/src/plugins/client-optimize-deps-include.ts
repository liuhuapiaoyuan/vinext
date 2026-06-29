import { createRequire } from "node:module";
import path from "node:path";

/**
 * next/* shims and other entries that always resolve via vinext aliases.
 * Included unconditionally — no install check.
 *
 * NOTE: `next/link` and `next/script` are intentionally omitted. They appear
 * in `VINEXT_OPTIMIZE_DEPS_EXCLUDE` because pre-bundling breaks @vitejs/plugin-rsc
 * client-reference export metadata in dev.
 */
export const VINEXT_SHIM_OPTIMIZE_DEPS_INCLUDE = Object.freeze(["next/dynamic", "next/image"]);

/**
 * Runtime deps pulled by the `next/image` shim (`@unpic/react` for remote CDN
 * transforms, `ipaddr.js` for private-IP validation). Pre-included on the
 * client so first `<Image>` render does not trigger a dep-optimizer reload.
 *
 * SSR keeps `ipaddr.js` in `optimizeDeps.exclude` — it is externalized there
 * and must not be pre-bundled into `deps_ssr/`.
 */
export const VINEXT_IMAGE_RUNTIME_OPTIMIZE_DEPS_INCLUDE = Object.freeze([
  "@unpic/react",
  "ipaddr.js",
]);

/**
 * Common client deps imported behind route boundaries, lazy client components,
 * or `next/dynamic()` / dynamic `import()` that static crawl misses.
 *
 * Filtered at config time — only entries resolvable from the project root are
 * pre-bundled, so missing optional packages do not break dev startup.
 */
export const VINEXT_OPTIONAL_CLIENT_OPTIMIZE_DEPS_INCLUDE = Object.freeze([
  // App shell
  "@tanstack/react-query",
  "agentation",
  "next-themes",
  "nuqs",
  "nuqs/adapters/next/app",
  "sonner",

  // Auth (ecosystem fixture)
  "better-auth/client/plugins",
  "better-auth/react",

  // Radix / shadcn UI
  "radix-ui",
  "@radix-ui/react-use-controllable-state",
  "@base-ui/react",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "cmdk",
  "vaul",
  "lucide-react",
  "lucide-react/dynamic",

  // Forms
  "react-hook-form",
  "@hookform/resolvers/zod",
  "zod",

  // DataView / tables / DnD
  "@tanstack/react-table",
  "@tanstack/react-virtual",
  "@dnd-kit/core",
  "@dnd-kit/react",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",
  "@dnd-kit/modifiers",

  // Inputs & layout widgets
  "date-fns",
  "date-fns/locale",
  "react-day-picker",
  "input-otp",
  "react-dropzone",
  "react-resizable-panels",
  "react-rnd",
  "embla-carousel-react",

  // AI chat / assistant-ui
  "@assistant-ui/react",
  "@assistant-ui/react-ai-sdk",
  "@assistant-ui/react-markdown",
  "@assistant-ui/react-streamdown",
  "@ai-sdk/react",
  "streamdown",
  "@streamdown/cjk",
  "@streamdown/code",
  "@streamdown/math",
  "@streamdown/mermaid",
  "motion/react",

  // Rich text / markdown
  "@tiptap/react",
  "@tiptap/starter-kit",
  "@tiptap/extension-mention",
  "@tiptap/extension-placeholder",
  "@tiptap/suggestion",
  "react-markdown",
  "remark-gfm",
  "rehype-raw",
  "aieditor",

  // Charts / diagrams / canvas
  "recharts",
  "mermaid",
  "@xyflow/react",
  "shiki",
  "react-syntax-highlighter",
  "fabric",

  // Media & misc UI
  "media-chrome",
  "@rive-app/react-webgl2",
  "react-image-crop",
  "@zumer/snapdom",
  "ansi-to-react",
  "react-jsx-parser",

  // Client utilities
  "@reactuses/core",
  "nanoid",
  "text-search-engine",
  "text-search-engine/react",
  "use-debounce",
  "usehooks-ts",
  "use-stick-to-bottom",
  "zustand",
  "mutative",

  // QR / payment
  "qrcode.react",
  "react-qr-code",

  // dynamic() / import() — static analysis misses these
  "page-agent",
  "wasm-image-optimization",

  // Misc heavy / lazy client-only
  "react-joyride",
  "three",
]);

/** @deprecated Use {@link VINEXT_SHIM_OPTIMIZE_DEPS_INCLUDE} and {@link VINEXT_OPTIONAL_CLIENT_OPTIMIZE_DEPS_INCLUDE}. */
export const VINEXT_CLIENT_OPTIMIZE_DEPS_INCLUDE = Object.freeze([
  ...VINEXT_SHIM_OPTIMIZE_DEPS_INCLUDE,
  ...VINEXT_OPTIONAL_CLIENT_OPTIMIZE_DEPS_INCLUDE,
]);

export function mergeOptimizeDepsInclude(
  ...includeGroups: readonly (readonly string[])[]
): string[] {
  const seen = new Set<string>();

  for (const group of includeGroups) {
    for (const entry of group) {
      if (seen.has(entry)) continue;
      seen.add(entry);
    }
  }

  return [...seen];
}

function getOptimizeDepsIncludeParent(entry: string): string | null {
  if (!entry.includes("/")) return null;

  if (entry.startsWith("@")) {
    const secondSlash = entry.indexOf("/", entry.indexOf("/") + 1);
    return secondSlash === -1 ? null : entry.slice(0, secondSlash);
  }

  const slashIndex = entry.indexOf("/");
  return slashIndex === -1 ? null : entry.slice(0, slashIndex);
}

function canPrebundleOptimizeDepsEntry(projectRequire: NodeRequire, entry: string): boolean {
  try {
    projectRequire.resolve(entry);
    return true;
  } catch {
    const parent = getOptimizeDepsIncludeParent(entry);
    if (parent === null) return false;
    try {
      projectRequire.resolve(parent);
      // Parent is installed — keep the subpath entry so Vite pre-bundles the
      // deep import (e.g. lucide-react/dynamic) instead of discovering it late.
      return true;
    } catch {
      return false;
    }
  }
}

export function filterInstalledOptimizeDepsInclude(
  projectRoot: string,
  entries: readonly string[],
): string[] {
  let projectRequire: NodeRequire;
  try {
    projectRequire = createRequire(path.join(projectRoot, "package.json"));
  } catch {
    return [];
  }

  const installed: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry)) continue;
    if (!canPrebundleOptimizeDepsEntry(projectRequire, entry)) continue;
    seen.add(entry);
    installed.push(entry);
  }

  return installed;
}

export function resolveClientOptimizeDepsInclude(
  projectRoot: string,
  ...extraGroups: readonly (readonly string[])[]
): string[] {
  return mergeOptimizeDepsInclude(
    VINEXT_SHIM_OPTIMIZE_DEPS_INCLUDE,
    VINEXT_IMAGE_RUNTIME_OPTIMIZE_DEPS_INCLUDE,
    filterInstalledOptimizeDepsInclude(projectRoot, VINEXT_OPTIONAL_CLIENT_OPTIMIZE_DEPS_INCLUDE),
    ...extraGroups,
  );
}
