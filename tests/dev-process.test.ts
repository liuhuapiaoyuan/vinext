import { describe, expect, it } from "vite-plus/test";
import { parseWindowsNetstatListeningPids } from "../packages/vinext/src/server/dev-process.js";

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
