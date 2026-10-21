import { afterEach, describe, expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendServerExternals,
  readServerExternals,
} from "../packages/vinext/src/build/isolated-rsc-build.js";
import {
  collectImportedPackages,
  findMissingExternals,
} from "../packages/vinext/src/build/verify-externals.js";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-externals-"));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf-8");
}

function writePackage(serverDir: string, packageName: string): void {
  writeFile(
    serverDir,
    path.join("node_modules", packageName, "package.json"),
    JSON.stringify({ name: packageName, version: "1.0.0" }),
  );
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("server externals across isolated build phases", () => {
  it("persists names collected by each phase and merges them", () => {
    const root = makeTmpDir();

    // Simulates the `rsc` and `ssr` child processes, which each exit before the
    // `nitro` phase runs the copy step.
    appendServerExternals(root, ["@aws-sdk/client-s3", "pino"]);
    appendServerExternals(root, ["pino", "bullmq"]);

    expect(readServerExternals(root).sort()).toEqual(["@aws-sdk/client-s3", "bullmq", "pino"]);
  });

  it("returns an empty list when no phase reported externals", () => {
    expect(readServerExternals(makeTmpDir())).toEqual([]);
  });

  it("preserves state written by other phases", () => {
    const root = makeTmpDir();
    appendServerExternals(root, ["pino"]);
    const statePath = path.join(root, "node_modules", ".vinext", "isolated-rsc-build.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    state.bundles = { ssr: [] };
    fs.writeFileSync(statePath, JSON.stringify(state), "utf-8");

    appendServerExternals(root, ["pg"]);

    const after = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(after.serverExternals.sort()).toEqual(["pg", "pino"]);
    expect(after.bundles).toEqual({ ssr: [] });
  });
});

describe("collectImportedPackages", () => {
  it("extracts static, dynamic and side-effect package imports", () => {
    const code = [
      'import x from "@aws-sdk/client-s3";',
      'import "@elysiajs/openapi";',
      'await import("bullmq");',
      'import y from\n  "@opentelemetry/api";',
    ].join("\n");

    expect([...collectImportedPackages(code)].sort()).toEqual([
      "@aws-sdk/client-s3",
      "@elysiajs/openapi",
      "@opentelemetry/api",
      "bullmq",
    ]);
  });

  it("reduces subpaths to package names", () => {
    expect([...collectImportedPackages('import x from "pg/lib/index.js";')]).toEqual(["pg"]);
    expect([...collectImportedPackages('import x from "@scope/pkg/sub/entry.js";')]).toEqual([
      "@scope/pkg",
    ]);
  });

  it("ignores builtins, relative paths, virtual modules and URLs", () => {
    const code = [
      'import a from "node:fs";',
      'import b from "fs/promises";',
      'import c from "./relative.js";',
      'import d from "virtual:vinext";',
      'import e from "file:///x.mjs";',
    ].join("\n");

    expect([...collectImportedPackages(code)]).toEqual([]);
  });
});

describe("findMissingExternals", () => {
  it("reports packages imported by the output but absent from its node_modules", () => {
    const serverDir = makeTmpDir();
    // Reproduces the incident: the chunk keeps a bare import, the package
    // never landed in the output, and the image only copies .output.
    writeFile(
      serverDir,
      "_ssr/object-storage-DKvvFt0-.mjs",
      'import { S3Client } from "@aws-sdk/client-s3";\nexport const x = S3Client;\n',
    );
    writeFile(serverDir, "index.mjs", 'import pino from "pino";\nimport "./_ssr/x.mjs";\n');
    writePackage(serverDir, "pino");

    const report = findMissingExternals(serverDir);

    expect(report.missing).toEqual(["@aws-sdk/client-s3"]);
    expect(report.importers["@aws-sdk/client-s3"]).toEqual([
      path.join("_ssr", "object-storage-DKvvFt0-.mjs"),
    ]);
  });

  it("passes when every imported package is present", () => {
    const serverDir = makeTmpDir();
    writeFile(serverDir, "index.mjs", 'import pino from "pino";\n');
    writePackage(serverDir, "pino");

    expect(findMissingExternals(serverDir).missing).toEqual([]);
  });

  it("does not scan inside node_modules", () => {
    const serverDir = makeTmpDir();
    writeFile(serverDir, "index.mjs", "export const ok = true;\n");
    // A dependency's own imports are resolved relative to that dependency,
    // not the output root, so they must not be reported.
    writeFile(serverDir, "node_modules/some-dep/index.mjs", 'import "its-own-dep";\n');
    writePackage(serverDir, "some-dep");

    expect(findMissingExternals(serverDir).missing).toEqual([]);
  });
});
