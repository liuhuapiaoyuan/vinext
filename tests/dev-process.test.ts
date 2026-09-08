import net from "node:net";
import { describe, expect, it } from "vite-plus/test";
import {
  isPortAvailableOnHost,
  parseWindowsNetstatListeningPids,
} from "../packages/vinext/src/server/dev-process.js";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.once("error", reject);
  });
}

describe("parseWindowsNetstatListeningPids", () => {
  it("finds listening PIDs without relying on the LISTENING token", () => {
    const output = [
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:3000         127.0.0.1:54321        ESTABLISHED     9999",
      "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4242",
      "  TCP    [::]:3000              [::]:0                 侦听            5151",
    ].join("\n");

    expect(parseWindowsNetstatListeningPids(3000, output).sort((a, b) => a - b)).toEqual([
      4242, 5151,
    ]);
  });

  it("ignores unrelated ports", () => {
    const output = "  TCP    0.0.0.0:4000           0.0.0.0:0              LISTENING       7777";
    expect(parseWindowsNetstatListeningPids(3000, output)).toEqual([]);
  });
});

describe("isPortAvailableOnHost", () => {
  it("resolves when a client connects during the bind probe", async () => {
    const port = await getFreePort();
    const sockets: net.Socket[] = [];
    const connector = setInterval(() => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      sockets.push(socket);
      socket.on("error", () => {});
    }, 10);

    try {
      await expect(isPortAvailableOnHost(port, "127.0.0.1")).resolves.toBe(true);
    } finally {
      clearInterval(connector);
      for (const socket of sockets) socket.destroy();
    }
  });
});
