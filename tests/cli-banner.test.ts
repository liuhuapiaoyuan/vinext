import { afterEach, describe, expect, it } from "vitest";
import {
  formatVinextStartupBanner,
  getVinextPackageVersion,
} from "../packages/vinext/src/cli-banner.js";

describe("cli-banner", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("reads the package version from package.json", () => {
    expect(getVinextPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints plain text when colors are disabled", () => {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;

    const banner = formatVinextStartupBanner({
      version: "1.2.3",
      command: "dev",
      detail: "Vite 6.0.0",
    });

    expect(banner).toBe("\n  ▲ vinext  v1.2.3  ·  dev  ·  Vite 6.0.0\n");
    expect(banner).not.toMatch(/\u001b\[/); // oxlint-disable-line no-control-regex
  });

  it("includes ANSI colors when terminal formatting is enabled", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    const banner = formatVinextStartupBanner({
      version: "1.2.3",
      command: "dev",
      detail: "Vite 6.0.0",
    });
    const plain = banner.replace(/\u001b\[[0-9;]*m/g, ""); // oxlint-disable-line no-control-regex

    expect(plain).toContain("vinext");
    expect(plain).toContain("v1.2.3");
    expect(plain).toContain("dev");
    expect(plain).toContain("Vite 6.0.0");
    expect(banner).toMatch(/\u001b\[/); // oxlint-disable-line no-control-regex
  });
});
