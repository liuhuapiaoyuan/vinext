import path from "node:path";
import { pathToFileURL } from "node:url";

const OSC8 = "\x1b]8;;";
const OSC8_END = "\x1b\\";

/** Characters that break VS Code/Cursor terminal path detection without OSC 8. */
const TERMINAL_URL_ESCAPE = /[()[\] ]/g;

function isKnownInteractiveTerminal(): boolean {
  if (process.env.TERM_PROGRAM === "vscode") return true;
  if (process.env.WT_SESSION) return true;
  if (process.env.ITERM_SESSION_ID) return true;
  if (process.env.WEZTERM_EXECUTABLE) return true;
  if (process.env.KITTY_WINDOW_ID) return true;
  if (process.env.VTE_VERSION) return true;
  const term = process.env.TERM ?? "";
  return term.includes("alacritty") || term.includes("ghostty");
}

/**
 * Whether ANSI colors and OSC 8 hyperlinks should be emitted.
 *
 * Turbo/pnpm prefix child output (`admin:dev:`) so `stdout.isTTY` is often false
 * even though the integrated terminal still renders escape codes.
 */
export function shouldUseTerminalFormat(): boolean {
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  if (
    process.env.NO_COLOR !== undefined &&
    process.env.NO_COLOR !== "" &&
    process.env.NO_COLOR !== "0"
  ) {
    return false;
  }
  if (isKnownInteractiveTerminal()) return true;
  if (process.stdout.isTTY) return true;
  if (process.stderr.isTTY) return true;
  return false;
}

export function supportsTerminalHyperlinks(): boolean {
  if (process.env.FORCE_HYPERLINK === "0") return false;
  if (process.env.FORCE_HYPERLINK === "1") return true;
  return shouldUseTerminalFormat();
}

function escapeTerminalUrl(url: string): string {
  return url.replace(
    TERMINAL_URL_ESCAPE,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

function parseLocation(location: string): {
  filePath: string;
  line?: number;
  column?: number;
} {
  const match = /^(.+):(\d+):(\d+)$/.exec(location);
  if (!match) return { filePath: location };
  return {
    filePath: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
  };
}

/** Build a file:// URL for OSC 8 terminal hyperlinks (Ctrl+click in VS Code/Cursor). */
export function locationToTerminalFileUrl(location: string, projectRoot: string): string | null {
  try {
    const { filePath, line, column } = parseLocation(location);
    const normalized = filePath.replace(/\\/g, "/");
    const absolutePath = path.isAbsolute(normalized)
      ? normalized
      : path.resolve(projectRoot, normalized);

    let href = pathToFileURL(absolutePath).href;
    href = escapeTerminalUrl(href);
    if (line !== undefined) {
      href += `:${line}:${column}`;
    }
    return href;
  } catch {
    return null;
  }
}

/** Wrap visible text in an OSC 8 hyperlink when the terminal supports it. */
export function terminalHyperlink(text: string, url: string): string {
  if (!supportsTerminalHyperlinks()) return text;
  return `${OSC8}${url}${OSC8_END}${text}${OSC8}${OSC8_END}`;
}
