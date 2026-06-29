import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import net from "node:net";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  createWebSocketHub,
  handleNodeWebSocketUpgrade,
  type VinextWebSocket,
  type VinextWebSocketHubAdapter,
  type VinextWebSocketHubEnvelope,
  type VinextWebSocketHandler,
  type VinextWebSocketRoute,
} from "../packages/vinext/src/server/websocket.js";

type RawWebSocket = {
  socket: net.Socket;
  handshake: string;
  sendText(message: string): void;
  readText(): Promise<string>;
  close(): void;
};

class MockVinextWebSocket extends EventTarget {
  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSING = 2 as const;
  readonly CLOSED = 3 as const;
  readyState: 0 | 1 | 2 | 3 = this.OPEN;
  readonly protocol = "";
  readonly sent: (string | Buffer)[] = [];

  send(data: string | ArrayBuffer | ArrayBufferView | Buffer): void {
    if (this.readyState !== this.OPEN) throw new Error("WebSocket is not open");
    if (typeof data === "string") {
      this.sent.push(data);
      return;
    }
    if (Buffer.isBuffer(data)) {
      this.sent.push(data);
      return;
    }
    this.sent.push(
      ArrayBuffer.isView(data)
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : Buffer.from(data),
    );
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason, wasClean: true }));
  }

  ping(): void {}
}

function asVinextWebSocket(socket: MockVinextWebSocket): VinextWebSocket {
  return socket as unknown as VinextWebSocket;
}

function createFanoutAdapter(): VinextWebSocketHubAdapter {
  const listeners = new Set<(envelope: VinextWebSocketHubEnvelope) => void | Promise<void>>();
  return {
    publish(envelope) {
      for (const listener of listeners) void listener(envelope);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function encodeClientTextFrame(message: string): Buffer {
  const payload = Buffer.from(message);
  const mask = randomBytes(4);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function decodeServerTextFrame(buffer: Buffer): { message: string; rest: Buffer } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  if (opcode !== 1) throw new Error(`Expected text frame, got opcode ${opcode}`);
  return {
    message: buffer.subarray(offset, offset + length).toString("utf8"),
    rest: buffer.subarray(offset + length),
  };
}

async function connectRawWebSocket(
  baseUrl: string,
  requestPath: string,
  origin?: string,
): Promise<RawWebSocket> {
  const url = new URL(baseUrl);
  const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  const readUntil = (predicate: (value: Buffer) => boolean): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
      };
      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (predicate(buffer)) {
          cleanup();
          resolve(buffer);
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      socket.on("data", onData);
      socket.on("error", onError);
      if (predicate(buffer)) {
        cleanup();
        resolve(buffer);
      }
    });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const key = randomBytes(16).toString("base64");
  socket.write(
    [
      `GET ${requestPath} HTTP/1.1`,
      `Host: ${url.host}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${key}`,
      `Origin: ${origin ?? url.origin}`,
      "",
      "",
    ].join("\r\n"),
  );

  const handshakeBuffer = await readUntil((value) => value.includes("\r\n\r\n"));
  const marker = handshakeBuffer.indexOf("\r\n\r\n");
  const handshake = handshakeBuffer.subarray(0, marker + 4).toString("utf8");
  buffer = handshakeBuffer.subarray(marker + 4);
  if (!handshake.startsWith("HTTP/1.1 101")) {
    socket.destroy();
    throw new Error(`Expected WebSocket upgrade, received: ${handshake.split("\r\n")[0]}`);
  }

  return {
    socket,
    handshake,
    sendText(message: string) {
      socket.write(encodeClientTextFrame(message));
    },
    async readText() {
      const frameBuffer = await readUntil((value) => decodeServerTextFrame(value) !== null);
      const frame = decodeServerTextFrame(frameBuffer);
      if (!frame) throw new Error("Expected a WebSocket text frame");
      buffer = frame.rest;
      return frame.message;
    },
    close() {
      socket.destroy();
    },
  };
}

describe("Node WebSocket routes", () => {
  const servers: Server[] = [];
  const serverSockets = new Map<Server, Set<net.Socket>>();

  afterAll(async () => {
    for (const sockets of serverSockets.values()) {
      for (const socket of sockets) socket.destroy();
    }
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });

  async function startWebSocketServer(routes: VinextWebSocketRoute[]): Promise<string> {
    const server = createServer((_req, res) => {
      res.writeHead(404);
      res.end("Not Found");
    });
    const sockets = new Set<net.Socket>();
    serverSockets.set(server, sockets);
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("upgrade", (request, socket, head) => {
      void handleNodeWebSocketUpgrade({ request, socket, head, routes });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address() as { port: number };
    return `http://127.0.0.1:${address.port}`;
  }

  it("upgrades matched routes and delivers text messages with params", async () => {
    const routes: VinextWebSocketRoute[] = [
      {
        pattern: "/api/ws/:room",
        patternParts: ["api", "ws", ":room"],
        handlerExport: "WEBSOCKET",
        load: () => ({
          WEBSOCKET: (({ socket, params, url }) => {
            socket.addEventListener("message", (event) => {
              const room = Array.isArray(params.room) ? params.room.join("/") : params.room;
              const data =
                typeof event.data === "string" ? event.data : event.data.toString("utf8");
              socket.send(`${room}:${url.searchParams.get("token")}:${data}`);
            });
          }) satisfies VinextWebSocketHandler,
        }),
      },
    ];
    const baseUrl = await startWebSocketServer(routes);
    const ws = await connectRawWebSocket(baseUrl, "/api/ws/alpha?token=dev");
    expect(ws.handshake).toContain("101 Switching Protocols");
    ws.sendText("hello");
    await expect(ws.readText()).resolves.toBe("alpha:dev:hello");
    ws.close();
  });

  it("rejects cross-origin browser upgrades by default", async () => {
    const baseUrl = await startWebSocketServer([
      {
        pattern: "/api/ws",
        patternParts: ["api", "ws"],
        handlerExport: "WEBSOCKET",
        load: () => ({ WEBSOCKET() {} }),
      },
    ]);

    await expect(connectRawWebSocket(baseUrl, "/api/ws", "http://evil.example")).rejects.toThrow(
      "Expected WebSocket upgrade",
    );
  });
});

describe("WebSocket hub", () => {
  it("sends to connections, users, groups, and de-duplicated multicast targets", async () => {
    const hub = createWebSocketHub();
    const socketA = new MockVinextWebSocket();
    const socketB = new MockVinextWebSocket();
    const socketC = new MockVinextWebSocket();
    const connectionA = hub.register(asVinextWebSocket(socketA), {
      id: "conn-a",
      userId: "user-a",
    });
    const connectionB = hub.register(asVinextWebSocket(socketB), {
      id: "conn-b",
      userId: "user-b",
    });
    hub.register(asVinextWebSocket(socketC), { id: "conn-c", userId: "user-c" });

    connectionA.join("room:one");
    connectionB.join("room:one");

    await hub.connection("conn-a").send("direct");
    await hub.user("user-b").sendJson({ type: "user" });
    await hub.group("room:one").except(connectionA).send("room");
    await hub.send({ groups: ["room:one"], userIds: ["user-a"] }, "multi");

    expect(socketA.sent).toEqual(["direct", "multi"]);
    expect(socketB.sent).toEqual([JSON.stringify({ type: "user" }), "room", "multi"]);
    expect(socketC.sent).toEqual([]);
  });

  it("cleans up connection, user, and group indexes when a socket closes", () => {
    const hub = createWebSocketHub();
    const socket = new MockVinextWebSocket();
    const connection = hub.register(asVinextWebSocket(socket), { id: "conn", userId: "user" });
    connection.join("room");

    expect(hub.size()).toBe(1);
    expect(hub.groupSize("room")).toBe(1);
    expect(hub.userConnections("user")).toHaveLength(1);

    socket.close();

    expect(hub.size()).toBe(0);
    expect(hub.groupSize("room")).toBe(0);
    expect(hub.userConnections("user")).toHaveLength(0);
    expect(hub.getConnection("conn")).toBeUndefined();
  });

  it("registers socket instances that expose an internal socket property", async () => {
    const hub = createWebSocketHub();
    const socket = new MockVinextWebSocket();
    Object.defineProperty(socket, "socket", { value: {} });

    hub.register(asVinextWebSocket(socket), { id: "conn" });
    await hub.connection("conn").send("hello");

    expect(socket.sent).toEqual(["hello"]);
  });

  it("does not let a stale duplicate id cleanup remove the active connection", async () => {
    const hub = createWebSocketHub();
    const oldSocket = new MockVinextWebSocket();
    const newSocket = new MockVinextWebSocket();
    const oldConnection = hub.register(asVinextWebSocket(oldSocket), {
      id: "conn",
      userId: "old-user",
    });
    oldConnection.join("room");

    const newConnection = hub.register(asVinextWebSocket(newSocket), {
      id: "conn",
      userId: "new-user",
    });
    newConnection.join("room");
    oldSocket.close();

    await hub.group("room").send("current");

    expect(oldSocket.sent).toEqual([]);
    expect(newSocket.sent).toEqual(["current"]);
    expect(hub.userConnections("old-user")).toHaveLength(0);
    expect(hub.userConnections("new-user")).toHaveLength(1);
  });

  it("publishes group sends through the adapter for cross-process delivery", async () => {
    const adapter = createFanoutAdapter();
    const hubA = createWebSocketHub({ id: "node-a", adapter });
    const hubB = createWebSocketHub({ id: "node-b", adapter });
    const socketA = new MockVinextWebSocket();
    const socketB = new MockVinextWebSocket();
    hubA.register(asVinextWebSocket(socketA), { id: "conn-a" }).join("room");
    hubB.register(asVinextWebSocket(socketB), { id: "conn-b" }).join("room");

    const report = await hubA.group("room").send("hello");

    expect(report).toMatchObject({ attempted: 1, sent: 1, published: true });
    expect(socketA.sent).toEqual(["hello"]);
    expect(socketB.sent).toEqual(["hello"]);

    await hubA.close();
    await hubB.close();
  });
});
