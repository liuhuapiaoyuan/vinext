import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vite-plus/test";
import vinext from "../packages/vinext/src/index.js";
import {
  prepareBundledDevTransformUrl,
  shouldServeBundledDevModule,
} from "../packages/vinext/src/server/bundled-dev-transform.js";

const roots: string[] = [];
let server: ViteDevServer | undefined;

function tempDirWithoutShortNames(): string {
  // Vite rejects Windows 8.3 paths such as ADMINI~1 in server.fs.allow.
  const homeTemp = path.join(os.homedir(), "AppData", "Local", "Temp");
  const candidates = [homeTemp, fs.realpathSync.native(os.tmpdir()), os.tmpdir()];
  return candidates.find((dir) => fs.existsSync(dir) && !dir.includes("~")) ?? os.tmpdir();
}

function createApp(): string {
  const root = fs.mkdtempSync(path.join(tempDirWithoutShortNames(), "vinext-bundled-dev-css-"));
  roots.push(root);
  fs.symlinkSync(
    path.resolve(import.meta.dirname, "../node_modules"),
    path.join(root, "node_modules"),
    "junction",
  );
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(
    path.join(root, "app/globals.css"),
    "body { background-color: rgb(1, 2, 3); }\n",
  );
  fs.writeFileSync(
    path.join(root, "app/layout.tsx"),
    `import "./globals.css";
export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>;
}
`,
  );
  fs.writeFileSync(
    path.join(root, "app/page.tsx"),
    "export default function Page() { return <h1>styled</h1>; }\n",
  );
  return root;
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bundled dev transform urls", () => {
  it("serves stylesheets and vite module urls, not documents", () => {
    expect(shouldServeBundledDevModule("/src/app/globals.css", "style")).toBe(true);
    expect(
      shouldServeBundledDevModule("/@id/__x00__virtual:vite-rsc/entry-browser", "script"),
    ).toBe(true);
    expect(shouldServeBundledDevModule("/", "document")).toBe(false);
    expect(shouldServeBundledDevModule("/about", "document")).toBe(false);
    expect(shouldServeBundledDevModule("/favicon.ico", undefined)).toBe(false);
  });

  it("asks Vite for direct CSS when the browser accepts a stylesheet", () => {
    expect(prepareBundledDevTransformUrl("/src/app/globals.css", "text/css,*/*;q=0.1")).toBe(
      "/src/app/globals.css?direct",
    );
    expect(prepareBundledDevTransformUrl("/@id/__x00__virtual:vite-rsc/entry-browser", "*/*")).toBe(
      "\0virtual:vite-rsc/entry-browser",
    );
  });
});

describe("bundled dev dev server", () => {
  it("returns CSS instead of the HTML shell for App Router stylesheets", async () => {
    const root = createApp();
    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      server = await createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [vinext()],
        experimental: { bundledDev: true },
        server: { host: "127.0.0.1", port: 0, open: false },
      });
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("No dev server address");
      const origin = `http://127.0.0.1:${address.port}`;

      const page = await fetch(`${origin}/`);
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(html).toContain("<h1>styled</h1>");
      const href = html.match(/href="([^"]+\.css[^"]*)"/)?.[1];
      expect(href).toBeTruthy();

      const cssResponse = await fetch(new URL(href!, origin), {
        headers: { accept: "text/css,*/*;q=0.1" },
      });
      const css = await cssResponse.text();
      expect(cssResponse.status).toBe(200);
      expect(cssResponse.headers.get("content-type")).toContain("text/css");
      expect(css).toContain("background-color: rgb(1, 2, 3)");
      expect(css.trimStart().startsWith("<!")).toBe(false);
    } finally {
      process.chdir(previousCwd);
    }
  }, 90_000);
});
