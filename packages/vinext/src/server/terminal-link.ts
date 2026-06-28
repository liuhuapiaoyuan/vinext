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

function isLikelyCursor(): boolean {
  return (
    process.env.CURSOR_TRACE_ID !== undefined ||
    process.env.CURSOR_SESSION_ID !== undefined ||
    process.env.VSCODE_GIT_ASKPASS_MAIN?.includes("cursor") === true
  );
}

/**
 * Whether ANSI colors should be emitted.
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

/** Dev log hyperlinks: always emit unless explicitly disabled. */
export function shouldEmitDevFileHyperlinks(): boolean {
  if (process.env.FORCE_HYPERLINK === "0") return false;
  if (process.env.FORCE_HYPERLINK === "1") return true;
  // Turbo/pnpm pipe stdout but the integrated terminal still handles OSC 8.
  if (process.env.NODE_ENV === "development") return true;
  return shouldUseTerminalFormat();
}

/** @deprecated Use shouldEmitDevFileHyperlinks for dev file links. */
export function supportsTerminalHyperlinks(): boolean {
  return shouldEmitDevFileHyperlinks();
}

function encodeTerminalUrl(url: string): string {
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

function toPosixAbsolutePath(absolutePath: string): string {
  const posix = absolutePath.replace(/\\/g, "/");
  if (process.platform === "win32") {
    return posix.replace(/^\/([A-Za-z]:)/, "$1");
  }
  return posix;
}

function resolveEditorLinkScheme(): "cursor" | "vscode" | "file" {
  const forced = process.env.VINEXT_TERMINAL_LINK_SCHEME ?? process.env.FORCE_HYPERLINK_SCHEME;
  if (forced === "cursor" || forced === "vscode" || forced === "file") return forced;
  if (isLikelyCursor()) return "cursor";
  if (process.env.TERM_PROGRAM === "vscode") return "vscode";
  if (process.env.NODE_ENV === "development") return "vscode";
  return "file";
}

/** Paths with these characters break VS Code native terminal link detection. */
export function needsOsc8FileLink(location: string): boolean {
  return /[()[\]]/.test(parseLocation(location).filePath);
}

/** Build an editor-aware URL for OSC 8 hyperlinks (Ctrl+click in VS Code/Cursor). */
export function locationToTerminalFileUrl(location: string, projectRoot: string): string | null {
  try {
    const { filePath, line, column } = parseLocation(location);
    const normalized = filePath.replace(/\\/g, "/");
    const absolutePath = path.isAbsolute(normalized)
      ? normalized
      : path.resolve(projectRoot, normalized);

    const scheme = resolveEditorLinkScheme();
    if (scheme === "file") {
      let href = pathToFileURL(absolutePath).href;
      href = encodeTerminalUrl(href);
      if (line !== undefined) href += `:${line}:${column}`;
      return href;
    }

    const encodedPath = encodeTerminalUrl(toPosixAbsolutePath(absolutePath));
    let href = `${scheme}://file/${encodedPath}`;
    if (line !== undefined) href += `:${line}:${column}`;
    return href;
  } catch {
    return null;
  }
}

/** Wrap visible text in an OSC 8 hyperlink. Link text must stay free of ANSI codes. */
export function terminalHyperlink(text: string, url: string): string {
  if (!shouldEmitDevFileHyperlinks()) return text;
  return `${OSC8}${url}${OSC8_END}${text}${OSC8}${OSC8_END}`;
}

/**
 * Format a source location for terminal output.
 *
 * Clickability is prioritized: always emit OSC 8 with plain link text when a URL
 * can be built. Uses cursor:// or vscode:// so paths with `(group)` / `[slug]`
 * open correctly without changing terminal settings.
 */
export function formatTerminalLocationLabel(location: string, projectRoot: string): string {
  const fileUrl = locationToTerminalFileUrl(location, projectRoot);
  if (fileUrl) {
    return terminalHyperlink(location, fileUrl);
  }
  return location;
}
