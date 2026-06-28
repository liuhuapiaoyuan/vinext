/**
 * Client-environment deps commonly imported behind route boundaries or lazy
 * client components. Pre-including them avoids late discovery, re-optimisation
 * cascades, and full-page reloads during dev navigation.
 */
export const VINEXT_CLIENT_OPTIMIZE_DEPS_INCLUDE = Object.freeze([
  "next/dynamic",
  "page-agent",
  "react-rnd",
  "@ai-sdk/react",
  "@base-ui/react",
  "@dnd-kit/core",
  "@dnd-kit/modifiers",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",
  "@hookform/resolvers/zod",
  "@tanstack/react-table",
  "@tanstack/react-virtual",
  "nanoid",
  "nuqs",
  "react-day-picker",
  "react-image-crop",
  "text-search-engine/react",
  "vaul",
  "better-auth/client/plugins",
  "better-auth/react",
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
