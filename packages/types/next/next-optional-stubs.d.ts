/**
 * Optional stubs for dependencies Next.js treats as optional.
 *
 * These are NOT referenced by `@vinext/types/next`: an ambient `declare module` wins over
 * real package types, so shipping one by default silently hides the types of a package the
 * consumer actually installed (a project with `sharp` installed saw the constructor as
 * `unknown`). Reference this file explicitly only when the dependency is genuinely absent and
 * `skipLibCheck` is off:
 *
 *   /// <reference types="@vinext/types/next/optional-stubs" />
 */
declare module "sharp" {
  const sharp: unknown;
  export default sharp;
}
