import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { matchRouteWithTrie, createRouteTrieCache } from "../routing/route-matching.js";
import { stripBasePath } from "../utils/base-path.js";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

export type VinextWebSocketMessageData = string | Buffer;

export type VinextWebSocketMessageEvent = Event & {
  data: VinextWebSocketMessageData;
};

export type VinextWebSocketCloseEvent = Event & {
  code: number;
  reason: string;
  wasClean: boolean;
};

export type VinextWebSocketErrorEvent = Event & {
  error: unknown;
};

type VinextWebSocketTypedListener =
  | ((event: VinextWebSocketMessageEvent) => void)
  | ((event: VinextWebSocketCloseEvent) => void)
  | ((event: VinextWebSocketErrorEvent) => void)
  | EventListenerOrEventListenerObject
  | null;

export type VinextWebSocket = EventTarget & {
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
  readonly readyState: 0 | 1 | 2 | 3;
  readonly protocol: string;
  addEventListener(
    type: "message",
    listener: (event: VinextWebSocketMessageEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  addEventListener(
    type: "close",
    listener: (event: VinextWebSocketCloseEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  addEventListener(
    type: "error",
    listener: (event: VinextWebSocketErrorEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void;
  send(data: string | ArrayBuffer | ArrayBufferView | Buffer): void;
  close(code?: number, reason?: string): void;
  ping(data?: string | ArrayBuffer | ArrayBufferView | Buffer): void;
};

export type VinextWebSocketContext = {
  socket: VinextWebSocket;
  request: Request;
  nodeRequest: IncomingMessage;
  params: Record<string, string | string[]>;
  url: URL;
};

export type VinextWebSocketHandler = (context: VinextWebSocketContext) => void | Promise<void>;

export type VinextWebSocketRoute = {
  pattern: string;
  patternParts: string[];
  load: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  handlerExport: string;
};

export type VinextWebSocketOriginPolicy = true | string[] | undefined;

export type HandleNodeWebSocketUpgradeOptions = {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  routes: readonly VinextWebSocketRoute[];
  basePath?: string;
  allowedOrigins?: VinextWebSocketOriginPolicy;
  maxPayloadBytes?: number;
};

const routeTrieCache = createRouteTrieCache<VinextWebSocketRoute>();

function isWebSocketUpgrade(request: IncomingMessage): boolean {
  const connection = request.headers.connection;
  const upgrade = request.headers.upgrade;
  const connectionValue = Array.isArray(connection) ? connection.join(",") : connection;
  const upgradeValue = Array.isArray(upgrade) ? upgrade[0] : upgrade;
  return (
    typeof connectionValue === "string" &&
    connectionValue
      .toLowerCase()
      .split(",")
      .map((part) => part.trim())
      .includes("upgrade") &&
    typeof upgradeValue === "string" &&
    upgradeValue.toLowerCase() === "websocket"
  );
}

export function isViteHmrWebSocketUpgrade(request: IncomingMessage): boolean {
  const protocol = request.headers["sec-websocket-protocol"];
  const protocols = Array.isArray(protocol) ? protocol.join(",") : protocol;
  return typeof protocols === "string" && protocols.split(",").some((p) => p.trim() === "vite-hmr");
}

function getSingleHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function requestProtocol(request: IncomingMessage): "http" | "https" {
  const forwarded = getSingleHeader(request, "x-forwarded-proto");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim().toLowerCase();
    if (first === "https") return "https";
  }
  return (request.socket as Socket & { encrypted?: boolean }).encrypted ? "https" : "http";
}

function requestUrl(request: IncomingMessage): URL {
  const host = getSingleHeader(request, "host") ?? "localhost";
  return new URL(request.url ?? "/", `${requestProtocol(request)}://${host}`);
}

function responseLines(
  status: number,
  reason: string,
  headers: Record<string, string> = {},
  close = true,
): string {
  const lines = [`HTTP/1.1 ${status} ${reason}`];
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
  if (close) lines.push("Connection: close");
  lines.push("", "");
  return lines.join("\r\n");
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  socket.write(responseLines(status, reason), () => socket.destroy());
}

function acceptKey(key: string): string {
  return createHash("sha1")
    .update(key + WEBSOCKET_GUID)
    .digest("base64");
}

function validateWebSocketKey(key: string | null): key is string {
  if (!key) return false;
  try {
    return Buffer.from(key, "base64").byteLength === 16;
  } catch {
    return false;
  }
}

function isOriginAllowed(request: IncomingMessage, policy: VinextWebSocketOriginPolicy): boolean {
  if (policy === true) return true;
  const origin = getSingleHeader(request, "origin");
  if (!origin) return true;
  if (policy?.includes(origin)) return true;

  const host = getSingleHeader(request, "host");
  if (!host) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === `${requestProtocol(request)}:` && originUrl.host === host;
  } catch {
    return false;
  }
}

function findWebSocketRoute(
  request: IncomingMessage,
  routes: readonly VinextWebSocketRoute[],
  basePath: string | undefined,
): { route: VinextWebSocketRoute; params: Record<string, string | string[]>; url: URL } | null {
  const url = requestUrl(request);
  const routePathname = basePath ? stripBasePath(url.pathname, basePath) : url.pathname;
  const routeUrl = routePathname + url.search;
  const match = matchRouteWithTrie(routeUrl, routes as VinextWebSocketRoute[], routeTrieCache);
  if (!match) return null;
  return { ...match, url };
}

function createRequest(request: IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return new Request(url, {
    method: request.method ?? "GET",
    headers,
  });
}

function makeMessageEvent(data: VinextWebSocketMessageData): VinextWebSocketMessageEvent {
  return Object.assign(new Event("message"), { data });
}

function makeCloseEvent(
  code: number,
  reason: string,
  wasClean: boolean,
): VinextWebSocketCloseEvent {
  return Object.assign(new Event("close"), { code, reason, wasClean });
}

function makeErrorEvent(error: unknown): VinextWebSocketErrorEvent {
  return Object.assign(new Event("error"), { error });
}

class NodeVinextWebSocket extends EventTarget implements VinextWebSocket {
  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSING = 2 as const;
  readonly CLOSED = 3 as const;
  readyState: 0 | 1 | 2 | 3 = 1;
  readonly protocol = "";

  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #fragments: Buffer[] = [];
  #fragmentOpcode: 1 | 2 | null = null;
  #closeCode = 1006;
  #closeReason = "";
  #closeWasClean = false;

  override addEventListener(
    type: "message",
    listener: (event: VinextWebSocketMessageEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  override addEventListener(
    type: "close",
    listener: (event: VinextWebSocketCloseEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  override addEventListener(
    type: "error",
    listener: (event: VinextWebSocketErrorEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void;
  override addEventListener(
    type: string,
    listener: VinextWebSocketTypedListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, listener as EventListenerOrEventListenerObject | null, options);
  }

  constructor(
    private readonly socket: Duplex,
    private readonly maxPayloadBytes: number,
    head: Buffer,
  ) {
    super();
    socket.on("data", (chunk) => this.#consume(Buffer.from(chunk)));
    socket.on("error", (error) => this.#emitError(error));
    socket.on("close", () => this.#finalizeClose());
    if (head.length > 0) this.#consume(head);
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Buffer): void {
    if (this.readyState !== this.OPEN) throw new Error("WebSocket is not open");
    if (typeof data === "string") {
      this.#writeFrame(0x1, Buffer.from(data));
      return;
    }
    this.#writeFrame(0x2, toBuffer(data));
  }

  ping(data: string | ArrayBuffer | ArrayBufferView | Buffer = Buffer.alloc(0)): void {
    if (this.readyState !== this.OPEN) return;
    this.#writeFrame(0x9, typeof data === "string" ? Buffer.from(data) : toBuffer(data));
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === this.CLOSING || this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSING;
    const reasonBuffer = Buffer.from(reason);
    const payload = Buffer.alloc(Math.min(2 + reasonBuffer.length, 125));
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2, 0, payload.length - 2);
    this.#writeFrame(0x8, payload);
    this.socket.end();
  }

  #consume(chunk: Buffer): void {
    if (this.readyState === this.CLOSED) return;
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);

    while (this.#buffer.length >= 2) {
      const first = this.#buffer[0];
      const second = this.#buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const rsv = first & 0x70;
      const masked = (second & 0x80) !== 0;
      let payloadLength = second & 0x7f;
      let offset = 2;

      if (rsv !== 0 || !masked) {
        this.#protocolClose();
        return;
      }

      if (payloadLength === 126) {
        if (this.#buffer.length < offset + 2) return;
        payloadLength = this.#buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.#buffer.length < offset + 8) return;
        const bigLength = this.#buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.#closeWithCode(1009, "Payload too large");
          return;
        }
        payloadLength = Number(bigLength);
        offset += 8;
      }

      if (payloadLength > this.maxPayloadBytes) {
        this.#closeWithCode(1009, "Payload too large");
        return;
      }
      if (this.#buffer.length < offset + 4 + payloadLength) return;

      const mask = this.#buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(this.#buffer.subarray(offset, offset + payloadLength));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      this.#buffer = this.#buffer.subarray(offset + payloadLength);

      this.#handleFrame(opcode, fin, payload);
    }
  }

  #handleFrame(opcode: number, fin: boolean, payload: Buffer): void {
    if (opcode >= 0x8 && !fin) {
      this.#protocolClose();
      return;
    }

    if (opcode === 0x8) {
      this.#handleCloseFrame(payload);
      return;
    }
    if (opcode === 0x9) {
      this.#writeFrame(0xa, payload);
      return;
    }
    if (opcode === 0xa) return;

    if (opcode === 0x0) {
      if (this.#fragmentOpcode === null) {
        this.#protocolClose();
        return;
      }
      this.#fragments.push(payload);
      if (fin) this.#emitMessage(this.#fragmentOpcode, Buffer.concat(this.#fragments));
      return;
    }

    if (opcode !== 0x1 && opcode !== 0x2) {
      this.#protocolClose();
      return;
    }

    if (!fin) {
      this.#fragmentOpcode = opcode;
      this.#fragments = [payload];
      return;
    }

    this.#emitMessage(opcode, payload);
  }

  #emitMessage(opcode: 1 | 2, payload: Buffer): void {
    this.#fragments = [];
    this.#fragmentOpcode = null;
    this.dispatchEvent(makeMessageEvent(opcode === 1 ? payload.toString("utf8") : payload));
  }

  #handleCloseFrame(payload: Buffer): void {
    if (payload.length >= 2) {
      this.#closeCode = payload.readUInt16BE(0);
      this.#closeReason = payload.subarray(2).toString("utf8");
    } else {
      this.#closeCode = 1005;
      this.#closeReason = "";
    }
    this.#closeWasClean = true;
    if (this.readyState === this.OPEN) this.#writeFrame(0x8, payload);
    this.readyState = this.CLOSING;
    this.socket.end();
  }

  #writeFrame(opcode: number, payload: Buffer): void {
    if (this.socket.destroyed) return;
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, payload.length]);
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  #protocolClose(): void {
    this.#closeWithCode(1002, "Protocol error");
  }

  #closeWithCode(code: number, reason: string): void {
    this.#closeCode = code;
    this.#closeReason = reason;
    this.close(code, reason);
  }

  #emitError(error: unknown): void {
    if (this.readyState !== this.CLOSED) this.dispatchEvent(makeErrorEvent(error));
  }

  #finalizeClose(): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.dispatchEvent(makeCloseEvent(this.#closeCode, this.#closeReason, this.#closeWasClean));
  }
}

function toBuffer(data: ArrayBuffer | ArrayBufferView | Buffer): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return Buffer.from(data);
}

function extractHandler(
  module: Record<string, unknown>,
  handlerExport: string,
): VinextWebSocketHandler | null {
  const handler = module[handlerExport];
  return typeof handler === "function" ? (handler as VinextWebSocketHandler) : null;
}

export async function handleNodeWebSocketUpgrade(
  options: HandleNodeWebSocketUpgradeOptions,
): Promise<boolean> {
  const { request, socket, head, routes, basePath, allowedOrigins } = options;
  if (!isWebSocketUpgrade(request)) return false;

  if (request.method !== "GET") {
    rejectUpgrade(socket, 405, "Method Not Allowed");
    return true;
  }

  const match = findWebSocketRoute(request, routes, basePath);
  if (!match) {
    rejectUpgrade(socket, 404, "Not Found");
    return true;
  }

  if (!isOriginAllowed(request, allowedOrigins)) {
    rejectUpgrade(socket, 403, "Forbidden");
    return true;
  }

  const version = getSingleHeader(request, "sec-websocket-version");
  const key = getSingleHeader(request, "sec-websocket-key");
  if (version !== "13" || !validateWebSocketKey(key)) {
    rejectUpgrade(socket, 400, "Bad Request");
    return true;
  }

  let module: Record<string, unknown>;
  try {
    module = await match.route.load();
  } catch (error) {
    console.error("[vinext] Failed to load WebSocket route:", error);
    rejectUpgrade(socket, 500, "Internal Server Error");
    return true;
  }

  const handler = extractHandler(module, match.route.handlerExport);
  if (!handler) {
    rejectUpgrade(socket, 404, "Not Found");
    return true;
  }

  socket.write(
    responseLines(
      101,
      "Switching Protocols",
      {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Accept": acceptKey(key),
      },
      false,
    ),
  );

  const ws = new NodeVinextWebSocket(
    socket,
    options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    head,
  );
  try {
    await handler({
      socket: ws,
      request: createRequest(request, match.url),
      nodeRequest: request,
      params: match.params,
      url: match.url,
    });
  } catch (error) {
    console.error("[vinext] WebSocket route error:", error);
    ws.close(1011, "Internal Server Error");
  }
  return true;
}
