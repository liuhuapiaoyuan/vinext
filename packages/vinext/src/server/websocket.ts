import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { matchRouteWithTrie, createRouteTrieCache } from "../routing/route-matching.js";
import { stripBasePath } from "../utils/base-path.js";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

export type VinextWebSocketMessageData = string | Buffer;

export type VinextWebSocketSendData = string | ArrayBuffer | ArrayBufferView | Buffer;

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

type MaybePromise<T> = T | Promise<T>;

export type VinextWebSocketSerializedMessage =
  | {
      type: "text";
      data: string;
    }
  | {
      type: "binary";
      data: string;
    };

export type VinextWebSocketHubTargetSelector = {
  all?: boolean;
  connectionIds?: readonly string[];
  userIds?: readonly string[];
  groups?: readonly string[];
};

export type VinextWebSocketHubEnvelope = {
  id: string;
  sourceId: string;
  target: VinextWebSocketHubTargetSelector;
  data: VinextWebSocketSerializedMessage;
  exceptConnectionIds?: readonly string[];
};

export type VinextWebSocketHubAdapter = {
  publish(envelope: VinextWebSocketHubEnvelope): MaybePromise<void>;
  subscribe(
    listener: (envelope: VinextWebSocketHubEnvelope) => MaybePromise<void>,
  ): MaybePromise<void | (() => MaybePromise<void>)>;
};

export type VinextWebSocketSendFailure = {
  connectionId: string;
  error: unknown;
};

export type VinextWebSocketDeliveryReport = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  failures: VinextWebSocketSendFailure[];
  published: boolean;
};

export type VinextWebSocketConnectionRef = string | { readonly id: string };

export type VinextWebSocketSendOptions =
  | {
      except?: VinextWebSocketConnectionRef | readonly VinextWebSocketConnectionRef[];
      localOnly?: boolean;
    }
  | undefined;

type VinextWebSocketExceptInput =
  | VinextWebSocketConnectionRef
  | readonly VinextWebSocketConnectionRef[]
  | undefined;

export type VinextWebSocketRegisterOptions<TMeta = unknown> = {
  id?: string;
  userId?: string;
  meta?: TMeta;
};

export type VinextWebSocketConnection<TMeta = unknown> = {
  readonly id: string;
  readonly userId: string | undefined;
  readonly socket: VinextWebSocket;
  readonly meta: TMeta | undefined;
  readonly groups: ReadonlySet<string>;
  send(
    data: VinextWebSocketSendData,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport>;
  sendJson(
    value: unknown,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport>;
  close(code?: number, reason?: string): void;
  join(group: string): void;
  leave(group: string): void;
  leaveAll(): void;
  onMessage(listener: (event: VinextWebSocketMessageEvent) => void): () => void;
  onClose(listener: (event: VinextWebSocketCloseEvent) => void): () => void;
};

export type VinextWebSocketTarget<TMeta = unknown> = {
  except(
    except: VinextWebSocketConnectionRef | readonly VinextWebSocketConnectionRef[],
  ): VinextWebSocketTarget<TMeta>;
  send(
    data: VinextWebSocketSendData,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport>;
  sendJson(
    value: unknown,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport>;
  connections(): readonly VinextWebSocketConnection<TMeta>[];
};

export type VinextWebSocketHub<TMeta = unknown> = {
  readonly id: string;
  register(
    context: VinextWebSocketContext | VinextWebSocket,
    options?: VinextWebSocketRegisterOptions<TMeta>,
  ): VinextWebSocketConnection<TMeta>;
  getConnection(id: string): VinextWebSocketConnection<TMeta> | undefined;
  connection(id: string): VinextWebSocketTarget<TMeta>;
  user(userId: string): VinextWebSocketTarget<TMeta>;
  group(group: string): VinextWebSocketTarget<TMeta>;
  target(selector: VinextWebSocketHubTargetSelector): VinextWebSocketTarget<TMeta>;
  send(
    selector: VinextWebSocketHubTargetSelector,
    data: VinextWebSocketSendData,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport>;
  sendJson(
    selector: VinextWebSocketHubTargetSelector,
    value: unknown,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport>;
  broadcast(
    data: VinextWebSocketSendData,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport>;
  broadcastJson(
    value: unknown,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport>;
  size(): number;
  groupSize(group: string): number;
  userConnections(userId: string): readonly VinextWebSocketConnection<TMeta>[];
  close(code?: number, reason?: string): Promise<void>;
};

export type CreateVinextWebSocketHubOptions = {
  id?: string;
  adapter?: VinextWebSocketHubAdapter;
  onAdapterError?: (error: unknown, envelope?: VinextWebSocketHubEnvelope) => void;
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

function serializeWebSocketData(data: VinextWebSocketSendData): VinextWebSocketSerializedMessage {
  if (typeof data === "string") return { type: "text", data };
  return { type: "binary", data: toBuffer(data).toString("base64") };
}

function deserializeWebSocketData(data: VinextWebSocketSerializedMessage): string | Buffer {
  return data.type === "text" ? data.data : Buffer.from(data.data, "base64");
}

function isVinextWebSocketContext(
  context: VinextWebSocketContext | VinextWebSocket,
): context is VinextWebSocketContext {
  return "request" in context && "params" in context && "url" in context;
}

function normalizeExceptIds(except: VinextWebSocketExceptInput): Set<string> {
  const ids = new Set<string>();
  if (!except) return ids;
  const values = Array.isArray(except) ? except : [except];
  for (const value of values) {
    ids.add(typeof value === "string" ? value : value.id);
  }
  return ids;
}

class VinextWebSocketConnectionImpl<TMeta> implements VinextWebSocketConnection<TMeta> {
  readonly groups = new Set<string>();

  constructor(
    private readonly hub: VinextWebSocketHubImpl<TMeta>,
    readonly socket: VinextWebSocket,
    readonly id: string,
    readonly userId: string | undefined,
    readonly meta: TMeta | undefined,
  ) {}

  send(
    data: VinextWebSocketSendData,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport> {
    return this.hub.sendLocal(
      { connectionIds: [this.id] },
      data,
      normalizeExceptIds(options?.except),
    );
  }

  sendJson(
    value: unknown,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport> {
    return this.send(JSON.stringify(value), options);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  join(group: string): void {
    this.hub.addConnectionToGroup(this, group);
  }

  leave(group: string): void {
    this.hub.removeConnectionFromGroup(this, group);
  }

  leaveAll(): void {
    this.hub.removeConnectionFromAllGroups(this);
  }

  onMessage(listener: (event: VinextWebSocketMessageEvent) => void): () => void {
    this.socket.addEventListener("message", listener);
    return () => this.socket.removeEventListener("message", listener as EventListener);
  }

  onClose(listener: (event: VinextWebSocketCloseEvent) => void): () => void {
    this.socket.addEventListener("close", listener);
    return () => this.socket.removeEventListener("close", listener as EventListener);
  }
}

class VinextWebSocketTargetImpl<TMeta> implements VinextWebSocketTarget<TMeta> {
  constructor(
    private readonly hub: VinextWebSocketHubImpl<TMeta>,
    private readonly selector: VinextWebSocketHubTargetSelector,
    private readonly exceptIds = new Set<string>(),
  ) {}

  except(
    except: VinextWebSocketConnectionRef | readonly VinextWebSocketConnectionRef[],
  ): VinextWebSocketTarget<TMeta> {
    const nextExceptIds = new Set(this.exceptIds);
    for (const id of normalizeExceptIds(except)) nextExceptIds.add(id);
    return new VinextWebSocketTargetImpl(this.hub, this.selector, nextExceptIds);
  }

  send(
    data: VinextWebSocketSendData,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport> {
    const exceptIds = new Set(this.exceptIds);
    for (const id of normalizeExceptIds(options?.except)) exceptIds.add(id);
    return this.hub.sendWithExceptIds(this.selector, data, exceptIds, options?.localOnly);
  }

  sendJson(
    value: unknown,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport> {
    return this.send(JSON.stringify(value), options);
  }

  connections(): readonly VinextWebSocketConnection<TMeta>[] {
    return [...this.hub.resolveLocalConnections(this.selector, this.exceptIds)];
  }
}

class VinextWebSocketHubImpl<TMeta> implements VinextWebSocketHub<TMeta> {
  readonly id: string;
  private readonly connections = new Map<string, VinextWebSocketConnectionImpl<TMeta>>();
  private readonly users = new Map<string, Set<string>>();
  private readonly groups = new Map<string, Set<string>>();
  private readonly seenEnvelopeIds = new Set<string>();
  private readonly seenEnvelopeOrder: string[] = [];
  private unsubscribe: (() => MaybePromise<void>) | undefined;
  private adapterReady: Promise<void>;

  constructor(private readonly options: CreateVinextWebSocketHubOptions = {}) {
    this.id = options.id ?? randomUUID();
    this.adapterReady = this.subscribeAdapter(options.adapter);
  }

  register(
    context: VinextWebSocketContext | VinextWebSocket,
    options: VinextWebSocketRegisterOptions<TMeta> = {},
  ): VinextWebSocketConnection<TMeta> {
    const socket = isVinextWebSocketContext(context) ? context.socket : context;
    const id = options.id ?? randomUUID();
    const existing = this.connections.get(id);
    if (existing) this.removeConnection(existing);
    const connection = new VinextWebSocketConnectionImpl(
      this,
      socket,
      id,
      options.userId,
      options.meta,
    );
    this.connections.set(connection.id, connection);
    if (connection.userId) this.addIndexValue(this.users, connection.userId, connection.id);
    socket.addEventListener("close", () => this.removeConnection(connection), { once: true });
    return connection;
  }

  getConnection(id: string): VinextWebSocketConnection<TMeta> | undefined {
    return this.connections.get(id);
  }

  connection(id: string): VinextWebSocketTarget<TMeta> {
    return this.target({ connectionIds: [id] });
  }

  user(userId: string): VinextWebSocketTarget<TMeta> {
    return this.target({ userIds: [userId] });
  }

  group(group: string): VinextWebSocketTarget<TMeta> {
    return this.target({ groups: [group] });
  }

  target(selector: VinextWebSocketHubTargetSelector): VinextWebSocketTarget<TMeta> {
    return new VinextWebSocketTargetImpl(this, selector);
  }

  async send(
    selector: VinextWebSocketHubTargetSelector,
    data: VinextWebSocketSendData,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport> {
    const exceptIds = normalizeExceptIds(options?.except);
    return this.sendWithExceptIds(selector, data, exceptIds, options?.localOnly);
  }

  async sendWithExceptIds(
    selector: VinextWebSocketHubTargetSelector,
    data: VinextWebSocketSendData,
    exceptIds: Set<string>,
    localOnly?: boolean,
  ): Promise<VinextWebSocketDeliveryReport> {
    const report = this.deliverLocal(selector, data, exceptIds);
    if (!localOnly && this.options.adapter) {
      const serialized = serializeWebSocketData(data);
      const envelope: VinextWebSocketHubEnvelope = {
        id: randomUUID(),
        sourceId: this.id,
        target: selector,
        data: serialized,
      };
      if (exceptIds.size > 0) envelope.exceptConnectionIds = [...exceptIds];
      try {
        await this.adapterReady;
        await this.options.adapter.publish(envelope);
        report.published = true;
      } catch (error) {
        this.handleAdapterError(error, envelope);
      }
    }
    return report;
  }

  sendLocal(
    selector: VinextWebSocketHubTargetSelector,
    data: VinextWebSocketSendData,
    exceptIds = new Set<string>(),
  ): Promise<VinextWebSocketDeliveryReport> {
    return Promise.resolve(this.deliverLocal(selector, data, exceptIds));
  }

  sendJson(
    selector: VinextWebSocketHubTargetSelector,
    value: unknown,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport> {
    return this.send(selector, JSON.stringify(value), options);
  }

  broadcast(
    data: VinextWebSocketSendData,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport> {
    return this.send({ all: true }, data, options);
  }

  broadcastJson(
    value: unknown,
    options?: VinextWebSocketSendOptions,
  ): Promise<VinextWebSocketDeliveryReport> {
    return this.broadcast(JSON.stringify(value), options);
  }

  size(): number {
    return this.connections.size;
  }

  groupSize(group: string): number {
    return this.groups.get(group)?.size ?? 0;
  }

  userConnections(userId: string): readonly VinextWebSocketConnection<TMeta>[] {
    return [...(this.users.get(userId) ?? [])]
      .map((id) => this.connections.get(id))
      .filter(
        (connection): connection is VinextWebSocketConnectionImpl<TMeta> =>
          connection !== undefined,
      );
  }

  async close(code = 1001, reason = "WebSocket hub closed"): Promise<void> {
    await this.adapterReady;
    await this.unsubscribe?.();
    this.unsubscribe = undefined;
    while (this.connections.size > 0) {
      const connection = this.connections.values().next().value;
      if (!connection) break;
      connection.socket.close(code, reason);
      this.removeConnection(connection);
    }
  }

  addConnectionToGroup(connection: VinextWebSocketConnectionImpl<TMeta>, group: string): void {
    if (!this.connections.has(connection.id)) return;
    connection.groups.add(group);
    this.addIndexValue(this.groups, group, connection.id);
  }

  removeConnectionFromGroup(connection: VinextWebSocketConnectionImpl<TMeta>, group: string): void {
    connection.groups.delete(group);
    this.removeIndexValue(this.groups, group, connection.id);
  }

  removeConnectionFromAllGroups(connection: VinextWebSocketConnectionImpl<TMeta>): void {
    while (connection.groups.size > 0) {
      const group = connection.groups.values().next().value;
      if (!group) break;
      this.removeConnectionFromGroup(connection, group);
    }
  }

  resolveLocalConnections(
    selector: VinextWebSocketHubTargetSelector,
    exceptIds = new Set<string>(),
  ): Set<VinextWebSocketConnectionImpl<TMeta>> {
    const resolved = new Set<VinextWebSocketConnectionImpl<TMeta>>();
    const addConnection = (id: string) => {
      if (exceptIds.has(id)) return;
      const connection = this.connections.get(id);
      if (connection) resolved.add(connection);
    };

    if (selector.all) {
      for (const id of this.connections.keys()) addConnection(id);
    }
    for (const id of selector.connectionIds ?? []) addConnection(id);
    for (const userId of selector.userIds ?? []) {
      for (const id of this.users.get(userId) ?? []) addConnection(id);
    }
    for (const group of selector.groups ?? []) {
      for (const id of this.groups.get(group) ?? []) addConnection(id);
    }
    return resolved;
  }

  private deliverLocal(
    selector: VinextWebSocketHubTargetSelector,
    data: VinextWebSocketSendData,
    exceptIds: Set<string>,
  ): VinextWebSocketDeliveryReport {
    const report: VinextWebSocketDeliveryReport = {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      published: false,
    };
    for (const connection of this.resolveLocalConnections(selector, exceptIds)) {
      report.attempted++;
      if (connection.socket.readyState !== connection.socket.OPEN) {
        report.skipped++;
        continue;
      }
      try {
        connection.socket.send(data);
        report.sent++;
      } catch (error) {
        report.failed++;
        report.failures.push({ connectionId: connection.id, error });
      }
    }
    return report;
  }

  private removeConnection(connection: VinextWebSocketConnectionImpl<TMeta>): void {
    if (this.connections.get(connection.id) !== connection) return;
    this.connections.delete(connection.id);
    if (connection.userId) this.removeIndexValue(this.users, connection.userId, connection.id);
    this.removeConnectionFromAllGroups(connection);
  }

  private addIndexValue(index: Map<string, Set<string>>, key: string, value: string): void {
    let values = index.get(key);
    if (!values) {
      values = new Set();
      index.set(key, values);
    }
    values.add(value);
  }

  private removeIndexValue(index: Map<string, Set<string>>, key: string, value: string): void {
    const values = index.get(key);
    if (!values) return;
    values.delete(value);
    if (values.size === 0) index.delete(key);
  }

  private async subscribeAdapter(adapter: VinextWebSocketHubAdapter | undefined): Promise<void> {
    if (!adapter) return;
    try {
      const unsubscribe = await adapter.subscribe((envelope) => this.handleEnvelope(envelope));
      if (unsubscribe) this.unsubscribe = unsubscribe;
    } catch (error) {
      this.handleAdapterError(error);
    }
  }

  private handleEnvelope(envelope: VinextWebSocketHubEnvelope): void {
    try {
      if (envelope.sourceId === this.id || !this.rememberEnvelope(envelope.id)) return;
      this.deliverLocal(
        envelope.target,
        deserializeWebSocketData(envelope.data),
        new Set(envelope.exceptConnectionIds),
      );
    } catch (error) {
      this.handleAdapterError(error, envelope);
    }
  }

  private rememberEnvelope(id: string): boolean {
    if (this.seenEnvelopeIds.has(id)) return false;
    this.seenEnvelopeIds.add(id);
    this.seenEnvelopeOrder.push(id);
    if (this.seenEnvelopeOrder.length > 1000) {
      const oldId = this.seenEnvelopeOrder.shift();
      if (oldId) this.seenEnvelopeIds.delete(oldId);
    }
    return true;
  }

  private handleAdapterError(error: unknown, envelope?: VinextWebSocketHubEnvelope): void {
    if (this.options.onAdapterError) {
      this.options.onAdapterError(error, envelope);
      return;
    }
    console.error("[vinext] WebSocket hub adapter error:", error);
  }
}

export function createWebSocketHub<TMeta = unknown>(
  options?: CreateVinextWebSocketHubOptions,
): VinextWebSocketHub<TMeta> {
  return new VinextWebSocketHubImpl<TMeta>(options);
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
