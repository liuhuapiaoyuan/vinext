import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import net from "node:net";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  handleNodeWebSocketUpgrade,
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
