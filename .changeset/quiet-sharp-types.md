---
"@vinext/types": patch
---

Stop shadowing installed dependencies with the default type stubs.

`@vinext/types/next` declares `declare module "sharp"` as `unknown`. An ambient module declaration takes precedence over the real package's declarations, so any consumer that actually installs `sharp` (image scripts, Server Actions, custom image pipelines) saw its constructor typed as `unknown` and every call failed type-checking.

The stub now lives in an opt-in file, `@vinext/types/next/optional-stubs`, which you reference explicitly when `sharp` is genuinely absent and `skipLibCheck` is off. The default entry no longer declares it, so installed packages keep their own types.
