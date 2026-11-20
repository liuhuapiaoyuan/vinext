// The fork publishes `packages/vinext` as `@qzsy/vinext`, but the package's own
// sources still import each other through the bare `vinext/*` specifiers that
// upstream's package name provides. In-repo builds resolve those through the
// Vite aliases and tsconfig paths, but tooling that hands a vinext source file
// to a *separate* Vite instance — the deploy tests bundle a temp project's
// `vite.config.ts` this way — resolves the specifiers with plain Node rules and
// needs the package to exist under the name its import graph uses.
//
// Upstream gets that for free: `hoist-workspace-packages` links the workspace
// package into `node_modules` under its own name. Aliasing `@qzsy/vinext` back
// to `vinext` here restores the same property after `pnpm install`.
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const packageDir = path.join(repoRoot, "packages", "vinext");
const linkPath = path.join(repoRoot, "node_modules", "vinext");

if (!fs.existsSync(path.join(packageDir, "package.json"))) {
  // Nothing installed yet (or a bare checkout): leave the tree alone.
  process.exit(0);
}

const currentTarget = (() => {
  try {
    return fs.realpathSync(linkPath);
  } catch {
    return null;
  }
})();

if (currentTarget === fs.realpathSync(packageDir)) {
  process.exit(0);
}

fs.rmSync(linkPath, { force: true, recursive: false });
fs.mkdirSync(path.dirname(linkPath), { recursive: true });
// A junction needs no extra Windows privilege; POSIX ignores the type.
fs.symlinkSync(packageDir, linkPath, "junction");
console.log("[vinext] linked node_modules/vinext -> packages/vinext (fork package name)");
