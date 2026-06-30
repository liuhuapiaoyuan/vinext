import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldUseTerminalFormat } from "./server/terminal-link.js";

function colorize(code: string, text: string): string {
  return shouldUseTerminalFormat() ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const c = {
  bold: (s: string) => colorize("1", s),
  cyan: (s: string) => colorize("36", s),
  green: (s: string) => colorize("32", s),
  yellow: (s: string) => colorize("33", s),
  magenta: (s: string) => colorize("35", s),
  dim: (s: string) => colorize("2", s),
};

/** Read the vinext package version from package.json at runtime. */
export function getVinextPackageVersion(): string {
  const packageJsonPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );
  return (JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { version: string }).version;
}

/** Colorize each character of `text` with rotating ANSI colors. */
function gradientText(text: string, codes: string[]): string {
  if (!shouldUseTerminalFormat()) return text;
  const colored = Array.from(text)
    .map((char, index) => colorize(codes[index % codes.length]!, char))
    .join("");
  return `${colored}\x1b[0m`;
}

export type VinextStartupBannerOptions = {
  version: string;
  command: string;
  /** Shown dimmed after the command, e.g. "Vite 6.0.0" or "port 3000". */
  detail?: string;
};

/** Format the vinext startup banner (without trailing newline). */
export function formatVinextStartupBanner(options: VinextStartupBannerOptions): string {
  const { version, command, detail } = options;
  const brand = gradientText("vinext", ["36", "96", "35", "96", "32", "33"]);
  const versionLabel = c.green(`v${version}`);
  const commandLabel = c.bold(command);
  const separator = c.dim("·");

  let line = `  ${c.yellow("▲")} ${brand}  ${versionLabel}  ${separator}  ${commandLabel}`;
  if (detail) {
    line += `  ${separator}  ${c.dim(detail)}`;
  }
  return `\n${line}\n`;
}

export function printVinextStartupBanner(options: VinextStartupBannerOptions): void {
  process.stdout.write(formatVinextStartupBanner(options));
}
