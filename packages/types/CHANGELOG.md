# @vinext/types

## 1.0.2

### Bug Fixes

- **Types:** stop shadowing installed dependencies with the default type stubs

  `@vinext/types/next` declared `declare module "sharp"` as `unknown`. An ambient module declaration takes precedence over the real package's declarations, so any consumer that actually installed `sharp` saw its constructor typed as `unknown` and every call failed type-checking. The stub now lives in the opt-in `@vinext/types/next/optional-stubs` entry, which is referenced explicitly when `sharp` is genuinely absent.

## 1.0.1

### Bug Fixes

- **Shims:** support stable catchError and retry APIs (#3566)

## 1.0.0

## 1.0.0-beta.2

### Features

- **Types:** ship Next-compatible types without Next.js (#2612)

### Contributors

- @james-elicx
