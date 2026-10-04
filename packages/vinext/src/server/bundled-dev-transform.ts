import type { Connect, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const CSS_LANGS_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
const MODULE_EXT_RE =
  /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss|jsx?|tsx?|mjs|cjs|mts|cts|vue|svelte|mdx)$/i;
const DOCUMENT_FETCH_DESTS = new Set(["document", "iframe", "frame", "fencedframe"]);
const DIRECT_QUERY_RE = /[?&]direct\b/;
const IMPORT_QUERY_RE = /(\?|&)import=?(?:&|$)/;
const TIMESTAMP_QUERY_RE = /\bt=\d{13}&?\b/;
const TRAILING_SEPARATOR_RE = /[?&]$/;

type TransformResult = { code: string } | null;

/**
 * Vite's `--experimental-bundle` serves the client from an in-memory bundle and
 * removes the per-request transform middleware. App Router still emits classic
 * dev URLs (`/src/app/globals.css`, `/@id/...`). Without this fallback those
 * requests fall through to the SSR handler and come back as HTML.
 */
export function installBundledDevTransformMiddleware(server: ViteDevServer): void {
  if (!isBundledDev(server)) return;

  const middleware: Connect.NextHandleFunction = function vinextBundledDevTransformMiddleware(
    req,
    res,
    next,
  ) {
    void serveBundledDevTransform(server, req, res).then((served) => {
      if (!served) next();
    }, next);
  };
  server.middlewares.use(middleware);
}

export function shouldServeBundledDevModule(url: string, fetchDest: string | undefined): boolean {
  if (fetchDest && DOCUMENT_FETCH_DESTS.has(fetchDest)) return false;
  const pathname = url.split(/[?#]/, 1)[0] ?? url;
  if (!pathname || pathname === "/" || pathname.endsWith(".html") || pathname.endsWith(".rsc")) {
    return false;
  }
  if (pathname.startsWith("/@")) return true;
  if (pathname.includes("/node_modules/")) return true;
  if (MODULE_EXT_RE.test(pathname)) return true;
  return /[?&](?:import|direct|raw|url)(?:&|$)/.test(url);
}

export function prepareBundledDevTransformUrl(url: string, accept: string | undefined): string {
  let transformUrl = decodeURI(url)
    .replace(TIMESTAMP_QUERY_RE, "")
    .replace(TRAILING_SEPARATOR_RE, "");
  transformUrl = transformUrl.replace(IMPORT_QUERY_RE, "$1").replace(TRAILING_SEPARATOR_RE, "");
  if (transformUrl.startsWith("/@id/")) {
    transformUrl = transformUrl.slice("/@id/".length).replaceAll("__x00__", "\0");
  }
  if (
    CSS_LANGS_RE.test(transformUrl) &&
    accept?.includes("text/css") &&
    !DIRECT_QUERY_RE.test(transformUrl)
  ) {
    transformUrl = injectQuery(transformUrl, "direct");
  }
  return transformUrl;
}

async function serveBundledDevTransform(
  server: ViteDevServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const rawUrl = req.url;
  if (!rawUrl || rawUrl === "/" || rawUrl.startsWith("/?")) return false;
  const fetchDest = headerValue(req.headers["sec-fetch-dest"]);
  if (!shouldServeBundledDevModule(rawUrl, fetchDest)) return false;

  let transformUrl: string;
  try {
    transformUrl = prepareBundledDevTransformUrl(rawUrl, headerValue(req.headers.accept));
  } catch {
    return false;
  }

  const wantsCss = CSS_LANGS_RE.test(transformUrl) && DIRECT_QUERY_RE.test(transformUrl);
  const result = await loadTransform(server, transformUrl, wantsCss);
  if (!result) return false;

  res.statusCode = 200;
  res.setHeader(
    "Content-Type",
    wantsCss ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
  );
  res.setHeader("Cache-Control", "no-cache");
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  res.end(result.code);
  return true;
}

async function loadTransform(
  server: ViteDevServer,
  transformUrl: string,
  wantsCss: boolean,
): Promise<TransformResult> {
  const client = server.environments.client;
  if (client) {
    try {
      const result = await client.transformRequest(transformUrl);
      if (result && (!wantsCss || isCssSource(result.code))) return result;
    } catch (error) {
      if (!wantsCss) {
        if (isMissingModuleError(error)) return null;
        throw error;
      }
    }
  }

  if (!wantsCss) return null;
  const rsc = server.environments.rsc;
  if (!rsc) return null;
  try {
    const result = await rsc.transformRequest(transformUrl);
    if (result && isCssSource(result.code)) return result;
  } catch (error) {
    // Server environments run the module-runner transform, which parses CSS as
    // JavaScript. That failure means this URL is not a module, not a server error.
    if (isMissingModuleError(error) || isCssParseError(error)) return null;
    throw error;
  }
  return null;
}

function isBundledDev(server: ViteDevServer): boolean {
  const experimental = server.config.experimental as { bundledDev?: boolean };
  if (experimental.bundledDev) return true;
  return Boolean((server.environments.client as { bundledDev?: unknown } | undefined)?.bundledDev);
}

function isCssSource(code: string): boolean {
  const trimmed = code.trimStart();
  if (!trimmed || trimmed.startsWith("import ") || trimmed.startsWith("export ")) return false;
  if (/^(?:const|let|function|class)\s/.test(trimmed)) return false;
  return !code.includes("__vite__updateStyle");
}

function isMissingModuleError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ERR_LOAD_URL" || code === "ERR_DENIED_ID";
}

function isCssParseError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Parse failure:");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function injectQuery(url: string, query: string): string {
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return `${url}?${query}`;
  return `${url.slice(0, queryIndex)}?${query}&${url.slice(queryIndex + 1)}`;
}
