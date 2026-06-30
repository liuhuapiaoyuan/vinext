import { describe, expect, it, vi } from "vite-plus/test";
import {
  forceDevServerExit,
  installDevServerShutdownHandlers,
} from "../packages/vinext/src/server/dev-server-shutdown.js";

describe("dev server shutdown", () => {
  it("closes connections and exits without awaiting server.close()", () => {
    const closeAllConnections = vi.fn();
    const httpClose = vi.fn();
    const serverClose = vi.fn(async () => {
      await new Promise(() => {});
    });
    const release = vi.fn();
    const server = {
      httpServer: {
        listening: true,
        closeAllConnections,
        close: httpClose,
      },
      close: serverClose,
    };
    const lockfile = { release };

    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    forceDevServerExit(server as never, lockfile as never, 0);

    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(httpClose).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(serverClose).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);

    exit.mockRestore();
  });

  it("force exits on SIGINT even before the server exists", () => {
    const release = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    installDevServerShutdownHandlers({
      getServer: () => undefined,
      lockfile: { release } as never,
    });

    process.emit("SIGINT");
    expect(release).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(130);

    exit.mockRestore();
  });

  it("force exits with the live server on SIGTERM", () => {
    const closeAllConnections = vi.fn();
    const server = {
      httpServer: { listening: false, closeAllConnections, close: vi.fn() },
      close: vi.fn(async () => {}),
    };
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    installDevServerShutdownHandlers({ getServer: () => server as never });

    process.emit("SIGTERM");
    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(143);

    exit.mockRestore();
  });
});
