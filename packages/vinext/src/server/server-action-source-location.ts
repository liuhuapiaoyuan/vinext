import fs from "node:fs";
import path from "node:path";
import { parseSync } from "vite";
import type { ServerActionLogInfo } from "./server-action-logger.js";

type SourcePosition = {
  line: number;
  column: number;
};

type LocationPoint = {
  line?: unknown;
  column?: unknown;
};

type LocationRange = {
  start?: LocationPoint;
};

type AstNode = {
  type?: unknown;
  start?: unknown;
  loc?: LocationRange | null;
  id?: AstNode | null;
  name?: unknown;
  value?: unknown;
  declaration?: AstNode | null;
  declarations?: AstNode[];
  specifiers?: AstNode[];
  local?: AstNode | null;
  exported?: AstNode | null;
  body?: AstNode[];
};

type ParsedFileCacheEntry = {
  mtimeMs: number;
  positions: Map<string, SourcePosition>;
};

const parsedFileCache = new Map<string, ParsedFileCacheEntry>();

function normalizeFilePathForDisplay(location: string): string {
  return location.replace(/\\/g, "/");
}

function hasLineColumnSuffix(location: string): boolean {
  return /:\d+:\d+$/.test(location);
}

function resolveActionFilePath(projectRoot: string, location: string): string {
  const normalizedLocation = normalizeFilePathForDisplay(location);
  if (path.isAbsolute(normalizedLocation)) return normalizedLocation;
  return path.resolve(projectRoot, normalizedLocation);
}

function sourcePositionFromOffset(source: string, offset: number): SourcePosition {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    if (source.charCodeAt(index) === 10) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function sourcePositionFromNode(
  node: AstNode | null | undefined,
  source: string,
): SourcePosition | null {
  const line = node?.loc?.start?.line;
  const column = node?.loc?.start?.column;
  if (typeof line === "number" && typeof column === "number") {
    return { line, column: column + 1 };
  }
  if (typeof node?.start === "number") {
    return sourcePositionFromOffset(source, node.start);
  }
  return null;
}

function identifierName(node: AstNode | null | undefined): string | null {
  if (node?.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

function positionForBinding(
  node: AstNode | null | undefined,
  source: string,
): SourcePosition | null {
  if (!node) return null;
  if (node.type === "Identifier") return sourcePositionFromNode(node, source);
  return sourcePositionFromNode(node, source);
}

function addDeclarationPositions(
  positions: Map<string, SourcePosition>,
  declaration: AstNode | null | undefined,
  source: string,
): void {
  if (!declaration) return;

  if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
    const name = identifierName(declaration.id);
    const position =
      positionForBinding(declaration.id, source) ?? sourcePositionFromNode(declaration, source);
    if (name && position) positions.set(name, position);
    return;
  }

  if (declaration.type === "VariableDeclaration") {
    for (const declarator of declaration.declarations ?? []) {
      const name = identifierName(declarator.id);
      const position =
        positionForBinding(declarator.id, source) ?? sourcePositionFromNode(declarator, source);
      if (name && position) positions.set(name, position);
    }
  }
}

function positionForDefaultDeclaration(
  declaration: AstNode | null | undefined,
  localPositions: Map<string, SourcePosition>,
  source: string,
): SourcePosition | null {
  if (!declaration) return null;

  if (declaration.type === "Identifier") {
    const name = identifierName(declaration);
    return (name ? localPositions.get(name) : null) ?? sourcePositionFromNode(declaration, source);
  }

  if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
    return (
      positionForBinding(declaration.id, source) ?? sourcePositionFromNode(declaration, source)
    );
  }

  return sourcePositionFromNode(declaration, source);
}

function parseSourceFile(filePath: string, source: string): AstNode[] | null {
  const extension = path.extname(filePath).toLowerCase();
  const preferredLang =
    extension === ".jsx" ? "jsx" : extension === ".js" ? "js" : extension === ".ts" ? "ts" : "tsx";
  const languages = Array.from(new Set([preferredLang, "tsx", "ts", "jsx", "js"]));

  for (const lang of languages) {
    try {
      const result = parseSync(path.basename(filePath), source, {
        astType: "ts",
        lang: lang as "js" | "jsx" | "ts" | "tsx",
        sourceType: "module",
      });
      if (result.errors.some((error) => error.severity === "Error")) continue;
      return (result.program as AstNode).body ?? null;
    } catch {
      // Try the next parser mode.
    }
  }

  return null;
}

function collectActionPositions(source: string, filePath: string): Map<string, SourcePosition> {
  const body = parseSourceFile(filePath, source);
  const positions = new Map<string, SourcePosition>();
  if (!body) return positions;

  const localPositions = new Map<string, SourcePosition>();
  for (const node of body) {
    if (node.type === "ExportNamedDeclaration") {
      addDeclarationPositions(localPositions, node.declaration, source);
    } else {
      addDeclarationPositions(localPositions, node, source);
    }
  }

  for (const [name, position] of localPositions) {
    positions.set(name, position);
  }

  for (const node of body) {
    if (node.type === "ExportDefaultDeclaration") {
      const position = positionForDefaultDeclaration(node.declaration, localPositions, source);
      if (position) positions.set("default", position);
      continue;
    }

    if (node.type !== "ExportNamedDeclaration") continue;

    const beforeDirectExportSize = positions.size;
    addDeclarationPositions(positions, node.declaration, source);
    if (positions.size !== beforeDirectExportSize || node.declaration) continue;

    for (const specifier of node.specifiers ?? []) {
      const exportedName = identifierName(specifier.exported);
      const localName = identifierName(specifier.local);
      const position =
        (localName ? localPositions.get(localName) : null) ??
        positionForBinding(specifier.local, source);
      if (exportedName && position) positions.set(exportedName, position);
    }
  }

  return positions;
}

function getActionPositionsForFile(filePath: string): Map<string, SourcePosition> | null {
  try {
    const stat = fs.statSync(filePath);
    const cached = parsedFileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.positions;

    const source = fs.readFileSync(filePath, "utf8");
    const positions = collectActionPositions(source, filePath);
    parsedFileCache.set(filePath, { mtimeMs: stat.mtimeMs, positions });
    return positions;
  } catch {
    return null;
  }
}

export function resolveServerActionLogLocation(
  info: Pick<ServerActionLogInfo, "functionName" | "location">,
  projectRoot: string,
): string {
  const displayLocation = normalizeFilePathForDisplay(info.location);
  if (!info.functionName || hasLineColumnSuffix(displayLocation)) return displayLocation;

  const filePath = resolveActionFilePath(projectRoot, displayLocation);
  const position = getActionPositionsForFile(filePath)?.get(info.functionName);
  if (!position) return displayLocation;

  return `${displayLocation}:${position.line}:${position.column}`;
}

export function withServerActionSourceLocation(
  info: ServerActionLogInfo,
  projectRoot: string,
): ServerActionLogInfo {
  return {
    ...info,
    location: resolveServerActionLogLocation(info, projectRoot),
  };
}
