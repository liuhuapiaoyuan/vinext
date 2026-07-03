---
"@qzsy/vinext": patch
---

fix app-only dev warmup regression by skipping pages scan in pages-client-assets when pages/ is absent, use isDirectory for router detection, and filter next/image optimizeDeps to installed packages in monorepos
